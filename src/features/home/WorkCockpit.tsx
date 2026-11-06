import { useMemo } from 'react'
import { navigate } from '../../app/router'
import { civil } from '../../shared/dates'
import { profileScope, useProfile } from '../../shared/profile'
import { Gauge } from '../work/Gauge'
import { Odometer } from '../work/Odometer'
import { Roll } from '../work/Roll'
import { weekScore } from '../work/logic'
import { useWork } from '../work/store'
import { useWorkToday } from '../work/today'
import '../work/work.css'

export function WorkCockpit() {
  const profile = useProfile()
  const scope = profileScope(profile)
  const { state } = useWork()
  const today = useWorkToday(scope)
  const day = civil()
  const score = useMemo(() => (state ? weekScore(state, day, scope) : { delivered: 0, validated: 0, done: 0, byCompany: {} }), [state, day, scope])
  const h = today.health
  const red = h.total ? Math.min(1, (today.counts.late + today.counts.forget) / h.total) : 0
  const doing = today.counts.doing

  return (
    <section className={`panel hc reveal is-${h.level}`} style={{ ['--i' as string]: 2 }} aria-label="Workstation">
      <button className="hc-gauge" onClick={() => navigate('work')} title="Abrir a Workstation">
        <Gauge progress={h.total ? h.progress : 1} red={red} level={h.level}>
          {h.total ? (
            <span className="wk-gauge-num">
              <Roll value={h.handled} />
              <small>/{h.total}</small>
            </span>
          ) : (
            <span className="wk-gauge-num is-ok">OK</span>
          )}
          <span className="wk-gauge-cap">hoje</span>
        </Gauge>
      </button>
      <div className="hc-side">
        <div className="hc-head">
          <span className="hc-k">Workstation</span>
          <span className={`hc-state is-${h.level}`}>{h.label || (today.loaded ? 'Tudo em dia' : ' ')}</span>
        </div>
        <div className="hc-odo">
          <span title="Entregas na semana">
            <Odometer value={score.delivered} digits={2} label="Entregas na semana" />
            <em>entregas</em>
          </span>
          <span title="Validadas na semana">
            <Odometer value={score.validated} digits={2} label="Validadas na semana" />
            <em>validadas</em>
          </span>
        </div>
        <div className="hc-stats">
          <button onClick={() => navigate('work')}>
            <b>{doing}</b> fazendo
          </button>
          <button className={today.counts.late ? 'is-late' : ''} onClick={() => navigate('work')}>
            <b>{today.counts.late}</b> {today.counts.late === 1 ? 'atrasado' : 'atrasados'}
          </button>
        </div>
      </div>
    </section>
  )
}
