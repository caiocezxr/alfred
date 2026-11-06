import { useEffect, useRef, useState } from 'react'
import type { Assessment } from './engine'
import { ArrowIcon, CheckIcon, ChevronIcon } from './icons'
import { QUESTIONS, criterionDef, toneOf, type Question } from './questions'
import { setAnswer } from './store'
import type { Idea } from './types'

const drafts = new Map<string, string>()

export function Diagnosis({ idea, a, jumpTo, autoFocus, onComplete, footer }: {
  idea: Idea
  a: Assessment
  jumpTo: string | null
  autoFocus: boolean
  onComplete: () => void
  footer: React.ReactNode
}) {
  const qs = QUESTIONS[idea.kind]
  const { answered, total } = a.progress
  const complete = answered === total
  const firstOpen = () => Math.max(0, qs.findIndex((q) => !idea.answers[q.id]))
  const jumpIndex = jumpTo ? qs.findIndex((q) => q.id === jumpTo) : -1
  const [mode, setMode] = useState<'card' | 'list'>(() => (jumpIndex >= 0 || !complete ? 'card' : 'list'))
  const [index, setIndex] = useState(() => (jumpIndex >= 0 ? jumpIndex : firstOpen()))
  const [dir, setDir] = useState<1 | -1>(1)
  const [savedTick, setSavedTick] = useState(0)
  const backToVerdict = useRef(!complete || jumpIndex >= 0)
  const last = qs.length - 1

  const go = (i: number) => {
    if (i < 0 || i >= qs.length) return
    setDir(i >= index ? 1 : -1)
    setIndex(i)
    setMode('card')
  }
  const target = (): number | 'verdict' => {
    if (complete) return backToVerdict.current || index === last ? 'verdict' : index + 1
    for (let k = 1; k <= qs.length; k++) {
      const i = (index + k) % qs.length
      if (!idea.answers[qs[i].id] && i !== index) return i
    }
    return index < last ? index + 1 : 'verdict'
  }
  const next = () => {
    const t = target()
    if (t === 'verdict') onComplete()
    else go(t)
  }
  const right = () => (index < last ? go(index + 1) : next())
  const t = target()
  const nextLabel = t === 'verdict' ? 'Ver parecer' : t <= index ? 'Ir às pendentes' : 'Próxima'

  const q = qs[Math.min(index, qs.length - 1)]

  return (
    <div className="lab-diag">
      <div className="lab-stage-head">
        <p className="lab-stage-sub">
          {complete ? 'Diagnóstico completo' : answered === 0 ? `${total} perguntas curtas · salvas a cada resposta` : `${answered} de ${total} respondidas`}
          {savedTick > 0 && (
            <span key={savedTick} className="lab-saved" role="status">
              <CheckIcon size={11} /> salvo
            </span>
          )}
        </p>
        {answered > 0 && (
          <button className="lab-textbtn" onClick={() => (mode === 'list' ? go(complete ? index : firstOpen()) : setMode('list'))}>
            {mode === 'list' ? 'Responder uma por vez' : 'Ver todas as respostas'}
          </button>
        )}
      </div>

      {mode === 'card' ? (
        <>
          <ol className="lab-steps" aria-label="Perguntas do diagnóstico">
            {qs.map((x, i) => {
              const ans = idea.answers[x.id]
              const ch = ans ? x.choices.find((c) => c.id === ans.choice) : undefined
              const tone = ch ? toneOf(x, ch) : 'empty'
              const current = i === index
              return (
                <li key={x.id}>
                  <button
                    className={`lab-step is-${tone} ${current ? 'is-current' : ''}`}
                    onClick={() => go(i)}
                    aria-current={current ? 'step' : undefined}
                    aria-label={`Pergunta ${i + 1}: ${x.short} — ${ch ? ch.label : 'sem resposta'}`}
                    title={`${x.short}${ch ? ` · ${ch.label}` : ''}`}
                  />
                </li>
              )
            })}
          </ol>
          <QuestionCard
            key={`${idea.id}:${q.id}`}
            idea={idea}
            q={q}
            index={index}
            total={qs.length}
            dir={dir}
            nextLabel={nextLabel}
            autoFocus={autoFocus}
            onSaved={() => setSavedTick((n) => n + 1)}
            onPrev={() => go(index - 1)}
            onNext={next}
            onRight={right}
          />
        </>
      ) : (
        <>
          <ol className="lab-answers" aria-label="Respostas do diagnóstico">
            {qs.map((x, i) => {
              const ans = idea.answers[x.id]
              const ch = ans ? x.choices.find((c) => c.id === ans.choice) : undefined
              const tone = ch ? toneOf(x, ch) : 'empty'
              return (
                <li key={x.id} style={{ ['--i' as string]: i }}>
                  <button className="lab-answer" onClick={() => go(i)} aria-label={`Pergunta ${i + 1}: ${x.short} — ${ch ? ch.label : 'sem resposta'}. Mudar resposta`}>
                    <span className="lab-answer-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                    <span className="lab-answer-q">{x.short}</span>
                    <span className={`lab-answer-a is-${tone}`}>
                      <span className="lab-answer-dot" aria-hidden="true" />
                      <span>
                        {ch ? ch.label : 'Sem resposta'}
                        {ans?.note && <q className="lab-answer-note">{ans.note}</q>}
                      </span>
                    </span>
                    <ChevronIcon size={13} dir="right" />
                  </button>
                </li>
              )
            })}
          </ol>
          {footer}
        </>
      )}
    </div>
  )
}

