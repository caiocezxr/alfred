import { ResourceMeter } from './Meter'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { errorStore } from '../shared/db/stores'
import { Wallpaper } from '../shared/themes/Wallpaper'
import {
  ACCENTS, DISPLAY_FONTS, STYLES, TEXTURES, TEXT_FONTS, THEMES, THEME_ORDER, initTheme, resetLook, setLook, setStyle, setTheme, styleDef, themeVars, useTheme, useThemeState,
  type DisplayFontId, type StyleId, type Texture, type TextFontId, type ThemeId, type Tone,
} from '../shared/themes/themes'
import { Segmented } from '../shared/ui/Segmented'
import { isTauri } from '../shared/db/api'
import { CommandPalette } from './CommandPalette'
import { RitualGate } from './Ritual'
import { ProfileSwitch } from './ProfileSwitch'
import { PaletteIcon, RouteIcon, SearchIcon, SidebarIcon } from './Icons'
import { ROUTES, navigate, requestIntent, useRoute, withThemeTransition, type Route } from './router'
import './shell.css'

const loaders = {
  bible: () => import('../features/bible/BibleReader'),
  home: () => import('../features/home/Home'),
  habits: () => import('../features/habits/Habits'),
  ideas: () => import('../features/ideas/Ideas'),
  work: () => import('../features/work/Work'),
  radar: () => import('../features/radar/Radar'),
  notes: () => import('../features/notes/Notes'),
  oficina: () => import('../features/oficina/Oficina'),
}
const BibleReader = lazy(loaders.bible)
const Home = lazy(loaders.home)
const Habits = lazy(loaders.habits)
const Ideas = lazy(loaders.ideas)
const Work = lazy(loaders.work)
const Island = lazy(() => import('../features/work/Island'))
const Radar = lazy(loaders.radar)
const Notes = lazy(loaders.notes)
const Oficina = lazy(loaders.oficina)

function prefetchRoutes() {
  const queue = [loaders.work, loaders.habits, loaders.notes, loaders.ideas, loaders.radar, loaders.bible]
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  const idle = (cb: () => void) => (w.requestIdleCallback ? w.requestIdleCallback(cb, { timeout: 4000 }) : window.setTimeout(cb, 800))
  const next = () => {
    const load = queue.shift()
    if (load) idle(() => void load().catch(() => {}).finally(next))
  }
  window.setTimeout(next, 2500)
}

