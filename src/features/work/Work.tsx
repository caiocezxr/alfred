import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { onIntent } from '../../app/router'
import { civil, fmtLong } from '../../shared/dates'
import { Segmented } from '../../shared/ui/Segmented'
import { Board } from './Board'
import { CompanyMark } from './brand'
import { Capture } from './Capture'
import { FocusTile, ForgetTile, HealthTile, Scoreboard, TodosTile } from './Copilot'
import { Delivered } from './Delivered'
import { DialogHost } from './Dialogs'
import { Drawer } from './Drawer'
import { Icon } from './icons'
import { boardColumns, computeAlerts, computeHealth, forgetList, healthLabel, isPost, localNow, moveSelection, nudges, rulerModel, weekScore } from './logic'
import { startNotifier } from './notify'
import { Nudges } from './Nudges'
import { Ruler } from './Ruler'
import {
  dismissToast, getWork, initScope, loadWork, openDialog, openItemFrom, readUi, requestMove, select, setFocus, setScope, toggleTimer, useWork,
  writeUi,
} from './store'
import { NEXT_ACTION, type WorkState } from './types'
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

function inkFor(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.4 ? '#14100a' : '#ffffff'
}

function ScopeFilter({ state, value }: { state: WorkState; value: string }) {
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
      {opts.map((o, i) => {
        const c = state.companies.find((x) => x.id === o.id)
        return (
          <button key={o.id} data-id={o.id} role="tab" aria-selected={value === o.id} className="seg-btn" onClick={() => setScope(o.id)} title={`${o.name} (${i})`}>
            {c && <CompanyMark company={c} size={15} />}
            <span className="wk-scope-name">{o.name}</span>
          </button>
        )
      })}
    </div>
  )
}

function rootAccent() {
  if (typeof document === 'undefined') return '#c2ab88'
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c2ab88'
}

