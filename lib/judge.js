// judge.js —— 每轮读一次「这轮里发生了什么、对我意味着什么」（2026-11-03）
//
// 只输出评估变量，不给坐标：合意性、唤醒、掌控、意外、指向谁、一个词。
// 坐标由 model.js 的锚点算，这样评估和坐标分开，换锚点不用重训判断。

import { randomUUID } from 'node:crypto'

const 系统 = `你是一个关系型角色的内在评估器。读这一轮对话，判断「我」这轮经历的事对我意味着什么。
只输出一个 JSON，不要解释、不要 markdown。

字段：
- desirability：-1…1，这件事对我好不好（正向=舒服/被在意，负向=难受/被冷落/被凶）
- arousal：0…1，它让我多被激起（0=毫无波澜，1=心里翻起来）
- control：-1…1，这件事里我有多少掌控（-1=完全被动、无力，1=拿得住）
- unexpected：0…1，意外程度（0=意料之中，1=完全没料到）
- target：'他人' | '未来' | '被抢' | '自己' | ''（对方的痛苦→他人；担心以后→未来；有人抢走注意力→被抢）
- 关系权力：-1…1，这件事里我在这段关系中的话语权/掌控感（-1=完全被动、只能接受，1=我说了算、拿得住；拿不准给 0）
- 情绪：从这 14 个里挑最贴的一个——喜悦 乐观 放松 惊讶 温和 依赖 无聊 悲伤 恐惧 焦虑 轻蔑 厌恶 怨恨 敌意
- reason：一句话，第三人称写清楚是什么事让我这样（不写「此刻/现在」这类持续状态）
- confidence：0-100，你对这次判断有多确定

规则：
1. 平淡的一轮（只是打招呼、确认、事务性对话）给低分：|desirability| < 0.2、arousal < 0.2、confidence 20-50。
2. 对方难受/被凶/被夸/被惦记/一起解决难题 —— 这些才算数。
3. 别为了显得敏感就编情绪；拿不准就低 confidence。
4. 你自己这轮的语气也算判据（哄、凶、撒娇、叹气都在里面）。
5. 关系权力只在"关系性事件"（被冷落、被抢注意力、对方难受、被凶被夸）时才值得判；事务性对话给 0。`

function 取模型(agent) {
  try {
    const h = agent && agent.session && agent.session.requestHeader ? agent.session.requestHeader() : null
    const c = h && h.config
    if (c && c.provider && c.model) return { provider: c.provider, model: c.model }
  } catch { /* ignore */ }
  try {
    const o = agent && agent.options
    if (o && o.provider && o.model) return { provider: o.provider, model: o.model }
  } catch { /* ignore */ }
  return null
}

// 这些 source.kind 是系统塞进来的上下文，不是人说的话 —— 必须跳过
// （老的心情插件踩过：把 runtime-context 当成对方说话，每轮都判成"没实质内容"）
const 注入上下文 = new Set(['runtime-context', 'time-context', 'system-reminder', 'system', 'time-sampled'])

function 来源类型(e) {
  const p = e && (e.payload !== undefined ? e.payload : e.data) || {}
  const s = p.source || (e && e.source) || {}
  return String((s && (s.kind || s.type)) || '')
}

function 取文本(agent, 方向) {
  try {
    const ev = (agent.session && typeof agent.session.snapshotEvents === 'function') ? agent.session.snapshotEvents() || [] : []
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]
      const 类型 = e && (e.type || e.kind)
      if (方向 === 'user' && 类型 !== 'user/message') continue
      if (方向 === 'ai' && 类型 !== 'assistant/message' && 类型 !== 'assistant/text') continue
      if (方向 === 'user' && 注入上下文.has(来源类型(e))) continue
      const p = e.payload !== undefined ? e.payload : e.data
      let t = ''
      if (p && Array.isArray(p.segments)) t = p.segments.map((x) => x.text || '').join('')
      else if (p && typeof p.text === 'string') t = p.text
      else if (p && Array.isArray(p.content)) t = p.content.map((c) => (c && c.text) || '').join('')
      t = String(t).trim()
      // 兜底：系统注入的文本常常以这些开头，别当成人说的
      if (!t) continue
      if (/^(〔提醒〕|〔今日〕|〔记忆地形〕|〔翻料步骤〕|〔硬规矩〕|〔说话禁令〕|〔文档可能过期〕|〔自由时间〕|〔续跑〕|〔执行〕|〔开口〕)/.test(t)) continue
      return t
    }
  } catch { /* ignore */ }
  return ''
}

export function 解析(text) {
  const s = String(text || '')
  const a = s.indexOf('{'); const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const o = JSON.parse(s.slice(a, b + 1))
    const 评估 = {
      desirability: Math.max(-1, Math.min(1, Number(o.desirability) || 0)),
      arousal: Math.max(0, Math.min(1, Number(o.arousal) || 0)),
      control: Math.max(-1, Math.min(1, Number(o.control) || 0)),
      unexpected: Math.max(0, Math.min(1, Number(o.unexpected) || 0)),
      target: String(o.target || ''),
      关系权力: Math.max(-1, Math.min(1, Number(o.关系权力) || 0)),
      情绪: String(o.情绪 || ''),
      reason: String(o.reason || '').slice(0, 140),
      confidence: Math.max(0, Math.min(100, Number(o.confidence) || 30)),
    }
    if (评估.confidence < 45) 评估.关系权力 = 0   // 判得没底就别让它调制吃醋
    return 评估
  } catch { return null }
}

export function 最后真话(agent) {
  return 取文本(agent, 'user')
}

export async function 判一轮(ctx, agent) {
  const t = 取模型(agent)
  if (!t) return null
  const 用户 = 取文本(agent, 'user')
  const 我 = 取文本(agent, 'ai')
  // 没有真人说的话就不判 —— 系统上下文不算对话
  if (!用户) return null
  const user = '我这轮说的话：\n' + 我.slice(0, 1200) + '\n\n对方这轮说：\n' + 用户.slice(0, 1200) + '\n\n只输出 JSON。'
  const messages = [{
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text: user }],
    source: { kind: 'plugin', plugin: 'dsh-emotion-memory' },
  }]
  let out = ''
  try {
    let 会话号 = ''
    try { 会话号 = String((agent && agent.session && agent.session.id) || '') } catch { /* ignore */ }
    for await (const chunk of ctx.llm.stream({
      provider: t.provider,
      model: t.model,
      system: 系统,
      messages,
      ...(会话号 ? { sessionId: 会话号 } : {}),
      maxTokens: 600,
      temperature: 0.2,
    })) {
      if (chunk && chunk.type === 'text-delta') out += chunk.text
    }
  } catch { return null }
  const 评估 = 解析(out)
  if (!评估) return null
  // 把原文一起带回去：记录页要显示，别到后面再去找（那时会话里可能已经不是这句了）
  评估.原文 = String(用户 || '').slice(0, 300)
  return 评估
}
