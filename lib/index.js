// dsh-emotion-memory —— 情绪记忆模型 0.1（2026-11-03）
//
// 把「心情」和「记忆」并成一件事：
//   · 情绪：PAD 三轴 + 中科院 14 通道（model.js），精力单独一维；
//   · 记忆：条目落在 fish-memory 的会话 JSON 里，每条补一个「情感指纹」——写的时候心里什么样；
//   · 注入分两块：
//       ① 每轮：心里…（PAD + 精力），它是底色；
//       ② 带条件：只有当这轮的话命中某条旧记忆（且分数够）才冒一句「想起一件事：…（当时心里：…）」。
//
// 0.1 只做「皮层」：不动 fish-memory 的捕获与工具，读它的库、给它盖章、统一注入。
// 下一版再把捕获逻辑并进来，插件名里的"0.1"就是为这个留的。

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { 空状态, 注入 as 情绪注入, 回落 as 情绪回落, 状态行, 基线 } from './model.js'
import { tickEnergy } from './axes.js'
import { 检索, 检索融合, 向量, 补向量, 成句, 盖章, 读记忆, 记命中, 再巩固, 遗忘, 建记忆文件 } from './memory.js'
import { 判一轮, 最后真话, 行动结果, 合并评估 } from './judge.js'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'

function 根插件目录() {
  try { return fileURLToPath(new URL('..', import.meta.url)) } catch { return 'D:/DFY/qqagent/tools/plugins/dsh-emotion-memory' }
}

// 话 → 向量：每轮结束预先算好，注入时要同步用（text() 不能 await）
const 向量缓存 = {}
import { 追加记忆 } from './store.js'
import { loadHostDeps } from './hostdeps.mjs'

const hostDeps = await loadHostDeps()
const defineTool = hostDeps.defineTool

const 家 = join(homedir(), '.dsh')
const 目录 = join(家, 'emotion-memory')
const 状态文件 = join(目录, 'state.json')
const 目录在家 = () => 目录

export const inject = ['systemPrompt', 'agents', 'llm', 'webServer']

const 默认配置 = {
  注入: true,            // 每轮那句
  记忆注入: true,        // 条件回忆
  记忆门槛: 0.45,
  向量检索: true,        // 语义这一路；关掉只走字面（模型没装也自动退回字面）
  重复间隔分钟: 10,     // 同一条记忆多久内不重复冒
  每天记忆上限: 0,      // 0 = 不限（靠去重间隔防刷屏）
  一次想起几条: 1,      // 一轮里最多送几条记忆
  派生阈值: 0.35,       // 派生情绪超过这个值才在注入里补一句
  半衰期天: 14,         // 记忆新鲜度的半衰期（天）
  权重新鲜: 0.20,       // 检索打分：新鲜度
  权重重要: 0.15,       // 检索打分：重要性
  权重相关: 0.60,       // 检索打分：字面相关
  权重心境: 0.05,       // 检索打分：心境一致
  访问加成: 0.08,       // 每次被想起，重要性临时加多少
  遗忘天数: 180,        // 超过这么多天、没被想起、又不重要的，移进"已遗忘"
  遗忘重要阈值: 0.6,    // 重要度高于这个就不忘
  精力初值: 80,
  // 绑定：跟前两个插件一个意思 —— '全部' 或 '指定' 某一个会话
  绑定模式: '全部',   // '全部' | '指定'
  绑定会话: [],       // 绑定模式='指定' 时生效：可以绑多个会话
  // 心情动力学参数（2026-11-03 起可调）
  基线P: 0.15, 基线A: -0.1, 基线D: 0,
  弛豫P: 0.15, 弛豫A: 0.35, 弛豫D: 0.2,   // 每 5 分钟一轮的回落比例
  强度衰减: 0.3,                            // 14 个通道每轮衰减
  读出阈值: 0.12,                           // 超过这个比例才进混合
  精力每小时掉: 3,                          // 醒着
  睡眠回复: 45,                             // 跨夜一觉
  闲置回复: 4,                              // 闲置一小时以上，每小时回多少
  小憩回复: 2,                              // 闲置半小时到一小时
  每轮扣: 2,                                // 聊一轮
}

// 模块级：apply 里会把真实配置挂上来，模块函数（走时钟等）用这个
let 运行配置 = { ...默认配置 }

function 读配置() {
  try { return { ...默认配置, ...JSON.parse(readFileSync(join(目录, 'config.json'), 'utf8')) } } catch { return { ...默认配置 } }
}
function 写配置(c) { mkdirSync(目录, { recursive: true }); writeFileSync(join(目录, 'config.json'), JSON.stringify(c, null, 2), 'utf8') }

function 读状态() {
  try { return JSON.parse(readFileSync(状态文件, 'utf8')) } catch { return { sessions: {} } }
}
function 写状态(j) { mkdirSync(目录, { recursive: true }); writeFileSync(状态文件, JSON.stringify(j, null, 2), 'utf8') }

const 会话键 = (v) => String(v == null ? '' : v).trim().replace(/^session-/, '')

// 每次读盘、只写自己那一份 —— 别整份覆盖（否则会把别的进程/迁移写进去的东西抹掉）
function 读一份(key) {
  const j = 读状态()
  return 取状态(j, key)
}
function 存一份(key, s) {
  const j = 读状态()
  j.sessions = j.sessions || {}
  j.sessions[key] = s
  writeFileSync(状态文件, JSON.stringify(j, null, 2), 'utf8')
}

