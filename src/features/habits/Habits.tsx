import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { onIntent } from '../../app/router'
import { addDays, civil, fmtLong, fmtShort, parseCivil, weekday } from '../../shared/dates'
import type { Checkin, CheckinStatus, Habit } from '../../shared/db/api'
import {
  WEEKDAY_LETTERS, archiveHabit, createHabit, daysOn, describeDays, habitStats, isPausedNow, isScheduled,
  setCheckin, setHabitPaused, updateHabit, useHabits,
} from '../../shared/db/stores'
import { Odometer } from '../work/Odometer'
import '../work/work.css'
import './habits.css'

const TRAIL = 14
const dayName = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })

type StatusMap = Map<string, CheckinStatus>

function statusMap(checkins: Checkin[], id: string): StatusMap {
  return new Map(checkins.filter((c) => c.habitId === id).map((c) => [c.date, c.status]))
}

function streakOf(h: Habit, map: StatusMap, today: string) {
  let n = 0
  let d = map.get(today) ? today : addDays(today, -1)
  for (let i = 0; i < 400; i++) {
    if (d < h.startDate) break
    if (isScheduled(h, d)) {
      if (!map.get(d)) break
      n++
    }
    d = addDays(d, -1)
  }
  return n
}

function allDoneStreak(habits: Habit[], checkins: Checkin[], today: string) {
  const maps = new Map(habits.map((h) => [h.id, statusMap(checkins, h.id)]))
  const full = (d: string) => {
    const due = habits.filter((h) => isScheduled(h, d))
    return due.length > 0 && due.every((h) => maps.get(h.id)!.get(d))
  }
  let n = 0
  let d = full(today) ? today : addDays(today, -1)
  for (let i = 0; i < 400; i++) {
    const due = habits.filter((h) => isScheduled(h, d))
    if (!due.length) {
      d = addDays(d, -1)
      if (d < (habits.map((h) => h.startDate).sort()[0] ?? d)) break
      continue
    }
    if (!full(d)) break
    n++
    d = addDays(d, -1)
  }
  return n
}

const next = (s: CheckinStatus | null): CheckinStatus | null => (s === 'done' ? null : 'done')
const cycle = (s: CheckinStatus | null): CheckinStatus | null => (s === null ? 'done' : s === 'done' ? 'minimum' : null)

