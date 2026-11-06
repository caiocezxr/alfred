import { isTauri } from '../../shared/db/api'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { onIntent } from '../../app/router'
import { fmtLong } from '../../shared/dates'
import { Segmented } from '../../shared/ui/Segmented'
import { AlertIcon, ArrowUpRight, BookmarkIcon, ChevronIcon, DismissIcon, RefreshIcon, SlidersIcon, WhyIcon, WifiOffIcon } from './icons.tsx'
import { parseError } from './normalize.ts'
import { HIGHLIGHT_MIN, LOW_RELEVANCE, fmtNum, isLow, itemTime, pickHighlights, scoreAll, type Scored } from './relevance.ts'
import { RadarSettings, type SettingsTab } from './Settings.tsx'
import {
  dismissItem, hideToast, lastUpdated, loadRadar, openItem, refreshAll, retrySource, toggleRead, toggleSaved, updateSource,
  useRadar, type RadarState, needsPt, ptExcerpt, ptTitle, translateItems,
} from './store.ts'
import { CATEGORY_LABEL, CATEGORY_SHORT, type FeedItem, type FeedSource, type ItemCategory } from './types.ts'
import './radar.css'

type View = 'all' | 'skills' | 'ai_dev' | 'ai_content' | 'stack' | 'saved'
type Cat = Exclude<ItemCategory, 'other'>
const CATS: Cat[] = ['ai_dev', 'ai_content', 'stack']
const VIEWS: View[] = ['all', 'skills', 'ai_dev', 'ai_content', 'stack', 'saved']

const UI_KEY = 'ps.radar.ui.v1'
type UiPrefs = { view?: View; lastVisit?: string }
function readUi(): UiPrefs {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as UiPrefs
  } catch {
    return {}
  }
}
function writeUi(patch: UiPrefs) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch }))
  } catch {
  }
}

const fmtDay = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
const fmtDayTime = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const clean = (s: string) => s.replace(/\./g, '')

function relTime(t: number, now: number): string {
  const m = Math.round((now - t) / 6e4)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  if (d <= 1) return 'ontem'
  if (d < 7) return `há ${d} dias`
  return clean(fmtDay.format(t))
}
const withVerb = (verb: string, rel: string) => (/^(há|agora|ontem)/.test(rel) ? `${verb} ${rel}` : `${verb} em ${rel}`)

function useFlip(root: RefObject<HTMLElement | null>, resetKey: unknown) {
  const pos = useRef(new Map<string, number>())
  const key = useRef(resetKey)
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const reset = key.current !== resetKey
    key.current = resetKey
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, number>()
    el.querySelectorAll<HTMLElement>('[data-flip]').forEach((n) => {
      const id = n.dataset.flip!
      const top = n.offsetTop
      next.set(id, top)
      const prev = pos.current.get(id)
      if (!reset && !reduced && prev !== undefined && Math.abs(prev - top) > 1) {
        n.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      }
    })
    pos.current = next
  })
}

