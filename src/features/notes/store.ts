import { useEffect, useState, useSyncExternalStore } from 'react'
import { notesApi, type Note, type NoteMeta, type NotePatch } from './api'

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function createSignal<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(v: T) {
      value = v
      for (const l of listeners) l()
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

const say = (e: unknown) => {
  const s = e instanceof Error ? e.message : String(e)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type Notice = { id: number; text: string; tone?: 'error'; action?: { label: string; run: () => void } }
const notice = createSignal<Notice | null>(null)
let noticeSeq = 0
export function notify(text: string, opts: Omit<Notice, 'id' | 'text'> = {}) {
  notice.set({ id: ++noticeSeq, text, ...opts })
}
export function dismissNotice(id?: number) {
  if (id === undefined || notice.get()?.id === id) notice.set(null)
}
export const useNotice = () => useSyncExternalStore(notice.subscribe, notice.get)

type ListState = { notes: NoteMeta[]; loaded: boolean; error: string | null }
const list = createSignal<ListState>({ notes: [], loaded: false, error: null })
let loadGen = 0
let started = false

const pendingTitle = new Map<string, string>()

function setNotes(notes: NoteMeta[]) {
  list.set({ ...list.get(), notes, loaded: true, error: null })
}

function patchMeta(id: string, fn: (m: NoteMeta) => NoteMeta) {
  setNotes(list.get().notes.map((m) => (m.id === id ? fn(m) : m)))
}

export function getMeta(id: string): NoteMeta | undefined {
  return list.get().notes.find((m) => m.id === id)
}

export function loadNotes(): Promise<void> {
  started = true
  const gen = ++loadGen
  return enqueue(() => notesApi.list())
    .then((server) => {
      if (gen !== loadGen) return
      setNotes(
        server.map((m) => {
          const local = pendingTitle.get(m.id) ?? getMeta(m.id)?.title
          return local !== undefined && (pendingTitle.has(m.id) || local.trim() === m.title) ? { ...m, title: local } : m
        }),
      )
      applyRescue()
    })
    .catch((e) => {
      if (gen === loadGen) list.set({ ...list.get(), loaded: true, error: say(e) })
    })
}

export function useNotesState(): ListState {
  const s = useSyncExternalStore(list.subscribe, list.get)
  useEffect(() => {
    if (!started) void loadNotes()
  }, [])
  return s
}

let chain: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn)
  chain = p.catch(() => {})
  return p
}

const docs = new Map<string, Note>()
const DOC_CACHE = 40

function cacheDoc(n: Note) {
  docs.delete(n.id)
  docs.set(n.id, n)
  while (docs.size > DOC_CACHE) docs.delete(docs.keys().next().value!)
}

export function peekNote(id: string): Note | undefined {
  return docs.get(id)
}

export async function openNote(id: string): Promise<Note> {
  const hit = docs.get(id)
  if (hit) return hit
  const n = await enqueue(() => notesApi.get(id))
  const fresh = docs.get(id) ?? n
  cacheDoc(fresh)
  return fresh
}

type SaveState = { saving: number; failed: string[]; error: string | null }
const saveState = createSignal<SaveState>({ saving: 0, failed: [], error: null })
export const useSaveState = () => useSyncExternalStore(saveState.subscribe, saveState.get)

const editing = createSignal(false)
export function setEditing(v: boolean) {
  if (editing.get() !== v) editing.set(v)
}
export const useEditing = () => useSyncExternalStore(editing.subscribe, editing.get)

const unsaved = new Map<string, NotePatch>()
const saveSeq = new Map<string, number>()
const RESCUE_KEY = 'ps.notes.rescue.v1'

function writeRescue() {
  try {
    if (unsaved.size) localStorage.setItem(RESCUE_KEY, JSON.stringify(Object.fromEntries(unsaved)))
    else localStorage.removeItem(RESCUE_KEY)
  } catch {
  }
}

let rescued = false
function applyRescue() {
  if (rescued) return
  rescued = true
  let saved: Record<string, NotePatch> = {}
  try {
    saved = JSON.parse(localStorage.getItem(RESCUE_KEY) ?? '{}')
  } catch {
  }
  for (const [id, patch] of Object.entries(saved)) {
    if (getMeta(id) && patch && typeof patch === 'object') saveNote(id, patch)
  }
  if (!Object.keys(saved).length) localStorage.removeItem(RESCUE_KEY)
}

export function saveNote(id: string, patch: NotePatch): Promise<void> {
  const seq = (saveSeq.get(id) ?? 0) + 1
  saveSeq.set(id, seq)
  unsaved.set(id, { ...unsaved.get(id), ...patch })
  if (patch.title !== undefined) pendingTitle.set(id, patch.title)

  const cached = docs.get(id)
  if (cached) cacheDoc({ ...cached, title: patch.title ?? cached.title, doc: patch.doc ?? cached.doc })
  if (getMeta(id)) {
    patchMeta(id, (m) => ({
      ...m,
      title: patch.title ?? m.title,
      excerpt: patch.plainText !== undefined ? patch.plainText.slice(0, 180).replace(/\s+/g, ' ') : m.excerpt,
      updatedAt: patch.doc !== undefined || patch.title !== undefined ? new Date().toISOString() : m.updatedAt,
    }))
  }

  const s = saveState.get()
  saveState.set({ ...s, saving: s.saving + 1 })
  return enqueue(() => notesApi.save(id, patch))
    .then((meta) => {
      if (saveSeq.get(id) === seq) {
        unsaved.delete(id)
        if (pendingTitle.get(id) === patch.title) pendingTitle.delete(id)
        writeRescue()
      }
      if (getMeta(id)) patchMeta(id, (m) => ({ ...m, updatedAt: meta.updatedAt }))
      const st = saveState.get()
      const failed = saveSeq.get(id) === seq ? st.failed.filter((f) => f !== id) : st.failed
      saveState.set({ ...st, failed, error: failed.length ? st.error : null })
    })
    .catch((e) => {
      writeRescue()
      const st = saveState.get()
      saveState.set({ ...st, failed: st.failed.includes(id) ? st.failed : [...st.failed, id], error: say(e) })
    })
    .finally(() => {
      const st = saveState.get()
      saveState.set({ ...st, saving: Math.max(0, st.saving - 1) })
    })
}

