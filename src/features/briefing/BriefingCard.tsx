import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openExternal } from '../../shared/openExternal'
import { areaCounts, estimateSeconds } from './assemble.ts'
import { direction, fmtChange, fmtValue } from './market.ts'
import { ensureToday, prepare, useBriefing, vote, type BriefState } from './store.ts'
import { AREA_LABEL, type Area, type BriefItem, type Edition } from './types.ts'
import {
  AreaDot, IconCards, IconCheck, IconExternal, IconMore, IconRedo, IconStar, IconUser,
  useOutside, Wave,
} from './ui.tsx'
import './briefing.css'

const Presentation = lazy(() => import('./Presentation.tsx'))
const Triage = lazy(() => import('./Triage.tsx'))
const ProfileSheet = lazy(() => import('./ProfileSheet.tsx'))

type Overlay = { kind: 'show'; listen: boolean; startKey?: string } | { kind: 'triage' } | { kind: 'profile' } | { kind: 'left' } | null

const SHORT_DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function BriefingCard() {
  const st = useBriefing()
  const [overlay, setOverlay] = useState<Overlay>(null)
  useEffect(() => {
    void ensureToday()
  }, [])
  useEffect(() => {
    const onFocus = () => void ensureToday()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const busy = st.phase === 'checking' || st.phase === 'waiting' || st.phase === 'collecting' || st.phase === 'judging' || st.phase === 'assembling'
  const edition = st.edition
  const showPreparing = busy && (st.phase !== 'checking' || !edition)

  return (
    <>
      <section className={`panel brf-card reveal ${showPreparing ? 'is-preparing' : ''}`} style={{ ['--i' as string]: 2 }} aria-label="Briefing do dia" aria-busy={busy}>
        {showPreparing ? (
          <Preparing st={st} />
        ) : st.phase === 'error' || !edition ? (
          <Failed message={st.error} />
        ) : (
          <Ready edition={edition} st={st} open={setOverlay} />
        )}
      </section>
      {overlay &&
        edition &&
        createPortal(
          <Suspense fallback={<div className="brf-overlay-loading" />}>
            {overlay.kind === 'show' && (
              <Presentation edition={edition} listen={overlay.listen} startKey={overlay.startKey} onClose={() => setOverlay(null)} onTriage={() => setOverlay({ kind: 'triage' })} />
            )}
            {overlay.kind === 'triage' && <Triage edition={edition} onClose={() => setOverlay(null)} onProfile={() => setOverlay({ kind: 'profile' })} />}
            {overlay.kind === 'profile' && <ProfileSheet onClose={() => setOverlay(null)} />}
            {overlay.kind === 'left' && <LeftSheet edition={edition} st={st} onClose={() => setOverlay(null)} onTriage={() => setOverlay({ kind: 'triage' })} />}
          </Suspense>,
          document.body,
        )}
    </>
  )
}

const STEPS = ['Buscando notícias', 'O juiz está lendo', 'Montando']

function useTick(ms: number, on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms, on])
}

function Preparing({ st }: { st: BriefState }) {
  const p = st.progress
  useTick(500, true)
  const step = st.phase === 'judging' ? 1 : st.phase === 'assembling' ? 2 : 0
  const fetchFrac = p.total ? p.done / p.total : 0
  const judgeFrac = p.judgeStartedAt ? Math.min(0.97, (Date.now() - p.judgeStartedAt) / p.judgeExpectedMs) : 0
  const frac = step === 0 ? fetchFrac * 0.45 : step === 1 ? 0.45 + judgeFrac * 0.47 : 0.96
  const elapsed = Math.round((Date.now() - p.startedAt) / 1000)
  const detail =
    st.phase === 'waiting'
      ? 'Já está sendo preparado em outra janela…'
      : st.phase === 'checking'
        ? 'Conferindo o de hoje…'
        : step === 0
          ? p.total
            ? `${p.done} de ${p.total} fontes${p.current ? ` · ${p.current}` : ''}`
            : 'Separando as fontes…'
          : step === 1
            ? `${p.current} · uns ${Math.max(5, Math.round((p.judgeExpectedMs - (Date.now() - (p.judgeStartedAt ?? Date.now()))) / 1000))} s`
            : 'Ordenando as telas e a narração…'
  return (
    <div className="brf-prep">
      <Wave size="lg" live />
      <div className="brf-prep-body">
        <div className="kicker">Briefing do dia</div>
        <h2 className="brf-card-title display">Preparando seu briefing…</h2>
        <ol className="brf-steps" aria-label="Etapas">
          {STEPS.map((label, i) => (
            <li key={label} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
              <span className="brf-step-mark">{i < step ? <IconCheck /> : <i />}</span>
              {label}
            </li>
          ))}
        </ol>
        <div className="brf-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
          <span style={{ transform: `scaleX(${Math.max(0.02, frac)})` }} />
        </div>
        <p className="brf-prep-detail">
          <span>{detail}</span>
          <span className="brf-muted">{elapsed > 2 ? `${elapsed} s` : ''}</span>
        </p>
      </div>
    </div>
  )
}

