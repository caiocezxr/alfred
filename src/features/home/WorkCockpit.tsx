import type { ReactNode } from 'react'
import { navigate } from '../../app/router'
import { profileScope, useProfile } from '../../shared/profile'
import { Gauge, GaugeCenter } from '../work/Gauge'
import { useWorkToday } from '../work/today'
import '../work/work.css'

export function WorkCockpit({ children, gauge = true }: { children?: ReactNode; gauge?: boolean }) {
  const profile = useProfile()
  const scope = profileScope(profile)
  const today = useWorkToday(scope)
  const h = today.health
  const red = h.total ? Math.min(1, (today.counts.late + today.counts.forget) / h.total) : 0
  const doing = today.counts.doing
  const pending = today.items.find((x) => !x.done)
  const summary = h.total
    ? `${h.handled} de ${h.total} ${h.total === 1 ? 'resolvida' : 'resolvidas'} hoje${pending ? ` · ${pending.title} pendente` : ''}`
    : 'Nada para resolver hoje'

  const left = Math.max(0, h.total - h.handled)

  return (
    <section className={`panel hc reveal is-${h.level} ${gauge ? '' : 'no-gauge'}`} style={{ ['--i' as string]: 2 }} aria-label="Workstation">
      <header className="hc-head">
        <span className="hc-k">Seu dia</span>
        <button className="hc-open" onClick={() => navigate('work')}>
          Workstation
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 6h7.5M6.5 3 9.5 6 6.5 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <div className="hc-body">
        <div
          className="hc-gauge"
          role="link"
          tabIndex={0}
          onClick={() => navigate('work')}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), navigate('work'))}
          aria-label="Abrir a Workstation"
          title={summary}
        >
          <Gauge progress={h.total ? h.progress : 1} red={red} level={h.level}>
            <GaugeCenter left={left} />
          </Gauge>
        </div>
        <div className="hc-side">
          <span className={`hc-state is-${h.level}`}>{h.label || (today.loaded ? 'Tudo em dia por aqui' : ' ')}</span>
          <div className="hc-line">
            <button onClick={() => navigate('work')}>
              <b>{doing}</b> fazendo
            </button>
            <button className={today.counts.late ? 'is-late' : ''} onClick={() => navigate('work')}>
              <b>{today.counts.late}</b> {today.counts.late === 1 ? 'atrasado' : 'atrasados'}
            </button>
            <button onClick={() => navigate('work')}>
              <b>{today.counts.todosLeft}</b> {today.counts.todosLeft === 1 ? 'to-do' : 'to-dos'}
            </button>
          </div>
        </div>
      </div>
      {children}
    </section>
  )
}
