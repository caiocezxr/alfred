import { useSyncExternalStore } from 'react'
import { civil } from '../../shared/dates'
import { api as legacyApi } from '../../shared/db/api'
import { workApi } from './api'
import { computeHealth, crossesDelivery, isPost, localNow, pendingChecks, todoDoneOn } from './logic'
import type { ChecklistEntry, Company, ItemChange, ItemPatch, NewItem, NewTodo, Settings, Stage, Todo, TodoPatch, WorkItem, WorkState } from './types'

export type Dialog =
  | { kind: 'deliver'; itemId: string; to: Stage }
  | { kind: 'backward'; itemId: string; to: Stage }
  | { kind: 'return'; itemId: string }
  | { kind: 'wait'; itemId: string }
  | { kind: 'standup' }
  | { kind: 'todo'; todoId?: string; draft?: Partial<NewTodo> }
  | { kind: 'settings'; tab?: 'alerts' | 'companies' | 'checklist' | 'notify' }
  | { kind: 'delete'; itemId: string }

export type Toast = { id: number; text: string; tone?: 'error' | 'ok'; undo?: () => void }
export type Celebration = { id: number; itemId: string | null; todoId: string | null; color: string | null }

type S = {
  state: WorkState | null
  loading: boolean
  error: string | null
  openId: string | null
  dialog: Dialog | null
  toast: Toast | null
  celebrate: Celebration | null
}

let s: S = { state: null, loading: false, error: null, openId: null, dialog: null, toast: null, celebrate: null }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const set = (patch: Partial<S>) => {
  s = { ...s, ...patch }
  emit()
}
export const getWork = () => s
export function useWork(): S {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => s,
  )
}
export const subscribeWork = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(text: string, opts: { tone?: 'error' | 'ok'; undo?: () => void } = {}) {
  clearTimeout(toastTimer)
  set({ toast: { id: ++toastSeq, text, ...opts } })
  toastTimer = setTimeout(() => set({ toast: null }), opts.undo ? 6000 : 3600)
}
export const dismissToast = () => set({ toast: null })
const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: 'error' })

const UI_KEY = 'ps.work.ui.v1'
export type UiPrefs = { scope?: string; view?: 'board' | 'delivered'; sound?: boolean; lastCompany?: string; asked?: boolean; captureTarget?: 'todo' | 'work'; todoTab?: 'today' | 'fixed' | 'upcoming' | 'done' }
export function readUi(): UiPrefs {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as UiPrefs
  } catch {
    return {}
  }
}
export function writeUi(p: UiPrefs) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...p }))
  } catch {
    return
  }
}

let loadPromise: Promise<void> | null = null
export function loadWork(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise
  set({ loading: true })
  loadPromise = workApi
    .load()
    .then(async (state) => {
      set({ state, loading: false, error: null })
      if (state.todos.length === 0) await importLegacyTasks()
    })
    .catch((e) => set({ loading: false, error: e instanceof Error ? e.message : String(e) }))
  return loadPromise
}

async function importLegacyTasks() {
  try {
    const tasks = await legacyApi.tasksList()
    const n = await workApi.todosImport(tasks.map((t) => ({ title: t.title, note: t.note ?? '', dueDate: t.dueDate, priority: t.priority, doneAt: t.doneAt })))
    if (n > 0) {
      set({ state: await workApi.load() })
      toast(`${n} ${n === 1 ? 'tarefa antiga veio' : 'tarefas antigas vieram'} para o espaço Pessoal`, { tone: 'ok' })
    }
  } catch {
    return
  }
}

function patchState(fn: (st: WorkState) => WorkState) {
  if (s.state) set({ state: fn(s.state) })
}

function apply(ch: ItemChange) {
  patchState((st) => {
    const exists = st.items.some((i) => i.id === ch.item.id)
    return {
      ...st,
      items: exists ? st.items.map((i) => (i.id === ch.item.id ? ch.item : i)) : [ch.item, ...st.items],
      events: [...st.events.filter((e) => e.itemId !== ch.item.id), ...ch.events].sort((a, b) => a.at.localeCompare(b.at)),
    }
  })
  return ch.item
}

async function run(p: Promise<ItemChange>): Promise<WorkItem | null> {
  try {
    return apply(await p)
  } catch (e) {
    fail(e)
    return null
  }
}

export const itemById = (id: string | null) => (id ? (s.state?.items.find((i) => i.id === id) ?? null) : null)
export const companyById = (id: string | null) => (id ? (s.state?.companies.find((c) => c.id === id) ?? null) : null)

export const openItem = (id: string | null) => set({ openId: id })
export const openDialog = (d: Dialog | null) => set({ dialog: d })

