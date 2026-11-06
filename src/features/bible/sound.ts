const FILES = import.meta.glob('../../assets/sounds/*.{m4a,mp3,ogg,wav,aac}', { query: '?url', import: 'default', eager: true }) as Record<string, string>

type SampleName = 'page-1' | 'page-2' | 'page-3' | 'book-open' | 'book-close' | 'book-place'

let ctx: AudioContext | null = null
let out: GainNode | null = null
let noise: AudioBuffer | null = null
let volume = 0.8
let lastPage = -1
const buffers = new Map<SampleName, AudioBuffer | null>()
const loading = new Map<SampleName, Promise<void>>()

function urlFor(name: SampleName) {
  const k = Object.keys(FILES).find((f) => f.split('/').pop()!.replace(/\.[a-z0-9]+$/, '') === name)
  return k ? FILES[k] : null
}

function context() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    out = ctx.createGain()
    out.gain.value = volume
    out.connect(ctx.destination)
  }
  return ctx
}

function wake() {
  const ac = context()
  if (ac && ac.state === 'suspended') void ac.resume()
  return ac
}

function load(name: SampleName) {
  if (buffers.has(name) || loading.has(name)) return
  const ac = context()
  const url = urlFor(name)
  if (!ac || !url) {
    buffers.set(name, null)
    return
  }
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((data) => ac.decodeAudioData(data))
    .then((buf) => void buffers.set(name, buf))
    .catch(() => void buffers.set(name, null))
    .finally(() => loading.delete(name))
  loading.set(name, p)
}

export function preloadSounds() {
  for (const n of ['page-1', 'page-2', 'page-3', 'book-open', 'book-close', 'book-place'] as SampleName[]) load(n)
}

export function setSoundVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  if (ctx && out) out.gain.setTargetAtTime(volume, ctx.currentTime, 0.02)
}

export function getSoundVolume() {
  return volume
}

function playSample(name: SampleName, gain: number, rate: number, delay = 0): boolean {
  const buf = buffers.get(name)
  if (!buf) {
    load(name)
    return false
  }
  const ac = wake()
  if (!ac || !out) return false
  const src = ac.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate * (0.95 + Math.random() * 0.1)
  const g = ac.createGain()
  g.gain.value = gain
  src.connect(g).connect(out)
  src.start(ac.currentTime + delay)
  src.onended = () => {
    src.disconnect()
    g.disconnect()
  }
  return true
}

function noiseBuffer(ac: AudioContext) {
  if (noise) return noise
  const len = Math.floor(ac.sampleRate * 0.9)
  noise = ac.createBuffer(1, len, ac.sampleRate)
  const d = noise.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    last = (last + 0.08 * w) / 1.08
    d[i] = last * 2.6 + w * 0.12
  }
  return noise
}

function synthPaper(strength: number, dur: number) {
  const ac = wake()
  if (!ac || !out) return
  const t = ac.currentTime
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  src.playbackRate.value = 0.92 + Math.random() * 0.12
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.4
  lp.frequency.setValueAtTime(1400, t)
  lp.frequency.linearRampToValueAtTime(2600, t + dur * 0.5)
  lp.frequency.linearRampToValueAtTime(1100, t + dur)
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 220
  const g = ac.createGain()
  const peak = 0.035 * (0.4 + 0.6 * strength)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(peak, t + dur * 0.3)
  g.gain.linearRampToValueAtTime(peak * 0.5, t + dur * 0.7)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(lp).connect(hp).connect(g).connect(out)
  src.start(t, Math.random() * 0.3, dur + 0.05)
  src.onended = () => {
    src.disconnect()
    lp.disconnect()
    hp.disconnect()
    g.disconnect()
  }
}

export function playPageTurn(strength = 0.5, quick = false) {
  const s = Math.max(0, Math.min(1, strength))
  let i = Math.floor(Math.random() * 3)
  if (i === lastPage) i = (i + 1) % 3
  lastPage = i
  const gain = (quick ? 0.5 : 0.62) * (0.45 + 0.55 * s)
  const rate = (quick ? 1.06 : 1) * (0.96 + 0.08 * s)
  if (!playSample(`page-${i + 1}` as SampleName, gain, rate)) synthPaper(s, quick ? 0.24 : 0.4)
}

export function playBookOpen() {
  if (!playSample('book-open', 0.7, 0.98)) synthPaper(0.3, 0.3)
}

export function playBookClose() {
  if (!playSample('book-close', 0.62, 1)) synthPaper(0.35, 0.3)
}

export function playBookPlace(strength = 0.5) {
  playSample('book-place', 0.28 + 0.22 * Math.max(0, Math.min(1, strength)), 1)
}
