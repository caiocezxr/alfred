import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import { boardColumns, checklistFor, crossesDelivery, dueLabel, dueState, fmtDur, isPost, itemTimeMs, label, parseCapture, pendingChecks, shortDay, slaFor, ticketUrl, type Scope, type Sla } from './logic'
import { Roll } from './Roll'
import './board.css'
import { openInSessao } from '../oficina/bridge'
import { liveOf, loadMesas, useOficina, type Mesa } from '../oficina/store'
import { CHECK_SHORT, checkOf, linkPr, livePrs, openPr, prOpen, useBoards, useGhSettings, type LivePr } from './github/api'
import {
  createItem, doMove, openDialog, openItemFrom, openTicket, readUi, reorderColumn, requestMove, resume, select, setFocus, toggleTimer, useWork, writeUi,
} from './store'
import { NEXT_ACTION, STAGE_LABEL, type Company, type Stage, type WorkItem, type WorkState } from './types'

const TRAIL: Stage[] = ['todo', 'doing', 'delivered', 'tested', 'validated']

const EMPTY: Record<Stage, string> = {
  todo: 'Fila limpa. Capture com / ou cole o link de um chamado.',
  doing: 'Nada em andamento. Selecione um cartão e aperte E.',
  delivered: 'Nada esperando teste.',
  tested: 'Nada esperando validação.',
  validated: 'Nada para fechar.',
  done: 'Concluídos da semana aparecem aqui.',
}

const SLA_LABEL = (s: Sla) =>
  s.status === 'paused' ? 'SLA pausado' : s.status === 'breach' ? `SLA estourou ${fmtDur(-s.remainingMs)}` : `${s.phase === 'response' ? 'resposta' : 'SLA'} ${fmtDur(s.remainingMs)}`

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useFlip(root: React.RefObject<HTMLElement | null>, key: unknown) {
  const last = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const next = new Map<string, DOMRect>()
    const nodes = el.querySelectorAll<HTMLElement>('[data-flip]')
    nodes.forEach((n) => next.set(n.dataset.flip!, n.getBoundingClientRect()))
    if (!reduced()) {
      nodes.forEach((n) => {
        const a = last.current.get(n.dataset.flip!)
        const b = next.get(n.dataset.flip!)!
        if (!a) return
        const dx = a.left - b.left
        const dy = a.top - b.top
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
        n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 420, easing: 'cubic-bezier(.2, 1, .3, 1)' })
      })
    }
    last.current = next
  }, [key])
}

type Drag = {
  id: string
  el: HTMLElement
  sx: number
  sy: number
  ox: number
  oy: number
  w: number
  h: number
  tx: number
  ty: number
  x: number
  y: number
  vx: number
  rot: number
  started: boolean
  ghost: HTMLElement | null
  raf: number
  from: Stage
  landing: boolean
  off: () => void
}

