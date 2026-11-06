const KEY = 'ps.sound.v1'

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {}
}

export function wakeAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    return
  }
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!C) return
  ctx = new C()
  noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3)
}

function ready() {
  return !!ctx && !!noise && ctx.state === 'running' && soundOn()
}

function burst(freq: number, q: number, gain: number, dur: number, at = 0) {
  if (!ready()) return
  const c = ctx!
  const t = c.currentTime + at
  const src = c.createBufferSource()
  src.buffer = noise
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = freq
  f.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(f).connect(g).connect(c.destination)
  src.start(t)
  src.stop(t + dur + 0.02)
}

function tone(freq: number, gain: number, dur: number, at = 0, to = freq) {
  if (!ready()) return
  const c = ctx!
  const t = c.currentTime + at
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(freq, t)
  o.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(c.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

export const sfx = {
  tick: () => burst(3200 + Math.random() * 400, 6, 0.09, 0.03),
  key: () => {
    burst(2400 + Math.random() * 300, 5, 0.07, 0.035)
    tone(420, 0.02, 0.04)
  },
  bolts: () => {
    for (let i = 0; i < 4; i++) {
      burst(1800, 4, 0.08, 0.05, i * 0.05)
      tone(180, 0.05, 0.06, i * 0.05, 120)
    }
  },
  unlock: () => {
    tone(140, 0.16, 0.28, 0, 60)
    burst(900, 2, 0.12, 0.12)
    burst(2600, 5, 0.06, 0.05, 0.09)
  },
  deny: () => {
    tone(120, 0.08, 0.12, 0, 90)
    tone(120, 0.08, 0.12, 0.14, 80)
  },
}
