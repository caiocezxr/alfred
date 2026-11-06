import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../shared/db/api'
import { docToPlainText, type JSONNode } from './markdown'
import { makeSnippet, markTerms, matchesAll, MAX_IMAGE_BYTES, safeFileName, searchTerms, sniffImage } from './text'
import { canAddChild, canMove, depthOf, heightOf, indexNotes, isLive, MAX_DEPTH, subtreeIds } from './tree'

export type NoteMeta = {
  id: string
  parentId: string | null
  title: string
  sort: number
  archivedAt: string | null
  trashedAt: string | null
  createdAt: string
  updatedAt: string
  excerpt: string
}
export type Note = NoteMeta & { doc: string }
export type NotePatch = { title?: string; doc?: string; plainText?: string }
export type SearchHit = {
  id: string
  parentId: string | null
  title: string
  snippet: string
  updatedAt: string
  archivedAt: string | null
}
export type NoteAsset = { id: string; noteId: string; mime: string; size: number; createdAt: string }

export const EMPTY_DOC = '{"type":"doc","content":[{"type":"paragraph"}]}'

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args)
  return local(cmd, args) as Promise<T>
}

export const notesApi = {
  list: () => call<NoteMeta[]>('notes_list'),
  get: (id: string) => call<Note>('note_get', { id }),
  create: (input: { parentId?: string | null; title?: string }) => call<Note>('note_create', { input }),
  save: (id: string, patch: NotePatch) => call<NoteMeta>('note_save', { id, patch }),
  move: (id: string, parentId: string | null, beforeId: string | null) => call<NoteMeta>('note_move', { id, parentId, beforeId }),
  duplicate: (id: string) => call<Note>('note_duplicate', { id }),
  setArchived: (id: string, archived: boolean) => call<NoteMeta>('note_set_archived', { id, archived }),
  trash: (id: string) => call<NoteMeta>('note_trash', { id }),
  restore: (id: string) => call<NoteMeta>('note_restore', { id }),
  purge: (id: string) => call<number>('note_purge', { id }),
  emptyTrash: () => call<number>('notes_trash_empty'),
  search: (query: string, limit = 40) => call<SearchHit[]>('notes_search', { query: query.normalize('NFC'), limit }),

  assetSave: async (noteId: string, bytes: Uint8Array): Promise<NoteAsset> => {
    if (isTauri) return invoke<NoteAsset>('note_asset_save', bytes, { headers: { 'x-note-id': noteId } })
    return localAssetSave(noteId, bytes)
  },
  assetGet: (id: string) => (isTauri ? invoke<string>('note_asset_get', { id }) : localAssetGet(id)),

  exportMarkdown: async (fileName: string, markdown: string): Promise<string> => {
    if (isTauri) return invoke<string>('note_export_markdown', { fileName, markdown })
    return browserDownload(fileName, markdown)
  },
}

type LocalNote = Omit<NoteMeta, 'excerpt'> & { doc: string; plainText: string }
type LocalDb = { notes: LocalNote[] }
const KEY = 'ps.notes.v1'

function readDb(): LocalDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (Array.isArray(d.notes)) return d
    }
  } catch {
  }
  return { notes: [] }
}
function writeDb(db: LocalDb) {
  localStorage.setItem(KEY, JSON.stringify(db))
}
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()
const cleanTitle = (t: string) => t.replace(/[\n\r\t]/g, ' ').trim().slice(0, 500)
const toMeta = ({ doc: _doc, plainText, ...m }: LocalNote): NoteMeta => ({ ...m, excerpt: plainText.slice(0, 180).replace(/\s+/g, ' ') })
const toNote = (n: LocalNote): Note => ({ ...toMeta(n), doc: n.doc })

function place(db: LocalDb, id: string, parentId: string | null, beforeId: string | null) {
  const sibs = db.notes
    .filter((n) => n.parentId === parentId && n.id !== id)
    .sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt))
  const me = db.notes.find((n) => n.id === id)!
  const pos = beforeId ? sibs.findIndex((s) => s.id === beforeId) : -1
  sibs.splice(pos >= 0 ? pos : sibs.length, 0, me)
  sibs.forEach((s, i) => {
    s.parentId = parentId
    s.sort = i + 1
  })
}

