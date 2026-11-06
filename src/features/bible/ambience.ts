export type BackgroundId = 'luz-da-manha' | 'montanha' | 'mar' | 'estudo' | 'mediterraneo' | 'floresta' | 'ceu' | 'aconchego' | 'noite'

export type AmbientKind = 'mar' | 'vento' | 'chuva' | 'lareira' | 'grilos'

export type BackgroundIcon = 'sun' | 'mountain' | 'wave' | 'lamp' | 'column' | 'tree' | 'cloud' | 'flame' | 'moon'

export type Background = {
  id: BackgroundId
  label: string
  icon: BackgroundIcon
  fallback: [string, string, string]
  sound: AmbientKind
  light: [number, number]
}

export const BACKGROUNDS: Background[] = [
  { id: 'luz-da-manha', label: 'Luz da manhã', icon: 'sun', fallback: ['#f3d7aa', '#b98a5a', '#4e3422'], sound: 'vento', light: [0.22, 0.16] },
  { id: 'montanha', label: 'Montanha', icon: 'mountain', fallback: ['#f2a65e', '#9a5a46', '#2a2230'], sound: 'vento', light: [0.62, 0.2] },
  { id: 'mar', label: 'Mar', icon: 'wave', fallback: ['#f0b07a', '#8a6a6a', '#2a3a4a'], sound: 'mar', light: [0.6, 0.22] },
  { id: 'estudo', label: 'Estudo', icon: 'lamp', fallback: ['#a8743e', '#4a2e1a', '#1a110a'], sound: 'chuva', light: [0.18, 0.12] },
  { id: 'mediterraneo', label: 'Mediterrâneo', icon: 'column', fallback: ['#f2c38a', '#a77a52', '#4a3626'], sound: 'mar', light: [0.7, 0.2] },
  { id: 'floresta', label: 'Floresta', icon: 'tree', fallback: ['#e8d08a', '#6a7a3a', '#22301a'], sound: 'vento', light: [0.36, 0.14] },
  { id: 'ceu', label: 'Céu', icon: 'cloud', fallback: ['#f4c9a0', '#d6a28c', '#8a6a7a'], sound: 'vento', light: [0.52, 0.3] },
  { id: 'aconchego', label: 'Aconchego', icon: 'flame', fallback: ['#c8662a', '#4a2412', '#120a06'], sound: 'lareira', light: [0.28, 0.55] },
  { id: 'noite', label: 'Noite', icon: 'moon', fallback: ['#2e3a66', '#121a33', '#05070f'], sound: 'grilos', light: [0.6, 0.16] },
]

const LEGACY: Record<string, BackgroundId> = {
  'por-do-sol': 'mar', montanhas: 'montanha', natureza: 'floresta', 'noite-serena': 'noite', biblioteca: 'estudo', chuva: 'estudo', praia: 'mar',
}

export function normalizeBackground(id: unknown): BackgroundId {
  if (typeof id !== 'string') return 'luz-da-manha'
  if (BACKGROUNDS.some((b) => b.id === id)) return id as BackgroundId
  return LEGACY[id] ?? 'luz-da-manha'
}

const BG_FILES = import.meta.glob('../../assets/bible-backgrounds/*.{jpg,jpeg,png,webp}', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const BG_THUMBS = import.meta.glob('../../assets/bible-backgrounds/thumbs/*.{jpg,jpeg,png,webp}', { query: '?url', import: 'default', eager: true }) as Record<string, string>

const fileFor = (files: Record<string, string>, id: BackgroundId) => {
  const k = Object.keys(files).find((f) => f.split('/').pop()!.replace(/\.(jpe?g|png|webp)$/, '') === id)
  return k ? files[k] : null
}

export function backgroundImage(id: BackgroundId): string | null {
  return fileFor(BG_FILES, id)
}

export function backgroundThumb(id: BackgroundId): string | null {
  return fileFor(BG_THUMBS, id) ?? fileFor(BG_FILES, id)
}

export function backgroundOf(id: BackgroundId) {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]
}

export function backgroundCss(id: BackgroundId) {
  const [a, b, c] = backgroundOf(id).fallback
  return `radial-gradient(120% 95% at 30% 20%, ${a} 0%, ${b} 52%, ${c} 100%)`
}

export type CoverId = 'classico' | 'executiva' | 'linho' | 'oliva' | 'horizonte'

export type CoverStyle = {
  id: CoverId
  label: string
  kind: 'leather' | 'linen'
  base: string
  light: string
  dark: string
  ink: string
  frame: 'double' | 'single' | 'none'
  ornament: 'none' | 'olive' | 'mountains'
  edge: 'gilt' | 'ivory'
}

export const COVERS: CoverStyle[] = [
  { id: 'classico', label: 'Couro clássico', kind: 'leather', base: '#4e2716', light: '#6a3721', dark: '#2f150b', ink: '#e2bf78', frame: 'double', ornament: 'none', edge: 'gilt' },
  { id: 'executiva', label: 'Executiva', kind: 'leather', base: '#1b1b1e', light: '#2c2c31', dark: '#0c0c0e', ink: '#d9b46a', frame: 'single', ornament: 'none', edge: 'gilt' },
  { id: 'linho', label: 'Linho', kind: 'linen', base: '#d8ccb4', light: '#e8dfcc', dark: '#b4a68a', ink: '#7a5634', frame: 'none', ornament: 'none', edge: 'ivory' },
  { id: 'oliva', label: 'Oliva', kind: 'leather', base: '#25402f', light: '#335640', dark: '#14251b', ink: '#d6b46c', frame: 'none', ornament: 'olive', edge: 'gilt' },
  { id: 'horizonte', label: 'Horizonte', kind: 'leather', base: '#1c2c48', light: '#2a3e62', dark: '#0e1628', ink: '#d8b46c', frame: 'none', ornament: 'mountains', edge: 'gilt' },
]

export function normalizeCover(id: unknown): CoverId {
  return COVERS.some((c) => c.id === id) ? (id as CoverId) : 'classico'
}

export function coverOf(id: CoverId) {
  return COVERS.find((c) => c.id === id) ?? COVERS[0]
}
