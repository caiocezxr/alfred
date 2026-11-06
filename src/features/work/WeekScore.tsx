import { Fragment, useRef } from 'react'
import { CompanyMark, coStyle } from './brand'
import type { WeekScore as Score, WeekStage } from './logic'
import { Odometer } from './Odometer'
import type { Company } from './types'

const STAGES: { k: WeekStage; label: string }[] = [
  { k: 'delivered', label: 'Entregues' },
  { k: 'validated', label: 'Validadas' },
  { k: 'done', label: 'Concluídas' },
]

const pct = (a: number, b: number) => (b ? Math.max(0, Math.min(1, a / b)) : 0)

export function WeekScore({ score, companies, title = 'Esta semana', className = '', variant = 'full' }: { score: Score; companies: Company[]; title?: string; className?: string; variant?: 'full' | 'compact' }) {
  const compact = variant === 'compact'
  const split = companies.filter((c) => score.split[c.id])
  const v = pct(score.validated, score.delivered)
  const d = pct(score.done, score.delivered)
  const board = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const tilt = (x: number, y: number) => {
    if (compact || raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const el = board.current
      if (!el) return
      el.style.setProperty('--rx', `${(x * 10).toFixed(2)}deg`)
      el.style.setProperty('--ry', `${(-y * 8).toFixed(2)}deg`)
      el.style.setProperty('--gx', `${Math.round((x + 0.5) * 100)}%`)
    })
  }
  return (
    <div
      ref={board}
      className={`wk-ws ${compact ? 'is-light' : 'is-board'} ${className}`}
      tabIndex={split.length ? 0 : undefined}
      aria-label={`${title}: ${score.delivered} entregues, ${score.validated} validadas, ${score.done} concluídas`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        tilt((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5)
      }}
      onPointerLeave={() => tilt(0, 0)}
    >
      <span className="wk-ws-title">{title}</span>
      <div className="wk-ws-row">
        {STAGES.map((s, i) => (
          <Fragment key={s.k}>
            {i > 0 &&
              (compact ? (
                <svg className="wk-ws-chev" viewBox="0 0 8 20" aria-hidden="true">
                  <path d="M1.5 3l5 7-5 7" />
                </svg>
              ) : (
                <span className="wk-ws-flow" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ))}
            <span className={`wk-ws-win is-${s.k}`}>
              <span className="wk-ws-dial">
                {!compact && <span className={`wk-ws-led ${score.last === s.k ? 'is-on' : ''}`} aria-hidden="true" />}
                <Odometer value={score[s.k]} digits={2} label={`${s.label} na semana`} />
              </span>
              <em>
                {compact && <span className={`wk-ws-led is-inline ${score.last === s.k ? 'is-on' : ''}`} aria-hidden="true" />}
                {s.label}
              </em>
            </span>
          </Fragment>
        ))}
      </div>
      {!compact && (
      <div className="wk-ws-conv" aria-hidden="true">
        <span className="wk-ws-bar is-v" title={`${Math.round(v * 100)}% das entregas já validadas`}>
          <i style={{ transform: `scaleX(${v})` }} />
        </span>
        <span className="wk-ws-bar is-d" title={`${Math.round(d * 100)}% das entregas já concluídas`}>
          <i style={{ transform: `scaleX(${d})` }} />
        </span>
      </div>
      )}
      {split.length > 0 && (
        <div className="wk-ws-pop" role="tooltip">
          <table>
            <thead>
              <tr>
                <th />
                <th>Entr.</th>
                <th>Valid.</th>
                <th>Concl.</th>
              </tr>
            </thead>
            <tbody>
              {split.map((c) => (
                <tr key={c.id} style={coStyle(c)}>
                  <td>
                    <CompanyMark company={c} size={12} />
                    {c.name}
                  </td>
                  <td>{score.split[c.id].delivered}</td>
                  <td>{score.split[c.id].validated}</td>
                  <td>{score.split[c.id].done}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
