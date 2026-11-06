import { useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { addDays } from '../../shared/dates'
import { api, isTauri, type Checkin, type Habit } from '../../shared/db/api'
import { isScheduled } from '../../shared/db/stores'

export type HabitKind = 'construir' | 'largar'
export type HabitMeta = { kind: HabitKind; category: string | null; tips: string[]; tipsAt: string | null; seen: number[] }

export const CATEGORIES = ['Corpo', 'Mente', 'Trabalho', 'Dinheiro', 'Família', 'Fé', 'Casa']
export const MILESTONES = [3, 7, 14, 21, 30, 66, 100]

const KEY = 'ps.habits.meta.v1'
const SETTING = 'habits.meta'

let all: Record<string, HabitMeta> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, HabitMeta>
  } catch {
    return {}
  }
})()
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  listeners.forEach((l) => l())
}

void api
  .settingGet(SETTING)
  .then((raw) => {
    if (!raw) return
    all = { ...JSON.parse(raw), ...all }
    emit()
  })
  .catch(() => {})

const save = () => {
  const raw = JSON.stringify(all)
  try {
    localStorage.setItem(KEY, raw)
  } catch {}
  void api.settingSet(SETTING, raw).catch(() => {})
}

export function guessKind(name: string): HabitKind {
  return /^(parar|largar|sem |n[aã]o |zero |menos )/i.test(name.trim()) ? 'largar' : 'construir'
}

export function metaOf(h: Habit): HabitMeta {
  return all[h.id] ?? { kind: guessKind(h.name), category: null, tips: [], tipsAt: null, seen: [] }
}

export function setMeta(id: string, patch: Partial<HabitMeta>, base: HabitMeta) {
  all = { ...all, [id]: { ...base, ...(all[id] ?? {}), ...patch } }
  save()
  emit()
}

export function useHabitMeta() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => version,
  )
  return metaOf
}

export async function generateTips(h: Habit, m: HabitMeta): Promise<string[]> {
  if (!isTauri) throw new Error('As dicas com IA rodam no app, com o modelo local ligado.')
  try {
    const tips = await invoke<string[]>('habit_tips', { name: h.name, kind: m.kind, category: m.category ?? '', cue: h.cue ?? '', minimum: h.minimum ?? '' })
    setMeta(h.id, { tips, tipsAt: new Date().toISOString() }, m)
    return tips
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    if (msg.includes('local-ausente') || msg.includes('local-modelo')) throw new Error('O modelo local está desligado. Ligue o Ollama para gerar dicas.')
    throw new Error('Não deu para gerar as dicas agora. Tente de novo em instantes.')
  }
}

export type HabitNumbers = { streak: number; best: number; total: number; minimum: number; rate7: number | null; rate30: number | null }

export function numbersOf(h: Habit, checkins: Checkin[], today: string): HabitNumbers {
  const map = new Map(checkins.filter((c) => c.habitId === h.id).map((c) => [c.date, c.status]))
  let best = 0
  let run = 0
  let total = 0
  let minimum = 0
  for (let d = h.startDate; d <= today; d = addDays(d, 1)) {
    const st = map.get(d)
    if (st === 'done') total++
    if (st === 'minimum') minimum++
    if (!isScheduled(h, d)) continue
    if (st) {
      run++
      best = Math.max(best, run)
    } else if (d !== today) run = 0
  }
  let streak = 0
  let d = map.get(today) ? today : addDays(today, -1)
  for (let i = 0; i < 500 && d >= h.startDate; i++, d = addDays(d, -1)) {
    if (!isScheduled(h, d)) continue
    if (!map.get(d)) break
    streak++
  }
  const rate = (days: number) => {
    let sch = 0
    let ok = 0
    for (let k = 0; k < days; k++) {
      const x = addDays(today, -k)
      if (x < h.startDate || !isScheduled(h, x)) continue
      sch++
      if (map.get(x)) ok++
    }
    return sch ? ok / sch : null
  }
  return { streak, best: Math.max(best, streak), total, minimum, rate7: rate(7), rate30: rate(30) }
}
