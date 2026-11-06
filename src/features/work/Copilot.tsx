import { useEffect, useState, type ReactNode } from 'react'
import { addDays, parseCivil } from '../../shared/dates'
import { CompanyMark, coStyle } from './brand'
import { Gauge } from './Gauge'
import { Icon } from './icons'
import {
  dayGrid, dueLabel, fixedTodos, fmtDur, healthLabel, itemTimeMs, label, runningSession, streak, suggestFocus, todayTodos, todoDoneOn,
  upcomingTodos, type ForgetEntry, type Health, type Nudge, type Scope, type WeekScore,
} from './logic'
import { NudgeLine } from './Nudges'
import { Odometer } from './Odometer'
import {
  convertTodo, deleteTodo, openDialog, openItemFrom, readUi, resume, setFocus, setScope, toggleTimer, toggleTodo, useWork, writeUi,
} from './store'
import { FOCUS_MAX, MODE_LABEL, STAGE_LABEL, type Company, type Todo, type WorkItem, type WorkState } from './types'

const fmtDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })

export function Ring({ progress, level, size = 132, stroke = 9, children }: { progress: number; level: Health['level']; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, progress))
  return (
    <div className={`wk-ring is-${level}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="wk-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="wk-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="wk-ring-in">{children}</div>
    </div>
  )
}

export function DayMap({ state, today, health, weeks = 14 }: { state: WorkState; today: string; health: Health; weeks?: number }) {
  const green = health.level === 'green'
  const days = streak(state.days, today, green)
  const grid = dayGrid(state.days, today, green, weeks)
  return (
    <div className="wk-daymap">
      <span className="wk-daymap-n">
        <b>{days}</b> {days === 1 ? 'dia seguido em dia' : 'dias seguidos em dia'}
      </span>
      <div className="wk-grid" role="img" aria-label={`${days} dias seguidos em dia`}>
        {grid.map((w, wi) => (
          <div key={wi} className="wk-grid-col">
            {w.map((c) => (
              <span key={c.date} className={`wk-cell is-${c.state} ${c.date === today ? 'is-today' : ''}`} title={fmtDay.format(parseCivil(c.date)).replace(/\./g, '')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

type NextRow =
  | { kind: 'forget'; key: string; entry: ForgetEntry }
  | { kind: 'focus'; key: string; item: WorkItem }
  | { kind: 'todo'; key: string; todo: Todo; late: boolean }

export function Cockpit({ state, health, perCompany, today, scope, score, nudges, forget, onOpenHoje }: {
  state: WorkState
  health: Health
  perCompany: { company: Company; health: Health }[]
  today: string
  scope: Scope
  score: WeekScore
  nudges: Nudge[]
  forget: ForgetEntry[]
  onOpenHoje: () => void
}) {
  const green = health.level === 'green'
  const days = streak(state.days, today, green)
  const red = health.total ? health.blockers.filter((b) => b.severity === 3).length / health.total : 0
  const companies = new Map(state.companies.map((c) => [c.id, c]))
  const run = runningSession(state.sessions)
  const focus = state.items
    .filter((i) => i.focusedAt && i.stage !== 'done' && (scope === 'all' || i.companyId === scope))
    .sort((a, b) => Number(b.returnOpen) - Number(a.returnOpen) || a.focusedAt!.localeCompare(b.focusedAt!))
  const tt = todayTodos(state.todos, state.todoChecks, today, scope).filter((t) => !t.done && !t.todo.mustNotForget)
  const rows: NextRow[] = [
    ...forget.filter((f) => f.state === 'due').map((entry) => ({ kind: 'forget' as const, key: `f${entry.todo.id}`, entry })),
    ...focus.map((item) => ({ kind: 'focus' as const, key: `i${item.id}`, item })),
    ...tt.map((t) => ({ kind: 'todo' as const, key: `t${t.todo.id}`, todo: t.todo, late: t.late })),
  ]
  const shown = rows.slice(0, 3)
  const more = rows.length - shown.length
  const [leaving, setLeaving] = useState<string[]>([])
  const tick = (id: string) => {
    if (leaving.includes(id)) return
    setLeaving((l) => [...l, id])
    setTimeout(() => void toggleTodo(id).finally(() => setLeaving((l) => l.filter((x) => x !== id))), 380)
  }

  return (
    <section className={`wk-cockpit reveal is-${health.level}`} style={{ ['--i' as string]: 1 }} aria-label="Painel do dia">
      <div className={`wk-ck-gauge ${scope === 'all' ? 'has-rings' : ''}`} tabIndex={scope === 'all' ? 0 : undefined}>
        <Gauge progress={health.progress} red={red} level={health.level}>
          {health.total ? (
            <span className="wk-gauge-num">
              {health.handled}
              <small>/{health.total}</small>
            </span>
          ) : (
            <span className="wk-gauge-num is-ok">OK</span>
          )}
        </Gauge>
        {scope === 'all' && (
          <div className="wk-ck-rings" role="group" aria-label="Por espaço">
            {perCompany.map(({ company, health: h }) => (
              <button key={company.id} className="wk-ck-ring" style={coStyle(company)} onClick={() => setScope(company.id)} title={`${company.name}: ${healthLabel(h)}`}>
                <Ring progress={h.progress} level={h.level} size={30} stroke={3}>
                  <CompanyMark company={company} size={14} />
                </Ring>
                <span>{company.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wk-ck-status">
        <span className="wk-ck-meta">
          <span className={`wk-dot is-${health.level}`} aria-hidden="true" />
          {green ? 'Tudo em dia' : health.level === 'red' ? 'Precisa de você' : 'Quase lá'}
          {days > 0 && <span> · {days} {days === 1 ? 'dia' : 'dias'} em dia</span>}
        </span>
        <h2 className="wk-ck-head">{healthLabel(health)}</h2>
        <NudgeLine list={nudges} />
      </div>

      <div className="wk-ck-score" aria-label="Placar da semana">
        <span className="wk-ck-meta">Esta semana</span>
        <div className="wk-ck-odos">
          <span className="wk-score-cell is-main">
            <Odometer value={score.delivered} digits={2} label="Entregas na semana" />
            <em>entregas</em>
          </span>
          <span className="wk-score-cell">
            <Odometer value={score.validated} digits={2} label="Validações na semana" />
            <em>validadas</em>
          </span>
          <span className="wk-score-cell">
            <Odometer value={score.done} digits={2} label="Concluídos na semana" />
            <em>concluídas</em>
          </span>
        </div>
      </div>

      <div className="wk-ck-next">
        <span className="wk-ck-meta">
          Próximo
          <button className="wk-ck-all" onClick={onOpenHoje}>
            Hoje{more > 0 ? ` · +${more}` : ''}
            <Icon name="arrow" size={11} />
          </button>
        </span>
        {shown.length === 0 ? (
          <p className="wk-ck-empty">Nada fixado. Use F num cartão ou abra Hoje.</p>
        ) : (
          <ul className="wk-ck-list">
            {shown.map((r) => {
              if (r.kind === 'forget') {
                const co = companies.get(r.entry.todo.companyId)
                const out = leaving.includes(r.entry.todo.id)
                return (
                  <li key={r.key} className={`wk-ck-row is-forget ${out ? 'is-leaving' : ''}`} style={coStyle(co)}>
                    <button className={`wk-tick ${out ? 'is-on' : ''}`} onClick={() => tick(r.entry.todo.id)} aria-label={`Resolver: ${r.entry.todo.title}`}>
                      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                        <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
                      </svg>
                    </button>
                    <button className="wk-ck-text" onClick={() => openDialog({ kind: 'todo', todoId: r.entry.todo.id })}>
                      <b>{r.entry.todo.title}</b>
                      <span>não pode esquecer · {r.entry.when}</span>
                    </button>
                  </li>
                )
              }
              if (r.kind === 'focus') {
                const co = companies.get(r.item.companyId)
                const live = run?.itemId === r.item.id
                return (
                  <li key={r.key} className={`wk-ck-row ${live ? 'is-live' : ''}`} style={coStyle(co)}>
                    <button className={`wk-play ${live ? 'is-on' : ''}`} onClick={() => void toggleTimer(r.item.id)} aria-label={live ? 'Pausar cronômetro' : 'Começar cronômetro'}>
                      <Icon name={live ? 'pause' : 'play'} size={9} />
                    </button>
                    <button className="wk-ck-text" onClick={(e) => openItemFrom(r.item.id, document.querySelector<HTMLElement>(`[data-card="${r.item.id}"]`) ?? e.currentTarget)}>
                      <b>
                        <CompanyMark company={co} size={12} /> {label(r.item)}
                      </b>
                      <span>
                        foco · {STAGE_LABEL[r.item.stage]}
                        {r.item.returnOpen ? ' · voltou' : ''}
                        {r.item.dueDate ? ` · ${dueLabel(r.item.dueDate, today)}` : ''}
                      </span>
                    </button>
                  </li>
                )
              }
              const co = companies.get(r.todo.companyId)
              return (
                <li key={r.key} className={`wk-ck-row ${r.late ? 'is-late' : ''}`} style={coStyle(co)}>
                  <button className="wk-tick" onClick={() => void toggleTodo(r.todo.id)} aria-label={`Concluir: ${r.todo.title}`}>
                    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                      <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
                    </svg>
                  </button>
                  <button className="wk-ck-text" onClick={() => openDialog({ kind: 'todo', todoId: r.todo.id })}>
                    <b>{r.todo.title}</b>
                    <span>to-do · {r.late && r.todo.dueDate ? `atrasado, ${dueLabel(r.todo.dueDate, today)}` : r.todo.mode === 'daily' ? 'diário' : 'hoje'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

type HojeTab = 'focus' | 'todos'
type TodoTab = 'today' | 'fixed' | 'upcoming' | 'done'

export function HojePanel({ state, today, scope, open, onClose }: { state: WorkState; today: string; scope: Scope; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<HojeTab>(() => (readUi().hojeTab as HojeTab) ?? 'todos')
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.wk-scrim, .wk-drawer')) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose])
  const pick = (t: HojeTab) => {
    setTab(t)
    writeUi({ hojeTab: t })
  }
  const focusN = state.items.filter((i) => i.focusedAt && i.stage !== 'done').length
  const todoN = todayTodos(state.todos, state.todoChecks, today, scope).filter((t) => !t.done).length
  return (
    <>
      <div className={`wk-hoje-scrim ${open ? 'is-open' : ''}`} onPointerDown={onClose} aria-hidden="true" />
      <aside className={`wk-hoje ${open ? 'is-open' : ''}`} aria-label="Hoje" aria-hidden={!open} inert={!open}>
        <header className="wk-hoje-head">
          <div className="wk-seg-mini" role="tablist" aria-label="Hoje">
            <button role="tab" aria-selected={tab === 'todos'} className={tab === 'todos' ? 'is-on' : ''} onClick={() => pick('todos')}>
              To-dos {todoN > 0 && <span>{todoN}</span>}
            </button>
            <button role="tab" aria-selected={tab === 'focus'} className={tab === 'focus' ? 'is-on' : ''} onClick={() => pick('focus')}>
              Foco <span>{focusN}/{FOCUS_MAX}</span>
            </button>
          </div>
          <span className="wk-grow" />
          {tab === 'todos' && (
            <button className="wk-icon-btn" onClick={() => openDialog({ kind: 'todo', draft: { companyId: scope === 'all' ? undefined : scope } })} aria-label="Novo to-do" title="Novo to-do">
              <Icon name="plus" size={14} />
            </button>
          )}
          <button className="wk-icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="wk-hoje-body">{tab === 'focus' ? <FocusList state={state} today={today} scope={scope} /> : <TodoLists state={state} today={today} scope={scope} />}</div>
      </aside>
    </>
  )
}

function FocusList({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
  const { celebrate: cel } = useWork()
  const focus = state.items
    .filter((i) => i.focusedAt && i.stage !== 'done' && (scope === 'all' || i.companyId === scope))
    .sort((a, b) => a.focusedAt!.localeCompare(b.focusedAt!))
  const total = state.items.filter((i) => i.focusedAt && i.stage !== 'done').length
  const sugg = total < FOCUS_MAX ? suggestFocus(state.items, today, scope, FOCUS_MAX - total) : []
  const companies = new Map(state.companies.map((c) => [c.id, c]))
  const run = runningSession(state.sessions)
  const now = Date.now()
  return (
    <ul className="wk-focus-list">
      {focus.length === 0 && !sugg.length && <p className="wk-empty-line">Fixe até 3 itens com F no cartão selecionado.</p>}
      {focus.map((i) => {
        const co = companies.get(i.companyId)
        const live = run?.itemId === i.id
        const t = itemTimeMs(state.sessions, i.id, now)
        return (
          <li key={i.id} className={`wk-frow ${cel?.itemId === i.id ? 'is-celebrating' : ''} ${live ? 'is-live' : ''}`} style={coStyle(co)}>
            <button className={`wk-play ${live ? 'is-on' : ''}`} onClick={() => void toggleTimer(i.id)} aria-label={live ? 'Pausar cronômetro' : 'Começar cronômetro'}>
              <Icon name={live ? 'pause' : 'play'} size={10} />
            </button>
            <button className="wk-frow-body" onClick={(e) => openItemFrom(i.id, document.querySelector<HTMLElement>(`[data-card="${i.id}"]`) ?? e.currentTarget)}>
              <span className="wk-frow-title">
                <CompanyMark company={co} size={12} />
                {label(i)}
              </span>
              <span className="wk-frow-meta">
                {STAGE_LABEL[i.stage]}
                {i.returnOpen && <em className="is-warn"> · voltou</em>}
                {i.dueDate && <em className={i.dueDate < today ? 'is-warn' : ''}> · {dueLabel(i.dueDate, today)}</em>}
                {t > 0 && <em> · {fmtDur(t)}</em>}
              </span>
            </button>
            {i.returnOpen ? (
              <button className="wk-mini-btn" onClick={() => void resume(i.id)}>
                Retomei
              </button>
            ) : (
              <button className="wk-icon-btn" onClick={() => void setFocus(i.id, false)} aria-label="Tirar do foco" title="Tirar do foco">
                <Icon name="x" size={11} />
              </button>
            )}
          </li>
        )
      })}
      {sugg.map((i) => (
        <li key={i.id} className="wk-frow is-sugg" style={coStyle(companies.get(i.companyId))}>
          <button className="wk-play" onClick={() => void setFocus(i.id, true)} aria-label={`Pôr no foco: ${i.title}`} title="Pôr no foco">
            <Icon name="plus" size={10} />
          </button>
          <button className="wk-frow-body" onClick={(e) => openItemFrom(i.id, document.querySelector<HTMLElement>(`[data-card="${i.id}"]`) ?? e.currentTarget)}>
            <span className="wk-frow-title">
              <CompanyMark company={companies.get(i.companyId)} size={12} />
              {label(i)}
            </span>
            <span className="wk-frow-meta">sugestão · {i.returnOpen ? 'voltou' : i.priority === 'urgente' ? 'urgente' : i.dueDate ? dueLabel(i.dueDate, today) : STAGE_LABEL[i.stage]}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function TodoLists({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
  const [tab, setTab] = useState<TodoTab>(() => readUi().todoTab ?? 'today')
  const pick = (t: TodoTab) => {
    setTab(t)
    writeUi({ todoTab: t })
  }
  const companies = new Map(state.companies.map((c) => [c.id, c]))
  const tt = todayTodos(state.todos, state.todoChecks, today, scope)
  const fixed = fixedTodos(state.todos, scope)
  const upcoming = upcomingTodos(state.todos, today, scope)
  const done = state.todos
    .filter((t) => t.mode !== 'daily' && t.doneAt && (scope === 'all' || t.companyId === scope))
    .sort((a, b) => b.doneAt!.localeCompare(a.doneAt!))
    .slice(0, 30)
  const rows: { todo: Todo; done: boolean; late: boolean }[] =
    tab === 'today'
      ? tt
      : tab === 'fixed'
        ? fixed.map((t) => ({ todo: t, done: false, late: false }))
        : tab === 'upcoming'
          ? upcoming.map((t) => ({ todo: t, done: false, late: false }))
          : done.map((t) => ({ todo: t, done: true, late: false }))
  const doneN = tt.filter((t) => t.done).length
  const tabs: { id: TodoTab; label: string }[] = [
    { id: 'today', label: tt.length ? `Hoje ${doneN}/${tt.length}` : 'Hoje' },
    { id: 'fixed', label: 'Fixos' },
    { id: 'upcoming', label: 'Depois' },
    { id: 'done', label: 'Feitos' },
  ]
  return (
    <>
      <div className="wk-tabs" role="tablist" aria-label="To-dos">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="wk-empty-line">
          {tab === 'today' ? 'Nada para hoje. Escreva na captura com “todo dia”, “fixo” ou uma data.' : tab === 'fixed' ? 'Pendências permanentes ficam aqui.' : tab === 'upcoming' ? 'To-dos com data futura.' : 'Concluídos ficam aqui por 30 dias.'}
        </p>
      ) : (
        <ul className="wk-todo-list">
          {rows.map((r) => (
            <TodoRow key={r.todo.id} todo={r.todo} done={r.done} late={r.late} company={companies.get(r.todo.companyId)} today={today} state={state} showSpace={scope === 'all'} />
          ))}
        </ul>
      )}
    </>
  )
}

function TodoRow({ todo, done, late, company, today, state, showSpace }: { todo: Todo; done: boolean; late: boolean; company?: Company; today: string; state: WorkState; showSpace: boolean }) {
  const { celebrate: cel } = useWork()
  const pop = cel?.todoId === todo.id
  const history = todo.mode === 'daily' ? Array.from({ length: 7 }, (_, k) => addDays(today, k - 6)).map((d) => ({ d, on: todoDoneOn(todo, state.todoChecks, d) })) : null
  return (
    <li className={`wk-todo ${done ? 'is-done' : ''} ${late ? 'is-late' : ''} ${pop ? 'is-pop' : ''} ${todo.mustNotForget ? 'is-forget' : ''}`} style={coStyle(company)}>
      <button className={`wk-tick ${done ? 'is-on' : ''}`} onClick={() => void toggleTodo(todo.id)} aria-label={done ? `Desmarcar: ${todo.title}` : `Concluir: ${todo.title}`} aria-pressed={done}>
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
        </svg>
      </button>
      <button className="wk-todo-body" onClick={() => openDialog({ kind: 'todo', todoId: todo.id })}>
        <span className="wk-todo-title">
          {showSpace && company && <CompanyMark company={company} size={11} />}
          {todo.priority !== 'normal' && <span className={`wk-prio is-${todo.priority}`} aria-label={todo.priority} />}
          <span className="wk-todo-text">{todo.title}</span>
        </span>
        <span className="wk-todo-meta">
          {todo.mode === 'dated' && todo.dueDate && <span className={late ? 'is-late' : ''}>{dueLabel(todo.dueDate, today)}</span>}
          {todo.mode !== 'dated' && <span>{todo.mode === 'daily' && todo.weekdaysOnly ? 'dias úteis' : MODE_LABEL[todo.mode].toLowerCase()}</span>}
          {todo.remindTime && <span>às {todo.remindTime}</span>}
          {todo.mustNotForget && <span className="is-forget">não pode esquecer</span>}
          {todo.itemId && <span>virou item</span>}
        </span>
      </button>
      {history && (
        <span className="wk-hist" aria-label={`${history.filter((h) => h.on).length} de 7 dias`}>
          {history.map((h) => (
            <span key={h.d} className={h.on ? 'is-on' : ''} />
          ))}
        </span>
      )}
      <span className="wk-todo-acts">
        {todo.mode !== 'daily' && !todo.itemId && !done && (
          <button className="wk-icon-btn" onClick={() => void convertTodo(todo.id)} title="Virar item de trabalho" aria-label="Virar item de trabalho">
            <Icon name="board" size={12} />
          </button>
        )}
        <button className="wk-icon-btn" onClick={() => void deleteTodo(todo.id)} title="Remover" aria-label={`Remover: ${todo.title}`}>
          <Icon name="trash" size={12} />
        </button>
      </span>
    </li>
  )
}
