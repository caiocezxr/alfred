import { useSyncExternalStore } from 'react'
import { api, isTauri } from '../db/api'

export type ThemeId = 'claro' | 'escuro'

export type Theme = { id: ThemeId; name: string; tagline: string; scheme: 'light' | 'dark' }

export const THEMES: Record<ThemeId, Theme> = {
  claro: { id: 'claro', name: 'Claro', tagline: 'Papel luminoso e tinta escura', scheme: 'light' },
  escuro: { id: 'escuro', name: 'Escuro', tagline: 'Preto profundo e marfim', scheme: 'dark' },
}

export const THEME_ORDER: ThemeId[] = ['claro', 'escuro']

export type DisplayFontId = 'cormorant' | 'garamond' | 'fraunces' | 'bodoni' | 'josefin' | 'sistema' | 'instrument' | 'unbounded' | 'syne'
export type TextFontId = 'sistema' | 'arredondada' | 'serifada'
export type Tone = 'neutro' | 'quente' | 'frio'

export const DISPLAY_FONTS: Record<DisplayFontId, { label: string; note: string; family: string; weight: string; tracking: string; adjust?: string }> = {
  cormorant: { label: 'Cormorant', note: 'clássica, acento alto', family: "'Cormorant Garamond', 'EB Garamond', Georgia, serif", weight: '500', tracking: '0.005em' },
  garamond: { label: 'Garamond', note: 'de livro', family: "'EB Garamond', Georgia, serif", weight: '400', tracking: '0' },
  fraunces: { label: 'Fraunces', note: 'editorial', family: "'Fraunces', Georgia, serif", weight: '600', tracking: '-0.015em' },
  bodoni: { label: 'Bodoni', note: 'alta-costura', family: "'Bodoni Moda', Didot, Georgia, serif", weight: '500', tracking: '0.01em' },
  josefin: { label: 'Josefin', note: 'geométrica', family: "'Josefin Sans', Futura, system-ui, sans-serif", weight: '300', tracking: '0.02em' },
  sistema: { label: 'SF Pro', note: 'do sistema', family: "-apple-system, 'SF Pro Display', system-ui, sans-serif", weight: '600', tracking: '-0.025em' },
  instrument: { label: 'Instrument', note: 'editorial ousada', family: "'Instrument Serif', 'Cormorant Garamond', Georgia, serif", weight: '400', tracking: '-0.01em' },
  unbounded: { label: 'Unbounded', note: 'futurista', family: "'Unbounded', system-ui, sans-serif", weight: '500', tracking: '-0.02em', adjust: '0.37' },
  syne: { label: 'Syne', note: 'artística', family: "'Syne', system-ui, sans-serif", weight: '700', tracking: '-0.02em', adjust: '0.4' },
}