function find(db: LocalDb, id: unknown): LocalNote {
  const n = db.notes.find((x) => x.id === id)
  if (!n) throw new Error('nota não encontrada')
  return n
}

async function local(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  const db = readDb()
  const idx = () => indexNotes(db.notes)
  const save = <T>(v: T) => {
    writeDb(db)
    return v
  }
  switch (cmd) {
    case 'notes_list':
      return db.notes.map(toMeta)
    case 'note_get':
      return toNote(find(db, a.id))
    case 'note_create': {
      const input = a.input as { parentId?: string | null; title?: string }
      const parentId = input.parentId ?? null
      if (parentId) {
        if (!isLive(parentId, idx())) throw new Error('a página de destino está na lixeira')
        if (!canAddChild(parentId, idx())) throw new Error(`as subpáginas vão até ${MAX_DEPTH} níveis`)
      }
      const t = now()
      const n: LocalNote = { id: uid(), parentId, title: cleanTitle(input.title ?? ''), sort: 0, archivedAt: null, trashedAt: null, createdAt: t, updatedAt: t, doc: EMPTY_DOC, plainText: '' }
      db.notes.push(n)
      place(db, n.id, parentId, null)
      return save(toNote(n))
    }
    case 'note_save': {
      const n = find(db, a.id)
      const p = a.patch as NotePatch
      if (p.doc !== undefined) {
        const v = JSON.parse(p.doc)
        if (v?.type !== 'doc') throw new Error('documento inválido')
      }
      const next = { title: p.title !== undefined ? cleanTitle(p.title) : n.title, doc: p.doc ?? n.doc, plainText: p.plainText ?? n.plainText }
      if (next.title !== n.title || next.doc !== n.doc || next.plainText !== n.plainText) {
        Object.assign(n, next, { updatedAt: now() })
        writeDb(db)
      }
      return toMeta(n)
    }
    case 'note_move': {
      const id = a.id as string
      const parentId = (a.parentId as string | null) ?? null
      if (!canMove(id, parentId, idx())) {
        if (parentId && depthOf(parentId, idx()) + heightOf(id, idx()) > MAX_DEPTH) throw new Error(`as subpáginas vão até ${MAX_DEPTH} níveis`)
        throw new Error('não dá para mover para lá')
      }
      place(db, id, parentId, (a.beforeId as string | null) ?? null)
      return save(toMeta(find(db, id)))
    }
    case 'note_duplicate': {
      const src = find(db, a.id)
      if (!isLive(src.id, idx())) throw new Error('restaure a página antes de duplicá-la')
      const t = now()
      const copy: LocalNote = { ...src, id: uid(), title: cleanTitle(`${src.title.trim() || 'Sem título'} (cópia)`), archivedAt: null, trashedAt: null, createdAt: t, updatedAt: t }
      db.notes.push(copy)
      const sibs = db.notes.filter((n) => n.parentId === src.parentId && n.id !== copy.id).sort((x, y) => x.sort - y.sort)
      const next = sibs[sibs.findIndex((s) => s.id === src.id) + 1]
      place(db, copy.id, src.parentId, next?.id ?? null)
      return save(toNote(copy))
    }
    case 'note_set_archived': {
      const n = find(db, a.id)
      n.archivedAt = a.archived ? (n.archivedAt ?? now()) : null
      return save(toMeta(n))
    }
    case 'note_trash': {
      const n = find(db, a.id)
      n.trashedAt = n.trashedAt ?? now()
      return save(toMeta(n))
    }
    case 'note_restore': {
      const n = find(db, a.id)
      n.trashedAt = null
      if (n.parentId) {
        const i = idx()
        const fits = i.byId.has(n.parentId) && isLive(n.parentId, i) && depthOf(n.parentId, i) + heightOf(n.id, i) <= MAX_DEPTH
        if (!fits) place(db, n.id, null, null)
      }
      return save(toMeta(n))
    }
    case 'note_purge': {
      const n = find(db, a.id)
      if (isLive(n.id, idx())) throw new Error('só dá para excluir definitivamente o que está na lixeira')
      const ids = new Set(subtreeIds(n.id, idx()))
      db.notes = db.notes.filter((x) => !ids.has(x.id))
      writeDb(db)
      void gcAssets(ids, db)
      return ids.size
    }
    case 'notes_trash_empty': {
      let count = 0
      for (const t of db.notes.filter((x) => x.trashedAt)) {
        if (!db.notes.some((x) => x.id === t.id)) continue
        const ids = new Set(subtreeIds(t.id, indexNotes(db.notes)))
        db.notes = db.notes.filter((x) => !ids.has(x.id))
        void gcAssets(ids, db)
        count++
      }
      return save(count)
    }
    case 'notes_search': {
      const terms = searchTerms(a.query as string)
      if (!terms.length) return []
      const i = idx()
      return db.notes
        .filter((n) => isLive(n.id, i) && matchesAll(`${n.title}\n${n.plainText}`, terms))
        .map((n) => ({ n, inTitle: matchesAll(n.title, terms) }))
        .sort((x, y) => Number(y.inTitle) - Number(x.inTitle) || y.n.updatedAt.localeCompare(x.n.updatedAt))
        .slice(0, (a.limit as number) ?? 40)
        .map(({ n }) => ({
          id: n.id,
          parentId: n.parentId,
          title: markTerms(n.title, terms),
          snippet: makeSnippet(n.plainText, terms),
          updatedAt: n.updatedAt,
          archivedAt: n.archivedAt,
        }))
    }
  }
  throw new Error(`comando desconhecido: ${cmd}`)
}