function 取状态(j, key) {
  j.sessions = j.sessions || {}
  const s = j.sessions[key] || (j.sessions[key] = {})
  if (!s.pad || !s.pad.e) s.pad = 空状态()
  s.energy = Number.isFinite(Number(s.energy)) ? Number(s.energy) : (Number(运行配置.精力初值) || 80)
  s.energyAt = Number(s.energyAt) || Date.now()
  s.said = Array.isArray(s.said) ? s.said : []
  return s
}

// 每 5 分钟算一轮的回落
function 走时钟(s) {
  const now = Date.now()
  const 分钟 = Math.max(0, (now - Number(s.padAt || now)) / 60000)
  if (分钟 >= 5) {
    s.pad = 情绪回落(s.pad, Math.min(12, 分钟 / 5), { P: 运行配置.弛豫P, A: 运行配置.弛豫A, D: 运行配置.弛豫D }, Number(运行配置.强度衰减) || 0.3)
    s.padAt = now
  }
  tickEnergy(s, now, {
    每小时掉: Number(运行配置.精力每小时掉) || 3,
    睡眠回复: Number(运行配置.睡眠回复) || 45,
    闲置回复: Number(运行配置.闲置回复) || 4,
    小憩回复: Number(运行配置.小憩回复) || 2,
    初值: Number(运行配置.精力初值) || 80,
  })
  s.energyAt = now
}

// 拿到这一轮真人说的话（跟心情插件同一套事件）
// 设置页该看哪一份状态：绑定了就按绑定，没绑定就挑"记录最多"的那份 ——
// 以前挑"最近活跃"的，去别的会话跑一轮，页面就切到那份空记录上，看起来像丢了。
function 选会话(参) {
  const 指定 = 会话键(参)
  if (指定) return 指定
  if (运行配置.绑定模式 === '指定' && 运行配置.绑定会话) {
    const 列 = Array.isArray(运行配置.绑定会话) ? 运行配置.绑定会话 : [运行配置.绑定会话]
    if (列.length) return 会话键(列[0])
  }
  const j = 读状态()
  let 最好 = ''
  let 最多 = -1
  for (const [k, v] of Object.entries(j.sessions || {})) {
    const n = ((v && v.history) || []).length + ((v && v.recalls) || []).length
    if (n > 最多) { 最多 = n; 最好 = k }
  }
  return 最好 || 'default'
}

