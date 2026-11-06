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
export type Texture = 'liso' | 'grao' | 'papel' | 'linho' | 'pontos' | 'carbono' | 'couro' | 'grade'
export type StyleId = 'classico' | 'grafite' | 'papel' | 'tecnologico' | 'carbono' | 'couro'

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
  texture: Texture
  grain: number
  grainSize: number
}

export const TEXTURES: { id: Texture; label: string }[] = [
  { id: 'liso', label: 'Liso' },
  { id: 'grao', label: 'Grão' },
  { id: 'papel', label: 'Papel' },
  { id: 'linho', label: 'Linho' },
  { id: 'pontos', label: 'Pontilhado' },
  { id: 'grade', label: 'Grade' },
  { id: 'carbono', label: 'Carbono' },
  { id: 'couro', label: 'Couro' },
]

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`

export function textureVars(t: Texture, amount: number, size: number, scheme: 'light' | 'dark'): Record<string, string> {
  const k = Math.min(1, Math.max(0, size))
  const a = Math.min(1, Math.max(0, amount))
  const ink = scheme === 'dark' ? '255,255,255' : '40,30,20'
  if (t === 'liso' || a < 0.01) return { '--tex-image': 'none', '--tex-opacity': '0', '--tex-size': 'auto', '--tex-blend': 'normal' }
  if (t === 'grade') {
    const step = Math.round(14 + k * 26)
    return {
      '--tex-image': svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='${step}' height='${step}'><path d='M${step} 0H0V${step}' fill='none' stroke='rgb(${ink})' stroke-width='0.6'/></svg>`),
      '--tex-opacity': (a * 0.22).toFixed(3),
      '--tex-size': `${step}px ${step}px`,
      '--tex-blend': 'normal',
    }
  }
  if (t === 'carbono') {
    const c = Math.round(4 + k * 6)
    const hi = scheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.55)'
    const lo = scheme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.12)'
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${c * 2}' height='${c * 2}'><defs><linearGradient id='a' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${hi}'/><stop offset='1' stop-color='${lo}'/></linearGradient><linearGradient id='b' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='${hi}'/><stop offset='1' stop-color='${lo}'/></linearGradient></defs><rect width='${c}' height='${c}' fill='url(#a)'/><rect x='${c}' y='${c}' width='${c}' height='${c}' fill='url(#a)'/><rect x='${c}' width='${c}' height='${c}' fill='url(#b)'/><rect y='${c}' width='${c}' height='${c}' fill='url(#b)'/></svg>`
    return {
      '--tex-image': svgUrl(svg),
      '--tex-opacity': (a * 0.9).toFixed(3),
      '--tex-size': `${c * 2}px ${c * 2}px`,
      '--tex-blend': scheme === 'dark' ? 'overlay' : 'multiply',
    }
  }
  if (t === 'couro') {
    const f = (0.32 - k * 0.2).toFixed(3)
    const light = scheme === 'dark' ? '#8a6a4a' : '#d9c3a3'
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n' x='0' y='0' width='100%' height='100%' filterUnits='userSpaceOnUse' primitiveUnits='userSpaceOnUse'><feTurbulence type='fractalNoise' baseFrequency='${f}' numOctaves='4' stitchTiles='stitch' result='t'/><feDiffuseLighting in='t' lighting-color='${light}' surfaceScale='2.2'><feDistantLight azimuth='225' elevation='52'/></feDiffuseLighting></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
    return {
      '--tex-image': svgUrl(svg),
      '--tex-opacity': (a * (scheme === 'dark' ? 0.32 : 0.4)).toFixed(3),
      '--tex-size': '260px 260px',
      '--tex-blend': scheme === 'dark' ? 'soft-light' : 'multiply',
    }
  }
  if (t === 'pontos') {
    const step = Math.round(6 + k * 14)
    const r = (0.6 + k * 1.1).toFixed(2)
    return {
      '--tex-image': svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='${step}' height='${step}'><circle cx='${step / 2}' cy='${step / 2}' r='${r}' fill='rgb(${ink})'/></svg>`),
      '--tex-opacity': (a * 0.32).toFixed(3),
      '--tex-size': `${step}px ${step}px`,
      '--tex-blend': 'normal',
    }
  }
  const tile = 220
  const spec =
    t === 'grao'
      ? { f: (1.25 - k * 0.95).toFixed(3), o: 2, extra: '' }
      : t === 'papel'
        ? { f: `${(0.09 - k * 0.06).toFixed(3)} ${(0.11 - k * 0.07).toFixed(3)}`, o: 5, extra: '' }
        : { f: `${(0.012 - k * 0.006).toFixed(4)} ${(1.1 - k * 0.6).toFixed(3)}`, o: 3, extra: `<feTurbulence type='fractalNoise' baseFrequency='${(1.1 - k * 0.6).toFixed(3)} ${(0.012 - k * 0.006).toFixed(4)}' numOctaves='3' stitchTiles='stitch' result='b'/><feBlend in='SourceGraphic' in2='b' mode='multiply'/>` }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'><filter id='n' x='0' y='0' width='100%' height='100%' filterUnits='userSpaceOnUse' primitiveUnits='userSpaceOnUse'><feTurbulence type='fractalNoise' baseFrequency='${spec.f}' numOctaves='${spec.o}' stitchTiles='stitch'/>${spec.extra}<feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
  const strength = t === 'grao' ? 0.22 : t === 'papel' ? 0.3 : 0.26
  return {
    '--tex-image': svgUrl(svg),
    '--tex-opacity': (a * strength * (scheme === 'dark' ? 0.55 : 1)).toFixed(3),
    '--tex-size': `${tile}px ${tile}px`,
    '--tex-blend': scheme === 'dark' ? 'screen' : 'multiply',
  }
}