function Failed({ message }: { message: string | null }) {
  const [trying, setTrying] = useState(false)
  return (
    <div className="brf-failed">
      <Wave size="lg" />
      <div>
        <div className="kicker">Briefing do dia</div>
        <h2 className="brf-card-title display">Não deu para preparar o briefing</h2>
        <p className="brf-muted">{message ?? 'Algo deu errado no preparo.'}</p>
      </div>
      <button
        className="btn primary"
        disabled={trying}
        onClick={() => {
          setTrying(true)
          void prepare(false).finally(() => setTrying(false))
        }}
      >
        <IconRedo /> Tentar de novo
      </button>
    </div>
  )
}

const GLYPH: Record<Area, string> = {
  dinheiro: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 1.6 2.6 4.5 3.2 4.5 1.6 4.5 3.3-2 3-4.5 3-4.5-1.3-4.5-3',
  codigo: 'M8.5 7 4 12l4.5 5M15.5 7 20 12l-4.5 5M13.5 5l-3 14',
  ia: 'M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5zM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z',
  potencializa: 'M13 3 5.5 13.5H11l-1 7.5 7.5-10.5H12z',
  seguranca: 'M12 3.5 5 6.2v5.3c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6.2zM9 12l2.2 2.2L15.5 10',
  mundo: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z',
}

