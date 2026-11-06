import { useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { addDays } from '../../shared/dates'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import { checklistFor, civilOf, dueLabel, dueState, label, pendingChecks, shortDay, type Scope } from './logic'
import { openItem, reorderColumn, requestMove, resume, setFocus, useWork } from './store'
import { NEXT_ACTION, STAGES, STAGE_LABEL, type Company, type Stage, type WorkItem, type WorkState } from './types'

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useFlip(root: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const last = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const next = new Map<string, DOMRect>()
    const nodes = el.querySelectorAll<HTMLElement>('[data-card]')
    nodes.forEach((n) => next.set(n.dataset.card!, n.getBoundingClientRect()))
    if (!reduced()) {
      nodes.forEach((n) => {
        const id = n.dataset.card!
        const a = last.current.get(id)
        const b = next.get(id)!
        if (!a) return
        const dx = a.left - b.left
        const dy = a.top - b.top
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
        n.style.transition = 'none'
        n.style.transform = `translate(${dx}px, ${dy}px)`
        requestAnimationFrame(() => {
          n.style.transition = 'transform 380ms var(--ease-out)'
          n.style.transform = ''
        })
      })
    }
    last.current = next
  }, deps)
}

export function Board({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
  const { celebrate } = useWork()
  const [dragId, setDragId] = useState<string | null>(null)
  const [hint, setHint] = useState<{ stage: Stage; index: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const companies = useMemo(() => new Map(state.companies.map((c) => [c.id, c])), [state.companies])
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

  const cols = useMemo(() => {
    const mine = state.items.filter((i) => scope === 'all' || i.companyId === scope)
    const since = addDays(today, -7)
    return STAGES.map((s) => {
      let list = mine.filter((i) => i.stage === s)
      if (s === 'done') list = list.filter((i) => i.doneAt && civilOf(i.doneAt) >= since).sort((a, b) => b.doneAt!.localeCompare(a.doneAt!))
      else list = list.sort((a, b) => Number(!!b.focusedAt) - Number(!!a.focusedAt) || a.sort - b.sort)
      return { stage: s, items: list }
    })
  }, [state.items, scope, today])

  useFlip(root, [cols])

  const indexAt = (e: DragEvent, colEl: HTMLElement) => {
    const cards = [...colEl.querySelectorAll<HTMLElement>('[data-card]')].filter((n) => n.dataset.card !== dragId)
    const y = e.clientY
    const i = cards.findIndex((n) => {
      const r = n.getBoundingClientRect()
      return y < r.top + r.height / 2
    })
    return i < 0 ? cards.length : i
  }

  const drop = (stage: Stage, index: number) => {
    const id = dragId
    setDragId(null)
    setHint(null)
    if (!id) return
    const it = state.items.find((i) => i.id === id)
    if (!it) return
    if (it.stage === stage) {
      const col = cols.find((c) => c.stage === stage)!.items.map((i) => i.id).filter((x) => x !== id)
      col.splice(index, 0, id)
      void reorderColumn(col)
    } else requestMove(id, stage)
  }

  const wip = state.settings.wipLimit
  return (
    <div className="wk-board" ref={root} aria-label="Quadro por estágio">
      {cols.map((c, ci) => {
        const over = hint?.stage === c.stage
        const tooMany = c.stage === 'doing' && c.items.length > wip
        return (
          <section
            key={c.stage}
            id={`wk-col-${c.stage}`}
            className={`wk-col is-${c.stage} ${over ? 'is-over' : ''} ${tooMany ? 'is-wip' : ''}`}
            style={{ ['--i' as string]: ci }}
            aria-label={STAGE_LABEL[c.stage]}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const index = indexAt(e, e.currentTarget)
              if (hint?.stage !== c.stage || hint.index !== index) setHint({ stage: c.stage, index })
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint((h) => (h?.stage === c.stage ? null : h))
            }}
            onDrop={(e) => {
              e.preventDefault()
              drop(c.stage, hint?.stage === c.stage ? hint.index : c.items.length)
            }}
          >
            <header className="wk-col-head">
              <span className="wk-col-dot" aria-hidden="true" />
              <h3>{STAGE_LABEL[c.stage]}</h3>
              <span className={`wk-col-n ${tooMany ? 'is-warn' : ''}`} title={c.stage === 'doing' ? `limite ${wip}` : undefined}>
                {c.items.length}
                {c.stage === 'doing' && <span className="wk-col-lim">/{wip}</span>}
              </span>
            </header>
            <div className="wk-col-body">
              {c.items.map((it, i) => (
                <div key={it.id} className="wk-slot">
                  {over && hint!.index === i && <span className="wk-drop-line" aria-hidden="true" />}
                  <Card
                    item={it}
                    company={companies.get(it.companyId)}
                    today={today}
                    note={notes.get(it.id)}
                    attachments={atts.get(it.id) ?? 0}
                    pending={pendingChecks(it, state.checklist).length}
                    totalChecks={it.kind === 'pendencia' ? 0 : checklistFor(it.companyId, state.checklist).length}
                    celebrating={celebrate?.itemId === it.id}
                    dragging={dragId === it.id}
                    onDragStart={() => setDragId(it.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setHint(null)
                    }}
                  />
                </div>
              ))}
              {over && hint!.index >= c.items.length && <span className="wk-drop-line" aria-hidden="true" />}
              {c.items.length === 0 && !over && (
                <p className="wk-col-empty">{c.stage === 'done' ? 'Concluídos dos últimos 7 dias' : c.stage === 'todo' ? 'Escreva acima para criar' : 'Arraste para cá'}</p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Card({ item, company, today, note, attachments, pending, totalChecks, celebrating, dragging, onDragStart, onDragEnd }: {
  item: WorkItem
  company?: Company
  today: string
  note?: { n: number; last: string }
  attachments: number
  pending: number
  totalChecks: number
  celebrating: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const due = dueState(item, today)
  const next = NEXT_ACTION[item.stage]
  const post = item.stage === 'delivered' || item.stage === 'tested' || item.stage === 'validated'
  return (
    <article
      data-card={item.id}
      className={`wk-card ${dragging ? 'is-dragging' : ''} ${celebrating ? 'is-celebrating' : ''} ${item.focusedAt ? 'is-focus' : ''} ${item.returnOpen ? 'is-returned' : ''} ${item.stage === 'done' ? 'is-done' : ''} ${due === 'late' ? 'is-late' : ''}`}
      style={coStyle(company)}
      role="button"
      tabIndex={0}
      aria-label={`${label(item)}, ${STAGE_LABEL[item.stage]}`}
      onClick={() => openItem(item.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openItem(item.id)
        }
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', item.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <div className="wk-card-top">
        <CompanyMark company={company} size={14} />
        {item.ticket ? <span className="wk-ticket">{item.ticket}</span> : <span className="wk-kind">{item.kind === 'pendencia' ? 'pendência' : item.kind}</span>}
        {item.priority !== 'normal' && <span className={`wk-prio is-${item.priority}`} title={item.priority === 'urgente' ? 'Urgente' : 'Alta'} />}
        {item.focusedAt && (
          <span className="wk-focus-badge" title="Precisa de foco">
            <Icon name="pin" size={11} />
            foco
          </span>
        )}
      </div>
      <h4 className="wk-card-title">{item.title}</h4>
      {note && item.stage !== 'done' && <p className="wk-card-note">{note.last}</p>}
      <div className="wk-card-meta">
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
        {due && item.dueDate && (
          <span className={`wk-chip is-due-${due}`}>
            <Icon name="cal" size={10} />
            {due === 'late' ? `atrasado · ${dueLabel(item.dueDate, today)}` : dueLabel(item.dueDate, today)}
          </span>
        )}
        {item.stage === 'doing' && totalChecks > 0 && (
          <span className={`wk-chip ${pending ? 'is-quiet' : 'is-ok'}`} title="Checklist antes de entregar">
            <Icon name="check" size={10} />
            {totalChecks - pending}/{totalChecks}
          </span>
        )}
        {post && item.deliveredAt && <span className="wk-chip is-quiet">entregue {shortDay(item.deliveredAt, today)}</span>}
        {item.stage === 'done' && item.doneAt && <span className="wk-chip is-ok">concluído {shortDay(item.doneAt, today)}</span>}
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
      <div className="wk-card-acts" onClick={(e) => e.stopPropagation()}>
        {item.returnOpen ? (
          <button className="wk-card-act" onClick={() => void resume(item.id)}>
            Retomei
          </button>
        ) : (
          next && (
            <button className="wk-card-act" onClick={() => requestMove(item.id, next.to)} title={`Mover para ${STAGE_LABEL[next.to]}`}>
              {next.label}
              <Icon name="arrow" size={11} />
            </button>
          )
        )}
        {item.stage !== 'done' && (
          <button className={`wk-card-pin ${item.focusedAt ? 'is-on' : ''}`} onClick={() => void setFocus(item.id, !item.focusedAt)} aria-label={item.focusedAt ? 'Tirar do foco' : 'Pôr no foco'} aria-pressed={!!item.focusedAt}>
            <Icon name="pin" size={12} />
          </button>
        )}
      </div>
      {celebrating && (
        <span className="wk-burst" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28">
            <circle cx="12" cy="12" r="10.5" />
            <path d="M7 12.4l3.3 3.3L17.2 8.6" />
          </svg>
        </span>
      )}
    </article>
  )
}
