import { useEffect, useMemo, useRef, useState } from 'react'
import { describe, type Weather } from './weather'

type Phase = 'night' | 'dawn' | 'day' | 'golden' | 'dusk'

const SKY: Record<Phase, [string, string, string]> = {
  night: ['#04060d', '#0b1226', '#1a2240'],
  dawn: ['#2b3a66', '#c9826b', '#f4c48a'],
  day: ['#3f7fc4', '#79b3e3', '#cfe6f5'],
  golden: ['#4a6fa8', '#e6a462', '#ffd9a0'],
  dusk: ['#1b1d3d', '#7a3d5c', '#e0815a'],
}

function phaseOf(h: number): Phase {
  if (h < 5 || h >= 18.6) return 'night'
  if (h < 6.4) return 'dawn'
  if (h < 16.4) return 'day'
  if (h < 17.6) return 'golden'
  return 'dusk'
}

function hourNow() {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}

export function LiveSky({ weather }: { weather: Weather | null }) {
  const [hour, setHour] = useState(hourNow)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const id = setInterval(() => setHour(hourNow()), 60_000)
    return () => clearInterval(id)
  }, [])

  const phase = phaseOf(hour)
  const kind = weather ? describe(weather.code).icon : 'sun'
  const wet = kind === 'rain' || kind === 'drizzle' || kind === 'storm'
  const cloudCount = kind === 'sun' ? 1 : kind === 'partly' ? 4 : 7
  const night = phase === 'night'
  const t = Math.min(1, Math.max(0, (hour - 5.5) / (17.8 - 5.5)))
  const sunX = night ? 72 : 12 + 76 * t
  const sunY = night ? 22 : 92 - Math.sin(Math.PI * t) * 70
  const [a, b, c] = SKY[phase]
  const grey = kind === 'cloud' || wet || kind === 'fog'

  const clouds = useMemo(
    () =>
      Array.from({ length: cloudCount }, (_, i) => ({
        top: 6 + ((i * 37) % 48),
        w: 22 + ((i * 53) % 26),
        dur: 90 + ((i * 41) % 80),
        delay: -((i * 29) % 90),
        o: 0.35 + ((i * 17) % 30) / 100,
      })),
    [cloudCount],
  )

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const stars = night ? Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random() * 0.7, r: Math.random() * 1.1 + 0.2, a: 0.3 + Math.random() * 0.45 })) : []
    const drops = wet ? Array.from({ length: kind === 'drizzle' ? 70 : 150 }, () => ({ x: Math.random() * 1.1, y: Math.random(), l: 8 + Math.random() * 14 })) : []
    const paint = () => {
      const w = cv.clientWidth
      const h = cv.clientHeight
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      for (const st of stars) {
        ctx.fillStyle = `rgba(255,255,255,${st.a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(st.x * w, st.y * h, st.r, 0, Math.PI * 2)
        ctx.fill()
      }
      if (drops.length) {
        ctx.strokeStyle = 'rgba(200,220,255,0.28)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (const d of drops) {
          ctx.moveTo(d.x * w, d.y * h)
          ctx.lineTo(d.x * w - d.l * 0.12, d.y * h + d.l)
        }
        ctx.stroke()
      }
    }
    paint()
    const ro = new ResizeObserver(paint)
    ro.observe(cv)
    return () => ro.disconnect()
  }, [night, wet, kind])

  return (
    <div
      className={`sky is-${phase} ${grey ? 'is-grey' : ''} is-${kind}`}
      style={{ ['--s1' as string]: a, ['--s2' as string]: b, ['--s3' as string]: c, ['--sx' as string]: `${sunX}%`, ['--sy' as string]: `${sunY}%` }}
      aria-hidden="true"
    >
      <div className="sky-grad" />
      <div className={`sky-orb ${night ? 'is-moon' : ''}`} />
      <div className="sky-clouds">
        {clouds.map((cl, i) => (
          <i key={i} style={{ top: `${cl.top}%`, width: `${cl.w}%`, animationDuration: `${cl.dur}s`, animationDelay: `${cl.delay}s`, opacity: cl.o }} />
        ))}
      </div>
      <canvas ref={canvas} className="sky-fx" />
    </div>
  )
}