function QuestionCard({ idea, q, index, total, dir, nextLabel, autoFocus, onSaved, onPrev, onNext, onRight }: {
  idea: Idea
  q: Question
  index: number
  total: number
  dir: 1 | -1
  nextLabel: string
  autoFocus: boolean
  onSaved: () => void
  onPrev: () => void
  onNext: () => void
  onRight: () => void
}) {
  const draftKey = `${idea.id}:${q.id}`
  const ans = idea.answers[q.id]
  const [note, setNote] = useState(() => ans?.note ?? drafts.get(draftKey) ?? '')
  const noteRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ note, choice: ans?.choice ?? null, stored: ans?.note ?? '' })
  latest.current.choice = ans?.choice ?? null
  latest.current.stored = ans?.note ?? ''

  const flush = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    const { note: n, choice, stored } = latest.current
    if (!choice) {
      if (n.trim()) drafts.set(draftKey, n)
      else drafts.delete(draftKey)
      return
    }
    if (n.trim() !== stored.trim()) void setAnswer(idea.id, q.id, { choice, note: n }).then((r) => r && onSaved())
  }

  useEffect(() => () => flush(), [])

  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const a = document.activeElement
    const diag = card.current?.closest('.lab-diag')
    if (autoFocus || !a || a === document.body || (diag && diag.contains(a))) card.current?.focus({ preventScroll: true })
  }, [])

  const choose = (choice: string) => {
    window.clearTimeout(timer.current)
    drafts.delete(draftKey)
    latest.current.choice = choice
    latest.current.stored = note
    void setAnswer(idea.id, q.id, { choice, note }).then((r) => r && onSaved())
    requestAnimationFrame(() => noteRef.current?.focus({ preventScroll: true }))
  }

  const onNote = (v: string) => {
    setNote(v)
    latest.current.note = v
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 700)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
    if (typing) {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        flush()
        onNext()
      }
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const n = Number(e.key)
    if (n >= 1 && n <= q.choices.length) {
      e.preventDefault()
      choose(q.choices[n - 1].id)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onRight()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onPrev()
    }
  }

  const crit = criterionDef(idea.kind, q.criterion)

  return (
    <div ref={card} tabIndex={-1} className={`lab-q ${dir > 0 ? 'from-right' : 'from-left'}`} onKeyDown={onKeyDown} aria-labelledby={`lab-q-${q.id}`} role="group">
      <div className="lab-q-top">
        <span className="lab-q-n">
          {String(index + 1).padStart(2, '0')}
          <span>/{String(total).padStart(2, '0')}</span>
        </span>
        {crit && <span className="lab-q-crit">{crit.label}</span>}
      </div>
      <h3 className="lab-q-prompt" id={`lab-q-${q.id}`}>{q.prompt}</h3>
      <p className="lab-q-help">{q.help}</p>

      <div className="lab-choices" role="radiogroup" aria-labelledby={`lab-q-${q.id}`}>
        {q.choices.map((c, i) => {
          const on = ans?.choice === c.id
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`lab-choice is-${toneOf(q, c)} ${on ? 'is-on' : ''}`}
              onClick={() => choose(c.id)}
            >
              <span className="lab-choice-dot" aria-hidden="true">
                <CheckIcon size={10} />
              </span>
              <span className="lab-choice-label">{c.label}</span>
              <kbd className="lab-choice-key" aria-hidden="true">{i + 1}</kbd>
            </button>
          )
        })}
      </div>

      <label className="lab-q-note">
        <span className="lab-sr">Detalhe opcional</span>
        <input
          ref={noteRef}
          className="lab-input"
          value={note}
          maxLength={2000}
          placeholder={`Em poucas palavras (opcional) — ${q.placeholder}`}
          onChange={(e) => onNote(e.target.value)}
          onBlur={flush}
        />
      </label>
      {!ans && note.trim() && <p className="lab-q-hint">O detalhe é guardado junto com a escolha.</p>}

      <footer className="lab-q-foot">
        <button type="button" className="btn quiet lab-sm" onClick={onPrev} disabled={index === 0}>
          <ChevronIcon size={12} dir="left" />
          Anterior
        </button>
        <span className="lab-hint lab-q-keys" aria-hidden="true">
          <kbd>1</kbd>–<kbd>{q.choices.length}</kbd> escolhe · <kbd>Enter</kbd> avança · <kbd>←</kbd>
          <kbd>→</kbd> navega
        </span>
        <button
          type="button"
          className={`btn ${ans ? 'primary' : ''} ${nextLabel === 'Ver parecer' ? 'lab-cta' : 'lab-sm'}`}
          onClick={() => {
            flush()
            onNext()
          }}
        >
          {nextLabel}
          <ArrowIcon size={12} />
        </button>
      </footer>
    </div>
  )
}
