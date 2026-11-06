import { useEffect, useRef, useState } from 'react'
import { openExternal } from '../../shared/openExternal'
import type { Assessment } from './engine'
import { DECISION_LABEL, dueLabel, reopenStatus, testRun, type Focus, type NextStep } from './flow'
import { ChartIcon, DecisionIcon, LinkIcon, PlusIcon, QuoteIcon, TrashIcon } from './icons'
import { CRITERIA, criterionDef } from './questions'
import { addEvidence, patchIdea, removeEvidence, setNextTest } from './store'
import type { Evidence, EvidenceKind, EvidenceSignal, Idea, IdeaDecision } from './types'
import { hostOf, isHttpUrl, money, numberFmt, shortDate, useAutosize } from './util'

const SIGNALS: Record<EvidenceKind, { id: EvidenceSignal; label: string }[]> = {
  note: [
    { id: 'supports', label: 'A favor' },
    { id: 'contradicts', label: 'Contra' },
    { id: 'neutral', label: 'Neutro' },
  ],
  result: [
    { id: 'supports', label: 'Bateu a meta' },
    { id: 'contradicts', label: 'Não bateu' },
    { id: 'neutral', label: 'Inconclusivo' },
  ],
}

const DECISIONS: { id: IdeaDecision; text: string }[] = [
  { id: 'continue', text: 'O sinal veio. Mantenha o teste ou dê o próximo passo pequeno.' },
  { id: 'adjust', text: 'Mude uma variável — público, canal ou oferta — e teste de novo.' },
  { id: 'archive', text: 'Guarde o aprendizado e libere atenção para outra aposta.' },
]

type Draft = {
  mode: EvidenceKind
  text: string
  url: string
  metric: string
  value: string
  cost: string
  signal: EvidenceSignal
  criterion: string | null
}
const drafts = new Map<string, Draft>()

export function ResultStage({ idea, a, step, today, focus, footer }: {
  idea: Idea
  a: Assessment
  step: NextStep
  today: string
  focus: Focus
  footer: React.ReactNode
}) {
  const deciding = step.id === 'decide' || step.id === 'discard'
  const [formOpen, setFormOpen] = useState(!deciding || focus === 'record')
  const run = testRun(idea, today)
  const list = [...idea.evidence].reverse()
  const decideRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focus === 'decide') requestAnimationFrame(() => decideRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }))
  }, [])

  const form = formOpen ? (
    <RecordForm idea={idea} a={a} autoFocus={focus === 'record'} />
  ) : (
    <button className="lab-addrow" onClick={() => setFormOpen(true)}>
      <PlusIcon size={14} />
      Registrar outro resultado ou evidência
    </button>
  )
  const showDecision = deciding || !!idea.decision || !!idea.nextTest?.startedAt || idea.evidence.some((e) => e.kind === 'result')
  const decision = showDecision && <Decision ref={decideRef} idea={idea} emphasized={deciding} />

  return (
    <div className="lab-result">
      {run && idea.nextTest && (
        <div className={`lab-measure ${run.over ? 'is-over' : ''}`}>
          <span className="lab-label">{run.over ? 'Teste encerrado' : `Em teste · dia ${run.day} de ${run.total}`}</span>
          {idea.nextTest.action && <p className="lab-measure-action">{idea.nextTest.action}</p>}
          <p>
            <b>Meta:</b> {idea.nextTest.goal || 'sem meta definida'}
          </p>
          <p className="lab-hint">
            {run.over ? `Terminou ${dueLabel(run.deadline, today) === 'ontem' ? 'ontem' : `em ${shortDate(run.deadline)}`}` : `Até ${dueLabel(run.deadline, today)}`}
            {' · '}teto de {money.format(idea.nextTest.maxSpend)}
            {a.tally.spent > 0 && <> · {money.format(a.tally.spent)} gastos</>}
          </p>
        </div>
      )}

      {form}
      {deciding && decision}

      <section className="lab-history" aria-labelledby="lab-hist-title">
        <h4 className="lab-label" id="lab-hist-title">
          Histórico
          {idea.evidence.length > 0 && (
            <em>
              {a.tally.supports} a favor · {a.tally.contradicts} contra · {a.tally.neutral} {a.tally.neutral === 1 ? 'neutro' : 'neutros'}
            </em>
          )}
        </h4>
        {list.length > 0 ? (
          <ul className="lab-ev-list">
            {list.map((e) => (
              <EvidenceItem key={e.id} e={e} idea={idea} />
            ))}
          </ul>
        ) : (
          <p className="lab-ev-empty">Nada registrado ainda. Evidência é o que aconteceu — uma conversa, um link, um número — não o que se espera.</p>
        )}
      </section>

      {!deciding && decision}
      {footer}
    </div>
  )
}

