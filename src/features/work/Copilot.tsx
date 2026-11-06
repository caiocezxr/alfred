import { useState, type ReactNode } from 'react'
import { addDays, parseCivil } from '../../shared/dates'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import {
  dayGrid, dueLabel, fixedTodos, fmtDur, healthLabel, itemTimeMs, label, runningSession, streak, suggestFocus, todayTodos, todoDoneOn,
  upcomingTodos, type ForgetEntry, type Health, type Scope, type WeekScore,
} from './logic'
import { Gauge } from './Gauge'
import { Odometer } from './Odometer'
import { Roll } from './Roll'
import {
  convertTodo, deleteTodo, openDialog, openItemFrom, readUi, resume, setFocus, setScope, toggleTimer, toggleTodo, useWork, writeUi,
} from './store'
import { FOCUS_MAX, MODE_LABEL, STAGE_LABEL, type Company, type Todo, type WorkState } from './types'

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

function Tile({ className = '', title, aside, children, index }: { className?: string; title: ReactNode; aside?: ReactNode; children: ReactNode; index: number }) {
  return (
    <section className={`wk-tile reveal ${className}`} style={{ ['--i' as string]: index }}>
      <header className="wk-tile-head">
        <h2>{title}</h2>
        {aside}
      </header>
      <div className="wk-tile-body">{children}</div>
    </section>
  )
}

export function HealthTile({ state, health, perCompany, today, scope }: {
  state: WorkState
  health: Health
  perCompany: { company: Company; health: Health }[]
  today: string
  scope: Scope
}) {
  const green = health.level === 'green'
  const days = streak(state.days, today, green)
  const grid = dayGrid(state.days, today, green, 10)
  const red = health.total ? health.blockers.filter((b) => b.severity === 3).length / health.total : 0
  return (
    <section className={`wk-tile wk-cluster reveal is-${health.level}`} style={{ ['--i' as string]: 2 }} aria-label="Painel do dia">
      <Gauge progress={health.progress} red={red} level={health.level}>
        {health.total ? (
          <span className="wk-gauge-num">
            <Roll value={health.handled} />
            <small>/{health.total}</small>
          </span>
        ) : (
          <span className="wk-gauge-num is-ok">OK</span>
        )}
        <span className="wk-gauge-cap">hoje</span>
      </Gauge>
      <div className="wk-cluster-mid">
        <span className="wk-cluster-k">{green ? 'Tudo em dia' : health.level === 'red' ? 'Atenção' : 'Quase lá'}</span>
        <b className="wk-cluster-t">{healthLabel(health)}</b>
        <span className="wk-streak-n">
          <Roll value={days} />
          <small>{days === 1 ? 'dia em dia' : 'dias em dia'}</small>
        </span>
        <div className="wk-health-spaces">
          {perCompany.map(({ company, health: h }) => (
            <button
              key={company.id}
              className={`wk-mini-space ${scope === company.id ? 'is-on' : ''}`}
              style={coStyle(company)}
              onClick={() => setScope(scope === company.id ? 'all' : company.id)}
              title={`${company.name}: ${healthLabel(h)}`}
              aria-pressed={scope === company.id}
            >
              <Ring progress={h.progress} level={h.level} size={26} stroke={2.6}>
                <CompanyMark company={company} size={13} />
              </Ring>
            </button>
          ))}
        </div>
      </div>
      <div className="wk-health-streak" title={`${days} ${days === 1 ? 'dia' : 'dias'} seguidos em dia`}>
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
    </section>
  )
}

