import { useMemo } from 'react'
import { navigate } from '../../app/router'
import { civil } from '../../shared/dates'
import { profileScope, useProfile } from '../../shared/profile'
import { Gauge, GaugeCenter } from '../work/Gauge'
import { weekScore, type WeekScore as Score } from '../work/logic'
import { WeekScore } from '../work/WeekScore'
import { useWork } from '../work/store'
import { useWorkToday } from '../work/today'
import '../work/work.css'

export function WorkCockpit() {
  const profile = useProfile()
  const scope = profileScope(profile)
  const { state } = useWork()
  const today = useWorkToday(scope)
  const day = civil()
  const score = useMemo<Score>(
    () => (state ? weekScore(state, day, scope) : { delivered: 0, validated: 0, done: 0, byCompany: {}, split: {}, last: null, lastAt: null }),
    [state, day, scope],
  )
  const h = today.health
  const red = h.total ? Math.min(1, (today.counts.late + today.counts.forget) / h.total) : 0
  const doing = today.counts.doing
  const pending = today.items.find((x) => !x.done)
  const summary = h.total
    ? `${h.handled} de ${h.total} ${h.total === 1 ? 'resolvida' : 'resolvidas'} hoje${pending ? ` · ${pending.title} pendente` : ''}`
    : 'Nada para resolver hoje'

  const left = Math.max(0, h.total - h.handled)

  return (
    <section className={`panel hc reveal is-${h.level}`} style={{ ['--i' as string]: 2 }} aria-label="Workstation">
      <header className="hc-head">
        <span className="hc-k">Workstation</span>
        <button className="hc-open" onClick={() => navigate('work')}>
          Abrir
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 6h7.5M6.5 3 9.5 6 6.5 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <div className="hc-body">
        <button className="hc-gauge" onClick={() => navigate('work')} aria-label="Abrir a Workstation" title={summary}>
          <Gauge progress={h.total ? h.progress : 1} red={red} level={h.level}>
            <GaugeCenter left={left} />
          </Gauge>
        </button>
        <div className="hc-side">
          <span className={`hc-state is-${h.level}`}>{h.label || (today.loaded ? 'Tudo em dia por aqui' : ' ')}</span>
          <div className="hc-stats">
            <button onClick={() => navigate('work')}>
              <b>{doing}</b>
              <span>fazendo</span>
            </button>
            <button className={today.counts.late ? 'is-late' : ''} onClick={() => navigate('work')}>
              <b>{today.counts.late}</b>
              <span>{today.counts.late === 1 ? 'atrasado' : 'atrasados'}</span>
            </button>
            <button onClick={() => navigate('work')}>
              <b>{today.counts.todosLeft}</b>
              <span>to-dos</span>
            </button>
          </div>
        </div>
      </div>
      <WeekScore score={score} companies={state?.companies ?? []} className="is-compact hc-score" />
    </section>
  )
}