export default function Work() {
  const { state, error, toast, scope } = useWork()
  const now = useClock()
  const today = civil(now)
  const nowLocal = localNow(now)
  const [view, setViewRaw] = useState<'board' | 'delivered'>(() => readUi().view ?? 'board')
  const capture = useRef<HTMLInputElement>(null)

  useEffect(() => {
    initScope()
    void loadWork()
  }, [])
  useEffect(() => onIntent((i) => i === 'new-task' && capture.current?.focus()), [])

  const validScope = state && scope !== 'all' && !state.companies.some((c) => c.id === scope) ? 'all' : scope
  const setView = (v: 'board' | 'delivered') => {
    setViewRaw(v)
    writeUi({ view: v })
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.wk-scrim, .wk-drawer, .wk-ghost')) return
      const st = getWork().state
      if (!st) return
      const sc = getWork().scope
      const cols = boardColumns(st.items, sc, civil())
      const sel = getWork().selectedId
      const item = sel ? st.items.find((i) => i.id === sel) : null
      const dir = ({ j: 'down', ArrowDown: 'down', k: 'up', ArrowUp: 'up', h: 'left', ArrowLeft: 'left', l: 'right', ArrowRight: 'right' } as const)[e.key as 'j']
      if (dir) {
        e.preventDefault()
        if (view !== 'board') setView('board')
        select(moveSelection(cols, sel, dir))
        return
      }
      if (e.key === '/' || e.key === 'n') {
        e.preventDefault()
        capture.current?.focus()
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        openDialog({ kind: 'keys' })
        return
      }
      if (/^[0-9]$/.test(e.key)) {
        const ids = ['all', ...st.companies.map((c) => c.id)]
        const id = ids[Number(e.key)]
        if (id) setScope(id)
        return
      }
      if (e.key === 'Escape' && sel) return select(null)
      if (!item) return
      const el = document.querySelector<HTMLElement>(`[data-card="${item.id}"]`)
      if (e.key === 'Enter' || e.key === 'o') {
        e.preventDefault()
        openItemFrom(item.id, el)
      } else if (e.key === 'e') {
        const next = NEXT_ACTION[item.stage]
        if (next) requestMove(item.id, next.to)
      } else if (e.key === 'b') {
        if (isPost(item.stage)) openDialog({ kind: 'return', itemId: item.id })
      } else if (e.key === 'f') {
        if (item.stage !== 'done') void setFocus(item.id, !item.focusedAt)
      } else if (e.key === 't') {
        if (item.stage !== 'done') void toggleTimer(item.id)
      } else if (e.key === 'w') {
        if (item.stage !== 'done') openDialog({ kind: 'wait', itemId: item.id })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [view])

  const derived = useMemo(() => {
    if (!state) return null
    const alerts = computeAlerts(state, today, validScope)
    const health = computeHealth(state, today, nowLocal, validScope, alerts)
    const perCompany = state.companies.map((company) => ({ company, health: computeHealth(state, today, nowLocal, company.id) }))
    const forget = forgetList(state.todos, state.todoChecks, today, nowLocal, validScope)
    return { health, perCompany, forget, nudges: nudges(alerts), ruler: rulerModel(state, today, now, validScope), score: weekScore(state, today, validScope) }
  }, [state, today, nowLocal, validScope, now])

  const company = state?.companies.find((c) => c.id === validScope) ?? null
  const tint = company?.color ?? rootAccent()
  const style = {
    '--wk-tint': tint,
    '--accent': 'var(--wk-tint)',
    '--accent-ink': company ? inkFor(company.color) : undefined,
  } as CSSProperties

  if (!state || !derived) {
    return (
      <section className="page wk" style={style}>
        <header className="wk-head">
          <div className="wk-title">
            <div className="kicker">{fmtLong.format(now)}</div>
            <h1 className="display">Workstation</h1>
          </div>
        </header>
        <p className="wk-sub">{error ? `Não consegui abrir os dados: ${error}` : 'Carregando…'}</p>
      </section>
    )
  }

  const { health, perCompany, forget } = derived

  return (
    <section className={`page wk is-${health.level} ${forget.length ? 'has-forget' : ''}`} style={style} data-scope={validScope}>
      <div className="wk-ambient" aria-hidden="true">
        {[{ id: 'all', color: 'var(--accent)' }, ...state.companies].map((c) => (
          <span key={c.id} className={`wk-amb ${validScope === c.id ? 'is-on' : ''}`} style={{ ['--amb' as string]: 'color' in c ? c.color : undefined }} />
        ))}
      </div>

      <header className="wk-head reveal" style={{ ['--i' as string]: 0 }}>
        <div className="wk-title">
          <div className="kicker">{fmtLong.format(now)}</div>
          <h1 className="display">Workstation</h1>
          <p className="wk-sub">
            <span className={`wk-dot is-${health.level}`} aria-hidden="true" />
            <span className="wk-sub-text">{healthLabel(health)}</span>
          </p>
        </div>
        <Scoreboard score={derived.score} companies={state.companies} />
        <div className="wk-head-tools">
          <ScopeFilter state={state} value={validScope} />
          <button className="btn quiet wk-tool" onClick={() => openDialog({ kind: 'standup' })} title="Gerar o texto da daily">
            <Icon name="text" size={14} />
            <span>Daily</span>
          </button>
          <button className="btn quiet wk-tool" onClick={() => openDialog({ kind: 'keys' })} aria-label="Atalhos de teclado" title="Atalhos (?)">
            <kbd>?</kbd>
          </button>
          <button className="btn quiet wk-tool" onClick={() => openDialog({ kind: 'settings' })} aria-label="Ajustes" title="Ajustes">
            <Icon name="gear" size={15} />
          </button>
        </div>
      </header>

      <div className="wk-strip reveal" style={{ ['--i' as string]: 1 }}>
        <Capture ref={capture} state={state} today={today} scope={validScope} />
        <Ruler model={derived.ruler} companies={state.companies} />
      </div>

      <div className="wk-bento">
        <HealthTile state={state} health={health} perCompany={perCompany} today={today} scope={validScope} />
        <ForgetTile entries={forget} companies={state.companies} />
        <FocusTile state={state} today={today} scope={validScope} />
        <TodosTile state={state} today={today} scope={validScope} />
      </div>

      <div className="wk-toolbar reveal" style={{ ['--i' as string]: 6 }}>
        <Segmented
          label="Visão"
          value={view}
          onChange={setView}
          options={[
            { id: 'board', label: 'Quadro', count: state.items.filter((i) => i.stage !== 'done' && (validScope === 'all' || i.companyId === validScope)).length },
            { id: 'delivered', label: 'Entregues' },
          ]}
        />
        <Nudges list={derived.nudges} />
      </div>

      <div key={view} className={`wk-view is-${view} reveal`} style={{ ['--i' as string]: 7 }}>
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
