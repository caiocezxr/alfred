import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { navigate, requestIntent } from '../../app/router'
import { civil, fmtLong } from '../../shared/dates'
import { isScheduled, setCheckin, useHabits } from '../../shared/db/stores'
import { openWorkItem, toggleTodo, useWorkToday, type TodayEntry } from '../work/today'
import { homeCity } from './geo'
import { describe, useWeather, type Weather } from './weather'
import BriefingCard from '../briefing/BriefingCard'
import { MoodChip } from '../mood/CheckIn'
import { openRitual } from '../../app/Ritual'
import { MoodYear } from '../mood/MoodYear'
import { greetingFor, loadNicks, saveNicks, type Period } from '../../shared/greeting'
import { SplitFlap } from './SplitFlap'
import { WorkCockpit } from './WorkCockpit'
import { LiveSky } from './LiveSky'
import { DayClock } from './DayClock'
import './home.css'

function useClock(ms = 15000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export default function Home() {
  const now = useClock()
  const today = civil(now)
  const work = useWorkToday()
  const sky = useWeather()
  const { habits, checkins } = useHabits()
  const home = useMemo(() => homeCity(), [])
  const [nickTick, setNickTick] = useState(0)
  const g = useMemo(() => greetingFor(now), [now, nickTick])
  const period = g.period
  const [year, setYear] = useState(false)
  const [editNicks, setEditNicks] = useState(false)

  const top = work.items.slice(0, 6)
  const todays = habits.filter((h) => isScheduled(h, today))
  const statusOf = (id: string) => checkins.find((c) => c.habitId === id && c.date === today)?.status ?? null
  const doneHabits = todays.filter((h) => statusOf(h.id)).length

  const hero = (
    <header className="h-hero reveal" style={{ ['--i' as string]: 0 }}>
      <div className="kicker">{fmtLong.format(now)}</div>
      <h1 className="display home-hello">
        <span className="hello-main">{g.hello},</span>
        <span className="hello-nick">
          <button className="hello-nick-btn" onClick={() => setEditNicks(true)} title="Editar apelidos">
            <SplitFlap text={g.nick} replay={nickTick} />
          </button>
          <PeriodIcon period={period} />
        </span>
      </h1>
      <p className="home-micro">
        <DayClock city={home} />
        {todays.length > 0 && (
          <>
            <span className="sep" aria-hidden="true" />
            <span>
              {doneHabits} de {todays.length} hábitos feitos
            </span>
          </>
        )}
      </p>
      <MoodChip onOpen={openRitual} onOpenYear={() => setYear(true)} />
    </header>
  )

  const openEntry = (e: TodayEntry) => {
    if (e.itemId) openWorkItem(e.itemId)
    navigate('work')
  }

  const todayCard = (
    <section className={`panel home-today is-${work.health.level} reveal`} style={{ ['--i' as string]: 2 }}>
      <div className="panel-head">
        <h2>Hoje</h2>
        <button
          className="btn quiet sm"
          onClick={() => {
            navigate('work')
            setTimeout(() => requestIntent('new-task'), 80)
          }}
        >
          + To-do
        </button>
      </div>
      {work.loaded && work.health.total > 0 && (
        <button className="home-health" onClick={() => navigate('work')} title="Abrir a Workstation">
          <span className="home-health-bar">
            <i style={{ transform: `scaleX(${work.health.progress})` }} />
          </span>
          <span className="home-health-label">{work.health.label}</span>
        </button>
      )}
      {top.length === 0 && todays.length === 0 ? (
        <p className="home-empty">{work.loaded ? 'Tudo verde por aqui. Os to-dos do dia, prazos e o que não pode esquecer aparecem aqui.' : ' '}</p>
      ) : (
        top.length > 0 && (
          <ul className="home-tasks">
            {top.map((t) => (
              <li key={t.id} className={`is-${t.kind}`} style={{ ['--co' as string]: t.color }}>
                {t.todoId ? (
                  <button className={`check ${t.done ? 'is-on' : ''}`} onClick={() => toggleTodo(t.todoId!)} aria-label={`Concluir ${t.title}`}>
                    {t.done && <Tick />}
                  </button>
                ) : (
                  <span className="home-co" aria-hidden="true" />
                )}
                <button className="home-task-body" onClick={() => openEntry(t)}>
                  <span className="home-task-title">{t.title}</span>
                  {t.detail && <span className={`home-due ${t.late ? 'is-late' : ''}`}>{t.detail}</span>}
                </button>
                {t.kind === 'forget' && <span className="home-flag" title="Não pode esquecer" />}
              </li>
            ))}
          </ul>
        )
      )}
      {todays.length > 0 && (
        <div className="home-habits">
          {todays.map((h) => {
            const st = statusOf(h.id)
            return (
              <button
                key={h.id}
                className={`habit-chip ${st ? `is-${st}` : ''}`}
                onClick={() => setCheckin(h.id, today, st === 'done' ? 'minimum' : st === 'minimum' ? null : 'done')}
                title={st === 'done' ? 'Feito · clique para "versão mínima"' : st === 'minimum' ? 'Versão mínima · clique para desmarcar' : 'Marcar como feito'}
              >
                <span className="habit-dot" />
                {h.name}
                {st === 'minimum' && <em>mínimo</em>}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )

  return (
    <div className="home">
      <LiveSky weather={sky.data?.[0] ?? null} />
      {year && <MoodYear onClose={() => setYear(false)} />}
      {editNicks && (
        <NickEditor
          onClose={(changed) => {
            setEditNicks(false)
            if (changed) setNickTick((n) => n + 1)
          }}
        />
      )}
      <div className="home-wrap">
        <div className="home-left">
          {hero}
          <div className="home-main">
            <BriefingCard />
          </div>
        </div>
        <aside className="home-right">
          <WeatherCard />
          <WorkCockpit />
          {todayCard}
        </aside>
      </div>
    </div>
  )
}

function NickEditor({ onClose }: { onClose: (changed: boolean) => void }) {
  const [text, setText] = useState(() => loadNicks().join('\n'))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="nick-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="nick-panel" role="dialog" aria-label="Apelidos da saudação">
        <div className="kicker">Saudação</div>
        <h3>Como o app te chama</h3>
        <p>Um apelido por linha. A cada dia sai um diferente, e nunca repete o de ontem.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} autoFocus />
        <div className="nick-actions">
          <button className="btn quiet" onClick={() => onClose(false)}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={() => {
              saveNicks(text.split('\n'))
              onClose(true)
            }}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PeriodIcon({ period }: { period: Period }) {
  if (period === 'noite') {
    return (
      <svg className="period-icon is-moon" viewBox="0 0 48 48" role="img" aria-label="noite">
        <defs>
          <radialGradient id="pi-moon-glow" cx="50%" cy="50%" r="50%">
            <stop className="moon-glow-stop" offset="35%" stopColor="#dfe6ff" stopOpacity="0.4" />
            <stop className="moon-glow-stop" offset="100%" stopColor="#dfe6ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="pi-moon" x1="0" y1="0" x2="1" y2="1">
            <stop className="moon-a" offset="0%" stopColor="#ffffff" />
            <stop className="moon-b" offset="100%" stopColor="#c9d3ee" />
          </linearGradient>
        </defs>
        <circle className="moon-glow" cx="24" cy="24" r="23" fill="url(#pi-moon-glow)" />
        <path d="M31 34.5A12.5 12.5 0 0 1 20.2 13a12.8 12.8 0 1 0 15.6 17.2A12.4 12.4 0 0 1 31 34.5z" fill="url(#pi-moon)" />
        <circle className="star s1" cx="38" cy="12" r="1.3" fill="#fff" />
        <circle className="star s2" cx="10" cy="34" r="1.1" fill="#fff" />
      </svg>
    )
  }
  if (period === 'entardecer') {
    return (
      <svg className="period-icon is-sunset" viewBox="0 0 48 48" role="img" aria-label="fim de tarde">
        <defs>
          <linearGradient id="pi-dusk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffcf6b" />
            <stop offset="100%" stopColor="#ff7a45" />
          </linearGradient>
          <clipPath id="pi-horizon">
            <rect x="0" y="0" width="48" height="31" />
          </clipPath>
        </defs>
        <g className="dusk-rays" stroke="#ffb35c" strokeWidth="2.4" strokeLinecap="round">
          <path d="M24 6.5v5M11 12l3.4 3.4M37 12l-3.4 3.4M4.5 24.5h5M38.5 24.5h5" />
        </g>
        <circle className="dusk-sun" cx="24" cy="31" r="11" fill="url(#pi-dusk)" clipPath="url(#pi-horizon)" />
        <path d="M6 31h36" stroke="#ff8f52" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M13 36.5h22M19 41.5h10" stroke="#ff8f52" strokeWidth="2.2" strokeLinecap="round" opacity="0.65" />
      </svg>
    )
  }
  return (
    <svg className="period-icon is-sun" viewBox="0 0 48 48" role="img" aria-label={period === 'manha' ? 'manhã' : 'tarde'}>
      <defs>
        <radialGradient id="pi-sun" cx="40%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#ffe08a" />
          <stop offset="100%" stopColor="#ffae2e" />
        </radialGradient>
      </defs>
      <g className="sun-rays" stroke="#ffbe3d" strokeWidth="2.6" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return <line key={i} x1={24 + Math.cos(a) * 14.5} y1={24 + Math.sin(a) * 14.5} x2={24 + Math.cos(a) * 20} y2={24 + Math.sin(a) * 20} />
        })}
      </g>
      <circle cx="24" cy="24" r="9.5" fill="url(#pi-sun)" />
    </svg>
  )
}

function useMinuteTick() {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), 60000)
    return () => clearInterval(id)
  }, [])
}

