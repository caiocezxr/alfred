import { useEffect, useRef, useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { civil } from '../../shared/dates'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import { fmtClock, fmtDur, forgetList, itemTimeMs, label, localNow, neglectFor, rangeTimeMs, runningSession, sessionMs, sumTime } from './logic'
import { startNotifier } from './notify'
import { loadWork, openDialog, openItem, requestMove, setScope, stopTimer, toggleTodo, useWork } from './store'
import { NEXT_ACTION, STAGE_LABEL } from './types'
import './island.css'

function useTick(ms: number) {
  const [, setT] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

export default function Island() {
  const { state, scope } = useWork()
  const route = useRoute()
  const run = state ? runningSession(state.sessions) : null
  useTick(run ? 1000 : 30_000)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    void loadWork()
    startNotifier()
  }, [])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', down, true)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', down, true)
    }
  }, [open])

  if (!state) return null
  const now = new Date()
  const today = civil(now)
  const item = run ? (state.items.find((i) => i.id === run.itemId && (scope === 'all' || i.companyId === scope)) ?? null) : null
  const company = item ? state.companies.find((c) => c.id === item.companyId) : null
  const forget = forgetList(state.todos, state.todoChecks, today, localNow(now), scope).filter((f) => !done.includes(f.todo.id))
  const dueForget = forget.filter((f) => f.state === 'due')
  const firstForget = dueForget[0] ?? forget[0]
  const neglected = neglectFor(state, now).filter((n) => n.unseen && (scope === 'all' || n.companyId === scope))
  const firstNeglect = neglected[0]
  const nco = firstNeglect ? state.companies.find((c) => c.id === firstNeglect.companyId) : null
  const mode = item && run ? 'timer' : firstForget ? 'forget' : firstNeglect ? 'neglect' : null
  if (!mode) return null

  const resolve = (id: string) => {
    setDone((d) => [...d, id])
    void toggleTodo(id).finally(() => setTimeout(() => setDone((d) => d.filter((x) => x !== id)), 400))
  }
  const goItem = (id: string) => {
    setOpen(false)
    if (route !== 'work') navigate('work')
    setTimeout(() => openItem(id), route === 'work' ? 0 : 380)
  }
  const elapsed = run ? sessionMs(run, now.getTime()) : 0
  const total = sumTime(rangeTimeMs(state.sessions, state.items, today, today, now.getTime(), scope))
  const fco = firstForget ? state.companies.find((c) => c.id === firstForget.todo.companyId) : null
  const next = item ? NEXT_ACTION[item.stage] : null

  return (
    <div
      ref={box}
      className={`isl ${open ? 'is-open' : ''} is-${mode} ${mode === 'forget' && dueForget.length ? 'is-alert' : ''}`}
      style={coStyle(mode === 'timer' ? company : mode === 'neglect' ? nco : fco)}
      onMouseEnter={() => {
        clearTimeout(hover.current)
        hover.current = setTimeout(() => setOpen(true), 260)
      }}
      onMouseLeave={() => {
        clearTimeout(hover.current)
        hover.current = setTimeout(() => setOpen(false), 280)
      }}
    >
      <button
        className="isl-pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={mode === 'timer' ? `Cronômetro: ${item ? label(item) : ''}` : mode === 'neglect' ? `${nco?.name} sem olhar hoje` : `Não pode esquecer: ${firstForget?.todo.title}`}
      >
        {mode === 'timer' && item ? (
          <>
            <span className="isl-live" aria-hidden="true" />
            <CompanyMark company={company} size={14} />
            <span className="isl-text">{label(item)}</span>
            <span className="isl-clock">{fmtClock(elapsed)}</span>
          </>
        ) : mode === 'neglect' && firstNeglect ? (
          <>
            <span className="isl-amber" aria-hidden="true" />
            <CompanyMark company={nco} size={14} />
            <span className="isl-text">{nco?.name} sem olhar hoje</span>
            {neglected.length > 1 && <span className="isl-when">+{neglected.length - 1}</span>}
          </>
        ) : (
          firstForget && (
            <>
              <Icon name="alarm" size={13} />
              <span className="isl-text">{firstForget.todo.title}</span>
              <span className="isl-when">{firstForget.state === 'due' ? (dueForget.length > 1 ? `+${dueForget.length - 1}` : 'agora') : firstForget.when.replace('hoje, ', '')}</span>
            </>
          )
        )}
      </button>

      <div className="isl-panel" role="dialog" aria-label="Ilha" aria-hidden={!open}>
        {mode === 'timer' && item && run && (
          <section className="isl-sec">
            <div className="isl-row">
              <CompanyMark company={company} size={18} />
              <span className="isl-title">
                <b>{label(item)}</b>
                <em>
                  {company?.name} · {STAGE_LABEL[item.stage]} · {fmtDur(itemTimeMs(state.sessions, item.id, now.getTime()))} no item
                </em>
              </span>
            </div>
            <div className="isl-big">{fmtClock(elapsed)}</div>
            <div className="isl-acts">
              <button className="isl-btn is-stop" onClick={() => void stopTimer()} tabIndex={open ? 0 : -1}>
                <Icon name="pause" size={12} />
                Pausar
              </button>
              {next && item.stage === 'doing' && (
                <button className="isl-btn" onClick={() => requestMove(item.id, next.to)} tabIndex={open ? 0 : -1}>
                  {next.label}
                </button>
              )}
              <button className="isl-btn" onClick={() => goItem(item.id)} tabIndex={open ? 0 : -1}>
                Abrir
                <Icon name="arrow" size={11} />
              </button>
            </div>
            <div className="isl-foot">hoje {fmtDur(total)} contados</div>
          </section>
        )}
        {neglected.length > 0 && (
          <section className="isl-sec is-neglect">
            <span className="isl-k is-amber">
              <Icon name="eye" size={11} />
              Sem olhar hoje
            </span>
            <ul>
              {neglected.map((n) => {
                const co = state.companies.find((c) => c.id === n.companyId)
                return (
                  <li key={n.companyId} style={coStyle(co)}>
                    <CompanyMark company={co} size={16} />
                    <span className="isl-ftext">
                      <b>{co?.name}</b>
                      <em>{n.label}</em>
                    </span>
                    <button
                      className="isl-mini"
                      tabIndex={open ? 0 : -1}
                      onClick={() => {
                        setOpen(false)
                        if (route !== 'work') navigate('work')
                        setScope(n.companyId)
                      }}
                    >
                      Abrir {co?.name}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        {forget.length > 0 && (
          <section className="isl-sec is-forget">
            <span className="isl-k">
              <Icon name="alarm" size={11} />
              Não pode esquecer
            </span>
            <ul>
              {forget.slice(0, 4).map((f) => {
                const co = state.companies.find((c) => c.id === f.todo.companyId)
                return (
                  <li key={f.todo.id} className={`is-${f.state}`} style={coStyle(co)}>
                    <button className="isl-tick" onClick={() => resolve(f.todo.id)} aria-label={`Feito: ${f.todo.title}`} tabIndex={open ? 0 : -1}>
                      <Icon name="check" size={11} />
                    </button>
                    <span className="isl-ftext">
                      <b>{f.todo.title}</b>
                      <em>
                        {co?.name} · {f.when}
                      </em>
                    </span>
                    {/hora/i.test(f.todo.title) && (
                      <button
                        className="isl-mini"
                        tabIndex={open ? 0 : -1}
                        onClick={() => {
                          setOpen(false)
                          if (route !== 'work') navigate('work')
                          setTimeout(() => openDialog({ kind: 'hours', range: 'day' }), route === 'work' ? 0 : 380)
                        }}
                      >
                        Gerar horas de hoje
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {route !== 'work' && (
              <button
                className="isl-link"
                tabIndex={open ? 0 : -1}
                onClick={() => {
                  setOpen(false)
                  navigate('work')
                }}
              >
                Abrir a Workstation
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