export const TEXT_FONTS: Record<TextFontId, { label: string; family: string }> = {
  sistema: { label: 'SF Pro', family: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" },
  arredondada: { label: 'Arredondada', family: "ui-rounded, 'SF Pro Rounded', -apple-system, system-ui, sans-serif" },
  serifada: { label: 'Serifada', family: "'Iowan Old Style', 'EB Garamond', Georgia, serif" },
}

export const ACCENTS: Record<ThemeId, { label: string; color: string }[]> = {
  claro: [
    { label: 'Bronze', color: '#8c6a3a' },
    { label: 'Grafite', color: '#334155' },
    { label: 'Azul', color: '#2563eb' },
    { label: 'Verde', color: '#2f7d5b' },
    { label: 'Vinho', color: '#9b2c3a' },
    { label: 'Violeta', color: '#6d4fc2' },
    { label: 'Laranja', color: '#c2571a' },
  ],
  escuro: [
    { label: 'Champanhe', color: '#d6c19c' },
    { label: 'Ouro', color: '#e3b25a' },
    { label: 'Gelo', color: '#8ab4ff' },
    { label: 'Menta', color: '#6fd3b0' },
    { label: 'Rosa', color: '#ff8fb3' },
    { label: 'Lilás', color: '#b9a3ff' },
    { label: 'Coral', color: '#ff8a65' },
  ],
}

export type Appearance = {
  accent: string
  display: DisplayFontId
  text: TextFontId
  glass: number
  depth: number
  tone: Tone
  contrast: number
  radius: number
  window: number
}

export const DEFAULT_LOOK: Record<ThemeId, Appearance> = {
  claro: { accent: '#8c6a3a', display: 'instrument', text: 'sistema', glass: 0.8, depth: 0.35, tone: 'quente', contrast: 0.5, radius: 20, window: 0 },
  escuro: { accent: '#d6c19c', display: 'instrument', text: 'sistema', glass: 0.72, depth: 1, tone: 'neutro', contrast: 0.5, radius: 20, window: 0 },
}

type RGB = [number, number, number]
const hex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  const n = m ? parseInt(m[1], 16) : 0x888888
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number) => {
  const x = hex(a)
  const y = hex(b)
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}
const luminance = (h: string) => {
  const c = hex(h).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const rgba = (h: string, a: number) => {
  const [r, g, b] = hex(h)
  return `rgba(${r},${g},${b},${a.toFixed(3)})`
}

const DARK = {
  soft: { neutro: '#161618', quente: '#18140f', frio: '#11151b' },
  deep: { neutro: '#000000', quente: '#050302', frio: '#020407' },
  text: { neutro: '#f4f2ee', quente: '#f6efe4', frio: '#edf2f8' },
}
const LIGHT = {
  soft: { neutro: '#ececea', quente: '#f1eadf', frio: '#e7edf3' },
  bright: { neutro: '#ffffff', quente: '#fffdf8', frio: '#fbfdff' },
  text: { neutro: '#18181a', quente: '#1b1814', frio: '#141a22' },
}

export function themeVars(id: ThemeId, a: Appearance): Record<string, string> {
  const c = Math.min(1, Math.max(0, a.contrast))
  const font = DISPLAY_FONTS[a.display] ?? DISPLAY_FONTS.cormorant
  const common = {
    '--accent': a.accent,
    '--accent-ink': luminance(a.accent) > 0.36 ? '#14100a' : '#ffffff',
    '--font-display': font.family,
    '--display-weight': font.weight,
    '--display-tracking': font.tracking,
    '--display-case': 'none',
    '--display-adjust': font.adjust ?? 'none',
    '--font-ui': (TEXT_FONTS[a.text] ?? TEXT_FONTS.sistema).family,
    '--radius-lg': `${Math.round(a.radius)}px`,
    '--radius': `${Math.round(a.radius * 0.6)}px`,
    '--win-solid': `${Math.round((isTauri ? 1 - a.window : 1) * 100)}%`,
    '--win-opacity': String(isTauri ? 1 - a.window : 1),
  }
  if (id === 'escuro') {
    const bg = mix(DARK.soft[a.tone], DARK.deep[a.tone], a.depth)
    const text = DARK.text[a.tone]
    return {
      ...common,
      '--scheme': 'dark',
      '--bg': bg,
      '--surface-solid': mix(bg, text, 0.05),
      '--surface-hover': rgba(text, 0.055),
      '--text': text,
      '--text-2': mix(text, bg, 0.6 - 0.3 * c),
      '--border': rgba(text, 0.06 + 0.06 * c),
      '--hairline': rgba(text, 0.07 + 0.06 * c),
      '--highlight': rgba(text, 0.07),
      '--shadow': 'rgba(0,0,0,0.8)',
      '--scrim-overlay': 'rgba(0,0,0,0.36)',
      '--accent-2': '#e0574d',
      '--warn': '#ff8a73',
      '--backdrop': `radial-gradient(120% 100% at 80% 8%, ${mix(bg, text, 0.045)} 0%, ${bg} 55%, ${bg} 100%)`,
    }
  }
  const bg = mix(LIGHT.soft[a.tone], LIGHT.bright[a.tone], a.depth)
  const text = LIGHT.text[a.tone]
  return {
    ...common,
    '--scheme': 'light',
    '--bg': bg,
    '--surface-solid': mix(bg, '#ffffff', 0.85),
    '--surface-hover': rgba(text, 0.05),
    '--text': text,
    '--text-2': mix(text, bg, 0.52 - 0.3 * c),
    '--border': rgba(text, 0.07 + 0.07 * c),
    '--hairline': rgba(text, 0.07 + 0.06 * c),
    '--highlight': 'rgba(255,255,255,0.9)',
    '--shadow': rgba(mix(text, '#7a5a2a', 0.5), 0.16),
    '--scrim-overlay': rgba(text, 0.16),
    '--accent-2': '#b3261e',
    '--warn': '#c2412c',
    '--backdrop': `radial-gradient(120% 100% at 80% 8%, ${mix(bg, '#ffffff', 0.8)} 0%, ${bg} 50%, ${mix(bg, text, 0.04)} 100%)`,
  }
}

type State = { theme: ThemeId; fontV?: number; look: Record<ThemeId, Appearance> }

const LS_KEY = 'ps.theme.v3'
const LEGACY_KEY = 'ps.theme.v2'

const clean = (id: ThemeId, a: Partial<Appearance> | undefined): Appearance => {
  const d = DEFAULT_LOOK[id]
  const v = { ...d, ...(a ?? {}) }
  return {
    accent: /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : d.accent,
    display: v.display in DISPLAY_FONTS ? v.display : d.display,
    text: v.text in TEXT_FONTS ? v.text : d.text,
    glass: Number.isFinite(v.glass) ? Math.min(1, Math.max(0.4, v.glass)) : d.glass,
    depth: Number.isFinite(v.depth) ? Math.min(1, Math.max(0, v.depth)) : d.depth,
    tone: v.tone === 'neutro' || v.tone === 'quente' || v.tone === 'frio' ? v.tone : d.tone,
    contrast: Number.isFinite(v.contrast) ? Math.min(1, Math.max(0, v.contrast)) : d.contrast,
    radius: Number.isFinite(v.radius) ? Math.min(30, Math.max(6, v.radius)) : d.radius,
    window: Number.isFinite(v.window) ? Math.min(0.7, Math.max(0, v.window)) : d.window,
  }
}

function parse(d: unknown): State | null {
  if (!d || typeof d !== 'object') return null
  const o = d as { theme?: string; look?: Record<string, Partial<Appearance>>; prefs?: { glass?: number } }
  const theme: ThemeId = o.theme === 'claro' ? 'claro' : 'escuro'
  if (o.look) {
    const fresh = (o as { fontV?: number }).fontV !== 2
    const fix = (a: Appearance): Appearance => (fresh && a.display === 'cormorant' ? { ...a, display: 'instrument' } : a)
    return { theme, fontV: 2, look: { claro: fix(clean('claro', o.look.claro)), escuro: fix(clean('escuro', o.look.escuro)) } }
  }
  const glass = o.prefs?.glass
  return {
    theme,
    look: { claro: clean('claro', glass ? { glass } : undefined), escuro: clean('escuro', glass ? { glass } : undefined) },
  }
}

function loadState(): State {
  for (const key of [LS_KEY, LEGACY_KEY]) {
    try {
      const s = parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
      if (s) return s
    } catch {
    }
  }
  return { theme: 'escuro', look: { claro: DEFAULT_LOOK.claro, escuro: DEFAULT_LOOK.escuro } }
}

let state = loadState()
const listeners = new Set<() => void>()
let persistTimer = 0

function commit(next: State) {
  state = next
  applyTheme()
  for (const l of listeners) l()
  clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
    void api.settingSet('theme', JSON.stringify(state)).catch(() => {})
  }, 250)
}