export function App() {
  const route = useRoute()
  const theme = useTheme()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ps.sidebar') === 'collapsed')
  const [palette, setPalette] = useState(false)
  const [themePicker, setThemePicker] = useState(false)
  const [hoverNav, setHoverNav] = useState<number | null>(null)
  const [pillAt, setPillAt] = useState<{ y: number; h: number; snap: boolean } | null>(null)
  const [activeAt, setActiveAt] = useState<{ y: number; h: number } | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [ritualOnHome] = useState(() => route === 'home')
  const error = useSyncExternalStore(errorStore.subscribe, errorStore.get)

  useEffect(() => {
    void initTheme()
    prefetchRoutes()
  }, [])
  useEffect(() => {
    localStorage.setItem('ps.sidebar', collapsed ? 'collapsed' : 'open')
  }, [collapsed])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      const k = e.key.toLowerCase()
      if (k === 'k' && !e.shiftKey) {
        e.preventDefault()
        setPalette((v) => !v)
      } else if (k === '\\') {
        e.preventDefault()
        setCollapsed((v) => !v)
      } else if (k === 'n') {
        e.preventDefault()
        if (route === 'habits') requestIntent('new-habit')
        else if (route === 'ideas') requestIntent('new-idea')
        else if (route === 'notes') requestIntent('new-note')
        else {
          if (route !== 'work') navigate('work')
          setTimeout(() => requestIntent('new-task'), 60)
        }
      } else if (k === ',') {
        e.preventDefault()
        setThemePicker((v) => !v)
      } else {
        const r = e.shiftKey ? undefined : ROUTES.find((x) => x.key === k && x.ready)
        if (r) {
          e.preventDefault()
          navigate(r.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route])

  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>(`[data-route="${route}"]`)
      setActiveAt(el ? { y: el.offsetTop, h: el.offsetHeight } : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [route, collapsed])

  useEffect(() => {
    if (!pillAt?.snap) return
    const id = requestAnimationFrame(() => setPillAt((p) => (p ? { ...p, snap: false } : p)))
    return () => cancelAnimationFrame(id)
  }, [pillAt?.snap])

  const onToast = useCallback((s: string) => setToast(s), [])
  const immersive = route === 'bible'

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''} ${immersive ? 'is-immersive' : ''}`} data-route={route}>
      {!immersive && <Wallpaper />}

      <aside className="sidebar" aria-label="Navegação">
        <div className="sidebar-top" data-tauri-drag-region>
          <button className="side-toggle" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'} title="⌘\">
            <SidebarIcon />
          </button>
        </div>
        <div className="side-profile">
          <ProfileSwitch compact={collapsed} />
        </div>
        <button className="side-search" onClick={() => setPalette(true)} title="Comandos (⌘K)">
          <SearchIcon />
          <span className="side-label">Ir para…</span>
          <kbd className="side-label">⌘K</kbd>
        </button>
        <nav className="side-nav" ref={navRef} onPointerLeave={() => setHoverNav(null)}>
          <span
            className={`side-hover ${pillAt?.snap ? 'is-snap' : ''}`}
            style={{ transform: `translateY(${pillAt?.y ?? 0}px)`, height: pillAt?.h ?? 42, opacity: hoverNav === null || !pillAt ? 0 : 1 }}
          />
          <span className="side-indicator" style={{ transform: `translateY(${activeAt?.y ?? 0}px)`, height: activeAt?.h ?? 42, opacity: activeAt ? 1 : 0 }} />
          {ROUTES.map((r, i) => (
            <NavItem
              key={r.id}
              id={r.id}
              label={r.label}
              ready={r.ready}
              active={route === r.id}
              hotkey={r.key}
              onHover={(el) => {
                setPillAt({ y: el.offsetTop, h: el.offsetHeight, snap: hoverNav === null })
                setHoverNav(i)
              }}
            />
          ))}
        </nav>
        <div className="side-bottom">
          <ResourceMeter compact={collapsed} />
          <button className={`side-item ${themePicker ? 'is-active' : ''}`} onClick={() => setThemePicker((v) => !v)} title="Tema (⌘,)">
            <PaletteIcon />
            <span className="side-label">{theme.name}</span>
          </button>
        </div>
      </aside>

      <main className="main" aria-live="polite">
        <div className="drag-strip" data-tauri-drag-region />
        {error && (
          <div className="banner" role="alert">
            <span>{error}</span>
            <button className="link" onClick={() => errorStore.set(null)}>Fechar</button>
          </div>
        )}
        <Suspense fallback={<RouteLoading />}>
          {route === 'home' && <Home />}
          {route === 'habits' && <Habits />}
          {route === 'bible' && <BibleReader />}
          {route === 'work' && <Work />}
          {route === 'ideas' && <Ideas />}
          {route === 'radar' && <Radar />}
          {route === 'notes' && <Notes />}
          {route === 'oficina' && <Oficina />}
        </Suspense>
      </main>

      {themePicker && <ThemePicker onClose={() => setThemePicker(false)} />}
      <RitualGate active={ritualOnHome} />
      {palette && <CommandPalette onClose={() => setPalette(false)} onToast={onToast} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      <Suspense fallback={null}>
        <Island />
      </Suspense>
    </div>
  )
}

function NavItem({ id, label, ready, active, hotkey, onHover }: { id: Route; label: string; ready: boolean; active: boolean; hotkey: string; onHover: (el: HTMLElement) => void }) {
  return (
    <button
      data-route={id}
      onPointerEnter={(e) => onHover(e.currentTarget)}
      className={`side-item ${active ? 'is-active' : ''} ${ready ? '' : 'is-soon'}`}
      onClick={() => navigate(id)}
      aria-current={active ? 'page' : undefined}
      title={ready ? `${label} (⌘${hotkey})` : `${label} — próxima etapa`}
    >
      <RouteIcon id={id} />
      <span className="side-label">{label}</span>
      {!ready && <span className="side-soon side-label">em breve</span>}
    </button>
  )
}

function ThemePicker({ onClose }: { onClose: () => void }) {
  const st = useThemeState()
  const [focus, setFocus] = useState<ThemeId>(st.theme)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const look = st.look[focus]
  const set = (patch: Parameters<typeof setLook>[1]) => setLook(focus, patch)
  const custom = !ACCENTS[focus].some((a) => a.color.toLowerCase() === look.accent.toLowerCase())
  const depthLabel = (v: number) => {
    const pct = Math.round(v * 100)
    if (focus === 'escuro') return pct >= 98 ? 'preto puro' : pct <= 5 ? 'grafite' : `${pct}%`
    return pct >= 98 ? 'branco puro' : pct <= 5 ? 'papel' : `${pct}%`
  }

  return (
    <div className="theme-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="theme-picker" role="dialog" aria-label="Aparência">
        <aside className="tp-themes">
          <h2>Aparência</h2>
          <div className="tp-mode" role="radiogroup" aria-label="Modo">
            {THEME_ORDER.map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={st.theme === id}
                className={st.theme === id ? 'is-on' : ''}
                onClick={(e) => {
                  setFocus(id)
                  if (st.theme !== id) withThemeTransition(e.clientX, e.clientY, () => setTheme(id))
                }}
              >
                {id === 'claro' ? <SunGlyph /> : <MoonGlyph />}
                {THEMES[id].name}
              </button>
            ))}
          </div>
          <div className="tp-styles">
            {STYLES.map((sd, i) => (
              <button
                key={sd.id}
                className={`tp-theme reveal ${st.style === sd.id ? 'is-on is-focus' : ''}`}
                style={{ ['--i' as string]: i }}
                onClick={(e) => {
                  if (st.style !== sd.id) withThemeTransition(e.clientX, e.clientY, () => setStyle(sd.id))
                }}
              >
                <ThemePreview id={st.theme} style={sd.id} />
                <span className="tp-meta">
                  <span className="tp-name">{sd.name}</span>
                  <span className="tp-tag">{sd.tagline}</span>
                </span>
                {st.style === sd.id && <span className="tp-dot" aria-label="estilo ativo" />}
              </button>
            ))}
          </div>
          <p className="tp-foot">Cada estilo tem versão clara e escura, e guarda os próprios ajustes.</p>
        </aside>

        <section className="tp-detail">
          <div className="tp-head">
            <div>
              <div className="kicker">
                {styleDef(st.style).name} · {THEMES[focus].name}
              </div>
              <h3>Ajuste do seu jeito</h3>
            </div>
            <div className="tp-head-actions">
              <button className="link" onClick={() => resetLook(focus)}>Restaurar</button>
              <button className="icon-btn" onClick={onClose} aria-label="Fechar">×</button>
            </div>
          </div>

          <div className="ap-body">
            <section className="ap-section">
              <h4>Cor de destaque</h4>
              <div className="ap-swatches" role="radiogroup" aria-label="Cor de destaque">
                {ACCENTS[focus].map((a) => (
                  <button
                    key={a.color}
                    role="radio"
                    aria-checked={look.accent.toLowerCase() === a.color.toLowerCase()}
                    className="ap-swatch"
                    style={{ ['--sw' as string]: a.color }}
                    onClick={() => set({ accent: a.color })}
                    title={a.label}
                    aria-label={a.label}
                  />
                ))}
                <label className={`ap-swatch is-custom ${custom ? 'is-on' : ''}`} title="Outra cor" style={{ ['--sw' as string]: look.accent }}>
                  <input type="color" value={look.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Escolher outra cor" />
                </label>
              </div>
            </section>

            <section className="ap-section">
              <h4>Fonte dos títulos</h4>
              <div className="ap-fonts">
                {(Object.keys(DISPLAY_FONTS) as DisplayFontId[]).map((f) => {
                  const d = DISPLAY_FONTS[f]
                  return (
                    <button key={f} className={`ap-font ${look.display === f ? 'is-on' : ''}`} onClick={() => set({ display: f })} aria-pressed={look.display === f}>
                      <span className="ap-font-sample" style={{ fontFamily: d.family, fontWeight: Number(d.weight), letterSpacing: d.tracking, fontSizeAdjust: d.adjust }}>
                        Bom dia
                      </span>
                      <span className="ap-font-name">
                        {d.label} <em>{d.note}</em>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="ap-section ap-row">
              <h4>Fonte do texto</h4>
              <Segmented<TextFontId>
                label="Fonte do texto"
                value={look.text}
                options={(Object.keys(TEXT_FONTS) as TextFontId[]).map((f) => ({ id: f, label: TEXT_FONTS[f].label }))}
                onChange={(v) => set({ text: v })}
              />
            </section>

            <section className="ap-section ap-row">
              <h4>Tom do fundo</h4>
              <Segmented<Tone>
                label="Tom do fundo"
                value={look.tone}
                options={[
                  { id: 'neutro', label: 'Neutro' },
                  { id: 'quente', label: 'Quente' },
                  { id: 'frio', label: 'Frio' },
                ]}
                onChange={(v) => set({ tone: v })}
              />
            </section>

            <section className="ap-section ap-row">
              <h4>Textura do fundo</h4>
              <Segmented<Texture>
                label="Textura do fundo"
                value={look.texture}
                options={TEXTURES.map((t) => ({ id: t.id, label: t.label }))}
                onChange={(v) => set({ texture: v, grain: look.grain < 0.05 && v !== 'liso' ? 0.35 : look.grain })}
              />
            </section>

            {look.texture !== 'liso' && (
              <section className="ap-section ap-sliders">
                <Slider label="Granulado" value={look.grain} min={0} max={1} step={0.01} fmt={(v) => (v < 0.01 ? 'nenhum' : `${Math.round(v * 100)}%`)} onChange={(v) => set({ grain: v })} />
                <Slider label="Tamanho do grão" value={look.grainSize} min={0} max={1} step={0.01} fmt={(v) => (v < 0.25 ? 'fino' : v > 0.75 ? 'grosso' : 'médio')} onChange={(v) => set({ grainSize: v })} />
              </section>
            )}

            <section className="ap-section ap-sliders">
              <Slider label="Intensidade do fundo" value={look.depth} min={0} max={1} step={0.01} fmt={depthLabel} onChange={(v) => set({ depth: v })} />
              <Slider label="Contraste do texto" value={look.contrast} min={0} max={1} step={0.01} fmt={(v) => (v < 0.2 ? 'suave' : v > 0.8 ? 'forte' : `${Math.round(v * 100)}%`)} onChange={(v) => set({ contrast: v })} />
              <Slider label="Opacidade dos painéis" value={look.glass} min={0.4} max={1} step={0.01} fmt={(v) => (v >= 0.99 ? 'sólido' : `${Math.round(v * 100)}%`)} onChange={(v) => set({ glass: v })} />
              <Slider label="Arredondamento" value={look.radius} min={6} max={30} step={1} fmt={(v) => `${v}px`} onChange={(v) => set({ radius: v })} />
              <Slider
                label="Transparência da janela"
                value={look.window}
                min={0}
                max={0.85}
                step={0.01}
                fmt={(v) => (v < 0.01 ? 'sólida' : `${Math.round(v * 100)}%`)}
                onChange={(v) => set({ window: v })}
              />
              <p className="ap-note">
                {isTauri
                  ? 'Deixa ver a mesa do Mac por trás, desfocada como vidro fosco.'
                  : 'A transparência da janela aparece no app instalado; aqui no navegador a janela fica sólida.'}
              </p>
            </section>
          </div>
        </section>
      </div>
    </div>
  )
}

function ThemePreview({ id, style }: { id: ThemeId; style: StyleId }) {
  const st = useThemeState()
  const look = (st.looks[style] ?? styleDef(style))[id]
  const vars = themeVars(id, look, style)
  return (
    <span className={`tp-preview is-${style}`} style={vars as React.CSSProperties}>
      <span className="tpp-kicker" />
      <span className="tpp-title">Bom dia</span>
      <span className="tpp-card">
        <span className="tpp-line" />
        <span className="tpp-line is-short" />
        <span className="tpp-pill" />
      </span>
    </span>
  )
}

function SunGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  )
}

function MoonGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z" />
    </svg>
  )
}

function Slider({ label, value, min, max, step, fmt, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="slider">
      <span className="slider-top">
        <span>{label}</span>
        <span className="slider-val">{fmt(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </label>
  )
}

function RouteLoading() {
  return (
    <div className="route-loading" aria-busy="true" aria-label="Carregando">
      <i className="rl-kicker" />
      <i className="rl-title" />
      <i className="rl-block" />
      <i className="rl-block is-short" />
    </div>
  )
}
