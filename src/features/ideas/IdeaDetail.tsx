import { useEffect, useRef, useState } from 'react'
import { Diagnosis } from './Diagnosis'
import { VERDICT_LABEL, type Assessment } from './engine'
import { focusFor, nextStep, reopenStatus, resumeStatus, stageIndex, stageInfo, VERDICT_CHIP, type Focus, type NextStep, type Stage } from './flow'
import { DecisionIcon, KindIcon, MoreIcon, PauseIcon, PlayIcon, TrashIcon, VerdictIcon } from './icons'
import { KIND_LABEL, KIND_SHORT, STATUS_LABEL, type PrincipleId } from './questions'
import { ResultStage } from './ResultStage'
import { NextStepBar, Stepper } from './Stepper'
import { assessIdea, patchIdea, removeIdea } from './store'
import { TestStage } from './TestStage'
import type { Idea, IdeaKind } from './types'
import { ago, reducedMotion, useAutosize, useDismiss } from './util'
import { Verdict } from './Verdict'

export type OpenRequest = { id: string; stage: Stage; focus: Focus; n: number }

type View = { stage: Stage; focus: Focus; jump: string | null; dir: 1 | -1; n: number }

export function IdeaDetail({ idea, ideas, today, request, onPrinciple }: {
  idea: Idea
  ideas: Idea[]
  today: string
  request: OpenRequest | null
  onPrinciple: (id: PrincipleId) => void
}) {
  const a = assessIdea(idea, today)
  const step = nextStep(idea, a, today)
  const info = stageInfo(idea, a, step, today)
  const mine = request?.id === idea.id ? request : null
  const [view, setView] = useState<View>(() => ({ stage: mine?.stage ?? step.stage, focus: mine?.focus ?? null, jump: null, dir: 1, n: 0 }))
  const handled = useRef(mine?.n ?? -1)

  const go = (stage: Stage, focus: Focus = null, jump: string | null = null) =>
    setView((v) => ({ stage, focus, jump, dir: stageIndex(stage) >= stageIndex(v.stage) ? 1 : -1, n: v.n + 1 }))

  useEffect(() => {
    if (!mine || mine.n === handled.current) return
    handled.current = mine.n
    if (view.n === 0 && view.stage === mine.stage) return
    go(mine.stage, mine.focus)
  }, [mine?.n])

  const article = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view.n === 0) return
    const stepper = article.current?.querySelector('.lab-stepper')
    if (stepper && stepper.getBoundingClientRect().top < 0) stepper.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
    const active = document.activeElement
    if (!active || active === document.body) stageRef.current?.focus({ preventScroll: true })
  }, [view.n])

  const resume = () => void patchIdea(idea.id, { status: resumeStatus(idea) })
  const jumpTo = (questionId: string) => go('diagnosis', 'question', questionId)
  const bar = (opts: { quiet?: boolean; text?: string } = {}) => (
    <NextStepBar step={step} current={view.stage} quiet={opts.quiet} text={opts.text} onGo={go} onResume={resume} />
  )
  const testingOthers = ideas.filter((i) => i.id !== idea.id && i.status === 'testing' && !!i.nextTest?.startedAt)

  return (
    <article ref={article} className="panel lab-detail" aria-label={idea.title}>
      <DetailHeader idea={idea} a={a} step={step} today={today} stage={view.stage} onGo={go} onResume={resume} />
      <Stepper current={view.stage} info={info} onSelect={(s) => go(s)} />

      <div
        key={`${view.n}:${idea.kind}`}
        ref={stageRef}
        tabIndex={-1}
        id="lab-stage"
        role="tabpanel"
        aria-labelledby={`lab-tab-${view.stage}`}
        className={`lab-stage ${view.dir > 0 ? 'from-right' : 'from-left'}`}
      >
        {view.stage === 'diagnosis' && (
          <Diagnosis idea={idea} a={a} jumpTo={view.jump} autoFocus={view.focus === 'question'} onComplete={() => go('verdict')} footer={bar()} />
        )}
        {view.stage === 'verdict' && (
          <Verdict
            idea={idea}
            a={a}
            onJump={jumpTo}
            onPrinciple={onPrinciple}
            footer={bar({ text: step.id === 'plan' ? `Sugestão para esta semana: ${a.cheapTest}` : undefined })}
          />
        )}
        {view.stage === 'test' && <TestStage idea={idea} a={a} today={today} testingOthers={testingOthers} footer={bar()} />}
        {view.stage === 'result' && <ResultStage idea={idea} a={a} step={step} today={today} focus={view.focus} footer={bar({ quiet: true })} />}
      </div>
    </article>
  )
}

