import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

export type Route = 'home' | 'work' | 'oficina' | 'ideas' | 'radar' | 'bible' | 'habits' | 'notes'

export const ROUTES: { id: Route; label: string; ready: boolean; key: string }[] = [
  { id: 'home', label: 'Início', ready: true, key: '1' },
  { id: 'work', label: 'Workstation', ready: true, key: '2' },
  { id: 'oficina', label: 'Oficina', ready: true, key: '8' },
  { id: 'ideas', label: 'Ideias', ready: true, key: '7' },
  { id: 'radar', label: 'Radar', ready: true, key: '3' },
  { id: 'bible', label: 'Bíblia', ready: true, key: '4' },
  { id: 'habits', label: 'Hábitos', ready: true, key: '5' },
  { id: 'notes', label: 'Notas', ready: true, key: '6' },
]

const parse = (): Route => {
  const h = location.hash.replace(/^#\/?/, '') as Route
  return ROUTES.some((r) => r.id === h) ? h : 'home'
}

let current = parse()
const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}
window.addEventListener('hashchange', () => {
  const next = parse()
  if (next === current) return
  current = next
  notify()
})

type VT = { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }

export function navigate(r: Route) {
  if (r === current) return
  const apply = () => {
    current = r
    history.pushState(null, '', `#/${r}`)
    flushSync(notify)
  }
  const doc = document as unknown as VT
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (doc.startViewTransition && !reduced) {
    document.documentElement.dataset.vt = 'page'
    doc.startViewTransition(apply).finished.finally(() => delete document.documentElement.dataset.vt)
  } else apply()
}

export function withThemeTransition(x: number, y: number, apply: () => void) {
  const doc = document as unknown as VT
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduced) return apply()
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${x}px`)
  root.style.setProperty('--vt-y', `${y}px`)
  root.dataset.vt = 'theme'
  doc.startViewTransition(() => flushSync(apply)).finished.finally(() => delete root.dataset.vt)
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
}

export type Intent = 'new-task' | 'new-habit' | 'new-idea' | 'new-note' | 'refresh-radar'
const intentListeners = new Set<(i: Intent) => void>()
let pendingIntent: { i: Intent; at: number } | null = null
export function requestIntent(i: Intent) {
  if (intentListeners.size === 0) {
    pendingIntent = { i, at: Date.now() }
    return
  }
  for (const l of intentListeners) l(i)
}
export function onIntent(fn: (i: Intent) => void) {
  intentListeners.add(fn)
  const p = pendingIntent
  if (p && Date.now() - p.at < 3000) {
    pendingIntent = null
    setTimeout(() => fn(p.i), 30)
  }
  return () => {
    intentListeners.delete(fn)
  }
}

let bibleTarget: { book: number; chapter: number; verse: number } | null = null
export function openBibleAt(ref: { book: number; chapter: number; verse: number }) {
  bibleTarget = ref
  navigate('bible')
}
export function takeBibleTarget() {
  const t = bibleTarget
  bibleTarget = null
  return t
}
