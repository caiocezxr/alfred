const DB = 'ps-briefing-voice'
const VERSION = 1

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files')
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbp.catch(() => {
    dbp = null
  })
  return dbp
}

function run<T>(store: 'files' | 'audio', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | null): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        let result: T
        if (req) req.onsuccess = () => (result = req.result as T)
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

type FileRow = { blob: Blob; type: string; at: number }

export const idbCache = {
  onMiss: null as null | ((key: string) => void),
  async match(key: string): Promise<Response | undefined> {
    const row = await run<FileRow | undefined>('files', 'readonly', (s) => s.get(key)).catch(() => undefined)
    if (!row) {
      if (/^https?:/.test(key)) idbCache.onMiss?.(key)
      return undefined
    }
    return new Response(row.blob, { status: 200, headers: { 'content-type': row.type, 'content-length': String(row.blob.size) } })
  },
  async put(key: string, response: Response): Promise<void> {
    const blob = await response.blob()
    await run('files', 'readwrite', (s) => s.put({ blob, type: response.headers.get('content-type') ?? 'application/octet-stream', at: Date.now() } satisfies FileRow, key))
  },
}

export async function modelCached(prefix: string): Promise<boolean> {
  const keys = await run<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[])
  return keys.some((k) => String(k).startsWith(prefix) && String(k).endsWith('.onnx'))
}

type AudioRow = { pcm: ArrayBuffer; at: number }

export async function audioGet(id: string): Promise<Float32Array | null> {
  const row = await run<AudioRow | undefined>('audio', 'readonly', (s) => s.get(id))
  return row ? new Float32Array(row.pcm) : null
}

export async function audioPut(id: string, pcm: Float32Array): Promise<void> {
  const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
  await run('audio', 'readwrite', (s) => s.put({ pcm: buf, at: Date.now() } satisfies AudioRow, id))
}

export async function audioPrune(maxAgeMs: number): Promise<void> {
  const limit = Date.now() - maxAgeMs
  await run('audio', 'readwrite', (s) => {
    const req = s.openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c) return
      if ((c.value as AudioRow).at < limit) c.delete()
      c.continue()
    }
    return null
  })
}
