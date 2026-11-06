import type { FromWorker, ToWorker, VoicePhase } from './protocol.ts'

export type Clip = { pcm: Float32Array; sr: number }
export type VoiceState = {
  phase: VoicePhase
  loaded: number
  total: number
  device: string | null
  dtype: string | null
  error: string | null
  loadMs: number | null
  synthMs: number
  audioMs: number
  firstMs: number | null
  workers: number
}
export type Want = { id: string; speech: string }

type Slot = { w: Worker; ready: boolean; job: string | null }

const MAX_MEM = 400
const IDLE_MS = 90_000

export function poolSize(cores: number, device: string | null): number {
  if (device === 'webgpu') return 1
  return Math.max(1, Math.min(3, Math.floor((cores || 4) / 3)))
}

class VoiceEngine {
  state: VoiceState = { phase: 'idle', loaded: 0, total: 0, device: null, dtype: null, error: null, loadMs: null, synthMs: 0, audioMs: 0, firstMs: null, workers: 0 }
  private listeners = new Set<() => void>()
  private clipListeners = new Set<(id: string) => void>()
  private slots: Slot[] = []
  private queue: Want[] = []
  private mem = new Map<string, Clip>()
  private failed = new Set<string>()
  private voice = 'pf_dora'
  private startedAt = 0
  private idleTimer = 0

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  onClip(fn: (id: string) => void) {
    this.clipListeners.add(fn)
    return () => {
      this.clipListeners.delete(fn)
    }
  }
  private set(patch: Partial<VoiceState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  get available() {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof indexedDB !== 'undefined'
  }

  private spawn(): Slot {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const slot: Slot = { w, ready: false, job: null }
    w.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(slot, ev.data)
    w.onerror = (ev) => {
      ev.preventDefault?.()
      this.drop(slot, `a voz neural não carregou${ev.message ? `: ${ev.message}` : ''}`)
    }
    this.slots.push(slot)
    this.set({ workers: this.slots.length })
    w.postMessage({ t: 'init' } satisfies ToWorker)
    return slot
  }

  ensure() {
    if (!this.available) {
      if (this.state.phase !== 'error') this.set({ phase: 'error', error: 'este ambiente não roda a voz neural' })
      return
    }
    if (this.slots.length) return
    this.startedAt = performance.now()
    this.set({ phase: 'loading', error: null })
    this.spawn()
  }

  private eager = false

  private grow() {
    const want = this.eager ? poolSize(navigator.hardwareConcurrency, this.state.device) : 1
    while (this.slots.length < want && this.queue.length > this.slots.filter((s) => s.ready && !s.job).length) this.spawn()
  }

  retry() {
    for (const s of this.slots) s.w.terminate()
    this.slots = []
    this.failed.clear()
    this.set({ phase: 'idle', error: null, loaded: 0, total: 0, workers: 0 })
    this.ensure()
  }

  private drop(slot: Slot, error: string) {
    slot.w.terminate()
    this.slots = this.slots.filter((s) => s !== slot)
    if (slot.job) this.requeue(slot.job)
    this.set({ workers: this.slots.length })
    if (!this.slots.some((s) => s.ready)) {
      for (const s of this.slots) s.w.terminate()
      this.slots = []
      this.set({ phase: 'error', error, workers: 0 })
    }
  }

  private requeue(id: string) {
    const back = this.pending.get(id)
    if (back) this.queue.unshift(back)
  }
  private pending = new Map<string, Want>()

  private receive(slot: Slot, m: FromWorker) {
    if (m.t === 'state') {
      if (m.phase === 'error') return this.drop(slot, m.error ?? 'a voz neural falhou')
      if (m.phase === 'ready') {
        slot.ready = true
        this.set({ phase: 'ready', device: m.device ?? this.state.device, dtype: m.dtype ?? this.state.dtype, loadMs: this.state.loadMs ?? m.ms ?? null })
        this.grow()
      } else if (!this.slots.some((s) => s.ready)) this.set({ phase: m.phase })
      this.pump()
      return
    }
    if (m.t === 'progress') {
      if (this.state.phase === 'downloading') this.set({ loaded: m.loaded, total: Math.max(m.total, this.state.total) })
      return
    }
    if (m.t === 'audio') {
      this.mem.set(m.id, { pcm: m.pcm, sr: m.sr })
      if (this.mem.size > MAX_MEM) this.mem.delete(this.mem.keys().next().value!)
      if (!m.cached) {
        const audio = (m.pcm.length / m.sr) * 1000
        this.set({ synthMs: this.state.synthMs + m.ms, audioMs: this.state.audioMs + audio, firstMs: this.state.firstMs ?? Math.round(performance.now() - this.startedAt) })
      } else if (this.state.firstMs === null) this.set({ firstMs: Math.round(performance.now() - this.startedAt) })
    } else if (m.t === 'fail') {
      this.failed.add(m.id)
    }
    if (slot.job === m.id) slot.job = null
    this.pending.delete(m.id)
    for (const l of this.clipListeners) l(m.id)
    this.pump()
  }

  setVoice(v: string) {
    this.voice = v
  }

  get(id: string): Clip | undefined {
    return this.mem.get(id)
  }
  hasFailed(id: string) {
    return this.failed.has(id)
  }

  want(list: Want[], first = false) {
    const busy = new Set(this.slots.map((s) => s.job))
    const fresh = list.filter((w) => !this.mem.has(w.id) && !this.failed.has(w.id) && !busy.has(w.id))
    const ids = new Set(fresh.map((w) => w.id))
    const rest = this.queue.filter((w) => !ids.has(w.id))
    this.queue = first ? [...fresh, ...rest] : [...rest, ...fresh]
    if (first && fresh.length) this.eager = true
    this.ensure()
    this.pump()
  }

  private pump() {
    window.clearTimeout(this.idleTimer)
    const firstReady = this.slots.some((s) => s.ready)
    for (const slot of this.slots) {
      if (slot.job || (!slot.ready && firstReady)) continue
      if (!slot.ready && this.slots.indexOf(slot) > 0) continue
      while (this.queue.length) {
        const next = this.queue.shift()!
        if (this.mem.has(next.id) || this.failed.has(next.id)) continue
        slot.job = next.id
        this.pending.set(next.id, next)
        slot.w.postMessage({ t: 'synth', id: next.id, speech: next.speech, voice: this.voice } satisfies ToWorker)
        break
      }
    }
    if (firstReady) this.grow()
    if (!this.queue.length && this.slots.every((s) => !s.job)) this.eager = false
    if (!this.queue.length && this.slots.every((s) => !s.job)) this.idleTimer = window.setTimeout(() => this.shrink(), IDLE_MS)
  }

  private shrink() {
    if (this.queue.length || this.slots.some((s) => s.job)) return
    for (const s of this.slots) s.w.terminate()
    this.slots = []
    this.set({ workers: 0, phase: this.state.phase === 'error' ? 'error' : 'idle' })
  }

  get rtf(): number | null {
    return this.state.audioMs > 0 ? this.state.synthMs / this.state.audioMs : null
  }
}

export const voiceEngine = new VoiceEngine()
