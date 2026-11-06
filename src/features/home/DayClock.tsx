import { useEffect, useRef, useState } from 'react'
import type { City } from './geo'

const rad = (d: number) => (d * Math.PI) / 180

function sunTimes(date: Date, lat: number, lon: number) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000)
  const g = ((2 * Math.PI) / 365) * (day - 1)
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const ha = Math.acos(Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl))
  const noon = 720 - 4 * lon - eq
  const rise = noon - (4 * ha * 180) / Math.PI
  const set = noon + (4 * ha * 180) / Math.PI
  const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return { rise: new Date(base + rise * 60000), set: new Date(base + set * 60000) }
}

const hm = (d: Date, tz: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d)

function parts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz }).formatToParts(d)
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0)
  return { h: get('hour') % 24, m: get('minute'), s: get('second') }
}

const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  return h ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m} min`
}

function Digit({ v }: { v: string }) {
  return (
    <span className="dc-digit">
      <span key={v} className="dc-digit-in">
        {v}
      </span>
    </span>
  )
}

export function DayClock({ city }: { city: City }) {
  const [now, setNow] = useState(() => new Date())
  const hands = useRef<SVGGElement>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let raf = 0
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = () => {
      const d = new Date()
      const { h, m, s } = parts(d, city.tz)
      const ms = reduce ? 0 : d.getMilliseconds()
      const el = hands.current
      if (el) {
        const [hh, mm, ss] = el.children as unknown as SVGElement[]
        hh?.setAttribute('transform', `rotate(${((h % 12) + m / 60) * 30} 20 20)`)
        mm?.setAttribute('transform', `rotate(${(m + s / 60) * 6} 20 20)`)
        ss?.setAttribute('transform', `rotate(${(s + ms / 1000) * 6} 20 20)`)
      }
      if (!reduce && !document.hidden) raf = requestAnimationFrame(tick)
    }
    tick()
    const vis = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) raf = requestAnimationFrame(tick)
    }
    document.addEventListener('visibilitychange', vis)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [city.tz])

  const { rise, set } = sunTimes(now, city.lat, city.lon)
  const day = now >= rise && now <= set
  const p = Math.min(1, Math.max(0, (now.getTime() - rise.getTime()) / (set.getTime() - rise.getTime())))
  const nextRise = now > set ? sunTimes(new Date(now.getTime() + 86400000), city.lat, city.lon).rise : rise
  const time = hm(now, city.tz)
  const sx = 4 + p * 112
  const sy = 26 * (1 - p) ** 2 - 28 * (1 - p) * p + 26 * p * p

  return (
    <div className={`dc ${day ? 'is-day' : 'is-night'}`}>
      <svg className="dc-watch" viewBox="0 0 40 40" aria-hidden="true">
        <circle className="dc-bezel" cx="20" cy="20" r="18.5" />
        <circle className="dc-face" cx="20" cy="20" r="16" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = rad(i * 30)
          const r1 = i % 3 === 0 ? 11.5 : 13
          return <line key={i} className={i % 3 === 0 ? 'is-major' : ''} x1={20 + Math.sin(a) * r1} y1={20 - Math.cos(a) * r1} x2={20 + Math.sin(a) * 14.6} y2={20 - Math.cos(a) * 14.6} />
        })}
        <g ref={hands}>
          <line className="dc-h" x1="20" y1="22" x2="20" y2="11.5" />
          <line className="dc-m" x1="20" y1="23" x2="20" y2="7.5" />
          <line className="dc-s" x1="20" y1="24.5" x2="20" y2="6" />
        </g>
        <circle className="dc-pin" cx="20" cy="20" r="1.4" />
      </svg>

      <div className="dc-read">
        <span className="dc-time" aria-label={time}>
          {[...time].map((ch, i) => (ch === ':' ? <span key={i} className="dc-colon">:</span> : <Digit key={i} v={ch} />))}
        </span>
        <span className="dc-city">{city.name}</span>
      </div>

      <div className="dc-sun" title={`Nascer ${hm(rise, city.tz)} · pôr ${hm(set, city.tz)}`}>
        <svg viewBox="0 0 120 30" aria-hidden="true">
          <path className="dc-arc" d="M4 26 Q60 -14 116 26" pathLength={100} />
          <path className="dc-arc-done" d="M4 26 Q60 -14 116 26" pathLength={100} style={{ strokeDasharray: 100, strokeDashoffset: 100 - 100 * p }} />
          <line className="dc-horizon" x1="0" y1="26" x2="120" y2="26" />
          {day && <circle className="dc-sun-dot" cx={sx} cy={sy} r="3.2" />}
        </svg>
        <span className="dc-sun-label">{day ? `${span(set.getTime() - now.getTime())} de sol` : `sol em ${span(nextRise.getTime() - now.getTime())}`}</span>
      </div>
    </div>
  )
}
