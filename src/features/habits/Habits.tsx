import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { onIntent } from '../../app/router'
import { addDays, civil, fmtLong, parseCivil, weekday as weekdayOf } from '../../shared/dates'
import type { Checkin, CheckinStatus, Habit } from '../../shared/db/api'
import {
  WEEKDAY_LETTERS, createHabit, daysOn, describeDays, isScheduled,
  setCheckin, updateHabit, useHabits,
} from '../../shared/db/stores'
import { Odometer } from '../work/Odometer'
import '../work/work.css'
import { Celebrate, HabitSheet } from './HabitSheet'
import { CATEGORIES, MILESTONES, guessKind, metaOf, numbersOf, setMeta, useHabitMeta, type HabitKind } from './meta'
import './habits.css'

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

export default function Habits() {
  const { habits, checkins } = useHabits()
  const today = civil()
  const [editing, setEditing] = useState<Habit | 'new' | null>(null)
  const [sheet, setSheet] = useState<string | null>(null)
  const [day, setDay] = useState(today)
  const [cel, setCel] = useState<{ days: number; name: string; quit: boolean } | null>(null)
  useHabitMeta()
  useEffect(() => onIntent((i) => i === 'new-habit' && setEditing('new')), [])

  const todays = habits.filter((h) => isScheduled(h, today))
  const statusOf = (id: string) => checkins.find((c) => c.habitId === id && c.date === today)?.status ?? null
  const dues = habits.filter((h) => isScheduled(h, day) && day >= h.startDate)
  const dayStatus = (id: string) => checkins.find((c) => c.habitId === id && c.date === day)?.status ?? null
  const done = todays.filter((h) => statusOf(h.id)).length
  const all = todays.length > 0 && done === todays.length
  const streak = useMemo(() => allDoneStreak(habits, checkins, today), [habits, checkins, today])
  const prevStreak = useRef<Map<string, number> | null>(null)

  useEffect(() => {
    if (!habits.length) return
    const now = new Map(habits.map((h) => [h.id, numbersOf(h, checkins, today).streak]))
    const before = prevStreak.current
    prevStreak.current = now
    if (!before) return
    for (const h of habits) {
      const s = now.get(h.id) ?? 0
      if (s > (before.get(h.id) ?? 0) && MILESTONES.includes(s)) {
        const m = metaOf(h)
        if (m.seen.includes(s)) continue
        setMeta(h.id, { seen: [...m.seen, s] }, m)
        setCel({ days: s, name: h.name, quit: m.kind === 'largar' })
        break
      }
    }
  }, [checkins, habits, today])

  const live = useRef({ dues, dayStatus, day })
  live.current = { dues, dayStatus, day }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const n = Number(e.key)
      const h = live.current.dues[n - 1]
      if (!h) return
      e.preventDefault()
      const st = live.current.dayStatus(h.id)
      void setCheckin(h.id, live.current.day, e.shiftKey ? (st === 'minimum' ? null : 'minimum') : next(st))
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
      {sheet && habits.find((h) => h.id === sheet) && (
        <HabitSheet
          habit={habits.find((h) => h.id === sheet)!}
          checkins={checkins}
          today={today}
          onClose={() => setSheet(null)}
          onEdit={() => {
            const h = habits.find((x) => x.id === sheet)!
            setSheet(null)
            setEditing(h)
          }}
        />
      )}
      {cel && <Celebrate days={cel.days} name={cel.name} quit={cel.quit} onDone={() => setCel(null)} />}

      <section className="hb-panel reveal" style={{ ['--i' as string]: 1 }} aria-label="Hoje">
        <Calendar habits={habits} checkins={checkins} today={today} day={day} onPick={setDay} />
        <div className="hb-grid">
          {dues.map((h, i) => (
            <Switch key={h.id} habit={h} n={i + 1} status={dayStatus(h.id)} day={day} today={today} checkins={checkins} onOpen={() => setSheet(h.id)} />
          ))}
          <button className="hb-mod is-add" onClick={() => setEditing('new')}>
            <span className="hb-add-plus" aria-hidden="true">+</span>
            <span className="hb-name">Novo hábito</span>
            <span className="hb-sub">pequeno e fácil de começar</span>
          </button>
        </div>
        {habits.length > 0 && dues.length === 0 && <p className="hb-none">{day === today ? 'Nenhum hábito marcado para hoje. Aproveita o descanso.' : 'Nada marcado para esse dia.'}</p>}
      </section>

    </section>
  )
}