export function apply(ctx) {
  // diag.log 别无限长：启动时超过 1MB 就轮转一份
  try {
    const 日志 = join(目录, 'diag.log')
    if (existsSync(日志) && statSync(日志).size > 1024 * 1024) {
      try { renameSync(日志, 日志 + '.1') } catch { /* 改名失败就算了 */ }
    }
  } catch { /* ignore */ }

  const 模块级 = { 索引缓存: null }
const 工具已挂 = new Set()   // 会话 id → 已经挂过 remember（放 apply 里，重载时会重置）
  const 配置 = 读配置()
  运行配置 = 配置

  // 给自己留个手动接口：其他脚本/插件可以调它盖情感指纹
  // 每轮结束：判一次「这轮对我意味着什么」→ 注入 PAD → 给最新记忆盖情感快照
  let 排队 = Promise.resolve()
  const 待落盘 = []   // 注入时只读不写，这里攒着，交给每轮处理落盘
  const 最近给过 = new Map()
  const 最近想起 = new Map()   // key → { text, 分, at } 这一轮想起了哪条
  const 本轮结果 = new Map()   // key → { 话, 结果 } 同一句话重复问就直接给上次的结果   // 记忆 id → 时间（十分钟内不重复冒）
  // 给每个 agent 挂注入
  const 挂钩 = () => {
    const list = (ctx.agents && ctx.agents.list) ? ctx.agents.list() : []
    for (const agent of list) {
      if (!agent || !agent.ctx || !agent.ctx.systemPrompt) continue
      if (agent.__情绪记忆挂过) continue
      agent.__情绪记忆挂过 = true
      const key = 会话键(agent.session && (agent.session.id || agent.session.sessionId || agent.session.key)) || 'default'
      try { appendFileSync(join(目录, 'diag.log'), new Date().toISOString() + ' 挂 key=' + key + ' 字段=' + Object.keys(agent.session || {}).join(',') + '\n') } catch { /* 写不进去就算 */ }

      // remember 工具（按会话挂，跟原来的语义一致：一条只装一件事）
      if (!工具已挂.has(key) && defineTool) {
        工具已挂.add(key)
        try {
          agent.ctx.tools.register(defineTool({
            name: 'remember',
            description:
              '把一件事记进长期记忆（以后每轮都可能想起来）。' +
              '一条只装一件事：一个属性、一个约定、一次事件。' +
              '只记长期有价值的事：对方明确说的重要的话、约定、喜好、状态；不记日常琐事，也不记我自己做过的事。' +
              '记的时候安静地记，不要在回复里说「记下了」。',
            parameters: {
              text: { type: 'string', required: true, description: '要记住的事，一句话说清。人称：我自己是「我」，对方是「ta」。' },
              importance: { type: 'number', description: '0 = 随口提过；0.5 = 比较重要；1 = 非常重要。不确定就写 0.5' },
              tags: { type: 'array', items: { type: 'string' }, description: '几个关键词，方便以后想起来' },
            },
            output: {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
              },
              render(_a, v) {
                return [{ type: 'text', text: (v && v.ok === false) ? '✗ ' + String(v.message || '没记住') : '✓' }]
              },
            },
            async execute(args) {
              const 文 = String((args && args.text) || '').trim()
              if (!文) return { ok: false, message: '内容是空的' }
              try {
                const s0 = 读一份(key)
                追加记忆(key, {
                  text: 文,
                  importance: Number(args && args.importance) || 0.5,
                  tags: Array.isArray(args && args.tags) ? args.tags : [],
                  affect: { ...s0.pad.e, 词: s0.pad.词 },
                  来源: '我记的',
                })
                return { ok: true, message: '记下了' }
              } catch (e) {
                return { ok: false, message: (e && e.message) || '写失败' }
              }
            },
          }))
        } catch { /* 挂不上就算了，自动记忆还在 */ }
      }

      // 这轮结束 → 判一轮（老插件就是挂在 agent.ctx 上，挂根上根本不会触发）
      const 行动指针 = {}
      try {
        agent.ctx.on('agent/turn-stopping', () => {
          排队 = 排队.then(async () => {
            try {
              const s = 读一份(key)
              走时钟(s)
              const 前pad = { ...s.pad.e }
              const 这一句 = (最后真话(agent) || '')
              if (这一句 && !向量缓存[这一句]) 向量(这一句).then((v) => { if (v) 向量缓存[这一句] = v }).catch(() => {})
              if (!向量缓存.__补过) { 向量缓存.__补过 = true; 补向量(key, 20).catch(() => {}) }
              const 想起来的 = 最近想起.get(key) || null
              const 说者 = 开着的() ? await 判一轮(ctx, agent) : null
              let 行者 = null
              try { 行者 = 行动结果(agent, 行动指针[key] = 行动指针[key] || { i: 0 }) } catch { 行者 = null }
              const 评估 = 合并评估(说者, 行者)
              s.history = Array.isArray(s.history) ? s.history : []
              if (!评估) {
                s.history.push({
                  at: Date.now(),
                  理由: 这一句 ? '（判失败：模型没给出可用结果）' : '（这轮没有真人说话，跳过判定）',
                  置信: 0,
                  评估: { 愿: 0, 激: 0, 控: 0, 意外: 0, 指向: '', 词: '' },
                  pad: { ...s.pad.e }, 词: s.pad.词, 精力: Math.round(Number(s.energy) || 0),
                  原文: String(这一句 || '').slice(0, 200),
                  想起: 想起来的
                    ? { 命中: Boolean(想起来的.命中), 原因: 想起来的.原因 || '', 候选: (想起来的.候选 || []).map((c) => ({ 分: Math.round(Number(c.分) * 100) / 100, text: String(c.text || '').slice(0, 60), 命中: Boolean(c.命中) })) }
                    : null,
                })
              } else if (评估.confidence >= 20) {
                s.pad = 情绪注入(s.pad, 评估, { 基线: { P: 配置.基线P, A: 配置.基线A, D: 配置.基线D }, 读出阈值: 配置.读出阈值 })
                s.padAt = Date.now()
                s.lastReason = 评估.reason
                s.lastConfidence = 评估.confidence
                s.history.push({
                  at: Date.now(), 理由: 评估.reason, 置信: 评估.confidence,
                  评估: { 愿: 评估.desirability, 激: 评估.arousal, 控: 评估.control, 意外: 评估.unexpected, 指向: 评估.target, 词: 评估.情绪, 关系权力: Number(评估.关系权力) || 0 },
                  pad: { ...s.pad.e }, 前pad, 词: s.pad.词, 精力: Math.round(Number(s.energy) || 0),
                  原文: String((评估 && 评估.原文) || 这一句 || '').slice(0, 200),
                  想起: 想起来的
                    ? {
                        命中: Boolean(想起来的.命中),
                        text: 想起来的.text ? String(想起来的.text).slice(0, 160) : '',
                        分: 想起来的.分,
                        原因: 想起来的.原因 || '',
                         候选: (想起来的.候选 || []).map((c) => ({
                          分: Math.round(Number(c.分) * 100) / 100,
                          text: String(c.text || '').slice(0, 60),
                          命中: Boolean(c.命中),
                        })),
                      }
                    : null,
                })
                try {
                  const 分量 = Math.abs(Number(评估.desirability) || 0)
                  if (评估.confidence >= 45 && 分量 >= 0.35 && 评估.reason) {
                    追加记忆(key, {
                      text: 评估.reason,
                      importance: Math.min(1, 分量 * (评估.confidence / 100)),
                      tags: 评估.情绪 ? [评估.情绪] : [],
                      affect: { ...s.pad.e, 词: s.pad.词 },
                    })
                  }
                } catch { /* 写记忆失败不影响心情 */ }
              } else {
                s.history.push({
                  at: Date.now(), 理由: 评估.reason || '（判得很淡）', 置信: 评估.confidence,
                  评估: { 愿: 评估.desirability, 激: 评估.arousal, 控: 评估.control, 意外: 评估.unexpected, 指向: 评估.target, 词: 评估.情绪, 关系权力: Number(评估.关系权力) || 0 },
                  pad: { ...s.pad.e }, 前pad, 词: s.pad.词, 精力: Math.round(Number(s.energy) || 0),
                  原文: String((评估 && 评估.原文) || 这一句 || '').slice(0, 200),
                  想起: 想起来的
                    ? { 命中: Boolean(想起来的.命中), 原因: 想起来的.原因 || '', 候选: (想起来的.候选 || []).map((c) => ({ 分: Math.round(Number(c.分) * 100) / 100, text: String(c.text || '').slice(0, 60), 命中: Boolean(c.命中) })) }
                    : null,
                })
              }
              // 每聊一轮扣一点精力
              try {
                const 扣 = Number(配置.每轮扣) || 0
                if (扣 > 0) s.energy = Math.max(0, Math.round(Number(s.energy || 0) - 扣))
              } catch { /* ignore */ }
              // 每天跑一次遗忘（把很久没想起、又不重要的挪进"已遗忘"）
              try {
                const 今天 = new Date().toISOString().slice(0, 10)
                if (s.遗忘跑过 !== 今天) {
                  s.遗忘跑过 = 今天
                  const r = 遗忘(key, { 保留天: Number(配置.遗忘天数) || 180, 重要阈值: Number(配置.遗忘重要阈值) || 0.6 })
                  if (r && r.移走) {
                    try { appendFileSync(join(目录, 'diag.log'), new Date().toISOString() + ' 遗忘 ' + r.移走 + ' 条（' + key + '）\n') } catch { /* ignore */ }
                  }
                }
              } catch { /* ignore */ }
              s.history = s.history.slice(-200)
              try {
                const { 条目 } = 读记忆(key)
                const 无指纹 = 条目.filter((m) => !m.affect).slice(-3)
                for (const m of 无指纹) 盖章(key, m.id, { ...s.pad.e, 词: s.pad.词 })
              } catch { /* ignore */ }
              // 把注入时攒下的回忆记录落盘
              try {
                for (let i = 待落盘.length - 1; i >= 0; i--) {
                  const x = 待落盘[i]
                  if (x.key !== key) continue
                  s.said = [...(s.said || []), Date.now()].slice(-200)
                  s.recalls = Array.isArray(s.recalls) ? s.recalls : []
                  if (x.记录) {
                    s.recalls.push({
                      at: x.at || Date.now(), 记录: true, 命中: Boolean(x.命中), 说明: x.说明 || '', 话: x.话 || '',
                      候选: (x.候选 || []).slice(0, 3).map((c) => ({ 分: Math.round(Number(c.分) * 100) / 100, text: String(c.text || '').slice(0, 50) })),
                    })
                  } else {
                    s.recalls.push({ at: Date.now(), id: x.键, 分: Math.round(x.分 * 100) / 100, text: String(x.text || '').slice(0, 120), 词: (s.pad && s.pad.词) || '' })
                    // 被想起 → 用"这轮结束后的状态"微调它的指纹（不是注入时的状态）
                    try { 再巩固(key, x.id, { ...s.pad.e, 词: s.pad.词 }) } catch { /* ignore */ }
                  }
                  s.recalls = s.recalls.slice(-100)
                  待落盘.splice(i, 1)
                }
              } catch { /* ignore */ }
              存一份(key, s)
            } catch (err) {
              try { appendFileSync(join(目录, 'diag.log'), new Date().toISOString() + ' 每轮处理失败：' + (err && err.message) + '\n') } catch { /* ignore */ }
            }
          })
        })
      } catch { /* 挂不上就算了 */ }


      // ① 每轮：心里什么样
      const 开着的 = () => {
        if (配置.绑定模式 !== '指定') return true
        const 列 = Array.isArray(配置.绑定会话) ? 配置.绑定会话 : (配置.绑定会话 ? [配置.绑定会话] : [])
        return 列.map(会话键).includes(key)
      }
      agent.ctx.systemPrompt.context({
        name: 'emotion-memory-mood',
        order: 900,
        text: () => {
          try {
            if (!配置.注入 || !开着的()) return ''
            try { appendFileSync(join(目录, 'diag.log'), new Date().toISOString() + ' 注入计算 key=' + key + ' 开着=' + 开着的() + '\n') } catch (e) { /* ignore */ }
            const s = 读一份(key)
            走时钟(s)          // 纯计算，不落盘
            // 回忆并在同一句里给它 —— 分成两个 context 时，DSH 有时不把第二条送进去
            let 想起 = ''
            const 话 = 最后真话(agent)
            const 缓存 = 本轮结果.get(key)
            if (缓存 && 缓存.话 === 话) return 缓存.结果
            try {
              if (话 && 话.length >= 2 && 配置.记忆注入) {
                const 今天0点 = new Date(); 今天0点.setHours(0, 0, 0, 0)
                const 今天说过 = (s.said || []).filter((t) => t >= 今天0点.getTime()).length
                const 上限 = Number(配置.每天记忆上限)
                if (!(上限 > 0 && 今天说过 >= 上限)) {
                  const 想几条 = Math.max(1, Math.min(5, Number(配置.一次想起几条) || 1))
                  const 候选 = 检索融合(key, { 词: 话, P: s.pad.e.P, A: s.pad.e.A, 上限: 想几条 + 3, 半衰天: Number(配置.半衰期天) || 14, 权重: { 新鲜: 配置.权重新鲜, 重要: 配置.权重重要, 相关: 配置.权重相关, 心境: 配置.权重心境, 访问加成: 配置.访问加成 } }, 配置.向量检索 === false ? null : (向量缓存[话] || null)).filter((x) => x.分 >= 配置.记忆门槛)
                  if (!候选.length) {
                    const 全部 = 检索融合(key, { 词: 话, P: s.pad.e.P, A: s.pad.e.A, 上限: 想几条 + 3, 半衰天: Number(配置.半衰期天) || 14, 权重: { 新鲜: 配置.权重新鲜, 重要: 配置.权重重要, 相关: 配置.权重相关, 心境: 配置.权重心境, 访问加成: 配置.访问加成 } }, 配置.向量检索 === false ? null : (向量缓存[话] || null))
                    const 原因 = 全部.length ? ('没过门槛 ' + 配置.记忆门槛) : '没有候选（字面没对上）'
                    最近想起.set(key, { 命中: false, 原因, 候选: 全部.slice(0, 2), at: Date.now() })
                  }
                  if (候选.length) {
                    const 间隔 = Math.max(0, Number(配置.重复间隔分钟 ?? 10)) * 60000
                    const 可选 = 候选.filter((c) => {
                      const k = c.条.id || c.text.slice(0, 20)
                      return !(间隔 > 0 && 最近给过.get(k) && Date.now() - 最近给过.get(k) < 间隔)
                    })
                    const 选出 = 可选.slice(0, 想几条)
                    const 选中键 = new Set(选出.map((c) => c.条.id || c.text.slice(0, 20)))
                    if (选出.length) {
                      const 句子 = []
                      for (const c of 选出) {
                        const 键 = c.条.id || c.text.slice(0, 20)
                        最近给过.set(键, Date.now())
                        待落盘.push({ key, 键, id: c.条.id, 分: c.分, text: c.text })
                        try { 记命中(key, c.条.id) } catch { /* ignore */ }
                        句子.push(成句(c))
                      }
                      想起 = 句子.join('\n')
                      最近想起.set(key, {
                        命中: true, at: Date.now(),
                        候选: 候选.slice(0, 想几条 + 2).map((c) => ({
                          分: Math.round(Number(c.分) * 100) / 100,
                          text: String(c.text || '').slice(0, 100),
                          命中: 选中键.has(c.条.id || c.text.slice(0, 20)),
                        })),
                        text: 选出.map((c) => String(c.text || '').slice(0, 100)).join('；'),
                        分: 选出[0] && 选出[0].分,
                      })
                    } else {
                      最近想起.set(key, {
                        命中: false, 原因: '这几条刚给过，跳过', at: Date.now(),
                        候选: 候选.slice(0, 想几条 + 2).map((c) => ({ 分: Math.round(Number(c.分) * 100) / 100, text: String(c.text || '').slice(0, 100), 命中: false })),
                      })
                    }
                  }
                }
              }
            } catch (e) { /* 回忆失败不影响心情 */ }
            let 底子 = ''
            try {
              const 派 = s.pad && s.pad.派生 ? s.pad.派生 : {}
              const 门槛 = Number(配置.派生阈值)
              const 排 = Object.entries(派).filter(([, v]) => Number(v) >= (Number.isFinite(门槛) ? 门槛 : 0.35)).sort((a, b) => b[1] - a[1]).slice(0, 2)
              if (排.length) 底子 = '（底下还压着：' + 排.map(([k, v]) => k + ' ' + Math.round(Number(v) * 100) + '%').join('、') + '）'
            } catch { /* ignore */ }
            // 笔记提示：拿这句话和最近的工具名去匹配 docs-index.json，命中就带一句过去
            let 笔记句 = ''
            try {
              const 索引路径 = process.env.DFY_WORKSPACE ? join(process.env.DFY_WORKSPACE, 'data', 'docs-index.json') : 'D:/DFY/qqagent/data/docs-index.json'
              if (existsSync(索引路径)) {
                const st = statSync(索引路径)
                if (!模块级.索引缓存 || 模块级.索引缓存.at !== st.mtimeMs) {
                  模块级.索引缓存 = { at: st.mtimeMs, 条目: (JSON.parse(readFileSync(索引路径, 'utf8')).条目 || []) }
                }
                const 条目 = 模块级.索引缓存.条目
                const 话词 = new Set(String(话 || '').split(/\s+/).filter((x) => x.length >= 2))
                // 上一轮用过什么工具（粗略）
                let 工具 = ''
                try {
                  const evs = agent.session && typeof agent.session.snapshotEvents === 'function' ? agent.session.snapshotEvents() : []
                  for (let i = evs.length - 1; i >= 0 && i > evs.length - 30; i--) {
                    const e = evs[i]
                    if (e && (e.type === 'tool/call' || e.type === 'tool/result')) {
                      const pp = e.payload || e.data || {}
                      工具 = String(pp.name || pp.tool || pp.toolName || '')
                      if (工具) break
                    }
                  }
                } catch { /* ignore */ }
                let 最优 = null
                let 最优分 = 0
                for (const d of 条目) {
                  const 词表 = String(d.tokens || '')
                  const 场景 = String(d.whenuse || '')
                  let 命中 = 0
                  const 命中词 = []
                  for (const w of 话词) {
                    if (词表.includes(w) || 场景.includes(w)) { 命中++; if (命中词.length < 3) 命中词.push(w) }
                  }
                  let 分 = 命中
                  if (工具 && (词表.includes(工具) || 场景.includes(工具) || String(d.title || '').includes(工具))) 分 += 1
                  if (分 >= 2 && 分 > 最优分) { 最优 = { ...d, 命中词 }; 最优分 = 分 }
                }
                if (最优) {
                  笔记句 = '笔记：《' + 最优.title + '》（' + 最优.path + '）可能相关，因为提到 ' + 最优.命中词.join('、') + '；要用就 q.mjs docs 查它'
                }
              }
            } catch { /* ignore */ }

            const 主句 = 状态行(s.pad, s.energy) + 底子
            const 结果 = [主句, 想起, 笔记句].filter(Boolean).join('\n')
            本轮结果.set(key, { 话, 结果 })
            return 结果
          } catch (e) { try { appendFileSync(join(目录, 'diag.log'), new Date().toISOString() + ' 心境注入失败：' + (e && e.message) + '\n') } catch (e2) { /* ignore */ } ; return '' }
        },
      })

    }
  }

  try { ctx.on('agent/ready', 挂钩) } catch { /* 老内核没这个事件就算了 */ }
  try { ctx.effect(() => { const t = setInterval(挂钩, 3_000); return () => clearInterval(t) }, '情绪记忆：挂载注入') } catch { /* ignore */ }
  挂钩()


  // 配置读写（设置页用）
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/config',
      handler: async (req, res) => {
        let 补 = {}
        try {
          if (req && typeof req.json === 'function') {
            // 新内核给的是标准 Request：body 只能读一次，用 json()
            补 = await req.json()
          } else if (req && typeof req.url === 'string' && !req.on) {
            补 = {}
          } else if (req && typeof req.on === 'function') {
            const raw = await new Promise((resolve) => {
              let buf = ''
              req.on('data', (c) => { buf += c })
              req.on('end', () => resolve(buf))
              req.on('error', () => resolve(''))
            })
            补 = JSON.parse(raw || '{}')
          }
        } catch { 补 = {} }
        let 写错 = ''
        let 收了 = null
        const 收到 = 补 && typeof 补 === 'object' ? Object.keys(补).filter((k) => k !== '') : []
        try {
          const 新配 = 收到.length ? { ...配置, ...补 } : 配置
          收了 = Object.keys(补 || {})
          if (收到.length) writeFileSync(join(目录, 'config.json'), JSON.stringify(新配, null, 2), 'utf8')
          Object.assign(配置, 新配)
          Object.assign(运行配置, 新配)
        } catch (e) { 写错 = (e && e.message) || '写失败' }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, 配置, 收到键: 收了, 写错 }))
      },
    }), '情绪记忆：配置路由')
  } catch { /* ignore */ }

  // 会话列表（绑定用）：只列**现在活着**的会话（ctx.agents），标题从投影缓存补；
  // 不扫全部历史 —— 归档的和子 agent 不该出现在绑定里。
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/sessions',
      handler: async (req, res) => {
        const 条 = []
        const 活 = (ctx.agents && ctx.agents.list) ? ctx.agents.list() : []
        for (const a of 活) {
          const id = 会话键(a && a.session && a.session.id)
          if (!id) continue
          let title = ''
          for (const 名 of [id + '.json', 'session-' + id + '.json']) {
            try {
              const f = join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions', 名)
              const j = JSON.parse(readFileSync(f, 'utf8'))
              const t = j && j.record && j.record.rows && j.record.rows.title
              if (t && t.val) { title = String(t.val); break }
            } catch { /* 换个文件名再试 */ }
          }
          条.push({ id: id, title: title.slice(0, 40) })
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, 条: 条 }))
      },
    }), '情绪记忆：会话列表路由')

  } catch { /* ignore */ }


  // 回忆记录
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/recalls',
      handler: async (req, res) => {
        const u = new URL(req.url, 'http://x')
        const key = 选会话(u.searchParams.get('session'))
        const s = 读一份(key)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, key, 条: (s.recalls || []).slice().reverse() }))
      },
    }), '情绪记忆：回忆记录路由')
  } catch { /* ignore */ }

  // 记忆列表（分页 + 关键词）
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/memories',
      handler: async (req, res) => {
        const u = new URL(req.url, 'http://x')
        const key = 选会话(u.searchParams.get('session'))
        const 词 = String(u.searchParams.get('q') || '')
        const 起 = Math.max(0, Number(u.searchParams.get('offset')) || 0)
        const 数 = Math.min(50, Number(u.searchParams.get('limit')) || 20)
        const { 条目 } = 读记忆(key)
        const 过滤 = 词 ? 条目.filter((m) => String(m.text || '').includes(词) || (m.tags || []).some((t) => String(t).includes(词))) : 条目
        const 总 = 过滤.length
        const 半衰 = Math.max(1, Number(配置.半衰期天) || 14)
        const 现在 = Date.now()
        const 页 = 过滤.slice().reverse().slice(起, 起 + 数).map((m) => {
          const at = Date.parse(m.at || m.createdAt || 0) || 0
          const 天 = Math.max(0, (现在 - at) / 86400000)
          return {
            id: m.id, text: String(m.text || ''), at: m.at || m.createdAt, tags: m.tags || [],
            重要度: Number(m.importance) || 0,
            类别: m.category || '',
            affect: m.affect || null,
            想起次数: Number(m.hits) || 0,
            最近想起: m.lastHit || null,
            年龄天: Math.round(天 * 10) / 10,
            新鲜度: Math.round(Math.exp(-天 / 半衰) * 100) / 100,
          }
        })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, key, 总, 条: 页 }))
      },
    }), '情绪记忆：记忆列表路由')
  } catch { /* ignore */ }

  // 依赖与模型状态（设置页显示用）
  try {
    ctx.effect(() => { try { return ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/api/env',
      handler: (req, res) => {
        let 出 = { ok: true }
        try {
          const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
          const 模型目录 = join(家, 'emotion-memory', 'models', 'bge-small-zh')
          const 有 = (f) => { try { return existsSync(f) } catch { return false } }
          const 依赖 = 有(join(根插件目录(), 'node_modules', '@huggingface', 'transformers')) && 有(join(根插件目录(), 'node_modules', 'onnxruntime-node'))
          const 模型 = 有(join(模型目录, 'onnx', 'model_quantized.onnx')) || 有(join(模型目录, 'onnx', 'model.onnx'))
          出 = { ok: true, 依赖: { 装了: 依赖 }, 模型: { 就绪: 模型, 路径: 模型目录 }, 日志: join(家, 'emotion-memory', 'install.log') }
        } catch (e) { 出 = { ok: false, error: String((e && e.message) || e) } }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(出))
      },
    }) } catch (e2) { /* ignore */ } }, 'emotion-memory: env')
  } catch { /* ignore */ }

  // 安装日志
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/api/env/log',
      handler: (req, res) => {
        let 文本 = ''
        try {
          const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
          const 日志 = join(家, 'emotion-memory', 'install.log')
          const 全 = existsSync(日志) ? readFileSync(日志, 'utf8') : ''
          文本 = 全.length > 20000 ? 全.slice(-20000) : 全
        } catch (e) { 文本 = '读日志失败：' + String((e && e.message) || e) }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, 文本 }))
      },
    }), 'emotion-memory: env 日志')
  } catch { /* ignore */ }

  // 一键装依赖 + 下模型：写固定 ps1 再 -File 跑
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/api/env/install',
      handler: (req, res) => {
        let 出 = { ok: true }
        try {
          const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
          const 目录2 = join(家, 'emotion-memory')
          try { mkdirSync(目录2, { recursive: true }) } catch { /* ignore */ }
          const 日志 = join(目录2, 'install.log')
          const 脚本 = join(目录2, 'install.ps1')
          const 插件 = 根插件目录()
          const 模型 = join(目录2, 'models', 'bge-small-zh')
          try {
            if (existsSync(日志)) {
              const 旧 = readFileSync(日志, 'utf8')
              const m = 旧.match(/== 开始 ==[\s\S]*?(== 完成 ==)?$/)
              const 有完成 = /== 完成 ==/.test(旧)
              if (!有完成 && m && Date.now() - statSync(日志).mtimeMs < 10 * 60000) {
                出 = { ok: false, error: '上一次安装还没结束（日志 10 分钟内）' }
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
                res.end(JSON.stringify(出))
                return
              }
            }
          } catch { /* ignore */ }
          const 行 = [
            '$ErrorActionPreference = "Continue"',
            '$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8',
            '$log = "' + 日志 + '"',
            '"== 开始 ==" | Out-File -FilePath $log -Encoding utf8',
            'Set-Location "' + 插件 + '"',
            '"npm install ..." | Out-File -FilePath $log -Append -Encoding utf8',
            'npm install @huggingface/transformers onnxruntime-node --no-audit --no-fund 2>&1 | Out-File -FilePath $log -Append -Encoding utf8',
            '$d = "' + 模型 + '"',
            'New-Item -ItemType Directory -Force -Path "$d/onnx" | Out-Null',
            '$b = "https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main"',
            'foreach ($f in @("config.json","tokenizer.json","tokenizer_config.json","special_tokens_map.json")) { "下载 $f" | Out-File -FilePath $log -Append -Encoding utf8; curl.exe -sL -o "$d/$f" "$b/$f" }',
            '"下载 model" | Out-File -FilePath $log -Append -Encoding utf8',
            'curl.exe -sL -o "$d/onnx/model_quantized.onnx" "$b/onnx/model_quantized.onnx"',
            '"== 完成 ==" | Out-File -FilePath $log -Append -Encoding utf8',
          ].join(String.fromCharCode(10))
          writeFileSync(脚本, '\uFEFF' + 行, 'utf8')
          try { appendFileSync(日志, '== 已排队 ' + new Date().toLocaleTimeString() + ' ==' + String.fromCharCode(10), 'utf8') } catch { writeFileSync(日志, '== 已排队 ==' + String.fromCharCode(10), 'utf8') }
          // 自己 spawn 的子进程会随 DSH 的作业对象被回收，WMI 在这台机器上又不稳，
          // 改用一次性计划任务：schtasks 建了就跑，进程归任务计划服务管，活得过本次请求
          const 任务名 = 'DFY-EmoInstall'
          // 用 vbs 静默拉起：schtasks 直接跑 powershell 会闪一个黑窗
          const vbs = join(目录2, 'install-hidden.vbs')
          const vbs文 = [
            'Set sh = CreateObject("WScript.Shell")',
            'sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + 脚本 + '""", 0, False',
          ].join(String.fromCharCode(13) + String.fromCharCode(10))
          writeFileSync(vbs, vbs文, 'utf8')
          const 命令 = 'wscript.exe "' + vbs + '"'
          try {
            execFileSync('schtasks', ['/Create', '/TN', 任务名, '/TR', 命令, '/SC', 'ONCE', '/ST', '00:00', '/F'], { windowsHide: true, timeout: 20000 })
            execFileSync('schtasks', ['/Run', '/TN', 任务名], { windowsHide: true, timeout: 20000 })
          } catch (e) { throw new Error('建计划任务失败：' + String((e && e.message) || e)) }
          出 = { ok: true, 日志, 说明: '已开始，进度显示在设置页里' }
        } catch (e) { 出 = { ok: false, error: String((e && e.stack) || e) } }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(出))
      },
    }), 'emotion-memory: env 安装')
  } catch { /* ignore */ }

  // 判定历史
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/timeline',
      handler: async (req, res) => {
        const u = new URL(req.url, 'http://x')
        const key = 选会话(u.searchParams.get('session'))
        const s = 读一份(key)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, key, 条: (s.history || []).slice(-60).reverse() }))
      },
    }), '情绪记忆：历史路由')
  } catch { /* ignore */ }

  // 导出：配置 + 全部会话状态 + 它们的记忆（一个 JSON，够搬家）
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/export',
      handler: async (req, res) => {
        const 只要 = 会话键(new URL(req.url, 'http://x').searchParams.get('session'))
        const j = 读状态()
        const 记忆表 = {}
        const 会话表 = {}
        for (const key of Object.keys(j.sessions || {})) {
          if (只要 && key !== 只要) continue
          try {
            const { 条目 } = 读记忆(key)
            记忆表[key] = 条目
          } catch { /* 单个会话读失败就跳过 */ }
          会话表[key] = j.sessions[key]
        }
        const 出 = { 版本: 1, 导出时间: new Date().toISOString(), 配置, 状态: { sessions: 会话表 }, 记忆: 记忆表 }
        const 文件名 = 'emotion-memory-' + (只要 ? 只要.slice(0, 8) : 'all') + '.json'
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="' + 文件名 + '"' })
        res.end(JSON.stringify(出, null, 2))
      },
    }), '情绪记忆：导出路由')
  } catch { /* ignore */ }

  // 导入：合并配置、替换同名会话状态、把记忆条目并进去（按 id 去重）
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/import',
      handler: async (req, res) => {
        let 打 = {}
        try {
          const raw = await new Promise((resolve) => {
            let b = ''
            req.on('data', (c) => { b += c })
            req.on('end', () => resolve(b))
            req.on('error', () => resolve(''))
          })
          打 = JSON.parse(raw || '{}')
        } catch { 打 = {} }
        const 目标 = 会话键(new URL(req.url, 'http://x').searchParams.get('session'))
        let 导会话 = 0
        let 导记忆 = 0
        try {
          if (打.配置 && typeof 打.配置 === 'object') Object.assign(配置, 打.配置)
          if (打.状态 && 打.状态.sessions) {
            const j = 读状态()
            j.sessions = j.sessions || {}
            for (const [k, v] of Object.entries(打.状态.sessions)) {
              if (目标 && k !== 目标) continue
              j.sessions[k] = v; 导会话++
            }
            writeFileSync(状态文件, JSON.stringify(j, null, 2), 'utf8')
          }
          if (打.记忆 && typeof 打.记忆 === 'object') {
            for (const [k, 列] of Object.entries(打.记忆)) {
              if (!Array.isArray(列)) continue
              if (目标 && k !== 目标) continue
              let { 原始, 路径 } = 读记忆(k)
              if (!原始) {
                const 建 = 建记忆文件(k)
                if (!建) continue
                原始 = 建.原始
                路径 = 建.路径
              }
              原始.memories = Array.isArray(原始.memories) ? 原始.memories : []
              const 有 = new Set(原始.memories.map((m) => m.id))
              for (const m of 列) {
                if (!m || !m.id || 有.has(m.id)) continue
                原始.memories.push(m); 有.add(m.id); 导记忆++
              }
              writeFileSync(路径, JSON.stringify(原始, null, 2), 'utf8')
            }
          }
          writeFileSync(join(目录, 'config.json'), JSON.stringify({ ...配置, 绑定会话: Array.isArray(配置.绑定会话) ? 配置.绑定会话 : (配置.绑定会话 ? [配置.绑定会话] : []) }, null, 2), 'utf8')
        } catch { /* ignore */ }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, 导入会话: 导会话, 导入记忆: 导记忆 }))
      },
    }), '情绪记忆：导入路由')
  } catch { /* ignore */ }

  // 对外 API（给附属插件用，比如认知行为）：只读，返回当前情绪与精力。
  // 附属插件不该去读 state.json —— 那是内部存储，格式会变。
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/api/state',
      handler: (req, res) => {
        try {
          const 问会话 = new URL(req.url, 'http://x').searchParams.get('session') || ''
          const key = 问会话 && existsSync(join(目录, String(问会话).replace(/^session-/, '') + '.json'))
            ? String(问会话).replace(/^session-/, '')
            : 选会话(问会话)
          const s = 读一份(key)
          const 出 = {
            session: key,
            pad: { P: Number(s.pad.e.P), A: Number(s.pad.e.A), D: Number(s.pad.e.D) },
            词: s.pad.词 || '',
            派生: s.pad.派生 || {},
            强度: s.pad.强度 || {},
            energy: Math.round(Number(s.energy) || 0),
            at: Date.now(),
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(出))
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
        }
      },
    }), '情绪记忆：对外 API')
  } catch { /* ignore */ }

  // 网页路由：状态（给设置页/自查用）
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-emotion-memory/state',
      handler: async (req, res) => {
        const key = 选会话(new URL(req.url, 'http://x').searchParams.get('session'))
        const s = 读一份(key || 'default')
        const 记忆 = 检索(key, { 词: '', P: s.pad.e.P, A: s.pad.e.A, 上限: 5, 半衰天: Number(配置.半衰期天) || 14, 权重: { 新鲜: 配置.权重新鲜, 重要: 配置.权重重要, 相关: 配置.权重相关, 心境: 配置.权重心境, 访问加成: 配置.访问加成 } })
        const out = {
          ok: true,
          key,
          pad: s.pad.e,
          混合: s.pad.混合 || [],
          强度: s.pad.强度 || {},
          派生: s.pad.派生 || {},
          energy: s.energy,
          行: 状态行(s.pad, s.energy),
          记忆样例: 记忆.map((m) => ({ 分: Math.round(m.分 * 100) / 100, text: m.text.slice(0, 80), affect: m.条.affect || null })),
          配置,
          绑定模式: 配置.绑定模式,
          绑定会话: 配置.绑定会话,
          绑定列表: Array.isArray(配置.绑定会话) ? 配置.绑定会话 : (配置.绑定会话 ? [配置.绑定会话] : []),
          本会话开着: (配置.绑定模式 !== '指定') || 会话键(配置.绑定会话) === key,
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(out))
      },
    }), '情绪记忆：状态路由')
  } catch { /* ignore */ }

  return {
    // 给外部（脚本/别的插件）用：盖章一条记忆
    盖章: (会话, id, 指纹) => 盖章(会话, id, 指纹),
    状态: () => 读状态(),
    配置: () => 配置,
  }
}