let celebSeq = 0
let audio: AudioContext | null = null
function chime() {
  if (!readUi().sound) return
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    for (const [f, d] of [
      [880, 0],
      [1318.5, 0.07],
    ] as const) {
      const o = audio.createOscillator()
      const g = audio.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0, t + d)
      g.gain.linearRampToValueAtTime(0.05, t + d + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5)
      o.connect(g).connect(audio.destination)
      o.start(t + d)
      o.stop(t + d + 0.55)
    }
  } catch {
    return
  }
}
export function celebrate(itemId: string | null, todoId: string | null = null) {
  const it = itemById(itemId)
  const td = todoId ? s.state?.todos.find((t) => t.id === todoId) : null
  const co = it?.companyId ?? td?.companyId ?? null
  set({ celebrate: { id: ++celebSeq, itemId, todoId, color: co ? (companyById(co)?.color ?? null) : null } })
  chime()
  setTimeout(() => {
    if (s.celebrate?.id === celebSeq) set({ celebrate: null })
  }, 1400)
}

export async function createItem(input: NewItem) {
  const it = await run(workApi.create(input))
  if (it) writeUi({ lastCompany: it.companyId })
  return it
}
export const updateItem = (id: string, patch: ItemPatch) => run(workApi.update(id, patch))

export function requestMove(id: string, to: Stage) {
  const it = itemById(id)
  if (!it || it.stage === to) return
  if (isPost(it.stage) && !isPost(to)) return openDialog({ kind: 'backward', itemId: id, to })
  if (crossesDelivery(it.stage, to) && pendingChecks(it, s.state!.checklist).length) return openDialog({ kind: 'deliver', itemId: id, to })
  void doMove(id, to, false)
}

export async function doMove(id: string, to: Stage, force: boolean, note: string | null = null) {
  const it = await run(workApi.move(id, to, force, note))
  if (it && (to === 'validated' || to === 'done')) celebrate(id)
  return it
}

export async function giveBack(id: string, reason: string) {
  const it = await run(workApi.giveBack(id, reason))
  if (it) toast(`Retorno registrado · voltou ${it.returns}×`)
  return it
}
export const resume = (id: string) => run(workApi.resume(id))
export const setWaiting = (id: string, on: string | null) => run(workApi.wait(id, on))
export async function followup(id: string, note: string | null = null) {
  const it = await run(workApi.followup(id, note))
  if (it) toast('Cobrança registrada · o alerta volta a contar a partir de hoje', { tone: 'ok' })
  return it
}
export const addNote = (id: string, text: string) => run(workApi.note(id, text))
export const deleteNote = (eventId: string) => run(workApi.noteDelete(eventId))
export const snooze = (id: string, until: string | null) => run(workApi.snooze(id, until))
export const setFocus = (id: string, on: boolean) => run(workApi.focus(id, on))
export const setCheck = (id: string, checkId: string, on: boolean) => run(workApi.check(id, checkId, on))

export async function deleteItem(id: string) {
  try {
    await workApi.remove(id)
    patchState((st) => ({
      ...st,
      items: st.items.filter((i) => i.id !== id),
      events: st.events.filter((e) => e.itemId !== id),
      attachments: st.attachments.filter((a) => a.itemId !== id),
      secrets: st.secrets.filter((x) => x.itemId !== id),
      todos: st.todos.map((t) => (t.itemId === id ? { ...t, itemId: null } : t)),
    }))
    if (s.openId === id) set({ openId: null })
    toast('Item excluído')
  } catch (e) {
    fail(e)
  }
}

export async function reorderColumn(ids: string[]) {
  patchState((st) => ({ ...st, items: st.items.map((i) => (ids.includes(i.id) ? { ...i, sort: ids.indexOf(i.id) } : i)) }))
  try {
    await workApi.reorder(ids)
  } catch (e) {
    fail(e)
  }
}

function putTodo(t: Todo) {
  patchState((st) => ({ ...st, todos: st.todos.some((x) => x.id === t.id) ? st.todos.map((x) => (x.id === t.id ? t : x)) : [t, ...st.todos] }))
}
export const todoById = (id: string | null) => (id ? (s.state?.todos.find((t) => t.id === id) ?? null) : null)

export async function createTodo(input: NewTodo) {
  try {
    const t = await workApi.todoCreate(input)
    putTodo(t)
    writeUi({ lastCompany: t.companyId })
    return t
  } catch (e) {
    fail(e)
    return null
  }
}
export async function updateTodo(id: string, patch: TodoPatch) {
  try {
    const t = await workApi.todoUpdate(id, patch)
    putTodo(t)
    return t
  } catch (e) {
    fail(e)
    return null
  }
}

export async function toggleTodo(id: string, day = civil()) {
  const t = todoById(id)
  if (!t || !s.state) return
  const done = todoDoneOn(t, s.state.todoChecks, day)
  try {
    if (t.mode === 'daily') {
      const checks = await workApi.todoCheck(id, day, !done)
      patchState((st) => ({ ...st, todoChecks: [...st.todoChecks.filter((c) => c.todoId !== id), ...checks] }))
    } else putTodo(await workApi.todoDone(id, !done))
    if (!done) {
      celebrate(null, id)
      if (t.mustNotForget) toast('Resolvido. Um a menos para lembrar.', { tone: 'ok', undo: () => void toggleTodo(id, day) })
    }
  } catch (e) {
    fail(e)
  }
}

