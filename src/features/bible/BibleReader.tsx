import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/400-italic.css'
import '@fontsource/eb-garamond/500.css'
import '@fontsource/cormorant-garamond/500.css'
import './bible.css'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { BookController, FONT_SCALES, type Selection } from './controller'
import { formatRef, loadBible, type Bible, type VerseRef } from './data/bible'
import { takeBibleTarget } from '../../app/router'
import { BookScene } from './three/BookScene'
import { BACKGROUNDS, COVERS, backgroundImage, backgroundOf, backgroundThumb, normalizeBackground, type BackgroundIcon } from './three/ambience'
import { startAmbient, stopAmbient } from './ambientSound'
import { preloadSounds } from './sound'
import { NoteCard } from './ui/NoteCard'
import { NotesPanel } from './ui/NotesPanel'
import { TodayPanel } from './ui/TodayPanel'
import { ReadingMeter } from './ui/ReadingMeter'

async function loadFonts() {
  await Promise.all([
    document.fonts.load('400 24px "EB Garamond"', 'Áá'),
    document.fonts.load('italic 400 24px "EB Garamond"', 'Áá'),
    document.fonts.load('500 24px "EB Garamond"', 'Áá'),
    document.fonts.load('500 24px "Cormorant Garamond"', 'Áá0123'),
  ])
}

export default function BibleReader() {
  const [bible, setBible] = useState<Bible | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    Promise.all([loadBible(), loadFonts()])
      .then(([b]) => setBible(b))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  if (error) {
    return (
      <div className="bible-state">
        <p>{error}</p>
        <button className="btn" onClick={load}>Tentar de novo</button>
      </div>
    )
  }
  if (!bible) {
    return (
      <div className="bible is-loading" aria-busy="true">
        <BibleBackdrop id={savedBackground()} />
        <span className="bible-loading" />
      </div>
    )
  }
  return <Reader bible={bible} />
}

function savedBackground() {
  try {
    return normalizeBackground(JSON.parse(localStorage.getItem('ps.bible.v2') ?? 'null')?.background)
  } catch {
    return normalizeBackground(null)
  }
}

let resumeOpen = false

type Panel = null | 'notes' | 'today' | 'settings' | 'ambience'

