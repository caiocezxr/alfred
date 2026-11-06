import { useSyncExternalStore } from 'react'
import { isTauri } from '../../shared/db/api'
import { describe } from '../home/weather'
import { weatherSentence } from './assemble.ts'
import { briefingApi } from './api.ts'
import { buildProgram, firstLineOf, type Program } from './program.ts'
import { hashText, toSpeech } from './speech.ts'
import { voiceEngine, type Clip, type VoiceState } from './tts/engine.ts'
import { stretch } from './tts/stretch.ts'
import type { Edition } from './types.ts'

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
export type Resume = { date: string; key: string; line: number; chapter: number; label: string; at: number }
export type PlayerState = {
  status: PlayerStatus
  date: string | null
  program: Program | null
  chapter: number
  line: number
  buffering: boolean
  speed: number
  prepared: number
  total: number
  voice: VoiceState
  systemVoice: boolean
  resume: Resume | null
  error: string | null
}

export const SPEEDS = [0.9, 1, 1.15, 1.3] as const
export const speedOfRate = (rate: number) => SPEEDS.reduce((b, s) => (Math.abs(s * 185 - rate) < Math.abs(b * 185 - rate) ? s : b), 1 as number)
export const rateOfSpeed = (s: number) => Math.round(s * 185)

const RESUME_KEY = 'ps.briefing.resume'
const LOOKAHEAD = 6
const FADE_IN = 0.006
const FADE_OUT = 0.012

type Wx = { city: string; temp: number; label: string; max: number; min: number }
export function readWeather(): Wx | null {
  try {
    const c = JSON.parse(localStorage.getItem('ps.weather.v1') ?? 'null') as { at: number; data: { city: string; temp: number; code: number; max: number; min: number }[] } | null
    const w = c?.data?.[0]
    if (!w || Date.now() - c!.at > 6 * 36e5) return null
    return { city: w.city, temp: w.temp, label: describe(w.code).label, max: w.max, min: w.min }
  } catch {
    return null
  }
}

function readResume(): Resume | null {
  try {
    const r = JSON.parse(localStorage.getItem(RESUME_KEY) ?? 'null') as Resume | null
    return r && typeof r.line === 'number' && typeof r.date === 'string' ? r : null
  } catch {
    return null
  }
}

type Slot = { line: number; src: AudioBufferSourceNode; gain: GainNode; start: number; end: number; next: number }

