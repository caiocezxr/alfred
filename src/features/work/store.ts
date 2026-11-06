import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { addDays, civil } from '../../shared/dates'
import { api as legacyApi } from '../../shared/db/api'
import { HYBRID, getProfile, onProfile, profileFromScope, profileScope, setProfile } from '../../shared/profile'
import { workApi } from './api'
import { commitMessage, computeHealth, crossesDelivery, isPost, localNow, pendingChecks, renderSnippet, ticketUrl, todoDoneOn, type Nudge } from './logic'
import { openExternal } from '../../shared/openExternal'
import type { ChecklistEntry, Company, ItemChange, SnippetInput, ItemPatch, NewItem, NewTodo, Settings, Stage, TimerChange, Todo, TodoPatch, WorkItem, WorkState } from './types'

export type Dialog =
  | { kind: 'deliver'; itemId: string; to: Stage }
  | { kind: 'backward'; itemId: string; to: Stage }
  | { kind: 'return'; itemId: string }
  | { kind: 'wait'; itemId: string }
  | { kind: 'standup' }
  | { kind: 'todo'; todoId?: string; draft?: Partial<NewTodo> }
  | { kind: 'settings'; tab?: 'alerts' | 'companies' | 'checklist' | 'notify' | 'tickets' | 'replies' }
  | { kind: 'delete'; itemId: string }
  | { kind: 'keys' }
  | { kind: 'hours'; range?: 'day' | 'week' }
  | { kind: 'search' }

export type Toast = { id: number; text: string; tone?: 'error' | 'ok'; undo?: () => void; undoLabel?: string }
export type Celebration = { id: number; itemId: string | null; todoId: string | null; color: string | null }

type S = {
  state: WorkState | null
  loading: boolean
  error: string | null
  openId: string | null
  dialog: Dialog | null
  toast: Toast | null
  celebrate: Celebration | null
  selectedId: string | null
  scope: string
}

let s: S = { state: null, loading: false, error: null, openId: null, dialog: null, toast: null, celebrate: null, selectedId: null, scope: profileScope(getProfile()) }
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
export function toast(text: string, opts: { tone?: 'error' | 'ok'; undo?: () => void; undoLabel?: string } = {}) {
  clearTimeout(toastTimer)
  set({ toast: { id: ++toastSeq, text, ...opts } })
  toastTimer = setTimeout(() => set({ toast: null }), opts.undo ? 6000 : 3600)
}
export const dismissToast = () => set({ toast: null })
const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: 'error' })

const UI_KEY = 'ps.work.ui.v1'
export type UiPrefs = { scope?: string; view?: 'board' | 'delivered' | 'github'; sound?: boolean; lastCompany?: string; asked?: boolean; captureTarget?: 'todo' | 'work'; todoTab?: 'today' | 'fixed' | 'upcoming' | 'done'; slimDone?: boolean; hojeTab?: string; hoursStep?: number }
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
      sessions: [...st.sessions.filter((x) => x.itemId !== ch.item.id), ...ch.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    }
  })
  return ch.item
}

