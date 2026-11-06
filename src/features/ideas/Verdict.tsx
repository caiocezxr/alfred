import { useEffect, useRef, useState } from 'react'
import { VERDICT_LABEL, type Assessment, type CriterionResult } from './engine'
import { BookIcon, FlagIcon, VerdictIcon } from './icons'
import { PRINCIPLE_BY_ID } from './principles'
import { LEVEL_LABEL, type PrincipleId } from './questions'
import type { Idea } from './types'

function useBump(value: string) {
  const [n, setN] = useState(0)
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current === value) return
    prev.current = value
    setN((x) => x + 1)
  }, [value])
  return n
}

export function Verdict({ idea, a, onJump, onPrinciple, footer }: {
  idea: Idea
  a: Assessment
  onJump: (questionId: string) => void
  onPrinciple: (id: PrincipleId) => void
  footer: React.ReactNode
}) {
  const evidenceKey = idea.evidence.map((e) => e.id).join(',')
  const recalculated = useBump(evidenceKey)
  const changed = useBump(a.verdict)
  const n = idea.evidence.length
  const basis = [`${a.progress.answered} de ${a.progress.total} respostas`, n ? `${n} ${n === 1 ? 'registro' : 'registros'}` : ''].filter(Boolean).join(' e ')
  const principle = PRINCIPLE_BY_ID[a.principles[0]]
  const insufficient = a.verdict === 'insufficient'

  return (
    <div className={`lab-verdict is-${a.verdict}`}>
      <span className="lab-verdict-fx" aria-hidden="true">
        <span className="lab-verdict-glow" />
        {recalculated > 0 && <span key={recalculated} className="lab-sheen" />}
      </span>

      <div key={changed} className={`lab-verdict-hero ${changed ? 'is-changed' : ''}`}>
        <span className="lab-seal" aria-hidden="true">
          <VerdictIcon verdict={a.verdict} size={24} />
        </span>
        <div>
          <h3 className="display lab-verdict-title">{VERDICT_LABEL[a.verdict]}</h3>
          <p className="lab-verdict-summary">{a.summary}</p>
          <p className="lab-verdict-basis">
            {recalculated > 0 ? <span key={recalculated} className="lab-recalc">Recalculado com a nova evidência</span> : `Com base em ${basis}`}
            <span aria-hidden="true"> · </span>
            <span title="Regras fixas aplicadas às suas respostas. Sem nota, sem IA, sem números inventados.">regras fixas, sem IA</span>
          </p>
        </div>
      </div>
      <p className="lab-sr" aria-live="polite">Parecer: {VERDICT_LABEL[a.verdict]}</p>

      {a.motives.length > 0 && (
        <ol className="lab-motives" aria-label="Motivos principais">
          {a.motives.map((m, i) => (
            <li key={m.text} className={`is-${m.tone}`}>
              <span className="lab-motive-n" aria-hidden="true">{i + 1}</span>
              <span>{m.text}</span>
            </li>
          ))}
        </ol>
      )}

      {a.flags.length > 0 && (
        <div className="lab-flags">
          <p className="lab-flags-title">
            <FlagIcon size={13} /> Sinais de alerta — sinalizam, não decidem por você
          </p>
          <ul>
            {a.flags.map((f) => (
              <li key={f.id}>
                <b>{f.label}</b>
                <span>{f.detail}</span>
                <button className="lab-link" onClick={() => onJump(f.questionIds[0])}>rever resposta</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {insufficient && a.gaps.length > 0 && (
        <div className="lab-gaps">
          <h4 className="lab-label">Responda para destravar o parecer</h4>
          <ul>
            {a.gaps.slice(0, 4).map((g) => (
              <li key={g.questionId}>
                <button className="lab-gap" onClick={() => onJump(g.questionId)}>
                  <span className="lab-gap-q">{g.prompt}</span>
                  <span className="lab-gap-state">{g.answered ? 'você marcou “não sei”' : 'sem resposta'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="lab-focus">
        <div className="lab-focus-risk">
          <h4 className="lab-label">Hipótese mais arriscada · {a.riskiest.label}</h4>
          <p className="lab-quote">{a.riskiest.text}</p>
        </div>
        <div className="lab-focus-first">
          <h4 className="lab-label">O que validar primeiro</h4>
          <p>{a.validateFirst}</p>
          {principle && (
            <button className="lab-principle-link" onClick={() => onPrinciple(principle.id)}>
              <BookIcon size={14} />
              {principle.title}
            </button>
          )}
        </div>
      </div>

      {footer}

      <Criteria a={a} onJump={onJump} />
    </div>
  )
}

function Criteria({ a, onJump }: { a: Assessment; onJump: (questionId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const c = a.criteria.find((x) => x.id === open) ?? null
  return (
    <section className="lab-criteria" aria-labelledby="lab-crit-title">
      <h4 className="lab-label" id="lab-crit-title">
        Critérios <em>toque para ver o porquê</em>
      </h4>
      <div className="lab-crit-pills">
        {a.criteria.map((x, i) => (
          <button
            key={x.id}
            className={`lab-crit-pill is-${x.state} ${open === x.id ? 'is-on' : ''}`}
            aria-expanded={open === x.id}
            aria-controls="lab-crit-detail"
            onClick={() => setOpen((o) => (o === x.id ? null : x.id))}
            style={{ ['--i' as string]: i }}
          >
            <span className="lab-state-dot" aria-hidden="true" />
            {x.label}
            <span className="lab-sr">: {LEVEL_LABEL[x.state]}</span>
          </button>
        ))}
      </div>
      {c && <CriterionDetail key={c.id} c={c} onJump={onJump} />}
    </section>
  )
}

function CriterionDetail({ c, onJump }: { c: CriterionResult; onJump: (questionId: string) => void }) {
  const [more, setMore] = useState(false)
  const shown = more ? c.reasons : c.reasons.slice(0, 3)
  return (
    <div id="lab-crit-detail" className={`lab-crit-detail is-${c.state}`}>
      <div className="lab-crit-head">
        <b>{c.label}</b>
        {c.core && <span className="lab-crit-core">central</span>}
        <StateChip state={c.state} />
      </div>
      {shown.length ? (
        <ul className="lab-crit-why">
          {shown.map((r, i) => (
            <li key={i} className={`is-${r.level}`}>
              {r.questionId ? (
                <button className="lab-why" onClick={() => onJump(r.questionId!)} title="Ver a pergunta">
                  {r.text}
                </button>
              ) : (
                <span>{r.text}</span>
              )}
              {r.note && <q className="lab-why-note">{r.note}</q>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lab-crit-empty">Sem respostas ainda.</p>
      )}
      {c.reasons.length > 3 && (
        <button className="lab-link lab-crit-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          {more ? 'menos' : `mais ${c.reasons.length - 3}`}
        </button>
      )}
    </div>
  )
}

export function StateChip({ state }: { state: CriterionResult['state'] }) {
  return (
    <span className={`lab-state is-${state}`}>
      <span className="lab-state-dot" aria-hidden="true" />
      {LEVEL_LABEL[state]}
    </span>
  )
}
