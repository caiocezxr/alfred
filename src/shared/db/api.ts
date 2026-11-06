import { invoke } from '@tauri-apps/api/core'

export type Task = {
  id: string
  title: string
  note: string
  dueDate: string | null
  priority: 0 | 1
  sort: number
  doneAt: string | null
  createdAt: string
}
export type NewTask = { title: string; note?: string; dueDate?: string | null; priority?: 0 | 1 }
export type TaskPatch = { title?: string; note?: string; dueDate?: string; priority?: 0 | 1; done?: boolean }

export type Schedule = { fromDate: string; days: number }
export type Pause = { fromDate: string; toDate: string | null }
export type Habit = {
  id: string
  name: string
  timeOfDay: string | null
  cue: string
  minimum: string
  why: string
  obstaclePlan: string
  startDate: string
  sort: number
  archivedAt: string | null
  schedules: Schedule[]
  pauses: Pause[]
}
export type NewHabit = {
  name: string
  days: number
  timeOfDay?: string | null
  cue?: string
  minimum?: string
  why?: string
  obstaclePlan?: string
  startDate: string
}
export type HabitPatch = Partial<Omit<NewHabit, 'startDate'>> & { today: string }
export type CheckinStatus = 'done' | 'minimum'
export type Checkin = { habitId: string; date: string; status: CheckinStatus }

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args)
  return local(cmd, args) as Promise<T>
}

export const api = {
  dbInfo: () => call<{ path: string; schemaVersion: number; error: string | null }>('db_info'),
  backupNow: () => call<string>('backup_now'),
  settingGet: (key: string) => call<string | null>('setting_get', { key }),
  settingSet: (key: string, value: string) => call<void>('setting_set', { key, value }),

  tasksList: () => call<Task[]>('tasks_list'),
  taskCreate: (input: NewTask) => call<Task>('task_create', { input }),
  taskUpdate: (id: string, patch: TaskPatch) => call<Task>('task_update', { id, patch }),
  taskDelete: (id: string) => call<void>('task_delete', { id }),
  tasksReorder: (ids: string[]) => call<void>('tasks_reorder', { ids }),

  habitsList: () => call<Habit[]>('habits_list'),
  habitCreate: (input: NewHabit) => call<Habit>('habit_create', { input }),
  habitUpdate: (id: string, patch: HabitPatch) => call<Habit>('habit_update', { id, patch }),
  habitSetPaused: (id: string, paused: boolean, today: string) => call<Habit>('habit_set_paused', { id, paused, today }),
  habitArchive: (id: string) => call<void>('habit_archive', { id }),
  checkinsRange: (from: string, to: string) => call<Checkin[]>('checkins_range', { from, to }),
  checkinSet: (habitId: string, date: string, status: CheckinStatus | null) =>
    call<void>('checkin_set', { habitId, date, status }),
}

type LocalDb = { settings: Record<string, string>; tasks: Task[]; habits: Habit[]; checkins: Checkin[] }
const KEY = 'ps.localdb.v1'

function readDb(): LocalDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
  }
  return { settings: {}, tasks: [], habits: [], checkins: [] }
}
function writeDb(db: LocalDb) {
  localStorage.setItem(KEY, JSON.stringify(db))
}
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

