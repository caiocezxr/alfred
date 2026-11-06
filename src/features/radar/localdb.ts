import { titleDedupEligible, validateFeedUrl } from './normalize.ts'
import { SEED_KEYWORDS, SEED_SOURCES } from './seed.ts'
import type {
  FeedItem, FeedSource, ItemCategory, ItemPatch, Keyword, KeywordInput, NewFeedItem, NewSource, SourceCategory,
  SourcePatch, UpsertResult,
} from './types.ts'

export type LocalDb = {
  v: 1
  sources: FeedSource[]
  items: FeedItem[]
  keywords: Keyword[]
  tombstones: Record<string, string>
}

export const KEEP_DAYS = 60
const DAY = 864e5
const SOURCE_CATS: SourceCategory[] = ['ai_dev', 'ai_content', 'stack', 'auto']
const ITEM_CATS: ItemCategory[] = ['ai_dev', 'ai_content', 'stack', 'other']
const uid = () => globalThis.crypto.randomUUID()

export function seedDb(nowIso: string): LocalDb {
  const sources: FeedSource[] = SEED_SOURCES.map(([id, name, url, category, weight]) => ({
    id, name, url, category, enabled: true, weight, builtin: true,
    lastStatus: null, lastError: null, lastFetchedAt: null, lastOkAt: null, createdAt: nowIso,
  }))
  const keywords: Keyword[] = []
  for (const [group, list] of Object.entries(SEED_KEYWORDS)) {
    for (const [term, weight] of list) {
      keywords.push({
        id: uid(),
        term,
        kind: group === 'mute' ? 'mute' : 'boost',
        category: group === 'ai_dev' || group === 'ai_content' || group === 'stack' ? group : null,
        weight,
        builtin: true,
      })
    }
  }
  return { v: 1, sources, items: [], keywords, tombstones: {} }
}

const sourceOrder = (c: SourceCategory) => ({ ai_dev: 0, auto: 1, ai_content: 2, stack: 3 })[c]
const time = (i: FeedItem) => i.publishedAt ?? i.fetchedAt

function checkName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim()
  if (!n) throw new Error('a fonte precisa de um nome')
  return [...n].slice(0, 80).join('')
}
function checkWeight(w: number): number {
  if (!Number.isFinite(w) || w < 0.2 || w > 2) throw new Error('o peso da fonte vai de 0,2 a 2')
  return Math.round(w * 100) / 100
}
const findSource = (db: LocalDb, id: string) => {
  const s = db.sources.find((x) => x.id === id)
  if (!s) throw new Error('fonte não encontrada')
  return s
}

export function upsertLocal(db: LocalDb, sourceId: string, items: NewFeedItem[], now: Date): UpsertResult {
  const src = findSource(db, sourceId)
  const cutoff = new Date(now.getTime() - KEEP_DAYS * DAY).toISOString()
  const out: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, duplicates: 0, skipped: 0 }
  for (const raw of items.slice(0, 400)) {
    const title = raw.title?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? ''
    if (!title || !/^https?:\/\//i.test(raw.url ?? '') || !raw.canonicalUrl?.startsWith('https://')) {
      out.skipped++
      continue
    }
    if ((raw.publishedAt && raw.publishedAt < cutoff) || db.tombstones[raw.canonicalUrl]) {
      out.skipped++
      continue
    }
    const category: ItemCategory = ITEM_CATS.includes(raw.category) ? raw.category : 'other'
    const key = raw.titleKey?.trim().toLowerCase() || title.toLowerCase()
    const excerpt = (raw.excerpt ?? '').slice(0, 600)
    const relevance = Number.isFinite(raw.relevance) ? Math.round(raw.relevance * 100) / 100 : 0
    const existing = db.items.find((i) => i.canonicalUrl === raw.canonicalUrl)
    if (existing) {
      if (existing.sourceId !== sourceId) {
        out.duplicates++
        continue
      }
      const changed = existing.title !== title || existing.excerpt !== excerpt || existing.category !== category ||
        existing.relevance !== relevance || existing.sourceName !== src.name
      if (changed) {
        Object.assign(existing, { title, titleKey: key, excerpt, category, relevance, sourceName: src.name, guid: existing.guid ?? raw.guid })
        out.updated++
      } else out.unchanged++
      continue
    }
    if (raw.guid && db.items.some((i) => i.sourceId === sourceId && i.guid === raw.guid)) {
      out.duplicates++
      continue
    }
    if (titleDedupEligible(key) && db.items.some((i) => i.titleKey === key)) {
      out.duplicates++
      continue
    }
    db.items.push({
      id: uid(), sourceId, sourceName: src.name, guid: raw.guid, url: raw.url.trim(), canonicalUrl: raw.canonicalUrl,
      title, titleKey: key, excerpt, category, relevance, publishedAt: raw.publishedAt, fetchedAt: now.toISOString(),
      readAt: null, savedAt: null, dismissedAt: null,
    })
    out.inserted++
  }
  return out
}

export function cleanupLocal(db: LocalDb, days: number, now: Date): number {
  const d = Math.min(365, Math.max(7, days))
  const cutoff = new Date(now.getTime() - d * DAY).toISOString()
  const old = db.items.filter((i) => !i.savedAt && time(i) < cutoff)
  for (const i of old) db.tombstones[i.canonicalUrl] ??= now.toISOString()
  db.items = db.items.filter((i) => !old.includes(i))
  const yearAgo = new Date(now.getTime() - 365 * DAY).toISOString()
  for (const [k, at] of Object.entries(db.tombstones)) if (at < yearAgo) delete db.tombstones[k]
  return old.length
}