function Reader({ bible }: { bible: Bible }) {
  const controller = useMemo(() => new BookController(bible), [bible])
  useEffect(() => controller.attach(), [controller])
  useEffect(() => preloadSounds(), [])
  if (import.meta.env.DEV) (window as unknown as { __bible: BookController }).__bible = controller
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [indexOpen, setIndexOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [cardAnchor, setCardAnchor] = useState<{ x: number; y: number } | null>(null)
  const [used, setUsed] = useState(0)
  const [ritual, setRitual] = useState(false)
  const [breath, setBreath] = useState(0)
  const stage = useRef<HTMLDivElement>(null)

  const enterRitual = useCallback(() => {
    if (!controller.isOpen) controller.open()
    setPanel(null)
    setRitual(true)
    setBreath(1)
    const leftPage = controller.pageAt(controller.pos, 'left')
    const a = controller.anchor
    const onLeft = leftPage.lastRef && (leftPage.lastRef.chapter > a.chapter || (leftPage.lastRef.chapter === a.chapter && leftPage.lastRef.verse >= a.verse))
    setTimeout(() => controller.focus(onLeft === false ? 'right' : 'left'), 400)
  }, [controller])
  const exitRitual = useCallback(() => {
    setRitual(false)
    setBreath(0)
    stopAmbient()
    controller.resetView()
  }, [controller])

  useEffect(() => {
    if (!breath) return
    const t1 = setTimeout(() => setBreath(2), 2600)
    const t2 = setTimeout(() => setBreath(0), 5600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [breath === 1])

  useEffect(() => {
    if (ritual && snap.ambientSound) startAmbient(backgroundOf(snap.background).light.sound)
    else stopAmbient()
  }, [ritual, snap.ambientSound, snap.background])
  useEffect(() => () => stopAmbient(0.4), [])
  useEffect(() => {
    const root = document.documentElement
    if (ritual) root.dataset.ritual = '1'
    else delete root.dataset.ritual
    return () => {
      delete root.dataset.ritual
    }
  }, [ritual])

  const openNote = useCallback(
    (sel: Selection, at: { x: number; y: number }) => {
      controller.select(sel)
      setCardAnchor(at)
    },
    [controller],
  )
  const closeNote = useCallback(() => {
    controller.select(null)
    setCardAnchor(null)
  }, [controller])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => (controller.reducedMotion = mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [controller])

  const [fromVerse, setFromVerse] = useState(false)
  useEffect(() => {
    const target = takeBibleTarget()
    let unmark = 0
    if (target) {
      controller.goTo(target)
      controller.select({ book: target.book, chapter: target.chapter, verse: target.verse })
      unmark = window.setTimeout(() => {
        const s = controller.selection
        if (s && s.book === target.book && s.chapter === target.chapter && s.verse === target.verse) controller.select(null)
      }, 7000)
      setFromVerse(true)
    }
    if (resumeOpen) controller.snapOpen(true)
    controller.prefetch()
    return () => {
      clearTimeout(unmark)
      resumeOpen = controller.isOpen
    }
  }, [controller])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        if (ritual && !indexOpen && !cardAnchor) {
          exitRitual()
          return
        }
        if (indexOpen) setIndexOpen(false)
        else if (cardAnchor) closeNote()
        else if (panel) setPanel(null)
        else if (controller.zoomed) controller.resetView()
        return
      }
      if (indexOpen) return
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault()
          if (!controller.isOpen) controller.open()
          else controller.forward()
          setUsed((n) => n + 1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          controller.backward()
          setUsed((n) => n + 1)
          break
        case 'ArrowDown':
          if (controller.zoomed) controller.pan(0, 120)
          break
        case 'ArrowUp':
          if (controller.zoomed) controller.pan(0, -120)
          break
        case 'Enter':
          if (!controller.isOpen) controller.open()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          controller.toggleFocus()
          break
        case '0':
          controller.resetView()
          break
        case '+':
        case '=':
          controller.stepFont(1)
          break
        case '-':
          controller.stepFont(-1)
          break
        case 'i':
          e.preventDefault()
          setIndexOpen(true)
          break
        case 'n':
          e.preventDefault()
          setPanel((p) => (p === 'notes' ? null : 'notes'))
          break
        case 'h':
          e.preventDefault()
          setPanel((p) => (p === 'today' ? null : 'today'))
          break
        case 'm':
        case 'M':
          e.preventDefault()
          if (controller.isOpen) controller.toggleMarker()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, indexOpen, cardAnchor, panel, closeNote, ritual, exitRitual])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    type Gesture = { dir: 0 | 1 | -1; acc: number; dragging: boolean; failed: boolean; vel: number; lastT: number; lastMag: number; decay: number; corner: number }
    let g: Gesture | null = null
    let endTimer = 0
    let ignoreUntil = 0
    let lastMag = 0
    let focusAcc = 0
    const physicalX = (e: WheelEvent) => {
      const inv = (e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean }).webkitDirectionInvertedFromDevice
      return inv === false ? e.deltaX : -e.deltaX
    }
    const progress = (gs: Gesture) => Math.max(0, (gs.acc * gs.dir) / Math.max(1, 1 / controller.worldPerPx))
    const finish = () => {
      const gs = g
      g = null
      if (!gs || gs.dir === 0 || gs.failed) return
      const u = progress(gs)
      const fast = gs.vel * gs.dir > 0.9
      const commit = u > 0.35 || (fast && u > 0.04)
      const strength = Math.min(1, 0.3 + Math.abs(gs.vel) / 2.4)
      ignoreUntil = performance.now() + 420
      if (gs.dragging) controller.endDrag(commit, strength)
      else if (commit) {
        if (gs.dir === 1) controller.forward()
        else controller.backward()
      }
      if (commit) setUsed((n) => n + 1)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey) {
        controller.zoomAt(Math.exp(-e.deltaY * 0.0125), e.clientX, e.clientY)
        return
      }
      const now = performance.now()
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      const mag = Math.hypot(e.deltaX, e.deltaY)
      if (!g && now < ignoreUntil) {
        if (mag <= lastMag * 1.15 + 1) ignoreUntil = Math.max(ignoreUntil, now + 140)
        lastMag = mag
        return
      }
      lastMag = mag
      if (controller.zoomed) {
        if (horizontal && controller.inFocus) {
          focusAcc += physicalX(e)
          if (Math.abs(focusAcc) > 90) {
            if (focusAcc > 0) controller.forward()
            else controller.backward()
            focusAcc = 0
            ignoreUntil = now + 420
            setUsed((n) => n + 1)
          }
          return
        }
        controller.pan(e.deltaX, e.deltaY)
        return
      }
      if (!controller.isOpen) return
      if (!g) {
        if (!horizontal) {
          if (e.deltaY < -2 && Math.abs(e.deltaY) > 18) controller.zoomAt(1.12, e.clientX, e.clientY)
          return
        }
        g = { dir: 0, acc: 0, dragging: false, failed: false, vel: 0, lastT: now, lastMag: mag, decay: 0, corner: ((e.clientY / window.innerHeight) * 2 - 1) * 0.9 }
      }
      const gs = g
      const dx = physicalX(e)
      const dtMs = Math.max(4, now - gs.lastT)
      gs.vel = gs.vel * 0.6 + (dx / dtMs) * 0.4
      gs.lastT = now
      gs.acc += dx
      if (gs.dir === 0 && Math.abs(gs.acc) > 6) {
        gs.dir = gs.acc > 0 ? 1 : -1
        if (!controller.reducedMotion) {
          gs.dragging = controller.beginDrag(gs.dir, gs.corner)
          gs.failed = !gs.dragging
        } else gs.failed = gs.dir === 1 ? !controller.getSnapshot().canNext : !controller.getSnapshot().canPrev
      }
      gs.decay = mag < gs.lastMag ? gs.decay + 1 : 0
      gs.lastMag = mag
      if (gs.dragging) controller.dragTo(progress(gs))
      const u = gs.dir ? progress(gs) : 0
      if (gs.dir !== 0 && !gs.failed && (u > 0.92 || (gs.decay >= 5 && u > 0.35))) {
        clearTimeout(endTimer)
        finish()
        return
      }
      clearTimeout(endTimer)
      endTimer = window.setTimeout(finish, 110)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      clearTimeout(endTimer)
    }
  }, [controller])

  const press = useRef<{ x: number; y: number; t: number; lastX: number; lastY: number; lastT: number; vx: number; mode: 'pending' | 'turn' | 'pan' | 'lid-pending' | 'lid'; dir: 1 | -1; edge: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (!controller.isOpen) {
      if (!controller.overClosedBook(e.clientX, e.clientY)) return
      const now = performance.now()
      press.current = { x: e.clientX, y: e.clientY, t: now, lastX: e.clientX, lastY: e.clientY, lastT: now, vx: 0, mode: 'lid-pending', dir: 1, edge: false }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    const ph = controller.pointerHit(e.clientX, e.clientY)
    const now = performance.now()
    press.current = {
      x: e.clientX, y: e.clientY, t: now, lastX: e.clientX, lastY: e.clientY, lastT: now, vx: 0,
      mode: 'pending', dir: ph?.side === 'left' ? -1 : 1, edge: !!ph?.edge,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    const pr = press.current
    if (pr) {
      const now = performance.now()
      pr.vx = (e.clientX - pr.lastX) / Math.max(1, now - pr.lastT)
      const dX = e.clientX - pr.lastX
      const dY = e.clientY - pr.lastY
      pr.lastX = e.clientX
      pr.lastY = e.clientY
      pr.lastT = now
      if (pr.mode === 'lid-pending' && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > 6) {
        if (controller.beginLidDrag(pr.x, pr.y)) pr.mode = 'lid'
      }
      if (pr.mode === 'lid') {
        controller.dragLid(e.clientX, e.clientY)
        el.style.cursor = 'grabbing'
        return
      }
      if (pr.mode === 'pending' && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > 7) {
        if (controller.zoomed && !pr.edge) pr.mode = 'pan'
        else if (controller.beginDrag(pr.dir, ((e.clientY / window.innerHeight) * 2 - 1) * 0.9)) pr.mode = 'turn'
      }
      if (pr.mode === 'pan') controller.pan(-dX, -dY)
      if (pr.mode === 'turn') {
        const pagePx = 1 / controller.worldPerPx
        controller.dragTo(((pr.x - e.clientX) * pr.dir) / (pagePx * 1.6))
        el.style.cursor = 'grabbing'
      }
      return
    }
    if (!controller.isOpen) {
      const over = controller.overClosedBook(e.clientX, e.clientY)
      controller.setLidHover(over)
      el.style.cursor = over ? 'grab' : 'default'
      return
    }
    const ph = controller.pointerHit(e.clientX, e.clientY)
    controller.setHover(ph?.edge ? (ph.side === 'right' ? 1 : -1) : 0, ph?.corner ?? 0.55)
    el.style.cursor = !ph ? 'default' : ph.edge ? 'grab' : ph.hit ? 'pointer' : 'default'
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const pr = press.current
    press.current = null
    if (!pr) return
    const el = e.currentTarget as HTMLElement
    el.style.cursor = 'default'
    if (pr.mode === 'lid') {
      controller.endLidDrag()
      return
    }
    if (pr.mode === 'lid-pending') {
      controller.open()
      return
    }
    if (pr.mode === 'turn') {
      const moved = ((pr.x - e.clientX) * pr.dir) / (1 / controller.worldPerPx)
      const flick = -pr.vx * pr.dir > 0.4
      controller.endDrag(flick || moved > 0.5, Math.min(1, 0.3 + Math.abs(pr.vx) / 2.4))
      setUsed((n) => n + 1)
      return
    }
    if (pr.mode === 'pan') return
    const ph = controller.pointerHit(e.clientX, e.clientY)
    if (!ph) {
      if (cardAnchor) closeNote()
      return
    }
    if (ph.edge) {
      if (ph.side === 'right') controller.forward()
      else controller.backward()
      setUsed((n) => n + 1)
      return
    }
    if (ph.hit && ph.page.book >= 0) {
      const sel: Selection = ph.hit.kind === 'verse'
        ? { book: ph.page.book, chapter: ph.hit.chapter, verse: ph.hit.verse }
        : { book: ph.page.book, chapter: ph.hit.chapter, verse: null }
      const same = snap.selection && snap.selection.book === sel.book && snap.selection.chapter === sel.chapter && snap.selection.verse === sel.verse
      if (same && cardAnchor) closeNote()
      else openNote(sel, { x: e.clientX, y: e.clientY })
    } else if (cardAnchor) closeNote()
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    const ph = controller.pointerHit(e.clientX, e.clientY)
    if (controller.zoomed) controller.resetView()
    else if (ph) controller.focus(ph.side)
    closeNote()
  }

  const goTo = (ref: VerseRef) => {
    controller.goTo(ref)
    if (!controller.isOpen) controller.open()
  }

  return (
    <div className={`bible ${ritual ? 'is-ritual' : ''}`} data-bg={snap.background}>
      <BibleBackdrop id={snap.background} />
      <div
        ref={stage}
        className="bible-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => {
          if (press.current) return
          controller.setHover(0)
          controller.setLidHover(false)
        }}
      >
        <BookScene controller={controller} background={snap.background} cover={snap.cover} />
      </div>

      <div className={`bible-invite ${snap.isOpen ? 'is-hidden' : ''}`} aria-hidden={snap.isOpen}>
        <span className="invite-kicker">{fromVerse ? 'Versículo do dia' : snap.resumed ? 'Continuar em' : 'Comece por'}</span>
        <span className="invite-ref">
          {bible.books[snap.ref.book]?.name ?? 'Gênesis'} {snap.ref.chapter + 1}
          {fromVerse || (snap.resumed && snap.ref.verse > 0) ? `:${snap.ref.verse + 1}` : ''}
        </span>
        <span className="invite-hint">Toque na capa, arraste ou tecle Enter para abrir</span>
      </div>

      <header className="bible-bar">
        <button className="bible-ref" onClick={() => setIndexOpen(true)} aria-haspopup="dialog" title="Índice (I)">
          <span className="bible-ref-kicker">Bíblia</span>
          <span className="bible-ref-label">{snap.label}</span>
          <Chevron />
        </button>
        {snap.marker && !snap.markerHere && snap.isOpen && (
          <button className="marker-go" onClick={() => controller.goToMarker()} title="Ir à página marcada com a fita">
            <RibbonIcon />
            Ir ao marcador · {formatRef(bible, snap.marker)}
          </button>
        )}
        <div className="bible-tools">
          <div className="tool-group">
            <button
              className={`icon-btn ${panel === 'settings' ? 'is-on' : ''}`}
              onClick={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
              aria-label="Ajustes de leitura"
              title="Ajustes de leitura"
            >
              <span className="aa">Aa</span>
            </button>
            <button
              className={`icon-btn ${snap.zoomed ? 'is-on' : ''}`}
              onClick={() => controller.toggleFocus()}
              aria-label={snap.zoomed ? 'Sair do foco' : 'Modo foco'}
              title={snap.zoomed ? 'Sair do foco (F)' : 'Modo foco: aproxima a página (F)'}
              disabled={!snap.isOpen}
            >
              <FocusIcon on={snap.zoomed} />
            </button>
          </div>
          <div className="tool-group">
            <button
              className={`icon-btn ${snap.markerHere ? 'is-on' : ''}`}
              onClick={() => controller.toggleMarker()}
              aria-pressed={snap.markerHere}
              aria-label={snap.markerHere ? 'Tirar o marcador desta página' : 'Marcar esta página com a fita'}
              title={snap.markerHere ? 'Tirar o marcador (M)' : 'Marcar esta página (M)'}
              disabled={!snap.isOpen}
            >
              <RibbonIcon />
            </button>
            <button
              className={`icon-btn ${panel === 'notes' ? 'is-on' : ''}`}
              onClick={() => setPanel((p) => (p === 'notes' ? null : 'notes'))}
              aria-label="Anotações"
              title="Anotações (N)"
            >
              <NoteIcon />
            </button>
            <button
              className={`icon-btn ${panel === 'today' ? 'is-on' : ''}`}
              onClick={() => setPanel((p) => (p === 'today' ? null : 'today'))}
              aria-label="Hoje: meta de leitura e gratidão"
              title="Hoje (H)"
            >
              <CalendarIcon />
            </button>
            <button
              className={`icon-btn ${panel === 'ambience' ? 'is-on' : ''}`}
              onClick={() => setPanel((p) => (p === 'ambience' ? null : 'ambience'))}
              aria-label="Ambiente: fundo de leitura e capa"
              title="Ambiente: fundo e capa"
            >
              <SunIcon />
            </button>
            <button
              className="icon-btn"
              onClick={() => (snap.isOpen ? controller.close() : controller.open())}
              aria-label={snap.isOpen ? 'Fechar o livro' : 'Abrir o livro'}
              title={snap.isOpen ? 'Fechar o livro' : 'Abrir o livro'}
            >
              <BookIcon open={snap.isOpen} />
            </button>
          </div>
        </div>
      </header>

      {panel === 'settings' && (
        <div className="settings-pop" role="dialog" aria-label="Ajustes de leitura">
          <div className="settings-row">
            <span>Tamanho do texto</span>
            <div className="stepper">
              <button onClick={() => controller.stepFont(-1)} disabled={snap.style.fontScale <= FONT_SCALES[0]} aria-label="Diminuir">
                <span style={{ fontSize: 12 }}>A</span>
              </button>
              <span className="stepper-val">{Math.round(snap.style.fontScale * 100)}%</span>
              <button onClick={() => controller.stepFont(1)} disabled={snap.style.fontScale >= FONT_SCALES[FONT_SCALES.length - 1]} aria-label="Aumentar">
                <span style={{ fontSize: 17 }}>A</span>
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span>Versículos</span>
            <div className="segmented small">
              <button aria-selected={snap.style.verseMode === 'lines'} onClick={() => controller.setVerseMode('lines')}>Um por linha</button>
              <button aria-selected={snap.style.verseMode === 'flow'} onClick={() => controller.setVerseMode('flow')}>Corrido</button>
            </div>
          </div>
          <div className="settings-row">
            <span>Som ambiente no momento de leitura</span>
            <button
              role="switch"
              aria-checked={snap.ambientSound}
              className={`switch ${snap.ambientSound ? 'is-on' : ''}`}
              onClick={() => controller.setAmbientSound(!snap.ambientSound)}
            >
              <span />
            </button>
          </div>
          <div className="settings-row">
            <span>Som da página</span>
            <button
              role="switch"
              aria-checked={snap.sound}
              className={`switch ${snap.sound ? 'is-on' : ''}`}
              onClick={() => controller.setSound(!snap.sound)}
            >
              <span />
            </button>
          </div>
          <div className={`settings-row ${snap.sound ? '' : 'is-off'}`}>
            <span>Volume</span>
            <input
              className="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={snap.volume}
              disabled={!snap.sound}
              aria-label="Volume dos sons do livro"
              onChange={(e) => controller.setVolume(Number(e.target.value))}
              onPointerUp={() => controller.previewSound()}
              onKeyUp={() => controller.previewSound()}
            />
          </div>
          <p className="settings-help">
            Pinça no trackpad aproxima onde você aponta · dois dedos deslizam a página · gesto lateral vira · duplo clique foca a página
          </p>
        </div>
      )}

      <nav className="bible-nav" aria-label="Virar página">
        <button className="nav-btn" disabled={!snap.canPrev || !snap.isOpen} onClick={() => controller.backward()} aria-label="Página anterior">
          <Arrow dir={-1} />
        </button>
        <button className="ritual-btn" onClick={enterRitual} disabled={ritual}>
          <CandleIcon />
          Momento de leitura
        </button>
        <div className="nav-center">
          <ReadingMeter bible={bible} first={snap.first} last={snap.last} visible={snap.isOpen && (snap.resumed || used > 3)} />
          <span className={`bible-hint ${used > 3 || snap.resumed || !snap.isOpen ? 'is-hidden' : ''}`}>
            Clique num versículo para anotar · ← → ou dois dedos para virar · M marca a página
          </span>
        </div>
        <button className="nav-btn" disabled={!snap.canNext || !snap.isOpen} onClick={() => controller.forward()} aria-label="Próxima página">
          <Arrow dir={1} />
        </button>
      </nav>

      {ritual && (
        <button className="ritual-exit" onClick={exitRitual}>
          Sair do momento <kbd>Esc</kbd>
        </button>
      )}
      {breath > 0 && (
        <div className="breath" aria-live="polite">
          <span className="breath-ring" />
          <p key={breath} className="breath-text">{breath === 1 ? 'Respire fundo.' : 'Leia devagar.'}</p>
        </div>
      )}

      {snap.selection && cardAnchor && (
        <NoteCard
          bible={bible}
          sel={snap.selection}
          anchor={cardAnchor}
          onClose={closeNote}
          onSelect={(s) => controller.select(s)}
        />
      )}

      {panel === 'ambience' && (
        <div className="amb-drawer" role="dialog" aria-label="Ambiente de leitura">
          <section className="amb-row">
            <h3>Fundo de leitura</h3>
            <div className="amb-strip">
              {BACKGROUNDS.map((b, i) => {
                const img = backgroundThumb(b.id)
                return (
                  <button
                    key={b.id}
                    className={`amb-bg reveal ${snap.background === b.id ? 'is-on' : ''}`}
                    style={{ ['--i' as string]: i, background: b.fallback }}
                    onClick={() => controller.setBackground(b.id)}
                    aria-pressed={snap.background === b.id}
                  >
                    {img && <img src={img} alt="" decoding="async" />}
                    <span>
                      <BgIcon icon={b.icon} />
                      {b.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
          <section className="amb-row">
            <h3>Modelo de Bíblia</h3>
            <div className="amb-strip covers">
              {COVERS.map((c, i) => (
                <button key={c.id} className={`amb-cover reveal ${snap.cover === c.id ? 'is-on' : ''}`} style={{ ['--i' as string]: i }} onClick={() => controller.setCover(c.id)}>
                  <span
                    className={`mini-book is-${c.kind} orn-${c.ornament}`}
                    style={{ ['--cover' as string]: c.base, ['--ink' as string]: c.ink }}
                  >
                    <i className="mb-cross" />
                    <b>BÍBLIA</b>
                    <small>SAGRADA</small>
                  </span>
                  <span className="amb-label">
                    {snap.cover === c.id && <Check />}
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {panel === 'notes' && (
        <NotesPanel
          bible={bible}
          onClose={() => setPanel(null)}
          onOpen={(n) => {
            goTo({ book: n.book, chapter: n.chapter, verse: n.verse ?? 0 })
            openNote({ book: n.book, chapter: n.chapter, verse: n.verse }, { x: window.innerWidth * 0.32, y: window.innerHeight * 0.35 })
          }}
        />
      )}
      {panel === 'today' && (
        <TodayPanel
          bible={bible}
          current={snap.ref}
          onClose={() => setPanel(null)}
          onGo={(ref) => {
            goTo(ref)
            setPanel(null)
          }}
        />
      )}

      {indexOpen && (
        <BookIndex
          bible={bible}
          current={snap.ref.book}
          onClose={() => setIndexOpen(false)}
          onPick={(book, chapter) => {
            goTo({ book, chapter, verse: 0 })
            setIndexOpen(false)
          }}
        />
      )}
    </div>
  )
}

function BookIndex({ bible, current, onClose, onPick }: {
  bible: Bible
  current: number
  onClose: () => void
  onPick: (book: number, chapter: number) => void
}) {
  const [book, setBook] = useState<number | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('[data-current="true"]')?.focus()
  }, [book])
  const ot = bible.books.slice(0, 39)
  const nt = bible.books.slice(39)
  return (
    <div className="index-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="index-panel" role="dialog" aria-label="Índice da Bíblia" ref={panel}>
        {book === null ? (
          <>
            <div className="index-head">
              <h2>Índice</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Fechar índice">×</button>
            </div>
            <div className="index-cols">
              {[['Antigo Testamento', ot, 0] as const, ['Novo Testamento', nt, 39] as const].map(([title, list, off]) => (
                <section key={title}>
                  <h3>{title}</h3>
                  <ul>
                    {list.map((b, i) => (
                      <li key={b.id}>
                        <button data-current={off + i === current} className={off + i === current ? 'is-current' : ''} onClick={() => setBook(off + i)}>
                          {b.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="index-head">
              <button className="index-back" onClick={() => setBook(null)}>
                <Arrow dir={-1} /> Livros
              </button>
              <button className="icon-btn" onClick={onClose} aria-label="Fechar índice">×</button>
            </div>
            <h2 className="index-book">{bible.books[book].name}</h2>
            {bible.books[book].title !== bible.books[book].name && <p className="index-sub">{bible.books[book].title}</p>}
            <div className="index-chapters">
              {bible.books[book].chapters.map((_, c) => (
                <button key={c} onClick={() => onPick(book, c)} data-current={c === 0}>{c + 1}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const CandleIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.8c1.3 1.6 1.6 2.6 1 3.5-.4.6-1.6.6-2 0-.6-.9-.3-1.9 1-3.5z" fill="currentColor" stroke="none" />
    <rect x="5.6" y="6.6" width="4.8" height="7.6" rx="1" />
  </svg>
)

let introPlayed: string | null = null

function BibleBackdrop({ id }: { id: Parameters<typeof backgroundImage>[0] }) {
  const img = backgroundImage(id)
  const fallback = backgroundOf(id).fallback
  const [instant] = useState(() => img !== null && img === introPlayed)
  useEffect(() => {
    introPlayed = img
    const t = setTimeout(() => (introPlayed = null), 4000)
    return () => clearTimeout(t)
  }, [img])
  return (
    <div className={`bible-bg ${img ? 'has-photo' : ''}`} aria-hidden="true" style={{ background: fallback }}>
      {img && <img key={img} src={img} alt="" decoding="async" className={instant ? 'is-instant' : undefined} />}
    </div>
  )
}

function BgIcon({ icon }: { icon: BackgroundIcon }) {
  const d: Record<BackgroundIcon, string> = {
    sun: 'M8 4.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zM8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
    mountain: 'M1.5 13l4.2-6.5 2.6 3.8 1.9-2.6 4.3 5.3zM5.7 6.5l1.1 1.6',
    wave: 'M1.5 6.5c1.6 0 1.6-1.4 3.2-1.4s1.6 1.4 3.3 1.4 1.6-1.4 3.2-1.4 1.6 1.4 3.3 1.4M1.5 10.5c1.6 0 1.6-1.4 3.2-1.4s1.6 1.4 3.3 1.4 1.6-1.4 3.2-1.4 1.6 1.4 3.3 1.4',
    lamp: 'M5 2.5h6l2 4.5H3zM8 7v5.5M5 14h6',
    column: 'M2.5 5L8 2l5.5 3zM3.5 5.5v6.5M6.2 5.5v6.5M9.8 5.5v6.5M12.5 5.5v6.5M2 13.5h12',
    tree: 'M8 1.8l4 5.2H9.8l3 4H3.2l3-4H4zM8 11v3.2',
    cloud: 'M4.6 12.5h7a2.9 2.9 0 0 0 .2-5.8 4 4 0 0 0-7.6 1.1 2.4 2.4 0 0 0 .4 4.7z',
    flame: 'M8 14.2c2.6 0 4.2-1.8 4.2-4.1 0-2.6-2.2-4.1-2.7-6.8-1.7 1-2.6 2.6-2.4 4.2-.9-.4-1.4-1.2-1.5-2.1C4.3 6.6 3.8 8 3.8 10.1c0 2.3 1.6 4.1 4.2 4.1z',
    moon: 'M10.6 11.9A5 5 0 0 1 6.4 3.1a5.3 5.3 0 1 0 6.6 6.7 5 5 0 0 1-2.4 2.1z',
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d={d[icon]} />
    </svg>
  )
}

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="6.5" fill="currentColor" opacity="0.9" />
    <path d="M4.2 7.2l1.9 1.9 3.7-4" fill="none" stroke="#2a1d12" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const RibbonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
    <path d="M6 2.5h6v13l-3-2.6-3 2.6z" />
  </svg>
)

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
    <rect x="3" y="4" width="12" height="11" rx="2.2" />
    <path d="M3 7.5h12M6.5 2.5v3M11.5 2.5v3" />
  </svg>
)

const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const Arrow = ({ dir }: { dir: 1 | -1 }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: dir === -1 ? 'scaleX(-1)' : undefined }}>
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const FocusIcon = ({ on }: { on: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    {on ? (
      <path d="M7 3v3a1 1 0 0 1-1 1H3M11 3v3a1 1 0 0 0 1 1h3M7 15v-3a1 1 0 0 0-1-1H3M11 15v-3a1 1 0 0 1 1-1h3" />
    ) : (
      <path d="M3 7V4a1 1 0 0 1 1-1h3M15 7V4a1 1 0 0 0-1-1h-3M3 11v3a1 1 0 0 0 1 1h3M15 11v3a1 1 0 0 1-1 1h-3" />
    )}
  </svg>
)
const NoteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 3.5h10v8.5l-3 3H4z" />
    <path d="M11 15v-3h3M6.5 7h5M6.5 9.5h3" />
  </svg>
)
const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
    <circle cx="9" cy="9" r="3.2" />
    <path d="M9 2v1.6M9 14.4V16M2 9h1.6M14.4 9H16M4 4l1.1 1.1M12.9 12.9 14 14M4 14l1.1-1.1M12.9 5.1 14 4" />
  </svg>
)
const BookIcon = ({ open }: { open: boolean }) =>
  open ? (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M9 5.2C7.6 4.2 5.4 3.8 3 4v9.4c2.4-.2 4.6.2 6 1.2 1.4-1 3.6-1.4 6-1.2V4c-2.4-.2-4.6.2-6 1.2zM9 5.2v9.4" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="4" y="3" width="10" height="12" rx="1.5" />
      <path d="M7 3v12" />
    </svg>
  )
