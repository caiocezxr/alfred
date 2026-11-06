import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openExternal } from '../../shared/openExternal'
import { useBriefing, vote } from './store.ts'
import { AREA_LONG, type BriefItem, type Edition } from './types.ts'
import { AreaChip, IconCheck, IconClose, IconExternal } from './ui.tsx'

type Props = { edition: Edition; onClose: () => void; onProfile: () => void }
type Card = { item: BriefItem; kept: boolean }

export default function Triage({ edition, onClose, onProfile }: Props) {
  const { votes } = useBriefing()
  const deck = useMemo<Card[]>(() => {
    const all: Card[] = [...edition.items.map((item) => ({ item, kept: true })), ...edition.leftOut.map((item) => ({ item, kept: false }))]
    const fresh = all.filter((c) => !votes.has(c.item.key))
    const seen = all.filter((c) => votes.has(c.item.key))
    return [...fresh, ...seen]
  }, [edition])
  const [pos, setPos] = useState(0)
  const [gone, setGone] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [tally, setTally] = useState({ yes: 0, no: 0 })
  const [drag, setDrag] = useState({ x: 0, active: false })
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const decide = useCallback(
    (yes: boolean) => {
      const c = deck[pos]
      if (!c || gone) return
      void vote(c.item, yes ? (c.kept ? 'up' : 'interest') : 'down', 'triage', null, c.kept)
      setTally((t) => ({ yes: t.yes + (yes ? 1 : 0), no: t.no + (yes ? 0 : 1) }))
      setGone({ key: c.item.key, dir: yes ? 1 : -1 })
      setDrag({ x: 0, active: false })
      window.setTimeout(() => {
        setGone(null)
        setPos((p) => p + 1)
      }, 260)
    },
    [deck, pos, gone],
  )

  useEffect(() => {
    root.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return
      let ok = true
      if (e.key === 'ArrowRight') decide(true)
      else if (e.key === 'ArrowLeft') decide(false)
      else if (e.key === 'Escape') onClose()
      else ok = false
      if (ok) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [decide, onClose])

  const done = pos >= deck.length
  const cur = deck[pos]
  const tilt = drag.x / 18
  const hint = drag.x > 60 ? 'yes' : drag.x < -60 ? 'no' : null

  return (
    <div className="brf-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="brf-triage" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Triagem rápida">
        <header className="brf-triage-head">
          <div>
            <div className="kicker">Triagem rápida</div>
            <h2 className="display">Isso te interessa?</h2>
          </div>
          <button className="brf-round" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </header>
        <div className="brf-triage-progress">
          <span style={{ transform: `scaleX(${deck.length ? Math.min(1, pos / deck.length) : 1})` }} />
        </div>

        <div className="brf-deck">
          {done ? (
            <div className="brf-done">
              <span className="brf-done-mark">
                <IconCheck />
              </span>
              <h3 className="display">Pronto</h3>
              <p className="brf-muted">
                {tally.yes} sim · {tally.no} não. Isso já ajusta os pesos de amanhã — e o juiz recebe os exemplos.
              </p>
              <div className="brf-done-actions">
                <button className="btn" onClick={onProfile}>
                  Ver o que aprendi
                </button>
                <button className="btn primary" onClick={onClose}>
                  Fechar
                </button>
              </div>
            </div>
          ) : (
            <>
              {deck.slice(pos + 1, pos + 3).map((c, i) => (
                <div key={c.item.key} className="brf-tcard is-behind" style={{ transform: `translateY(${(i + 1) * 12}px) scale(${1 - (i + 1) * 0.04})`, opacity: 1 - (i + 1) * 0.3 }} aria-hidden="true">
                  <CardBody c={c} />
                </div>
              ))}
              {cur && (
                <div
                  key={cur.item.key}
                  className={`brf-tcard is-top ${drag.active ? 'is-drag' : ''} ${gone?.key === cur.item.key ? (gone.dir > 0 ? 'is-gone-yes' : 'is-gone-no') : ''}`}
                  style={gone ? undefined : { transform: `translateX(${drag.x}px) rotate(${tilt}deg)` }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return
                    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
                    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                    setDrag({ x: 0, active: true })
                  }}
                  onPointerMove={(e) => {
                    if (!start.current || start.current.id !== e.pointerId) return
                    setDrag({ x: e.clientX - start.current.x, active: true })
                  }}
                  onPointerUp={(e) => {
                    if (!start.current) return
                    const dx = e.clientX - start.current.x
                    start.current = null
                    if (dx > 110) decide(true)
                    else if (dx < -110) decide(false)
                    else setDrag({ x: 0, active: false })
                  }}
                  onPointerCancel={() => {
                    start.current = null
                    setDrag({ x: 0, active: false })
                  }}
                >
                  <span className={`brf-stamp is-yes ${hint === 'yes' ? 'is-on' : ''}`}>sim</span>
                  <span className={`brf-stamp is-no ${hint === 'no' ? 'is-on' : ''}`}>não</span>
                  <CardBody c={cur} />
                </div>
              )}
            </>
          )}
        </div>

        {!done && (
          <footer className="brf-triage-foot">
            <button className="brf-choice is-no" onClick={() => decide(false)} aria-label="Não (←)">
              <IconClose />
              <span>não</span>
            </button>
            <span className="brf-muted brf-triage-count">
              {pos + 1} de {deck.length}
            </span>
            <button className="brf-choice is-yes" onClick={() => decide(true)} aria-label="Sim (→)">
              <IconCheck />
              <span>sim</span>
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

function CardBody({ c }: { c: Card }) {
  const it = c.item
  return (
    <div className={`brf-tcard-body brf-a-${it.area}`}>
      <div className="brf-tcard-top">
        <AreaChip area={it.area}>{AREA_LONG[it.area]}</AreaChip>
        <span className={`brf-tcard-tag ${c.kept ? 'is-kept' : ''}`}>{c.kept ? 'no briefing' : 'ficou de fora'}</span>
      </div>
      <h3 className="display">{it.title}</h3>
      {it.summary ? <p>{it.summary}</p> : null}
      {!c.kept && it.reason && <p className="brf-tcard-reason">O juiz deixou de fora: {it.reason}</p>}
      <div className="brf-tcard-foot">
        <span className="brf-muted">{it.source}</span>
        <button className="brf-icon-link" onClick={() => void openExternal(it.url)} aria-label="Abrir o original">
          <IconExternal />
        </button>
      </div>
    </div>
  )
}
