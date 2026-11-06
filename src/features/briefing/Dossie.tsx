import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import '@fontsource/fraunces/700.css'
import '@fontsource/fraunces/900.css'
import '@fontsource/fraunces/400-italic.css'
import { openExternal } from '../../shared/openExternal'
import {
  annexOf, cadernoLeads, confidenceLine, confidenceOf, dossieNumber, frontOf, regionOf, REGION_LABEL, SHAPE, skinOf, storiesOf, tierOf, TIER_LABEL,
  timelineOf, timelineTicks, TYPE_LABEL, VIEWS, type Annex, type View,
} from './dossie.ts'
import { direction, fmtChange, fmtValue, periodLabel } from './market.ts'
import { briefingPlayer, rateOfSpeed, speedOfRate, useBriefingPlayer, voiceProgressLabel } from './player.ts'
import { ensureFloatingMiniPlayer } from './MiniPlayer.tsx'
import { RateBriefing } from './Rate.tsx'
import { estimateSeconds } from './assemble.ts'
import type { BriefState } from './store.ts'
import { CADERNO_LABEL, cadernoOf, type BriefItem, type Caderno, type Edition, type Quote } from './types.ts'
import { Interest } from './ui.tsx'
import './dossie.css'

const VIEW_KEY = 'ps.briefing.view'
const pad = (n: number) => String(n).padStart(2, '0')
const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dm = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '').replace(' de ', ' ')
const nf = (v: number, d = 1) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)

