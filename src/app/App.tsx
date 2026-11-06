import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { errorStore } from '../shared/db/stores'
import { Wallpaper } from '../shared/themes/Wallpaper'
import {
  ACCENTS, DISPLAY_FONTS, TEXT_FONTS, THEMES, THEME_ORDER, initTheme, resetLook, setLook, setTheme, themeVars, useTheme, useThemeState,
  type DisplayFontId, type TextFontId, type ThemeId, type Tone,
} from '../shared/themes/themes'
import { Segmented } from '../shared/ui/Segmented'
import { isTauri } from '../shared/db/api'
import { CommandPalette } from './CommandPalette'
import { MorningIntro, shouldPlayIntro } from './MorningIntro'
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
}
const BibleReader = lazy(loaders.bible)
const Home = lazy(loaders.home)
const Habits = lazy(loaders.habits)
const Ideas = lazy(loaders.ideas)
const Work = lazy(loaders.work)
const Radar = lazy(loaders.radar)
const Notes = lazy(loaders.notes)

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
  const [toast, setToast] = useState<string | null>(null)
  const [intro, setIntro] = useState(() => shouldPlayIntro(route))
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
        const r = ROUTES.find((x) => x.key === k && x.ready)
        if (r) {
          e.preventDefault()
          navigate(r.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route])

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
        <button className="side-search" onClick={() => setPalette(true)} title="Comandos (⌘K)">
          <SearchIcon />
          <span className="side-label">Ir para…</span>
          <kbd className="side-label">⌘K</kbd>
        </button>
        <nav className="side-nav">
          <span className="side-indicator" style={{ transform: `translateY(${Math.max(0, ROUTES.findIndex((r) => r.id === route)) * 36}px)` }} />
          {ROUTES.map((r) => (
            <NavItem key={r.id} id={r.id} label={r.label} ready={r.ready} active={route === r.id} hotkey={r.key} />
          ))}
        </nav>
        <div className="side-bottom">
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
        </Suspense>
      </main>

      {themePicker && <ThemePicker onClose={() => setThemePicker(false)} />}
      {intro && <MorningIntro onDone={() => setIntro(false)} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} onToast={onToast} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function NavItem({ id, label, ready, active, hotkey }: { id: Route; label: string; ready: boolean; active: boolean; hotkey: string }) {
  return (
    <button
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
          {THEME_ORDER.map((id, i) => {
            const t = THEMES[id]
            return (
              <button
                key={id}
                className={`tp-theme reveal ${focus === id ? 'is-focus' : ''} ${st.theme === id ? 'is-on' : ''}`}
                style={{ ['--i' as string]: i }}
                onClick={(e) => {
                  setFocus(id)
                  if (st.theme !== id) withThemeTransition(e.clientX, e.clientY, () => setTheme(id))
                }}
              >
                <ThemePreview id={id} />
                <span className="tp-meta">
                  <span className="tp-name">{t.name}</span>
                  <span className="tp-tag">{t.tagline}</span>
                </span>
                {st.theme === id && <span className="tp-dot" aria-label="tema ativo" />}
              </button>
            )
          })}
          <p className="tp-foot">Cada tema guarda os próprios ajustes.</p>
        </aside>

        <section className="tp-detail">
          <div className="tp-head">
            <div>
              <div className="kicker">{THEMES[focus].name}</div>
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

            <section className="ap-section ap-sliders">
              <Slider label="Intensidade do fundo" value={look.depth} min={0} max={1} step={0.01} fmt={depthLabel} onChange={(v) => set({ depth: v })} />
              <Slider label="Contraste do texto" value={look.contrast} min={0} max={1} step={0.01} fmt={(v) => (v < 0.2 ? 'suave' : v > 0.8 ? 'forte' : `${Math.round(v * 100)}%`)} onChange={(v) => set({ contrast: v })} />
              <Slider label="Opacidade dos painéis" value={look.glass} min={0.4} max={1} step={0.01} fmt={(v) => (v >= 0.99 ? 'sólido' : `${Math.round(v * 100)}%`)} onChange={(v) => set({ glass: v })} />
              <Slider label="Arredondamento" value={look.radius} min={6} max={30} step={1} fmt={(v) => `${v}px`} onChange={(v) => set({ radius: v })} />
              <Slider
                label="Transparência da janela"
                value={look.window}
                min={0}
                max={0.7}
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

function ThemePreview({ id }: { id: ThemeId }) {
  const look = useThemeState().look[id]
  const vars = themeVars(id, look)
  return (
    <span className="tp-preview" style={vars as React.CSSProperties}>
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
