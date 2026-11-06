import { githubRepo, normalizeText } from './normalize.ts'
import type { ItemCategory, KeywordCategory, KeywordKind, SourceCategory } from './types.ts'

export const CATEGORY_POINTS: Record<ItemCategory, number> = { ai_dev: 3, ai_content: 2, stack: 1, other: 0 }
export const SOURCE_VOTE = 1.5
export const KEYWORD_CAP = 6
export const MUTE_CAP = 8
export const LOW_RELEVANCE = 2
export const HIGHLIGHT_MIN = 5.5
export const HIGHLIGHT_MAX = 5
export const DISMISS_SOURCE_STEP = 0.1
export const DISMISS_KEYWORD_STEP = 0.25
export const SOURCE_WEIGHT_MIN = 0.2
export const KEYWORD_WEIGHT_MIN = 0.25

const PRIORITY: KeywordCategory[] = ['ai_dev', 'ai_content', 'stack']
const DAY = 864e5

export type KeywordLite = { id: string; term: string; kind: KeywordKind; category: KeywordCategory | null; weight: number }
export type SourceLite = { id: string; name: string; url: string; category: SourceCategory; weight: number }
export type ScoreInput = {
  id: string
  title: string
  excerpt: string
  sourceId: string | null
  publishedAt: string | null
  fetchedAt: string
}

export type PartKind = 'category' | 'keyword' | 'mute' | 'cap' | 'source' | 'recency' | 'release' | 'series'
export type Part = { kind: PartKind; label: string; value: number; ref?: string }
export type Scored = { score: number; category: ItemCategory; parts: Part[]; matched: Match[] }
export type Match = { keyword: KeywordLite; where: 'title' | 'excerpt'; points: number }

const round1 = (n: number) => Math.round(n * 10) / 10
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type Compiled = { keyword: KeywordLite; norm: string; re: RegExp }

export function compileKeywords(keywords: KeywordLite[]): Compiled[] {
  const out: Compiled[] = []
  for (const k of keywords) {
    const prefix = k.term.trim().endsWith('*')
    const norm = normalizeText(k.term.replace(/\*+$/, ''))
    if (!norm) continue
    const re = new RegExp(prefix ? `(?:^| )${esc(norm)}` : `(?:^| )${esc(norm)}(?:s|es)?(?= |$)`)
    out.push({ keyword: k, norm, re })
  }
  return out
}

export function matchKeywords(title: string, excerpt: string, compiled: Compiled[]): Match[] {
  const t = normalizeText(title)
  const e = normalizeText(excerpt)
  const found: Match[] = []
  for (const c of compiled) {
    const inTitle = c.re.test(t)
    if (!inTitle && !c.re.test(e)) continue
    found.push({ keyword: c.keyword, where: inTitle ? 'title' : 'excerpt', points: inTitle ? c.keyword.weight : c.keyword.weight / 2 })
  }
  const norms = found.map((f) => normalizeText(f.keyword.term.replace(/\*+$/, '')))
  return found.filter((_, i) => !norms.some((n, j) => j !== i && n.length > norms[i].length && ` ${n} `.includes(` ${norms[i]} `)))
}

export function classify(matches: Match[], sourceCategory: SourceCategory | null): ItemCategory {
  const votes: Record<KeywordCategory, number> = { ai_dev: 0, ai_content: 0, stack: 0 }
  for (const m of matches) if (m.keyword.kind === 'boost' && m.keyword.category) votes[m.keyword.category] += m.points
  if (sourceCategory && sourceCategory !== 'auto') votes[sourceCategory] += SOURCE_VOTE
  let best: KeywordCategory | null = null
  for (const c of PRIORITY) if (votes[c] > 0 && (best === null || votes[c] > votes[best])) best = c
  return best ?? 'other'
}

export type ReleaseKind = 'major' | 'minor' | 'patch' | 'pre'
export type ReleaseInfo = { kind: ReleaseKind | null; secondary: string | null }

