import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { narrator } from './voice.ts'
import { vote, useBriefing } from './store.ts'
import { AREA_LABEL, REASON_LABEL, type Area, type BriefItem, type Reason } from './types.ts'

const I = ({ d, size = 16, stroke = 1.6, fill = 'none' }: { d: string; size?: number; stroke?: number; fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d={d} fill={fill} stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
export const IconPlay = ({ size = 14 }: { size?: number }) => <I size={size} d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
export const IconPause = ({ size = 14 }: { size?: number }) => <I size={size} d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z" fill="currentColor" />
export const IconLeft = () => <I d="M10 3.5L5.5 8l4.5 4.5" />
export const IconRight = () => <I d="M6 3.5L10.5 8 6 12.5" />
export const IconClose = () => <I d="M4 4l8 8M12 4l-8 8" />
export const IconMore = () => <I d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke={2.6} />
export const IconExternal = () => <I size={13} d="M9.5 3H13v3.5M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />
export const IconChevron = ({ open }: { open?: boolean }) => (
  <span className={`brf-chev ${open ? 'is-open' : ''}`}>
    <I size={12} d="M4 6l4 4 4-4" />
  </span>
)
export const IconUp = () => (
  <I d="M5 7.2V13H3.2a.7.7 0 0 1-.7-.7V7.9a.7.7 0 0 1 .7-.7zM5 7.2l2.6-4.6a1.3 1.3 0 0 1 2.3 1.1L9.2 6.4h3.3a1.2 1.2 0 0 1 1.2 1.4l-.8 4.2a1.2 1.2 0 0 1-1.2 1H5" stroke={1.4} />
)
export const IconDown = () => (
  <span style={{ display: 'inline-flex', transform: 'scaleY(-1)' }}>
    <IconUp />
  </span>
)
export const IconStar = ({ on }: { on?: boolean }) => (
  <I d="M8 2.2l1.75 3.6 3.95.55-2.86 2.8.68 3.95L8 11.25 4.48 13.1l.68-3.95L2.3 6.35l3.95-.55z" stroke={1.3} fill={on ? 'currentColor' : 'none'} />
)
export const IconSpark = () => <I size={13} d="M8 1.8v3.4M8 10.8v3.4M1.8 8h3.4M10.8 8h3.4M3.6 3.6l2 2M10.4 10.4l2 2M12.4 3.6l-2 2M5.6 10.4l-2 2" stroke={1.3} />
export const IconCards = () => <I d="M4.5 3.5h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM6 1.8h6.5a1.5 1.5 0 0 1 1.5 1.5v8" stroke={1.3} />
export const IconUser = () => <I d="M8 8a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 8 8zM3 13.6c.6-2.4 2.6-3.6 5-3.6s4.4 1.2 5 3.6" stroke={1.4} />
export const IconRedo = () => <I d="M13 8a5 5 0 1 1-1.5-3.6M13 2.6v2.6h-2.6" stroke={1.4} />
export const IconCheck = () => <I size={12} d="M3.2 8.3l3 3 6.6-6.6" stroke={1.9} />

export function AreaDot({ area }: { area: Area }) {
  return <span className={`brf-dot brf-a-${area}`} aria-hidden="true" />
}

export function AreaChip({ area, count, children }: { area: Area; count?: number; children?: ReactNode }) {
  return (
    <span className={`brf-chip brf-a-${area}`}>
      <AreaDot area={area} />
      {children ?? AREA_LABEL[area]}
      {count !== undefined && <b>{count}</b>}
    </span>
  )
}

export function VoiceOrb({ size = 120, active = false, thinking = false, className = '' }: { size?: number; active?: boolean; thinking?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ active, thinking })
  useEffect(() => {
    live.current = { active, thinking }
  }, [active, thinking])
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = size * dpr
    cv.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const N = 64
    const bands = new Float32Array(N)
    const shown = new Float32Array(N)
    let color = toRgb(getComputedStyle(cv).color)
    let colorAt = 0
    let raf = 0
    let lvl = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (document.hidden) return
      if (now - colorAt > 1000) {
        color = toRgb(getComputedStyle(cv).color)
        colorAt = now
      }
      const t = now / 1000
      const speaking = live.current.active && narrator.speaking && !narrator.isPaused
      const target = speaking ? narrator.level() : 0
      lvl += (target - lvl) * 0.2
      if (speaking) narrator.bands(bands)
      else for (let i = 0; i < N; i++) bands[i] = live.current.thinking ? 0.18 + 0.18 * Math.sin(t * 3 - i * 0.35) ** 2 : 0
      const c = size / 2
      ctx.clearRect(0, 0, size, size)
      const breathe = reduced ? 0 : 0.035 * Math.sin(t * 1.6)
      const r0 = size * 0.25 * (1 + breathe + lvl * 0.16)
      const glow = ctx.createRadialGradient(c, c, r0 * 0.2, c, c, size * 0.5)
      glow.addColorStop(0, withAlpha(color, 0.34 + lvl * 0.4))
      glow.addColorStop(0.45, withAlpha(color, 0.1 + lvl * 0.18))
      glow.addColorStop(1, withAlpha(color, 0))
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, size, size)
      const core = ctx.createRadialGradient(c - r0 * 0.3, c - r0 * 0.35, r0 * 0.1, c, c, r0)
      core.addColorStop(0, withAlpha('#ffffff', 0.85))
      core.addColorStop(0.35, withAlpha(color, 0.95))
      core.addColorStop(1, withAlpha(color, 0.35))
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(c, c, r0, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(1.2, size / 110)
      const inner = r0 + size * 0.05
      const maxLen = size * 0.17
      for (let i = 0; i < N; i++) {
        const v = bands[(i * 7) % N]
        shown[i] += (v - shown[i]) * (v > shown[i] ? 0.55 : 0.14)
        const len = 1.5 + shown[i] * maxLen
        const a = (i / N) * Math.PI * 2 - Math.PI / 2
        ctx.strokeStyle = withAlpha(color, 0.28 + shown[i] * 0.7)
        ctx.beginPath()
        ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner)
        ctx.lineTo(c + Math.cos(a) * (inner + len), c + Math.sin(a) * (inner + len))
        ctx.stroke()
      }
      const spin = reduced ? 0 : t * (live.current.thinking ? 1.6 : 0.35)
      ctx.lineWidth = Math.max(1, size / 160)
      ctx.strokeStyle = withAlpha(color, 0.45)
      ctx.beginPath()
      ctx.arc(c, c, size * 0.46, spin, spin + 1.1)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(c, c, size * 0.46, spin + Math.PI, spin + Math.PI + 0.5)
      ctx.stroke()
      ctx.strokeStyle = withAlpha(color, 0.22)
      ctx.beginPath()
      ctx.arc(c, c, size * 0.41, -spin * 1.4, -spin * 1.4 + 2.2)
      ctx.stroke()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [size])
  return <canvas ref={ref} className={`brf-orb ${className}`} style={{ width: size, height: size }} aria-hidden="true" />
}