let state: PlayerState = {
  status: 'idle',
  date: null,
  program: null,
  chapter: 0,
  line: 0,
  buffering: false,
  speed: 1,
  prepared: 0,
  total: 0,
  voice: voiceEngine.state,
  systemVoice: false,
  resume: readResume(),
  error: null,
}
const listeners = new Set<() => void>()
function set(patch: Partial<PlayerState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let analyser: AnalyserNode | null = null
let slots: Slot[] = []
let nextLine = 0
let cursor = 0
let timer = 0
let preview: AudioBufferSourceNode | null = null
const buffers = new Map<string, AudioBuffer>()
let wave: Float32Array<ArrayBuffer> | null = null
let bins: Uint8Array<ArrayBuffer> | null = null
let smooth = 0

voiceEngine.subscribe(() => {
  set({ voice: voiceEngine.state })
  if (voiceEngine.state.phase === 'error' && isTauri && state.program && !state.systemVoice) startSystemVoice()
})
voiceEngine.onClip(() => {
  countPrepared()
  if (state.status === 'playing' || state.status === 'loading') fill()
})

function countPrepared() {
  const p = state.program
  if (!p) return
  let n = 0
  for (const l of p.lines) if (clipOf(l.id)) n++
  if (n !== state.prepared) set({ prepared: n })
}

const system = new Map<string, Clip>()
let systemBusy = false
function clipOf(id: string): Clip | undefined {
  return voiceEngine.get(id) ?? system.get(id)
}

function startSystemVoice() {
  set({ systemVoice: true })
  void pumpSystem()
}

async function pumpSystem() {
  if (systemBusy || !state.program) return
  systemBusy = true
  try {
    const p = state.program
    const from = Math.max(0, nextLine)
    const order = [...p.lines.slice(from), ...p.lines.slice(0, from)]
    for (const l of order) {
      if (state.program !== p) break
      if (clipOf(l.id)) continue
      const bytes = await briefingApi.tts(l.speech, 'Luciana', 185).catch(() => null)
      if (!bytes) continue
      const ac = ensureCtx()
      const buf = await ac.decodeAudioData(bytes.slice(0)).catch(() => null)
      if (!buf) continue
      system.set(l.id, { pcm: buf.getChannelData(0).slice(), sr: buf.sampleRate })
      countPrepared()
      if (state.status === 'playing' || state.status === 'loading') fill()
    }
  } finally {
    systemBusy = false
  }
}

function ensureCtx(): AudioContext {
  if (ctx) return ctx
  ctx = new AudioContext({ latencyHint: 'playback' })
  master = new GainNode(ctx, { gain: 1 })
  analyser = new AnalyserNode(ctx, { fftSize: 1024, smoothingTimeConstant: 0.55 })
  master.connect(analyser).connect(ctx.destination)
  wave = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
  return ctx
}

function bufferFor(id: string, clip: Clip, speed: number): AudioBuffer {
  const k = `${id}@${speed}`
  let b = buffers.get(k)
  if (b) return b
  const ac = ensureCtx()
  const pcm = stretch(clip.pcm, clip.sr, speed)
  b = ac.createBuffer(1, Math.max(1, pcm.length), clip.sr)
  b.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
  buffers.set(k, b)
  if (buffers.size > 80) buffers.delete(buffers.keys().next().value!)
  return b
}

function stopSlots() {
  for (const s of slots) {
    s.src.onended = null
    try {
      s.src.stop()
    } catch {
    }
    s.src.disconnect()
    s.gain.disconnect()
  }
  slots = []
}

function fill() {
  const p = state.program
  if (!p || !ctx || !master) return
  const now = ctx.currentTime
  let waiting = false
  while (nextLine < p.lines.length) {
    const ahead = cursor - now
    if (ahead > LOOKAHEAD) break
    const line = p.lines[nextLine]
    const clip = clipOf(line.id)
    if (!clip) {
      if (voiceEngine.hasFailed(line.id) && !state.systemVoice) {
        nextLine++
        continue
      }
      waiting = true
      break
    }
    const buf = bufferFor(line.id, clip, state.speed)
    const start = Math.max(cursor, now + 0.05)
    const gain = new GainNode(ctx, { gain: 0 })
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(1, start + FADE_IN)
    gain.gain.setValueAtTime(1, Math.max(start + FADE_IN, start + buf.duration - FADE_OUT))
    gain.gain.linearRampToValueAtTime(0, start + buf.duration)
    const src = new AudioBufferSourceNode(ctx, { buffer: buf })
    src.connect(gain).connect(master)
    src.start(start)
    const end = start + buf.duration
    const nextAt = end + line.pause / 1000 / state.speed
    slots.push({ line: nextLine, src, gain, start, end, next: nextAt })
    cursor = nextAt
    nextLine++
  }
  if (state.status === 'loading' && slots.length) set({ status: 'playing' })
  if (!waiting && state.buffering && slots.some((s) => s.start > now - 0.05)) set({ buffering: false })
  slots = slots.filter((s) => s.next > now - 2)
}

function currentSlot(): Slot | null {
  if (!ctx) return null
  const now = ctx.currentTime
  let cur: Slot | null = null
  for (const s of slots) if (s.start <= now + 0.02) cur = s
  return cur
}

function tick() {
  const p = state.program
  if (!p || !ctx) return
  if (state.status !== 'playing' && state.status !== 'loading') return
  fill()
  const now = ctx.currentTime
  const cur = currentSlot()
  if (cur && cur.line !== state.line) {
    const ch = p.lines[cur.line].chapter
    set({ line: cur.line, chapter: ch })
    saveResume()
  }
  const pending = slots.some((s) => s.end > now - 0.05 || s.start > now)
  if (nextLine >= p.lines.length && !pending) finish()
  else if (pending === state.buffering && state.status === 'playing') set({ buffering: !pending })
}

function finish() {
  stopSlots()
  window.clearInterval(timer)
  timer = 0
  localStorage.removeItem(RESUME_KEY)
  set({ status: 'ended', buffering: false, resume: null, line: Math.max(0, (state.program?.lines.length ?? 1) - 1) })
}

function saveResume() {
  const p = state.program
  if (!p) return
  const r: Resume = { date: p.date, key: p.key, line: state.line, chapter: state.chapter, label: p.chapters[state.chapter]?.label ?? '', at: Date.now() }
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(r))
  } catch {
  }
  set({ resume: r })
}

function startTimer() {
  if (!timer) timer = window.setInterval(tick, 90)
}

function queueFrom(p: Program, line: number) {
  const ordered = [...p.lines.slice(line), ...p.lines.slice(0, line)]
  voiceEngine.want(ordered.map((l) => ({ id: l.id, speech: l.speech })), true)
  if (state.systemVoice) void pumpSystem()
}

