import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../shared/db/api'
import { createLocal } from './local'
import type {
  Attachment, ChecklistEntry, Company, CompanyPatch, DayMark, ImportTask, ItemChange, ItemPatch, NewItem, NewTodo, SecretMeta, Settings,
  Seen, Snippet, SnippetInput, Stage, TimerChange, Todo, TodoCheck, TodoPatch, WorkState,
} from './types'

const local = typeof window !== 'undefined' && !isTauri ? createLocal(window.localStorage) : null

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args)
  try {
    return local!.exec(cmd, args) as T
  } catch (e) {
    return Promise.reject(e instanceof Error ? e.message : String(e))
  }
}

const IDB = 'ps.work.assets'
function idb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(IDB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('files')
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
}
async function idbRun<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await idb()
  return new Promise((ok, fail) => {
    const req = fn(d.transaction('files', mode).objectStore('files'))
    req.onsuccess = () => ok(req.result)
    req.onerror = () => fail(req.error)
  })
}

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

const MAX_BYTES = 10 * 1024 * 1024
const urlCache = new Map<string, Promise<string>>()

export const secretsAvailable = isTauri

export const workApi = {
  load: () => call<WorkState>('work_load'),
  create: (input: NewItem) => call<ItemChange>('work_item_create', { input }),
  update: (id: string, patch: ItemPatch) => call<ItemChange>('work_item_update', { id, patch }),
  remove: (id: string) => call<void>('work_item_delete', { id }),
  move: (id: string, stage: Stage, force = false, note: string | null = null) => call<ItemChange>('work_item_move', { id, stage, force, note }),
  giveBack: (id: string, reason: string) => call<ItemChange>('work_item_return', { id, reason }),
  resume: (id: string) => call<ItemChange>('work_item_resume', { id }),
  wait: (id: string, on: string | null) => call<ItemChange>('work_item_wait', { id, on }),
  followup: (id: string, note: string | null = null) => call<ItemChange>('work_item_followup', { id, note }),
  note: (id: string, text: string) => call<ItemChange>('work_item_note', { id, text }),
  noteDelete: (eventId: string) => call<ItemChange>('work_note_delete', { eventId }),
  snooze: (id: string, until: string | null) => call<ItemChange>('work_item_snooze', { id, until }),
  focus: (id: string, on: boolean) => call<ItemChange>('work_item_focus', { id, on }),
  check: (id: string, checkId: string, on: boolean) => call<ItemChange>('work_item_check', { id, checkId, on }),
  reorder: (ids: string[]) => call<void>('work_items_reorder', { ids }),

  checklistAdd: (companyId: string, label: string) => call<ChecklistEntry[]>('work_checklist_add', { companyId, label }),
  checklistRename: (id: string, label: string) => call<ChecklistEntry[]>('work_checklist_rename', { id, label }),
  checklistRemove: (id: string) => call<ChecklistEntry[]>('work_checklist_remove', { id }),
  checklistReorder: (companyId: string, ids: string[]) => call<ChecklistEntry[]>('work_checklist_reorder', { companyId, ids }),

  companyCreate: (name: string, color: string) => call<Company>('work_company_create', { name, color }),
  companyUpdate: (id: string, patch: CompanyPatch) => call<Company>('work_company_update', { id, patch }),
  companyDelete: (id: string) => call<void>('work_company_delete', { id }),

  settingsSet: (settings: Settings) => call<Settings>('work_settings_set', { settings }),

  todoCreate: (input: NewTodo) => call<Todo>('work_todo_create', { input }),
  todoUpdate: (id: string, patch: TodoPatch) => call<Todo>('work_todo_update', { id, patch }),
  todoDone: (id: string, on: boolean) => call<Todo>('work_todo_done', { id, on }),
  todoCheck: (id: string, date: string, on: boolean) => call<TodoCheck[]>('work_todo_check', { id, date, on }),
  todoDelete: (id: string) => call<void>('work_todo_delete', { id }),
  todoConvert: (id: string) => call<{ todo: Todo; change: ItemChange }>('work_todo_convert', { id }),
  todosImport: (tasks: ImportTask[]) => call<number>('work_todos_import', { tasks }),

  async attachmentSave(itemId: string, bytes: Uint8Array): Promise<Attachment> {
    if (!bytes.length) throw 'a imagem está vazia'
    if (bytes.length > MAX_BYTES) throw 'a imagem passa de 10 MB'
    const mime = sniff(bytes)
    if (!mime) throw 'formato não suportado: use PNG, JPEG, GIF ou WebP'
    if (isTauri) return invoke<Attachment>('work_attachment_save', bytes, { headers: { 'x-item-id': itemId } })
    const id = crypto.randomUUID()
    await idbRun('readwrite', (s) => s.put(new Blob([bytes as BlobPart], { type: mime }), id))
    return call<Attachment>('work_attachment_register', { id, itemId, mime, size: bytes.length })
  },
  attachmentUrl(id: string): Promise<string> {
    let p = urlCache.get(id)
    if (!p) {
      p = isTauri
        ? invoke<string>('work_attachment_get', { id })
        : idbRun<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>).then((b) => {
            if (!b) throw 'imagem não encontrada'
            return URL.createObjectURL(b)
          })
      p.catch(() => urlCache.delete(id))
      urlCache.set(id, p)
    }
    return p
  },
  async attachmentDelete(id: string): Promise<void> {
    urlCache.delete(id)
    if (isTauri) return invoke<void>('work_attachment_delete', { id })
    await idbRun('readwrite', (s) => s.delete(id)).catch(() => undefined)
    return call<void>('work_attachment_delete', { id })
  },

  secretAdd: (owner: { itemId?: string; companyId?: string }, label: string, value: string) =>
    call<SecretMeta>('work_secret_add', { itemId: owner.itemId ?? null, companyId: owner.companyId ?? null, label, value }),
  secretReveal: (id: string) => call<string>('work_secret_reveal', { id }),
  secretDelete: (id: string) => call<void>('work_secret_delete', { id }),

  timerStart: (itemId: string) => call<TimerChange>('work_timer_start', { itemId }),
  timerStop: () => call<TimerChange>('work_timer_stop'),
  sessionDelete: (id: string) => call<TimerChange>('work_session_delete', { id }),

  snippetSave: (input: SnippetInput) => call<Snippet[]>('work_snippet_save', { input }),
  snippetDelete: (id: string) => call<Snippet[]>('work_snippet_delete', { id }),

  seenTouch: (companyId: string) => call<Seen[]>('work_seen_touch', { companyId }),

  daySet: (d: DayMark) => call<DayMark>('work_day_set', { date: d.date, green: d.green, openCount: d.openCount, handledCount: d.handledCount }),
}
