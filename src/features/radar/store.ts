import { isTauri } from '../../shared/db/api'
import { useEffect, useSyncExternalStore } from 'react'
import { openExternal } from '../../shared/openExternal'
import { radarApi } from './api.ts'
import { parseFeedText } from './feed.ts'
import { normalizeEntry, parseError, type RadarError, isNetworkError, validateFeedUrl } from './normalize.ts'
import { KEEP_DAYS } from './localdb.ts'
import { compileKeywords, dismissAdjustments, fmtNum, scoreItem, type Scored } from './relevance.ts'
import type { FeedItem, FeedSource, ItemPatch, Keyword, KeywordInput, NewFeedItem, NewSource, SourcePatch } from './types.ts'

export const TTL_MS = 6 * 36e5
const RETRY_AFTER_ERROR_MS = 30 * 6e4
const RETRY_AFTER_429_MS = 3 * 36e5
const CONCURRENCY = 4
const LEAVE_MS = 260

export type SourceRun = { state: 'loading' | 'ok' | 'error'; error?: RadarError; inserted?: number }
export type Toast = { id: number; text: string; detail?: string; undo?: () => void }

export type RadarState = {
  loaded: boolean
  loadError: string | null
  sources: FeedSource[]
  items: FeedItem[]
  keywords: Keyword[]
  runs: Record<string, SourceRun>
  refreshing: boolean
  progress: { done: number; total: number }
  offline: boolean
  leaving: Record<string, true>
  toast: Toast | null
  stamp: number
  translating: number
  translateError: string | null
}

let state: RadarState = {
  loaded: false,
  loadError: null,
  sources: [],
  items: [],
  keywords: [],
  runs: {},
  refreshing: false,
  progress: { done: 0, total: 0 },
  offline: false,
  leaving: {},
  toast: null,
  stamp: Date.now(),
  translating: 0,
  translateError: null,
}
const listeners = new Set<() => void>()
const set = (patch: Partial<RadarState> | ((s: RadarState) => Partial<RadarState>)) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  for (const l of listeners) l()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const getRadar = () => state

let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function showToast(text: string, opts: { detail?: string; undo?: () => void; ms?: number } = {}) {
  clearTimeout(toastTimer)
  const id = ++toastSeq
  set({ toast: { id, text, detail: opts.detail, undo: opts.undo } })
  toastTimer = setTimeout(() => {
    if (state.toast?.id === id) set({ toast: null })
  }, opts.ms ?? 6500)
}
export const hideToast = () => set({ toast: null })

const message = (e: unknown) => parseError(e).message

let loading: Promise<void> | null = null

export function loadRadar(): Promise<void> {
  loading ??= (async () => {
    try {
      const [sources, items, keywords] = await Promise.all([radarApi.sourcesList(), radarApi.itemsList(), radarApi.keywordsList()])
      set({ sources, items, keywords, loaded: true, loadError: null, stamp: Date.now() })
    } catch (e) {
      set({ loaded: true, loadError: message(e) })
    } finally {
      loading = null
    }
  })()
  return loading
}

export function isStale(s: FeedSource, now = Date.now()): boolean {
  if (!s.enabled) return false
  if (!s.lastFetchedAt) return true
  const age = now - Date.parse(s.lastFetchedAt)
  if (s.lastStatus === 'error') return age > (s.lastError?.startsWith('[http 429]') ? RETRY_AFTER_429_MS : RETRY_AFTER_ERROR_MS)
  return age > TTL_MS
}

export function lastUpdated(sources: FeedSource[]): number | null {
  let best: number | null = null
  for (const s of sources) {
    if (!s.enabled || !s.lastOkAt) continue
    const t = Date.parse(s.lastOkAt)
    if (best === null || t > best) best = t
  }
  return best
}

const SKILL_SOURCES: { name: string; url: string }[] = [
  { name: 'Anthropic Skills', url: 'https://github.com/anthropics/skills/commits/main.atom' },
  { name: 'Cursor', url: 'https://cursor.com/changelog/rss.xml' },
  { name: 'Latent Space', url: 'https://www.latent.space/feed' },
  { name: 'GitHub Blog · IA', url: 'https://github.blog/ai-and-ml/feed/' },
  { name: 'Addy Osmani', url: 'https://addyo.substack.com/feed' },
  { name: 'UX Collective', url: 'https://uxdesign.cc/feed' },
  { name: 'Figma Blog', url: 'https://www.figma.com/blog/feed/atom.xml' },
]
const SKILLS_FLAG = 'ps.radar.skills.v1'

