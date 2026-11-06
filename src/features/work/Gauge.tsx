import { isResting, onWake } from '../../shared/ui/rest'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { GaugeSegment } from './logic'
import { openItemFrom, readUi, toggleTodo } from './store'
import type { Company } from './types'

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
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

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

type Props = {
  progress: number
  red: number
  level: 'green' | 'amber' | 'red'
  children?: ReactNode
  segments?: GaugeSegment[]
  companies?: Company[]
  summary?: string
  size?: number
  onPeek?: (p: { title: string; detail: string; state: string } | null) => void
}

const TICKS = 50

export function GaugeCenter({ left }: { left: number }) {
  if (left <= 0)
    return (
      <span className="wk-gauge-left is-ok">
        <svg className="wk-gauge-ok" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
        </svg>
        <small>em dia</small>
      </span>
    )
  return (
    <span className="wk-gauge-left">
      <b>{left}</b>
      <small>{left === 1 ? 'falta' : 'faltam'}</small>
    </span>
  )
}

export function Gauge({ progress, red, level, children, segments, companies, summary, size, onPeek }: Props) {
  const uid = useId().replace(/:/g, '')
  const root = useRef<HTMLDivElement>(null)
  const needle = useRef<SVGGElement>(null)
  const sweep = useRef<SVGPathElement>(null)
  const tickBox = useRef<SVGGElement>(null)
  const glass = useRef<HTMLDivElement>(null)
  const [glow, setGlow] = useState(false)
  const sim = useRef({ a: MIN, v: 0, t: MIN, raf: 0, settled: false })
  const wasGreen = useRef(level === 'green')
  const target = useRef(ang(progress))
  target.current = ang(progress)
  const [hover, setHover] = useState<number | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  const drive = (t: number, kick = 0) => {
    const s = sim.current
    s.t = t
    s.v += kick
    s.settled = false
  }

  useEffect(() => {
    const s = sim.current
    let lit = -1
    const paint = (a: number) => {
      needle.current?.setAttribute('transform', `rotate(${a.toFixed(2)} ${CX} ${CY})`)
      const clamped = Math.max(MIN, Math.min(MAX, a))
      if (sweep.current) sweep.current.setAttribute('d', clamped - MIN < 0.5 ? '' : arc(MIN, clamped, R - 12))
      const n = Math.round(((clamped - MIN) / (MAX - MIN)) * TICKS)
      if (n !== lit && tickBox.current) {
        lit = n
        tickBox.current.querySelectorAll('line').forEach((l, i) => l.classList.toggle('is-lit', i <= n))
      }
    }
    if (reducedMotion()) {
      s.a = target.current
      paint(s.a)
      return
    }
    let last = performance.now()
    let nextTwitch = last + 1800 + Math.random() * 3000
    let drawn = 0
    const step = (now: number) => {
      if (isResting() && s.settled) {
        s.raf = 0
        return
      }
      if (s.settled && now - drawn < 33) {
        s.raf = requestAnimationFrame(step)
        return
      }
      drawn = now
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (s.settled && now > nextTwitch) {
        s.v += (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 18)
        s.settled = false
        nextTwitch = now + 2200 + Math.random() * 4200
      }
      const f = -210 * (s.a - s.t) - 11 * s.v
      s.v += f * dt
      s.a += s.v * dt
      if (Math.abs(s.v) < 0.02 && Math.abs(s.a - s.t) < 0.02) {
        s.a = s.t
        s.v = 0
        s.settled = true
      }
      const sec = now / 1000
      const idle = 0.55 * Math.sin(sec * 6.1) + 0.22 * Math.sin(sec * 17.3 + 1.1) + 0.1 * Math.sin(sec * 41)
      paint(s.a + idle)
      s.raf = requestAnimationFrame(step)
    }
    s.raf = requestAnimationFrame(step)
    const off = onWake(() => {
      if (!s.raf) {
        last = performance.now()
        s.raf = requestAnimationFrame(step)
      }
    })
    return () => {
      off()
      cancelAnimationFrame(s.raf)
    }
  }, [])

  useEffect(() => {
    if (reducedMotion()) {
      sim.current.a = target.current
      needle.current?.setAttribute('transform', `rotate(${target.current} ${CX} ${CY})`)
      if (sweep.current) sweep.current.setAttribute('d', target.current - MIN < 0.5 ? '' : arc(MIN, target.current, R - 12))
      return
    }
    if (!warmedUp) {
      warmedUp = true
      drive(MAX)
      const id = setTimeout(() => drive(target.current), 560)
      return () => clearTimeout(id)
    }
    const turningGreen = level === 'green' && !wasGreen.current
    wasGreen.current = level === 'green'
    if (turningGreen) {
      thunk()
      setGlow(true)
      const id = setTimeout(() => setGlow(false), 1400)
      drive(target.current, 220)
      return () => clearTimeout(id)
    }
    drive(target.current, (target.current - sim.current.a) * 0.9)
  }, [progress, level])

  useEffect(() => {
    if (reducedMotion() || hover === null || !segments?.length) {
      if (hover === null) drive(target.current)
      return
    }
    const n = segments.length
    const g = n > 1 ? Math.min(2.2, 120 / n) : 0
    const sp = (MAX - MIN - g * (n - 1)) / n
    const mid = MIN + hover * (sp + g) + sp / 2
    drive(target.current + (mid - target.current) * 0.18)
  }, [hover])

  const blip = () => {
    if (reducedMotion()) return
    drive(Math.min(MAX, target.current + 22), 60)
    setTimeout(() => drive(target.current), 260)
  }
  const rev = () => {
    if (reducedMotion()) return
    drive(MAX, 120)
    setTimeout(() => drive(MIN), 420)
    setTimeout(() => drive(target.current), 760)
  }

  const segs = segments ?? []
  const gap = segs.length > 1 ? Math.min(2.2, 120 / segs.length) : 0
  const span = segs.length ? (MAX - MIN - gap * (segs.length - 1)) / segs.length : 0
  const segAt = (i: number) => {
    const a1 = MIN + i * (span + gap)
    return [a1, a1 + span] as const
  }
  const color = (id: string | null) => companies?.find((c) => c.id === id)?.color ?? 'transparent'

  const ticks = []
  for (let i = 0; i <= TICKS; i++) {
    const a = MIN + ((MAX - MIN) * i) / TICKS
    const major = i % 10 === 0
    const [x1, y1] = pt(a, R - (major ? 13 : 10))
    const [x2, y2] = pt(a, R - (major ? 6 : 8))
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'is-major' : ''} />)
  }
  const labels = [0, 2, 4, 6, 8, 10].map((n) => {
    const [x, y] = pt(MIN + ((MAX - MIN) * n) / 10, R - 21)
    return (
      <text key={n} x={x} y={y + 3}>
        {n}
      </text>
    )
  })
  const redEnd = MIN + (MAX - MIN) * Math.max(0, Math.min(1, red))
  const hov = hover !== null ? segs[hover] : null

  const peekRef = useRef(onPeek)
  peekRef.current = onPeek
  const peekKey = hov ? `${hov.id}|${armed === hov.id}|${hov.detail}` : ''
  useEffect(() => {
    const fn = peekRef.current
    if (!fn) return
    fn(hov ? { title: hov.title, detail: armed === hov.id ? 'Clique de novo para concluir' : hov.detail, state: hov.state } : null)
  }, [peekKey])

  const clickSeg = (sg: GaugeSegment) => {
    if (sg.itemId) return openItemFrom(sg.itemId, document.querySelector<HTMLElement>(`[data-card="${sg.itemId}"]`))
    if (!sg.todoId) return
    if (armed === sg.id) {
      setArmed(null)
      void toggleTodo(sg.todoId)
    } else setArmed(sg.id)
  }

  return (
    <div
      ref={root}
      style={size ? { width: size, height: Math.round((size * 118) / 140) } : undefined}
      className={`wk-gauge is-${level} ${red > 0 ? 'has-red' : ''} ${glow ? 'is-glow' : ''}`}
      onPointerMove={(e) => {
        const r = root.current!.getBoundingClientRect()
        const dx = (e.clientX - r.left) / r.width - 0.5
        const dy = (e.clientY - r.top) / r.height - 0.5
        if (glass.current) glass.current.style.transform = `translate(${(dx * 10).toFixed(1)}px, ${(dy * 7).toFixed(1)}px)`
      }}
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => {
        if (glass.current) glass.current.style.transform = ''
        setHover(null)
        setArmed(null)
        setOver(false)
      }}
    >
      <svg viewBox="0 0 140 118" aria-hidden={!segs.length}>
        <defs>
          <radialGradient id={`f${uid}`} cx="50%" cy="42%" r="62%">
            <stop offset="0" stopColor="var(--wk-face-1)" />
            <stop offset="1" stopColor="var(--wk-face-2)" />
          </radialGradient>
          <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--wk-metal-1)" />
            <stop offset=".5" stopColor="var(--wk-metal-2)" />
            <stop offset="1" stopColor="var(--wk-metal-3)" />
          </linearGradient>
          <radialGradient id={`h${uid}`} cx="40%" cy="35%" r="70%">
            <stop offset="0" stopColor="var(--wk-metal-1)" />
            <stop offset="1" stopColor="var(--wk-metal-3)" />
          </radialGradient>
          <radialGradient id={`g${uid}`} cx="50%" cy="58%" r="55%">
            <stop offset="0" style={{ stopColor: 'var(--wk-lvl)', stopOpacity: 0.32 } as CSSProperties} />
            <stop offset="1" style={{ stopColor: 'var(--wk-lvl)', stopOpacity: 0 } as CSSProperties} />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r={R + 7} fill={`url(#b${uid})`} />
        <circle cx={CX} cy={CY} r={R + 4} fill={`url(#f${uid})`} />
        <circle cx={CX} cy={CY} r={R + 2} fill={`url(#g${uid})`} className="wk-g-glow" />
        {segs.length ? (
          <g className="wk-g-segs">
            {segs.map((sg, i) => {
              const [a1, a2] = segAt(i)
              return (
                <g key={sg.id} className={`wk-g-seg is-${sg.state} ${hover === i ? 'is-hover' : ''} ${armed === sg.id ? 'is-armed' : ''}`}>
                  <path d={arc(a1, a2, R - 2)} className="wk-g-seg-main" />
                  <path d={arc(a1, a2, R - 6)} className="wk-g-seg-rim" style={{ stroke: color(sg.companyId) }} />
                  <path
                    d={arc(a1 - gap / 2, a2 + gap / 2, R - 3)}
                    className="wk-g-seg-hit"
                    role="button"
                    tabIndex={0}
                    aria-label={`${sg.title}: ${sg.detail}`}
                    onPointerEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    onClick={(e) => {
                      ;(e.currentTarget as SVGPathElement).blur()
                      clickSeg(sg)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        clickSeg(sg)
                      }
                    }}
                  />
                </g>
              )
            })}
          </g>
        ) : (
          <>
            <path d={arc(MIN, MAX, R - 3)} className="wk-g-track" />
            <path d={arc(ang(0.9), MAX, R - 3)} className="wk-g-green" />
            {red > 0 && <path d={arc(MIN, redEnd, R - 3)} className="wk-g-red" />}
          </>
        )}
        <path ref={sweep} d="" className="wk-g-fill" />
        <g ref={tickBox} className="wk-g-ticks">
          {ticks}
        </g>
        <g className="wk-g-labels">{labels}</g>
        <g ref={needle} className="wk-g-needle" transform={`rotate(${MIN} ${CX} ${CY})`}>
          <path d={`M${CX - 2.2} ${CY + 9} L${CX - 0.7} ${CY - R + 10} L${CX + 0.7} ${CY - R + 10} L${CX + 2.2} ${CY + 9} Z`} />
        </g>
        <circle cx={CX} cy={CY} r="7.5" fill={`url(#h${uid})`} className="wk-g-hub" />
        <circle cx={CX} cy={CY} r="2.2" className="wk-g-pin" />
      </svg>
      <div ref={glass} className="wk-gauge-glass" aria-hidden="true" />
      <span className="wk-gauge-ring" aria-hidden="true" />
      <button className="wk-gauge-hub" onPointerEnter={blip} onClick={rev} aria-label="Acelerar o ponteiro" title="Acelerar" />
      {onPeek ? null : hov ? (
        <div className={`wk-gauge-tip is-${hov.state}`} role="tooltip">
          <b>{hov.title}</b>
          <span>{armed === hov.id ? 'Clique de novo para concluir' : hov.detail}</span>
        </div>
      ) : (
        over &&
        summary && (
          <div className="wk-gauge-tip" role="tooltip">
            <span>{summary}</span>
          </div>
        )
      )}
      <div className="wk-gauge-read">{children}</div>
    </div>
  )
}
