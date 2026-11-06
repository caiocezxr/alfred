import { useEffect, useRef } from 'react'
import { readUi } from './store'

const MIN = -125
const MAX = 125
const CX = 70
const CY = 70
const R = 56
const ang = (p: number) => MIN + (MAX - MIN) * Math.max(0, Math.min(1, p))
const pt = (a: number, r: number) => {
  const rad = (a * Math.PI) / 180
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)] as const
}
const arc = (a1: number, a2: number, r: number) => {
  const [x1, y1] = pt(a1, r)
  const [x2, y2] = pt(a2, r)
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

let audio: AudioContext | null = null
function thunk() {
  if (!readUi().sound) return
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(52, t + 0.12)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    o.connect(g).connect(audio.destination)
    o.start(t)
    o.stop(t + 0.2)
  } catch {
    return
  }
}

let warmedUp = false

export function Gauge({ progress, red, level, children }: { progress: number; red: number; level: 'green' | 'amber' | 'red'; children?: React.ReactNode }) {
  const needle = useRef<SVGGElement>(null)
  const sim = useRef({ a: MIN, v: 0, t: MIN, raf: 0 })
  const wasGreen = useRef(level === 'green')

  useEffect(() => {
    const s = sim.current
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const target = ang(progress)
    const set = (a: number) => needle.current?.setAttribute('transform', `rotate(${a.toFixed(2)} ${CX} ${CY})`)
    if (reducedMotion) {
      s.a = target
      set(target)
      return
    }
    const run = (t: number, kick = 0) => {
      s.t = t
      s.v += kick
      cancelAnimationFrame(s.raf)
      let last = performance.now()
      const step = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000)
        last = now
        const f = -190 * (s.a - s.t) - 15 * s.v
        s.v += f * dt
        s.a += s.v * dt
        set(s.a)
        if (Math.abs(s.v) > 0.02 || Math.abs(s.a - s.t) > 0.02) s.raf = requestAnimationFrame(step)
        else set((s.a = s.t))
      }
      s.raf = requestAnimationFrame(step)
    }
    if (!warmedUp) {
      warmedUp = true
      run(MAX)
      const id = setTimeout(() => run(target), 520)
      return () => {
        clearTimeout(id)
        cancelAnimationFrame(s.raf)
      }
    }
    const turningGreen = level === 'green' && !wasGreen.current
    wasGreen.current = level === 'green'
    if (turningGreen) thunk()
    run(target, turningGreen ? 160 : 0)
    return () => cancelAnimationFrame(s.raf)
  }, [progress, level])

  const ticks = []
  for (let i = 0; i <= 50; i++) {
    const a = MIN + ((MAX - MIN) * i) / 50
    const major = i % 10 === 0
    const [x1, y1] = pt(a, R - (major ? 9 : 5))
    const [x2, y2] = pt(a, R - 1)
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'is-major' : ''} />)
  }
  const labels = [0, 2, 4, 6, 8, 10].map((n) => {
    const [x, y] = pt(MIN + ((MAX - MIN) * n) / 10, R - 17)
    return (
      <text key={n} x={x} y={y + 3}>
        {n}
      </text>
    )
  })
  const redEnd = MIN + (MAX - MIN) * Math.max(0, Math.min(1, red))

  return (
    <div className={`wk-gauge is-${level}`}>
      <svg viewBox="0 0 140 118" aria-hidden="true">
        <defs>
          <radialGradient id="wk-g-face" cx="50%" cy="42%" r="62%">
            <stop offset="0" stopColor="var(--wk-face-1)" />
            <stop offset="1" stopColor="var(--wk-face-2)" />
          </radialGradient>
          <linearGradient id="wk-g-bezel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--wk-metal-1)" />
            <stop offset=".5" stopColor="var(--wk-metal-2)" />
            <stop offset="1" stopColor="var(--wk-metal-3)" />
          </linearGradient>
          <radialGradient id="wk-g-hub" cx="40%" cy="35%" r="70%">
            <stop offset="0" stopColor="var(--wk-metal-1)" />
            <stop offset="1" stopColor="var(--wk-metal-3)" />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r={R + 7} fill="url(#wk-g-bezel)" />
        <circle cx={CX} cy={CY} r={R + 4} fill="url(#wk-g-face)" />
        <path d={arc(MIN, MAX, R - 3)} className="wk-g-track" />
        <path d={arc(ang(0.9), MAX, R - 3)} className="wk-g-green" />
        {red > 0 && <path d={arc(MIN, redEnd, R - 3)} className="wk-g-red" />}
        <path d={arc(MIN, ang(progress), R - 3)} className="wk-g-sweep" />
        <g className="wk-g-ticks">{ticks}</g>
        <g className="wk-g-labels">{labels}</g>
        <g ref={needle} className="wk-g-needle" transform={`rotate(${MIN} ${CX} ${CY})`}>
          <path d={`M${CX - 2.2} ${CY + 9} L${CX - 0.7} ${CY - R + 8} L${CX + 0.7} ${CY - R + 8} L${CX + 2.2} ${CY + 9} Z`} />
        </g>
        <circle cx={CX} cy={CY} r="7.5" fill="url(#wk-g-hub)" className="wk-g-hub" />
        <circle cx={CX} cy={CY} r="2.2" className="wk-g-pin" />
      </svg>
      <div className="wk-gauge-read">{children}</div>
    </div>
  )
}
