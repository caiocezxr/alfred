import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { openExternal } from '../../shared/openExternal'
import { briefingPlayer, type PlayerState } from './player.ts'
import { RateBriefing } from './Rate.tsx'
import type { BriefState } from './store.ts'
import { type Area, type BriefItem, type Edition } from './types.ts'
import { IconClose, IconExternal, IconLeft, IconRight, IconSpark, Interest, Wave } from './ui.tsx'

export type Kind = 'dev' | 'ferramentas' | 'dinheiro' | 'politica' | 'mundo' | 'seguranca'
export const KIND_OF: Record<Area, Kind> = { codigo: 'dev', ia: 'dev', potencializa: 'ferramentas', dinheiro: 'dinheiro', politica: 'politica', mundo: 'mundo', seguranca: 'seguranca' }
export const KIND_LABEL: Record<Kind, string> = {
  dev: 'Dev & IA',
  ferramentas: 'Ferramentas',
  dinheiro: 'Dinheiro & investimentos',
  politica: 'Política',
  mundo: 'Mundo',
  seguranca: 'Segurança',
}
const KIND_ORDER: Kind[] = ['dev', 'ferramentas', 'dinheiro', 'politica', 'mundo', 'seguranca']
const ACTION_KINDS = new Set<Kind>(['dev', 'ferramentas', 'dinheiro'])

export function ranked(e: Edition): BriefItem[] {
  const focus = e.items.find((i) => i.key === e.focusKey)
  const rest = e.items.filter((i) => i !== focus).sort((a, b) => b.rank - a.rank)
  return focus ? [focus, ...rest] : rest
}

const AGE = (iso: string | null) => {
  if (!iso) return ''
  const h = (Date.now() - Date.parse(iso)) / 36e5
  if (h < 1) return 'há menos de 1 h'
  if (h < 24) return `há ${Math.round(h)} h`
  const days = Math.round(h / 24)
  return days === 1 ? 'ontem' : `há ${days} dias`
}

export function kindCounts(items: BriefItem[]): { kind: Kind; n: number }[] {
  return KIND_ORDER.map((kind) => ({ kind, n: items.filter((i) => KIND_OF[i.area] === kind).length })).filter((x) => x.n > 0)
}

function Kicker({ item, n, lead }: { item: BriefItem; n: number; lead?: boolean }) {
  return (
    <span className={`bf-kick brf-a-${item.area}`}>
      <b className="bf-n">{String(n).padStart(2, '0')}</b>
      <i className="bf-dot" aria-hidden="true" />
      <span>{KIND_LABEL[KIND_OF[item.area]]}</span>
      {lead && <em>mais importante pra você hoje</em>}
    </span>
  )
}

function Todo({ item }: { item: BriefItem }) {
  if (!item.action) return null
  return (
    <p className={`bf-todo ${ACTION_KINDS.has(KIND_OF[item.area]) ? 'is-strong' : ''}`}>
      <span>O que fazer</span>
      {item.action}
    </p>
  )
}

type Props = { edition: Edition; st: BriefState; player: PlayerState; readingKey: string | null; onAir: boolean }

