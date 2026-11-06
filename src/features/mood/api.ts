import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../shared/db/api'

export type Mood = 1 | 2 | 3 | 4 | 5
export type DayCheckin = { date: string; mood: Mood | null; note: string; coffee: boolean | null }
export type DayPatch = { mood?: Mood | null; note?: string; coffee?: boolean | null }

const KEY = 'ps.mood.v1'

function readLocal(): Record<string, DayCheckin> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const moodApi = {
  async get(date: string): Promise<DayCheckin | null> {
    if (isTauri) return invoke<DayCheckin | null>('day_get', { date })
    return readLocal()[date] ?? null
  },
  async set(date: string, patch: DayPatch): Promise<DayCheckin> {
    if (isTauri) return invoke<DayCheckin>('day_set', { date, patch })
    const all = readLocal()
    const cur = all[date] ?? { date, mood: null, note: '', coffee: null }
    const next: DayCheckin = {
      date,
      mood: patch.mood !== undefined ? patch.mood : cur.mood,
      note: patch.note !== undefined ? patch.note.trim().slice(0, 280) : cur.note,
      coffee: patch.coffee !== undefined ? patch.coffee : cur.coffee,
    }
    all[date] = next
    localStorage.setItem(KEY, JSON.stringify(all))
    return next
  },
  async range(from: string, to: string): Promise<DayCheckin[]> {
    if (isTauri) return invoke<DayCheckin[]>('days_range', { from, to })
    return Object.values(readLocal())
      .filter((d) => d.date >= from && d.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
  },
}

export const MOODS: { id: Mood; label: string; color: string }[] = [
  { id: 1, label: 'Pesado', color: '#6a6fc4' },
  { id: 2, label: 'Meh', color: '#6fa3d6' },
  { id: 3, label: 'Ok', color: '#b4ada3' },
  { id: 4, label: 'Bem', color: '#7fc28a' },
  { id: 5, label: 'Ótimo', color: '#f0b54a' },
]
