import { useEffect, useSyncExternalStore } from 'react'
import { addDays, civil, parseCivil, weekday } from '../dates'
import { api, type Checkin, type CheckinStatus, type Habit, type HabitPatch, type NewHabit, type NewTask, type Task, type TaskPatch } from './api'

class Store<T> {
  private value: T
  private listeners = new Set<() => void>()
  loaded = false
  error: string | null = null
  constructor(v: T) {
    this.value = v
  }
  get = () => this.value
  set(v: T) {
    this.value = v
    for (const l of this.listeners) l()
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
}

export const errorStore = new Store<string | null>(null)
function fail(e: unknown) {
  errorStore.set(e instanceof Error ? e.message : String(e))
}

export const tasksStore = new Store<Task[]>([])

export async function loadTasks() {
  try {
    tasksStore.set(await api.tasksList())
    tasksStore.loaded = true
  } catch (e) {
    fail(e)
  }
}

export async function createTask(input: NewTask) {
  try {
    const t = await api.taskCreate(input)
    tasksStore.set([...tasksStore.get(), t])
    return t
  } catch (e) {
    fail(e)
  }
}

export async function updateTask(id: string, patch: TaskPatch) {
  const prev = tasksStore.get()
  tasksStore.set(
    prev.map((t) =>
      t.id !== id
        ? t
        : {
            ...t,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.note !== undefined && { note: patch.note }),
            ...(patch.dueDate !== undefined && { dueDate: patch.dueDate || null }),
            ...(patch.priority !== undefined && { priority: patch.priority }),
            ...(patch.done !== undefined && { doneAt: patch.done ? t.doneAt ?? new Date().toISOString() : null }),
          },
    ),
  )
  try {
    const t = await api.taskUpdate(id, patch)
    tasksStore.set(tasksStore.get().map((x) => (x.id === id ? t : x)))
  } catch (e) {
    tasksStore.set(prev)
    fail(e)
  }
}

export async function deleteTask(id: string) {
  const prev = tasksStore.get()
  tasksStore.set(prev.filter((t) => t.id !== id))
  try {
    await api.taskDelete(id)
  } catch (e) {
    tasksStore.set(prev)
    fail(e)
  }
}

export async function reorderTasks(ids: string[]) {
  const prev = tasksStore.get()
  const pos = new Map(ids.map((id, i) => [id, i]))
  tasksStore.set([...prev].map((t) => (pos.has(t.id) ? { ...t, sort: pos.get(t.id)! } : t)).sort((a, b) => a.sort - b.sort))
  try {
    await api.tasksReorder(ids)
  } catch (e) {
    tasksStore.set(prev)
    fail(e)
  }
}

export function useTasks() {
  const tasks = useSyncExternalStore(tasksStore.subscribe, tasksStore.get)
  useEffect(() => {
    if (!tasksStore.loaded) void loadTasks()
  }, [])
  return tasks
}

export function topTasks(tasks: Task[], today = civil(), n = 3): Task[] {
  const open = tasks.filter((t) => !t.doneAt)
  const score = (t: Task) => {
    const due = t.dueDate
    const urgent = due && due <= today ? 0 : 1
    return urgent * 10 + (t.priority ? 0 : 1) * 5 + (due ? 0 : 1)
  }
  return [...open].sort((a, b) => score(a) - score(b) || a.sort - b.sort).filter((t) => (t.dueDate && t.dueDate <= today) || t.priority).slice(0, n)
}

export const habitsStore = new Store<Habit[]>([])
export const checkinsStore = new Store<Checkin[]>([])
const RANGE_DAYS = 7 * 26

export async function loadHabits() {
  try {
    const today = civil()
    const [h, c] = await Promise.all([api.habitsList(), api.checkinsRange(addDays(today, -RANGE_DAYS), addDays(today, 1))])
    habitsStore.set(h)
    checkinsStore.set(c)
    habitsStore.loaded = true
  } catch (e) {
    fail(e)
  }
}

export function useHabits() {
  const habits = useSyncExternalStore(habitsStore.subscribe, habitsStore.get)
  const checkins = useSyncExternalStore(checkinsStore.subscribe, checkinsStore.get)
  useEffect(() => {
    if (!habitsStore.loaded) void loadHabits()
  }, [])
  return { habits, checkins }
}

export async function createHabit(input: NewHabit) {
  try {
    const h = await api.habitCreate(input)
    habitsStore.set([...habitsStore.get(), h])
    return h
  } catch (e) {
    fail(e)
  }
}

export async function updateHabit(id: string, patch: HabitPatch) {
  try {
    const h = await api.habitUpdate(id, patch)
    habitsStore.set(habitsStore.get().map((x) => (x.id === id ? h : x)))
  } catch (e) {
    fail(e)
  }
}

export async function setHabitPaused(id: string, paused: boolean) {
  try {
    const h = await api.habitSetPaused(id, paused, civil())
    habitsStore.set(habitsStore.get().map((x) => (x.id === id ? h : x)))
  } catch (e) {
    fail(e)
  }
}

export async function archiveHabit(id: string) {
  const prev = habitsStore.get()
  habitsStore.set(prev.filter((h) => h.id !== id))
  try {
    await api.habitArchive(id)
  } catch (e) {
    habitsStore.set(prev)
    fail(e)
  }
}

export async function setCheckin(habitId: string, date: string, status: CheckinStatus | null) {
  const prev = checkinsStore.get()
  const rest = prev.filter((c) => !(c.habitId === habitId && c.date === date))
  checkinsStore.set(status ? [...rest, { habitId, date, status }] : rest)
  try {
    await api.checkinSet(habitId, date, status)
  } catch (e) {
    checkinsStore.set(prev)
    fail(e)
  }
}

export function daysOn(h: Habit, date: string): number {
  let days = 0
  for (const s of h.schedules) if (s.fromDate <= date) days = s.days
  return days
}

export function isPaused(h: Habit, date: string): boolean {
  return h.pauses.some((p) => p.fromDate <= date && (!p.toDate || date < p.toDate))
}

export function isPausedNow(h: Habit): boolean {
  return h.pauses.some((p) => !p.toDate)
}

export function isScheduled(h: Habit, date: string): boolean {
  if (date < h.startDate) return false
  if (isPaused(h, date)) return false
  return (daysOn(h, date) & (1 << weekday(date))) !== 0
}

export type HabitStats = { scheduled: number; done: number; minimum: number; rate: number | null }

export function habitStats(h: Habit, checkins: Checkin[], from: string, to: string): HabitStats {
  const map = new Map(checkins.filter((c) => c.habitId === h.id).map((c) => [c.date, c.status]))
  let scheduled = 0
  let done = 0
  let minimum = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isScheduled(h, d)) continue
    scheduled++
    const s = map.get(d)
    if (s === 'done') done++
    if (s === 'minimum') minimum++
  }
  return { scheduled, done, minimum, rate: scheduled ? (done + minimum) / scheduled : null }
}

export const WEEKDAY_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export function describeDays(days: number): string {
  if (days === 127) return 'todos os dias'
  if (days === 62) return 'dias úteis'
  if (days === 65) return 'fins de semana'
  const names = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
  return names.filter((_, i) => days & (1 << i)).join(', ')
}

export function monthGrid(today: string, weeks: number): string[][] {
  const end = parseCivil(today)
  end.setDate(end.getDate() + (6 - end.getDay()))
  const out: string[][] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const col: string[] = []
    for (let d = 6; d >= 0; d--) {
      const dt = new Date(end)
      dt.setDate(end.getDate() - w * 7 - d)
      col.push(civil(dt))
    }
    out.push(col)
  }
  return out
}
