import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { onIntent } from '../../app/router'
import { civil, fmtLong } from '../../shared/dates'
import { Segmented } from '../../shared/ui/Segmented'
import { Board } from './Board'
import { CompanyMark } from './brand'
import { Capture } from './Capture'
import { AttentionPanel, FocusPanel, ForgetStrip, HealthPanel, TodosPanel } from './Copilot'
import { Delivered } from './Delivered'
import { DialogHost } from './Dialogs'
import { Drawer } from './Drawer'
import { Icon } from './icons'
import { computeAlerts, computeHealth, countsFor, forgetList, healthLabel, localNow, type Scope } from './logic'
import { startNotifier } from './notify'
import { dismissToast, loadWork, openDialog, readUi, useWork, writeUi } from './store'
import type { WorkState } from './types'
import './work.css'

startNotifier()

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function ScopeFilter({ state, value, onChange }: { state: WorkState; value: Scope; onChange: (s: Scope) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const opts = [{ id: 'all', name: 'Todos' }, ...state.companies]
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLButtonElement>(`[data-id="${value}"]`)
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth })
  }, [value, state.companies])
  return (
    <div className="seg wk-scope" role="tablist" aria-label="Espaço" ref={box}>
      {pill && <span className="seg-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
      {opts.map((o) => {
        const c = state.companies.find((x) => x.id === o.id)
        return (
          <button key={o.id} data-id={o.id} role="tab" aria-selected={value === o.id} className="seg-btn" onClick={() => onChange(o.id)}>
            {c && <CompanyMark company={c} size={15} />}
            {o.name}
          </button>
        )
      })}
    </div>
  )
}

export default function Work() {
  const { state, error, toast } = useWork()
  const now = useClock()
  const today = civil(now)
  const nowLocal = localNow(now)
  const [scope, setScopeRaw] = useState<Scope>(() => readUi().scope ?? 'all')
  const [view, setViewRaw] = useState<'board' | 'delivered'>(() => readUi().view ?? 'board')
  const capture = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadWork()
  }, [])
  useEffect(() => onIntent((i) => i === 'new-task' && capture.current?.focus()), [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.wk-scrim, .wk-drawer')) return
      if (e.key === 'n') {
        e.preventDefault()
        capture.current?.focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const validScope = state && scope !== 'all' && !state.companies.some((c) => c.id === scope) ? 'all' : scope
  const setScope = (s: Scope) => {
    setScopeRaw(s)
    writeUi({ scope: s })
  }
  const setView = (v: 'board' | 'delivered') => {
    setViewRaw(v)
    writeUi({ view: v })
  }

  const derived = useMemo(() => {
    if (!state) return null
    const alerts = computeAlerts(state, today, validScope)
    const health = computeHealth(state, today, nowLocal, validScope, alerts)
    const perCompany = state.companies.map((company) => {
      const h = computeHealth(state, today, nowLocal, company.id)
      const c = countsFor(state.items, company.id, today)
      return { company, health: h, counts: { doing: c.doing, waiting: c.waiting, validation: c.validation, returned: c.returned } }
    })
    const forget = forgetList(state.todos, state.todoChecks, today, nowLocal, validScope)
    const tips = alerts.filter((a) => a.severity < 2)
    return { alerts, health, perCompany, forget, tips }
  }, [state, today, nowLocal, validScope])

  if (!state || !derived) {
    return (
      <section className="page wk">
        <header className="wk-head">
          <div>
            <div className="kicker">{fmtLong.format(now)}</div>
            <h1 className="display">Workstation</h1>
            <p className="wk-sub">{error ? `Não consegui abrir os dados: ${error}` : 'Carregando…'}</p>
          </div>
        </header>
      </section>
    )
  }

  const { health, perCompany, forget, tips } = derived

  return (
    <section className={`page wk is-${health.level}`}>
      <header className="wk-head reveal" style={{ ['--i' as string]: 0 }}>
        <div>
          <div className="kicker">{fmtLong.format(now)}</div>
          <h1 className="display">Workstation</h1>
          <p className="wk-sub">
            <span className={`wk-dot is-${health.level}`} aria-hidden="true" />
            {healthLabel(health)}
          </p>
        </div>
        <div className="wk-head-tools">
          <ScopeFilter state={state} value={validScope} onChange={setScope} />
          <div className="wk-head-btns">
            <button className="btn" onClick={() => openDialog({ kind: 'standup' })}>
              <Icon name="text" size={14} />
              Daily
            </button>
            <button className="btn quiet" onClick={() => openDialog({ kind: 'settings' })} aria-label="Ajustes">
              <Icon name="gear" size={15} />
            </button>
          </div>
        </div>
      </header>

      <Capture ref={capture} state={state} today={today} scope={validScope} />
      <ForgetStrip entries={forget} companies={state.companies} />

      <div className="wk-top">
        <HealthPanel state={state} health={health} perCompany={perCompany} today={today} scope={validScope} onScope={setScope} />
        <AttentionPanel health={health} tips={tips} state={state} today={today} onTodo={(id) => openDialog({ kind: 'todo', todoId: id })} />
      </div>

      <div className="wk-mid">
        <TodosPanel state={state} today={today} scope={validScope} />
        <FocusPanel state={state} today={today} scope={validScope} />
      </div>

      <div className="wk-view-head reveal" style={{ ['--i' as string]: 7 }}>
        <h2 className="display">{view === 'board' ? 'Quadro' : 'Entregues'}</h2>
        <Segmented
          label="Visão"
          value={view}
          onChange={setView}
          options={[
            { id: 'board', label: 'Quadro', count: state.items.filter((i) => i.stage !== 'done' && (validScope === 'all' || i.companyId === validScope)).length },
            { id: 'delivered', label: 'Entregues' },
          ]}
        />
      </div>
      <div key={view} className="wk-view reveal" style={{ ['--i' as string]: 8 }}>
        {view === 'board' ? <Board state={state} today={today} scope={validScope} /> : <Delivered state={state} today={today} scope={validScope} />}
      </div>

      <Drawer state={state} today={today} />
      <DialogHost state={state} scope={validScope} />
      {toast &&
        createPortal(
        <div className={`wk-toast is-${toast.tone ?? 'info'}`} role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className="btn quiet"
              onClick={() => {
                toast.undo!()
                dismissToast()
              }}
            >
              Desfazer
            </button>
          )}
        </div>,
          document.body,
        )}
    </section>
  )
}