function WeatherCard({ compact = false }: { compact?: boolean }) {
  const { data, at, error, loading, refresh } = useWeather()
  useMinuteTick()
  const ago = at ? Math.round((Date.now() - at) / 60000) : null
  const when = ago === null ? '' : ago < 1 ? 'atualizado agora' : ago < 60 ? `atualizado há ${ago} min` : `atualizado há ${Math.round(ago / 60)} h`
  return (
    <section className={`panel wx reveal ${compact ? 'is-compact' : ''}`} style={{ ['--i' as string]: 1 }} aria-label="Clima em Fortaleza e Recife">
      {data ? (
        <div className="wx-cities">
          {data.map((w) => (
            <WeatherCity key={w.city} w={w} compact={compact} />
          ))}
        </div>
      ) : (
        <p className="wx-empty">{loading || !error ? 'Buscando o clima…' : 'Sem conexão para buscar o clima agora.'}</p>
      )}
      <footer className="wx-foot">
        <span>
          {error && data ? 'sem conexão · ' : ''}
          {when}
        </span>
        <button className="wx-refresh" onClick={() => void refresh()} disabled={loading} aria-label="Atualizar clima">
          <svg className={loading ? 'is-spinning' : ''} width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 2.5V5H11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </footer>
    </section>
  )
}