function useAppLook() {
  const read = () => ({ skin: skinOf(document.documentElement.dataset.style), scheme: document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark', style: document.documentElement.dataset.style ?? 'classico' })
  const [look, setLook] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setLook(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-style', 'data-scheme', 'data-theme'] })
    return () => mo.disconnect()
  }, [])
  return look
}

const readView = (): View => {
  const v = localStorage.getItem(VIEW_KEY)
  return VIEWS.some((x) => x.id === v) ? (v as View) : 'tudo'
}

type Props = { edition: Edition; st: BriefState; mode: 'card' | 'full'; onExpand?: () => void; onClose?: () => void; menu?: ReactNode }

export function Dossie({ edition, st, mode, onExpand, onClose, menu }: Props) {
  const look = useAppLook()
  const player = useBriefingPlayer()
  const [view, setViewState] = useState<View>(readView)
  const [sel, setSel] = useState(-1)
  const [scrolled, setScrolled] = useState(false)
  const [read, setRead] = useState<Set<string>>(() => new Set())
  const sheet = useRef<HTMLDivElement>(null)
  const full = mode === 'full'
  const list = useMemo(() => storiesOf(edition, view), [edition, view])
  const front = useMemo(() => frontOf(edition), [edition])
  const numbers = useMemo(() => new Map(front.ordered.map((it, i) => [it.key, i + 1])), [front])
  const onAir = player.date === edition.date && (player.status === 'playing' || player.status === 'loading' || player.status === 'paused')
  const reading = onAir ? player.program?.chapters[player.chapter] : undefined
  const readingKey = reading?.kind === 'item' ? reading.key : null
  const speed = speedOfRate(st.profile?.voice.rate ?? 185)
  const minutes = Math.max(1, Math.round(estimateSeconds(edition, rateOfSpeed(speed)) / 60))
  const chapterOf = (it: BriefItem) => edition.items.findIndex((x) => x.key === it.key) + 1
  const wait = onAir && (player.status === 'loading' || player.buffering) ? (voiceProgressLabel(player.voice) ?? 'preparando a voz…') : null

  const setView = useCallback((v: View) => {
    localStorage.setItem(VIEW_KEY, v)
    setViewState(v)
    setSel(-1)
    requestAnimationFrame(() => sheet.current?.scrollTo({ top: 0 }))
  }, [])

  const listen = useCallback(() => {
    ensureFloatingMiniPlayer()
    if (onAir) briefingPlayer.toggle()
    else briefingPlayer.play(edition, { resume: player.resume?.date === edition.date, voice: st.profile?.voice.voice ?? 'pf_dora', speed })
  }, [onAir, edition, player.resume, st.profile?.voice.voice, speed])

  const listenTo = (it: BriefItem) => {
    ensureFloatingMiniPlayer()
    if (onAir) briefingPlayer.seek(chapterOf(it))
    else briefingPlayer.play(edition, { chapter: chapterOf(it), voice: st.profile?.voice.voice ?? 'pf_dora', speed })
  }

  const scrollToKey = useCallback((key: string, smooth = true) => {
    const box = sheet.current
    const el = box?.querySelector<HTMLElement>(`article[data-key="${CSS.escape(key)}"]`)
    if (!box || !el) return
    const strip = box.querySelector<HTMLElement>('.dz-strip')?.offsetHeight ?? 44
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - strip - 10
    box.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    if (!readingKey) return
    if (!list.some((x) => x.key === readingKey)) return
    scrollToKey(readingKey)
  }, [readingKey, list, scrollToKey])

  useEffect(() => {
    const box = sheet.current
    if (!box) return
    const on = () => setScrolled(box.scrollTop > 4)
    on()
    box.addEventListener('scroll', on, { passive: true })
    return () => box.removeEventListener('scroll', on)
  }, [])

  useEffect(() => {
    const box = sheet.current
    if (!box) return
    const io = new IntersectionObserver(
      (es) => {
        const seen = es.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.key!)
        if (seen.length) setRead((r) => (seen.every((k) => r.has(k)) ? r : new Set([...r, ...seen])))
      },
      { root: box, threshold: 0, rootMargin: '0px 0px -55% 0px' },
    )
    box.querySelectorAll('article.dz-item').forEach((a) => io.observe(a))
    return () => io.disconnect()
  }, [list])

  const keyAct = useCallback(
    (e: KeyboardEvent | ReactKeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return false
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return false
      const k = e.key.toLowerCase()
      if (/^[0-3]$/.test(k)) {
        setView(VIEWS[Number(k)].id)
        return true
      }
      if (k === 'j' || k === 'k') {
        const i = k === 'j' ? Math.min(list.length - 1, sel + 1) : Math.max(0, sel - 1)
        setSel(i)
        if (list[i]) scrollToKey(list[i].key)
        return true
      }
      if (k === 'p') {
        listen()
        return true
      }
      const cur = list[sel]
      if (!cur) {
        if (k === 'enter' && !full && t?.closest('.dz-strip')) {
          onExpand?.()
          return true
        }
        return false
      }
      if (k === 'enter') {
        void openExternal(cur.url)
        return true
      }
      if (k === 'i' || k === 'x') {
        const btn = sheet.current?.querySelector<HTMLButtonElement>(`article[data-key="${CSS.escape(cur.key)}"] .brf-int-b.${k === 'i' ? 'is-yes' : 'is-no'}`)
        btn?.click()
        return true
      }
      if (k === 'escape' && full) {
        onClose?.()
        return true
      }
      return false
    },
    [list, sel, full, listen, onExpand, onClose, scrollToKey, setView],
  )

  useEffect(() => {
    if (!full) return
    const h = (e: KeyboardEvent) => {
      if (keyAct(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [full, keyAct])

  useLayoutEffect(() => {
    if (full) sheet.current?.focus({ preventScroll: true })
  }, [full])

  const progress = list.length ? list.filter((x) => read.has(x.key)).length / list.length : 0
  const cur = VIEWS.find((v) => v.id === view)!
  const counts: Record<View, number> = {
    tudo: edition.items.length,
    politica: edition.items.filter((i) => cadernoOf(i.area) === 'politica').length,
    investimentos: edition.items.filter((i) => cadernoOf(i.area) === 'investimentos').length,
    ia_dev: edition.items.filter((i) => cadernoOf(i.area) === 'ia_dev').length,
  }

  const item = (it: BriefItem, mark?: string) => (
    <Item
      key={it.key}
      it={it}
      n={numbers.get(it.key) ?? 0}
      mark={mark}
      edition={edition}
      annex={annexOf(it, edition)}
      selected={list[sel]?.key === it.key}
      speaking={readingKey === it.key}
      down={st.votes.get(it.key)?.signal === 'down'}
      onListen={() => listenTo(it)}
      onFocus={() => setSel(list.findIndex((x) => x.key === it.key))}
    />
  )

  const doc =
    view === 'tudo' ? (
      <>
        <Cover edition={edition} minutes={minutes} numbers={numbers} onJump={(k) => scrollToKey(k)} />
        <section>
          <SecHead label="Ponto principal" desc="O topo de cada caderno" n={(front.lead ? 1 : 0) + front.leads.length} />
          {front.lead && item(front.lead, 'O mais importante pra você hoje')}
          {front.leads.map((it) => item(it, `Topo · ${CADERNO_LABEL[cadernoOf(it.area)]}`))}
        </section>
        {(['politica', 'investimentos', 'ia_dev'] as Caderno[]).map((c) => {
          const rest = front.rest(c)
          if (!rest.length) return null
          return (
            <section key={c}>
              <SecHead caderno={c} label={VIEWS.find((v) => v.id === c)!.long} desc={VIEWS.find((v) => v.id === c)!.desc} n={rest.length} />
              {rest.map((it) => item(it))}
            </section>
          )
        })}
      </>
    ) : (
      <section>
        <SecHead caderno={view} label={cur.long} desc={cur.desc} n={list.length} />
        {view === 'investimentos' && <Ticker quotes={edition.market} cls="dz-ticker is-sec" />}
        {list.length ? list.map((it, i) => item(it, i === 0 ? `Topo · ${CADERNO_LABEL[view]}` : undefined)) : <p className="dz-empty">Nada deste caderno passou na peneira hoje.</p>}
      </section>
    )

  return (
    <div className={`dz is-${mode} dz-skin-${look.skin}`} data-scheme={look.scheme} data-style={look.style} data-playing={onAir && player.status !== 'paused'}>
      <div className="dz-sheet" ref={sheet} tabIndex={0} onKeyDown={(e) => !full && keyAct(e) && (e.preventDefault(), e.stopPropagation())} aria-label="Dossiê do dia">
        <header className={`dz-strip ${scrolled ? 'is-scrolled' : ''}`} tabIndex={full ? -1 : 0} onKeyDown={(e) => e.key === 'Enter' && !full && e.target === e.currentTarget && (e.preventDefault(), onExpand?.())}>
          <div className="dz-strip-id">
            <span className="dz-class">
              Reservado<span className="dz-class-x"> · uso pessoal</span>
            </span>
            <span className="dz-strip-t">
              {full ? 'Dossiê do dia' : 'Dossiê'} <b>n.º {dossieNumber(edition.date)}</b>
              <span className="dz-strip-d">
                {' '}
                · {new Date(`${edition.date}T12:00:00`).toLocaleDateString('pt-BR', full ? undefined : { day: '2-digit', month: '2-digit' })} · {hm(edition.createdAt)}
              </span>
            </span>
          </div>
          <nav className="dz-tabs" role="tablist" aria-label="Cadernos">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={v.id === view} onClick={() => setView(v.id)} title={`${v.long} · tecla ${v.key}`}>
                <span className="dz-tab-k">{v.key}</span>
                <span className="dz-tab-l">{full && v.id !== 'tudo' ? v.long.replace('Caderno ', '') : v.tab}</span>
                <span className="dz-tab-n">{counts[v.id]}</span>
              </button>
            ))}
          </nav>
          <div className="dz-strip-act">
            {onAir && (
              <button type="button" className="dz-icon" onClick={() => briefingPlayer.prev()} aria-label="História anterior">
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M8 2 4 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            )}
            <button type="button" className="dz-play" onClick={listen} title="Tecla P">
              {onAir && player.status !== 'paused' ? (
                <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" /></svg>
              ) : (
                <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><path d="M3 2v8l7-4z" fill="currentColor" /></svg>
              )}
              <span>{wait ?? (onAir ? (player.status === 'paused' ? 'Continuar' : 'Pausar') : player.resume?.date === edition.date ? 'Continuar' : `Ouvir · ${minutes} min`)}</span>
            </button>
            {onAir && (
              <button type="button" className="dz-icon" onClick={() => briefingPlayer.next()} aria-label="Próxima história">
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            )}
            {menu}
            {full ? (
              <button type="button" className="dz-icon" onClick={onClose} aria-label="Fechar a leitura (Esc)" title="Fechar (Esc)">
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            ) : (
              <button type="button" className="dz-icon" onClick={onExpand} aria-label="Abrir a leitura" title="Leitura">
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
          <span className="dz-progress" aria-hidden="true">
            <i style={{ transform: `scaleX(${progress})` }} />
          </span>
        </header>

        <div className="dz-body">
          {full && (
            <nav className="dz-index" aria-label="Sumário">
              <div className="dz-index-h">
                <span className="dz-label">Sumário</span>
                <span className="dz-index-p">
                  {list.filter((x) => read.has(x.key)).length} de {list.length} lidos
                </span>
              </div>
              <ol>
                {list.map((it) => (
                  <li key={it.key}>
                    <button type="button" className={read.has(it.key) ? 'is-read' : ''} onClick={() => scrollToKey(it.key)}>
                      <span className="dz-ix-n">{pad(numbers.get(it.key) ?? 0)}</span>
                      <span className="dz-ix-t">
                        <small>{TYPE_LABEL[it.area]}</small>
                        {it.title}
                      </span>
                      <span className="dz-ix-ok" aria-hidden="true">✓</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="dz-doc" key={view}>
            {doc}
            <LeftOut edition={edition} st={st} />
            <footer className="dz-end">
              <span className="dz-lbl">Conclusão</span>
              <p>{edition.closing}</p>
              <RateBriefing edition={edition} variant="closing" />
              <p className="dz-colo">
                Preparado às {hm(edition.createdAt)} a partir de {edition.stats.candidates} candidatas e {edition.stats.sourcesOk} fontes
                {edition.judge === 'codex' ? ' · avaliado pelo Codex' : ' · sem o juiz'}
                {edition.hiddenEnglish ? ` · ${edition.hiddenEnglish} em inglês ficaram de fora` : ''} · fim do dossiê
              </p>
              {!full && (
                <button type="button" className="dz-open" onClick={onExpand}>
                  Abrir o dossiê completo →
                </button>
              )}
            </footer>
          </div>
          {full && <MarketAside edition={edition} />}
        </div>
      </div>
    </div>
  )
}

function SecHead({ caderno, label, desc, n }: { caderno?: Caderno; label: string; desc: string; n: number }) {
  return (
    <h2 className="dz-sec">
      {caderno && <span className="dz-shape" data-shape={SHAPE[caderno]} aria-hidden="true" />}
      <span className="dz-sec-l">{label}</span>
      <span className="dz-sec-d">{desc}</span>
      <span className="dz-sec-n">
        {n} {n === 1 ? 'item' : 'itens'}
      </span>
    </h2>
  )
}

function Cover({ edition, minutes, numbers, onJump }: { edition: Edition; minutes: number; numbers: Map<string, number>; onJump: (key: string) => void }) {
  const tops = cadernoLeads(edition)
  const pts = timelineOf(edition, edition.items)
  const ticks = timelineTicks(edition)
  return (
    <section className="dz-cover">
      <div className="dz-cover-k">
        <span className="dz-label">Síntese</span>
        <span className="dz-label">
          {edition.items.length} itens · {edition.stats.sourcesOk} fontes · ≈ {minutes} min
        </span>
      </div>
      <p className="dz-cover-p">{edition.opening}</p>
      <div className="dz-points">
        <span className="dz-label">Em 30 segundos</span>
        <ol>
          {tops.map(({ caderno, item }) => (
            <li key={item.key}>
              <span className="dz-pt-n">{pad(numbers.get(item.key) ?? 0)}</span>
              <span className="dz-pt-c">{VIEWS.find((v) => v.id === caderno)!.tab}</span>
              <button type="button" onClick={() => onJump(item.key)}>
                {item.title}
              </button>
            </li>
          ))}
        </ol>
      </div>
      {pts.length > 1 && (
        <figure className="dz-tl">
          <figcaption>
            <span className="dz-label">Linha do dia</span>
            <span className="dz-tl-leg">
              <span>
                <i className="dz-shape" data-shape="sq" />
                Política
              </span>
              <span>
                <i className="dz-shape" data-shape="di" />
                Investimentos
              </span>
              <span>
                <i className="dz-shape" data-shape="ci" />
                IA e dev
              </span>
            </span>
          </figcaption>
          <div className="dz-tl-track">
            {ticks.map((t) => (
              <span key={t.pos} className="dz-tl-tick" style={{ left: `${t.pos}%` }}>
                <b>{t.label}</b>
              </span>
            ))}
            {pts.map((p) => (
              <button
                key={p.key}
                type="button"
                className="dz-tl-dot"
                data-shape={p.shape}
                style={{ left: `${p.pos}%`, ['--j' as string]: p.lane }}
                title={`${hm(p.at)} · ${p.title}`}
                aria-label={`${hm(p.at)} · ${p.title}`}
                onClick={() => onJump(p.key)}
              />
            ))}
            <span className="dz-tl-end" style={{ left: '100%' }}>
              <b>{hm(edition.createdAt)} fechamento</b>
            </span>
          </div>
        </figure>
      )}
      <p className="dz-cover-conf">
        <span className="dz-label">Confiança</span>
        {confidenceLine(edition.items)}
      </p>
      {edition.market.length > 0 && <Ticker quotes={edition.market} cls="dz-ticker" />}
    </section>
  )
}

function Ticker({ quotes, cls }: { quotes: Quote[]; cls: string }) {
  return (
    <div className={cls} aria-label="Indicadores">
      {quotes.map((q) => {
        const dir = direction(q.changePct)
        return (
          <span key={q.id} className="dz-q" data-dir={dir}>
            <span className="dz-q-l">{q.label}</span>
            <span className="dz-q-v">{fmtValue(q)}</span>
            <span className="dz-q-c">{q.changePct === null ? periodLabel(q) : `${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·'} ${fmtChange(q.changePct)} ${periodLabel(q)}`}</span>
          </span>
        )
      })}
    </div>
  )
}

type ItemProps = {
  it: BriefItem
  n: number
  mark?: string
  edition: Edition
  annex: Annex | null
  selected: boolean
  speaking: boolean
  down: boolean
  onListen: () => void
  onFocus: () => void
}

function Item({ it, n, mark, edition, annex, selected, speaking, down, onListen, onFocus }: ItemProps) {
  const tier = tierOf(it, edition.items)
  const caderno = cadernoOf(it.area)
  const region = it.area === 'politica' || it.area === 'mundo' ? null : regionOf(it)
  const dispatch = annex?.kind === 'dispatch' ? annex : null
  const conf = confidenceOf(it.outlets)
  const at = it.publishedAt ? `${dm(it.publishedAt)} · ${hm(it.publishedAt)}` : 'sem horário'
  const others = it.otherSources.length ? ` + ${it.otherSources.length} ${it.otherSources.length === 1 ? 'veículo' : 'veículos'}` : ''
  return (
    <article
      className={`dz-item ${mark ? 'is-lead' : ''} ${selected ? 'is-sel' : ''} ${down ? 'is-down' : ''}`}
      data-key={it.key}
      data-c={caderno}
      data-speaking={speaking || undefined}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
    >
      <header className="dz-item-h">
        <span className="dz-no">Item {pad(n)}</span>
        <span className="dz-shape" data-shape={SHAPE[caderno]} aria-hidden="true" />
        <span className="dz-type">{TYPE_LABEL[it.area]}</span>
        {region && (
          <span className="dz-region" title={REGION_LABEL[region]}>
            {region}
          </span>
        )}
        <span className="dz-pri" data-tier={tier} title={`Prioridade ${TIER_LABEL[tier]}`}>
          <i />
          <i />
          <i />
          Prioridade {TIER_LABEL[tier]}
        </span>
      </header>
      {mark && <div className="dz-mark">{mark}</div>}
      {dispatch && (
        <div className="dz-wire">
          {dispatch.region && (
            <span className="dz-region" title={REGION_LABEL[dispatch.region]}>
              {dispatch.region}
            </span>
          )}
          <span>Despacho</span>
          <span>{at}</span>
          <span>
            {it.outlets} {it.outlets === 1 ? 'veículo' : 'veículos'}
          </span>
        </div>
      )}
      <h3 className="dz-title">{it.title}</h3>
      <dl className="dz-meta">
        <div>
          <dt>Publicado</dt>
          <dd>{at}</dd>
        </div>
        <div>
          <dt>Fonte</dt>
          <dd>
            {it.source}
            {others}
          </dd>
        </div>
        <div>
          <dt>Confiança</dt>
          <dd>{conf}</dd>
        </div>
      </dl>
      {it.summary && <p className="dz-sum">{it.summary}</p>}
      <div className="dz-assess">
        <span className="dz-lbl">Avaliação</span>
        <p>{it.why}</p>
      </div>
      {it.action && (
        <div className="dz-rec">
          <span className="dz-lbl">Recomendação</span>
          <p>{it.action}</p>
        </div>
      )}
      {annex && annex.kind !== 'dispatch' && (
        <div className="dz-annex">
          <span className="dz-annex-l">Anexo {pad(n)}·A</span>
          <AnnexView a={annex} edition={edition} />
        </div>
      )}
      <div className="dz-ctl">
        <button type="button" className="dz-ctl-b" onClick={onListen}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 2v8l7-4z" fill="currentColor" /></svg>
          {speaking ? 'Tocando' : 'Ouvir'}
        </button>
        <Interest item={it} origin="slide" variant="row" />
        <button type="button" className="dz-ctl-src" onClick={() => void openExternal(it.url)}>
          Fonte ↗
        </button>
      </div>
    </article>
  )
}

function Specs({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="dz-specs">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function AnnexView({ a, edition }: { a: Annex; edition: Edition }) {
  if (a.kind === 'model')
    return (
      <figure className="dz-tk dz-model">
        <header className="dz-tk-head">
          <span className="dz-label">Ficha do modelo</span>
          <span className="dz-vendor">{a.vendor}</span>
        </header>
        <div className="dz-model-name">{a.model}</div>
        {a.changed && (
          <p className="dz-model-delta">
            <span className="dz-label">O que mudou</span>
            {a.changed}
          </p>
        )}
        {a.specs.length > 0 && <Specs rows={a.specs} />}
      </figure>
    )
  if (a.kind === 'changelog')
    return (
      <figure className="dz-tk dz-term">
        <div className="dz-term-bar">
          <span className="dz-term-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="dz-term-file">CHANGELOG · {a.product}</span>
          <b className="dz-chip">{a.version}</b>
        </div>
        <pre className="dz-term-body">
          {a.lines.map((l, i) => (
            <span key={i} className="dz-add">
              + {l}
              {'\n'}
            </span>
          ))}
        </pre>
      </figure>
    )
  if (a.kind === 'advisory') {
    const sev = a.severity ? ['Baixa', 'Média', 'Alta', 'Crítica'][a.severity - 1] : null
    return (
      <figure className="dz-tk dz-adv" data-sev={a.severity ?? 0}>
        <header className="dz-tk-head">
          <span className="dz-label">Boletim de segurança</span>
          {a.ids.length > 0 && <span className="dz-adv-id">{a.ids.join(' · ')}</span>}
        </header>
        <div className="dz-sev">
          {sev && (
            <>
              <span className="dz-sev-bar" aria-label={`Severidade ${sev}`}>
                {[1, 2, 3, 4].map((i) => (
                  <i key={i} className={i <= a.severity! ? 'on' : ''} />
                ))}
              </span>
              <span className="dz-sev-l">Severidade {sev.toLowerCase()}</span>
            </>
          )}
          {a.fixed !== null && (
            <span className="dz-adv-st" data-fixed={a.fixed}>
              {a.fixed ? 'correção disponível' : 'sem correção'}
            </span>
          )}
        </div>
      </figure>
    )
  }
  if (a.kind === 'rate')
    return (
      <figure className="dz-tk dz-rate">
        <header className="dz-tk-head">
          <span className="dz-label">Juro real · renda fixa</span>
          <span className="dz-vendor">cotações das {hm(edition.marketAt ?? edition.createdAt)}</span>
        </header>
        <div className="dz-rate-big">
          <span className="dz-rate-num">≈ {nf(a.real)}%</span>
          <span className="dz-rate-sub">ao ano acima da inflação</span>
        </div>
        {[
          ['Selic', a.selic, 'is-selic'],
          ['IPCA 12 m', a.ipca, 'is-ipca'],
        ].map(([l, v, c]) => (
          <div key={l as string} className={`dz-rate-row ${c}`}>
            <span>{l}</span>
            <span className="dz-rate-track">
              <span className="dz-rate-fill" style={{ width: `${Math.min(100, ((v as number) / 16) * 100)}%` }} />
            </span>
            <span className="dz-rate-v">{nf(v as number, 2)}%</span>
          </div>
        ))}
        <figcaption className="dz-cap">Juro real = (1 + Selic) ÷ (1 + IPCA) − 1 · informação, não recomendação de investimento</figcaption>
      </figure>
    )
  if (a.kind === 'price')
    return (
      <figure className="dz-tk dz-price">
        <div className="dz-price-row">
          {a.quotes.map((q) => {
            const dir = direction(q.changePct)
            return (
              <div key={q.id} className="dz-price-cell" data-dir={dir}>
                <span className="dz-label">
                  {q.label} · {periodLabel(q)}
                </span>
                <span className="dz-price-v">{fmtValue(q)}</span>
                {q.changePct !== null && (
                  <span className="dz-price-c">
                    {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·'} {fmtChange(q.changePct)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <figcaption className="dz-cap">Cotação do briefing às {hm(edition.marketAt ?? edition.createdAt)} · fonte: {[...new Set(a.quotes.map((q) => q.source))].join(', ')}</figcaption>
      </figure>
    )
  return null
}

function LeftOut({ edition, st }: { edition: Edition; st: BriefState }) {
  if (!edition.leftOut.length) return null
  return (
    <section className="dz-left">
      <h2 className="dz-sec">
        <span className="dz-sec-l">Fora do dossiê</span>
        <span className="dz-sec-d">O que ficou de fora hoje: marque o que te interessa</span>
        <span className="dz-sec-n">{edition.leftOut.length} itens</span>
      </h2>
      <ul>
        {edition.leftOut.map((it) => (
          <li key={it.key} className={st.votes.get(it.key)?.signal === 'interest' ? 'is-on' : ''}>
            <span className="dz-left-t">{TYPE_LABEL[it.area]}</span>
            <span className="dz-left-b">
              <button type="button" className="dz-left-title" onClick={() => void openExternal(it.url)}>
                {it.title}
              </button>
              <span className="dz-left-s">
                {it.source}
                {it.reason ? ` · ${it.reason}` : ''}
              </span>
            </span>
            <Interest item={it} origin="left_out" kept={false} variant="row" />
          </li>
        ))}
      </ul>
    </section>
  )
}

function MarketAside({ edition }: { edition: Edition }) {
  return (
    <aside className="dz-aside">
      {edition.market.length > 0 && (
        <div className="dz-aside-box">
          <span className="dz-label">Posição de mercado · {hm(edition.marketAt ?? edition.createdAt)}</span>
          {edition.market.map((q) => {
            const dir = direction(q.changePct)
            return (
              <div key={q.id} className="dz-pos" data-dir={dir}>
                <span>{q.label}</span>
                <b>{fmtValue(q)}</b>
                <em>{q.changePct === null ? periodLabel(q) : fmtChange(q.changePct)}</em>
              </div>
            )
          })}
          {edition.marketNarration && <p>{edition.marketNarration}</p>}
          <p className="dz-fine">Informação, não recomendação de investimento.</p>
        </div>
      )}
      <div className="dz-aside-box">
        <span className="dz-label">Como ler</span>
        <p>
          <b>Avaliação</b> é por que importa pra você. <b>Recomendação</b> é o que fazer. <b>Confiança</b> sobe com o número de veículos que confirmam o fato.
        </p>
        <p className="dz-fine">0–3 cadernos · J/K itens · Enter abre a fonte · I interessa · X não interessa · P ouvir · Esc fecha</p>
      </div>
    </aside>
  )
}
