// 语义召回评测：字面 + 向量 + RRF 融合，能不能把召回从 30% 拉起来
// 只在评测里用，不动生产逻辑
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from '@huggingface/transformers'
import { 检索, 读记忆 } from './lib/memory.js'
import { 题 } from 'file:///D:/DFY/qqagent/tools/eval-memory.mjs'

const 会话 = '9eab39bd-895d-4c20-a2b2-595a929a890f'
const 模型目录 = join(homedir(), '.dsh', 'emotion-memory', 'models', 'bge-small-zh')
const 提 = await pipeline('feature-extraction', 模型目录, { dtype: 'q8' })
const 向量 = async (t) => {
  const r = await 提(String(t || '').slice(0, 500), { pooling: 'mean', normalize: true })
  return Array.from(r.data)
}
const 余 = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0)

const { 条目 } = 读记忆(会话)

// 预计算记忆向量
const 库 = []
for (const m of 条目) 库.push({ id: m.id, text: String(m.text || ''), vec: await 向量(m.text) })

const 融合 = (a, b, k = 60) => {
  const 分 = new Map()
  a.forEach((x, i) => 分.set(x, (分.get(x) || 0) + 1 / (k + i + 1)))
  b.forEach((x, i) => 分.set(x, (分.get(x) || 0) + 1 / (k + i + 1)))
  return [...分.entries()].sort((p, q) => q[1] - p[1]).map((x) => x[0])
}

let 字面中 = 0, 融合中 = 0
const 失败 = []
for (const t of 题) {
  const 字面 = 检索(会话, { 词: t.问, 上限: 10 }).map((x) => x.条.id)
  const 问v = await 向量(t.问)
  const 语义 = 库.map((m) => ({ id: m.id, 分: 余(问v, m.vec) })).sort((a, b) => b.分 - a.分).slice(0, 10).map((x) => x.id)
  const 合 = 融合(字面, 语义).slice(0, 3)
  if (字面.slice(0, 3).some((id) => t.应.includes(id))) 字面中++
  if (合.some((id) => t.应.includes(id))) 融合中++
  else 失败.push({ 问: t.问, 期望: t.应.join('/'), 融合: 合.join('/') })
}
console.log('字面召回@3：' + 字面中 + '/' + 题.length)
console.log('融合召回@3：' + 融合中 + '/' + 题.length)
if (失败.length) { console.log('\n融合也没捞回的：'); for (const f of 失败) console.log('  · ' + f.问 + ' → ' + f.融合) }