function seekLine(line: number, frac = 0) {
  const p = state.program
  if (!p || !ctx) return
  stopSlots()
  const l = Math.max(0, Math.min(line, p.lines.length - 1))
  nextLine = l
  cursor = ctx.currentTime + 0.06
  set({ line: l, chapter: p.lines[l]?.chapter ?? 0, buffering: false })
  queueFrom(p, l)
  const clip = clipOf(p.lines[l].id)
  if (clip && frac > 0.02 && frac < 0.98) {
    const buf = bufferFor(p.lines[l].id, clip, state.speed)
    const start = cursor
    const offset = frac * buf.duration
    const gain = new GainNode(ctx, { gain: 0 })
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(1, start + 0.03)
    gain.gain.setValueAtTime(1, Math.max(start + 0.03, start + buf.duration - offset - FADE_OUT))
    gain.gain.linearRampToValueAtTime(0, start + buf.duration - offset)
    const src = new AudioBufferSourceNode(ctx, { buffer: buf })
    src.connect(gain).connect(master!)
    src.start(start, offset)
    const end = start + buf.duration - offset
    const nextAt = end + p.lines[l].pause / 1000 / state.speed
    slots.push({ line: l, src, gain, start: start - offset, end, next: nextAt })
    cursor = nextAt
    nextLine = l + 1
  }
  if (state.status === 'paused' || state.status === 'ended' || state.status === 'idle') set({ status: 'playing' })
  void ctx.resume()
  fill()
  startTimer()
}

function programFor(e: Edition, voice: string): Program {
  const w = readWeather()
  return buildProgram(e, weatherSentence(w), voice)
}