export default function Habits() {
  const { habits, checkins } = useHabits()
  const today = civil()
  const [editing, setEditing] = useState<Habit | 'new' | null>(null)
  const [flash, setFlash] = useState(0)
  useEffect(() => onIntent((i) => i === 'new-habit' && setEditing('new')), [])

  const todays = habits.filter((h) => isScheduled(h, today))
  const statusOf = (id: string) => checkins.find((c) => c.habitId === id && c.date === today)?.status ?? null
  const done = todays.filter((h) => statusOf(h.id)).length
  const all = todays.length > 0 && done === todays.length
  const streak = useMemo(() => allDoneStreak(habits, checkins, today), [habits, checkins, today])
  const wasAll = useRef(all)

  useEffect(() => {
    if (all && !wasAll.current) setFlash((f) => f + 1)
    wasAll.current = all
  }, [all])

  const live = useRef({ todays, statusOf })
  live.current = { todays, statusOf }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const n = Number(e.key)
      const h = live.current.todays[n - 1]
      if (!h) return
      e.preventDefault()
      void setCheckin(h.id, civil(), e.shiftKey ? (live.current.statusOf(h.id) === 'minimum' ? null : 'minimum') : next(live.current.statusOf(h.id)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <section className={`page hb ${all ? 'is-all' : ''}`}>
      <header className="hb-head reveal" style={{ ['--i' as string]: 0 }}>
        <div>
          <div className="kicker">{fmtLong.format(new Date())}</div>
          <h1 className="display">Hábitos</h1>
        </div>
        <div className="hb-meter" aria-label={`${done} de ${todays.length} feitos hoje`}>
          <div className="hb-meter-count">
            <Odometer value={done} digits={2} label="Feitos hoje" />
            <span className="hb-meter-of">/ {String(todays.length).padStart(2, '0')}</span>
          </div>
          <div className="hb-leds" aria-hidden="true">
            {todays.map((h) => (
              <i key={h.id} className={`is-${statusOf(h.id) ?? 'off'}`} />
            ))}
          </div>
          <span className="hb-meter-l">{all ? 'Tudo feito hoje' : todays.length ? 'Feitos hoje' : 'Nada para hoje'}</span>
          {streak > 0 && (
            <span className="hb-streak" title="Dias seguidos com tudo feito">
              <b>{streak}</b> {streak === 1 ? 'dia' : 'dias'} completo{streak === 1 ? '' : 's'} seguidos
            </span>
          )}
        </div>
      </header>

      {editing && <HabitForm habit={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      <section className="hb-panel reveal" style={{ ['--i' as string]: 1 }} aria-label="Hoje">
        {flash > 0 && <span key={flash} className="hb-sweep" aria-hidden="true" />}
        <div className="hb-panel-h">
          <span className="hb-plate">Hoje</span>
          {todays.length > 0 && (
            <span className="hb-panel-hint">
              clique liga · <kbd>1</kbd>–<kbd>{Math.min(9, todays.length)}</kbd> no teclado · <kbd>⇧</kbd> marca o mínimo
            </span>
          )}
        </div>
        <div className="hb-grid">
          {todays.map((h, i) => (
            <Switch key={h.id} habit={h} n={i + 1} status={statusOf(h.id)} today={today} checkins={checkins} />
          ))}
          <button className="hb-mod is-add" onClick={() => setEditing('new')}>
            <span className="hb-add-plus" aria-hidden="true">+</span>
            <span className="hb-name">Novo hábito</span>
            <span className="hb-sub">pequeno e fácil de começar</span>
          </button>
        </div>
        {habits.length > 0 && todays.length === 0 && <p className="hb-none">Nenhum hábito marcado para hoje. Aproveita o descanso.</p>}
      </section>

      {habits.length > 0 && (
        <section className="hb-trail reveal" style={{ ['--i' as string]: 2 }} aria-label="Rastro">
          <header className="hb-trail-h">
            <span className="hb-plate">Rastro</span>
            <span className="hb-days" aria-hidden="true">
              {Array.from({ length: TRAIL }, (_, i) => {
                const d = addDays(today, i - TRAIL + 1)
                return (
                  <span key={d} className={d === today ? 'is-today' : weekday(d) === 0 || weekday(d) === 6 ? 'is-wk' : ''}>
                    {dayName.format(parseCivil(d)).slice(0, 1).toUpperCase()}
                  </span>
                )
              })}
            </span>
            <span className="hb-cols">
              <span>Sequência</span>
              <span>30 dias</span>
            </span>
          </header>
          {habits.map((h, i) => (
            <TrailRow key={h.id} habit={h} checkins={checkins} today={today} index={i} onEdit={() => setEditing(h)} />
          ))}
          <p className="hb-legend">
            <i className="is-done" /> feito <i className="is-minimum" /> mínimo <i className="is-miss" /> não marcado · clique num dia para corrigir
          </p>
        </section>
      )}
    </section>
  )
}

function Switch({ habit, n, status, today, checkins }: { habit: Habit; n: number; status: CheckinStatus | null; today: string; checkins: Checkin[] }) {
  const map = useMemo(() => statusMap(checkins, habit.id), [checkins, habit.id])
  const streak = streakOf(habit, map, today)
  const sub = habit.cue ? `depois de ${habit.cue.replace(/^depois de\s*/i, '')}` : habit.timeOfDay ? `às ${habit.timeOfDay}` : describeDays(daysOn(habit, today))
  return (
    <article className={`hb-mod is-${status ?? 'off'}`} style={{ ['--i' as string]: n } as CSSProperties}>
      <span className="hb-n">{String(n).padStart(2, '0')}</span>
      <span className="hb-led" aria-hidden="true" />
      <button
        className="hb-toggle"
        onClick={() => void setCheckin(habit.id, today, next(status))}
        aria-pressed={status === 'done'}
        aria-label={status === 'done' ? `Desmarcar ${habit.name}` : `Marcar ${habit.name} como feito`}
      >
        <span className="hb-bezel" aria-hidden="true" />
        <span className="hb-lever" aria-hidden="true">
          <i />
        </span>
        <span className="hb-pos is-on" aria-hidden="true">feito</span>
        <span className="hb-pos is-off" aria-hidden="true">—</span>
      </button>
      <div className="hb-label">
        <span className="hb-name">{habit.name}</span>
        <span className="hb-sub">{sub}</span>
      </div>
      <div className="hb-foot">
        <button
          className={`hb-min ${status === 'minimum' ? 'is-on' : ''}`}
          onClick={() => void setCheckin(habit.id, today, status === 'minimum' ? null : 'minimum')}
          title={habit.minimum ? `Versão mínima: ${habit.minimum}` : 'Fiz a versão mínima'}
        >
          {habit.minimum ? `mínimo: ${habit.minimum}` : 'só o mínimo'}
        </button>
        {streak > 0 && (
          <span className="hb-st" title="Sequência atual">
            {streak}
            <small>d</small>
          </span>
        )}
      </div>
    </article>
  )
}

function TrailRow({ habit, checkins, today, index, onEdit }: { habit: Habit; checkins: Checkin[]; today: string; index: number; onEdit: () => void }) {
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const paused = isPausedNow(habit)
  const map = useMemo(() => statusMap(checkins, habit.id), [checkins, habit.id])
  const s30 = habitStats(habit, checkins, addDays(today, -29), today)
  const streak = streakOf(habit, map, today)

  useEffect(() => {
    if (!menu) return
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setMenu(false)
        setConfirm(false)
      }
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [menu])

  return (
    <div className={`hb-row ${paused ? 'is-paused' : ''}`} style={{ ['--i' as string]: index } as CSSProperties}>
      <div className="hb-row-name">
        <span>{habit.name}</span>
        <small>
          {describeDays(daysOn(habit, today) || 127)}
          {paused && ' · pausado'}
        </small>
      </div>
      <div className="hb-dots">
        {Array.from({ length: TRAIL }, (_, i) => {
          const d = addDays(today, i - TRAIL + 1)
          const st = map.get(d) ?? null
          const sch = isScheduled(habit, d)
          const cls = st ? `is-${st}` : sch ? (d === today ? 'is-open' : 'is-miss') : 'is-rest'
          const label = `${fmtShort.format(parseCivil(d)).replace('.', '')}: ${st === 'done' ? 'feito' : st === 'minimum' ? 'mínimo' : sch ? 'não marcado' : 'folga'}`
          return (
            <button
              key={d}
              className={`${cls} ${d === today ? 'is-today' : ''}`}
              title={label}
              aria-label={`${habit.name}, ${label}`}
              disabled={d < habit.startDate}
              onClick={() => void setCheckin(habit.id, d, cycle(st))}
            />
          )
        })}
      </div>
      <span className="hb-num">{streak ? `${streak} d` : '—'}</span>
      <span className="hb-num">
        {s30.rate === null ? '—' : `${Math.round(s30.rate * 100)}%`}
        <i className="hb-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${s30.rate ?? 0})` }} />
        </i>
      </span>
      <div className="hb-more" ref={box}>
        <button className="hb-more-btn" onClick={() => setMenu((v) => !v)} aria-label={`Opções de ${habit.name}`} aria-expanded={menu}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="12.5" cy="8" r="1.3" />
          </svg>
        </button>
        {menu && (
          <div className="hb-menu" role="menu">
            <button role="menuitem" onClick={() => (setMenu(false), onEdit())}>Editar</button>
            <button role="menuitem" onClick={() => (setMenu(false), void setHabitPaused(habit.id, !paused))}>{paused ? 'Retomar' : 'Pausar'}</button>
            <button role="menuitem" className={confirm ? 'is-danger' : ''} onClick={() => (confirm ? (setMenu(false), void archiveHabit(habit.id)) : setConfirm(true))}>
              {confirm ? 'Confirmar: arquivar' : 'Arquivar'}
            </button>
          </div>
        )}
      </div>
    </div>
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
