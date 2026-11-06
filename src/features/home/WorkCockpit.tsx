import { useMemo } from 'react'
import { navigate } from '../../app/router'
import { civil } from '../../shared/dates'
import { profileScope, useProfile } from '../../shared/profile'
import { Gauge } from '../work/Gauge'
import { Roll } from '../work/Roll'
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

  return (
    <section className={`panel hc reveal is-${h.level}`} style={{ ['--i' as string]: 2 }} aria-label="Workstation">
      <div className="hc-gauge">
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
      </div>
      <div className="hc-side">
        <div className="hc-head">
          <span className="hc-k">Workstation</span>
          <span className={`hc-state is-${h.level}`}>{h.label || (today.loaded ? 'Tudo em dia' : ' ')}</span>
        </div>
        <WeekScore score={score} companies={state?.companies ?? []} className="is-compact" />
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