async function local(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  const db = readDb()
  const save = <T>(v: T) => {
    writeDb(db)
    return v
  }
  switch (cmd) {
    case 'db_info':
      return { path: 'localStorage (navegador)', schemaVersion: 1, error: null }
    case 'backup_now': {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
      return URL.createObjectURL(blob)
    }
    case 'setting_get':
      return db.settings[a.key as string] ?? null
    case 'setting_set':
      db.settings[a.key as string] = a.value as string
      return save(undefined)
    case 'tasks_list':
      return [...db.tasks].sort((x, y) => x.sort - y.sort)
    case 'task_create': {
      const i = a.input as NewTask
      if (!i.title.trim()) throw new Error('a tarefa precisa de um título')
      const t: Task = {
        id: uid(),
        title: i.title.trim(),
        note: i.note ?? '',
        dueDate: i.dueDate || null,
        priority: i.priority ?? 0,
        sort: Math.max(0, ...db.tasks.map((x) => x.sort)) + 1,
        doneAt: null,
        createdAt: now(),
      }
      db.tasks.push(t)
      return save(t)
    }
    case 'task_update': {
      const t = db.tasks.find((x) => x.id === a.id)
      if (!t) throw new Error('tarefa não encontrada')
      const p = a.patch as TaskPatch
      if (p.title !== undefined) t.title = p.title.trim() || t.title
      if (p.note !== undefined) t.note = p.note
      if (p.dueDate !== undefined) t.dueDate = p.dueDate || null
      if (p.priority !== undefined) t.priority = p.priority
      if (p.done !== undefined) t.doneAt = p.done ? (t.doneAt ?? now()) : null
      return save({ ...t })
    }
    case 'task_delete':
      db.tasks = db.tasks.filter((x) => x.id !== a.id)
      return save(undefined)
    case 'tasks_reorder':
      ;(a.ids as string[]).forEach((id, i) => {
        const t = db.tasks.find((x) => x.id === id)
        if (t) t.sort = i
      })
      return save(undefined)
    case 'habits_list':
      return db.habits.filter((h) => !h.archivedAt).sort((x, y) => x.sort - y.sort)
    case 'habit_create': {
      const i = a.input as NewHabit
      const h: Habit = {
        id: uid(),
        name: i.name.trim(),
        timeOfDay: i.timeOfDay || null,
        cue: i.cue ?? '',
        minimum: i.minimum ?? '',
        why: i.why ?? '',
        obstaclePlan: i.obstaclePlan ?? '',
        startDate: i.startDate,
        sort: Math.max(0, ...db.habits.map((x) => x.sort)) + 1,
        archivedAt: null,
        schedules: [{ fromDate: i.startDate, days: i.days }],
        pauses: [],
      }
      db.habits.push(h)
      return save(h)
    }
    case 'habit_update': {
      const h = db.habits.find((x) => x.id === a.id)
      if (!h) throw new Error('hábito não encontrado')
      const p = a.patch as HabitPatch
      if (p.name?.trim()) h.name = p.name.trim()
      for (const k of ['cue', 'minimum', 'why', 'obstaclePlan'] as const) if (p[k] !== undefined) h[k] = p[k] as string
      if (p.timeOfDay !== undefined) h.timeOfDay = p.timeOfDay || null
      if (p.days && h.schedules[h.schedules.length - 1]?.days !== p.days) {
        h.schedules = h.schedules.filter((s) => s.fromDate !== p.today)
        h.schedules.push({ fromDate: p.today, days: p.days })
      }
      return save({ ...h })
    }
    case 'habit_set_paused': {
      const h = db.habits.find((x) => x.id === a.id)!
      const open = h.pauses.find((p) => !p.toDate)
      if (a.paused && !open) h.pauses.push({ fromDate: a.today as string, toDate: null })
      if (!a.paused && open) open.toDate = a.today as string
      return save({ ...h })
    }
    case 'habit_archive': {
      const h = db.habits.find((x) => x.id === a.id)
      if (h) h.archivedAt = now()
      return save(undefined)
    }
    case 'checkins_range':
      return db.checkins.filter((c) => c.date >= (a.from as string) && c.date <= (a.to as string))
    case 'checkin_set': {
      db.checkins = db.checkins.filter((c) => !(c.habitId === a.habitId && c.date === a.date))
      if (a.status) db.checkins.push({ habitId: a.habitId as string, date: a.date as string, status: a.status as CheckinStatus })
      return save(undefined)
    }
  }
  throw new Error(`comando desconhecido: ${cmd}`)
}