export type StyleDef = { id: StyleId; name: string; tagline: string; claro: Appearance; escuro: Appearance }

const L = (p: Partial<Appearance> & Pick<Appearance, 'accent' | 'display'>): Appearance => ({
  text: 'sistema',
  glass: 0.8,
  depth: 0.5,
  tone: 'neutro',
  contrast: 0.5,
  radius: 18,
  window: 0,
  texture: 'grao',
  grain: 0.35,
  grainSize: 0.3,
  ...p,
})

export const STYLES: StyleDef[] = [
  {
    id: 'classico',
    name: 'Clássico',
    tagline: 'Sóbrio, serifa editorial e vidro',
    claro: L({ accent: '#8c6a3a', display: 'instrument', glass: 0.8, depth: 0.35, tone: 'quente', radius: 20 }),
    escuro: L({ accent: '#d6c19c', display: 'instrument', glass: 0.72, depth: 1, tone: 'neutro', radius: 20 }),
  },
  {
    id: 'grafite',
    name: 'Grafite',
    tagline: 'Cinza, branco e grafite, sem cor sobrando',
    claro: L({ accent: '#2b2d31', display: 'sistema', glass: 0.84, depth: 0.55, tone: 'neutro', contrast: 0.6, radius: 14, texture: 'grao', grain: 0.22, grainSize: 0.2 }),
    escuro: L({ accent: '#e4e5e7', display: 'sistema', glass: 0.74, depth: 0.45, tone: 'neutro', contrast: 0.6, radius: 14, texture: 'grao', grain: 0.25, grainSize: 0.2 }),
  },
  {
    id: 'papel',
    name: 'Papel',
    tagline: 'Fibra, tinta e tipografia de livro',
    claro: L({ accent: '#9b2c1f', display: 'garamond', text: 'serifada', glass: 0.9, depth: 0.4, tone: 'quente', radius: 10, texture: 'papel', grain: 0.6, grainSize: 0.45 }),
    escuro: L({ accent: '#d9a066', display: 'garamond', text: 'serifada', glass: 0.85, depth: 0.6, tone: 'quente', radius: 10, texture: 'papel', grain: 0.55, grainSize: 0.45 }),
  },
  {
    id: 'tecnologico',
    name: 'Tecnológico',
    tagline: 'Grade, instrumentos e luz ciano',
    claro: L({ accent: '#0a72d1', display: 'sistema', glass: 0.86, depth: 0.55, tone: 'frio', contrast: 0.7, radius: 8, texture: 'grade', grain: 0.5, grainSize: 0.35 }),
    escuro: L({ accent: '#36e0ff', display: 'sistema', glass: 0.7, depth: 0.85, tone: 'frio', contrast: 0.7, radius: 8, texture: 'grade', grain: 0.55, grainSize: 0.35 }),
  },
  {
    id: 'carbono',
    name: 'Carbono',
    tagline: 'Fibra de carbono e vermelho de corrida',
    claro: L({ accent: '#c40500', display: 'sistema', glass: 0.88, depth: 0.5, tone: 'neutro', contrast: 0.65, radius: 12, texture: 'carbono', grain: 0.35, grainSize: 0.3 }),
    escuro: L({ accent: '#ff2a1f', display: 'sistema', glass: 0.74, depth: 0.85, tone: 'neutro', contrast: 0.65, radius: 12, texture: 'carbono', grain: 0.55, grainSize: 0.3 }),
  },
  {
    id: 'couro',
    name: 'Couro',
    tagline: 'Conhaque, couro e latão',
    claro: L({ accent: '#8a5a24', display: 'bodoni', glass: 0.86, depth: 0.45, tone: 'quente', radius: 16, texture: 'couro', grain: 0.55, grainSize: 0.4 }),
    escuro: L({ accent: '#c99a55', display: 'bodoni', glass: 0.76, depth: 0.8, tone: 'quente', radius: 16, texture: 'couro', grain: 0.6, grainSize: 0.4 }),
  },
]

