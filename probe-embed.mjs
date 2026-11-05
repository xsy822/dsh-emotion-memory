// 试探：本地小模型能不能跑、同义句余弦是否真高
import { pipeline } from '@huggingface/transformers'

const 模型名 = process.env.EMB_MODEL || 'C:/Users/xiaoshiyan/.dsh/emotion-memory/models/bge-small-zh'
console.log('加载模型 ' + 模型名 + ' …')
const 提 = await pipeline('feature-extraction', 模型名, { dtype: 'q8' })
console.log('模型就绪')

const 句 = [
  'ta 报了个班备考考编，白天要学习',
  '我准备公务员考试，白天在学',
  '今天晚饭吃的是干锅土豆',
]
const 出 = []
for (const s of 句) {
  const r = await 提(s, { pooling: 'mean', normalize: true })
  出.push(Array.from(r.data))
}
const 余 = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0)
console.log('同义句（考编 vs 公务员）：' + 余(出[0], 出[1]).toFixed(3))
console.log('无关句（考编 vs 晚饭）：' + 余(出[0], 出[2]).toFixed(3))
console.log('维度 ' + 出[0].length)