export const briefingPlayer = {
  subscribe,
  getState: () => state,

  prepare(e: Edition, voice = 'pf_dora') {
    if (state.status === 'playing' || state.status === 'paused' || state.status === 'loading') return
    const p = programFor(e, voice)
    if (state.program?.key !== p.key) {
      system.clear()
      set({ program: p, date: e.date, total: p.lines.length, chapter: 0, line: 0, status: state.status === 'ended' && state.date === e.date ? 'ended' : 'idle', systemVoice: false })
    }
    voiceEngine.setVoice(voice)
    voiceEngine.want(p.lines.map((l) => ({ id: l.id, speech: l.speech })))
    countPrepared()
  },

  play(e: Edition, opts: { chapter?: number; resume?: boolean; voice?: string; speed?: number } = {}) {
    const ac = ensureCtx()
    void ac.resume()
    if (preview) {
      try {
        preview.stop()
      } catch {
      }
      preview = null
    }
    const voice = opts.voice ?? 'pf_dora'
    const p = programFor(e, voice)
    const same = state.program?.key === p.key
    if (opts.speed) set({ speed: opts.speed })
    if (!same) {
      system.clear()
      stopSlots()
      set({ program: p, date: e.date, total: p.lines.length, systemVoice: false })
    }
    voiceEngine.setVoice(voice)
    if (same && state.status === 'paused' && opts.chapter === undefined && !opts.resume) return briefingPlayer.resume()
    let line = 0
    if (opts.chapter !== undefined) line = firstLineOf(p, opts.chapter)
    else if (opts.resume) {
      const r = readResume()
      if (r && r.date === e.date) line = r.key === p.key ? r.line : firstLineOf(p, r.chapter)
    }
    set({ status: 'loading', error: null })
    if (voiceEngine.state.phase === 'error' && isTauri && !state.systemVoice) startSystemVoice()
    seekLine(line)
    if (!clipOf(p.lines[line]?.id ?? '')) set({ status: 'loading' })
  },

  pause() {
    if (state.status !== 'playing' && state.status !== 'loading') return
    void ctx?.suspend()
    set({ status: 'paused' })
  },

  resume() {
    if (state.status !== 'paused' || !ctx) return
    void ctx.resume()
    set({ status: slots.length ? 'playing' : 'loading' })
    startTimer()
    fill()
  },

  toggle(e?: Edition) {
    if (state.status === 'playing' || state.status === 'loading') briefingPlayer.pause()
    else if (state.status === 'paused') briefingPlayer.resume()
    else if (e) briefingPlayer.play(e, { resume: !!state.resume && state.resume.date === e.date })
  },

  stop() {
    stopSlots()
    window.clearInterval(timer)
    timer = 0
    if (ctx?.state === 'suspended') void ctx.resume()
    set({ status: 'idle', buffering: false })
  },

  seek(chapter: number) {
    const p = state.program
    if (!p) return
    const c = Math.max(0, Math.min(chapter, p.chapters.length - 1))
    if (state.status === 'idle' || state.status === 'ended') {
      set({ chapter: c, line: firstLineOf(p, c) })
      return
    }
    seekLine(firstLineOf(p, c))
  },

  next() {
    const p = state.program
    if (!p) return
    if (state.chapter >= p.chapters.length - 1) return
    briefingPlayer.seek(state.chapter + 1)
  },

  prev() {
    const p = state.program
    if (!p) return
    const ch = p.chapters[state.chapter]
    const s = currentSlot()
    const into = s && ctx ? ctx.currentTime - s.start : 0
    if (ch && (state.line > ch.first || into > 2.5)) briefingPlayer.seek(state.chapter)
    else briefingPlayer.seek(state.chapter - 1)
  },

  setSpeed(speed: number) {
    const s = SPEEDS.reduce((b, x) => (Math.abs(x - speed) < Math.abs(b - speed) ? x : b), 1 as number)
    if (s === state.speed) return
    const cur = currentSlot()
    const frac = cur && ctx ? Math.max(0, Math.min(1, (ctx.currentTime - cur.start) / Math.max(0.01, cur.end - cur.start))) : 0
    set({ speed: s })
    if ((state.status === 'playing' || state.status === 'loading') && cur) seekLine(cur.line, frac)
  },

  forgetResume() {
    localStorage.removeItem(RESUME_KEY)
    set({ resume: null })
  },

  retryVoice() {
    voiceEngine.retry()
    const p = state.program
    if (p) voiceEngine.want(p.lines.map((l) => ({ id: l.id, speech: l.speech })))
  },

  lineProgress(): number {
    const s = currentSlot()
    if (!s || !ctx) return 0
    return Math.max(0, Math.min(1, (ctx.currentTime - s.start) / Math.max(0.01, s.end - s.start)))
  },

  chapterProgress(): number {
    const p = state.program
    if (!p) return 0
    const ch = p.chapters[state.chapter]
    if (!ch || !ch.count) return 0
    if (state.status === 'ended') return 1
    const within = state.line - ch.first + briefingPlayer.lineProgress()
    return Math.max(0, Math.min(1, within / ch.count))
  },

  totalProgress(): number {
    const p = state.program
    if (!p || !p.lines.length) return 0
    if (state.status === 'ended') return 1
    return Math.max(0, Math.min(1, (state.line + briefingPlayer.lineProgress()) / p.lines.length))
  },

  get speaking() {
    return state.status === 'playing' && !state.buffering
  },

  level(): number {
    if (!analyser || !wave || !(state.status === 'playing' || preview)) {
      smooth *= 0.9
      return smooth
    }
    analyser.getFloatTimeDomainData(wave)
    let sum = 0
    for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i]
    const target = Math.min(1, Math.sqrt(sum / wave.length) * 5.5)
    smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12)
    return smooth
  },

  bands(out: Float32Array) {
    if (!analyser) {
      out.fill(0)
      return
    }
    if (!bins || bins.length !== analyser.frequencyBinCount) bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    analyser.getByteFrequencyData(bins)
    const span = Math.min(bins.length, 120)
    for (let i = 0; i < out.length; i++) out[i] = bins[Math.floor((i / out.length) * span)] / 255
  },

  async preview(text: string, speed = 1): Promise<boolean> {
    const ac = ensureCtx()
    void ac.resume()
    if (state.status === 'playing') briefingPlayer.pause()
    const speech = toSpeech(text)
    const id = hashText(`pf_dora|${speech}`)
    voiceEngine.want([{ id, speech }], true)
    const clip = await new Promise<Clip | null>((resolve) => {
      const have = voiceEngine.get(id)
      if (have) return resolve(have)
      const off = voiceEngine.onClip((got) => {
        if (got !== id) return
        off()
        resolve(voiceEngine.get(id) ?? null)
      })
      window.setTimeout(() => (off(), resolve(null)), 120_000)
    })
    if (!clip) return false
    const buf = bufferFor(id, clip, speed)
    const src = new AudioBufferSourceNode(ac, { buffer: buf })
    src.connect(master!)
    preview = src
    src.start()
    await new Promise((r) => (src.onended = r))
    if (preview === src) preview = null
    return true
  },

  stopPreview() {
    if (!preview) return
    try {
      preview.stop()
    } catch {
    }
    preview = null
  },
}

export function useBriefingPlayer(): PlayerState & { controls: typeof briefingPlayer } {
  const s = useSyncExternalStore(subscribe, () => state)
  return { ...s, controls: briefingPlayer }
}

export function voiceProgressLabel(v: VoiceState): string | null {
  if (v.phase === 'downloading') {
    const mb = (n: number) => Math.round(n / 1048576)
    return v.total ? `baixando a voz (${mb(v.loaded)} de ${mb(v.total)} MB)` : 'baixando a voz…'
  }
  if (v.phase === 'loading') return 'preparando a voz…'
  return null
}