const PRE = /-(?:alpha|beta|rc|canary|nightly|next|preview|pre|dev|insiders|snapshot)\b|\b(?:alpha|beta|rc|canary|nightly|preview|insiders)\b|\brc\.?\d/i

export function releaseInfo(title: string, sourceUrl: string): ReleaseInfo {
  const gh = githubRepo(sourceUrl)
  if (!gh) return { kind: null, secondary: null }
  const ver = title.match(/(?:^|[\s@/v-])v?(\d+)\.(\d+)(?:\.(\d+))?/i)
  const rev = !ver && title.match(/(?:^|\s)r(\d+)\b/i)
  let kind: ReleaseKind | null = null
  if (ver) {
    const [M, m, p] = [Number(ver[1]), Number(ver[2]), ver[3] === undefined ? 0 : Number(ver[3])]
    kind = M >= 1 && m === 0 && p === 0 ? 'major' : p === 0 ? 'minor' : 'patch'
  } else if (rev) kind = 'minor'
  if (kind && PRE.test(title.slice((ver?.index ?? 0)))) kind = 'pre'
  let secondary: string | null = null
  if (kind) {
    const pkg = title.match(/^(@?[\w.-]+(?:\/[a-z][\w.-]*)?)[@\s/]+v?\d/i)
    const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (pkg && flat(pkg[1]) !== flat(gh.repo) && !/^v?\d/.test(pkg[1])) secondary = pkg[1]
  }
  return { kind, secondary }
}

const RELEASE_POINTS: Record<ReleaseKind, [number, string]> = {
  major: [1.5, 'versão principal'],
  minor: [0.5, 'versão menor'],
  patch: [-0.5, 'correção (patch)'],
  pre: [-2, 'pré-lançamento'],
}

export function recencyPoints(ageMs: number): number {
  const days = Math.max(0, ageMs) / DAY
  return round1(2 * 0.5 ** (days / 1.5) - 0.5)
}