export function retryFailedSaves() {
  for (const id of saveState.get().failed) {
    const p = unsaved.get(id)
    if (p) void saveNote(id, p)
  }
}

type Flusher = () => void
const flushers = new Set<Flusher>()
export function registerFlusher(f: Flusher) {
  flushers.add(f)
  return () => {
    flushers.delete(f)
  }
}
export function flushNow() {
  for (const f of flushers) f()
}
export async function flushPending() {
  flushNow()
  await chain
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushNow()
    writeRescue()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
  window.addEventListener('blur', flushNow)
}

export function setTitleLocal(id: string, title: string) {
  pendingTitle.set(id, title)
  patchMeta(id, (m) => ({ ...m, title }))
}

export function renameNote(id: string, title: string) {
  setTitleLocal(id, title)
  void saveNote(id, { title })
}

export async function createNote(parentId: string | null = null): Promise<Note | null> {
  try {
    const n = await enqueue(() => notesApi.create({ parentId }))
    cacheDoc(n)
    const { doc: _doc, ...meta } = n
    setNotes([...list.get().notes, meta])
    return n
  } catch (e) {
    notify(say(e), { tone: 'error' })
    return null
  }
}

export async function moveNote(id: string, parentId: string | null, beforeId: string | null = null): Promise<boolean> {
  const prev = list.get().notes
  const sibs = prev.filter((m) => m.parentId === parentId && m.id !== id).sort((a, b) => a.sort - b.sort)
  const at = beforeId ? sibs.findIndex((s) => s.id === beforeId) : -1
  const sort = at < 0 ? (sibs.at(-1)?.sort ?? 0) + 1 : at === 0 ? sibs[0].sort - 1 : (sibs[at - 1].sort + sibs[at].sort) / 2
  patchMeta(id, (m) => ({ ...m, parentId, sort }))
  try {
    await enqueue(() => notesApi.move(id, parentId, beforeId))
    await loadNotes()
    return true
  } catch (e) {
    setNotes(prev)
    notify(say(e), { tone: 'error' })
    return false
  }
}

export async function duplicateNote(id: string): Promise<Note | null> {
  try {
    await flushPending()
    const n = await enqueue(() => notesApi.duplicate(id))
    cacheDoc(n)
    await loadNotes()
    return n
  } catch (e) {
    notify(say(e), { tone: 'error' })
    return null
  }
}

export async function archiveNote(id: string, archived: boolean) {
  const prev = getMeta(id)
  patchMeta(id, (m) => ({ ...m, archivedAt: archived ? new Date().toISOString() : null }))
  try {
    const meta = await enqueue(() => notesApi.setArchived(id, archived))
    patchMeta(id, (m) => ({ ...m, archivedAt: meta.archivedAt }))
    return true
  } catch (e) {
    if (prev) patchMeta(id, () => prev)
    notify(say(e), { tone: 'error' })
    return false
  }
}

export async function trashNote(id: string) {
  await flushPending()
  patchMeta(id, (m) => ({ ...m, trashedAt: new Date().toISOString() }))
  try {
    const meta = await enqueue(() => notesApi.trash(id))
    patchMeta(id, (m) => ({ ...m, trashedAt: meta.trashedAt }))
    return true
  } catch (e) {
    patchMeta(id, (m) => ({ ...m, trashedAt: null }))
    notify(say(e), { tone: 'error' })
    return false
  }
}

export async function restoreNote(id: string) {
  patchMeta(id, (m) => ({ ...m, trashedAt: null }))
  try {
    await enqueue(() => notesApi.restore(id))
    await loadNotes()
    return true
  } catch (e) {
    notify(say(e), { tone: 'error' })
    await loadNotes()
    return false
  }
}

export async function purgeNote(id: string) {
  try {
    await enqueue(() => notesApi.purge(id))
    await loadNotes()
    for (const k of [...docs.keys()]) if (!getMeta(k)) docs.delete(k)
    return true
  } catch (e) {
    notify(say(e), { tone: 'error' })
    return false
  }
}

export async function emptyTrash() {
  try {
    const n = await enqueue(() => notesApi.emptyTrash())
    await loadNotes()
    for (const k of [...docs.keys()]) if (!getMeta(k)) docs.delete(k)
    return n
  } catch (e) {
    notify(say(e), { tone: 'error' })
    return 0
  }
}

export function notifyError(e: unknown) {
  notify(say(e), { tone: 'error' })
}