async function ensureSkillSources() {
  try {
    if (localStorage.getItem(SKILLS_FLAG)) return
  } catch {
    return
  }
  const have = new Set(state.sources.map((s) => s.url.replace(/\/+$/, '')))
  for (const s of SKILL_SOURCES) {
    if (have.has(s.url.replace(/\/+$/, ''))) continue
    try {
      await radarApi.sourceAdd({ name: s.name, url: s.url, category: 'ai_dev' })
    } catch {}
  }
  try {
    localStorage.setItem(SKILLS_FLAG, '1')
  } catch {}
  set({ sources: await radarApi.sourcesList() })
}

export async function openRadar() {
  if (!state.loaded) await loadRadar()
  if (state.loadError) return
  await ensureSkillSources()
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set({ offline: true })
    return
  }
  const stale = state.sources.filter((s) => isStale(s))
  if (stale.length) await refresh(stale)
}

async function ingest(src: FeedSource): Promise<number> {
  const text = await radarApi.fetchFeed(src.url)
  const feed = parseFeedText(text)
  const now = new Date()
  const cutoff = now.getTime() - KEEP_DAYS * 864e5
  const compiled = compileKeywords(state.keywords)
  const items: NewFeedItem[] = []
  for (const e of feed.entries) {
    const n = normalizeEntry(e, src, now)
    if (!n || (n.publishedAt && Date.parse(n.publishedAt) < cutoff)) continue
    const s = scoreItem({ id: '', title: n.title, excerpt: n.excerpt, sourceId: src.id, publishedAt: n.publishedAt, fetchedAt: now.toISOString() }, src, compiled, now.getTime())
    items.push({ ...n, category: s.category, relevance: s.score })
  }
  let inserted = 0
  for (let i = 0; i < items.length; i += 400) inserted += (await radarApi.itemsUpsert(src.id, items.slice(i, i + 400))).inserted
  return inserted
}

async function runSource(src: FeedSource): Promise<boolean> {
  set((s) => ({ runs: { ...s.runs, [src.id]: { state: 'loading' } } }))
  let ok = false
  let report: FeedSource | null = null
  try {
    const inserted = await ingest(src)
    ok = true
    set((s) => ({ runs: { ...s.runs, [src.id]: { state: 'ok', inserted } } }))
    report = await radarApi.sourceReport(src.id, true, null).catch(() => null)
  } catch (e) {
    const err = parseError(e)
    set((s) => ({ runs: { ...s.runs, [src.id]: { state: 'error', error: err } } }))
    const raw = e instanceof Error ? e.message : String(e)
    report = await radarApi.sourceReport(src.id, false, raw).catch(() => null)
    if (!isNetworkError(err)) ok = true
  }
  if (report) set((s) => ({ sources: s.sources.map((x) => (x.id === report!.id ? report! : x)) }))
  return ok
}

let refreshing: Promise<void> | null = null