export async function deleteTodo(id: string) {
  const t = todoById(id)
  try {
    await workApi.todoDelete(id)
    patchState((st) => ({ ...st, todos: st.todos.filter((x) => x.id !== id), todoChecks: st.todoChecks.filter((c) => c.todoId !== id) }))
    if (t)
      toast('To-do removido', {
        undo: () =>
          void createTodo({
            companyId: t.companyId, title: t.title, note: t.note, priority: t.priority, mode: t.mode, weekdaysOnly: t.weekdaysOnly,
            dueDate: t.dueDate, remindTime: t.remindTime, mustNotForget: t.mustNotForget,
          }),
      })
  } catch (e) {
    fail(e)
  }
}

export async function convertTodo(id: string) {
  try {
    const { todo, change } = await workApi.todoConvert(id)
    putTodo(todo)
    apply(change)
    set({ openId: change.item.id })
    toast('Virou item de trabalho no quadro', { tone: 'ok' })
  } catch (e) {
    fail(e)
  }
}

export async function saveSettings(settings: Settings) {
  try {
    const out = await workApi.settingsSet(settings)
    patchState((st) => ({ ...st, settings: out }))
    return true
  } catch (e) {
    fail(e)
    return false
  }
}

async function checklistOp(p: Promise<ChecklistEntry[]>) {
  try {
    const checklist = await p
    patchState((st) => ({ ...st, checklist }))
  } catch (e) {
    fail(e)
  }
}
export const checklistAdd = (companyId: string, label: string) => checklistOp(workApi.checklistAdd(companyId, label))
export const checklistRename = (id: string, label: string) => checklistOp(workApi.checklistRename(id, label))
export const checklistRemove = (id: string) => checklistOp(workApi.checklistRemove(id))
export const checklistReorder = (companyId: string, ids: string[]) => checklistOp(workApi.checklistReorder(companyId, ids))

function putCompany(c: Company) {
  patchState((st) => ({
    ...st,
    companies: (st.companies.some((x) => x.id === c.id) ? st.companies.map((x) => (x.id === c.id ? c : x)) : [...st.companies, c]).sort((a, b) => a.sort - b.sort),
  }))
}
export async function companyCreate(name: string, color: string) {
  try {
    putCompany(await workApi.companyCreate(name, color))
  } catch (e) {
    fail(e)
  }
}
export async function companyUpdate(id: string, patch: { name?: string; color?: string; logo?: string | null }) {
  try {
    putCompany(await workApi.companyUpdate(id, patch))
  } catch (e) {
    fail(e)
  }
}
export async function companyDelete(id: string) {
  try {
    await workApi.companyDelete(id)
    patchState((st) => ({ ...st, companies: st.companies.filter((c) => c.id !== id), checklist: st.checklist.filter((c) => c.companyId !== id) }))
  } catch (e) {
    fail(e)
  }
}

export async function attach(itemId: string, files: File[]) {
  for (const f of files) {
    try {
      const a = await workApi.attachmentSave(itemId, new Uint8Array(await f.arrayBuffer()))
      patchState((st) => ({ ...st, attachments: [...st.attachments, a] }))
    } catch (e) {
      fail(e)
    }
  }
}
export async function detach(id: string) {
  try {
    await workApi.attachmentDelete(id)
    patchState((st) => ({ ...st, attachments: st.attachments.filter((a) => a.id !== id) }))
  } catch (e) {
    fail(e)
  }
}

export async function secretAdd(owner: { itemId?: string; companyId?: string }, label: string, value: string) {
  try {
    const m = await workApi.secretAdd(owner, label, value)
    patchState((st) => ({ ...st, secrets: [...st.secrets, m] }))
    return true
  } catch (e) {
    fail(e)
    return false
  }
}
export async function secretDelete(id: string) {
  try {
    await workApi.secretDelete(id)
    patchState((st) => ({ ...st, secrets: st.secrets.filter((x) => x.id !== id) }))
  } catch (e) {
    fail(e)
  }
}

let lastDay = ''
let dayTimer: ReturnType<typeof setTimeout> | undefined
export function syncDay() {
  clearTimeout(dayTimer)
  dayTimer = setTimeout(() => {
    const st = s.state
    if (!st) return
    const today = civil()
    const h = computeHealth(st, today, localNow())
    const mark = { date: today, green: h.level === 'green', openCount: h.blockers.length, handledCount: h.handled }
    const key = JSON.stringify(mark)
    if (key === lastDay) return
    lastDay = key
    workApi
      .daySet(mark)
      .then((d) => patchState((x) => ({ ...x, days: [...x.days.filter((y) => y.date !== d.date), d].sort((a, b) => a.date.localeCompare(b.date)) })))
      .catch(() => {
        lastDay = ''
      })
  }, 1500)
}