export function applyTheme() {
  const id = state.theme
  const root = document.documentElement
  const vars = themeVars(id, state.look[id])
  root.dataset.theme = id
  root.dataset.scheme = vars['--scheme']
  root.style.colorScheme = vars['--scheme']
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  const glass = state.look[id].glass
  root.style.setProperty('--glass', String(glass))
  root.style.setProperty('--surface', `color-mix(in srgb, ${vars['--surface-solid']} ${Math.round(glass * 100)}%, transparent)`)
}

export function setTheme(id: ThemeId) {
  if (id !== state.theme) commit({ ...state, theme: id })
}

export function setLook(id: ThemeId, patch: Partial<Appearance>) {
  commit({ ...state, look: { ...state.look, [id]: clean(id, { ...state.look[id], ...patch }) } })
}

export function resetLook(id: ThemeId) {
  commit({ ...state, look: { ...state.look, [id]: DEFAULT_LOOK[id] } })
}

export async function initTheme() {
  applyTheme()
  try {
    const saved = await api.settingGet('theme')
    const s = saved && saved.startsWith('{') ? parse(JSON.parse(saved)) : null
    if (s && JSON.stringify(s) !== JSON.stringify(state)) {
      state = s
      localStorage.setItem(LS_KEY, JSON.stringify(state))
      applyTheme()
      for (const l of listeners) l()
    }
  } catch {
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useThemeState(): State {
  return useSyncExternalStore(subscribe, () => state)
}

export function useTheme(): Theme {
  return THEMES[useThemeState().theme]
}
