const hannCache = new Map<number, Float32Array>()
function hann(n: number): Float32Array {
  let w = hannCache.get(n)
  if (!w) {
    w = new Float32Array(n)
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
    hannCache.set(n, w)
  }
  return w
}

export function stretch(input: Float32Array, sr: number, speed: number): Float32Array {
  if (Math.abs(speed - 1) < 0.01 || input.length < sr * 0.05) return input
  const W = Math.round(sr * 0.03)
  const Hs = W >> 1
  const Ha = Hs * speed
  const tol = Math.round(sr * 0.008)
  const win = hann(W)
  const outLen = Math.ceil(input.length / speed) + W
  const out = new Float32Array(outLen)
  const norm = new Float32Array(outLen)
  let prev = 0
  let k = 0
  for (; ; k++) {
    const nominal = Math.round(k * Ha)
    const o = k * Hs
    if (nominal + W >= input.length || o + W >= outLen) break
    let best = nominal
    if (k > 0) {
      const target = prev + Hs
      let bestScore = -Infinity
      const lo = Math.max(0, nominal - tol)
      const hi = Math.min(input.length - W - 1, nominal + tol)
      for (let c = lo; c <= hi; c += 2) {
        let score = 0
        for (let i = 0; i < Hs; i += 4) score += input[c + i] * input[target + i]
        if (score > bestScore) {
          bestScore = score
          best = c
        }
      }
      let refined = best
      for (let c = Math.max(lo, best - 1); c <= Math.min(hi, best + 1); c++) {
        let score = 0
        for (let i = 0; i < Hs; i += 2) score += input[c + i] * input[target + i]
        if (score > bestScore) {
          bestScore = score
          refined = c
        }
      }
      best = refined
    }
    for (let i = 0; i < W; i++) {
      out[o + i] += input[best + i] * win[i]
      norm[o + i] += win[i]
    }
    prev = best
  }
  const len = Math.min(outLen, k * Hs + Hs)
  const res = new Float32Array(len)
  for (let i = 0; i < len; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0
  return res
}
