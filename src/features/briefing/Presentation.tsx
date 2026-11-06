import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { openExternal } from '../../shared/openExternal'
import { areaCounts, estimateSeconds, screensOf, weatherSentence, type Screen } from './assemble.ts'
import { decimalsOf, direction, fmtChange, fmtNumber, periodLabel, unitParts } from './market.ts'
import { briefingPlayer, rateOfSpeed, readWeather, SPEEDS, speedOfRate, useBriefingPlayer, voiceProgressLabel, type PlayerState } from './player.ts'
import { markSeenEnd, RateBriefing } from './Rate.tsx'
import { ensureProfile, updateProfile, useBriefing } from './store.ts'
import { AREA_LONG, type Area, type Edition, type Quote } from './types.ts'
import { AreaChip, CountUp, IconClose, IconExternal, IconLeft, IconPause, IconPlay, IconRight, IconSpark, Interest, Wave } from './ui.tsx'

type Props = { edition: Edition; listen: boolean; onClose: () => void; onTriage: () => void; startKey?: string }
type Layer = { i: number; out: boolean; dir: 1 | -1; id: number }

const LONG_DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

type Wx = NonNullable<ReturnType<typeof readWeather>>

const areaOf = (s: Screen): Area | 'none' => (s.kind === 'item' ? s.item.area : s.kind === 'closing' ? (s.focus?.area ?? 'none') : 'none')
const active = (p: PlayerState, e: Edition) => p.date === e.date && (p.status === 'playing' || p.status === 'loading' || p.status === 'paused')