function applyTimer(ch: TimerChange) {
  patchState((st) => ({
    ...st,
    sessions: [...st.sessions.filter((x) => !ch.itemIds.includes(x.itemId)), ...ch.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  }))
}

export async function startTimer(id: string) {
  const it = itemById(id)
  if (!it) return
  try {
    applyTimer(await workApi.timerStart(id))
    if (it.stage === 'todo') await run(workApi.move(id, 'doing'))
  } catch (e) {
    fail(e)
  }
}
export async function stopTimer() {
  try {
    applyTimer(await workApi.timerStop())
  } catch (e) {
    fail(e)
  }
}
export function toggleTimer(id: string) {
  const running = s.state?.sessions.find((x) => !x.endedAt)
  return running?.itemId === id ? stopTimer() : startTimer(id)
}
export async function deleteSession(id: string) {
  try {
    applyTimer(await workApi.sessionDelete(id))
  } catch (e) {
    fail(e)
  }
}

export const select = (id: string | null) => s.selectedId !== id && set({ selectedId: id })
export function setScope(scope: string) {
  if (scope !== 'all') touchCompany(scope)
  if (scope === s.scope) return
  set({ scope })
  setProfile(profileFromScope(scope), s.state?.companies.find((c) => c.id === scope)?.color ?? null)
}
export function initScope() {
  const v = profileScope(getProfile())
  if (s.scope !== v) set({ scope: v })
}
if (typeof window !== 'undefined') onProfile((p) => s.scope !== profileScope(p) && set({ scope: profileScope(p) }))

type VT = { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }
export const canMorph = () =>
  typeof document !== 'undefined' && !!(document as unknown as VT).startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

function morph(update: () => void, el: HTMLElement | null) {
  const doc = document as unknown as VT
  if (!canMorph() || !el || document.documentElement.dataset.vt) return update()
  const root = document.documentElement
  root.dataset.vt = 'wk'
  el.style.setProperty('view-transition-name', 'wk-item')
  doc
    .startViewTransition!(() => {
      el.style.removeProperty('view-transition-name')
      flushSync(update)
    })
    .finished.finally(() => {
      delete root.dataset.vt
      el.style.removeProperty('view-transition-name')
    })
}

export function openItemFrom(id: string, el?: HTMLElement | null) {
  select(id)
  touchCompany(itemById(id)?.companyId)
  morph(() => set({ openId: id }), el ?? null)
}

export function closeItem() {
  const id = s.openId
  if (!id) return
  const doc = document as unknown as VT
  const card = document.querySelector<HTMLElement>(`[data-card="${id}"]`)
  if (!canMorph() || !card || document.documentElement.dataset.vt) return set({ openId: null })
  const root = document.documentElement
  root.dataset.vt = 'wk-close'
  doc
    .startViewTransition!(() => {
      flushSync(() => set({ openId: null }))
      card.style.setProperty('view-transition-name', 'wk-item')
    })
    .finished.finally(() => {
      delete root.dataset.vt
      card.style.removeProperty('view-transition-name')
    })
}

export async function runNudge(n: Nudge) {
  if (!n.action) return n.itemIds[0] && openItemFrom(n.itemIds[0])
  const today = civil()
  const ids = n.itemIds
  switch (n.action.kind) {
    case 'followup':
      for (const id of ids) await run(workApi.followup(id, null))
      return toast(ids.length > 1 ? `${ids.length} cobranças registradas` : 'Cobrança registrada', { tone: 'ok' })
    case 'resume':
      for (const id of ids) await run(workApi.resume(id))
      return
    case 'snooze':
      for (const id of ids) await run(workApi.snooze(id, addDays(today, 3)))
      return toast('Adiado por 3 dias', { tone: 'ok' })
    case 'due_tomorrow':
      for (const id of ids) await run(workApi.update(id, { dueDate: addDays(today, 1) }))
      return toast(ids.length > 1 ? 'Prazos movidos para amanhã' : 'Prazo movido para amanhã', { tone: 'ok' })
    case 'focus':
      for (const id of ids.slice(0, 3)) await run(workApi.focus(id, true))
      return
    case 'close':
      for (const id of ids) {
        const it = await run(workApi.move(id, 'done', true))
        if (it) celebrate(id)
      }
      return
    case 'open':
      return ids[0] && openItemFrom(ids[0], document.querySelector<HTMLElement>(`[data-card="${ids[0]}"]`))
    case 'show_doing':
      return document.getElementById('wk-col-doing')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    case 'respond':
      for (const id of ids) await respond(id)
      return
    case 'open_company':
      if (n.companyId) setScope(n.companyId)
      return
  }
}

export async function respond(id: string) {
  const it = await run(workApi.followup(id, 'primeira resposta'))
  if (it) toast('Resposta registrada no chamado', { tone: 'ok' })
  return it
}

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${what} copiado`, { tone: 'ok' })
    return true
  } catch {
    toast('Não consegui copiar; selecione o texto e use ⌘C', { tone: 'error' })
    return false
  }
}

export function itemTicketUrl(id: string) {
  const it = itemById(id)
  return it ? ticketUrl(it, companyById(it.companyId)) : null
}

export function openTicket(id: string) {
  const url = itemTicketUrl(id)
  if (url) void openExternal(url)
  else toast('Sem link: configure o modelo de link do chamado em Ajustes › Chamados')
}

export async function copyReply(itemId: string, snippetId?: string) {
  const it = itemById(itemId)
  const st = s.state
  if (!it || !st) return
  const list = st.snippets.filter((x) => x.companyId === it.companyId)
  const sn = snippetId ? list.find((x) => x.id === snippetId) : (list.find((x) => x.isDefault) ?? list[0])
  if (!sn) return toast('Nenhuma resposta rápida para este espaço. Crie em Ajustes › Respostas')
  const text = renderSnippet(sn.body, it, companyById(it.companyId), civil())
  try {
    await navigator.clipboard.writeText(text)
    toast(`“${sn.title}” copiada para colar no chamado`, { tone: 'ok', undo: () => void respond(itemId), undoLabel: 'Registrar como resposta' })
  } catch {
    toast('Não consegui copiar', { tone: 'error' })
  }
}

export function copyCommit(itemId: string) {
  const it = itemById(itemId)
  if (it) void copyText(commitMessage(it), 'Mensagem de commit')
}

export async function snippetSave(input: SnippetInput) {
  try {
    const snippets = await workApi.snippetSave(input)
    patchState((st) => ({ ...st, snippets }))
    return true
  } catch (e) {
    fail(e)
    return false
  }
}
export async function snippetDelete(id: string) {
  try {
    const snippets = await workApi.snippetDelete(id)
    patchState((st) => ({ ...st, snippets }))
  } catch (e) {
    fail(e)
  }
}

async function run(p: Promise<ItemChange>): Promise<WorkItem | null> {
  try {
    const it = apply(await p)
    touchCompany(it.companyId)
    return it
  } catch (e) {
    fail(e)
    return null
  }
}

const lastTouch = new Map<string, number>()
export function touchCompany(companyId: string | null | undefined) {
  if (!companyId || !s.state?.companies.some((c) => c.id === companyId)) return
  const today = civil()
  const seen = s.state.seen.find((x) => x.companyId === companyId)
  const recent = Date.now() - (lastTouch.get(companyId) ?? 0) < 10 * 60 * 1000
  if (recent && seen && civil(new Date(seen.seenAt)) === today) return
  lastTouch.set(companyId, Date.now())
  workApi
    .seenTouch(companyId)
    .then((seenList) => patchState((st) => ({ ...st, seen: seenList })))
    .catch(() => lastTouch.delete(companyId))
}

export const itemById = (id: string | null) => (id ? (s.state?.items.find((i) => i.id === id) ?? null) : null)
export const companyById = (id: string | null) => (id ? (s.state?.companies.find((c) => c.id === id) ?? null) : null)

export const openItem = (id: string | null) => {
  set({ openId: id })
  if (id) touchCompany(itemById(id)?.companyId)
}
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
  touchCompany(t.companyId)
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
export async function companyCreate(name: string, color: string): Promise<Company | null> {
  try {
    const c = await workApi.companyCreate(name, color)
    putCompany(c)
    return c
  } catch (e) {
    fail(e)
    return null
  }
}
export async function companyUpdate(id: string, patch: import('./types').CompanyPatch) {
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
    if (getProfile() === id) setProfile(HYBRID)
    if (s.scope === id) set({ scope: 'all' })
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
