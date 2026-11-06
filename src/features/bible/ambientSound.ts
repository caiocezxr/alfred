import type { AmbientKind } from './three/ambience'

type Ambience = AmbientKind

let ctx: AudioContext | null = null
let master: GainNode | null = null
let nodes: AudioNode[] = []
let timers: number[] = []

function noiseBuffer(ac: AudioContext, brown: boolean) {
  const len = ac.sampleRate * 4
  const buf = ac.createBuffer(2, len, ac.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (brown) {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      } else d[i] = w * 0.5
    }
  }
  return buf
}

function loop(ac: AudioContext, buf: AudioBuffer) {
  const s = ac.createBufferSource()
  s.buffer = buf
  s.loop = true
  s.start()
  nodes.push(s)
  return s
}

export function startAmbient(kind: Ambience, volume = 0.5) {
  stopAmbient(0)
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx = ctx ?? new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  const ac = ctx
  master = ac.createGain()
  master.gain.value = 0
  master.connect(ac.destination)
  master.gain.linearRampToValueAtTime(0.16 * volume, ac.currentTime + 3)

  if (kind === 'mar') {
    const src = loop(ac, noiseBuffer(ac, true))
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 650
    const g = ac.createGain()
    g.gain.value = 0.35
    src.connect(lp).connect(g).connect(master)
    const swell = () => {
      if (!ctx) return
      const t = ac.currentTime
      const dur = 6 + Math.random() * 4
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(0.95, t + dur * 0.45)
      g.gain.linearRampToValueAtTime(0.25, t + dur)
      lp.frequency.setValueAtTime(lp.frequency.value, t)
      lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.45)
      lp.frequency.linearRampToValueAtTime(520, t + dur)
      timers.push(window.setTimeout(swell, dur * 1000))
    }
    swell()
    nodes.push(lp, g)
  } else if (kind === 'vento') {
    const src = loop(ac, noiseBuffer(ac, false))
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.8
    bp.frequency.value = 480
    const g = ac.createGain()
    g.gain.value = 0.28
    const lfo = ac.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ac.createGain()
    lfoGain.gain.value = 220
    lfo.connect(lfoGain).connect(bp.frequency)
    const lfo2 = ac.createOscillator()
    lfo2.frequency.value = 0.045
    const lfo2Gain = ac.createGain()
    lfo2Gain.gain.value = 0.12
    lfo2.connect(lfo2Gain).connect(g.gain)
    lfo.start()
    lfo2.start()
    src.connect(bp).connect(g).connect(master)
    nodes.push(bp, g, lfo, lfoGain, lfo2, lfo2Gain)
  } else if (kind === 'lareira') {
    const src = loop(ac, noiseBuffer(ac, true))
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 320
    const g = ac.createGain()
    g.gain.value = 0.5
    src.connect(lp).connect(g).connect(master)
    const crackleBuf = noiseBuffer(ac, false)
    const crackle = () => {
      if (!ctx || !master) return
      const t = ac.currentTime + 0.01
      const s = ac.createBufferSource()
      s.buffer = crackleBuf
      const bp = ac.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1600 + Math.random() * 3200
      bp.Q.value = 1.4
      const eg = ac.createGain()
      const big = Math.random() < 0.12
      const peak = (big ? 0.9 : 0.25 + Math.random() * 0.35) * 1.6
      eg.gain.setValueAtTime(0, t)
      eg.gain.linearRampToValueAtTime(peak, t + 0.002)
      eg.gain.exponentialRampToValueAtTime(0.001, t + (big ? 0.09 : 0.03 + Math.random() * 0.03))
      s.connect(bp).connect(eg).connect(master)
      s.start(t, Math.random() * 3, 0.12)
      s.onended = () => {
        s.disconnect()
        bp.disconnect()
        eg.disconnect()
      }
      const next = Math.random() < 0.35 ? 30 + Math.random() * 60 : 160 + Math.random() * 650
      timers.push(window.setTimeout(crackle, next))
    }
    crackle()
    nodes.push(lp, g)
  } else if (kind === 'grilos') {
    const air = loop(ac, noiseBuffer(ac, true))
    const al = ac.createBiquadFilter()
    al.type = 'lowpass'
    al.frequency.value = 420
    const ag = ac.createGain()
    ag.gain.value = 0.18
    air.connect(al).connect(ag).connect(master)
    nodes.push(al, ag)
    const cricket = (freq: number, every: number, pan: number) => {
      const osc = ac.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      const env = ac.createGain()
      env.gain.value = 0
      const p = ac.createStereoPanner()
      p.pan.value = pan
      osc.connect(env).connect(p).connect(master!)
      osc.start()
      nodes.push(osc, env, p)
      let at = ac.currentTime + 0.3 + Math.random()
      const schedule = () => {
        if (!ctx) return
        while (at < ac.currentTime + 1.5) {
          const pulses = 3 + Math.round(Math.random())
          for (let i = 0; i < pulses; i++) {
            const t0 = at + i * 0.034
            env.gain.setValueAtTime(0, t0)
            env.gain.linearRampToValueAtTime(0.05, t0 + 0.006)
            env.gain.linearRampToValueAtTime(0, t0 + 0.024)
          }
          at += every * (0.85 + Math.random() * 0.3)
        }
        timers.push(window.setTimeout(schedule, 700))
      }
      schedule()
    }
    cricket(4400, 0.82, -0.45)
    cricket(4750, 1.07, 0.5)
  } else {
    const src = loop(ac, noiseBuffer(ac, false))
    const hp = ac.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 900
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 5200
    const g = ac.createGain()
    g.gain.value = 0.22
    src.connect(hp).connect(lp).connect(g).connect(master)
    const rumble = loop(ac, noiseBuffer(ac, true))
    const rl = ac.createBiquadFilter()
    rl.type = 'lowpass'
    rl.frequency.value = 180
    const rg = ac.createGain()
    rg.gain.value = 0.18
    rumble.connect(rl).connect(rg).connect(master)
    nodes.push(hp, lp, g, rl, rg)
  }
}

export function stopAmbient(fade = 2.2) {
  timers.forEach(clearTimeout)
  timers = []
  const ac = ctx
  const m = master
  const old = nodes
  nodes = []
  master = null
  if (!ac || !m) return
  m.gain.cancelScheduledValues(ac.currentTime)
  m.gain.setValueAtTime(m.gain.value, ac.currentTime)
  m.gain.linearRampToValueAtTime(0, ac.currentTime + fade)
  window.setTimeout(() => {
    for (const n of old) {
      try {
        ;(n as AudioScheduledSourceNode).stop?.()
      } catch {
      }
      n.disconnect()
    }
    m.disconnect()
  }, fade * 1000 + 100)
}
