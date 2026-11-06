import { useRef } from 'react'
import { actionFor, stageIndex, STAGES, type Focus, type NextStep, type Stage, type StageInfo } from './flow'
import { ArrowIcon, CheckIcon } from './icons'

const STATE_SR = { done: 'concluída', next: 'próximo passo', todo: '' } as const

export function Stepper({ current, info, onSelect }: {
  current: Stage
  info: Record<Stage, StageInfo>
  onSelect: (s: Stage) => void
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const at = stageIndex(current)

  const onKey = (e: React.KeyboardEvent) => {
    const last = STAGES.length - 1
    const to =
      e.key === 'ArrowRight' ? Math.min(last, at + 1) : e.key === 'ArrowLeft' ? Math.max(0, at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (to < 0) return
    e.preventDefault()
    if (to !== at) onSelect(STAGES[to].id)
    tabs.current[to]?.focus()
  }

  return (
    <div className="lab-stepper" role="tablist" aria-label="Etapas da ideia" onKeyDown={onKey} style={{ ['--at' as string]: at }}>
      <span className="lab-stepper-pill" aria-hidden="true" />
      {STAGES.map((s, i) => {
        const inf = info[s.id]
        const on = s.id === current
        return (
          <button
            key={s.id}
            ref={(el) => {
              tabs.current[i] = el
            }}
            id={`lab-tab-${s.id}`}
            role="tab"
            aria-selected={on}
            aria-controls="lab-stage"
            tabIndex={on ? 0 : -1}
            className={`lab-tab is-${inf.state} ${on ? 'is-on' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="lab-tab-mark" aria-hidden="true">
              {inf.state === 'done' ? <CheckIcon size={11} /> : i + 1}
            </span>
            <span className="lab-tab-text">
              <b>{s.label}</b>
              <span>{inf.sub}</span>
            </span>
            {STATE_SR[inf.state] && <span className="lab-sr">, {STATE_SR[inf.state]}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function NextStepBar({ step, current, text, quiet, onGo, onResume }: {
  step: NextStep
  current: Stage
  text?: string
  quiet?: boolean
  onGo: (s: Stage, f: Focus) => void
  onResume: () => void
}) {
  const act = actionFor(step, current)
  if (!act) return null
  return (
    <div className={`lab-nextbar is-${step.tone} ${quiet ? 'is-quiet' : ''}`}>
      <div className="lab-nextbar-text">
        <span className="lab-label">Próximo passo</span>
        <p>{text ?? step.title}</p>
      </div>
      <button className={`btn lab-cta ${quiet ? '' : 'primary'}`} onClick={() => (act.resume ? onResume() : onGo(act.stage, act.focus))}>
        {act.label}
        <ArrowIcon size={13} />
      </button>
    </div>
  )
}