function DetailHeader({ idea, a, step, today, stage, onGo, onResume }: {
  idea: Idea
  a: Assessment
  step: NextStep
  today: string
  stage: Stage
  onGo: (s: Stage, f?: Focus) => void
  onResume: () => void
}) {
  const [title, setTitle] = useState(idea.title)
  const [desc, setDesc] = useState(idea.description)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  useAutosize(titleRef, title)
  useAutosize(descRef, desc)

  const saveTitle = () => {
    const t = title.trim()
    if (!t) return setTitle(idea.title)
    if (t !== idea.title) void patchIdea(idea.id, { title: t })
  }
  const saveDesc = () => {
    if (desc.trim() !== idea.description) void patchIdea(idea.id, { description: desc })
  }

  const kicker = step.id === 'archived' ? 'Arquivada' : step.id === 'paused' ? 'Pausada' : 'Próximo passo'
  const canGo = step.id === 'paused' || (step.id !== 'archived' && step.stage !== stage)

  return (
    <header className="lab-dhead">
      <div className="lab-dhead-meta">
        <span className="lab-dhead-kind" title={KIND_LABEL[idea.kind]}>
          <KindIcon kind={idea.kind} size={14} />
          {KIND_SHORT[idea.kind]}
        </span>
        <span className="lab-dhead-sep" aria-hidden="true" />
        <span>{STATUS_LABEL[idea.status]}</span>
        <span className="lab-dhead-sep" aria-hidden="true" />
        <span>capturada {ago(idea.createdAt, today)}</span>
        <MoreMenu idea={idea} onResume={onResume} />
      </div>

      <textarea
        ref={titleRef}
        className="display lab-title"
        rows={1}
        value={title}
        maxLength={200}
        aria-label="Título da ideia"
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
          if (e.key === 'Escape') {
            setTitle(idea.title)
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
      />
      <textarea
        ref={descRef}
        className="lab-desc"
        rows={1}
        value={desc}
        maxLength={5000}
        placeholder="Adicione uma descrição — o problema, para quem, o estalo que deu."
        aria-label="Descrição da ideia"
        onChange={(e) => setDesc(e.target.value)}
        onBlur={saveDesc}
      />

      <div className="lab-dhead-foot">
        <button className={`lab-verdict-chip is-${a.verdict}`} onClick={() => onGo('verdict')} title={`Parecer: ${VERDICT_LABEL[a.verdict]} — ver o parecer`}>
          <span key={a.verdict} className="lab-verdict-chip-in">
            <VerdictIcon verdict={a.verdict} size={15} />
            {VERDICT_CHIP[a.verdict]}
          </span>
        </button>
        <p className={`lab-dhead-next is-${step.tone}`}>
          <span className="lab-dhead-next-k">{kicker}</span>
          {canGo ? (
            <button className="lab-dhead-next-t is-link" onClick={() => (step.id === 'paused' ? onResume() : onGo(step.stage, focusFor(step)))}>
              {step.id === 'paused' ? 'Retomar a ideia' : step.title}
            </button>
          ) : (
            <span className="lab-dhead-next-t">{step.title}</span>
          )}
        </p>
      </div>
    </header>
  )
}

function MoreMenu({ idea, onResume }: { idea: Idea; onResume: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const close = () => {
    setOpen(false)
    setConfirm(false)
  }
  const { box, trigger } = useDismiss(open, close)
  const other: IdeaKind = idea.kind === 'product' ? 'content' : 'product'
  const run = (fn: () => void) => () => {
    close()
    trigger.current?.focus()
    fn()
  }
  const archived = idea.status === 'archived'
  const paused = idea.status === 'paused'

  return (
    <div className="lab-menu-wrap lab-dhead-more" ref={box}>
      <button ref={trigger} className="lab-icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Mais ações" onClick={() => (open ? close() : setOpen(true))}>
        <MoreIcon />
      </button>
      {open && (
        <div className="lab-menu is-right" role="menu" aria-label="Mais ações">
          {!archived &&
            (paused ? (
              <button role="menuitem" className="lab-menu-item" onClick={run(onResume)}>
                <PlayIcon size={15} />
                <span className="lab-menu-text">
                  <b>Retomar</b>
                  <span>Volta para o foco, de onde parou</span>
                </span>
              </button>
            ) : (
              <button role="menuitem" className="lab-menu-item" onClick={run(() => void patchIdea(idea.id, { status: 'paused' }))}>
                <PauseIcon size={15} />
                <span className="lab-menu-text">
                  <b>Pausar</b>
                  <span>Sai do foco sem perder nada</span>
                </span>
              </button>
            ))}
          {archived ? (
            <button
              role="menuitem"
              className="lab-menu-item"
              onClick={run(() => void patchIdea(idea.id, idea.decision === 'archive' ? { status: reopenStatus(idea), decision: '' } : { status: reopenStatus(idea) }))}
            >
              <PlayIcon size={15} />
              <span className="lab-menu-text">
                <b>Reabrir</b>
                <span>Volta para as ideias em andamento</span>
              </span>
            </button>
          ) : (
            <button role="menuitem" className="lab-menu-item" onClick={run(() => void patchIdea(idea.id, { status: 'archived' }))}>
              <DecisionIcon d="archive" size={15} />
              <span className="lab-menu-text">
                <b>Arquivar</b>
                <span>Guarda a ideia e o aprendizado, fora da lista</span>
              </span>
            </button>
          )}
          <button role="menuitem" className="lab-menu-item" onClick={run(() => void patchIdea(idea.id, { kind: other }))}>
            <KindIcon kind={other} size={15} />
            <span className="lab-menu-text">
              <b>Tratar como {other === 'product' ? 'produto' : 'conteúdo'}</b>
              <span>Troca as perguntas; as respostas atuais ficam guardadas</span>
            </span>
          </button>
          <span className="lab-menu-sep" role="separator" />
          <button
            role="menuitem"
            className={`lab-menu-item is-danger ${confirm ? 'is-confirm' : ''}`}
            onClick={() => (confirm ? void removeIdea(idea.id) : setConfirm(true))}
          >
            <TrashIcon size={15} />
            <span className="lab-menu-text">
              <b>{confirm ? 'Confirmar exclusão' : 'Excluir ideia'}</b>
              <span>{confirm ? 'Apaga a ideia e as evidências de vez' : 'Prefira arquivar para guardar o aprendizado'}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
