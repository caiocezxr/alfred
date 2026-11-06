import type { VerseRef } from './bible'

class LocalStore<T> {
  private key: string
  private value: T
  private listeners = new Set<() => void>()

  constructor(key: string, initial: T) {
    this.key = key
    let v = initial
    try {
      const raw = localStorage.getItem(key)
      if (raw) v = { ...initial, ...JSON.parse(raw) }
    } catch {
    }
    this.value = v
  }

  get = () => this.value

  set(next: T) {
    this.value = next
    try {
      localStorage.setItem(this.key, JSON.stringify(next))
    } catch {
    }
    for (const l of this.listeners) l()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
}

export type HighlightColor = 'gold' | 'rose' | 'sage' | 'sky'

export type Annotation = {
  id: string
  book: number
  chapter: number
  verse: number | null
  text: string
  color: HighlightColor | null
  createdAt: number
  updatedAt: number
}

export const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
  gold: 'rgba(226, 182, 74, 0.34)',
  rose: 'rgba(214, 120, 120, 0.28)',
  sage: 'rgba(132, 170, 120, 0.30)',
  sky: 'rgba(110, 156, 205, 0.27)',
}

export const HIGHLIGHT_SWATCH: Record<HighlightColor, string> = {
  gold: '#d9b45a',
  rose: '#d07a7a',
  sage: '#86a978',
  sky: '#6f9ccd',
}

type NotesState = { items: Annotation[] }

export const notesStore = new LocalStore<NotesState>('ps.bible.notes.v1', { items: [] })

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export function findNote(ref: { book: number; chapter: number; verse: number | null }): Annotation | undefined {
  return notesStore.get().items.find((n) => n.book === ref.book && n.chapter === ref.chapter && n.verse === ref.verse)
}

export function saveNote(ref: { book: number; chapter: number; verse: number | null }, patch: Partial<Pick<Annotation, 'text' | 'color'>>) {
  const items = [...notesStore.get().items]
  const i = items.findIndex((n) => n.book === ref.book && n.chapter === ref.chapter && n.verse === ref.verse)
  const now = Date.now()
  if (i >= 0) {
    const next = { ...items[i], ...patch, updatedAt: now }
    if (!next.text.trim() && !next.color) items.splice(i, 1)
    else items[i] = next
  } else {
    const n: Annotation = { id: uid(), ...ref, text: '', color: null, createdAt: now, updatedAt: now, ...patch }
    if (!n.text.trim() && !n.color) return
    items.push(n)
  }
  notesStore.set({ items })
}

export function deleteNote(id: string) {
  notesStore.set({ items: notesStore.get().items.filter((n) => n.id !== id) })
}

export function chapterMarks(book: number, chapter: number) {
  const out = new Map<number, Annotation>()
  for (const n of notesStore.get().items) if (n.book === book && n.chapter === chapter && n.verse !== null) out.set(n.verse, n)
  return out
}

export type GoalUnit = 'chapters' | 'verses'
export type ReadingLog = { date: string; from: VerseRef; to: VerseRef; extra?: boolean }
export type Gratitude = { id: string; date: string; text: string; createdAt: number }

type DailyState = {
  goal: { unit: GoalUnit; amount: number }
  cursor: VerseRef
  log: ReadingLog[]
  gratitude: Gratitude[]
}

export const dailyStore = new LocalStore<DailyState>('ps.bible.daily.v1', {
  goal: { unit: 'chapters', amount: 1 },
  cursor: { book: 0, chapter: 0, verse: 0 },
  log: [],
  gratitude: [],
})

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addGratitude(text: string) {
  const s = dailyStore.get()
  if (!text.trim()) return
  dailyStore.set({ ...s, gratitude: [{ id: uid(), date: today(), text: text.trim(), createdAt: Date.now() }, ...s.gratitude] })
}

export function removeGratitude(id: string) {
  const s = dailyStore.get()
  dailyStore.set({ ...s, gratitude: s.gratitude.filter((g) => g.id !== id) })
}