// raios saindo do aro do interruptor (r 31 → 54, centro 60,60)
const ARCS = Array.from({ length: 8 }, (_, k) => {
  const a = (k * 137 + 20) * (Math.PI / 180)
  const pt = (r: number, j: number) => `${(60 + Math.cos(a + j) * r).toFixed(1)} ${(60 + Math.sin(a + j) * r).toFixed(1)}`
  return `M${pt(31, 0)} L${pt(39, 0.16)} L${pt(43, -0.1)} L${pt(54, 0.08)}`
})

function Switch({ habit, n, status, day, today, checkins, onOpen }: { habit: Habit; n: number; status: CheckinStatus | null; day: string; today: string; checkins: Checkin[]; onOpen: () => void }) {
  const m = metaOf(habit)
  const quit = m.kind === 'largar'
  const map = useMemo(() => statusMap(checkins, habit.id), [checkins, habit.id])
  const streak = streakOf(habit, map, today)
  const sub = habit.cue ? `depois de ${habit.cue.replace(/^depois de\s*/i, '')}` : habit.timeOfDay ? `às ${habit.timeOfDay}` : describeDays(daysOn(habit, today))
  const heat = streak >= 21 ? 3 : streak >= 7 ? 2 : streak >= 3 ? 1 : 0
  const [surge, setSurge] = useState(0)
  const prev = useRef(status)
  useEffect(() => {
    if (status && !prev.current) setSurge((x) => x + 1)
    prev.current = status
  }, [status])
  const [surging, setSurging] = useState(false)
  useEffect(() => {
    if (!surge) return
    setSurging(true)
    const t = window.setTimeout(() => setSurging(false), 700)
    return () => window.clearTimeout(t)
  }, [surge])
  return (
    <article className={`hb-mod is-${status ?? 'off'} ${heat ? `is-heat heat-${heat}` : ''}`} style={{ ['--i' as string]: n, ['--heat' as string]: heat } as CSSProperties}>
      <span className="hb-n">
        {String(n).padStart(2, '0')}
        {m.category && <em> · {m.category}</em>}
      </span>
      <span className="hb-led" aria-hidden="true" />
      <button
        className="hb-toggle"
        onClick={() => void setCheckin(habit.id, day, next(status))}
        aria-pressed={status === 'done'}
        aria-label={status === 'done' ? `Desmarcar ${habit.name}` : quit ? `Marcar ${habit.name}: hoje limpo` : `Marcar ${habit.name} como feito`}
      >
        <span className="hb-bezel" aria-hidden="true" />
        {surging && (
          <span key={surge} className="hb-surge" aria-hidden="true">
            {Array.from({ length: 10 }, (_, k) => <i key={k} style={{ ['--a' as string]: `${k * 36 + (surge * 17) % 36}deg` } as CSSProperties} />)}
          </span>
        )}
        {heat > 0 && (
          <svg className="hb-zap" viewBox="0 0 120 120" aria-hidden="true">
            {Array.from({ length: 2 + heat * 2 }, (_, k) => (
              <path key={k} style={{ ['--k' as string]: k } as CSSProperties} d={ARCS[k % ARCS.length]} />
            ))}
          </svg>
        )}
        <span className="hb-lever" aria-hidden="true">
          <i />
        </span>
        <span className="hb-pos is-on" aria-hidden="true">{quit ? 'limpo' : 'feito'}</span>
        <span className="hb-pos is-off" aria-hidden="true">—</span>
      </button>
      <button className="hb-label" onClick={onOpen} title="Abrir a ficha do hábito">
        <span className="hb-name">{habit.name}</span>
        <span className="hb-sub">{quit ? (streak ? `${streak} ${streak === 1 ? 'dia' : 'dias'} limpo` : 'hoje é o dia 1') : sub}</span>
      </button>
      <div className="hb-foot">
        <button
          className={`hb-min ${status === 'minimum' ? 'is-on' : ''}`}
          onClick={() => void setCheckin(habit.id, day, status === 'minimum' ? null : 'minimum')}
          title={habit.minimum ? `Versão mínima: ${habit.minimum}` : 'Fiz a versão mínima'}
        >
          {habit.minimum ? `mínimo: ${habit.minimum}` : 'só o mínimo'}
        </button>
        {streak > 0 && (
          <span className={`hb-st ${heat ? 'is-hot' : ''}`} title="Sequência atual">
            {heat > 0 && <span className="hb-bolt" aria-hidden="true">⚡</span>}
            {streak}
            <small>d</small>
          </span>
        )}
      </div>
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
  const base = habit ? metaOf(habit) : null
  const [kind, setKind] = useState<HabitKind | null>(base?.kind ?? null)
  const [cat, setCat] = useState<string | null>(base?.category ?? null)
  const kindNow: HabitKind = kind ?? guessKind(name)

  const save = async () => {
    if (!name.trim() || !days) return
    if (habit) {
      await updateHabit(habit.id, { name, days, timeOfDay: time, cue, minimum, why, obstaclePlan: plan, today })
      setMeta(habit.id, { kind: kindNow, category: cat }, metaOf(habit))
    } else {
      const h = await createHabit({ name, days, timeOfDay: time || null, cue, minimum, why, obstaclePlan: plan, startDate: start })
      if (h) setMeta(h.id, { kind: kindNow, category: cat }, metaOf(h))
    }
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

      <div className="h-form-class">
        <div className="hs-seg" role="radiogroup" aria-label="Tipo">
          {(['construir', 'largar'] as const).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kindNow === k} className={kindNow === k ? 'is-on' : ''} onClick={() => setKind(k)}>
              {k === 'construir' ? 'Construir um hábito' : 'Largar um hábito'}
            </button>
          ))}
        </div>
        <div className="hs-cats">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} className={cat === c ? 'is-on' : ''} onClick={() => setCat(cat === c ? null : c)}>
              {c}
            </button>
          ))}
        </div>
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