export function ForgetTile({ entries, companies }: { entries: ForgetEntry[]; companies: Company[] }) {
  const [leaving, setLeaving] = useState<string[]>([])
  const resolve = (id: string) => {
    if (leaving.includes(id)) return
    setLeaving((l) => [...l, id])
    setTimeout(() => void toggleTodo(id).finally(() => setLeaving((l) => l.filter((x) => x !== id))), 420)
  }
  if (!entries.length) return null
  const due = entries.filter((e) => e.state === 'due').length
  return (
    <Tile
      index={3}
      className={`wk-forget ${due ? 'is-due' : ''}`}
      title={
        <>
          <Icon name="alarm" size={13} /> Não pode esquecer
        </>
      }
      aside={due > 0 ? <span className="wk-forget-n">{due}</span> : undefined}
    >
      <ul className="wk-forget-list">
        {entries.map((e) => {
          const co = companies.find((c) => c.id === e.todo.companyId)
          const out = leaving.includes(e.todo.id)
          return (
            <li key={e.todo.id} className={`wk-forget-row is-${e.state} ${out ? 'is-leaving' : ''}`} style={coStyle(co)}>
              <button className={`wk-tick ${out ? 'is-on' : ''}`} onClick={() => resolve(e.todo.id)} aria-label={`Resolver: ${e.todo.title}`}>
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
                </svg>
              </button>
              <button className="wk-forget-text" onClick={() => openDialog({ kind: 'todo', todoId: e.todo.id })}>
                <b>{e.todo.title}</b>
                <span>{e.when}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Tile>
  )
}

export function FocusTile({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
  const { celebrate: cel } = useWork()
  const focus = state.items
    .filter((i) => i.focusedAt && i.stage !== 'done' && (scope === 'all' || i.companyId === scope))
    .sort((a, b) => a.focusedAt!.localeCompare(b.focusedAt!))
  const total = state.items.filter((i) => i.focusedAt && i.stage !== 'done').length
  const sugg = total < FOCUS_MAX ? suggestFocus(state.items, today, scope, Math.min(2, FOCUS_MAX - total)) : []
  const companies = new Map(state.companies.map((c) => [c.id, c]))
  const run = runningSession(state.sessions)
  const now = Date.now()
  return (
    <Tile
      index={4}
      className="wk-focus"
      title={
        <>
          <Icon name="pin" size={12} /> Foco agora
        </>
      }
      aside={<span className="wk-tile-n">{total}/{FOCUS_MAX}</span>}
    >
      {focus.length === 0 && !sugg.length && <p className="wk-empty-line">Fixe até 3 itens (tecla F). O resto espera.</p>}
      <ul className="wk-focus-list">
        {focus.map((i) => {
          const co = companies.get(i.companyId)
          const live = run?.itemId === i.id
          const t = itemTimeMs(state.sessions, i.id, now)
          return (
            <li key={i.id} className={`wk-frow ${cel?.itemId === i.id ? 'is-celebrating' : ''} ${live ? 'is-live' : ''}`} style={coStyle(co)}>
              <button className={`wk-play ${live ? 'is-on' : ''}`} onClick={() => void toggleTimer(i.id)} aria-label={live ? 'Pausar cronômetro' : 'Começar cronômetro'} title={live ? 'Pausar' : 'Começar'}>
                <Icon name={live ? 'pause' : 'play'} size={10} />
              </button>
              <button className="wk-frow-body" onClick={(e) => openItemFrom(i.id, e.currentTarget.closest('li'))}>
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
            <button className="wk-frow-body" onClick={(e) => openItemFrom(i.id, e.currentTarget.closest('li'))}>
              <span className="wk-frow-title">
                <CompanyMark company={companies.get(i.companyId)} size={12} />
                {label(i)}
              </span>
              <span className="wk-frow-meta">sugestão · {i.returnOpen ? 'voltou' : i.priority === 'urgente' ? 'urgente' : i.dueDate ? dueLabel(i.dueDate, today) : STAGE_LABEL[i.stage]}</span>
            </button>
          </li>
        ))}
      </ul>
    </Tile>
  )
}

type TodoTab = 'today' | 'fixed' | 'upcoming' | 'done'

export function TodosTile({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
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
  const left = tt.filter((t) => !t.done).length
  const doneN = tt.length - left
  const rows: { todo: Todo; done: boolean; late: boolean }[] =
    tab === 'today'
      ? tt
      : tab === 'fixed'
        ? fixed.map((t) => ({ todo: t, done: false, late: false }))
        : tab === 'upcoming'
          ? upcoming.map((t) => ({ todo: t, done: false, late: false }))
          : done.map((t) => ({ todo: t, done: true, late: false }))
  const tabs: { id: TodoTab; label: string; n?: number }[] = [
    { id: 'today', label: 'Hoje', n: left },
    { id: 'fixed', label: 'Fixos', n: fixed.length },
    { id: 'upcoming', label: 'Depois', n: upcoming.length },
    { id: 'done', label: 'Feitos' },
  ]
  return (
    <Tile
      index={5}
      className="wk-todos"
      title={
        <span className="wk-tabs" role="tablist" aria-label="To-dos">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => pick(t.id)}>
              {t.label}
              {!!t.n && <span className="wk-tab-n">{t.n}</span>}
            </button>
          ))}
        </span>
      }
      aside={
        <span className="wk-todo-aside">
          {tt.length > 0 && (
            <span className="wk-todo-progress" aria-label={`${doneN} de ${tt.length} hoje`}>
              <span className="wk-bar">
                <span style={{ transform: `scaleX(${doneN / tt.length})` }} />
              </span>
              <Roll value={doneN} />/{tt.length}
            </span>
          )}
          <button className="wk-icon-btn" onClick={() => openDialog({ kind: 'todo', draft: { companyId: scope === 'all' ? undefined : scope } })} aria-label="Novo to-do" title="Novo to-do">
            <Icon name="plus" size={13} />
          </button>
        </span>
      }
    >
      {rows.length === 0 ? (
        <p className="wk-empty-line">
          {tab === 'today' ? 'Nada para hoje. Escreva acima com “todo dia”, “fixo” ou uma data.' : tab === 'fixed' ? 'Pendências permanentes ficam aqui.' : tab === 'upcoming' ? 'To-dos com data futura.' : 'Concluídos ficam aqui por 30 dias.'}
        </p>
      ) : (
        <ul className="wk-todo-list">
          {rows.map((r) => (
            <TodoRow key={r.todo.id} todo={r.todo} done={r.done} late={r.late} company={companies.get(r.todo.companyId)} today={today} state={state} showSpace={scope === 'all'} />
          ))}
        </ul>
      )}
    </Tile>
  )
}

function TodoRow({ todo, done, late, company, today, state, showSpace }: { todo: Todo; done: boolean; late: boolean; company?: Company; today: string; state: WorkState; showSpace: boolean }) {
  const { celebrate: cel } = useWork()
  const pop = cel?.todoId === todo.id
  const history = todo.mode === 'daily' ? Array.from({ length: 7 }, (_, k) => addDays(today, k - 6)).map((d) => ({ d, on: todoDoneOn(todo, state.todoChecks, d) })) : null
  return (
    <li className={`wk-todo ${done ? 'is-done' : ''} ${late ? 'is-late' : ''} ${pop ? 'is-pop' : ''} ${todo.mustNotForget ? 'is-forget' : ''}`} style={coStyle(company)}>
      <button className={`wk-tick ${done ? 'is-on' : ''}`} onClick={() => void toggleTodo(todo.id)} aria-label={done ? `Desmarcar: ${todo.title}` : `Concluir: ${todo.title}`} aria-pressed={done}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
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
          {todo.remindTime && (
            <span>
              <Icon name="bell" size={9} /> {todo.remindTime}
            </span>
          )}
          {todo.mustNotForget && <span className="is-forget">não esquecer</span>}
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

export function Scoreboard({ score, companies }: { score: WeekScore; companies: Company[] }) {
  const per = companies.filter((c) => score.byCompany[c.id])
  return (
    <div className="wk-score" aria-label="Placar da semana">
      <span className="wk-score-k">Semana</span>
      <span className="wk-score-cell is-main" title="Entregas na semana">
        <Odometer value={score.delivered} digits={2} label="Entregas na semana" />
        <em>entregas</em>
      </span>
      <span className="wk-score-cell" title="Validações na semana">
        <Odometer value={score.validated} digits={2} label="Validações na semana" />
        <em>validadas</em>
      </span>
      <span className="wk-score-cell" title="Concluídos na semana">
        <Odometer value={score.done} digits={2} label="Concluídos na semana" />
        <em>concluídas</em>
      </span>
      {per.length > 1 && (
        <span className="wk-score-split">
          {per.map((c) => (
            <span key={c.id} style={coStyle(c)} title={`${c.name}: ${score.byCompany[c.id]} entregas`}>
              <CompanyMark company={c} size={11} />
              {score.byCompany[c.id]}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