export function refresh(targets?: FeedSource[]): Promise<void> {
  if (refreshing) return targets ? refreshing.then(() => refresh(targets)) : refreshing
  const list = (targets ?? state.sources).filter((s) => s.enabled)
  if (!list.length) return Promise.resolve()
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set({ offline: true })
    if (!targets) showToast('Sem conexão.', { detail: 'O Radar mostra o que já estava salvo.' })
    return Promise.resolve()
  }
  refreshing = (async () => {
    set({ refreshing: true, progress: { done: 0, total: list.length } })
    const queue = [...list]
    let reached = 0
    const worker = async () => {
      for (let src = queue.shift(); src; src = queue.shift()) {
        if (await runSource(src)) reached++
        set((s) => ({ progress: { ...s.progress, done: s.progress.done + 1 } }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))
    await radarApi.cleanup(KEEP_DAYS).catch(() => 0)
    try {
      const [items, sources] = await Promise.all([radarApi.itemsList(), radarApi.sourcesList()])
      set({ items, sources })
    } catch (e) {
      showToast('Não foi possível recarregar o Radar.', { detail: message(e) })
    }
    set((s) => ({ refreshing: false, offline: reached === 0 && (list.length > 1 || s.offline), stamp: Date.now() }))
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

export const refreshAll = () => refresh()

export async function retrySource(id: string) {
  const src = state.sources.find((s) => s.id === id)
  if (src) await refresh([src])
}

function patchLocal(id: string, patch: ItemPatch) {
  const now = new Date().toISOString()
  set((s) => ({
    items: s.items.map((i) =>
      i.id !== id
        ? i
        : {
            ...i,
            ...(patch.read !== undefined && { readAt: patch.read ? (i.readAt ?? now) : null }),
            ...(patch.saved !== undefined && { savedAt: patch.saved ? (i.savedAt ?? now) : null }),
          },
    ),
  }))
}

async function setItem(id: string, patch: ItemPatch) {
  const prev = state.items
  patchLocal(id, patch)
  try {
    const it = await radarApi.itemSet(id, patch)
    if (!it.dismissedAt) set((s) => ({ items: s.items.map((i) => (i.id === id ? it : i)) }))
  } catch (e) {
    set({ items: prev })
    showToast('Não deu para salvar a mudança.', { detail: message(e) })
  }
}

export function openItem(item: FeedItem) {
  openExternal(item.url).catch((e) => showToast('Não deu para abrir o link.', { detail: message(e) }))
  if (!item.readAt) void setItem(item.id, { read: true })
}

export const toggleRead = (item: FeedItem) => setItem(item.id, { read: !item.readAt })
export const toggleSaved = (item: FeedItem) => setItem(item.id, { saved: !item.savedAt })

export async function dismissItem(item: FeedItem, scored: Scored | undefined) {
  if (state.leaving[item.id]) return
  const source = item.sourceId ? state.sources.find((s) => s.id === item.sourceId) ?? null : null
  const adj = scored ? dismissAdjustments(scored, source) : { source: null, keywords: [] }
  set((s) => ({ leaving: { ...s.leaving, [item.id]: true } }))
  await new Promise((r) => setTimeout(r, LEAVE_MS))
  const index = state.items.findIndex((i) => i.id === item.id)
  set((s) => {
    const { [item.id]: _gone, ...leaving } = s.leaving
    void _gone
    return { leaving, items: s.items.filter((i) => i.id !== item.id) }
  })
  try {
    await radarApi.itemSet(item.id, { dismissed: true })
    if (adj.source) {
      const up = await radarApi.sourceUpdate(adj.source.id, { weight: adj.source.to })
      set((s) => ({ sources: s.sources.map((x) => (x.id === up.id ? up : x)) }))
    }
    for (const k of adj.keywords) {
      const kw = state.keywords.find((x) => x.id === k.id)
      if (!kw) continue
      const up = await radarApi.keywordSave({ id: kw.id, term: kw.term, kind: kw.kind, category: kw.category, weight: k.to })
      set((s) => ({ keywords: s.keywords.map((x) => (x.id === up.id ? up : x)) }))
    }
  } catch (e) {
    set((s) => {
      if (s.items.some((i) => i.id === item.id)) return {}
      const items = [...s.items]
      items.splice(Math.min(Math.max(index, 0), items.length), 0, item)
      return { items }
    })
    showToast('Não deu para dispensar.', { detail: message(e) })
    return
  }
  const changes = [
    adj.source && `${source?.name} ${fmtNum(adj.source.from)} → ${fmtNum(adj.source.to)}`,
    ...adj.keywords.map((k) => `“${k.term}” ${fmtNum(k.from)} → ${fmtNum(k.to)}`),
  ].filter(Boolean)
  showToast('Dispensado.', {
    detail: changes.length ? `Menos peso para ${changes.join(' · ')}` : undefined,
    undo: async () => {
      hideToast()
      try {
        const back = await radarApi.itemSet(item.id, { dismissed: false })
        if (adj.source) {
          const up = await radarApi.sourceUpdate(adj.source.id, { weight: adj.source.from })
          set((s) => ({ sources: s.sources.map((x) => (x.id === up.id ? up : x)) }))
        }
        for (const k of adj.keywords) {
          const kw = state.keywords.find((x) => x.id === k.id)
          if (!kw) continue
          const up = await radarApi.keywordSave({ id: kw.id, term: kw.term, kind: kw.kind, category: kw.category, weight: k.from })
          set((s) => ({ keywords: s.keywords.map((x) => (x.id === up.id ? up : x)) }))
        }
        set((s) => {
          const items = s.items.filter((i) => i.id !== back.id)
          items.splice(Math.min(Math.max(index, 0), items.length), 0, back)
          return { items }
        })
      } catch (e) {
        showToast('Não deu para desfazer.', { detail: message(e) })
      }
    },
  })
}

export type ProbeResult = { url: string; title: string; count: number; latest: string | null }

export async function probeSource(rawUrl: string): Promise<ProbeResult> {
  const url = validateFeedUrl(rawUrl)
  const text = await radarApi.fetchFeed(url, true)
  const feed = parseFeedText(text)
  const now = new Date()
  const entries = feed.entries.map((e) => normalizeEntry(e, { url }, now)).filter((e) => !!e)
  if (!entries.length) throw new Error('[formato] o feed respondeu, mas sem itens com link')
  return { url, title: feed.title.trim(), count: entries.length, latest: entries[0]?.title ?? null }
}

export async function addSource(input: NewSource): Promise<FeedSource> {
  const s = await radarApi.sourceAdd(input)
  set((st) => ({ sources: [...st.sources, s] }))
  void refresh([s])
  return s
}

export async function updateSource(id: string, patch: SourcePatch) {
  const prev = state.sources
  set((s) => ({ sources: s.sources.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  try {
    const up = await radarApi.sourceUpdate(id, patch)
    set((s) => ({ sources: s.sources.map((x) => (x.id === id ? up : x)) }))
    if (patch.enabled && isStale(up)) void refresh([up])
  } catch (e) {
    set({ sources: prev })
    showToast('Não deu para mudar a fonte.', { detail: message(e) })
  }
}

export async function removeSource(id: string) {
  const prev = { sources: state.sources, items: state.items }
  set((s) => ({ sources: s.sources.filter((x) => x.id !== id), items: s.items.filter((i) => i.sourceId !== id || i.savedAt) }))
  try {
    await radarApi.sourceDelete(id)
    set({ items: await radarApi.itemsList() })
  } catch (e) {
    set(prev)
    showToast('Não deu para remover a fonte.', { detail: message(e) })
  }
}

export async function saveKeyword(input: KeywordInput): Promise<Keyword> {
  const k = await radarApi.keywordSave(input)
  set((s) => ({ keywords: s.keywords.some((x) => x.id === k.id) ? s.keywords.map((x) => (x.id === k.id ? k : x)) : [...s.keywords, k] }))
  return k
}

export async function deleteKeyword(id: string) {
  const prev = state.keywords
  set((s) => ({ keywords: s.keywords.filter((k) => k.id !== id) }))
  try {
    await radarApi.keywordDelete(id)
  } catch (e) {
    set({ keywords: prev })
    showToast('Não deu para remover a palavra.', { detail: message(e) })
  }
}

export function useRadar(): RadarState {
  const s = useSyncExternalStore(subscribe, getRadar, getRadar)
  useEffect(() => {
    void openRadar()
    const online = () => {
      set({ offline: false })
      const stale = state.sources.filter((x) => isStale(x))
      if (stale.length) void refresh(stale)
    }
    const offline = () => set({ offline: true })
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])
  return s
}

const PT_MARK = /[ãõçáéíóúâêô]|\b(de|do|da|dos|das|para|com|não|uma|um|que|em|no|na|os|as|por|mais|sobre|como|o|e|ao|é|se|seu|sua|até|já|novo|nova)\b/gi

export function isPortuguese(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length
  if (!words) return true
  const hits = text.match(PT_MARK)?.length ?? 0
  return hits >= Math.max(1, Math.round(words * 0.12))
}

export const ptTitle = (i: FeedItem) => i.titlePt || i.title
export const ptExcerpt = (i: FeedItem) => (i.titlePt ? i.excerptPt ?? '' : i.excerpt)
export const needsPt = (i: FeedItem) => !i.titlePt && !isPortuguese(i.title)

const asked = new Set<string>()
let pump: Promise<void> | null = null
let queue: string[] = []
const BATCH = 8

export function translateItems(ids: string[]) {
  if (!isTauri) return
  for (const id of ids) {
    if (asked.has(id)) continue
    asked.add(id)
    queue.push(id)
  }
  if (!queue.length || pump) return
  set({ translating: queue.length, translateError: null })
  pump = (async () => {
    while (queue.length) {
      const batch = queue.slice(0, BATCH)
      queue = queue.slice(BATCH)
      try {
        const done = await radarApi.translate(batch)
        if (done.length) {
          const byId = new Map(done.map((d) => [d.id, d]))
          set((s) => ({ items: s.items.map((i) => byId.get(i.id) ?? i) }))
        }
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e)
        for (const id of [...batch, ...queue]) asked.delete(id)
        queue = []
        set({ translateError: msg.includes('local-ausente') || msg.includes('local-modelo') ? 'A tradução local está desligada ou sem o modelo; ligue o Ollama.' : 'Não deu para traduzir agora.' })
        break
      }
      set({ translating: queue.length })
    }
    set({ translating: 0 })
    pump = null
  })()
}
