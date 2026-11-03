// memory.js —— 情绪记忆的存储层（2026-11-03，情绪记忆模型 0.1）
//
// 目标：一份记录里既有"说了什么"，也有"说的时候心里什么状态"。
// 记忆条目 = { id, text, tags, at, 类别, 重要度, 情感指纹 {P,A,D,词}, 显著性 }
//
// 存储直接落在 fish-memory 的会话 JSON 里（那里已经有 40 条真记忆），
// 我们不复制一份，只在每条上补一个 affect 字段 —— 这样"记忆只有一份"。

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const 根 = join(homedir(), '.dsh', 'fish-memory')

function 文件(会话) {
  const id = String(会话 || '').trim()
  if (!id) return null
  return join(根, `session-${id.replace(/^session-/, '')}.json`)
}

export function 读记忆(会话) {
  const f = 文件(会话)
  if (!f || !existsSync(f)) return { 条目: [], 原始: null, 路径: f }
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return { 条目: Array.isArray(j.memories) ? j.memories : [], 原始: j, 路径: f }
  } catch (e) {
    return { 条目: [], 原始: null, 路径: f, 错: e.message }
  }
}

// 这个会话还没有记忆文件时，建一份空库（导入到新会话时用）
export function 建记忆文件(会话) {
  const f = 文件(会话)
  if (!f) return null
  const 空 = { version: 2, policy: {}, memories: [], traces: [], deleted: [] }
  try {
    writeFileSync(f, JSON.stringify(空, null, 2), 'utf8')
    return { 原始: 空, 路径: f }
  } catch { return null }
}

// 给一条记忆盖情感指纹（写的时候顺手记下当时的 PAD + 词 + 显著性）
export function 盖章(会话, id, 指纹) {
  const { 原始, 路径 } = 读记忆(会话)
  if (!原始) return false
  const 条 = (原始.memories || []).find((m) => m.id === id)
  if (!条) return false
  条.affect = {
    P: Number(指纹.P) || 0,
    A: Number(指纹.A) || 0,
    D: Number(指纹.D) || 0,
    词: String(指纹.词 || ''),
    显著性: Math.min(1, Math.round(100 * Math.max(0.15, (Math.abs(Number(指纹.A) || 0) + Math.abs(Number(指纹.P) || 0)) / 2)) / 100),
    at: Date.now(),
  }
  try { copyFileSync(路径, 路径 + '.bak-affect') } catch { /* 备份失败不挡路 */ }
  writeFileSync(路径, JSON.stringify(原始, null, 2), 'utf8')
  return true
}

// 检索：先看相关，再看新鲜、重要、心境。
// 之前只按新鲜/重要/心情打分，结果不管聊什么都想起"重庆人"那种最"重"的旧事 —— 跑了偏。
//   分 = 0.20×新鲜 + 0.15×重要 + 0.60×相关 + 0.05×心境一致（相关为主，心情只微调）
// 相关用中文字二元组重合（够土，但稳）：一句话里没一个共同的词，就不该硬想起来。
// 切词：中文按二元组（滤掉虚词），英文按整个词 —— 英文不能切两字母，
// 否则 "word" 和 "workspace" 的 "wo"、"or" 会算成一回事。
const 虚字 = new Set('的了是我你他她它在有和就也都这那不一个上下来去说要会能对得着过还如果因为所以但是很太没无与把被给让从到于其之而且或如若则以为所等吧呢啊吗嘛呀哦嗯')

function 中文二元组(t) {
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i]
    const b = t[i + 1]
    if (虚字.has(a) || 虚字.has(b)) continue
    out.add(a + b)
  }
  return out
}

function 切词(t) {
  const 原 = String(t || '')
  const 中文段 = 原.replace(/[^\u4e00-\u9fa5]/g, ' ')
  const 词 = new Set()
  for (const 段 of 中文段.split(/\s+/)) {
    if (!段) continue
    for (const g of 中文二元组(段)) 词.add(g)
  }
  for (const w of 原.toLowerCase().match(/[a-z0-9]{3,}/g) || []) 词.add('w:' + w)
  return 词
}

