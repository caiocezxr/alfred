import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../shared/db/api'
import { localCommand, seedDb, type LocalDb } from './localdb.ts'
import type {
  FeedItem, FeedSource, ItemPatch, Keyword, KeywordInput, NewFeedItem, NewSource, SourcePatch, UpsertResult,
} from './types.ts'

const KEY = 'ps.radar.v1'

function readLocal(): LocalDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as LocalDb
      if (db?.v === 1 && Array.isArray(db.sources) && Array.isArray(db.items)) return db
    }
  } catch {
  }
  const db = seedDb(new Date().toISOString())
  writeLocal(db)
  return db
}

function writeLocal(db: LocalDb) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    throw new Error('o armazenamento do navegador está cheio')
  }
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args)
  const db = readLocal()
  const out = localCommand(db, cmd, args, new Date())
  writeLocal(db)
  return out as T
}

async function proxyFetch(url: string): Promise<string> {
  let r: Response
  try {
    r = await fetch(`/__radar?url=${encodeURIComponent(url)}`, { cache: 'no-store' })
  } catch {
    throw new Error('[rede] sem conexão com o servidor de desenvolvimento')
  }
  const text = await r.text()
  if (!r.ok) throw new Error(/^\[/.test(text) ? text : `[rede] o proxy respondeu ${r.status}`)
  return text
}

export const radarApi = {
  fetchFeed: (url: string, probe = false) => (isTauri ? invoke<string>('radar_fetch', { url, probe }) : proxyFetch(url)),

  sourcesList: () => call<FeedSource[]>('radar_sources_list'),
  sourceAdd: (input: NewSource) => call<FeedSource>('radar_source_add', { input }),
  sourceUpdate: (id: string, patch: SourcePatch) => call<FeedSource>('radar_source_update', { id, patch }),
  sourceDelete: (id: string) => call<void>('radar_source_delete', { id }),
  sourceReport: (id: string, ok: boolean, error: string | null) => call<FeedSource>('radar_source_report', { id, ok, error }),

  itemsList: () => call<FeedItem[]>('radar_items_list'),
  itemsUpsert: (sourceId: string, items: NewFeedItem[]) => call<UpsertResult>('radar_items_upsert', { sourceId, items }),
  itemSet: (id: string, patch: ItemPatch) => call<FeedItem>('radar_item_set', { id, patch }),
  cleanup: (days?: number) => call<number>('radar_cleanup', { days }),
  translate: (ids: string[]) => (isTauri ? invoke<FeedItem[]>('radar_translate', { ids }) : Promise.resolve([] as FeedItem[])),

  keywordsList: () => call<Keyword[]>('radar_keywords_list'),
  keywordSave: (input: KeywordInput) => call<Keyword>('radar_keyword_save', { input }),
  keywordDelete: (id: string) => call<void>('radar_keyword_delete', { id }),
}
