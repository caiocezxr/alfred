import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { civil, fmtLong } from '../shared/dates'
import { greetingFor, type Period } from '../shared/greeting'
import { MOODS, type Mood } from '../features/mood/api'
import { Face } from '../features/mood/CheckIn'
import { patchToday, useToday } from '../features/mood/store'
import { Launch, shouldLaunch } from './Launch'
import './ritual.css'

const SKIP = 'ps.ritual.skip'
const EVENT = 'ps:ritual'

const COFFEE_YES = [
  'Agora sim. O dia começou.',
  'Café 14 na mão, código no ponto.',
  'Combustível no tanque, chefe.',
  'Boa. Hoje rende.',
  'Esse é o espírito.',
]

const MOOD_REPLY: Record<Mood, string> = {
  1: 'Dia pesado acontece. Vou com calma com você hoje.',
  2: 'Anotado. Um passo de cada vez.',
  3: 'Ok é um bom ponto de partida.',
  4: 'Boa. Vamos fazer render.',
  5: 'Que energia. Bora aproveitar.',
}

const hash = (s: string) => Math.abs([...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))

export const isMorning = (d = new Date()) => d.getHours() >= 5 && d.getHours() < 13

export function openRitual() {
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function needsRitual(today: { mood: Mood | null; coffee: boolean | null } | null, d = new Date()) {
  if (!today || today.mood == null) return true
  return isMorning(d) && today.coffee == null
}

const skippedToday = () => {
  try {
    return localStorage.getItem(SKIP) === civil()
  } catch {
    return false
  }
}

export function RitualGate({ active }: { active: boolean }) {
  const { today, loaded } = useToday()
  const [manual, setManual] = useState(false)
  const [closed, setClosed] = useState(false)
  const [launching, setLaunching] = useState(shouldLaunch)
  const decided = useRef<boolean | null>(null)

  useEffect(() => {
    const on = () => {
      setClosed(false)
      setManual(true)
    }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])

  if (loaded && decided.current === null) decided.current = active && needsRitual(today) && !skippedToday()

  const auto = decided.current === true
  const waiting = active && !loaded
  if (launching)
    return (
      <Launch
        intoRitual={active && (waiting || auto)}
        onDone={() => {
          if (!(active && decided.current)) delete document.documentElement.dataset.intro
          setLaunching(false)
        }}
      />
    )
  if (closed || (!auto && !manual && !waiting)) return null
  if (waiting) return createPortal(<div className="rt is-wait" aria-hidden="true" />, document.body)

  return (
    <Ritual
      manual={manual}
      onClose={() => {
        decided.current = false
        setManual(false)
        setClosed(true)
      }}
    />
  )
}

type Step = 'hello' | 'coffee' | 'wait' | 'mood' | 'note' | 'leaving'

function Ritual({ manual, onClose }: { manual: boolean; onClose: () => void }) {
  const { today } = useToday()
  const [now] = useState(() => new Date())
  const g = greetingFor(now)
  const period: Period = g.period
  const morning = isMorning(now)
  const date = civil(now)
  const askCoffee = morning && (manual || today?.coffee == null)

  const first: Step = askCoffee && today?.coffee == null ? 'coffee' : 'mood'
  const [step, setStep] = useState<Step>(manual ? first : 'hello')
  const [reply, setReply] = useState<string | null>(null)
  const [hover, setHover] = useState<Mood | null>(null)
  const [mood, setMood] = useState<Mood | null>(manual ? (today?.mood ?? null) : null)
  const [note, setNote] = useState(today?.note ?? '')
  const noteRef = useRef<HTMLInputElement>(null)
  const timers = useRef<number[]>([])
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))

  useEffect(() => {
    document.documentElement.dataset.intro = '1'
    if (!manual) later(1500, () => setStep(first))
    return () => {
      timers.current.forEach(clearTimeout)
      delete document.documentElement.dataset.intro
    }
  }, [])

  useEffect(() => {
    if (step === 'note') noteRef.current?.focus({ preventScroll: true })
  }, [step])

  const leave = () => {
    if (step === 'leaving') return
    setStep('leaving')
    later(260, () => delete document.documentElement.dataset.intro)
    later(1050, onClose)
  }

  const skip = () => {
    try {
      localStorage.setItem(SKIP, date)
    } catch {}
    leave()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        skip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const coffeeYes = () => {
    void patchToday({ coffee: true })
    setReply(COFFEE_YES[hash(date) % COFFEE_YES.length])
    setStep('mood')
  }

  const coffeeSkip = () => {
    void patchToday({ coffee: false })
    setReply('Sem café hoje. Respeito, mas não recomendo.')
    setStep('mood')
  }

  const pick = (m: Mood) => {
    setMood(m)
    void patchToday({ mood: m })
    setReply(MOOD_REPLY[m])
    setStep('note')
  }

  const finish = () => {
    if ((today?.note ?? '') !== note.trim()) void patchToday({ note: note.trim() })
    leave()
  }

  const tint = MOODS[(hover ?? mood ?? 3) - 1].color
  const stars = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        x: (hash(`x${i}`) % 1000) / 10,
        y: (hash(`y${i}`) % 560) / 10,
        s: 0.6 + (hash(`s${i}`) % 14) / 10,
        d: (hash(`d${i}`) % 40) / 10,
      })),
    [],
  )

  const showMood = step === 'mood' || step === 'note' || (step === 'leaving' && mood)

  return createPortal(
    <div
      className={`rt is-${period} is-${step} ${hover || mood ? 'has-tint' : ''}`}
      style={{ ['--tint' as string]: tint }}
      role="dialog"
      aria-modal="true"
      aria-label="Abertura do dia"
    >
      <div className="rt-sky" aria-hidden="true">
        {period === 'noite' && (
          <div className="rt-stars">
            {stars.map((s, i) => (
              <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
            ))}
          </div>
        )}
        <div className="rt-upper">
          <div className="rt-tint" />
          <div className="rt-sun" />
        </div>
        <div className="rt-grain" />
        <div className="rt-horizon" />
        <div className="rt-ground">
          <div className="rt-reflex" />
        </div>
      </div>

      <header className="rt-hello">
        <div className="rt-kicker">{fmtLong.format(now)}</div>
        <h1 className="display rt-title">
          <span className="rt-word">
            {[...`${g.hello},`].map((ch, i) => (
              <span key={i} className="rt-ch" style={{ ['--k' as string]: i }}>
                {ch === ' ' ? ' ' : ch}
              </span>
            ))}
          </span>
          <span className="rt-nick">{g.nick}</span>
        </h1>
      </header>

      <section className="rt-stage" aria-live="polite">
        {reply && (
          <p key={reply} className="rt-reply">
            {reply}
          </p>
        )}

        {step === 'coffee' && (
          <div className="rt-step rt-coffee" key="coffee">
            <h2 className="display rt-q">Já pegou o café intensidade 14?</h2>
            <div className="rt-choices">
              <button className="rt-cup-btn" onClick={coffeeYes} autoFocus>
                <Cup />
                <span>Já peguei</span>
              </button>
              <button className="rt-ghost" onClick={() => setStep('wait')}>
                Ainda não
              </button>
            </div>
          </div>
        )}

        {step === 'wait' && (
          <div className="rt-step rt-coffee" key="wait">
            <h2 className="display rt-q">Vai lá. Eu espero aqui.</h2>
            <div className="rt-choices">
              <button className="rt-cup-btn is-empty" onClick={coffeeYes} autoFocus>
                <Cup empty />
                <span>Peguei</span>
              </button>
              <button className="rt-ghost" onClick={coffeeSkip}>
                Hoje sem café
              </button>
            </div>
          </div>
        )}

        {showMood && (
          <div className="rt-step rt-mood" key="mood">
            <h2 className="display rt-q">{mood ? `Hoje você está ${MOODS[mood - 1].label.toLowerCase()}.` : 'E como você está hoje?'}</h2>
            <div className="rt-faces" role="radiogroup" aria-label="Humor de hoje" onMouseLeave={() => setHover(null)}>
              {MOODS.map((m, i) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={mood === m.id}
                  aria-label={m.label}
                  className={`rt-face ${mood === m.id ? 'is-on' : ''} ${mood && mood !== m.id ? 'is-dim' : ''}`}
                  style={{ ['--mc' as string]: m.color, ['--k' as string]: i }}
                  onMouseEnter={() => setHover(m.id)}
                  onFocus={() => setHover(m.id)}
                  onClick={() => pick(m.id)}
                >
                  <Face level={m.id} size={34} />
                  <span className="rt-face-label">{m.label}</span>
                </button>
              ))}
            </div>
            {step === 'note' || (step === 'leaving' && mood) ? (
              <div className="rt-note">
                <input
                  ref={noteRef}
                  value={note}
                  maxLength={280}
                  placeholder="Quer deixar uma linha sobre o dia?"
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finish()
                  }}
                  aria-label="Nota do dia"
                />
                <button className="rt-go" onClick={finish}>
                  Começar o dia
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <button className="rt-skip" onClick={skip}>
        pular <kbd>esc</kbd>
      </button>
    </div>,
    document.body,
  )
}

function Cup({ empty = false }: { empty?: boolean }) {
  return (
    <svg className={`rt-cup ${empty ? 'is-empty' : ''}`} width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <clipPath id="rt-cup-in">
          <path d="M15 24h30v12c0 8-6.5 14-14 14h-2c-7.5 0-14-6-14-14z" />
        </clipPath>
      </defs>
      <g className="rt-steam" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M24 18c0-3 3-3 3-6s-3-3-3-6" />
        <path d="M33 18c0-3 3-3 3-6s-3-3-3-6" />
      </g>
      <g clipPath="url(#rt-cup-in)">
        <rect className="rt-coffee-fill" x="13" y="24" width="34" height="28" />
      </g>
      <path d="M15 24h30v12c0 8-6.5 14-14 14h-2c-7.5 0-14-6-14-14z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M45 28h3.5a5 5 0 0 1 0 10H45" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 55h36" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