export function 检索(会话, {
  词 = '', P = 0, A = 0, 上限 = 3, 现在 = Date.now(), 半衰天 = 14,
  权重 = {},
} = {}) {
  const w新 = Number.isFinite(Number(权重.新鲜)) ? Number(权重.新鲜) : 0.20
  const w重 = Number.isFinite(Number(权重.重要)) ? Number(权重.重要) : 0.15
  const w关 = Number.isFinite(Number(权重.相关)) ? Number(权重.相关) : 0.60
  const w心 = Number.isFinite(Number(权重.心境)) ? Number(权重.心境) : 0.05
  const 访问加成系数 = Number.isFinite(Number(权重.访问加成)) ? Number(权重.访问加成) : 0.08
  const { 条目 } = 读记忆(会话)
  if (!条目.length) return []
  const 话 = 切词(词)
  const 命中 = []
  for (const m of 条目) {
    const 文 = String(m.text || '')
    const 条 = 切词(文)
    let 共 = 0
    for (const g of 话) if (条.has(g)) 共++
    let 相关 = 话.size ? Math.min(1, 共 / Math.max(3, 话.size * 0.35)) : 0
    if (共 < 2) 相关 = 0   // 只碰上一个二元组就当没碰上

    const at = Date.parse(m.at || m.createdAt || 0) || 0
    const 天 = Math.max(0, (现在 - at) / 86400000)
    const 半衰 = Math.max(1, Number(半衰天) || 14)
    const 新鲜 = Math.exp(-天 / 半衰)
    // 重要 = 基础重要 + 访问加成（ACT-R 那套"越常被想起越重要"），不改存量值
    const 基础重要 = Math.max(0, Math.min(1, Number(m.importance) || 0.4))
    const 访问加成 = Math.log1p(Number(m.hits || 0)) * 访问加成系数
    const 重要 = Math.min(1, 基础重要 + 访问加成)

    let 一致 = 0
    if (m.affect) {
      if (Math.sign(m.affect.P) === Math.sign(P) && Math.abs(P) > 0.15) 一致 += 0.7
      if (Math.sign(m.affect.A) === Math.sign(A) && Math.abs(A) > 0.2) 一致 += 0.3
    }

    // 硬规矩：这一句和这条记忆没一点共同语言，就别想起来
    if (相关 <= 0) continue   // 完全没共同语言就不想起来（心情像也不行）
    const 分 = w新 * 新鲜 + w重 * 重要 + w关 * 相关 + w心 * 一致
    if (分 > 0.2) 命中.push({ 分: Math.round(分 * 100) / 100, 相关: Math.round(相关 * 100) / 100, 条: m, text: 文 })
  }
  命中.sort((a, b) => b.分 - a.分)
  return 命中.slice(0, 上限)
}

// 被想起来一次：记一笔（遗忘时看这个数）
export function 记命中(会话, id) {
  if (!id) return
  const { 原始, 路径 } = 读记忆(会话)
  if (!原始) return
  const 条 = (原始.memories || []).find((m) => m.id === id)
  if (!条) return
  条.hits = Number(条.hits || 0) + 1
  条.lastHit = Date.now()
  try { writeFileSync(路径, JSON.stringify(原始, null, 2), 'utf8') } catch { /* ignore */ }
}

// 再巩固：一条记忆被想起时，用当前状态微调它的指纹。
// 不是覆盖 —— 编码时的词保留（那是"当时"），另记 lastMood（"最近想起时"）。
export function 再巩固(会话, id, 当前, { 系数 = 0.15 } = {}) {
  if (!id) return false
  const { 原始, 路径 } = 读记忆(会话)
  if (!原始) return false
  const 条 = (原始.memories || []).find((m) => m.id === id)
  if (!条 || !条.affect) return false
  const a = 条.affect
  const 混 = (旧, 新) => {
    const o = Number(旧) || 0
    const n = Number(新) || 0
    return Math.round((o + (n - o) * 系数) * 1000) / 1000
  }
  条.affect = {
    ...a,
    P: 混(a.P, 当前 && 当前.P),
    A: 混(a.A, 当前 && 当前.A),
    D: 混(a.D, 当前 && 当前.D),
    显著性: Math.min(1, Math.max(0.15, (Math.abs(混(a.A, 当前 && 当前.A)) + Math.abs(混(a.P, 当前 && 当前.P))) / 2)),
    lastMood: String((当前 && 当前.词) || a.词 || ''),
    lastRecallAt: Date.now(),
  }
  try { writeFileSync(路径, JSON.stringify(原始, null, 2), 'utf8') } catch { return false }
  return true
}

// 遗忘：把很久没被想起、又不重要的条挪到 deleted（可恢复，不物理删）
// 规则：超过 保留天 天 且 从没被想起 且 重要度 < 阈值
export function 遗忘(会话, { 保留天 = 180, 重要阈值 = 0.6 } = {}) {
  const { 原始, 路径 } = 读记忆(会话)
  if (!原始 || !Array.isArray(原始.memories)) return { 移走: 0 }
  原始.deleted = Array.isArray(原始.deleted) ? 原始.deleted : []
  const 现在 = Date.now()
  const 留下 = []
  let 移走 = 0
  for (const m of 原始.memories) {
    const at = Date.parse(m.at || m.createdAt || 0) || 0
    const 天 = Math.max(0, (现在 - at) / 86400000)
    const 想起过 = Number(m.hits || 0) > 0
    const 重要 = Number(m.importance) || 0
    if (天 >= 保留天 && !想起过 && 重要 < 重要阈值) {
      原始.deleted.push({ id: m.id, text: m.text, at: m.at, importance: 重要, deletedAt: 现在, 原因: '长期没被想起且不重要' })
      移走++
    } else 留下.push(m)
  }
  if (移走) {
    原始.memories = 留下
    try { writeFileSync(路径, JSON.stringify(原始, null, 2), 'utf8') } catch { /* ignore */ }
  }
  return { 移走 }
}

// 一条记忆 → 注入用的一行（带当时心里的底色）
export function 成句(命中) {
  const m = 命中.条
  const a = m.affect
  const 底 = a && a.词 ? `（当时心里：${a.词}）` : ''
  const 文 = String(m.text || '').replace(/\s+/g, ' ').slice(0, 90)
  return `想起一件事：${文}${底}`
}