export const styleDef = (id: StyleId) => STYLES.find((x) => x.id === id) ?? STYLES[0]

export const DEFAULT_LOOK: Record<ThemeId, Appearance> = { claro: STYLES[0].claro, escuro: STYLES[0].escuro }

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

type Tones = Record<Tone, string>
type Pal = { dark: { soft: Tones; deep: Tones; text: Tones }; light: { soft: Tones; bright: Tones; text: Tones } }
const t3 = (neutro: string, quente: string, frio: string): Tones => ({ neutro, quente, frio })

const PALETTES: Record<StyleId, Pal> = {
  classico: {
    dark: { soft: t3('#161618', '#18140f', '#11151b'), deep: t3('#000000', '#050302', '#020407'), text: t3('#f4f2ee', '#f6efe4', '#edf2f8') },
    light: { soft: t3('#ececea', '#f1eadf', '#e7edf3'), bright: t3('#ffffff', '#fffdf8', '#fbfdff'), text: t3('#18181a', '#1b1814', '#141a22') },
  },
  grafite: {
    dark: { soft: t3('#2a2b2e', '#2c2a28', '#272a2e'), deep: t3('#141517', '#161514', '#121417'), text: t3('#eceef0', '#efece8', '#e9edf1') },
    light: { soft: t3('#d9dadc', '#dddad6', '#d6d9dd'), bright: t3('#f5f5f6', '#f6f5f3', '#f3f5f7'), text: t3('#1c1d20', '#1f1d1b', '#1a1d21') },
  },
  papel: {
    dark: { soft: t3('#1d1b18', '#211b14', '#1a1c1f'), deep: t3('#100f0d', '#120e0a', '#0d0f12'), text: t3('#ece6da', '#efe3cc', '#e2e6ea') },
    light: { soft: t3('#e9e3d6', '#eadfc8', '#e1e3e2'), bright: t3('#f7f3ea', '#f8f0df', '#f2f4f2'), text: t3('#26221c', '#2a2219', '#1f2428') },
  },
  tecnologico: {
    dark: { soft: t3('#10141a', '#14130f', '#0b121b'), deep: t3('#05070a', '#070604', '#03070d'), text: t3('#dfe8f0', '#ece4d6', '#d8e8f6') },
    light: { soft: t3('#e6eaee', '#ece8e1', '#e2e9f1'), bright: t3('#f8fafc', '#fbf9f5', '#f6f9fd'), text: t3('#0f1720', '#1c1812', '#0b1622') },
  },
  carbono: {
    dark: { soft: t3('#161616', '#171513', '#131518'), deep: t3('#070707', '#080706', '#06070a'), text: t3('#ededed', '#efebe4', '#e8ecf0') },
    light: { soft: t3('#e2e2e0', '#e6e2dc', '#dfe2e5'), bright: t3('#f5f5f3', '#f7f4ef', '#f3f5f7'), text: t3('#121212', '#17140f', '#0f1317') },
  },
  couro: {
    dark: { soft: t3('#1e1712', '#21160e', '#1a1815'), deep: t3('#0f0b08', '#120b06', '#0d0c0a'), text: t3('#f0e6d8', '#f3e4cf', '#e9e6e0') },
    light: { soft: t3('#eadfd0', '#ecdcc4', '#e3ddd4'), bright: t3('#f8f1e7', '#faefdd', '#f4f0ea'), text: t3('#2a1e15', '#2e1d10', '#241f1a') },
  },
}