const STRIP = 14
const monthName = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' })

const dayTitle = (d: string, today: string) => {
  const diff = Math.round((parseCivil(today).getTime() - parseCivil(d).getTime()) / 864e5)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  if (diff === 2) return 'Anteontem'
  return monthName.format(parseCivil(d))
}

function useMarks(checkins: Checkin[]) {
  return useMemo(() => new Map(checkins.map((c) => [`${c.habitId}|${c.date}`, c.status])), [checkins])
}

function DayMarks({ habits, marks, d }: { habits: Habit[]; marks: Map<string, CheckinStatus>; d: string }) {
  const due = habits.filter((h) => isScheduled(h, d) && d >= h.startDate)
  if (!due.length) return <span className="hb-marks is-rest" aria-hidden="true" />
  return (
    <span className="hb-marks" aria-hidden="true">
      {due.map((h) => (
        <i key={h.id} className={`is-${marks.get(`${h.id}|${d}`) ?? 'off'}`} />
      ))}
    </span>
  )
}

const countOf = (habits: Habit[], marks: Map<string, CheckinStatus>, d: string) => {
  const due = habits.filter((h) => isScheduled(h, d) && d >= h.startDate)
  return { due: due.length, ok: due.filter((h) => marks.has(`${h.id}|${d}`)).length }
}

function Calendar({ habits, checkins, today, day, onPick }: { habits: Habit[]; checkins: Checkin[]; today: string; day: string; onPick: (d: string) => void }) {
  const [end, setEnd] = useState(today)
  const [month, setMonth] = useState(false)
  const marks = useMarks(checkins)
  const days = Array.from({ length: STRIP }, (_, i) => addDays(end, i - STRIP + 1))
  useEffect(() => {
    if (day < days[0] || day > days[days.length - 1]) setEnd(addDays(day, 7) > today ? today : addDays(day, 7))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])
  const c = countOf(habits, marks, day)
  return (
    <div className="hb-cal">
      <div className="hb-cal-h">
        <span className="hb-cal-t">{dayTitle(day, today)}</span>
        {c.due > 0 && <span className="hb-cal-c">{c.ok} de {c.due}</span>}
        {day !== today && <span className="hb-cal-edit">marcando um dia que passou</span>}
        <span className="hb-grow" />
        {day !== today && (
          <button className="hb-cal-btn" onClick={() => (onPick(today), setEnd(today))}>hoje</button>
        )}
        <button className="hb-cal-btn is-month" onClick={() => setMonth(true)}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          ver mês
        </button>
      </div>
      <div className="hb-cal-strip">
        <button className="hb-cal-nav" onClick={() => setEnd(addDays(end, -7))} aria-label="Semana anterior">‹</button>
        {days.map((d) => {
          const k = countOf(habits, marks, d)
          return (
            <button
              key={d}
              className={`hb-cal-d ${d === day ? 'is-sel' : ''} ${d === today ? 'is-today' : ''} ${d > today ? 'is-future' : ''} ${k.due && k.ok === k.due ? 'is-full' : ''}`}
              disabled={d > today}
              onClick={() => onPick(d)}
              title={`${dayTitle(d, today)} · ${k.due ? `${k.ok} de ${k.due}` : 'folga'}`}
            >
              <small>{dayName.format(parseCivil(d)).slice(0, 1).toUpperCase()}</small>
              <span className="hb-cal-n">{parseCivil(d).getDate()}</span>
              <DayMarks habits={habits} marks={marks} d={d} />
            </button>
          )
        })}
        <button className="hb-cal-nav" onClick={() => setEnd(addDays(end, 7) > today ? today : addDays(end, 7))} disabled={end >= today} aria-label="Próxima semana">›</button>
      </div>
      {month && <MonthView habits={habits} marks={marks} today={today} day={day} onPick={(d) => (onPick(d), setMonth(false))} onClose={() => setMonth(false)} />}
    </div>
  )
}

