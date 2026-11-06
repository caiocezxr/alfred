import { radarApi } from '../radar/api.ts'
import { parseFeedText } from '../radar/feed.ts'
import { normalizeEntry, parseError } from '../radar/normalize.ts'
import { briefingApi } from './api.ts'
import { unwrapRedirect, type Entry } from './sieve.ts'
import type { Area, Lang, Profile } from './types.ts'

export type FeedRef = { id: string; name: string; url: string; area: Area | null; lang: Lang; weight: number }
export type CollectResult = { entries: Entry[]; sources: number; ok: number; errors: { name: string; error: string }[] }

const CONCURRENCY = 8
const PER_SOURCE_MAX = 60

const RADAR_AREA: Record<string, Area | null> = { ai_dev: 'ia', ai_content: 'ia', stack: 'potencializa', auto: null }

export async function feedList(profile: Profile): Promise<FeedRef[]> {
  const own = (await briefingApi.sources()).filter((s) => s.enabled)
  const list: FeedRef[] = own.map((s) => ({ id: s.id, name: s.name, url: s.url, area: s.area, lang: s.lang, weight: s.weight }))
  if (profile.useRadarSources) {
    try {
      const radar = await radarApi.sourcesList()
      const seen = new Set(list.map((s) => s.url))
      for (const s of radar) {
        if (!s.enabled || seen.has(s.url)) continue
        list.push({ id: `radar:${s.id}`, name: s.name, url: s.url, area: RADAR_AREA[s.category] ?? null, lang: 'en', weight: s.weight })
      }
    } catch {
    }
  }
  return list
}

export function entriesFrom(xml: string, src: FeedRef, now: Date): Entry[] {
  const feed = parseFeedText(xml)
  const out: Entry[] = []
  for (const raw of feed.entries) {
    const link = raw.link ? unwrapRedirect(raw.link) : raw.link
    const n = normalizeEntry({ ...raw, link }, { url: src.url }, now)
    if (!n) continue
    out.push({
      sourceId: src.id,
      sourceName: src.name,
      sourceArea: src.area,
      sourceWeight: src.weight,
      lang: src.lang,
      url: n.url,
      key: n.canonicalUrl,
      title: n.title,
      titleKey: n.titleKey,
      excerpt: n.excerpt,
      publishedAt: n.publishedAt,
    })
  }
  return out
    .sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '') || 0)
    .slice(0, PER_SOURCE_MAX)
}

export async function collect(feeds: FeedRef[], onProgress: (done: number, total: number, name: string) => void): Promise<CollectResult> {
  const now = new Date()
  const result: CollectResult = { entries: [], sources: feeds.length, ok: 0, errors: [] }
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < feeds.length) {
      const src = feeds[next++]
      try {
        const xml = await briefingApi.fetchFeed(src.url)
        result.entries.push(...entriesFrom(xml, src, now))
        result.ok++
      } catch (e) {
        result.errors.push({ name: src.name, error: parseError(e).message })
      }
      done++
      onProgress(done, feeds.length, src.name)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, feeds.length) }, worker))
  return result
}
