// axes.js —— 精力（2026-11-03 整理）
//
// 这里原先还放着 valence/arousal 那一套（0–100 的旧心情模型），
// 后来心情换成 model.js 的 PAD 三轴（−1…1），那批函数就没人用了，整理时删掉，
// 只留下真正被用到的精力。
//
// 规则：醒着按小时掉，跨过凌晨睡一觉回血；每聊一轮另扣（扣的动作在 index.js）。

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

export function tickEnergy(s, now, { 每小时掉 = 3, 睡眠回复 = 45, 初值 = 80 } = {}) {
  const 上次 = Number(s.energyAt || now)
  const 小时 = Math.max(0, (now - 上次) / 3600000)
  if (!小时) return s
  let 值 = clamp(Math.round(Number(s.energy) || 初值), 0, 100)
  let 跨夜 = false
  for (let t = new Date(上次); t < new Date(now); t = new Date(t.getTime() + 3600000)) {
    const h = t.getHours()
    if (h >= 0 && h < 6) { 跨夜 = true; break }
  }
  if (跨夜 && 小时 >= 3) 值 = Math.min(100, 值 + 睡眠回复)
  else 值 = Math.max(0, 值 - 小时 * 每小时掉)
  s.energy = Math.round(值)
  s.energyAt = now
  return s
}