function RecordForm({ idea, a, autoFocus }: { idea: Idea; a: Assessment; autoFocus: boolean }) {
  const testing = idea.status === 'testing'
  const init = drafts.get(idea.id)
  const [mode, setMode] = useState<EvidenceKind>(init?.mode ?? (testing ? 'result' : 'note'))
  const [text, setText] = useState(init?.text ?? '')
  const [url, setUrl] = useState(init?.url ?? '')
  const [metric, setMetric] = useState(init?.metric ?? '')
  const [value, setValue] = useState(init?.value ?? '')
  const [cost, setCost] = useState(init?.cost ?? '')
  const [signal, setSignal] = useState<EvidenceSignal>(init?.signal ?? 'neutral')
  const [criterion, setCriterion] = useState<string | null>(init?.criterion !== undefined ? init.criterion : (idea.nextTest?.criterion ?? a.riskiest.criterion))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [announce, setAnnounce] = useState('')
  const firstField = useRef<HTMLElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  useAutosize(textRef, text)

  useEffect(() => {
    if (text || url || metric || value || cost) drafts.set(idea.id, { mode, text, url, metric, value, cost, signal, criterion })
    else drafts.delete(idea.id)
  }, [idea.id, mode, text, url, metric, value, cost, signal, criterion])

  useEffect(() => {
    if (!autoFocus) return
    setMode('result')
    requestAnimationFrame(() => firstField.current?.focus({ preventScroll: true }))
  }, [])

  const num = (s: string) => {
    const t = s.trim().replace(/\s/g, '')
    if (!t) return null
    return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  }
  const valueN = num(value)
  const costN = num(cost)
  const urlBad = url.trim() !== '' && !isHttpUrl(url)
  const errors: string[] = []
  if (mode === 'result') {
    if (!metric.trim()) errors.push('Diga qual métrica você mediu.')
    if (valueN === null || !Number.isFinite(valueN)) errors.push('Informe o valor medido.')
    if (costN !== null && (!Number.isFinite(costN) || costN < 0)) errors.push('O custo precisa ser um número positivo.')
  } else if (!text.trim() && !url.trim()) errors.push('Escreva um comentário ou cole um link.')
  if (urlBad) errors.push('O link precisa começar com http:// ou https://.')

  const submit = async () => {
    setTouched(true)
    if (errors.length || busy) return
    setBusy(true)
    const e = await addEvidence({
      ideaId: idea.id,
      kind: mode,
      criterion,
      signal,
      text,
      url: url.trim() || null,
      metric: mode === 'result' ? metric : null,
      value: mode === 'result' ? valueN : null,
      cost: mode === 'result' ? costN : null,
    })
    setBusy(false)
    if (!e) return
    setText('')
    setUrl('')
    setMetric('')
    setValue('')
    setCost('')
    setSignal('neutral')
    setTouched(false)
    setAnnounce('Registrado. O parecer foi recalculado.')
  }

  return (
    <form
      className="lab-record"
      aria-labelledby="lab-record-title"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="lab-record-head">
        <h4 className="lab-label" id="lab-record-title">Registrar</h4>
        <div className="lab-tabs" role="radiogroup" aria-label="Tipo de registro" data-mode={mode}>
          <span className="lab-tabs-pill" aria-hidden="true" />
          <button type="button" role="radio" aria-checked={mode === 'result'} className="lab-tabbtn" onClick={() => setMode('result')}>
            Resultado do teste
          </button>
          <button type="button" role="radio" aria-checked={mode === 'note'} className="lab-tabbtn" onClick={() => setMode('note')}>
            Evidência
          </button>
        </div>
      </div>

      {mode === 'result' ? (
        <div className="lab-form lab-form-result" key="result">
          <label className="lab-field">
            <span className="lab-label">Métrica</span>
            <input
              ref={(el) => {
                firstField.current = el
              }}
              className="lab-input"
              maxLength={120}
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              placeholder="conversas, cadastros, cliques, pedidos…"
            />
          </label>
          <label className="lab-field">
            <span className="lab-label">Valor</span>
            <input className="lab-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="12" />
          </label>
          <label className="lab-field">
            <span className="lab-label">Custo</span>
            <span className="lab-money">
              <span aria-hidden="true">R$</span>
              <input className="lab-input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" aria-label="Custo em reais" />
            </span>
          </label>
          <label className="lab-field lab-span-3">
            <span className="lab-label">Comentário (opcional)</span>
            <input className="lab-input" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="O que surpreendeu? O que as pessoas disseram?" />
          </label>
        </div>
      ) : (
        <div className="lab-form" key="note">
          <label className="lab-field lab-span-3">
            <span className="lab-label">Comentário</span>
            <textarea
              ref={(el) => {
                textRef.current = el
                firstField.current = el
              }}
              className="lab-input lab-textarea"
              rows={2}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Uma conversa, um dado público, um comentário de alguém do público…"
            />
          </label>
        </div>
      )}

      <div className="lab-form lab-form-meta">
        <label className="lab-field">
          <span className="lab-label">
            <LinkIcon size={12} /> Fonte (opcional)
          </span>
          <input
            className={`lab-input ${touched && urlBad ? 'is-bad' : ''}`}
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-invalid={touched && urlBad}
          />
        </label>
        <label className="lab-field">
          <span className="lab-label">Sobre</span>
          <select className="lab-input lab-select" value={criterion ?? ''} onChange={(e) => setCriterion(e.target.value || null)}>
            <option value="">Geral</option>
            {CRITERIA[idea.kind].map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="lab-record-foot">
        <div className="lab-chips" role="radiogroup" aria-label={mode === 'result' ? 'A meta foi atingida?' : 'Sinal'}>
          {SIGNALS[mode].map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={signal === s.id} className={`lab-chip lab-sig is-${s.id} ${signal === s.id ? 'is-on' : ''}`} onClick={() => setSignal(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="submit" className="btn primary lab-cta" disabled={busy}>
          Registrar
        </button>
      </div>
      <p className={`lab-hint ${touched && errors.length ? 'is-bad' : ''}`} role={touched && errors.length ? 'alert' : undefined}>
        {touched && errors.length ? errors[0] : signal === 'neutral' ? 'Neutro guarda o registro sem mudar o parecer.' : 'Registrar recalcula o parecer na hora.'}
      </p>
      <p className="lab-sr" aria-live="polite">{announce}</p>
    </form>
  )
}

function Decision({ idea, emphasized, ref }: { idea: Idea; emphasized: boolean; ref?: React.Ref<HTMLDivElement> }) {
  const decide = async (d: IdeaDecision) => {
    if (idea.decision === d)
      return void patchIdea(idea.id, d === 'archive' && idea.status === 'archived' ? { decision: '', status: reopenStatus(idea) } : { decision: '' })
    if (d === 'continue') await patchIdea(idea.id, { decision: d, status: 'testing' })
    if (d === 'archive') await patchIdea(idea.id, { decision: d, status: 'archived' })
    if (d === 'adjust') {
      await patchIdea(idea.id, { decision: d, status: 'evaluating' })
      if (idea.nextTest?.startedAt) await setNextTest(idea.id, { ...idea.nextTest, startedAt: null })
    }
  }

  return (
    <section className={`lab-decision ${emphasized ? 'is-emphasized' : ''}`} aria-labelledby="lab-decide-title">
      <h4 className="lab-label" id="lab-decide-title">
        {emphasized ? 'Decidir agora' : 'Decisão'}
        <em>o que fazer com o que aprendeu</em>
      </h4>
      <div ref={ref} className="lab-decide" role="group" aria-labelledby="lab-decide-title">
        {DECISIONS.map((d) => (
          <button key={d.id} className={`lab-decide-btn is-${d.id} ${idea.decision === d.id ? 'is-on' : ''}`} aria-pressed={idea.decision === d.id} onClick={() => void decide(d.id)}>
            <span className="lab-decide-icon" aria-hidden="true">
              <DecisionIcon d={d.id} size={16} />
            </span>
            <b>{DECISION_LABEL[d.id]}</b>
            <span>{d.text}</span>
          </button>
        ))}
      </div>
      <DecisionNote idea={idea} />
      {idea.decidedAt && idea.decision && <p className="lab-hint">Decidido em {shortDate(idea.decidedAt)}.</p>}
    </section>
  )
}

function DecisionNote({ idea }: { idea: Idea }) {
  const [note, setNote] = useState(idea.decisionNote)
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutosize(ref, note)
  return (
    <label className="lab-field lab-decision-note">
      <span className="lab-sr">O que você aprendeu</span>
      <textarea
        ref={ref}
        className="lab-input lab-textarea"
        rows={1}
        maxLength={2000}
        value={note}
        placeholder="O que você aprendeu? (opcional)"
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note.trim() !== idea.decisionNote && void patchIdea(idea.id, { decisionNote: note })}
      />
    </label>
  )
}

function EvidenceItem({ e, idea }: { e: Evidence; idea: Idea }) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 2600)
    return () => clearTimeout(t)
  }, [confirm])
  const crit = criterionDef(idea.kind, e.criterion)
  const sig = SIGNALS[e.kind].find((s) => s.id === e.signal)?.label ?? e.signal
  return (
    <li className={`lab-ev is-${e.signal}`}>
      <span className="lab-ev-mark" aria-hidden="true">
        {e.kind === 'result' ? <ChartIcon size={14} /> : <QuoteIcon size={14} />}
      </span>
      <div className="lab-ev-body">
        {e.kind === 'result' && (
          <p className="lab-ev-metric">
            <b>{e.value === null ? '—' : numberFmt.format(e.value)}</b> {e.metric}
            {e.cost ? <span> · custo {money.format(e.cost)}</span> : null}
          </p>
        )}
        {e.text && <p className="lab-ev-text">{e.text}</p>}
        {e.url && (
          <button className="lab-ev-link" onClick={() => void openExternal(e.url!)} title={e.url}>
            <LinkIcon size={12} />
            {hostOf(e.url)}
          </button>
        )}
        <p className="lab-ev-meta">
          <span className={`lab-sig-tag is-${e.signal}`}>{sig}</span>
          {crit && <span>{crit.label}</span>}
          <time dateTime={e.createdAt}>{shortDate(e.createdAt)}</time>
        </p>
      </div>
      <button
        className={`lab-ev-del ${confirm ? 'is-confirm' : ''}`}
        onClick={() => (confirm ? void removeEvidence(idea.id, e.id) : setConfirm(true))}
        aria-label={confirm ? 'Confirmar remoção' : 'Remover registro'}
        title={confirm ? 'Clique de novo para remover' : 'Remover'}
      >
        {confirm ? 'Remover?' : <TrashIcon size={14} />}
      </button>
    </li>
  )
}