export default function Presentation({ edition, listen, onClose, onTriage, startKey }: Props) {
  const { profile } = useBriefing()
  const player = useBriefingPlayer()
  const weather = useMemo(() => readWeather(), [])
  const screens = useMemo(() => screensOf(edition, weatherSentence(weather)), [edition, weather])
  const following = active(player, edition)
  const startAt = useMemo(() => {
    const p = briefingPlayer.getState()
    if (!startKey && active(p, edition)) return Math.min(p.chapter, screens.length - 1)
    return Math.max(0, startKey ? screens.findIndex((x) => x.kind === 'item' && x.item.key === startKey) : 0)
  }, [screens, startKey, edition])
  const [index, setIndex] = useState(startAt)
  const [layers, setLayers] = useState<Layer[]>([{ i: startAt, out: false, dir: 1, id: 0 }])
  const seq = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const idx = useRef(startAt)
  const followRef = useRef(following)
  useLayoutEffect(() => {
    idx.current = index
    followRef.current = following
  }, [index, following])

  const voice = profile?.voice ?? { voice: 'pf_dora', rate: 185, jarvis: false }
  const speed = speedOfRate(voice.rate)

  useEffect(() => {
    void ensureProfile().catch(() => {})
    const prev = document.activeElement as HTMLElement | null
    root.current?.focus()
    return () => prev?.focus?.()
  }, [])

  useEffect(() => {
    briefingPlayer.setSpeed(speed)
  }, [speed])

  useEffect(() => {
    if (!listen) return
    const p = briefingPlayer.getState()
    if (active(p, edition) && !startKey) return
    briefingPlayer.play(edition, { chapter: startAt, voice: voice.voice, speed })
  }, [])

  const go = useCallback(
    (to: number) => {
      const from = idx.current
      if (to < 0 || to >= screens.length || to === from) return
      const dir: 1 | -1 = to > from ? 1 : -1
      const id = ++seq.current
      setLayers((ls) => [...ls.filter((l) => !l.out).map((l) => ({ ...l, out: true, dir })), { i: to, out: false, dir, id }])
      idx.current = to
      setIndex(to)
      window.setTimeout(() => setLayers((ls) => ls.filter((l) => !l.out || l.id > id)), 760)
    },
    [screens.length],
  )

  useEffect(() => {
    if (following && player.chapter !== idx.current) go(player.chapter)
  }, [following, player.chapter, go])

  const nav = useCallback(
    (to: number) => {
      if (to < 0 || to >= screens.length) return
      if (followRef.current) briefingPlayer.seek(to)
      go(to)
    },
    [go, screens.length],
  )

  const toggleListen = useCallback(() => {
    if (followRef.current) briefingPlayer.toggle()
    else briefingPlayer.play(edition, { chapter: idx.current, voice: voice.voice, speed })
  }, [edition, voice.voice, speed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      let handled = true
      if (e.key === 'ArrowRight' || e.key === 'PageDown') nav(idx.current + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') nav(idx.current - 1)
      else if (e.key === ' ') toggleListen()
      else if (e.key === 'Escape') onClose()
      else if (e.key === 'Home') nav(0)
      else if (e.key === 'End') nav(screens.length - 1)
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [nav, toggleListen, onClose, screens.length])

  const cur = screens[index]
  const area = areaOf(cur)
  const minutes = Math.max(1, Math.round(estimateSeconds(edition, rateOfSpeed(speed)) / 60))
  const playing = following && player.status !== 'paused'
  const setSpeed = (s: number) => void updateProfile((p) => ({ ...p, voice: { ...p.voice, rate: rateOfSpeed(s) } }), 400).catch(() => {})
  const waitLabel = following && (player.status === 'loading' || player.buffering) ? (voiceProgressLabel(player.voice) ?? 'preparando a voz…') : null

  return (
    <div className={`brf-show ${playing ? 'is-listening' : ''}`} ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Briefing do dia" data-area={area}>
      <Backdrop area={area} />
      <div className="brf-show-drag" data-tauri-drag-region />

      <header className="brf-show-top">
        <div className="brf-bars" aria-hidden="true">
          {screens.map((s, i) => (
            <span key={i} className={`brf-seg brf-a-${areaOf(s)} ${i < index ? 'is-past' : i === index ? 'is-now' : ''}`} onClick={() => nav(i)}>
              <Fill active={i === index} listening={playing && player.chapter === i} done={i < index} />
            </span>
          ))}
        </div>
        <div className="brf-top-row">
          <span className="brf-top-kicker">Briefing do dia · {LONG_DAY.format(new Date(`${edition.date}T12:00:00`))}</span>
          {edition.judge === 'fallback' && <span className="brf-note">feito sem o juiz hoje</span>}
          <button className="brf-round" onClick={onClose} aria-label={following ? 'Fechar (o áudio continua)' : 'Fechar (Esc)'} title={following ? 'Fechar: o áudio continua tocando' : 'Fechar (Esc)'}>
            <IconClose />
          </button>
        </div>
      </header>

      <main className="brf-stage">
        {layers.map((l) => (
          <div key={l.id} className={`brf-layer ${l.out ? 'is-out' : 'is-in'}`} style={{ ['--dir' as string]: l.dir } as CSSProperties} aria-hidden={l.out}>
            <ScreenView screen={screens[l.i]} edition={edition} weather={weather} minutes={minutes} total={edition.items.length} onTriage={onTriage} onRestart={() => nav(0)} onClose={onClose} />
          </div>
        ))}
      </main>

      <footer className="brf-show-foot">
        <div className="brf-nav">
          <button className="brf-round" onClick={() => nav(index - 1)} disabled={index === 0} aria-label="Anterior (←)">
            <IconLeft />
          </button>
          <span className="brf-count">
            {index + 1} <i>/</i> {screens.length}
          </span>
          <button className="brf-round" onClick={() => nav(index + 1)} disabled={index === screens.length - 1} aria-label="Próxima (→)">
            <IconRight />
          </button>
        </div>

        <Caption chapter={index} player={player} following={following} wait={waitLabel} />

        <div className="brf-voice">
          <button className="brf-orb-dock" onClick={toggleListen} aria-label={!following ? 'Ouvir (espaço)' : player.status === 'paused' ? 'Continuar' : 'Pausar'} title="Espaço">
            <Wave size="lg" live={playing} />
            <span className="brf-orb-state">{!playing ? <IconPlay size={15} /> : <IconPause size={15} />}</span>
          </button>
          <div className="brf-voice-opts">
            <div className="brf-speeds" role="radiogroup" aria-label="Velocidade">
              {SPEEDS.map((s) => (
                <button key={s} role="radio" aria-checked={s === speed} className={s === speed ? 'is-on' : ''} onClick={() => setSpeed(s)}>
                  {String(s).replace('.', ',')}×
                </button>
              ))}
            </div>
            <div className="brf-voice-row">
              <span className="brf-voice-name">Dora · voz neural</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

const TONES: (Area | 'none')[] = ['none', 'dinheiro', 'codigo', 'ia', 'potencializa', 'seguranca', 'politica', 'mundo']

function Backdrop({ area }: { area: Area | 'none' }) {
  return (
    <div className="brf-backdrop" aria-hidden="true">
      {TONES.map((t) => (
        <div key={t} className={`brf-tint brf-a-${t} ${t === area ? 'is-on' : ''}`}>
          <i className="b1" />
          <i className="b2" />
          <i className="b3" />
        </div>
      ))}
      <div className="brf-grain" />
      <div className="brf-vignette" />
    </div>
  )
}

function Fill({ active, listening, done }: { active: boolean; listening: boolean; done: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!active || !listening) {
      el.style.transition = active ? 'transform 700ms var(--ease-out)' : 'none'
      el.style.transform = `scaleX(${done || active ? 1 : 0})`
      return
    }
    el.style.transition = 'none'
    let raf = 0
    const tick = () => {
      el.style.transform = `scaleX(${briefingPlayer.chapterProgress()})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, listening, done])
  return <span className="brf-seg-fill" ref={ref} />
}

function Caption({ chapter, player, following, wait }: { chapter: number; player: PlayerState; following: boolean; wait: string | null }) {
  const box = useRef<HTMLDivElement>(null)
  const ch = player.program?.chapters[chapter]
  const lines = following && ch && player.program ? player.program.lines.slice(ch.first, ch.first + ch.count) : []
  const at = player.line - (ch?.first ?? 0)
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('.is-now')
    if (el && box.current) box.current.scrollTo({ top: Math.max(0, el.offsetTop - box.current.clientHeight / 2 + el.clientHeight / 2), behavior: 'smooth' })
  }, [at, chapter])
  if (!following) return <div className="brf-caption is-idle">←  →  para navegar · espaço para ouvir</div>
  if (wait && !lines.some((_, i) => i <= at)) return <div className="brf-caption is-idle">{wait}</div>
  return (
    <div className="brf-caption is-lines" ref={box} aria-live="off">
      {lines.map((l, i) => (
        <span key={l.id + i} className={i < at || player.chapter > chapter ? 'is-said' : i === at && player.chapter === chapter ? 'is-now' : ''}>
          {l.text}{' '}
        </span>
      ))}
      {wait && <em className="brf-caption-wait"> {wait}</em>}
    </div>
  )
}

type ViewProps = { screen: Screen; edition: Edition; weather: Wx | null; minutes: number; total: number; onTriage: () => void; onRestart: () => void; onClose: () => void }

function ScreenView(p: ViewProps) {
  const s = p.screen
  if (s.kind === 'opening') return <Opening {...p} />
  if (s.kind === 'item') return <ItemScreen {...p} screen={s} />
  if (s.kind === 'market') return <MarketScreen edition={p.edition} />
  return <Closing {...p} screen={s} />
}

function Words({ text, base = 0, step = 38 }: { text: string; base?: number; step?: number }) {
  return (
    <>
      {text.split(/\s+/).filter(Boolean).map((w, i) => (
        <Fragment key={i}>
          <span className="brf-w" style={{ animationDelay: `${base + i * step}ms` }}>
            {w}
          </span>{' '}
        </Fragment>
      ))}
    </>
  )
}

const d = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` })

function Opening({ edition, weather, minutes, total }: ViewProps) {
  const counts = areaCounts(edition.items)
  const date = new Date(`${edition.date}T12:00:00`)
  const day = LONG_DAY.format(date)
  const hour = new Date().getHours()
  const hello = hour < 5 || hour >= 18 ? 'Boa noite' : hour < 12 ? 'Bom dia' : 'Boa tarde'
  return (
    <section className="brf-scr brf-open">
      <div className="brf-rise brf-kick" style={d(80)}>
        <span className="brf-kick-line" /> Briefing do dia
      </div>
      <h1 className="display brf-hello">
        <Words text={hello} base={160} step={90} />
      </h1>
      <p className="brf-rise brf-open-day" style={d(420)}>
        <span className="brf-cap">{day}</span>
        {weather && (
          <span className="brf-wx">
            {weather.city} · <b>{Math.round(weather.temp)}°</b> · {weather.label.toLowerCase()}
          </span>
        )}
      </p>
      <div className="brf-open-stat brf-rise" style={d(620)}>
        <span className="brf-big display">
          <CountUp value={total} format={(n) => String(Math.round(n))} duration={1300} delay={700} />
        </span>
        <span className="brf-open-stat-text">
          {total === 1 ? 'coisa que importa' : 'coisas que importam'}
          <br />
          desde ontem <em>· ≈ {minutes} min</em>
        </span>
      </div>
      <div className="brf-open-chips">
        {counts.map((c, i) => (
          <span key={c.area} className="brf-pop" style={d(980 + i * 90)}>
            <AreaChip area={c.area} count={c.count}>
              {AREA_LONG[c.area]}
            </AreaChip>
          </span>
        ))}
      </div>
      <p className="brf-rise brf-open-lede" style={d(1300)}>
        {edition.opening}
      </p>
    </section>
  )
}

const AGE = (iso: string | null) => {
  if (!iso) return ''
  const h = (Date.now() - Date.parse(iso)) / 36e5
  if (h < 1) return 'há menos de 1 h'
  if (h < 24) return `há ${Math.round(h)} h`
  const days = Math.round(h / 24)
  return days === 1 ? 'ontem' : `há ${days} dias`
}

function ItemScreen({ screen, edition, total }: ViewProps & { screen: Extract<Screen, { kind: 'item' }> }) {
  const it = screen.item
  const len = it.title.length
  const size = len < 48 ? 'is-xl' : len < 82 ? 'is-l' : 'is-m'
  return (
    <section className={`brf-scr brf-item brf-a-${it.area}`}>
      <span className="brf-ghost-num display" aria-hidden="true">
        {String(screen.index + 1).padStart(2, '0')}
      </span>
      <div className="brf-rise brf-item-kick" style={d(60)}>
        <AreaChip area={it.area}>{AREA_LONG[it.area]}</AreaChip>
        <span className="brf-muted">
          {screen.index + 1} de {total}
        </span>
        {edition.focusKey === it.key && <span className="brf-focus-tag">foco do dia</span>}
      </div>
      <h2 className={`display brf-title ${size}`}>
        <Words text={it.title} base={140} step={len > 80 ? 22 : 34} />
      </h2>
      <p className="brf-rise brf-why" style={d(520)}>
        <IconSpark /> <span>{it.why}</span>
      </p>
      {it.summary && (
        <p className="brf-rise brf-summary" style={d(640)}>
          {it.summary}
        </p>
      )}
      {it.action && (
        <div className="brf-rise brf-action" style={d(760)}>
          <span className="brf-action-k">O que fazer</span>
          {it.action}
        </div>
      )}
      <div className="brf-rise brf-item-foot" style={d(860)}>
        <button className="brf-source" onClick={() => void openExternal(it.url)} title="Abrir o original">
          <span>
            {it.source}
            {it.publishedAt ? ` · ${AGE(it.publishedAt)}` : ''}
            {it.otherSources.length > 0 ? ` · também em ${it.otherSources.slice(0, 2).join(', ')}${it.otherSources.length > 2 ? '…' : ''}` : ''}
          </span>
          <b>
            abrir original <IconExternal />
          </b>
        </button>
        <Interest item={it} origin="slide" variant="slide" />
      </div>
    </section>
  )
}

function MarketScreen({ edition }: { edition: Edition }) {
  const at = edition.marketAt ? TIME.format(new Date(edition.marketAt)) : null
  const sources = [...new Set(edition.market.map((q) => q.source))].join(', ')
  return (
    <section className="brf-scr brf-market">
      <div className="brf-rise brf-kick" style={d(60)}>
        <span className="brf-kick-line" /> Mercado{at ? ` · cotações das ${at}` : ''}
      </div>
      <h2 className="display brf-market-title">
        <Words text="O dinheiro, de relance" base={120} step={60} />
      </h2>
      <div className="brf-quotes">
        {edition.market.map((q, i) => (
          <QuoteTile key={q.id} q={q} delay={360 + i * 80} />
        ))}
      </div>
      <p className="brf-rise brf-fine" style={d(1100)}>
        Fontes: {sources}. Informação, não recomendação de investimento.
      </p>
    </section>
  )
}

function QuoteTile({ q, delay }: { q: Quote; delay: number }) {
  const dir = direction(q.changePct)
  const dec = decimalsOf(q)
  const { pre, post } = unitParts(q)
  const fmt = useCallback((n: number) => fmtNumber(n, dec), [dec])
  return (
    <div className={`brf-quote brf-rise is-${dir}`} style={d(delay)}>
      <span className="brf-quote-label">{q.label}</span>
      <span className="brf-quote-value display">
        <small>{pre}</small>
        <CountUp value={q.value} from={q.value * (q.unit === 'pct' ? 0.6 : 0.94)} format={fmt} duration={1400} delay={delay + 120} />
        <small>{post}</small>
      </span>
      <span className="brf-quote-delta">
        {q.changePct !== null ? (
          <>
            <span className={`brf-arrow is-${dir}`} aria-hidden="true" />
            {fmtChange(q.changePct)} <em>{periodLabel(q)}</em>
          </>
        ) : (
          <em>{periodLabel(q)}</em>
        )}
      </span>
    </div>
  )
}

function Closing({ screen, edition, onTriage, onRestart, onClose }: ViewProps & { screen: Extract<Screen, { kind: 'closing' }> }) {
  useEffect(() => markSeenEnd(edition.date), [edition.date])
  const f = screen.focus
  const triageCount = edition.items.length + edition.leftOut.length
  return (
    <section className={`brf-scr brf-close ${f ? `brf-a-${f.area}` : ''}`}>
      <div className="brf-rise brf-kick" style={d(60)}>
        <span className="brf-kick-line" /> Para hoje
      </div>
      <p className="brf-rise brf-close-lead" style={d(160)}>
        A coisa mais útil de hoje pra você
      </p>
      {f ? (
        <h2 className="display brf-title is-l brf-close-title">
          <Words text={f.title} base={300} step={36} />
        </h2>
      ) : (
        <h2 className="display brf-title is-l">Um dia tranquilo</h2>
      )}
      {f?.action && (
        <div className="brf-rise brf-action" style={d(780)}>
          <span className="brf-action-k">O que fazer hoje</span>
          {f.action}
        </div>
      )}
      <p className="brf-rise brf-summary" style={d(900)}>
        {edition.closing}
      </p>
      <div className="brf-rise" style={d(980)}>
        <RateBriefing edition={edition} variant="closing" />
      </div>
      <div className="brf-rise brf-close-actions" style={d(1050)}>
        <button className="btn primary" onClick={onTriage}>
          Triagem rápida ({triageCount})
        </button>
        <button className="btn" onClick={onRestart}>
          Ver de novo
        </button>
        <button className="btn quiet" onClick={onClose}>
          Fechar
        </button>
      </div>
      <p className="brf-rise brf-sign display" style={d(1250)}>
        Bom trabalho.
      </p>
    </section>
  )
}