function WeatherCity({ w, compact }: { w: Weather; compact: boolean }) {
  const d = describe(w.code)
  return (
    <div className="wx-city">
      <div className="wx-name">{w.city}</div>
      <div className="wx-main">
        <WeatherIcon kind={d.icon} night={!w.isDay} />
        <span className="wx-temp">
          <CountUp value={Math.round(w.temp)} />°
        </span>
      </div>
      <div className="wx-desc">{d.label}</div>
      {!compact && (
        <div className="wx-meta">
          <span>
            <b>{Math.round(w.max)}°</b> / {Math.round(w.min)}°
          </span>
          <span title="Chance de chuva hoje">
            <Drop /> {w.rain}%
          </span>
          <span title="Sensação térmica">sensação {Math.round(w.feels)}°</span>
        </div>
      )}
    </div>
  )
}

function WeatherIcon({ kind, night }: { kind: ReturnType<typeof describe>['icon']; night: boolean }) {
  const sky = night ? (
    <path className="wx-moon" d="M24 25.5a8.6 8.6 0 0 1-8-11.8 9.3 9.3 0 1 0 11.4 11.1 8.6 8.6 0 0 1-3.4.7z" fill="#e8ecfa" />
  ) : (
    <g>
      <g stroke="#ffbe3d" strokeWidth="2" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return <line key={i} x1={19 + Math.cos(a) * 10} y1={18 + Math.sin(a) * 10} x2={19 + Math.cos(a) * 13.5} y2={18 + Math.sin(a) * 13.5} />
        })}
      </g>
      <circle cx="19" cy="18" r="7" fill="#ffc24a" />
    </g>
  )
  const cloud = (dx = 0, dy = 0, tone: 'light' | 'mid' | 'dark' = 'light') => (
    <path
      className={`wx-cloud is-${tone}`}
      transform={`translate(${dx} ${dy})`}
      d="M14 36h21a7.5 7.5 0 0 0 .4-15 10 10 0 0 0-19.2 2.6A6.2 6.2 0 0 0 14 36z"
      fill={tone === 'light' ? '#eef1f6' : tone === 'mid' ? '#dfe4ec' : '#d3d9e3'}
    />
  )
  return (
    <svg className="wx-icon" viewBox="0 0 48 48" aria-hidden="true">
      {(kind === 'sun' || kind === 'partly') && sky}
      {kind === 'partly' && cloud(5, 4)}
      {(kind === 'cloud' || kind === 'fog') && cloud(0, -2, 'mid')}
      {kind === 'fog' && <path d="M10 40h28M15 44.5h18" stroke="#c9cfd9" strokeWidth="2.2" strokeLinecap="round" />}
      {(kind === 'drizzle' || kind === 'rain' || kind === 'storm') && cloud(0, -6, 'dark')}
      {(kind === 'drizzle' || kind === 'rain') && (
        <g stroke="#69b4ff" strokeWidth="2.3" strokeLinecap="round" opacity={kind === 'drizzle' ? 0.65 : 1}>
          <path d="M18 35l-2 5.5M25 35l-2 5.5M32 35l-2 5.5" />
        </g>
      )}
      {kind === 'storm' && <path d="M26 31l-6 8h5l-3 7 8-10h-5l3-5z" fill="#ffd166" />}
    </svg>
  )
}

function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(() => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? value : Math.max(0, value - 12)))
  const from = useRef(shown)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      const v = Math.round(a + (value - a) * e)
      setShown(v)
      from.current = v
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return <>{shown}</>
}

const Drop = () => (
  <svg width="9" height="11" viewBox="0 0 9 11" aria-hidden="true" style={{ verticalAlign: '-1px' }}>
    <path d="M4.5.8C3 3 1 5 1 7a3.5 3.5 0 0 0 7 0C8 5 6 3 4.5.8z" fill="#69b4ff" />
  </svg>
)

const Tick = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