function Glyph({ area }: { area: Area }) {
  return (
    <svg className="bx-glyph" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d={GLYPH[area]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Ready({ edition, st, open }: { edition: Edition; st: BriefState; open: (o: Overlay) => void }) {
  const [menu, setMenu] = useState(false)
  const [active, setActive] = useState(-1)
  const [edges, setEdges] = useState({ start: true, end: false })
  const menuRef = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  useOutside(menu, () => setMenu(false), menuRef)
  const wpm = st.profile?.voice.rate ?? 185
  const minutes = Math.max(1, Math.round(estimateSeconds(edition, wpm) / 60))
  const n = edition.items.length
  const counts = useMemo(() => areaCounts(edition.items), [edition])
  const date = new Date(`${edition.date}T12:00:00`)
  const interested = edition.leftOut.filter((i) => st.votes.get(i.key)?.signal === 'interest').length

  useEffect(() => {
    const el = rail.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft > max - 8 })
      const cards = [...el.querySelectorAll<HTMLElement>('[data-story]')]
      const mid = el.scrollLeft + el.clientWidth * 0.35
      let idx = -1
      cards.forEach((c, i) => {
        if (c.offsetLeft <= mid) idx = i
      })
      setActive(el.scrollLeft < 8 ? -1 : idx)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [edition])

  const page = (dir: 1 | -1) => {
    const el = rail.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }
  const goTo = (i: number) => {
    const el = rail.current
    const card = el?.querySelectorAll<HTMLElement>('[data-story]')[i]
    if (el && card) el.scrollTo({ left: card.offsetLeft - 20, behavior: 'smooth' })
  }

  return (
    <div className="bx">
      <header className="bx-head">
        <div className="bx-brand">
          <span className="bx-label">Briefing</span>
          <span className="bx-date">{SHORT_DAY.format(date).replace(/\./g, '')}</span>
          {edition.judge === 'fallback' && (
            <span className="brf-note" title={edition.judgeNote ? `Feito sem o juiz: ${edition.judgeNote}.` : 'Feito sem o juiz.'}>
              sem o juiz
            </span>
          )}
          {st.redoError && (
            <span className="brf-note is-warn" title={st.redoError}>
              não deu para refazer
            </span>
          )}
        </div>
        {n > 0 && (
          <div className="bx-segs" aria-hidden="true">
            {edition.items.map((it, i) => (
              <button key={it.key} tabIndex={-1} className={`bx-seg brf-a-${it.area} ${i <= active ? 'is-on' : ''}`} onClick={() => goTo(i)} />
            ))}
          </div>
        )}
        <button className="bx-play" onClick={() => open({ kind: 'show', listen: true })}>
          <Wave />
          Ouvir
          <span className="bx-play-min">{minutes} min</span>
        </button>
        <div className="brf-menu-wrap" ref={menuRef}>
          <button className="btn quiet brf-icon-btn" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} aria-label="Mais opções">
            <IconMore />
          </button>
          {menu && (
            <div className="brf-menu" role="menu">
              <button role="menuitem" onClick={() => (setMenu(false), open({ kind: 'triage' }))}>
                <IconCards /> Triagem rápida
              </button>
              <button role="menuitem" onClick={() => (setMenu(false), open({ kind: 'profile' }))}>
                <IconUser /> Meu perfil
              </button>
              <button role="menuitem" onClick={() => (setMenu(false), void prepare(true))}>
                <IconRedo /> Refazer o briefing de hoje
              </button>
              <div className="brf-menu-foot">
                {edition.judge === 'codex' ? `Juiz: Codex${edition.model ? ` (${edition.model})` : ''}` : `Sem o juiz${edition.judgeNote ? `: ${edition.judgeNote}` : ''}`}
                <br />
                {edition.stats.sourcesOk} de {edition.stats.sources} fontes · {edition.stats.entries} notícias lidas
              </div>
            </div>
          )}
        </div>
      </header>

      <div className={`bx-stage ${edges.start ? 'at-start' : ''} ${edges.end ? 'at-end' : ''}`}>
        <div className="bx-rail" ref={rail}>
          <article className="bx-cover">
            <div className="bx-cover-top">
              <span className="bx-cover-n display">{n}</span>
              <span className="bx-cover-t display">
                {n === 0 ? 'nada passou na peneira' : n === 1 ? 'coisa que importa' : 'coisas que importam'}
                <em> desde ontem</em>
              </span>
            </div>
            {n > 0 && (
              <ul className="bx-mix">
                {counts.map((c) => (
                  <li key={c.area} className={`brf-a-${c.area}`}>
                    <i style={{ flexGrow: c.count }} />
                  </li>
                ))}
              </ul>
            )}
            <div className="bx-mix-legend">
              {counts.map((c) => (
                <span key={c.area} className={`brf-a-${c.area}`}>
                  <b />
                  {AREA_LABEL[c.area]} {c.count}
                </span>
              ))}
            </div>
            {n > 0 && (
              <button className="bx-start" onClick={() => open({ kind: 'show', listen: false })}>
                Começar a apresentação
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </article>

          {edition.items.map((it, i) => (
            <button
              key={it.key}
              data-story
              className={`bx-story brf-a-${it.area} ${edition.focusKey === it.key ? 'is-focus' : ''}`}
              style={{ ['--i' as string]: i }}
              onClick={() => open({ kind: 'show', listen: false, startKey: it.key })}
            >
              <span className="bx-story-top">
                <span className="bx-story-i">{String(i + 1).padStart(2, '0')}</span>
                <span className="bx-story-area">{edition.focusKey === it.key ? 'Foco do dia' : AREA_LABEL[it.area]}</span>
                <Glyph area={it.area} />
              </span>
              <span className="bx-story-title display">{it.title}</span>
              {it.why && <span className="bx-story-why">{it.why}</span>}
              <span className="bx-story-src">
                {it.source}
                {it.outlets > 1 && <em> +{it.outlets - 1}</em>}
              </span>
            </button>
          ))}

          {edition.leftOut.length > 0 && (
            <button className="bx-end" onClick={() => open({ kind: 'left' })}>
              <span className="bx-end-n display">{edition.leftOut.length}</span>
              <span className="bx-end-t">ficaram de fora hoje</span>
              <span className="bx-end-sub">
                {interested > 0 ? (
                  <>
                    <IconStar on /> {interested} marcadas
                  </>
                ) : (
                  'Marque o que te interessa'
                )}
              </span>
            </button>
          )}
        </div>
        <button className="bx-nav is-prev" onClick={() => page(-1)} aria-label="Anteriores" tabIndex={edges.start ? -1 : 0}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="bx-nav is-next" onClick={() => page(1)} aria-label="Próximas" tabIndex={edges.end ? -1 : 0}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <footer className="bx-foot">
        <MarketStrip edition={edition} />
      </footer>
    </div>
  )
}

function LeftSheet({ edition, st, onClose, onTriage }: { edition: Edition; st: BriefState; onClose: () => void; onTriage: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="bx-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="bx-sheet" role="dialog" aria-modal="true" aria-label="O que ficou de fora">
        <LeftOut edition={edition} st={st} onTriage={onTriage} onClose={onClose} />
      </aside>
    </div>
  )
}

function MarketStrip({ edition }: { edition: Edition }) {
  if (!edition.market.length) return <div className="brf-ticker is-empty">Sem cotações hoje</div>
  const at = edition.marketAt ? TIME.format(new Date(edition.marketAt)) : null
  return (
    <div className="brf-ticker" title={at ? `Cotações das ${at}` : undefined}>
      {edition.market.map((q) => {
        const d = direction(q.changePct)
        return (
          <span key={q.id} className="brf-tick">
            <span className="brf-tick-label">{q.label}</span>
            <span className="brf-tick-value">{fmtValue(q)}</span>
            {q.changePct !== null && <span className={`brf-delta is-${d}`}>{fmtChange(q.changePct)}</span>}
          </span>
        )
      })}
      {at && <span className="brf-tick-at">às {at}</span>}
    </div>
  )
}

function LeftOut({ edition, st, onTriage, onClose }: { edition: Edition; st: BriefState; onTriage: () => void; onClose: () => void }) {
  return (
    <>
      <header className="brf-left-head">
        <div>
          <h3 className="display">O que ficou de fora</h3>
          <p className="brf-muted">Marque o que te interessa: é o sinal mais forte para os próximos dias.</p>
        </div>
        <button className="btn sm" onClick={onTriage}>
          <IconCards /> Triagem rápida
        </button>
        <button className="btn quiet brf-icon-btn" onClick={onClose} aria-label="Fechar">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <ul className="brf-left-list">
        {edition.leftOut.map((it) => (
          <LeftRow key={it.key} item={it} on={st.votes.get(it.key)?.signal === 'interest'} />
        ))}
      </ul>
    </>
  )
}

function LeftRow({ item, on }: { item: BriefItem; on: boolean }) {
  return (
    <li className={`brf-left-row ${on ? 'is-on' : ''}`}>
      <AreaDot area={item.area} />
      <div className="brf-left-text">
        <span className="brf-left-title">{item.title}</span>
        <span className="brf-left-meta">
          {AREA_LABEL[item.area]} · {item.source}
          {item.reason ? ` · ${item.reason}` : ''}
        </span>
      </div>
      <button className={`brf-interest ${on ? 'is-on' : ''}`} onClick={() => void vote(item, 'interest', 'left_out', null, false)} aria-pressed={on}>
        <IconStar on={on} /> {on ? 'te interessa' : 'isso me interessa'}
      </button>
      <button className="brf-icon-link" onClick={() => void openExternal(item.url)} title="Abrir o original" aria-label={`Abrir o original de ${item.title}`}>
        <IconExternal />
      </button>
    </li>
  )
}