const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
const monthTitle = { format: (d: Date) => { const t = monthFmt.format(d); return t[0].toUpperCase() + t.slice(1) } }

function MonthView({ habits, marks, today, day, onPick, onClose }: { habits: Habit[]; marks: Map<string, CheckinStatus>; today: string; day: string; onPick: (d: string) => void; onClose: () => void }) {
  const [ym, setYm] = useState(() => day.slice(0, 7))
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const first = `${ym}-01`
  const lead = weekdayOf(first)
  const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)]
  const shift = (n: number) => {
    const dt = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)
    setYm(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }
  const inMonth = cells.filter((x): x is string => !!x && x <= today)
  let due = 0, ok = 0
  for (const d of inMonth) { const c = countOf(habits, marks, d); due += c.due; ok += c.ok }
  const focus = hover ?? day
  const fc = countOf(habits, marks, focus)
  return createPortal(
    <div className="hb hb-month-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hb-month" role="dialog" aria-label="Calendário do mês">
        <header className="hb-month-h">
          <button className="hb-cal-nav" onClick={() => shift(-1)} aria-label="Mês anterior">‹</button>
          <span className="hb-month-t">{monthTitle.format(parseCivil(first))}</span>
          <button className="hb-cal-nav" onClick={() => shift(1)} disabled={ym >= today.slice(0, 7)} aria-label="Próximo mês">›</button>
          <span className="hb-grow" />
          {due > 0 && <span className="hb-month-rate">{Math.round((ok / due) * 100)}% do mês</span>}
          <button className="hb-month-x" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="hb-month-wk">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((l, i) => <span key={i}>{l}</span>)}</div>
        <div className="hb-month-grid">
          {cells.map((d, i) => {
            if (!d) return <span key={`x${i}`} />
            const c = countOf(habits, marks, d)
            const fut = d > today
            const frac = c.due ? c.ok / c.due : 0
            return (
              <button
                key={d}
                disabled={fut}
                className={`hb-month-d ${d === day ? 'is-sel' : ''} ${d === today ? 'is-today' : ''} ${fut ? 'is-future' : ''} ${c.due && frac === 1 ? 'is-full' : ''}`}
                style={{ ['--f' as string]: frac } as CSSProperties}
                onPointerEnter={() => setHover(d)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onPick(d)}
              >
                <span className="hb-cal-n">{Number(d.slice(8))}</span>
                {!fut && <DayMarks habits={habits} marks={marks} d={d} />}
              </button>
            )
          })}
        </div>
        <footer className="hb-month-f">
          <b>{dayTitle(focus, today)}</b>
          <ul>
            {habits.filter((h) => isScheduled(h, focus) && focus >= h.startDate).map((h) => {
              const st = marks.get(`${h.id}|${focus}`)
              return (
                <li key={h.id} className={`is-${st ?? 'off'}`}>
                  <i /> {h.name} <em>{st === 'done' ? 'feito' : st === 'minimum' ? 'mínimo' : focus > today ? '' : '—'}</em>
                </li>
              )
            })}
            {fc.due === 0 && <li className="is-off">folga</li>}
          </ul>
          <span className="hb-month-hint">clique num dia para marcar nele</span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
