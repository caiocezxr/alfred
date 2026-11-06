import { useSyncExternalStore } from 'react'
import { api } from '../../shared/db/api'

export type WallId = 'ceu' | 'tema' | 'grafite' | 'noite' | 'areia' | 'oceano' | 'imagem'
export type BlockId = 'greeting' | 'clock' | 'weather' | 'mood' | 'briefing' | 'day' | 'habits' | 'todos'

export type HomeLayout = {
  wall: WallId
  dim: number
  show: Record<BlockId, boolean>
}

export const BLOCKS: { id: BlockId; label: string; hint: string }[] = [
  { id: 'greeting', label: 'Saudação', hint: 'Boa tarde e o apelido do dia' },
  { id: 'clock', label: 'Relógio e sol', hint: 'Hora e quanto falta de sol' },
  { id: 'weather', label: 'Clima', hint: 'Fortaleza, Recife e Frankfurt' },
  { id: 'mood', label: 'Humor', hint: 'Como você está hoje' },
  { id: 'briefing', label: 'Briefing', hint: 'Capa do dossiê do dia' },
  { id: 'day', label: 'Seu dia', hint: 'Medidor da Workstation' },
  { id: 'todos', label: 'To-dos e prazos', hint: 'O que tem para hoje' },
  { id: 'habits', label: 'Hábitos de hoje', hint: 'Marcar direto do início' },
]

export const WALLS: { id: WallId; label: string }[] = [
  { id: 'ceu', label: 'Céu ao vivo' },
  { id: 'tema', label: 'Do tema' },
  { id: 'grafite', label: 'Grafite' },
  { id: 'noite', label: 'Noite' },
  { id: 'areia', label: 'Areia' },
  { id: 'oceano', label: 'Oceano' },
  { id: 'imagem', label: 'Sua imagem' },
]

const KEY = 'ps.home.v1'
const IMG_KEY = 'ps.home.wall'
const DEFAULT: HomeLayout = {
  wall: 'ceu',
  dim: 0.35,
  show: { greeting: true, clock: true, weather: true, mood: true, briefing: true, day: true, habits: true, todos: true },
}

function read(): HomeLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<HomeLayout> | null
    if (!raw) return DEFAULT
    return { wall: raw.wall ?? DEFAULT.wall, dim: typeof raw.dim === 'number' ? raw.dim : DEFAULT.dim, show: { ...DEFAULT.show, ...(raw.show ?? {}) } }
  } catch {
    return DEFAULT
  }
}

let state = read()
let image: string | null = (() => {
  try {
    return localStorage.getItem(IMG_KEY)
  } catch {
    return null
  }
})()
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  listeners.forEach((l) => l())
}

void api
  .settingGet('home.layout')
  .then((raw) => {
    if (!raw) return
    const s = JSON.parse(raw) as HomeLayout
    state = { ...DEFAULT, ...s, show: { ...DEFAULT.show, ...s.show } }
    emit()
  })
  .catch(() => {})
void api
  .settingGet('home.wallpaper')
  .then((raw) => {
    if (!raw || raw === image) return
    image = raw
    emit()
  })
  .catch(() => {})

export function setLayout(patch: Partial<HomeLayout>) {
  state = { ...state, ...patch, show: { ...state.show, ...(patch.show ?? {}) } }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {}
  void api.settingSet('home.layout', JSON.stringify(state)).catch(() => {})
  emit()
}

export function resetLayout() {
  setLayout({ ...DEFAULT, show: { ...DEFAULT.show } })
}

export async function setWallImage(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => bad(new Error('imagem inválida'))
      i.src = url
    })
    const max = 2400
    const k = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k)
    c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const data = c.toDataURL('image/jpeg', 0.84)
    image = data
    try {
      localStorage.setItem(IMG_KEY, data)
    } catch {}
    void api.settingSet('home.wallpaper', data).catch(() => {})
    setLayout({ wall: 'imagem' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

const snap = () => version

export function useHomeLayout() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    snap,
  )
  return { layout: state, image }
}