type StoredAsset = NoteAsset & { dataUrl: string }

let dbPromise: Promise<IDBDatabase> | null = null
function idb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('ps-notes-assets', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('assets', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'))
  })
  return dbPromise
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await idb()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('assets', mode).objectStore('assets'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('falha no IndexedDB'))
  })
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('não foi possível ler a imagem'))
    r.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }))
  })
}

async function localAssetSave(noteId: string, bytes: Uint8Array): Promise<NoteAsset> {
  if (!bytes.length) throw new Error('a imagem está vazia')
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('a imagem passa de 10 MB')
  const mime = sniffImage(bytes)
  if (!mime) throw new Error('formato não suportado: use PNG, JPEG, GIF ou WebP')
  if (!readDb().notes.some((n) => n.id === noteId)) throw new Error('nota não encontrada')
  const asset: StoredAsset = { id: uid(), noteId, mime, size: bytes.length, createdAt: now(), dataUrl: await bytesToDataUrl(bytes, mime) }
  await tx('readwrite', (s) => s.put(asset))
  const { dataUrl: _d, ...meta } = asset
  return meta
}

async function localAssetGet(id: string): Promise<string> {
  const a = (await tx<StoredAsset | undefined>('readonly', (s) => s.get(id) as IDBRequest<StoredAsset | undefined>))
  if (!a) throw new Error('imagem não encontrada')
  return a.dataUrl
}

async function gcAssets(removed: Set<string>, db: LocalDb) {
  try {
    const all = await tx<StoredAsset[]>('readonly', (s) => s.getAll() as IDBRequest<StoredAsset[]>)
    for (const a of all.filter((x) => removed.has(x.noteId))) {
      const heir = db.notes.find((n) => n.doc.includes(a.id))
      if (heir) await tx('readwrite', (s) => s.put({ ...a, noteId: heir.id }))
      else await tx('readwrite', (s) => s.delete(a.id))
    }
  } catch {
  }
}

async function browserDownload(fileName: string, markdown: string): Promise<string> {
  let text = markdown
  for (const m of new Set(markdown.match(/\(asset:[0-9a-f-]+\)/g) ?? [])) {
    const id = m.slice(7, -1)
    try {
      text = text.split(m).join(`(${await localAssetGet(id)})`)
    } catch {
    }
  }
  const name = `${safeFileName(fileName)}.md`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return name
}

export function plainTextOf(doc: string): string {
  try {
    return docToPlainText(JSON.parse(doc) as JSONNode)
  } catch {
    return ''
  }
}
