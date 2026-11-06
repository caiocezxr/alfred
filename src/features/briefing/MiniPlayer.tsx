import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { briefingPlayer, useBriefingPlayer, voiceProgressLabel } from './player.ts'
import { IconClose, IconLeft, IconPause, IconPlay, IconRight, Wave } from './ui.tsx'

let cardsVisible = 0
let floatingEnabled = true
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function setFloatingMiniPlayer(enabled: boolean) {
  floatingEnabled = enabled
  emit()
}

export function useCardPresence(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return
    let visible = false
    const flip = (v: boolean) => {
      if (v === visible) return
      visible = v
      cardsVisible += v ? 1 : -1
      emit()
    }
    const io = new IntersectionObserver((es) => flip(es.some((e) => e.isIntersecting)), { threshold: 0.15 })
    io.observe(el)
    return () => {
      io.disconnect()
      flip(false)
    }
  }, [el])
}

export function MiniPlayer({ onExpand, onClose }: { onExpand?: () => void; onClose?: () => void }) {
  const p = useBriefingPlayer()
  const prog = useRef<HTMLSpanElement>(null)
  const live = p.status === 'playing' || p.status === 'loading' || p.status === 'paused'
  useEffect(() => {
    if (!live) return
    let raf = 0
    const tick = () => {
      if (prog.current) prog.current.style.transform = `scaleX(${briefingPlayer.totalProgress()})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [live])
  if (!live || !p.program) return null
  const ch = p.program.chapters[p.chapter]
  const items = p.program.chapters.filter((c) => c.kind === 'item')
  const n = ch?.kind === 'item' ? items.indexOf(ch) + 1 : 0
  const wait = p.status === 'loading' || p.buffering ? (voiceProgressLabel(p.voice) ?? 'preparando a voz…') : null
  const playing = p.status !== 'paused'
  return (
    <div className={`brf-mini ${ch?.area ? `brf-a-${ch.area}` : ''}`} role="region" aria-label="Briefing tocando">
      <span className="brf-mini-prog" ref={prog} aria-hidden="true" />
      <Wave live={playing && !wait} />
      <button className="brf-mini-text" onClick={onExpand} disabled={!onExpand} title={onExpand ? 'Abrir a apresentação' : undefined}>
        <span className="brf-mini-k">{wait ?? (n ? `Briefing · ${n} de ${items.length}` : 'Briefing do dia')}</span>
        <span className="brf-mini-t">{ch?.label ?? ''}</span>
      </button>
      <button className="brf-mini-b" onClick={() => briefingPlayer.prev()} aria-label="História anterior">
        <IconLeft />
      </button>
      <button className="brf-mini-b is-main" onClick={() => briefingPlayer.toggle()} aria-label={playing ? 'Pausar' : 'Continuar'}>
        {playing ? <IconPause size={13} /> : <IconPlay size={13} />}
      </button>
      <button className="brf-mini-b" onClick={() => briefingPlayer.next()} aria-label="Próxima história">
        <IconRight />
      </button>
      <button className="brf-mini-b" onClick={() => (briefingPlayer.stop(), onClose?.())} aria-label="Parar">
        <IconClose />
      </button>
    </div>
  )
}

function Floating() {
  const show = useSyncExternalStore(subscribe, () => floatingEnabled && cardsVisible <= 0)
  if (!show) return null
  return (
    <div className="brf-mini-float">
      <MiniPlayer />
    </div>
  )
}

let root: Root | null = null
export function ensureFloatingMiniPlayer() {
  if (root || typeof document === 'undefined') return
  const el = document.createElement('div')
  el.id = 'brf-mini-root'
  document.body.appendChild(el)
  root = createRoot(el)
  root.render(<Floating />)
}
