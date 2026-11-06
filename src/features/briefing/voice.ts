import { isTauri } from '../../shared/db/api'
import { briefingApi } from './api.ts'

export type SpeakOptions = { voice: string; rate: number; jarvis: boolean }
export type PlayResult = 'ended' | 'stopped' | 'error'

type Chain = { input: GainNode; fx: GainNode; dry: GainNode; out: GainNode; analyser: AnalyserNode }

class Narrator {
  private ctx: AudioContext | null = null
  private chain: Chain | null = null
  private cache = new Map<string, Promise<AudioBuffer>>()
  private source: AudioBufferSourceNode | null = null
  private startedAt = 0
  private duration = 0
  private finish: ((r: PlayResult) => void) | null = null
  private data: Float32Array<ArrayBuffer> | null = null
  private bins: Uint8Array<ArrayBuffer> | null = null
  private smooth = 0
  private pulse = 0
  private spoken = 0
  private utterLen = 1
  private paused = false
  readonly native = isTauri

  private ensure(): { ctx: AudioContext; chain: Chain } {
    if (this.ctx && this.chain) return { ctx: this.ctx, chain: this.chain }
    const ctx = new AudioContext()
    const input = ctx.createGain()
    const out = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.55
    const dry = ctx.createGain()
    dry.gain.value = 1
    input.connect(dry).connect(out)
    const fx = ctx.createGain()
    fx.gain.value = 0
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 170, Q: 0.7 })
    const presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2600, Q: 1.1, gain: 5 })
    const air = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 5200, Q: 2.4, gain: 2.5 })
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7400, Q: 0.6 })
    input.connect(hp).connect(presence).connect(air).connect(lp)
    const comp = new DynamicsCompressorNode(ctx, { threshold: -20, knee: 12, ratio: 3.5, attack: 0.004, release: 0.18 })
    const clean = new GainNode(ctx, { gain: 0.84 })
    lp.connect(clean).connect(comp)
    const ring = new GainNode(ctx, { gain: 0 })
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: 46 })
    const depth = new GainNode(ctx, { gain: 1 })
    osc.connect(depth).connect(ring.gain)
    osc.start()
    const ringMix = new GainNode(ctx, { gain: 0.2 })
    lp.connect(ring).connect(ringMix).connect(comp)
    const delay = new DelayNode(ctx, { delayTime: 0.075, maxDelayTime: 0.5 })
    const fb = new GainNode(ctx, { gain: 0.24 })
    const damp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3200 })
    const wet = new GainNode(ctx, { gain: 0.17 })
    lp.connect(delay)
    delay.connect(damp).connect(fb).connect(delay)
    damp.connect(wet).connect(comp)
    comp.connect(fx).connect(out)
    out.connect(analyser).connect(ctx.destination)
    this.ctx = ctx
    this.chain = { input, fx, dry, out, analyser }
    this.data = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
    return { ctx, chain: this.chain }
  }

  setJarvis(on: boolean) {
    if (!this.ctx || !this.chain) return
    const t = this.ctx.currentTime
    this.chain.fx.gain.setTargetAtTime(on ? 1.05 : 0, t, 0.06)
    this.chain.dry.gain.setTargetAtTime(on ? 0 : 1, t, 0.06)
  }

  private key = (text: string, o: SpeakOptions) => `${o.voice}|${o.rate}|${text}`

  private buffer(text: string, o: SpeakOptions): Promise<AudioBuffer> {
    const k = this.key(text, o)
    let p = this.cache.get(k)
    if (!p) {
      const { ctx } = this.ensure()
      p = briefingApi.tts(text, o.voice, o.rate).then((bytes) => ctx.decodeAudioData(bytes))
      p.catch(() => this.cache.delete(k))
      this.cache.set(k, p)
      if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value!)
    }
    return p
  }

  prefetch(text: string, o: SpeakOptions) {
    if (this.native && text.trim()) void this.buffer(text, o).catch(() => {})
  }

  async play(text: string, o: SpeakOptions): Promise<PlayResult> {
    this.stop()
    if (!text.trim()) return 'ended'
    this.paused = false
    if (!this.native) return this.speakBrowser(text, o)
    let buf: AudioBuffer
    try {
      buf = await this.buffer(text, o)
    } catch {
      return 'error'
    }
    const { ctx, chain } = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume()
    this.setJarvis(o.jarvis)
    const src = new AudioBufferSourceNode(ctx, { buffer: buf })
    src.connect(chain.input)
    this.source = src
    this.duration = buf.duration
    this.startedAt = ctx.currentTime + 0.02
    src.start(this.startedAt)
    return new Promise<PlayResult>((resolve) => {
      this.finish = resolve
      src.onended = () => {
        if (this.source !== src) return
        this.source = null
        const f = this.finish
        this.finish = null
        f?.('ended')
      }
    })
  }

  private speakBrowser(text: string, o: SpeakOptions): Promise<PlayResult> {
    const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null
    if (!synth) return Promise.resolve('error')
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'pt-BR'
      const v = synth.getVoices().find((x) => x.lang.replace('_', '-').toLowerCase() === 'pt-br' && x.name.includes(o.voice)) ??
        synth.getVoices().find((x) => x.lang.replace('_', '-').toLowerCase() === 'pt-br')
      if (v) u.voice = v
      u.rate = Math.max(0.6, Math.min(1.8, o.rate / 185))
      this.utterLen = text.length || 1
      this.spoken = 0
      this.startedAt = performance.now()
      this.duration = (text.split(/\s+/).length / o.rate) * 60
      u.onboundary = (ev) => {
        this.spoken = ev.charIndex
        this.pulse = 1
      }
      this.finish = resolve
      const done = (r: PlayResult) => {
        if (this.finish === resolve) {
          this.finish = null
          resolve(r)
        }
      }
      u.onend = () => done('ended')
      u.onerror = () => done('error')
      synth.cancel()
      synth.speak(u)
    })
  }

  pause() {
    this.paused = true
    if (this.native) void this.ctx?.suspend()
    else speechSynthesis?.pause()
  }

  resume() {
    this.paused = false
    if (this.native) void this.ctx?.resume()
    else speechSynthesis?.resume()
  }

  get isPaused() {
    return this.paused
  }

  stop() {
    const f = this.finish
    this.finish = null
    if (this.source) {
      const s = this.source
      this.source = null
      try {
        s.stop()
      } catch {
      }
    }
    if (!this.native && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
    f?.('stopped')
  }

  progress(): number {
    if (this.native) {
      if (!this.ctx || !this.source || !this.duration) return 0
      return Math.max(0, Math.min(1, (this.ctx.currentTime - this.startedAt) / this.duration))
    }
    return this.finish ? Math.min(1, this.spoken / this.utterLen) : 0
  }

  level(): number {
    if (this.native) {
      if (!this.chain || !this.data || !this.source) {
        this.smooth *= 0.9
        return this.smooth
      }
      this.chain.analyser.getFloatTimeDomainData(this.data)
      let sum = 0
      for (let i = 0; i < this.data.length; i++) sum += this.data[i] * this.data[i]
      const rms = Math.sqrt(sum / this.data.length)
      const target = Math.min(1, rms * 5.5)
      this.smooth += (target - this.smooth) * (target > this.smooth ? 0.5 : 0.12)
      return this.smooth
    }
    this.pulse *= 0.9
    const target = this.finish && !this.paused ? 0.25 + this.pulse * 0.6 : 0
    this.smooth += (target - this.smooth) * 0.25
    return this.smooth
  }

  bands(out: Float32Array): void {
    if (this.native && this.chain && this.source) {
      const a = this.chain.analyser
      if (!this.bins || this.bins.length !== a.frequencyBinCount) this.bins = new Uint8Array(new ArrayBuffer(a.frequencyBinCount))
      const bins = this.bins
      a.getByteFrequencyData(bins)
      const span = Math.min(bins.length, 120)
      for (let i = 0; i < out.length; i++) {
        const j = Math.floor((i / out.length) * span)
        out[i] = bins[j] / 255
      }
      return
    }
    const l = this.level()
    const t = performance.now() / 1000
    for (let i = 0; i < out.length; i++) out[i] = l * (0.55 + 0.45 * Math.sin(t * 6 + i * 0.9) * Math.sin(t * 2.3 + i * 0.37))
  }

  get speaking() {
    return !!this.finish
  }
}

export const narrator = new Narrator()

export async function listVoices(): Promise<{ id: string; name: string }[]> {
  if (isTauri) return (await briefingApi.voices().catch(() => [])).map((v) => ({ id: v.id, name: v.name }))
  if (typeof speechSynthesis === 'undefined') return []
  const get = () => speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase() === 'pt-br')
  let list = get()
  if (!list.length) {
    await new Promise((r) => setTimeout(r, 400))
    list = get()
  }
  return list.map((v) => ({ id: v.name, name: v.name.split(' (')[0] }))
}
