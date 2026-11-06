import { memo, useState } from 'react'
import { VERDICT_LABEL, type Verdict } from './engine'
import { dueLabel, testRun, VERDICT_TINY, type NextStep, type TestRun, type Tone } from './flow'
import type { OpenIdea } from './Ideas'
import { ArrowIcon, ChevronIcon, KindIcon } from './icons'
import { KIND_LABEL } from './questions'
import { assessIdea } from './store'
import type { Idea } from './types'

export function IdeaList({ ideas, steps, selectedId, today, onOpen }: {
  ideas: Idea[]
  steps: Map<string, NextStep>
  selectedId: string | null
  today: string
  onOpen: OpenIdea
}) {
  const [showArchived, setShowArchived] = useState(false)
  const runs = new Map<string, TestRun>()
  for (const i of ideas) {
    const r = testRun(i, today)
    if (r) runs.set(i.id, r)
  }
  const testing = ideas.filter((i) => runs.has(i.id))
  const active = ideas.filter((i) => !runs.has(i.id) && i.status !== 'paused' && i.status !== 'archived')
  const paused = ideas.filter((i) => !runs.has(i.id) && i.status === 'paused')
  const archived = ideas.filter((i) => i.status === 'archived')
  const archivedOpen = showArchived || archived.some((i) => i.id === selectedId)

  const rows = (list: Idea[], offset = 0) =>
    list.map((i, n) => {
      const a = assessIdea(i, today)
      const s = steps.get(i.id)!
      return (
        <IdeaRow
          key={i.id}
          idea={i}
          verdict={a.progress.answered > 0 ? a.verdict : null}
          next={s.short}
          tone={s.tone}
          active={i.id === selectedId}
          index={n + offset}
          onOpen={onOpen}
        />
      )
    })

  return (
    <nav className="lab-list" aria-label="Lista de ideias">
      {testing.length > 0 && (
        <section className="lab-group" aria-label="Em teste">
          {testing.map((i) => (
            <Spotlight key={i.id} idea={i} run={runs.get(i.id)!} step={steps.get(i.id)!} today={today} active={i.id === selectedId} onOpen={onOpen} />
          ))}
          {testing.length > 1 && (
            <p className="lab-list-note" role="note">
              {testing.length} ideias em teste ao mesmo tempo. Uma de cada vez costuma dar sinal mais claro.
            </p>
          )}
        </section>
      )}

      {active.length > 0 && (
        <section className="lab-group">
          {(testing.length > 0 || paused.length > 0) && <h2 className="lab-group-title">Em andamento</h2>}
          <ul className="lab-rows">{rows(active)}</ul>
        </section>
      )}

      {paused.length > 0 && (
        <section className="lab-group">
          <h2 className="lab-group-title">Pausadas</h2>
          <ul className="lab-rows is-muted">{rows(paused, active.length)}</ul>
        </section>
      )}

      {archived.length > 0 && (
        <section className="lab-group">
          <button className="lab-group-title lab-group-toggle" aria-expanded={archivedOpen} onClick={() => setShowArchived((v) => !v)}>
            Arquivadas
            <span className="lab-group-count">{archived.length}</span>
            <ChevronIcon size={12} dir={archivedOpen ? 'up' : 'down'} />
          </button>
          {archivedOpen && <ul className="lab-rows is-muted">{rows(archived)}</ul>}
        </section>
      )}
    </nav>
  )
}

function Spotlight({ idea, run, step, today, active, onOpen }: {
  idea: Idea
  run: TestRun
  step: NextStep
  today: string
  active: boolean
  onOpen: OpenIdea
}) {
  const decide = step.id === 'decide'
  const kicker = decide ? 'Decisão pendente' : run.over ? 'Prazo encerrado' : 'Em teste'
  const due = dueLabel(run.deadline, today)
  const when = run.over ? (due === 'ontem' ? 'terminou ontem' : `terminou em ${due}`) : `até ${due}`
  return (
    <div className={`lab-spot is-${step.tone} ${active ? 'is-active' : ''}`}>
      <button className="lab-spot-main" aria-current={active ? 'true' : undefined} onClick={() => onOpen(idea.id)}>
        <span className="lab-spot-kicker">
          <span className="lab-spot-dot" aria-hidden="true" />
          {kicker}
          <span className="lab-spot-day">
            dia {run.day} de {run.total}
          </span>
        </span>
        <span className="lab-spot-title">{idea.title}</span>
        <span className="lab-spot-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${run.day / run.total})` }} />
        </span>
        <span className="lab-spot-due">{when}</span>
      </button>
      <button className="btn primary lab-sm lab-spot-cta" onClick={() => onOpen(idea.id, 'result', decide ? 'decide' : 'record')}>
        {decide ? 'Decidir' : 'Registrar resultado'}
        <ArrowIcon size={12} />
      </button>
    </div>
  )
}

const IdeaRow = memo(function IdeaRow({ idea, verdict, next, tone, active, index, onOpen }: {
  idea: Idea
  verdict: Verdict | null
  next: string
  tone: Tone
  active: boolean
  index: number
  onOpen: OpenIdea
}) {
  return (
    <li className="lab-row-wrap" style={{ ['--i' as string]: index }}>
      <button className={`lab-row ${active ? 'is-active' : ''}`} aria-current={active ? 'true' : undefined} onClick={() => onOpen(idea.id)}>
        <span className="lab-row-title">
          <span className="lab-row-kind" title={KIND_LABEL[idea.kind]}>
            <KindIcon kind={idea.kind} size={13} />
          </span>
          <span className="lab-sr">{KIND_LABEL[idea.kind]}:</span>
          {idea.title}
        </span>
        <span className="lab-row-meta">
          {verdict && (
            <span className={`lab-vtag is-${verdict}`} title={`Parecer: ${VERDICT_LABEL[verdict]}`}>
              {VERDICT_TINY[verdict]}
            </span>
          )}
          <span className={`lab-row-next is-${tone}`}>{next}</span>
        </span>
      </button>
    </li>
  )
})