export function localCommand(db: LocalDb, cmd: string, a: Record<string, unknown>, now: Date): unknown {
  const iso = now.toISOString()
  switch (cmd) {
    case 'radar_sources_list':
      return [...db.sources]
        .sort((x, y) => sourceOrder(x.category) - sourceOrder(y.category) || x.name.localeCompare(y.name, 'pt-BR', { sensitivity: 'base' }))
        .map((s) => ({ ...s }))
    case 'radar_source_add': {
      const i = a.input as NewSource
      const url = validateFeedUrl(i.url)
      const name = checkName(i.name)
      if (!SOURCE_CATS.includes(i.category)) throw new Error('categoria de fonte inválida')
      const weight = checkWeight(i.weight ?? 1)
      if (db.sources.some((s) => s.url === url)) throw new Error('essa fonte já está no Radar')
      const s: FeedSource = {
        id: uid(), name, url, category: i.category, enabled: true, weight, builtin: false,
        lastStatus: null, lastError: null, lastFetchedAt: null, lastOkAt: null, createdAt: iso,
      }
      db.sources.push(s)
      return { ...s }
    }
    case 'radar_source_update': {
      const s = findSource(db, a.id as string)
      const p = a.patch as SourcePatch
      const next = { ...s }
      if (p.name !== undefined) next.name = checkName(p.name)
      if (p.category !== undefined) {
        if (!SOURCE_CATS.includes(p.category)) throw new Error('categoria de fonte inválida')
        next.category = p.category
      }
      if (p.enabled !== undefined) next.enabled = p.enabled
      if (p.weight !== undefined) next.weight = checkWeight(p.weight)
      Object.assign(s, next)
      return { ...s }
    }
    case 'radar_source_delete': {
      const id = a.id as string
      db.items = db.items.filter((i) => i.sourceId !== id || i.savedAt)
      for (const i of db.items) if (i.sourceId === id) i.sourceId = null
      db.sources = db.sources.filter((s) => s.id !== id)
      return undefined
    }
    case 'radar_source_report': {
      const s = findSource(db, a.id as string)
      const ok = !!a.ok
      Object.assign(s, {
        lastStatus: ok ? 'ok' : 'error',
        lastError: ok ? null : String(a.error ?? '').slice(0, 400) || null,
        lastFetchedAt: iso,
        lastOkAt: ok ? iso : s.lastOkAt,
      })
      return { ...s }
    }
    case 'radar_items_list':
      return db.items
        .filter((i) => !i.dismissedAt)
        .sort((x, y) => (time(x) < time(y) ? 1 : time(x) > time(y) ? -1 : 0))
        .slice(0, 3000)
        .map((i) => ({ ...i }))
    case 'radar_items_upsert':
      return upsertLocal(db, a.sourceId as string, a.items as NewFeedItem[], now)
    case 'radar_item_set': {
      const it = db.items.find((i) => i.id === a.id)
      if (!it) throw new Error('item não encontrado')
      const p = a.patch as ItemPatch
      if (p.read !== undefined) it.readAt = p.read ? (it.readAt ?? iso) : null
      if (p.saved !== undefined) it.savedAt = p.saved ? (it.savedAt ?? iso) : null
      if (p.dismissed !== undefined) it.dismissedAt = p.dismissed ? (it.dismissedAt ?? iso) : null
      return { ...it }
    }
    case 'radar_cleanup':
      return cleanupLocal(db, (a.days as number | undefined) ?? KEEP_DAYS, now)
    case 'radar_keywords_list':
      return [...db.keywords]
        .sort((x, y) => (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : y.weight - x.weight || x.term.localeCompare(y.term)))
        .map((k) => ({ ...k }))
    case 'radar_keyword_save': {
      const i = a.input as KeywordInput
      const term = i.term.replace(/\s+/g, ' ').trim().toLowerCase()
      if (!term || !term.replace(/\*+$/, '')) throw new Error('escreva a palavra-chave')
      if ([...term].length > 60) throw new Error('palavra-chave longa demais (até 60 caracteres)')
      if (i.kind !== 'boost' && i.kind !== 'mute') throw new Error('tipo de palavra-chave inválido')
      if (!Number.isFinite(i.weight) || i.weight <= 0 || i.weight > 5) throw new Error('o peso vai de 0,1 a 5')
      const category = i.kind === 'mute' ? null : (i.category ?? null)
      const weight = Math.max(0.1, Math.round(i.weight * 100) / 100)
      if (db.keywords.some((k) => k.term === term && k.id !== i.id)) throw new Error('essa palavra já está na lista')
      if (i.id) {
        const k = db.keywords.find((x) => x.id === i.id)
        if (!k) throw new Error('palavra-chave não encontrada')
        Object.assign(k, { term, kind: i.kind, category, weight })
        return { ...k }
      }
      const k: Keyword = { id: uid(), term, kind: i.kind, category, weight, builtin: false }
      db.keywords.push(k)
      return { ...k }
    }
    case 'radar_keyword_delete':
      db.keywords = db.keywords.filter((k) => k.id !== a.id)
      return undefined
  }
  throw new Error(`comando desconhecido: ${cmd}`)
}
