import { useEffect, useRef, useState } from 'react'
import { civil } from '../../shared/dates'
import type { Assessment } from './engine'
import { dueLabel, testRun } from './flow'
import { ArrowIcon, BanIcon, TargetIcon } from './icons'
import { CRITERIA, criterionDef } from './questions'
import { patchIdea, setNextTest } from './store'
import type { Idea, NextTest } from './types'
import { money, shortDate, useAutosize } from './util'

const same = (a: NextTest, b: NextTest) =>
  a.action === b.action && a.target === b.target && a.maxSpend === b.maxSpend && a.goal === b.goal && a.deadline === b.deadline && a.criterion === b.criterion

export function TestStage({ idea, a, today, testingOthers, footer }: {
  idea: Idea
  a: Assessment
  today: string
  testingOthers: Idea[]
  footer: React.ReactNode
}) {
  const saved = idea.nextTest
  const suggestion = a.suggestion
  const [draft, setDraft] = useState<NextTest>(() => saved ?? suggestion)
  const [spendText, setSpendText] = useState(() => String((saved ?? suggestion).maxSpend))
  const [confirm, setConfirm] = useState(false)
  const [started, setStarted] = useState(false)
  const editing = useRef(false)
  const actionRef = useRef<HTMLTextAreaElement>(null)
  useAutosize(actionRef, draft.action)

  const sugKey = `${suggestion.action}|${suggestion.target}|${suggestion.goal}|${suggestion.criterion}|${suggestion.deadline}`
  useEffect(() => {
    if (saved || editing.current) return
    setDraft(suggestion)
    setSpendText(String(suggestion.maxSpend))
  }, [sugKey, saved])

  const set = <K extends keyof NextTest>(k: K, v: NextTest[K]) => {
    editing.current = true
    setDraft((d) => ({ ...d, [k]: v }))
  }

  const commit = (d: NextTest = draft) => {
    editing.current = false
    if (saved && same(saved, d) && saved.startedAt === d.startedAt) return
    void setNextTest(idea.id, d)
  }

  const onSpend = (v: string) => {
    setSpendText(v)
    const n = Number(v.replace(',', '.'))
    if (v.trim() === '') set('maxSpend', 0)
    else if (Number.isFinite(n) && n >= 0) set('maxSpend', n)
  }

  const useSuggestion = () => {
    const d = { ...suggestion, startedAt: saved?.startedAt ?? null }
    setDraft(d)
    setSpendText(String(d.maxSpend))
    commit(d)
  }

  const start = async (pauseOthers: boolean) => {
    setConfirm(false)
    if (pauseOthers) for (const o of testingOthers) await patchIdea(o.id, { status: 'paused' })
    const d = { ...draft, startedAt: new Date().toISOString() }
    setDraft(d)
    setStarted(true)
    await setNextTest(idea.id, d)
    await patchIdea(idea.id, { status: 'testing', decision: '' })
  }

  const run = testRun(idea, today)
  const crit = criterionDef(idea.kind, draft.criterion)
  const differs = !!saved && !same({ ...suggestion, deadline: saved.deadline }, { ...saved })

  return (
    <div className={`lab-test ${run ? 'is-running' : ''}`}>
      <div className="lab-stage-head">
        <p className="lab-stage-sub">
          {run ? (
            run.over ? (
              <>Prazo encerrado — registre o resultado e decida</>
            ) : (
              <>
                <b>Em teste</b> · dia {run.day} de {run.total} · até {dueLabel(run.deadline, today)}
              </>
            )
          ) : (
            <>Uma ação pequena para os próximos 7 dias{crit ? <>, para checar <b>{crit.label.toLowerCase()}</b></> : null}.</>
          )}
        </p>
        {!saved ? (
          <span className="lab-badge is-accent" title="Pré-preenchido pelo motor a partir do parecer. Tudo é editável.">sugestão do motor</span>
        ) : differs && !run ? (
          <button className="lab-textbtn" onClick={useSuggestion}>Usar a sugestão atual</button>
        ) : null}
      </div>

      {run && (
        <div className={`lab-runbar ${run.over ? 'is-over' : ''}`} aria-hidden="true">
          <span style={{ transform: `scaleX(${run.day / run.total})` }} />
        </div>
      )}
      {started && run && (
        <p className="lab-test-started" role="status">
          Teste começou. Quando tiver um número ou uma conversa, registre em Resultado.
        </p>
      )}

      <label className="lab-field lab-test-action">
        <span className="lab-label">Ação</span>
        <textarea
          ref={actionRef}
          className="lab-input lab-textarea lab-action-input"
          rows={2}
          maxLength={2000}
          value={draft.action}
          onChange={(e) => set('action', e.target.value)}
          onBlur={() => commit()}
        />
      </label>

      <div className="lab-form">
        <label className="lab-field">
          <span className="lab-label">Quem abordar / onde publicar</span>
          <input className="lab-input" maxLength={500} value={draft.target} onChange={(e) => set('target', e.target.value)} onBlur={() => commit()} />
        </label>
        <label className="lab-field">
          <span className="lab-label">Investimento máximo</span>
          <span className="lab-money">
            <span aria-hidden="true">R$</span>
            <input
              className="lab-input"
              inputMode="decimal"
              value={spendText}
              onChange={(e) => onSpend(e.target.value)}
              onBlur={() => {
                setSpendText(String(draft.maxSpend))
                commit()
              }}
              aria-label="Investimento máximo em reais"
            />
          </span>
        </label>
        <label className="lab-field">
          <span className="lab-label">Prazo</span>
          <input className="lab-input" type="date" value={draft.deadline} min={civil()} onChange={(e) => set('deadline', e.target.value)} onBlur={() => commit()} />
        </label>
        <label className="lab-field lab-span-2">
          <span className="lab-label">
            <TargetIcon size={12} /> Meta observável <em>hipótese — ajuste ao seu contexto</em>
          </span>
          <input className="lab-input" maxLength={500} value={draft.goal} onChange={(e) => set('goal', e.target.value)} onBlur={() => commit()} />
        </label>
        <label className="lab-field">
          <span className="lab-label">O teste valida</span>
          <select
            className="lab-input lab-select"
            value={draft.criterion ?? ''}
            onChange={(e) => {
              const d = { ...draft, criterion: e.target.value || null }
              setDraft(d)
              commit(d)
            }}
          >
            <option value="">Geral</option>
            {CRITERIA[idea.kind].map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>

      {a.dontDo.length > 0 && (
        <div className="lab-dont">
          <h4 className="lab-label">Enquanto testa, não faça</h4>
          <ul>
            {a.dontDo.map((d) => (
              <li key={d}>
                <BanIcon size={13} />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirm && (
        <div className="lab-notice" role="alert">
          <p>
            Você já tem <b>{testingOthers.map((o) => `“${o.title}”`).join(', ')}</b> em teste. Dá para seguir, mas uma ideia de cada vez costuma dar sinal mais
            claro.
          </p>
          <div className="lab-notice-actions">
            <button className="btn quiet lab-sm" onClick={() => setConfirm(false)}>Cancelar</button>
            <button className="btn lab-sm" onClick={() => void start(false)}>Começar mesmo assim</button>
            <button className="btn primary lab-sm" onClick={() => void start(true)}>
              Pausar {testingOthers.length > 1 ? 'as outras' : 'a outra'} e começar
            </button>
          </div>
        </div>
      )}

      {run ? (
        footer
      ) : (
        !confirm && (
          <div className="lab-stage-foot">
            <p className="lab-hint">
              Teto de <b>{money.format(draft.maxSpend)}</b>
              {draft.deadline && (
                <>
                  {' '}
                  · até <b>{shortDate(draft.deadline)}</b>
                </>
              )}
              {saved?.startedAt && <> · o último começou em {shortDate(saved.startedAt)}</>}
            </p>
            <button className="btn primary lab-cta" disabled={!draft.action.trim()} onClick={() => (testingOthers.length ? setConfirm(true) : void start(false))}>
              Começar teste
              <ArrowIcon size={13} />
            </button>
          </div>
        )
      )}
    </div>
  )
}