const rgbCache = new Map<string, string>()
let probe: CanvasRenderingContext2D | null = null

function toRgb(c: string): string {
  const hit = rgbCache.get(c)
  if (hit) return hit
  if (!probe) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    probe = cv.getContext('2d', { willReadFrequently: true })
  }
  if (!probe) return c
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = c
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  const out = `rgb(${r}, ${g}, ${b})`
  rgbCache.set(c, out)
  return out
}

function withAlpha(c: string, a: number): string {
  const al = Math.max(0, Math.min(1, a)).toFixed(3)
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const [r, g, b] = m[1].split(/[\s,/]+/).filter(Boolean)
    return `rgba(${r}, ${g}, ${b}, ${al})`
  }
  const h = c.match(/^#([0-9a-f]{6})$/i)
  if (h) {
    const n = parseInt(h[1], 16)
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${al})`
  }
  return c
}

export function CountUp({ value, format, from, duration = 1100, delay = 0 }: { value: number; format: (n: number) => string; from?: number; duration?: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = from ?? 0
    if (reduced) {
      el.textContent = format(value)
      return
    }
    el.textContent = format(start)
    let raf = 0
    const t0 = performance.now() + delay
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / duration))
      const e = 1 - Math.pow(2, -10 * p)
      el.textContent = format(start + (value - start) * (p >= 1 ? 1 : e))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, from, duration, delay, format])
  return <span ref={ref} className="brf-num" />
}

const UP_REASONS: Reason[] = ['more']
const DOWN_REASONS: Reason[] = ['knew', 'shallow', 'not_mine']

export function Votes({ item, origin, kept = true, compact = false }: { item: BriefItem; origin: 'slide' | 'left_out'; kept?: boolean; compact?: boolean }) {
  const v = useBriefing().votes.get(item.key)
  const [flash, setFlash] = useState(0)
  const signal = v?.signal
  const reasons = signal === 'up' ? UP_REASONS : signal === 'down' ? DOWN_REASONS : []
  const act = (s: 'up' | 'down', r: Reason | null = null) => {
    void vote(item, s, origin, r, kept)
    setFlash((n) => n + 1)
  }
  return (
    <div className={`brf-votes ${compact ? 'is-compact' : ''}`}>
      <button className={`brf-vote ${signal === 'up' ? 'is-on' : ''}`} onClick={() => act('up')} aria-pressed={signal === 'up'} title="Gostei — mais disso">
        <IconUp />
      </button>
      <button className={`brf-vote ${signal === 'down' ? 'is-on is-down' : ''}`} onClick={() => act('down')} aria-pressed={signal === 'down'} title="Não agregou">
        <IconDown />
      </button>
      {reasons.length > 0 && (
        <div className="brf-reasons" key={signal}>
          {reasons.map((r) => (
            <button key={r} className={`brf-reason ${v?.reason === r ? 'is-on' : ''}`} onClick={() => act(signal as 'up' | 'down', v?.reason === r ? null : r)}>
              {REASON_LABEL[r]}
            </button>
          ))}
        </div>
      )}
      {flash > 0 && signal && (
        <span className="brf-noted" key={flash}>
          anotado
        </span>
      )}
    </div>
  )
}

export function useOutside(open: boolean, onClose: () => void, ...refs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return
      onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [open, onClose])
}