export function Board({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
  const { celebrate, selectedId } = useWork()
  const [dragId, setDragId] = useState<string | null>(null)
  const [hint, setHint] = useState<{ stage: Stage; index: number } | null>(null)
  const [slimDone, setSlimDone] = useState(() => readUi().slimDone ?? true)
  const [landed, setLanded] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const hintRef = useRef(hint)
  hintRef.current = hint
  const suppress = useRef(0)
  const latest = useRef<{ cols: ReturnType<typeof boardColumns>; state: WorkState }>({ cols: [], state })
  const companies = useMemo(() => new Map(state.companies.map((c) => [c.id, c])), [state.companies])
  const ghs = useGhSettings()
  const logins = state.companies.filter((c) => scope === 'all' || c.id === scope).map((c) => ghs.stations[c.id]).filter((l): l is string => !!l)
  const boards = useBoards(logins)
  const { mesas } = useOficina()
  useEffect(() => {
    void loadMesas()
  }, [])
  const deskByItem = useMemo(() => new Map(mesas.filter((m) => m.itemId).map((m) => [m.itemId!, m])), [mesas])
  const prsByCo = useMemo(() => {
    const m = new Map<string, LivePr[]>()
    for (const c of state.companies) {
      const l = ghs.stations[c.id]
      if (!l) continue
      m.set(c.id, livePrs(boards.filter((b) => b.login === l)))
    }
    return m
  }, [boards, ghs.stations, state.companies])
  const notes = useMemo(() => {
    const m = new Map<string, { n: number; last: string }>()
    for (const e of state.events) if (e.kind === 'note') m.set(e.itemId, { n: (m.get(e.itemId)?.n ?? 0) + 1, last: e.note })
    return m
  }, [state.events])
  const atts = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of state.attachments) m.set(a.itemId, (m.get(a.itemId) ?? 0) + 1)
    return m
  }, [state.attachments])
  const running = state.sessions.find((s) => !s.endedAt)?.itemId ?? null
  const cols = useMemo(() => boardColumns(state.items, scope, today), [state.items, scope, today])
  latest.current = { cols, state }
  const layoutKey = useMemo(() => JSON.stringify([cols.map((c) => c.items.map((i) => i.id)), dragId, hint, slimDone]), [cols, dragId, hint, slimDone])
  useFlip(root, layoutKey)

  useEffect(() => {
    if (!selectedId) return
    root.current?.querySelector<HTMLElement>(`[data-card="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
  }, [selectedId])

  const computeHint = (x: number, y: number, d: Drag) => {
    const colEls = [...(root.current?.querySelectorAll<HTMLElement>('[data-col]') ?? [])]
    let col = colEls.find((c) => {
      const r = c.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top - 40 && y <= r.bottom + 40
    })
    if (!col) {
      col = colEls.reduce<HTMLElement | undefined>((best, c) => {
        const r = c.getBoundingClientRect()
        const dist = Math.abs(x - (r.left + r.width / 2))
        if (!best) return c
        const br = best.getBoundingClientRect()
        return dist < Math.abs(x - (br.left + br.width / 2)) ? c : best
      }, undefined)
    }
    if (!col) return null
    const stage = col.dataset.col as Stage
    const cards = [...col.querySelectorAll<HTMLElement>('[data-card]')].filter((n) => n.dataset.card !== d.id)
    let index = cards.findIndex((n) => {
      const r = n.getBoundingClientRect()
      return y < r.top + r.height / 2
    })
    if (index < 0) index = cards.length
    return { stage, index }
  }

  const loop = () => {
    const d = drag.current
    if (!d || !d.ghost) return
    const k = d.landing ? 0 : 0.42
    if (!d.landing) {
      const px = d.x
      d.x += (d.tx - d.x) * k
      d.y += (d.ty - d.y) * k
      d.vx = d.vx * 0.7 + (d.x - px) * 0.3
      const target = Math.max(-11, Math.min(11, d.vx * 0.9))
      d.rot += (target - d.rot) * 0.22
      d.ghost.style.transform = `translate3d(${d.x}px, ${d.y}px, 0) rotate(${d.rot}deg) scale(1.045)`
      const board = root.current
      if (board) {
        const r = board.getBoundingClientRect()
        const px2 = d.tx + d.ox
        if (px2 < r.left + 70) board.scrollLeft -= 14
        else if (px2 > r.right - 70) board.scrollLeft += 14
        const body = document.elementFromPoint(px2, d.ty + d.oy)?.closest<HTMLElement>('.wk-col-body')
        if (body) {
          const br = body.getBoundingClientRect()
          const py = d.ty + d.oy
          if (py < br.top + 40) body.scrollTop -= 10
          else if (py > br.bottom - 40) body.scrollTop += 10
        }
      }
    }
    d.raf = requestAnimationFrame(loop)
  }

  const finish = (cancel: boolean) => {
    const d = drag.current
    if (!d) return
    d.off()
    const { cols, state } = latest.current
    if (!d.started) {
      drag.current = null
      return
    }
    suppress.current = Date.now()
    const h = hintRef.current
    const target = cancel || !h ? null : h
    const place = root.current?.querySelector<HTMLElement>('.wk-placeholder')
    const rect = place?.getBoundingClientRect()
    d.landing = true
    const ghost = d.ghost!
    const it = state.items.find((i) => i.id === d.id)
    const needsDialog = !!target && !!it && target.stage !== it.stage && ((isPost(it.stage) && !isPost(target.stage)) || (crossesDelivery(it.stage, target.stage) && pendingChecks(it, state.checklist).length > 0))
    const back = cancel || needsDialog || !target
    const to = back ? d.el.getBoundingClientRect() : rect
    if (to && !reduced()) {
      ghost.style.transition = 'transform 360ms cubic-bezier(.25, 1.45, .45, 1), box-shadow 360ms ease'
      ghost.style.transform = `translate3d(${to.left}px, ${to.top}px, 0) rotate(0deg) scale(1)`
      ghost.classList.add('is-landing')
    }
    const commit = async () => {
      if (!target || !it) return
      if (target.stage === it.stage) {
        const col = cols.find((c) => c.stage === target.stage)!.items.map((i) => i.id).filter((x) => x !== d.id)
        col.splice(target.index, 0, d.id)
        await reorderColumn(col)
      } else {
        const moved = await doMove(d.id, target.stage, false)
        if (moved && target.stage !== 'done') {
          const col = cols.find((c) => c.stage === target.stage)!.items.map((i) => i.id).filter((x) => x !== d.id)
          col.splice(target.index, 0, d.id)
          await reorderColumn(col)
        }
      }
    }
    if (!back) void commit()
    setTimeout(
      () => {
        cancelAnimationFrame(d.raf)
        ghost.remove()
        drag.current = null
        setDragId(null)
        setHint(null)
        if (!back) {
          setLanded(d.id)
          setTimeout(() => setLanded((x) => (x === d.id ? null : x)), 700)
        }
        if (needsDialog && target) requestMove(d.id, target.stage)
      },
      reduced() ? 0 : 340,
    )
  }

  function onMove(e: PointerEvent) {
    const d = drag.current
    if (!d) return
    if (!d.started) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return
      d.started = true
      const r = d.el.getBoundingClientRect()
      d.w = r.width
      d.h = r.height
      d.x = d.tx = r.left
      d.y = d.ty = r.top
      const ghost = document.createElement('div')
      ghost.className = 'wk-ghost'
      ghost.style.width = `${r.width}px`
      ghost.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`
      const clone = d.el.cloneNode(true) as HTMLElement
      clone.removeAttribute('data-card')
      clone.removeAttribute('data-flip')
      clone.classList.add('is-ghost')
      ghost.appendChild(clone)
      document.body.appendChild(ghost)
      d.ghost = ghost
      setDragId(d.id)
      const first = { stage: d.from, index: latest.current.cols.find((c) => c.stage === d.from)!.items.findIndex((i) => i.id === d.id) }
      hintRef.current = first
      setHint(first)
      d.raf = requestAnimationFrame(loop)
    }
    d.tx = e.clientX - d.ox
    d.ty = e.clientY - d.oy
    const h = computeHint(e.clientX, e.clientY, d)
    const cur = hintRef.current
    if (h && (!cur || cur.stage !== h.stage || cur.index !== h.index)) {
      hintRef.current = h
      setHint(h)
    }
  }
  const startDrag = (e: RPointerEvent<HTMLElement>, item: WorkItem) => {
    if (e.button !== 0 || drag.current) return
    if ((e.target as HTMLElement).closest('button, a, input')) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    drag.current = {
      id: item.id,
      el: e.currentTarget,
      sx: e.clientX,
      sy: e.clientY,
      ox: e.clientX - r.left,
      oy: e.clientY - r.top,
      w: r.width,
      h: r.height,
      tx: r.left,
      ty: r.top,
      x: r.left,
      y: r.top,
      vx: 0,
      rot: 0,
      started: false,
      ghost: null,
      raf: 0,
      from: item.stage,
      landing: false,
      off: () => {},
    }
    const move = (ev: PointerEvent) => onMove(ev)
    const up = () => finish(false)
    const cancel = () => finish(true)
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      finish(true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    drag.current.off = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
    }
  }

  useEffect(
    () => () => {
      const d = drag.current
      if (d?.ghost) d.ghost.remove()
      if (d) {
        cancelAnimationFrame(d.raf)
        d.off()
      }
    },
    [],
  )

  const spot = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current?.started) return
    const card = (e.target as HTMLElement).closest<HTMLElement>('.wk-card')
    if (!card) return
    const r = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${e.clientX - r.left}px`)
    card.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  const wip = state.settings.wipLimit
  const dragged = dragId ? state.items.find((i) => i.id === dragId) : null
  return (
    <div className={`wk-board ${dragId ? 'is-dragging' : ''} ${slimDone ? 'has-slim' : ''}`} ref={root} aria-label="Quadro por estágio" onPointerMove={spot}>
      {cols.map((c, ci) => {
        const over = hint?.stage === c.stage && !!dragId
        const list = c.items.filter((i) => i.id !== dragId)
        const tooMany = c.stage === 'doing' && c.items.length > wip
        const slim = c.stage === 'done' && slimDone
        const placeholder = over && dragged ? <div key="ph" className="wk-placeholder" data-flip="ph" style={{ height: drag.current?.h ?? 80 }} /> : null
        return (
          <section
            key={c.stage}
            id={`wk-col-${c.stage}`}
            data-col={c.stage}
            className={`wk-col is-${c.stage} ${over ? 'is-over' : ''} ${tooMany ? 'is-wip' : ''} ${slim ? 'is-slim' : ''}`}
            style={{ ['--i' as string]: ci }}
            aria-label={`${STAGE_LABEL[c.stage]}: ${c.items.length}`}
          >
            <header className="wk-col-head">
              <span className="wk-col-dot" aria-hidden="true" />
              <h3>{STAGE_LABEL[c.stage]}</h3>
              <span className={`wk-col-n ${tooMany ? 'is-warn' : ''}`} title={c.stage === 'doing' ? `limite ${wip}` : undefined}>
                <Roll value={c.items.length} />
              </span>
              {c.stage === 'doing' && (
                <span className="wk-col-slots" title={`${c.items.length} de ${wip} no limite`} aria-hidden="true">
                  {Array.from({ length: Math.max(wip, c.items.length) }, (_, i) => (
                    <i key={i} className={i < c.items.length ? (i >= wip ? 'is-over' : 'is-on') : ''} />
                  ))}
                </span>
              )}
              {c.stage === 'done' && (
                <button
                  className="wk-icon-btn wk-col-toggle"
                  onClick={() => {
                    setSlimDone(!slimDone)
                    writeUi({ slimDone: !slimDone })
                  }}
                  aria-label={slimDone ? 'Expandir concluídos' : 'Recolher concluídos'}
                  title={slimDone ? 'Expandir' : 'Recolher'}
                >
                  <Icon name={slimDone ? 'arrow' : 'x'} size={11} />
                </button>
              )}
            </header>
            {slim ? (
              <button className="wk-slim-body" onClick={() => setSlimDone(false)} aria-label={`${c.items.length} concluídos nos últimos 7 dias. Expandir`}>
                {placeholder}
                {list.slice(0, 14).map((i) => (
                  <span key={i.id} data-flip={i.id} data-card={i.id} className={`wk-slim-dot ${landed === i.id || celebrate?.itemId === i.id ? 'is-landed' : ''}`} style={coStyle(companies.get(i.companyId))} title={label(i)}>
                    <Icon name="check" size={9} />
                  </span>
                ))}
                {list.length > 14 && <span className="wk-slim-more">+{list.length - 14}</span>}
              </button>
            ) : (
              <div className="wk-col-body">
                {list.map((it, i) => [
                  over && hint!.index === i ? placeholder : null,
                  <Card
                    key={it.id}
                    item={it}
                    company={companies.get(it.companyId)}
                    today={today}
                    note={notes.get(it.id)}
                    attachments={atts.get(it.id) ?? 0}
                    pending={pendingChecks(it, state.checklist).length}
                    totalChecks={it.kind === 'pendencia' ? 0 : checklistFor(it.companyId, state.checklist).length}
                    celebrating={celebrate?.itemId === it.id}
                    landed={landed === it.id}
                    selected={selectedId === it.id}
                    live={running === it.id}
                    timeMs={itemTimeMs(state.sessions, it.id, Date.now())}
                    sla={companies.get(it.companyId) ? slaFor(it, state.events, companies.get(it.companyId)!, Date.now()) : null}
                    linked={!!ticketUrl(it, companies.get(it.companyId))}
                    pr={linkPr(it, prsByCo.get(it.companyId) ?? [])}
                    desk={deskByItem.get(it.id) ?? null}
                    onSessao={() => openInSessao(it, companies.get(it.companyId), linkPr(it, prsByCo.get(it.companyId) ?? []), ticketUrl(it, companies.get(it.companyId)))}
                    onPointerDown={(e) => startDrag(e, it)}
                    suppress={suppress}
                  />,
                ])}
                {over && hint!.index >= list.length && placeholder}
                {list.length === 0 && !over && <p className="wk-col-empty">{EMPTY[c.stage]}</p>}
                {(c.stage === 'todo' || c.stage === 'doing') && !dragId && <QuickAdd stage={c.stage} state={state} scope={scope} today={today} />}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function QuickAdd({ stage, state, scope, today }: { stage: 'todo' | 'doing'; state: WorkState; scope: Scope; today: string }) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState('')
  const ids = state.companies.map((c) => c.id)
  const last = readUi().lastCompany
  const fallback = scope !== 'all' ? scope : last && ids.includes(last) ? last : ids[0]
  const submit = async () => {
    const q = parseCapture(v, today, state.companies, fallback)
    if (!q.title && !q.ticket) return
    setV('')
    await createItem({ companyId: q.companyId, title: q.title || q.ticket || 'Chamado', ticket: q.ticket, priority: q.priority, dueDate: q.dueDate, kind: q.kind ?? undefined, system: q.system, url: q.url, stage })
  }
  if (!open)
    return (
      <button className="wk-quick-add" onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} />
        Adicionar
      </button>
    )
  return (
    <div className="wk-quick-in">
      <input
        autoFocus
        className="field"
        value={v}
        placeholder="Título, #código, @espaço…"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => !v && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setV('')
            setOpen(false)
          }
        }}
        aria-label={`Novo item em ${STAGE_LABEL[stage]}`}
      />
    </div>
  )
}

function Card({ item, company, today, note, attachments, pending, totalChecks, celebrating, landed, selected, live, timeMs, sla, linked, pr, desk, onSessao, onPointerDown, suppress }: {
  desk?: Mesa | null
  onSessao?: () => void
  item: WorkItem
  company?: Company
  today: string
  note?: { n: number; last: string }
  attachments: number
  pending: number
  totalChecks: number
  celebrating: boolean
  landed: boolean
  selected: boolean
  live: boolean
  timeMs: number
  sla: Sla | null
  linked: boolean
  pr: LivePr | null
  onPointerDown: (e: RPointerEvent<HTMLElement>) => void
  suppress: React.RefObject<number>
}) {
  const due = dueState(item, today)
  const next = NEXT_ACTION[item.stage]
  const post = isPost(item.stage)
  const open = (el: HTMLElement) => {
    if (Date.now() - suppress.current < 250) return
    select(item.id)
    openItemFrom(item.id, el)
  }
  return (
    <article
      data-card={item.id}
      data-flip={item.id}
      data-tilt
      className={`wk-card ${celebrating ? 'is-celebrating' : ''} ${landed ? 'is-landed' : ''} ${selected ? 'is-selected' : ''} ${live ? 'is-live' : ''} ${item.focusedAt ? 'is-focus' : ''} ${item.returnOpen ? 'is-returned' : ''} ${item.stage === 'done' ? 'is-done' : ''} ${due === 'late' ? 'is-late' : ''}`}
      style={coStyle(company)}
      role="button"
      tabIndex={0}
      aria-label={`${label(item)}, ${STAGE_LABEL[item.stage]}`}
      onPointerDown={onPointerDown}
      onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open(e.currentTarget)
        }
      }}
    >
      <div className="wk-card-top">
        <CompanyMark company={company} size={14} />
        {item.ticket ? (
          linked ? (
            <button
              className="wk-ticket is-link"
              onClick={(e) => {
                e.stopPropagation()
                openTicket(item.id)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="Abrir o chamado"
            >
              {item.ticket}
            </button>
          ) : (
            <span className="wk-ticket">{item.ticket}</span>
          )
        ) : (
          <span className="wk-kind">{item.kind === 'pendencia' ? 'pendência' : item.kind}</span>
        )}
        {item.priority !== 'normal' && <span className={`wk-prio is-${item.priority}`} title={item.priority === 'urgente' ? 'Urgente' : 'Alta'} />}
        <span className="wk-grow" />
        {due && item.dueDate && !live && !item.focusedAt && (
          <span className={`wk-card-due is-due-${due}`} title={`Prazo: ${dueLabel(item.dueDate, today)}`}>
            {due === 'late' ? `atrasado · ${dueLabel(item.dueDate, today)}` : dueLabel(item.dueDate, today)}
          </span>
        )}
        {live && (
          <span className="wk-live-badge" title="Cronômetro rodando">
            <i />
            agora
          </span>
        )}
        {item.focusedAt && !live && (
          <span className="wk-focus-badge" title="Precisa de foco">
            <Icon name="pin" size={10} />
            foco
          </span>
        )}
      </div>
      <h4 className="wk-card-title">{item.title}</h4>
      {pr && (
        <button
          className={`wk-prchip is-${(checkOf(pr.pr) ?? 'none').toLowerCase()} ${pr.review ? 'is-review' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            openPr(prOpen(pr))
          }}
          title={`${pr.pr.repository.nameWithOwner} #${pr.pr.number}: ${pr.pr.title}`}
        >
          <Icon name="link" size={10} />
          <b>PR #{pr.pr.number}</b>
          <i aria-hidden="true" />
          <span>{pr.review ? 'review pedida' : pr.pr.reviewDecision === 'APPROVED' ? 'aprovado' : checkOf(pr.pr) ? CHECK_SHORT[checkOf(pr.pr)!] : pr.pr.isDraft ? 'rascunho' : 'aberto'}</span>
        </button>
      )}
      {desk && (
        <button
          className={`wk-deskchip ${(['claude', 'codex', 'local'] as const).some((a) => ['thinking', 'writing', 'tool', 'waiting'].includes(liveOf(desk.id).agents[a].status)) ? 'is-live' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onSessao?.()
          }}
          title="Abrir a desk deste chamado na Sessão"
        >
          <i aria-hidden="true" />
          <b>desk</b>
          <span>{desk.title || 'Sessão'}</span>
        </button>
      )}
      {note && item.stage !== 'done' && <p className="wk-card-note">{note.last}</p>}
      <div className="wk-card-meta">
        {sla && (
          <span className={`wk-chip is-sla-${sla.status}`} title={sla.phase === 'response' ? 'Prazo de primeira resposta' : 'Prazo de resolução'}>
            <Icon name="alarm" size={10} />
            {SLA_LABEL(sla)}
          </span>
        )}
        {item.returnOpen ? (
          <span className="wk-chip is-warn">
            <Icon name="back" size={10} />
            voltou {item.returns}×
          </span>
        ) : (
          item.returns > 0 && <span className="wk-chip is-quiet">voltou {item.returns}×</span>
        )}
        {item.waitingOn && (
          <span className="wk-chip is-wait">
            <Icon name="pause" size={10} />
            {item.waitingOn}
          </span>
        )}
        {due && item.dueDate && (live || !!item.focusedAt) && (
          <span className={`wk-chip is-due-${due}`}>
            <Icon name="cal" size={10} />
            {due === 'late' ? `atrasado · ${dueLabel(item.dueDate, today)}` : dueLabel(item.dueDate, today)}
          </span>
        )}
        {item.stage === 'doing' && totalChecks > 0 && (
          <span className={`wk-chip ${pending ? 'is-quiet' : 'is-ok'}`} title="Checklist antes de entregar">
            <Icon name="shield" size={10} />
            {totalChecks - pending}/{totalChecks}
          </span>
        )}
        {post && item.stage !== 'done' && item.deliveredAt && <span className="wk-chip is-quiet">entregue {shortDay(item.deliveredAt, today)}</span>}
        {item.stage === 'done' && item.doneAt && <span className="wk-chip is-ok">concluído {shortDay(item.doneAt, today)}</span>}
        {timeMs >= 60000 && (
          <span className="wk-chip is-quiet" title="Tempo registrado">
            <Icon name="clock" size={10} />
            {fmtDur(timeMs)}
          </span>
        )}
        {!!note?.n && (
          <span className="wk-chip is-quiet" title={`${note.n} anotações`}>
            <Icon name="note" size={10} />
            {note.n}
          </span>
        )}
        {attachments > 0 && (
          <span className="wk-chip is-quiet" title={`${attachments} imagens`}>
            <Icon name="image" size={10} />
            {attachments}
          </span>
        )}
      </div>
      <div className="wk-card-trail" aria-hidden="true" title={STAGE_LABEL[item.stage]}>
        {TRAIL.map((st, i) => (
          <i key={st} className={i < TRAIL.indexOf(item.stage) || item.stage === 'done' ? 'is-past' : st === item.stage ? 'is-now' : ''} />
        ))}
      </div>
      {item.stage !== 'done' && (
        <div className="wk-card-acts" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {item.returnOpen ? (
            <button className="wk-card-act" onClick={() => void resume(item.id)}>
              Retomei
            </button>
          ) : (
            next && (
              <button className="wk-card-act" onClick={() => requestMove(item.id, next.to)} title={`Mover para ${STAGE_LABEL[next.to]} (E)`}>
                {next.label}
                <Icon name="arrow" size={11} />
              </button>
            )
          )}
          <span className="wk-grow" />
          <button className={`wk-card-ic ${live ? 'is-on' : ''}`} onClick={() => void toggleTimer(item.id)} aria-label={live ? 'Pausar cronômetro' : 'Começar cronômetro'} title={live ? 'Pausar (T)' : 'Começar (T)'}>
            <Icon name={live ? 'pause' : 'play'} size={11} />
          </button>
          {post && (
            <button className="wk-card-ic" onClick={() => openDialog({ kind: 'return', itemId: item.id })} aria-label="Voltou" title="Voltou (B)">
              <Icon name="back" size={11} />
            </button>
          )}
          <button className={`wk-card-ic ${item.focusedAt ? 'is-on' : ''}`} onClick={() => void setFocus(item.id, !item.focusedAt)} aria-label={item.focusedAt ? 'Tirar do foco' : 'Pôr no foco'} aria-pressed={!!item.focusedAt} title="Foco (F)">
            <Icon name="pin" size={11} />
          </button>
        </div>
      )}
      {(celebrating || landed) && (item.stage === 'validated' || item.stage === 'done') && (
        <span className="wk-burst" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <circle cx="12" cy="12" r="10.5" />
            <path d="M7 12.4l3.3 3.3L17.2 8.6" />
          </svg>
        </span>
      )}
    </article>
  )
}