export function themeVars(id: ThemeId, a: Appearance, style: StyleId = 'classico'): Record<string, string> {
  const P = PALETTES[style] ?? PALETTES.classico
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
    const bg = mix(P.dark.soft[a.tone], P.dark.deep[a.tone], a.depth)
    const text = P.dark.text[a.tone]
    return {
      ...common,
      ...textureVars(a.texture, a.grain, a.grainSize, 'dark'),
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
  const bg = mix(P.light.soft[a.tone], P.light.bright[a.tone], a.depth)
  const text = P.light.text[a.tone]
  return {
    ...common,
    ...textureVars(a.texture, a.grain, a.grainSize, 'light'),
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

type Looks = Record<ThemeId, Appearance>
type State = { theme: ThemeId; style: StyleId; fontV?: number; look: Looks; looks: Partial<Record<StyleId, Looks>> }

const LS_KEY = 'ps.theme.v3'
const LEGACY_KEY = 'ps.theme.v2'

const clean = (id: ThemeId, a: Partial<Appearance> | undefined, style: StyleId = 'classico'): Appearance => {
  const d = styleDef(style)[id]
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
    window: Number.isFinite(v.window) ? Math.min(0.85, Math.max(0, v.window)) : d.window,
    texture: TEXTURES.some((t) => t.id === v.texture) ? v.texture : d.texture,
    grain: Number.isFinite(v.grain) ? Math.min(1, Math.max(0, v.grain)) : d.grain,
    grainSize: Number.isFinite(v.grainSize) ? Math.min(1, Math.max(0, v.grainSize)) : d.grainSize,
  }
}

const isStyle = (v: unknown): v is StyleId => STYLES.some((x) => x.id === v)

const withLook = (st: Omit<State, 'look'>): State => {
  const cur = st.looks[st.style] ?? { claro: styleDef(st.style).claro, escuro: styleDef(st.style).escuro }
  return { ...st, looks: { ...st.looks, [st.style]: cur }, look: cur }
}

function parse(d: unknown): State | null {
  if (!d || typeof d !== 'object') return null
  const o = d as { theme?: string; style?: string; fontV?: number; look?: Record<string, Partial<Appearance>>; looks?: Record<string, Record<string, Partial<Appearance>>>; prefs?: { glass?: number } }
  const theme: ThemeId = o.theme === 'claro' ? 'claro' : 'escuro'
  const style: StyleId = isStyle(o.style) ? o.style : 'classico'
  const looks: Partial<Record<StyleId, Looks>> = {}
  if (o.looks) {
    for (const [k, v] of Object.entries(o.looks)) if (isStyle(k) && v) looks[k] = { claro: clean('claro', v.claro, k), escuro: clean('escuro', v.escuro, k) }
  } else if (o.look) {
    const fresh = o.fontV !== 2
    const fix = (a: Appearance): Appearance => (fresh && a.display === 'cormorant' ? { ...a, display: 'instrument' } : a)
    looks.classico = { claro: fix(clean('claro', o.look.claro)), escuro: fix(clean('escuro', o.look.escuro)) }
  } else {
    const glass = o.prefs?.glass
    looks.classico = { claro: clean('claro', glass ? { glass } : undefined), escuro: clean('escuro', glass ? { glass } : undefined) }
  }
  return withLook({ theme, style, fontV: 2, looks })
}

function loadState(): State {
  for (const key of [LS_KEY, LEGACY_KEY]) {
    try {
      const s = parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
      if (s) return s
    } catch {
    }
  }
  return withLook({ theme: 'escuro', style: 'classico', looks: {} })
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
  const vars = themeVars(id, state.look[id], state.style)
  root.dataset.theme = id
  root.dataset.style = state.style
  root.dataset.scheme = vars['--scheme']
  root.style.colorScheme = vars['--scheme']
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  const glass = state.look[id].glass
  root.style.setProperty('--glass', String(glass))
  root.style.setProperty('--surface', `color-mix(in srgb, ${vars['--surface-solid']} ${Math.round(glass * 100)}%, transparent)`)
  syncNativeTheme(vars['--scheme'] === 'light' ? 'light' : 'dark')
}

let nativeTheme: string | null = null
function syncNativeTheme(t: 'light' | 'dark') {
  if (!isTauri || nativeTheme === t) return
  nativeTheme = t
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTheme(t)).catch(() => {})
}

export function setTheme(id: ThemeId) {
  if (id !== state.theme) commit({ ...state, theme: id })
}

export function setStyle(style: StyleId) {
  if (style !== state.style) commit(withLook({ ...state, style }))
}

export function setLook(id: ThemeId, patch: Partial<Appearance>) {
  const look = { ...state.look, [id]: clean(id, { ...state.look[id], ...patch }, state.style) }
  commit({ ...state, look, looks: { ...state.looks, [state.style]: look } })
}

export function resetLook(id: ThemeId) {
  const look = { ...state.look, [id]: styleDef(state.style)[id] }
  commit({ ...state, look, looks: { ...state.looks, [state.style]: look } })
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
