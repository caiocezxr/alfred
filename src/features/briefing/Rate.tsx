import { useEffect, useRef, useState } from 'react'
import { useBriefingPlayer } from './player.ts'
import { LEVELS, REASONS, shouldAsk } from './rating.ts'
import { rateEdition, undoRating, useBriefing } from './store.ts'
import { AREA_LABEL, AREAS, type Area, type Edition, type RatingLevel, type RatingReason } from './types.ts'

const DISMISS_KEY = 'ps.briefing.rateDismissed'
const SEEN_KEY = 'ps.briefing.seenEnd'

export const markSeenEnd = (date: string) => {
  try {
    localStorage.setItem(SEEN_KEY, date)
  } catch {
  }
}

const MORE_AREAS: Area[] = AREAS.filter((a) => a !== 'mundo')

export function RateBriefing({ edition, variant }: { edition: Edition; variant: 'card' | 'closing' }) {
  const st = useBriefing()
  const player = useBriefingPlayer()
  const saved = st.ratings.find((r) => r.editionDate === edition.date && !r.undone) ?? null
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === edition.date)
  const [level, setLevel] = useState<RatingLevel | null>(saved?.rating ?? null)
  const [reasons, setReasons] = useState<RatingReason[]>(saved?.reasons ?? [])
  const [more, setMore] = useState<Area[]>(saved?.moreAreas ?? [])
  const [note, setNote] = useState(saved?.note ?? '')
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  const timer = useRef(0)
  const cur = useRef({ reasons, more, note })
  cur.current = { reasons, more, note }

  const votes = [...st.votes.values()].filter((v) => v.editionDate === edition.date).length
  const finished = (player.date === edition.date && player.status === 'ended') || localStorage.getItem(SEEN_KEY) === edition.date
  const progress = player.date === edition.date && player.total ? player.line / player.total : player.resume?.date === edition.date && player.total ? player.resume.line / player.total : 0

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const save = (l: RatingLevel, r: RatingReason[], m: Area[], n: string, delay = 0) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void rateEdition({ editionDate: edition.date, rating: l, reasons: r, moreAreas: m, note: n || null }), delay)
  }

  if (variant === 'card' && !open && !saved && !shouldAsk({ rated: !!saved, dismissed, votes, finished, progress })) return null
  if (variant === 'card' && saved && !open && done) {
    return (
      <div className="bf-rate is-thanks" role="status">
        Obrigado. {saved.adjustments.length ? `Ajustei: ${saved.adjustments.map((a) => a.label).join(', ')}.` : 'Anotado.'}
        {saved.adjustments.length > 0 && (
          <button className="bf-rate-link" onClick={() => (void undoRating(edition.date), setDone(false), setLevel(null))}>
            desfazer
          </button>
        )}
      </div>
    )
  }
  if (variant === 'card' && saved && !open) return null

  const pick = (l: RatingLevel) => {
    setLevel(l)
    setOpen(l !== 'otimo')
    if (l === 'otimo') {
      setReasons([])
      setMore([])
      setDone(true)
    }
    save(l, l === 'otimo' ? [] : reasons, l === 'otimo' ? [] : more, note)
  }
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])

  return (
    <div className={`bf-rate is-${variant}`} role="group" aria-label="Avaliar o briefing de hoje">
      <div className="bf-rate-q">
        <span className="bf-rate-t">O briefing de hoje foi bom?</span>
        <div className="bf-rate-levels" role="radiogroup">
          {LEVELS.map((l) => (
            <button key={l.id} role="radio" aria-checked={level === l.id} className={level === l.id ? 'is-on' : ''} onClick={() => pick(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        {variant === 'card' && !level && (
          <button
            className="bf-rate-link"
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, edition.date)
              setDismissed(true)
            }}
          >
            agora não
          </button>
        )}
      </div>
      {open && level && level !== 'otimo' && (
        <div className="bf-rate-more">
          <div className="bf-chips" aria-label="O que pesou">
            {REASONS.map((r) => (
              <button
                key={r.id}
                className={`bf-chip ${reasons.includes(r.id) ? 'is-on' : ''}`}
                aria-pressed={reasons.includes(r.id)}
                onClick={() => {
                  const next = toggle(cur.current.reasons, r.id)
                  cur.current = { ...cur.current, reasons: next }
                  setReasons(next)
                  save(level, next, cur.current.more, cur.current.note, 400)
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="bf-chips is-areas" aria-label="Quero mais de">
            <span className="bf-chips-k">Quero mais de</span>
            {MORE_AREAS.map((a) => (
              <button
                key={a}
                className={`bf-chip ${more.includes(a) ? 'is-on' : ''}`}
                aria-pressed={more.includes(a)}
                onClick={() => {
                  const next = toggle(cur.current.more, a)
                  cur.current = { ...cur.current, more: next }
                  setMore(next)
                  save(level, cur.current.reasons, next, cur.current.note, 400)
                }}
              >
                {AREA_LABEL[a]}
              </button>
            ))}
          </div>
          <div className="bf-rate-note">
            <input
              className="field"
              placeholder="Algo mais? (opcional)"
              maxLength={280}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                save(level, reasons, more, e.target.value, 900)
              }}
            />
            <button
              className="btn sm"
              onClick={() => {
                save(level, reasons, more, note)
                setOpen(false)
                setDone(true)
              }}
            >
              Pronto
            </button>
          </div>
        </div>
      )}
      {variant === 'closing' && saved && !open && (
        <p className="bf-rate-done">
          {saved.adjustments.length ? `Ajustei: ${saved.adjustments.map((a) => a.label).join(', ')}.` : 'Anotado, obrigado.'}
          {saved.adjustments.length > 0 && (
            <button className="bf-rate-link" onClick={() => (void undoRating(edition.date), setLevel(null))}>
              desfazer
            </button>
          )}
        </p>
      )}
    </div>
  )
}
