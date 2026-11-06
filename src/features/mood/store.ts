import { useEffect, useSyncExternalStore } from 'react'
import { civil } from '../../shared/dates'
import { moodApi, type DayCheckin, type DayPatch } from './api'

type State = { today: DayCheckin | null; loaded: boolean }

let state: State = { today: null, loaded: false }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export async function loadToday() {
  const d = await moodApi.get(civil()).catch(() => null)
  state = { today: d, loaded: true }
  emit()
}

export async function patchToday(patch: DayPatch) {
  const date = civil()
  const base = state.today ?? { date, mood: null, note: '', coffee: null }
  state = { ...state, today: { ...base, ...patch } as DayCheckin }
  emit()
  try {
    const saved = await moodApi.set(date, patch)
    state = { ...state, today: saved }
    emit()
  } catch {
    await loadToday()
  }
}

export function useToday() {
  useEffect(() => {
    if (!state.loaded) void loadToday()
  }, [])
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => state,
  )
}
