import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// 往 fish-memory 的会话文件里追加一条记忆（保持"只有一份记录"）
export function 追加记忆(会话, { text, importance = 0.5, tags = [], affect = null, 来源 = '情绪记忆' }) {
  const id = String(会话 || '').trim().replace(/^session-/, '')
  if (!id || !text) return null
  const f = join(homedir(), '.dsh', 'fish-memory', `session-${id}.json`)
  let j = { version: 2, policy: {}, memories: [], traces: [], deleted: [] }
  try { if (existsSync(f)) j = JSON.parse(readFileSync(f, 'utf8')) } catch { /* 文件坏了就重开一个 */ }
  j.memories = Array.isArray(j.memories) ? j.memories : []
  const 现在 = new Date().toISOString()
  const 条 = {
    id: 'em' + randomUUID().slice(0, 10),
    text: String(text).slice(0, 300),
    at: 现在,
    createdAt: 现在,
    category: 'event',
    hits: 0,
    lastHit: null,
    importance: Math.max(0, Math.min(1, Number(importance) || 0.5)),
    emotion: null,
    tags: Array.isArray(tags) ? tags.slice(0, 6) : [],
    source: 来源,
    related: [],
    affect: affect
      ? { P: Number(affect.P) || 0, A: Number(affect.A) || 0, D: Number(affect.D) || 0, 词: String(affect.词 || ''), 显著性: Math.min(1, Math.round(100 * Math.max(0.15, (Math.abs(Number(affect.A) || 0) + Math.abs(Number(affect.P) || 0)) / 2)) / 100), at: Date.now() }
      : null,
  }
  j.memories.push(条)
  writeFileSync(f, JSON.stringify(j, null, 2), 'utf8')
  return 条
}
