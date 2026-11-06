import { useState, type ReactNode } from 'react'
import { addDays, parseCivil } from '../../shared/dates'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import {
  dayGrid, dueLabel, fixedTodos, healthLabel, label, streak, suggestFocus, todayTodos, todoDoneOn, upcomingTodos,
  type Alert, type Blocker, type ForgetEntry, type Health, type Scope,
} from './logic'
import {
  convertTodo, deleteTodo, doMove, followup, openDialog, openItem, readUi, resume, setFocus, snooze, toggleTodo, updateItem,
  useWork, writeUi,
} from './store'
import { FOCUS_MAX, MODE_LABEL, NEXT_ACTION, STAGE_LABEL, type Company, type Todo, type WorkItem, type WorkState } from './types'

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

function runAlert(a: Alert, today: string) {
  if (!a.action) return a.itemId && openItem(a.itemId)
  const id = a.itemId
  switch (a.action.kind) {
    case 'followup':
      return id && followup(id)
    case 'resume':
      return id && resume(id)
    case 'snooze':
      return id && snooze(id, addDays(today, 3))
    case 'due_tomorrow':
      return id && updateItem(id, { dueDate: addDays(today, 1) })
    case 'focus':
      return id && setFocus(id, true)
    case 'close':
      return id && doMove(id, 'done', true)
    case 'open':
      return id && openItem(id)
    case 'show_doing':
      return document.getElementById('wk-col-doing')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

const ALERT_ICON: Record<Alert['kind'], Parameters<typeof Icon>[0]['name']> = {
  returned: 'back',
  overdue: 'flag',
  due_today: 'cal',
  validation: 'user',
  waiting: 'pause',
  unchecked: 'check',
  close: 'check',
  stale: 'clock',
  wip: 'board',
}

export function HealthPanel({ state, health, perCompany, today, scope, onScope }: {
  state: WorkState
  health: Health
  perCompany: { company: Company; health: Health; counts: { doing: number; waiting: number; validation: number; returned: number } }[]
  today: string
  scope: Scope
  onScope: (s: Scope) => void
}) {
  const green = health.level === 'green'
  const days = streak(state.days, today, green)
  const grid = dayGrid(state.days, today, green, 14)
  return (
    <section className={`panel wk-health reveal is-${health.level}`} style={{ ['--i' as string]: 3 }} aria-label="Saúde do trabalho">
      <div className="wk-health-main">
        <Ring progress={health.progress} level={health.level}>
          <span className="wk-ring-num">{health.total ? `${health.handled}/${health.total}` : <Icon name="check" size={26} />}</span>
          <span className="wk-ring-cap">hoje</span>
        </Ring>
        <div className="wk-health-text">
          <div className="kicker">{green ? 'Dia limpo' : health.level === 'red' ? 'Precisa de você' : 'Quase lá'}</div>
          <h2 className="display">{healthLabel(health)}</h2>
          <p>
            {green
              ? health.handled
                ? `Você resolveu ${health.handled} ${health.handled === 1 ? 'coisa' : 'coisas'} hoje. Nada atrasado, nada esquecido.`
                : 'Nada atrasado, nada esquecido, validações em dia.'
              : `${health.handled} de ${health.total} resolvidas hoje. Cada uma fecha um pedaço do anel.`}
          </p>
        </div>
      </div>
      <div className="wk-spaces">
        {perCompany.map(({ company, health: h, counts }) => (
          <button
            key={company.id}
            className={`wk-space ${scope === company.id ? 'is-on' : ''}`}
            style={coStyle(company)}
            onClick={() => onScope(scope === company.id ? 'all' : company.id)}
            aria-pressed={scope === company.id}
            title={`${company.name}: ${healthLabel(h)}`}
          >
            <Ring progress={h.progress} level={h.level} size={34} stroke={3.5}>
              <CompanyMark company={company} size={16} />
            </Ring>
            <span className="wk-space-text">
              <b>{company.name}</b>
              <span>
                {[
                  counts.doing ? `${counts.doing} fazendo` : '',
                  counts.waiting ? `${counts.waiting} aguardando` : '',
                  counts.validation ? `${counts.validation} p/ validar` : '',
                  counts.returned ? `${counts.returned} voltou` : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || (h.level === 'green' ? 'em dia' : `${h.blockers.length} pendente${h.blockers.length > 1 ? 's' : ''}`)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="wk-streak">
        <div className="wk-streak-head">
          <span>
            <b>{days}</b> {days === 1 ? 'dia' : 'dias'} em dia
          </span>
          <span className="wk-streak-legend">últimas 14 semanas</span>
        </div>
        <div className="wk-grid" role="img" aria-label={`${days} dias seguidos em dia`}>
          {grid.map((w, wi) => (
            <div key={wi} className="wk-grid-col">
              {w.map((c) => (
                <span key={c.date} className={`wk-cell is-${c.state} ${c.date === today ? 'is-today' : ''}`} title={`${fmtDay.format(parseCivil(c.date)).replace(/\./g, '')}${c.state === 'green' ? ' · em dia' : c.state === 'miss' ? ' · ficou pendência' : ''}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function AttentionPanel({ health, tips, state, today, onTodo }: { health: Health; tips: Alert[]; state: WorkState; today: string; onTodo: (id: string) => void }) {
  const companies = new Map(state.companies.map((c) => [c.id, c]))
  const run = (b: Blocker) => {
    if (b.todoId) return toggleTodo(b.todoId)
    if (b.alert) return runAlert(b.alert, today)
  }
  return (
    <section className="panel wk-attn reveal" style={{ ['--i' as string]: 4 }} aria-label="O que precisa da sua atenção">
      <header className="wk-sec-head">
        <h2 className="wk-sec-title">{health.blockers.length ? 'Para ficar tudo verde' : 'Atenção'}</h2>
        {health.blockers.length > 0 && <span className="wk-count">{health.blockers.length}</span>}
      </header>
      {health.blockers.length === 0 ? (
        <div className="wk-calm">
          <span className="wk-calm-mark" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <p>
            <b>Tudo em dia.</b> Nenhum prazo vencido, nada esperando cobrança, nenhum retorno parado.
          </p>
        </div>
      ) : (
        <ul className="wk-attn-list">
          {health.blockers.map((b, i) => {
            const co = b.companyId ? companies.get(b.companyId) : null
            const icon = b.todoId ? (b.severity === 3 ? 'alarm' : 'check') : b.alert ? ALERT_ICON[b.alert.kind] : 'flag'
            const action = b.todoId ? 'Feito' : b.alert?.action?.label
            return (
              <li key={b.id} className={`wk-attn-row is-s${b.severity}`} style={{ ['--i' as string]: i, ...coStyle(co) }}>
                <span className="wk-attn-icon" aria-hidden="true">
                  <Icon name={icon} size={15} />
                </span>
                <button className="wk-attn-body" onClick={() => (b.itemId ? openItem(b.itemId) : b.todoId ? onTodo(b.todoId) : b.alert && runAlert(b.alert, today))}>
                  <span className="wk-attn-title">
                    {co && <CompanyMark company={co} size={13} />}
                    {b.title}
                  </span>
                  <span className="wk-attn-detail">{b.detail}</span>
                </button>
                {action && (
                  <button className="btn wk-attn-act" onClick={() => void run(b)}>
                    {action}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {tips.length > 0 && (
        <div className="wk-tips">
          <span className="wk-tips-title">Dicas, sem pressa</span>
          {tips.slice(0, 3).map((a) => (
            <div key={a.id} className="wk-tip">
              <button className="wk-tip-body" onClick={() => a.itemId && openItem(a.itemId)}>
                <b>{a.title}</b> <span>{a.detail}</span>
              </button>
              {a.action && (
                <button className="btn quiet wk-tip-act" onClick={() => void runAlert(a, today)}>
                  {a.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function ForgetStrip({ entries, companies }: { entries: ForgetEntry[]; companies: Company[] }) {
  const [leaving, setLeaving] = useState<string[]>([])
  const resolve = (id: string) => {
    if (leaving.includes(id)) return
    setLeaving((l) => [...l, id])
    setTimeout(() => {
      void toggleTodo(id).finally(() => setLeaving((l) => l.filter((x) => x !== id)))
    }, 420)
  }
  if (!entries.length) return null
  const due = entries.filter((e) => e.state === 'due').length
  return (
    <section className={`wk-forget reveal ${due ? 'is-due' : ''}`} style={{ ['--i' as string]: 2 }} aria-label="Não pode esquecer">
      <div className="wk-forget-head">
        <Icon name="alarm" size={15} />
        <span>Não pode esquecer</span>
        {due > 0 && <span className="wk-forget-n">{due}</span>}
      </div>
      <ul className="wk-forget-list">
        {entries.map((e) => {
          const co = companies.find((c) => c.id === e.todo.companyId)
          const out = leaving.includes(e.todo.id)
          return (
            <li key={e.todo.id} className={`wk-forget-row is-${e.state} ${out ? 'is-leaving' : ''}`} style={coStyle(co)}>
              <button className={`wk-tick ${out ? 'is-on' : ''}`} onClick={() => resolve(e.todo.id)} aria-label={`Resolver: ${e.todo.title}`}>
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
                </svg>
              </button>
              <button className="wk-forget-text" onClick={() => openDialog({ kind: 'todo', todoId: e.todo.id })}>
                <b>{e.todo.title}</b>
                <span>
                  {co && <CompanyMark company={co} size={12} />}
                  {e.when}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function FocusPanel({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
  const focus = state.items
    .filter((i) => i.focusedAt && i.stage !== 'done' && (scope === 'all' || i.companyId === scope))
    .sort((a, b) => a.focusedAt!.localeCompare(b.focusedAt!))
  const total = state.items.filter((i) => i.focusedAt && i.stage !== 'done').length
  const sugg = total < FOCUS_MAX ? suggestFocus(state.items, today, scope, FOCUS_MAX - total) : []
  const companies = new Map(state.companies.map((c) => [c.id, c]))
  return (
    <section className="panel wk-focus reveal" style={{ ['--i' as string]: 6 }} aria-label="Foco agora">
      <header className="wk-sec-head">
        <h2 className="wk-sec-title">Foco agora</h2>
        <span className="wk-sec-hint">{total}/{FOCUS_MAX}</span>
      </header>
      {focus.length === 0 && !sugg.length && <p className="wk-empty-line">Fixe até 3 itens com o alfinete do cartão. O resto pode esperar.</p>}
      <ul className="wk-focus-list">
        {focus.map((i) => (
          <FocusCard key={i.id} item={i} company={companies.get(i.companyId)} today={today} />
        ))}
      </ul>
      {sugg.length > 0 && (
        <div className="wk-sugg">
          <span className="wk-tips-title">Sugestões para o foco</span>
          {sugg.map((i) => (
            <div key={i.id} className="wk-sugg-row" style={coStyle(companies.get(i.companyId))}>
              <button className="wk-sugg-body" onClick={() => openItem(i.id)}>
                <CompanyMark company={companies.get(i.companyId)} size={13} />
                <span>{label(i)}</span>
                <em>{i.returnOpen ? 'voltou' : i.priority === 'urgente' ? 'urgente' : i.dueDate ? dueLabel(i.dueDate, today) : ''}</em>
              </button>
              <button className="btn quiet wk-pin-btn" onClick={() => void setFocus(i.id, true)} aria-label={`Pôr no foco: ${i.title}`}>
                <Icon name="pin" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function FocusCard({ item, company, today }: { item: WorkItem; company?: Company; today: string }) {
  const next = NEXT_ACTION[item.stage]
  const { celebrate: cel } = useWork()
  return (
    <li className={`wk-fcard ${cel?.itemId === item.id ? 'is-celebrating' : ''}`} style={coStyle(company)}>
      <button className="wk-fcard-body" onClick={() => openItem(item.id)}>
        <span className="wk-fcard-top">
          <CompanyMark company={company} size={14} />
          {item.ticket && <span className="wk-ticket">{item.ticket}</span>}
          <span className="wk-stage-pill">{STAGE_LABEL[item.stage]}</span>
        </span>
        <span className="wk-fcard-title">{item.title}</span>
        <span className="wk-fcard-meta">
          {item.returnOpen && <span className="wk-chip is-warn">voltou {item.returns}×</span>}
          {item.waitingOn && <span className="wk-chip is-wait">aguardando {item.waitingOn}</span>}
          {item.dueDate && <span className={`wk-chip is-due-${item.dueDate < today ? 'late' : item.dueDate === today ? 'today' : 'later'}`}>{dueLabel(item.dueDate, today)}</span>}
        </span>
      </button>
      <div className="wk-fcard-acts">
        {item.returnOpen ? (
          <button className="btn primary" onClick={() => void resume(item.id)}>
            Retomei
          </button>
        ) : (
          next && (
            <button className="btn primary" onClick={() => openItem(item.id)}>
              {next.label}
              <Icon name="arrow" size={13} />
            </button>
          )
        )}
        <button className="btn quiet" onClick={() => void setFocus(item.id, false)} aria-label="Tirar do foco" title="Tirar do foco">
          <Icon name="x" size={13} />
        </button>
      </div>
    </li>
  )
}

type TodoTab = 'today' | 'fixed' | 'upcoming' | 'done'

export function TodosPanel({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
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
    { id: 'upcoming', label: 'Próximos', n: upcoming.length },
    { id: 'done', label: 'Feitos' },
  ]
  return (
    <section className="panel wk-todos reveal" style={{ ['--i' as string]: 5 }} aria-label="To-dos">
      <header className="wk-sec-head">
        <h2 className="wk-sec-title">To-dos</h2>
        {tt.length > 0 && (
          <span className="wk-todo-progress" aria-label={`${doneN} de ${tt.length} hoje`}>
            <span className="wk-bar">
              <span style={{ transform: `scaleX(${tt.length ? doneN / tt.length : 0})` }} />
            </span>
            {doneN} de {tt.length}
          </span>
        )}
        <button className="btn quiet wk-add-mini" onClick={() => openDialog({ kind: 'todo', draft: { companyId: scope === 'all' ? undefined : scope } })} aria-label="Novo to-do">
          <Icon name="plus" size={14} />
        </button>
      </header>
      <div className="wk-tabs" role="tablist" aria-label="Lista de to-dos">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => pick(t.id)}>
            {t.label}
            {!!t.n && <span className="wk-tab-n">{t.n}</span>}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="wk-empty-line">
          {tab === 'today'
            ? 'Nada para hoje. Escreva acima com “todo dia”, “fixo” ou uma data.'
            : tab === 'fixed'
              ? 'Pendências permanentes aparecem aqui até você concluir.'
              : tab === 'upcoming'
                ? 'To-dos com data futura aparecem aqui.'
                : 'O que você concluir fica aqui por 30 dias.'}
        </p>
      ) : (
        <ul className="wk-todo-list">
          {rows.map((r) => (
            <TodoRow key={r.todo.id} todo={r.todo} done={r.done} late={r.late} company={companies.get(r.todo.companyId)} today={today} state={state} showSpace={scope === 'all'} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TodoRow({ todo, done, late, company, today, state, showSpace }: { todo: Todo; done: boolean; late: boolean; company?: Company; today: string; state: WorkState; showSpace: boolean }) {
  const { celebrate: cel } = useWork()
  const pop = cel?.todoId === todo.id
  const history =
    todo.mode === 'daily'
      ? Array.from({ length: 7 }, (_, k) => addDays(today, k - 6)).map((d) => ({ d, on: todoDoneOn(todo, state.todoChecks, d) }))
      : null
  return (
    <li className={`wk-todo ${done ? 'is-done' : ''} ${late ? 'is-late' : ''} ${pop ? 'is-pop' : ''} ${todo.mustNotForget ? 'is-forget' : ''}`} style={coStyle(company)}>
      <button className={`wk-tick ${done ? 'is-on' : ''}`} onClick={() => void toggleTodo(todo.id)} aria-label={done ? `Desmarcar: ${todo.title}` : `Concluir: ${todo.title}`} aria-pressed={done}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
        </svg>
      </button>
      <button className="wk-todo-body" onClick={() => openDialog({ kind: 'todo', todoId: todo.id })}>
        <span className="wk-todo-title">
          {todo.priority !== 'normal' && <span className={`wk-prio is-${todo.priority}`} aria-label={todo.priority === 'urgente' ? 'urgente' : 'alta'} />}
          {todo.title}
        </span>
        <span className="wk-todo-meta">
          {showSpace && company && (
            <span className="wk-todo-space">
              <CompanyMark company={company} size={11} />
              {company.name}
            </span>
          )}
          {todo.mustNotForget && <span className="wk-chip is-forget">não pode esquecer</span>}
          {todo.mode === 'dated' && todo.dueDate && <span className={`wk-chip ${late ? 'is-due-late' : todo.dueDate === today ? 'is-due-today' : ''}`}>{dueLabel(todo.dueDate, today)}</span>}
          {todo.mode !== 'dated' && <span className="wk-chip is-quiet">{todo.mode === 'daily' && todo.weekdaysOnly ? 'Dias úteis' : MODE_LABEL[todo.mode]}</span>}
          {todo.remindTime && (
            <span className="wk-chip is-quiet">
              <Icon name="bell" size={10} />
              {todo.remindTime}
            </span>
          )}
          {todo.itemId && <span className="wk-chip is-quiet">virou item</span>}
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
            <Icon name="board" size={13} />
          </button>
        )}
        <button className="wk-icon-btn" onClick={() => void deleteTodo(todo.id)} title="Remover" aria-label={`Remover: ${todo.title}`}>
          <Icon name="trash" size={13} />
        </button>
      </span>
    </li>
  )
}
