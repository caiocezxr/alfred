import { useEffect, useMemo, useState } from 'react'
import { onIntent } from '../../app/router'
import { addDays, civil, fmtLong, fmtShort, parseCivil } from '../../shared/dates'
import type { Checkin, CheckinStatus, Habit } from '../../shared/db/api'
import {
  WEEKDAY_LETTERS, archiveHabit, createHabit, daysOn, describeDays, habitStats, isPausedNow, isScheduled,
  monthGrid, setCheckin, setHabitPaused, updateHabit, useHabits,
} from '../../shared/db/stores'
import './habits.css'

const monthShort = new Intl.DateTimeFormat('pt-BR', { month: 'short' })

export default function Habits() {
  const { habits, checkins } = useHabits()
  const today = civil()
  const [editing, setEditing] = useState<Habit | 'new' | null>(null)
  useEffect(() => onIntent((i) => i === 'new-habit' && setEditing('new')), [])

  const todays = habits.filter((h) => isScheduled(h, today))
  const statusOf = (id: string) => checkins.find((c) => c.habitId === id && c.date === today)?.status ?? null
  const done = todays.filter((h) => statusOf(h.id)).length

  return (
    <section className="page habits">
      <header className="h-head reveal" style={{ ['--i' as string]: 0 }}>
        <div>
          <div className="kicker">{fmtLong.format(new Date())}</div>
          <h1 className="display">Hábitos</h1>
          <p className="h-sub">
            {habits.length === 0
              ? 'Pequeno, óbvio e fácil de começar.'
              : todays.length === 0
                ? 'Nenhum hábito marcado para hoje.'
                : done === todays.length
                  ? 'Tudo feito hoje. Bom trabalho.'
                  : `${done} de ${todays.length} feitos hoje`}
          </p>
        </div>
        <div className="h-head-right">
          {todays.length > 0 && <DayRing value={done} total={todays.length} />}
          <button className="btn primary" onClick={() => setEditing('new')}>Novo hábito</button>
        </div>
      </header>

      {editing && <HabitForm habit={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      {habits.length === 0 && !editing ? (
        <div className="panel h-empty reveal" style={{ ['--i' as string]: 1 }}>
          <h2 className="display">Comece pequeno.</h2>
          <p>
            Um bom hábito cabe numa frase: <em>depois de [algo que você já faz], vou [ação] por [tempo] em [lugar]</em>.
            Defina também a versão mínima, para os dias difíceis — ela conta.
          </p>
          <button className="btn primary" onClick={() => setEditing('new')}>Criar o primeiro</button>
        </div>
      ) : (
        <>
          {todays.length > 0 && (
            <section className="h-today" aria-label="Hoje">
              {todays.map((h, i) => (
                <TodayCard key={h.id} habit={h} status={statusOf(h.id)} today={today} index={i} />
              ))}
            </section>
          )}
          <div className="h-list">
            {habits.map((h, i) => (
              <HabitCard key={h.id} habit={h} checkins={checkins} today={today} index={i} onEdit={() => setEditing(h)} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function DayRing({ value, total }: { value: number; total: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  const pct = total ? value / total : 0
  return (
    <div className="day-ring" role="img" aria-label={`${value} de ${total} hábitos feitos hoje`}>
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} className="ring-track" />
        <circle cx="28" cy="28" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span>{Math.round(pct * 100)}%</span>
    </div>
  )
}

function TodayCard({ habit, status, today, index }: { habit: Habit; status: CheckinStatus | null; today: string; index: number }) {
  const r = 17
  const c = 2 * Math.PI * r
  const fill = status === 'done' ? 1 : status === 'minimum' ? 0.5 : 0
  return (
    <article className={`panel h-card-today reveal ${status ? `is-${status}` : ''}`} style={{ ['--i' as string]: index + 1 }}>
      <button
        className="h-ring"
        onClick={() => setCheckin(habit.id, today, status === 'done' ? null : 'done')}
        aria-label={status === 'done' ? `Desmarcar ${habit.name}` : `Marcar ${habit.name} como feito`}
        aria-pressed={status === 'done'}
      >
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r={r} className="ring-track" />
          <circle cx="22" cy="22" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - fill)} />
        </svg>
        <svg className="h-ring-tick" width="16" height="16" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="h-today-text">
        <h3>{habit.name}</h3>
        <p>{habit.cue ? `Depois de ${habit.cue.replace(/^depois de\s*/i, '')}` : habit.timeOfDay ? `às ${habit.timeOfDay}` : describeDays(daysOn(habit, today))}</p>
      </div>
      <button
        className={`h-min ${status === 'minimum' ? 'is-on' : ''}`}
        onClick={() => setCheckin(habit.id, today, status === 'minimum' ? null : 'minimum')}
        title={habit.minimum ? `Versão mínima: ${habit.minimum}` : 'Fiz a versão mínima'}
      >
        mínimo
      </button>
    </article>
  )
}

function HabitCard({ habit, checkins, today, index, onEdit }: { habit: Habit; checkins: Checkin[]; today: string; index: number; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const paused = isPausedNow(habit)
  const s7 = habitStats(habit, checkins, addDays(today, -6), today)
  const s30 = habitStats(habit, checkins, addDays(today, -29), today)
  const prev30 = habitStats(habit, checkins, addDays(today, -59), addDays(today, -30))
  const trend = s30.rate !== null && prev30.rate !== null ? s30.rate - prev30.rate : null
  const grid = useMemo(() => monthGrid(today, 22), [today])
  const byDate = useMemo(() => new Map(checkins.filter((c) => c.habitId === habit.id).map((c) => [c.date, c.status])), [checkins, habit.id])
  const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)

  return (
    <article className={`panel h-card reveal ${paused ? 'is-paused' : ''}`} style={{ ['--i' as string]: index + 2 }}>
      <header className="h-card-head">
        <div>
          <h2>{habit.name}</h2>
          <p className="h-meta">
            {describeDays(daysOn(habit, today) || 127)}
            {habit.timeOfDay && ` · ${habit.timeOfDay}`}
            {paused && <span className="h-paused">pausado</span>}
          </p>
        </div>
        <dl className="h-stats">
          <div><dt>7 dias</dt><dd>{pct(s7.rate)}</dd></div>
          <div><dt>30 dias</dt><dd>{pct(s30.rate)}</dd></div>
          <div>
            <dt>tendência</dt>
            <dd className={trend === null ? '' : trend >= 0 ? 'up' : 'down'}>
              {trend === null ? '—' : `${trend >= 0 ? '+' : '−'}${Math.abs(Math.round(trend * 100))}`}
            </dd>
          </div>
        </dl>
      </header>

      <div className="h-body">
      <div className="heat" role="img" aria-label={`Consistência: ${pct(s30.rate)} nos últimos 30 dias`}>
        <div className="heat-days">
          {WEEKDAY_LETTERS.map((l, i) => (
            <span key={i}>{i % 2 === 1 ? l : ''}</span>
          ))}
        </div>
        <div className="heat-body">
          <div className="heat-months">
            {grid.map((col, ci) => {
              const first = col.find((d) => d.endsWith('-01') || (ci === 0 && d === col[0]))
              const label = col.some((d) => d.endsWith('-01')) || ci === 0 ? monthShort.format(parseCivil(first ?? col[0])).replace('.', '') : ''
              return <span key={ci}>{label}</span>
            })}
          </div>
          <div className="heat-cols">
            {grid.map((col, ci) => (
              <div key={ci} className="heat-col">
                {col.map((d) => {
                  const st = byDate.get(d)
                  const sch = isScheduled(habit, d)
                  const future = d > today
                  const cls = future ? 'is-future' : st === 'done' ? 'is-done' : st === 'minimum' ? 'is-min' : sch ? 'is-miss' : 'is-off'
                  return (
                    <i
                      key={d}
                      className={`${cls} ${d === today ? 'is-today' : ''}`}
                      title={`${fmtShort.format(parseCivil(d))}${st ? ` · ${st === 'done' ? 'feito' : 'mínimo'}` : sch && !future ? ' · não marcado' : ''}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {(habit.cue || habit.minimum || habit.obstaclePlan || habit.why) && (
        <dl className="h-notes">
          {habit.cue && <div><dt>Gatilho</dt><dd>Depois de {habit.cue.replace(/^depois de\s*/i, '')}</dd></div>}
          {habit.minimum && <div><dt>Versão mínima</dt><dd>{habit.minimum}</dd></div>}
          {habit.obstaclePlan && <div><dt>Se/então</dt><dd>{habit.obstaclePlan}</dd></div>}
          {habit.why && <div><dt>Por quê</dt><dd>{habit.why}</dd></div>}
        </dl>
      )}
      </div>

      <footer className="h-actions">
        <button className="btn quiet sm" onClick={onEdit}>Editar</button>
        <button className="btn quiet sm" onClick={() => setHabitPaused(habit.id, !paused)}>{paused ? 'Retomar' : 'Pausar'}</button>
        <button className={`btn quiet sm ${confirm ? 'is-danger' : ''}`} onClick={() => (confirm ? archiveHabit(habit.id) : setConfirm(true))} onBlur={() => setConfirm(false)}>
          {confirm ? 'Arquivar? O histórico fica guardado' : 'Arquivar'}
        </button>
      </footer>
    </article>
  )
}

function HabitForm({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const today = civil()
  const [name, setName] = useState(habit?.name ?? '')
  const [days, setDays] = useState(habit ? daysOn(habit, today) || 127 : 127)
  const [time, setTime] = useState(habit?.timeOfDay ?? '')
  const [cue, setCue] = useState(habit?.cue ?? '')
  const [minimum, setMinimum] = useState(habit?.minimum ?? '')
  const [why, setWhy] = useState(habit?.why ?? '')
  const [plan, setPlan] = useState(habit?.obstaclePlan ?? '')
  const [start, setStart] = useState(habit?.startDate ?? today)
  const [more, setMore] = useState(!!(habit?.why || habit?.obstaclePlan))

  const save = async () => {
    if (!name.trim() || !days) return
    if (habit) await updateHabit(habit.id, { name, days, timeOfDay: time, cue, minimum, why, obstaclePlan: plan, today })
    else await createHabit({ name, days, timeOfDay: time || null, cue, minimum, why, obstaclePlan: plan, startDate: start })
    onClose()
  }

  return (
    <form
      className="panel h-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="h-form-head">
        <h2 className="display">{habit ? 'Editar hábito' : 'Novo hábito'}</h2>
        <p className="h-sentence">
          Depois de <b>{cue || 'algo que você já faz'}</b>, vou <b>{name || 'fazer o hábito'}</b>
          {minimum ? <> — no mínimo <b>{minimum}</b></> : null}.
        </p>
      </div>

      <div className="h-form-grid">
        <label className="f">
          <span>Hábito</span>
          <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ler 10 páginas" />
        </label>
        <label className="f">
          <span>Gatilho — depois de…</span>
          <input className="field" value={cue} onChange={(e) => setCue(e.target.value)} placeholder="tomar o café da manhã" />
        </label>
        <label className="f">
          <span>Versão mínima</span>
          <input className="field" value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="1 página" />
        </label>
        <label className="f">
          <span>Horário (opcional)</span>
          <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      <div className="f">
        <span>Dias</span>
        <div className="days">
          {WEEKDAY_LETTERS.map((l, i) => (
            <button
              type="button"
              key={i}
              className={`day ${days & (1 << i) ? 'is-on' : ''}`}
              aria-pressed={!!(days & (1 << i))}
              aria-label={['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][i]}
              onClick={() => setDays((d) => d ^ (1 << i))}
            >
              {l}
            </button>
          ))}
          <span className="days-sep" />
          <button type="button" className={`btn quiet sm ${days === 127 ? 'is-on' : ''}`} onClick={() => setDays(127)}>todos</button>
          <button type="button" className={`btn quiet sm ${days === 62 ? 'is-on' : ''}`} onClick={() => setDays(62)}>úteis</button>
          {!habit && (
            <label className="f start">
              <span>começa em</span>
              <input className="field" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
          )}
        </div>
      </div>

      {more ? (
        <div className="h-form-grid">
          <label className="f">
            <span>Por que isso importa?</span>
            <textarea className="field" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <label className="f">
            <span>Obstáculo previsível e plano se/então</span>
            <textarea className="field" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Se eu chegar tarde, então leio 1 página antes de dormir." />
          </label>
        </div>
      ) : (
        <button type="button" className="link" onClick={() => setMore(true)}>+ motivo e plano se/então</button>
      )}

      <div className="form-actions">
        <button type="button" className="btn quiet" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn primary" disabled={!name.trim() || !days}>{habit ? 'Salvar' : 'Criar hábito'}</button>
      </div>
    </form>
  )
}