export function Front({ edition, st, player, readingKey, onAir }: Props) {
  const list = useMemo(() => ranked(edition), [edition])
  const [all, setAll] = useState(false)
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const lead = list[0]
  const next = list.slice(1, 6)
  const counts = useMemo(() => kindCounts(list), [list])

  useEffect(() => {
    if (!readingKey) return
    const i = list.findIndex((x) => x.key === readingKey)
    if (i >= 0) setSel(i)
  }, [readingKey, list])

  const focusRow = useCallback((i: number) => {
    const el = root.current?.querySelector<HTMLElement>(`[data-rank="${i}"]`)
    el?.focus({ preventScroll: false })
  }, [])

  const onKey = (e: ReactKeyboardEvent) => {
    if (open !== null || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
    const k = e.key.toLowerCase()
    if (k === 'j' || k === 'arrowdown') {
      const i = Math.min(list.length - 1, sel + 1)
      if (i > 5) setAll(true)
      setSel(i)
      requestAnimationFrame(() => focusRow(i))
      e.preventDefault()
    } else if (k === 'k' || k === 'arrowup') {
      const i = Math.max(0, sel - 1)
      setSel(i)
      requestAnimationFrame(() => focusRow(i))
      e.preventDefault()
    } else if (k === 'enter' && t.dataset.rank !== undefined) {
      setOpen(Number(t.dataset.rank))
      e.preventDefault()
    }
  }

  if (!lead) return <p className="bf-empty">Nada passou na peneira hoje. Dia tranquilo.</p>
  const chapterOf = (it: BriefItem) => edition.items.findIndex((x) => x.key === it.key) + 1
  const voted = (it: BriefItem) => st.votes.get(it.key)?.signal

  return (
    <div className="bf-body" ref={root} onKeyDown={onKey}>
      <div className="bf-front">
        <article
          className={`bf-lead ${readingKey === lead.key ? 'is-reading' : ''} ${voted(lead) === 'down' ? 'is-down' : ''}`}
          data-rank={0}
          tabIndex={0}
          onClick={() => setOpen(0)}
          onFocus={() => setSel(0)}
          aria-label={`Mais importante: ${lead.title}`}
        >
          <Kicker item={lead} n={1} lead />
          <h3 className="bf-lead-title display">{lead.title}</h3>
          {lead.summary && <p className="bf-lead-sum">{lead.summary}</p>}
          <p className="bf-why">
            <IconSpark /> <span>{lead.why}</span>
          </p>
          <Todo item={lead} />
          <div className="bf-lead-foot">
            <span className="bf-src">
              {readingKey === lead.key && <Wave live={player.status === 'playing'} />}
              {lead.source}
              {lead.publishedAt ? ` · ${AGE(lead.publishedAt)}` : ''}
            </span>
            <Interest item={lead} origin="slide" variant="row" />
          </div>
        </article>

        <ol className="bf-next" aria-label="As próximas mais importantes">
          {next.map((it, i) => (
            <li key={it.key}>
              <button
                className={`bf-row ${sel === i + 1 ? 'is-sel' : ''} ${readingKey === it.key ? 'is-reading' : ''} ${voted(it) === 'down' ? 'is-down' : ''}`}
                data-rank={i + 1}
                onClick={() => setOpen(i + 1)}
                onFocus={() => setSel(i + 1)}
              >
                <Kicker item={it} n={i + 2} />
                <span className="bf-row-title">{it.title}</span>
                <span className="bf-row-why">{it.action && ACTION_KINDS.has(KIND_OF[it.area]) ? `O que fazer: ${it.action}` : it.why}</span>
                {readingKey === it.key && (
                  <span className="bf-row-air">
                    <Wave live={player.status === 'playing'} /> tocando
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </div>

      {list.length > 6 && (
        <button className="bf-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Mostrar menos' : `Ver todas as ${list.length}`}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={all ? 'is-up' : ''}>
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {all && (
        <div className="bf-all">
          {KIND_ORDER.map((kind) => {
            const group = list.map((it, i) => ({ it, i })).filter((x) => KIND_OF[x.it.area] === kind)
            if (!group.length) return null
            return (
              <section key={kind} className="bf-group">
                <h4>
                  {KIND_LABEL[kind]} <em>{group.length}</em>
                </h4>
                <ul>
                  {group.map(({ it, i }) => (
                    <li key={it.key}>
                      <button className={`bf-item ${sel === i ? 'is-sel' : ''} ${readingKey === it.key ? 'is-reading' : ''}`} data-rank={i} onClick={() => setOpen(i)} onFocus={() => setSel(i)}>
                        <span className="bf-item-n">{String(i + 1).padStart(2, '0')}</span>
                        <span className="bf-item-body">
                          <span className="bf-item-title">{it.title}</span>
                          {it.summary && <span className="bf-item-sum">{it.summary}</span>}
                          {it.action && <span className="bf-item-todo">O que fazer: {it.action}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      <div className="bf-mix" aria-label="Tipos de hoje">
        {counts.map((c) => (
          <span key={c.kind}>
            <b>{c.n}</b> {KIND_LABEL[c.kind]}
          </span>
        ))}
      </div>

      <RateBriefing edition={edition} variant="card" />

      {open !== null &&
        createPortal(
          <ReadSheet
            list={list}
            index={open}
            edition={edition}
            onAir={onAir}
            readingKey={readingKey}
            onMove={(i) => {
              setOpen(i)
              setSel(i)
            }}
            onListen={(it) => {
              if (onAir) briefingPlayer.seek(chapterOf(it))
              else briefingPlayer.play(edition, { chapter: chapterOf(it), voice: st.profile?.voice.voice ?? 'pf_dora' })
            }}
            onClose={() => {
              setOpen(null)
              requestAnimationFrame(() => focusRow(sel))
            }}
          />,
          document.body,
        )}
    </div>
  )
}

type SheetProps = {
  list: BriefItem[]
  index: number
  edition: Edition
  onAir: boolean
  readingKey: string | null
  onMove: (i: number) => void
  onListen: (it: BriefItem) => void
  onClose: () => void
}

function ReadSheet({ list, index, edition, onAir, readingKey, onMove, onListen, onClose }: SheetProps) {
  const it = list[index]
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    box.current?.focus()
  }, [index])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const key = e.key.toLowerCase()
      let handled = true
      if (key === 'escape') onClose()
      else if (key === 'j' || key === 'arrowdown' || key === 'arrowright') onMove(Math.min(list.length - 1, index + 1))
      else if (key === 'k' || key === 'arrowup' || key === 'arrowleft') onMove(Math.max(0, index - 1))
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [index, list.length, onClose, onMove])
  if (!it) return null
  const reading = readingKey === it.key
  return (
    <div className="bf-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="bf-sheet" role="dialog" aria-modal="true" aria-label={it.title} tabIndex={-1} ref={box}>
        <header className="bf-sheet-head">
          <Kicker item={it} n={index + 1} lead={index === 0} />
          <div className="bf-sheet-nav">
            <button className="bf-icon" onClick={() => onMove(Math.max(0, index - 1))} disabled={index === 0} aria-label="Anterior (K)">
              <IconLeft />
            </button>
            <span>
              {index + 1} de {list.length}
            </span>
            <button className="bf-icon" onClick={() => onMove(Math.min(list.length - 1, index + 1))} disabled={index === list.length - 1} aria-label="Próxima (J)">
              <IconRight />
            </button>
            <button className="bf-icon" onClick={onClose} aria-label="Fechar (Esc)">
              <IconClose />
            </button>
          </div>
        </header>
        <div className="bf-sheet-body" key={it.key}>
          <h2 className="bf-sheet-title display">{it.title}</h2>
          {it.summary && <p className="bf-sheet-sum">{it.summary}</p>}
          <p className="bf-why">
            <IconSpark /> <span>{it.why}</span>
          </p>
          <Todo item={it} />
          <div className="bf-sheet-src">
            <button className="bf-link" onClick={() => void openExternal(it.url)}>
              Ler no {it.source} <IconExternal />
            </button>
            {it.publishedAt && <span>{AGE(it.publishedAt)}</span>}
            {it.otherSources.length > 0 && <span>também em {it.otherSources.slice(0, 3).join(', ')}</span>}
          </div>
          <div className="bf-sheet-acts">
            <Interest item={it} origin="slide" variant="slide" />
            <button className="bf-listen" onClick={() => onListen(it)} disabled={reading && onAir}>
              <Wave live={reading && onAir} /> {reading && onAir ? 'Tocando agora' : 'Ouvir esta'}
            </button>
          </div>
          <p className="bf-sheet-hint">J e K para navegar · Esc para fechar</p>
          <p className="bf-sheet-date">Briefing de {new Date(`${edition.date}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}</p>
        </div>
      </aside>
    </div>
  )
}