export function ageLabel(ageMs: number): string {
  const h = Math.max(0, ageMs) / 36e5
  if (h < 1) return 'menos de 1 h'
  if (h < 24) return `há ${Math.round(h)} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'há 1 dia' : `há ${d} dias`
}

export const itemTime = (i: { publishedAt: string | null; fetchedAt: string }) => Date.parse(i.publishedAt ?? i.fetchedAt)

export const fmtNum = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const CATEGORY_PART_LABEL: Record<ItemCategory, string> = {
  ai_dev: 'IA para desenvolvimento',
  ai_content: 'IA para conteúdo',
  stack: 'Stacks e ferramentas',
  other: 'sem tema reconhecido',
}

export function scoreItem(item: ScoreInput, source: SourceLite | null, compiled: Compiled[], now: number, seriesIndex = 0): Scored {
  const releases = !!githubRepo(source?.url ?? '')
  const matched = matchKeywords(item.title, releases ? '' : item.excerpt, compiled)
  const category = classify(matched, source?.category ?? null)
  const parts: Part[] = [{ kind: 'category', label: CATEGORY_PART_LABEL[category], value: CATEGORY_POINTS[category] }]

  let boost = 0
  let mute = 0
  for (const m of matched) {
    const where = m.where === 'title' ? '' : ' no trecho'
    if (m.keyword.kind === 'boost') {
      boost += m.points
      parts.push({ kind: 'keyword', label: `“${m.keyword.term}”${where}`, value: m.points, ref: m.keyword.id })
    } else {
      mute += m.points
      parts.push({ kind: 'mute', label: `“${m.keyword.term}”${where}`, value: -m.points, ref: m.keyword.id })
    }
  }
  if (boost > KEYWORD_CAP) parts.push({ kind: 'cap', label: `teto de palavras-chave (+${KEYWORD_CAP})`, value: KEYWORD_CAP - boost })
  if (mute > MUTE_CAP) parts.push({ kind: 'cap', label: `teto de penalizações (−${MUTE_CAP})`, value: mute - MUTE_CAP })

  if (source && Math.abs(source.weight - 1) > 0.001) {
    parts.push({ kind: 'source', label: `peso da fonte ${source.name} (${fmtNum(source.weight)})`, value: (source.weight - 1) * 2.5, ref: source.id })
  }

  const age = now - itemTime(item)
  parts.push({ kind: 'recency', label: `recência (${ageLabel(age)})`, value: recencyPoints(age) })

  const rel = releaseInfo(item.title, source?.url ?? '')
  if (rel.kind) {
    const [v, label] = RELEASE_POINTS[rel.kind]
    parts.push({ kind: 'release', label, value: v })
  }
  if (rel.secondary) parts.push({ kind: 'release', label: `pacote secundário (${rel.secondary})`, value: -1.5 })

  if (seriesIndex > 0) {
    const v = releases ? Math.min(0.6 * seriesIndex, 3) : Math.min(0.12 * seriesIndex, 1.2)
    parts.push({ kind: 'series', label: `repetição da fonte (${seriesIndex + 1}º item recente)`, value: -round1(v) })
  }

  const rounded = parts.map((p) => ({ ...p, value: round1(p.value) }))
  const score = round1(rounded.reduce((s, p) => s + p.value, 0))
  return { score, category, parts: rounded, matched }
}

export function scoreAll(items: ScoreInput[], sources: Map<string, SourceLite>, keywords: KeywordLite[], now: number): Map<string, Scored> {
  const compiled = compileKeywords(keywords)
  const series = new Map<string, number>()
  const bySource = new Map<string, ScoreInput[]>()
  for (const i of items) {
    if (!i.sourceId || now - itemTime(i) > 14 * DAY) continue
    const url = sources.get(i.sourceId)?.url ?? ''
    if (githubRepo(url) && releaseInfo(i.title, url).secondary) continue
    const list = bySource.get(i.sourceId) ?? []
    list.push(i)
    bySource.set(i.sourceId, list)
  }
  for (const list of bySource.values()) {
    list.sort((a, b) => itemTime(b) - itemTime(a)).forEach((i, n) => series.set(i.id, n))
  }
  const out = new Map<string, Scored>()
  for (const i of items) out.set(i.id, scoreItem(i, i.sourceId ? sources.get(i.sourceId) ?? null : null, compiled, now, series.get(i.id) ?? 0))
  return out
}

export const isLow = (s: Scored) => s.score < LOW_RELEVANCE || s.category === 'other'

export function pickHighlights<T extends { id: string; sourceId: string | null; sourceName: string }>(
  items: T[],
  scored: Map<string, Scored>,
  eligible: (i: T) => boolean,
): T[] {
  const ranked = items
    .filter((i) => eligible(i) && (scored.get(i.id)?.score ?? 0) >= HIGHLIGHT_MIN && !isLow(scored.get(i.id)!))
    .sort((a, b) => scored.get(b.id)!.score - scored.get(a.id)!.score)
  const used = new Set<string>()
  const out: T[] = []
  for (const i of ranked) {
    const key = i.sourceId ?? i.sourceName
    if (used.has(key)) continue
    used.add(key)
    out.push(i)
    if (out.length === HIGHLIGHT_MAX) break
  }
  return out
}

export function dismissAdjustments(scored: Scored, source: SourceLite | null): {
  source: { id: string; from: number; to: number } | null
  keywords: { id: string; term: string; from: number; to: number }[]
} {
  const src =
    source && source.weight > SOURCE_WEIGHT_MIN
      ? { id: source.id, from: source.weight, to: Math.max(SOURCE_WEIGHT_MIN, Math.round((source.weight - DISMISS_SOURCE_STEP) * 100) / 100) }
      : null
  const kws = scored.matched
    .filter((m) => m.keyword.kind === 'boost' && m.where === 'title' && m.keyword.weight > KEYWORD_WEIGHT_MIN)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
    .map((m) => ({
      id: m.keyword.id,
      term: m.keyword.term,
      from: m.keyword.weight,
      to: Math.max(KEYWORD_WEIGHT_MIN, Math.round((m.keyword.weight - DISMISS_KEYWORD_STEP) * 100) / 100),
    }))
  return { source: src, keywords: kws }
}