export default function Radar() {
  const st = useRadar()
  const [session] = useState(() => {
    const ui = readUi()
    return {
      start: Date.now(),
      prevVisit: ui.lastVisit ? Date.parse(ui.lastVisit) : null,
      view: VIEWS.includes(ui.view as View) ? (ui.view as View) : ('all' as View),
    }
  })
  const [view, setViewState] = useState<View>(session.view)
  const [sheet, setSheet] = useState<SettingsTab | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [whyId, setWhyId] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const settingsBtn = useRef<HTMLButtonElement>(null)

  const setView = (v: View) => {
    setViewState(v)
    setWhyId(null)
    writeUi({ view: v })
  }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => onIntent((i) => i === 'refresh-radar' && void refreshAll()), [])
  useEffect(() => {
    const mark = () => writeUi({ lastVisit: new Date().toISOString() })
    const vis = () => document.visibilityState === 'hidden' && mark()
    document.addEventListener('visibilitychange', vis)
    return () => {
      mark()
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  const sourcesById = useMemo(() => new Map(st.sources.map((s) => [s.id, s])), [st.sources])
  const hidePending = isTauri && !st.translateError
  const items = useMemo(() => (hidePending ? st.items.filter((i) => !needsPt(i)) : st.items), [st.items, hidePending])
  const pending = st.items.length - items.length
  const scored = useMemo(() => scoreAll(items, sourcesById, st.keywords, st.stamp), [items, sourcesById, st.keywords, st.stamp])
  const model = useMemo(() => buildModel(items, scored, session), [items, scored, session])
  useEffect(() => {
    if (!st.loaded) return
    const all = scoreAll(st.items, sourcesById, st.keywords, st.stamp)
    const want = [...st.items]
      .filter(needsPt)
      .sort((a, b) => (all.get(b.id)?.score ?? 0) - (all.get(a.id)?.score ?? 0))
      .slice(0, 400)
      .map((i) => i.id)
    if (want.length) translateItems(want)
  }, [st.loaded, st.items, sourcesById, st.keywords, st.stamp])
  useFlip(body, view)

  const enabled = st.sources.filter((s) => s.enabled)
  const last = lastUpdated(st.sources)
  const isNew = (i: FeedItem) => isFresh(i, session.prevVisit)

  const ctx: RowCtx = {
    scored,
    sources: sourcesById,
    now,
    leaving: st.leaving,
    whyId,
    isNew,
    onWhy: (id) => setWhyId((w) => (w === id ? null : id)),
    onKeywords: () => setSheet('keywords'),
  }

  return (
    <section className="page radar">
      <header className="radar-head reveal" style={{ '--i': 0 } as CSSProperties}>
        <div>
          <div className="kicker">{fmtLong.format(new Date(now))}</div>
          <h1 className="display">Radar</h1>
          <p className="radar-sub" aria-live="polite">
            <StatusLine st={st} last={last} now={now} newCount={model.newCount} enabledCount={enabled.length} />
          </p>
        </div>
        <div className="radar-head-actions">
          <button className="btn radar-refresh" onClick={() => void refreshAll()} disabled={st.refreshing || !enabled.length} aria-busy={st.refreshing}>
            <RefreshIcon className={st.refreshing ? 'is-spinning' : undefined} />
            {st.refreshing ? 'Atualizando' : 'Atualizar'}
          </button>
          <button ref={settingsBtn} className="radar-icon-btn" onClick={() => setSheet('sources')} aria-label="Fontes e palavras-chave" title="Fontes e palavras-chave">
            <SlidersIcon />
          </button>
        </div>
      </header>

      <div className={`radar-progress ${st.refreshing ? 'is-on' : ''}`} aria-hidden="true">
        <span style={{ transform: `scaleX(${st.progress.total ? st.progress.done / st.progress.total : 0})` }} />
      </div>

      <div className="radar-toolbar reveal" style={{ '--i': 1 } as CSSProperties}>
        <Segmented
          label="Categoria"
          value={view}
          onChange={setView}
          options={[
            { id: 'all', label: 'Tudo' },
            { id: 'skills', label: 'Skills', count: skillsOf(items, sourcesById).fresh },
            { id: 'ai_dev', label: 'IA dev', count: model.fresh.ai_dev },
            { id: 'ai_content', label: 'IA conteúdo', count: model.fresh.ai_content },
            { id: 'stack', label: 'Stacks', count: model.fresh.stack },
            { id: 'saved', label: 'Salvos', count: model.saved.length },
          ]}
        />
        <SourceDots sources={enabled} st={st} now={now} onOpen={() => setSheet('sources')} />
      </div>

      <Issues st={st} enabled={enabled} />

      <div className="radar-body" ref={body} key={view}>
        {pending > 0 && (
          <div className="radar-pending" role="status">
            <i aria-hidden="true" />
            {pending} {pending === 1 ? 'notícia está' : 'notícias estão'} sendo traduzidas para o português e aparecem aqui assim que ficarem prontas.
          </div>
        )}
        <Body view={view} st={st} items={items} model={model} ctx={ctx} enabledCount={enabled.length} setView={setView} openSources={() => setSheet('sources')} />
      </div>

      {sheet && (
        <RadarSettings
          tab={sheet}
          onTab={setSheet}
          onClose={() => {
            setSheet(null)
            settingsBtn.current?.focus()
          }}
          st={st}
          now={now}
        />
      )}

      <ToastView st={st} />
    </section>
  )
}

function isFresh(i: FeedItem, prevVisit: number | null): boolean {
  return prevVisit !== null && Date.parse(i.fetchedAt) > prevVisit && itemTime(i) > prevVisit - 2 * 864e5
}

type Model = {
  highlights: FeedItem[]
  byCat: Record<Cat, FeedItem[]>
  low: FeedItem[]
  lowByCat: Record<Cat, FeedItem[]>
  saved: FeedItem[]
  fresh: Record<Cat, number>
  newCount: number
  unreadRelevant: number
}

function buildModel(items: FeedItem[], scored: Map<string, Scored>, session: { start: number; prevVisit: number | null }): Model {
  const sc = (i: FeedItem) => scored.get(i.id)!
  const byScore = (a: FeedItem, b: FeedItem) => sc(b).score - sc(a).score || itemTime(b) - itemTime(a)
  const readBefore = (i: FeedItem) => !!i.readAt && Date.parse(i.readAt) < session.start
  const highlights = pickHighlights(items, scored, (i) => !readBefore(i))
  const hl = new Set(highlights.map((i) => i.id))
  const byCat: Record<Cat, FeedItem[]> = { ai_dev: [], ai_content: [], stack: [] }
  const lowByCat: Record<Cat, FeedItem[]> = { ai_dev: [], ai_content: [], stack: [] }
  const low: FeedItem[] = []
  const fresh: Record<Cat, number> = { ai_dev: 0, ai_content: 0, stack: 0 }
  let newCount = 0
  let unreadRelevant = 0
  for (const i of items) {
    const s = sc(i)
    if (isLow(s)) {
      low.push(i)
      if (s.category !== 'other') lowByCat[s.category].push(i)
      continue
    }
    const c = s.category as Cat
    if (!i.readAt) unreadRelevant++
    if (!i.readAt && isFresh(i, session.prevVisit)) {
      fresh[c]++
      newCount++
    }
    if (!hl.has(i.id)) byCat[c].push(i)
  }
  for (const c of CATS) {
    byCat[c].sort(byScore)
    lowByCat[c].sort(byScore)
  }
  low.sort(byScore)
  const saved = items.filter((i) => i.savedAt).sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
  return { highlights, byCat, low, lowByCat, saved, fresh, newCount, unreadRelevant }
}

function StatusLine({ st, last, now, newCount, enabledCount }: { st: RadarState; last: number | null; now: number; newCount: number; enabledCount: number }) {
  if (!st.loaded) return <span className="radar-sub-muted">Abrindo o Radar…</span>
  if (st.refreshing) {
    return (
      <span>
        Buscando {st.progress.done} de {st.progress.total} {st.progress.total === 1 ? 'fonte' : 'fontes'}…
      </span>
    )
  }
  if (st.offline) {
    return (
      <span className="radar-offline">
        <WifiOffIcon />
        Sem conexão · {last ? `mostrando o que foi buscado em ${clean(fmtDayTime.format(last))}` : 'nada buscado ainda'}
      </span>
    )
  }
  if (!enabledCount) return <span>Nenhuma fonte ativa</span>
  return (
    <>
      <span>{last ? withVerb('Atualizado', relTime(last, now)) : 'Ainda não atualizado'}</span>
      {newCount > 0 && (
        <>
          <span className="radar-sub-sep" aria-hidden="true" />
          <span>
            {newCount} {newCount === 1 ? 'novidade' : 'novidades'} desde a última visita
          </span>
        </>
      )}
      {st.translating > 0 && (
        <>
          <span className="radar-sub-sep" aria-hidden="true" />
          <span className="radar-sub-muted">traduzindo {st.translating} para o português…</span>
        </>
      )}
      {st.translateError && (
        <>
          <span className="radar-sub-sep" aria-hidden="true" />
          <span className="radar-sub-muted">{st.translateError}</span>
        </>
      )}
    </>
  )
}

function SourceDots({ sources, st, now, onOpen }: { sources: FeedSource[]; st: RadarState; now: number; onOpen: () => void }) {
  if (!sources.length) return null
  return (
    <div className="radar-dots-wrap">
      <ul className="radar-dots" aria-label="Estado das fontes">
        {sources.map((s) => {
          const run = st.runs[s.id]
          const state = run?.state ?? (s.lastStatus === 'error' ? 'error' : s.lastStatus === 'ok' ? 'ok' : 'idle')
          const label =
            state === 'loading' ? 'buscando…'
            : state === 'error' ? `erro: ${run?.error?.message ?? parseError(s.lastError ?? '').message} — clique para tentar de novo`
            : state === 'ok' ? (s.lastOkAt ? withVerb('ok', relTime(Date.parse(s.lastOkAt), now)) : 'ok')
            : 'ainda não buscada'
          return (
            <li key={s.id}>
              <button
                className={`radar-dot is-${state}`}
                title={`${s.name} — ${label}`}
                aria-label={`${s.name}: ${label}`}
                onClick={() => (state === 'error' ? void retrySource(s.id) : onOpen())}
                disabled={state === 'loading'}
              />
            </li>
          )
        })}
      </ul>
      <button className="radar-dots-label" onClick={onOpen}>
        {sources.length} {sources.length === 1 ? 'fonte' : 'fontes'}
      </button>
    </div>
  )
}

function Issues({ st, enabled }: { st: RadarState; enabled: FeedSource[] }) {
  const [open, setOpen] = useState(false)
  if (st.refreshing || st.offline) return null
  const failed = enabled.filter((s) => (st.runs[s.id]?.state ?? (s.lastStatus === 'error' ? 'error' : null)) === 'error')
  if (!failed.length) return null
  const msg = (s: FeedSource) => st.runs[s.id]?.error?.message ?? parseError(s.lastError ?? '').message
  return (
    <div className="panel radar-issues reveal" style={{ '--i': 2 } as CSSProperties}>
      <div className="radar-issues-head">
        <AlertIcon className="radar-issues-icon" />
        <p>
          {failed.length === 1 ? (
            <>
              <b>{failed[0].name}</b> não respondeu — {msg(failed[0])}.
            </>
          ) : (
            <>
              <b>{failed.length} fontes</b> não responderam. As demais foram atualizadas.
            </>
          )}
        </p>
        {failed.length === 1 ? (
          <button className="btn radar-btn-sm" onClick={() => void retrySource(failed[0].id)}>Tentar de novo</button>
        ) : (
          <button className="btn quiet radar-btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Ocultar' : 'Ver quais'}
            <ChevronIcon className={`radar-chev ${open ? 'is-open' : ''}`} />
          </button>
        )}
      </div>
      {open && failed.length > 1 && (
        <ul className="radar-issues-list">
          {failed.map((s) => (
            <li key={s.id}>
              <span className="radar-issues-name">{s.name}</span>
              <span className="radar-issues-msg">{msg(s)}</span>
              <button className="radar-link" onClick={() => void retrySource(s.id)}>tentar de novo</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type RowCtx = {
  scored: Map<string, Scored>
  sources: Map<string, FeedSource>
  now: number
  leaving: Record<string, true>
  whyId: string | null
  isNew: (i: FeedItem) => boolean
  onWhy: (id: string) => void
  onKeywords: () => void
}

function Body({ view, st, items, model, ctx, enabledCount, setView, openSources }: {
  view: View
  st: RadarState
  items: FeedItem[]
  model: Model
  ctx: RowCtx
  enabledCount: number
  setView: (v: View) => void
  openSources: () => void
}) {
  if (!st.loaded) return <Skeleton />
  if (st.loadError) {
    return (
      <Empty title="O Radar não abriu." text={st.loadError}>
        <button className="btn" onClick={() => void loadRadar()}>Tentar de novo</button>
      </Empty>
    )
  }
  if (view === 'saved') {
    return model.saved.length ? (
      <Section cat={null} title="Salvos para ler depois" items={model.saved} ctx={ctx} pageSize={20} index={2} />
    ) : (
      <Empty
        title="Nada salvo ainda."
        text="Salve um item para ler com calma depois. Salvos ficam aqui mesmo sem conexão e não somem na limpeza de 60 dias."
      />
    )
  }
  if (!st.items.length) {
    if (!enabledCount) {
      return (
        <Empty title="Nenhuma fonte ativa." text="Ative ou adicione fontes RSS/Atom para o Radar começar a selecionar o que importa.">
          <button className="btn" onClick={openSources}>Gerenciar fontes</button>
        </Empty>
      )
    }
    if (st.refreshing) return <Skeleton />
    return st.offline ? (
      <Empty title="Sem conexão." text="Ainda não há nada guardado. Quando a rede voltar, o Radar busca as fontes sozinho." />
    ) : (
      <Empty title="Nada por aqui ainda." text="As fontes responderam, mas não trouxeram nada dos últimos 60 dias. Tente atualizar mais tarde." />
    )
  }

  if (view === 'skills') return <Skills items={items} ctx={ctx} />

  if (view === 'all') {
    const sections = CATS.filter((c) => model.byCat[c].length)
    return (
      <>
        {model.highlights.length > 0 ? (
          <Highlights items={model.highlights} ctx={ctx} />
        ) : (
          model.unreadRelevant === 0 && (
            <Empty
              compact
              title="Você está em dia."
              text={`Nada relevante e novo desde a última atualização. Destaques aparecem quando algo passa de ${fmtNum(HIGHLIGHT_MIN)} pontos.`}
            />
          )
        )}
        {sections.map((c, k) => (
          <Section key={c} cat={c} title={CATEGORY_LABEL[c]} items={model.byCat[c]} ctx={ctx} pageSize={5} index={3 + k} onAll={() => setView(c)} />
        ))}
        <LowBucket items={model.low} ctx={ctx} />
      </>
    )
  }

  const cat = view as Cat
  const list = model.byCat[cat]
  const hl = model.highlights.filter((i) => ctx.scored.get(i.id)?.category === cat)
  const all = [...hl, ...list].sort((a, b) => ctx.scored.get(b.id)!.score - ctx.scored.get(a.id)!.score)
  return (
    <>
      {all.length ? (
        <Section cat={cat} title={CATEGORY_LABEL[cat]} items={all} ctx={ctx} pageSize={12} index={2} />
      ) : (
        <Empty
          title={`Nada de ${CATEGORY_SHORT[cat]} por enquanto.`}
          text="Quando uma fonte trouxer algo desta categoria com relevância suficiente, aparece aqui. O resto fica em pouca relevância, logo abaixo."
        />
      )}
      <LowBucket items={model.lowByCat[cat]} ctx={ctx} />
    </>
  )
}

function Skeleton() {
  return (
    <div className="radar-skel" aria-hidden="true">
      <div className="panel radar-card is-lead radar-skel-card">
        <span className="radar-skel-line" style={{ width: '22%' }} />
        <span className="radar-skel-line is-title" style={{ width: '78%' }} />
        <span className="radar-skel-line is-title" style={{ width: '54%' }} />
        <span className="radar-skel-line" style={{ width: '64%' }} />
      </div>
      <div className="panel radar-list radar-skel-list">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="radar-skel-row" style={{ animationDelay: `${i * 120}ms` }}>
            <span className="radar-skel-line" style={{ width: '18%' }} />
            <span className="radar-skel-line is-row" style={{ width: `${70 - i * 9}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Empty({ title, text, compact, children }: { title: string; text: string; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={`radar-empty reveal ${compact ? 'is-compact' : ''}`} style={{ '--i': 2 } as CSSProperties}>
      <span className="radar-empty-mark" aria-hidden="true" />
      <h2 className="display">{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  )
}

function Highlights({ items, ctx }: { items: FeedItem[]; ctx: RowCtx }) {
  const [lead, ...rest] = items
  return (
    <section className="radar-highlights" aria-label="Destaques">
      <Card item={lead} ctx={ctx} lead index={2} />
      {rest.length > 0 && (
        <div className="radar-hl-rest" data-count={rest.length}>
          {rest.map((i, k) => (
            <Card key={i.id} item={i} ctx={ctx} index={3 + k} />
          ))}
        </div>
      )}
    </section>
  )
}

function Card({ item, ctx, lead, index }: { item: FeedItem; ctx: RowCtx; lead?: boolean; index: number }) {
  const s = ctx.scored.get(item.id)!
  const why = ctx.whyId === item.id
  return (
    <article
      className={`panel radar-card ${lead ? 'is-lead' : ''} ${item.readAt ? 'is-read' : ''} ${ctx.leaving[item.id] ? 'is-leaving' : ''}`}
      style={{ '--i': index } as CSSProperties}
      data-flip={`card-${item.id}`}
      data-cat={s.category}
    >
      <Meta item={item} cat={s.category} ctx={ctx} />
      <h3 className="radar-card-title">
        <TitleLink item={item} />
      </h3>
      {ptExcerpt(item) && <p className="radar-card-excerpt">{ptExcerpt(item)}</p>}
      <footer className="radar-card-foot">
        <button className="radar-open" onClick={() => openItem(item)}>
          Abrir <ArrowUpRight />
        </button>
        <Actions item={item} ctx={ctx} why={why} withOpen={false} />
      </footer>
      {why && <Why item={item} scored={s} ctx={ctx} />}
    </article>
  )
}

function Section({ cat, title, items, ctx, pageSize, index, onAll }: {
  cat: Cat | null
  title: string
  items: FeedItem[]
  ctx: RowCtx
  pageSize: number
  index: number
  onAll?: () => void
}) {
  const [shown, setShown] = useState(pageSize)
  const visible = items.slice(0, shown)
  const more = items.length - visible.length
  return (
    <section className="radar-section reveal" style={{ '--i': index } as CSSProperties} data-flip={`sec-${cat ?? 'saved'}`} data-cat={cat ?? 'saved'}>
      <header className="radar-section-head">
        <h2 className="radar-section-title">{title}</h2>
        <span className="radar-section-count">
          {items.length} {items.length === 1 ? 'item' : 'itens'}
        </span>
        {onAll && items.length > pageSize && (
          <button className="radar-link radar-section-all" onClick={onAll}>
            ver tudo
          </button>
        )}
      </header>
      <ul className="panel radar-list">
        {visible.map((i, k) => (
          <Row key={i.id} item={i} ctx={ctx} index={k} />
        ))}
      </ul>
      {more > 0 && (
        <button className="radar-more" onClick={() => setShown((n) => n + Math.max(pageSize, 10))}>
          Mostrar mais {Math.min(more, Math.max(pageSize, 10))}
          <ChevronIcon />
        </button>
      )}
    </section>
  )
}

function LowBucket({ items, ctx }: { items: FeedItem[]; ctx: RowCtx }) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(15)
  if (!items.length) return null
  const visible = items.slice(0, shown)
  return (
    <section className="radar-low" data-flip="low">
      <button className="radar-low-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="radar-low-rule" aria-hidden="true" />
        <span className="radar-low-label">
          Pouca relevância · {items.length}
          <ChevronIcon className={`radar-chev ${open ? 'is-open' : ''}`} />
        </span>
        <span className="radar-low-rule" aria-hidden="true" />
      </button>
      {open && (
        <>
          <p className="radar-low-hint">
            Abaixo de {fmtNum(LOW_RELEVANCE)} pontos ou sem tema reconhecido: vagas, eventos, institucional, pacotes secundários e
            versões de teste. Use “por que isso está aqui?” para ver as contas.
          </p>
          <ul className="panel radar-list is-low">
            {visible.map((i, k) => (
              <Row key={i.id} item={i} ctx={ctx} index={k} />
            ))}
          </ul>
          {items.length > shown && (
            <button className="radar-more" onClick={() => setShown((n) => n + 20)}>
              Mostrar mais {Math.min(items.length - shown, 20)}
              <ChevronIcon />
            </button>
          )}
        </>
      )}
    </section>
  )
}

function Row({ item, ctx, index }: { item: FeedItem; ctx: RowCtx; index: number }) {
  const s = ctx.scored.get(item.id)!
  const why = ctx.whyId === item.id
  return (
    <li
      className={`radar-row ${item.readAt ? 'is-read' : ''} ${ctx.leaving[item.id] ? 'is-leaving' : ''} ${why ? 'is-why' : ''}`}
      style={{ '--i': Math.min(index, 12) } as CSSProperties}
      data-flip={`row-${item.id}`}
      data-cat={s.category}
    >
      <div className="radar-row-body">
        <Meta item={item} cat={s.category} ctx={ctx} />
        <TitleLink item={item} className="radar-title" />
        {ptExcerpt(item) && <p className="radar-excerpt">{ptExcerpt(item)}</p>}
      </div>
      <Actions item={item} ctx={ctx} why={why} withOpen />
      {why && <Why item={item} scored={s} ctx={ctx} />}
    </li>
  )
}

function TitleLink({ item, className }: { item: FeedItem; className?: string }) {
  return (
    <a
      className={className}
      href={item.url}
      onClick={(e) => {
        e.preventDefault()
        openItem(item)
      }}
      onAuxClick={(e) => e.preventDefault()}
    >
      {ptTitle(item)}
      <ArrowUpRight className="radar-title-arrow" />
    </a>
  )
}

function Meta({ item, cat, ctx }: { item: FeedItem; cat: ItemCategory; ctx: RowCtx }) {
  const t = itemTime(item)
  return (
    <div className="radar-meta">
      <span className="radar-cat">{CATEGORY_SHORT[cat]}</span>
      <span className="radar-meta-src">{item.sourceName}</span>
      <time dateTime={new Date(t).toISOString()} title={clean(fmtDayTime.format(t))}>
        {relTime(t, ctx.now)}
      </time>
      {ctx.isNew(item) && !item.readAt && <span className="radar-new">novo</span>}
      {item.readAt && <span className="radar-read-mark">lido</span>}
    </div>
  )
}

function Actions({ item, ctx, why, withOpen }: { item: FeedItem; ctx: RowCtx; why: boolean; withOpen: boolean }) {
  const saved = !!item.savedAt
  return (
    <div className="radar-actions">
      <button
        className={`radar-act ${why ? 'is-on' : ''}`}
        onClick={() => ctx.onWhy(item.id)}
        aria-expanded={why}
        aria-controls={`why-${item.id}`}
        aria-label="Por que isso está aqui?"
        title="Por que isso está aqui?"
      >
        <WhyIcon />
      </button>
      <button
        className={`radar-act ${saved ? 'is-on is-saved' : ''}`}
        onClick={() => void toggleSaved(item)}
        aria-pressed={saved}
        aria-label={saved ? 'Remover dos salvos' : 'Salvar para ler depois'}
        title={saved ? 'Remover dos salvos' : 'Salvar para ler depois'}
      >
        <BookmarkIcon filled={saved} />
      </button>
      <button
        className="radar-act"
        onClick={() => void dismissItem(item, ctx.scored.get(item.id))}
        aria-label="Não me interessa (dispensar)"
        title="Não me interessa"
      >
        <DismissIcon />
      </button>
      {withOpen && (
        <button className="radar-act" onClick={() => openItem(item)} aria-label="Abrir no navegador" title="Abrir no navegador">
          <ArrowUpRight size={15} />
        </button>
      )}
    </div>
  )
}

function Why({ item, scored, ctx }: { item: FeedItem; scored: Scored; ctx: RowCtx }) {
  const source = item.sourceId ? ctx.sources.get(item.sourceId) : undefined
  const max = Math.max(3, ...scored.parts.map((p) => Math.abs(p.value)))
  const verdict =
    scored.score >= HIGHLIGHT_MIN ? 'forte o bastante para destaque'
    : isLow(scored) ? 'fica em pouca relevância'
    : 'aparece na lista da categoria'
  return (
    <div className="radar-why" id={`why-${item.id}`} role="region" aria-label="Por que isso está aqui">
      <ul className="radar-why-list">
        {scored.parts.map((p, i) => (
          <li key={i} className={p.value < 0 ? 'is-neg' : p.value > 0 ? 'is-pos' : 'is-zero'}>
            <span className="radar-why-label">{p.label}</span>
            <span className="radar-why-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(1, Math.abs(p.value) / max)})` }} />
            </span>
            <span className="radar-why-val">
              {p.value > 0 ? '+' : p.value < 0 ? '−' : ''}
              {fmtNum(Math.abs(p.value))}
            </span>
          </li>
        ))}
        <li className="radar-why-total">
          <span className="radar-why-label">Total · {verdict}</span>
          <span className="radar-why-bar" aria-hidden="true" />
          <span className="radar-why-val">{fmtNum(scored.score)}</span>
        </li>
      </ul>
      <div className="radar-why-actions">
        {source && (
          <>
            <button
              className="btn quiet radar-btn-sm"
              disabled={source.weight <= 0.2}
              onClick={() => void updateSource(source.id, { weight: Math.max(0.2, Math.round((source.weight - 0.2) * 10) / 10) })}
            >
              Menos de {source.name}
            </button>
            <button
              className="btn quiet radar-btn-sm"
              disabled={source.weight >= 2}
              onClick={() => void updateSource(source.id, { weight: Math.min(2, Math.round((source.weight + 0.2) * 10) / 10) })}
            >
              Mais de {source.name}
            </button>
          </>
        )}
        <button className="btn quiet radar-btn-sm" onClick={ctx.onKeywords}>Editar palavras-chave</button>
        <button className="btn quiet radar-btn-sm" onClick={() => void toggleRead(item)}>
          {item.readAt ? 'Marcar como não lido' : 'Marcar como lido'}
        </button>
      </div>
    </div>
  )
}

function ToastView({ st }: { st: RadarState }) {
  const t = st.toast
  return (
    <div className="radar-toast-zone" aria-live="polite">
      {t && (
        <div className="radar-toast" key={t.id} role="status">
          <div className="radar-toast-text">
            <b>{t.text}</b>
            {t.detail && <span>{t.detail}</span>}
          </div>
          {t.undo && (
            <button className="btn radar-btn-sm" onClick={() => t.undo?.()}>
              Desfazer
            </button>
          )}
          <button className="radar-icon-btn is-ghost" onClick={hideToast} aria-label="Fechar aviso">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

const SKILL_RE = /\b(skills?|agents?|agentic|harness|mcp|claude code|codex|cursor|copilot|subagents?|hooks?|evals?|prompt(s|ing)?|workflows?|vibe coding|context engineering|spec[- ]driven|plugins?|cli|design system|figma|prototyp\w*|ui|ux)\b/i
const TOOL_SOURCES = /claude code|codex|cursor/i
const SKILL_SOURCES = /anthropic skills/i
const PRACTICE_SOURCES = /simon willison|latent space|github blog|addy osmani/i
const DESIGN_SOURCES = /ux collective|figma/i

type SkillGroups = { tools: FeedItem[]; skills: FeedItem[]; practice: FeedItem[]; design: FeedItem[]; all: FeedItem[]; fresh: number }

function skillsOf(items: FeedItem[], sources: Map<string, FeedSource>): SkillGroups {
  const g: SkillGroups = { tools: [], skills: [], practice: [], design: [], all: [], fresh: 0 }
  const week = Date.now() - 7 * 864e5
  for (const i of items) {
    const src = (i.sourceId && sources.get(i.sourceId)?.name) || i.sourceName
    const text = `${i.titlePt ?? i.title} ${i.excerptPt ?? i.excerpt}`
    let bucket: keyof Omit<SkillGroups, 'all' | 'fresh'> | null = null
    if (TOOL_SOURCES.test(src)) bucket = 'tools'
    else if (SKILL_SOURCES.test(src)) bucket = 'skills'
    else if (DESIGN_SOURCES.test(src)) bucket = SKILL_RE.test(text) || /design/i.test(text) ? 'design' : null
    else if (PRACTICE_SOURCES.test(src)) bucket = SKILL_RE.test(text) ? 'practice' : null
    else if (/\b(skills?|harness|subagents?|claude code|mcp)\b/i.test(text)) bucket = 'skills'
    if (!bucket) continue
    g[bucket].push(i)
    g.all.push(i)
    if (!i.readAt && itemTime(i) > week) g.fresh++
  }
  return g
}

function Skills({ items, ctx }: { items: FeedItem[]; ctx: RowCtx }) {
  const g = useMemo(() => skillsOf(items, ctx.sources), [items, ctx.sources])
  const score = (i: FeedItem) => (ctx.scored.get(i.id)?.score ?? 0) + Math.max(0, 6 - (Date.now() - itemTime(i)) / 864e5)
  const recent = g.all.filter((i) => Date.now() - itemTime(i) < 10 * 864e5).sort((a, b) => score(b) - score(a))
  const day = Math.floor(Date.now() / 864e5)
  const pool = recent.slice(0, 9)
  const off = pool.length > 3 ? day % 3 : 0
  const picks = [pool[off], pool[off + 3], pool[off + 6]].filter(Boolean) as FeedItem[]
  const picked = new Set(picks.map((p) => p.id))
  const byScore = (list: FeedItem[]) => list.filter((i) => !picked.has(i.id)).sort((a, b) => score(b) - score(a))
  if (!g.all.length) {
    return <Empty title="As indicações chegam já já." text="Estou buscando as fontes de skills, ferramentas de IA e design. Atualize o Radar em instantes." />
  }
  return (
    <>
      {picks.length > 0 && (
        <section className="radar-skills-today" aria-label="Indicações de hoje">
          <header>
            <span className="radar-skills-k">Indicação de hoje</span>
            <span className="radar-skills-sub">3 coisas para testar no seu jeito de desenvolver com IA</span>
          </header>
          <Highlights items={picks} ctx={ctx} />
        </section>
      )}
      {g.tools.length > 0 && <Section cat="ai_dev" title="Ferramentas: Claude Code, Codex, Cursor" items={byScore(g.tools)} ctx={ctx} pageSize={5} index={3} />}
      {g.skills.length > 0 && <Section cat="ai_dev" title="Skills, MCP e harness" items={byScore(g.skills)} ctx={ctx} pageSize={5} index={4} />}
      {g.practice.length > 0 && <Section cat="ai_dev" title="Novas formas de desenvolver com IA" items={byScore(g.practice)} ctx={ctx} pageSize={5} index={5} />}
      {g.design.length > 0 && <Section cat="ai_content" title="Design" items={byScore(g.design)} ctx={ctx} pageSize={5} index={6} />}
    </>
  )
}
