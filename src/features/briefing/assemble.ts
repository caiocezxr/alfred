import { termsOf } from './learn.ts'
import { marketNarrationFallback } from './market.ts'
import type { Candidate } from './sieve.ts'
import { AREAS, AREA_LONG, type Area, type BriefItem, type Edition, type JudgeOutput, type JudgedItem, type Quote } from './types.ts'

export const MIN_ITEMS = 6
export const MAX_ITEMS = 9
export const MAX_PER_AREA = 3

export const AREA_WHY: Record<Area, string> = {
  dinheiro: 'Pode pôr dinheiro no seu bolso ou mexer com o que você já tem.',
  codigo: 'Pode melhorar o seu código e as suas decisões de arquitetura.',
  ia: 'É uma ferramenta de IA que você pode usar já.',
  potencializa: 'Pode entrar na sua stack e te poupar trabalho.',
  seguranca: 'Pode te afetar diretamente: vale conferir as suas contas e projetos.',
  mundo: 'É um fato grande do mundo, do tipo que você precisa saber.',
}

const LEAD: Record<Area, string> = {
  dinheiro: 'Do lado do dinheiro',
  codigo: 'Na engenharia',
  ia: 'Em IA',
  potencializa: 'Nas ferramentas',
  seguranca: 'Na segurança',
  mundo: 'No mundo',
}

const NUM_WORD = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']
export const countWord = (n: number) => NUM_WORD[n] ?? String(n)

export function firstSentences(s: string, n: number): string {
  const parts = s.split(/(?<=[.!?…])\s+(?=["“'(\p{Lu}])/u)
  return parts.slice(0, n).join(' ').trim() || s
}

export type AssembleInput = {
  date: string
  now: number
  windowFrom: number
  candidates: Candidate[]
  judge: JudgeOutput | null
  judgeNote: string | null
  market: Quote[]
  marketAt: string | null
  stats: Edition['stats']
}

function importance(j: JudgedItem | null, c: Candidate, focus: boolean): number {
  if (!j) return c.score + (c.lang === 'pt' ? 1 : 0)
  const s = AREAS.map((a) => j.scores[a] ?? 0)
  return Math.max(...s) * 2 + s.reduce((x, y) => x + y, 0) * 0.25 + c.score * 0.08 + (focus ? 1 : 0)
}

function toItem(c: Candidate, j: JudgedItem | null, rank: number): BriefItem {
  const area = j?.area ?? c.area
  const title = j?.title || c.title
  const pt = c.lang === 'pt'
  const summary = j?.summary ?? (pt || !j ? c.excerpt : '')
  const narration =
    j?.narration ??
    (pt
      ? `${LEAD[area]}: ${title.replace(/[.!?…]+$/, '')}. ${summary ? firstSentences(summary, 2) : ''}`.trim()
      : `${LEAD[area]}, no ${c.sourceName}: ${title.replace(/[.!?…]+$/, '')}.`)
  return {
    key: c.key,
    id: c.id,
    area,
    title,
    originalTitle: c.title,
    summary,
    why: j?.why ?? AREA_WHY[area],
    action: j?.action ?? null,
    narration,
    source: c.sourceName,
    sourceId: c.sourceId,
    url: c.url,
    publishedAt: c.publishedAt,
    lang: c.lang,
    outlets: c.outlets,
    otherSources: c.otherSources,
    scores: j?.scores ?? null,
    rank: Math.round(rank * 100) / 100,
    reason: j && !j.keep ? j.reason : null,
  }
}

function pickWithCaps<T extends { area: Area }>(ranked: T[], max: number, cap: number): { picked: T[]; rest: T[] } {
  const per = new Map<Area, number>()
  const picked: T[] = []
  const rest: T[] = []
  for (const x of ranked) {
    if (picked.length < max && (per.get(x.area) ?? 0) < cap) {
      picked.push(x)
      per.set(x.area, (per.get(x.area) ?? 0) + 1)
    } else rest.push(x)
  }
  return { picked, rest }
}

function diversePick<T extends { c: Candidate; area: Area }>(ranked: T[], max: number): T[] {
  const out: T[] = []
  const terms: Set<string>[] = []
  const per = new Map<Area, number>()
  const repeats = (t: Set<string>) =>
    terms.some((u) => {
      let shared = 0
      for (const x of t) if (u.has(x)) shared++
      return shared >= 2 && shared / Math.max(1, Math.min(t.size, u.size)) >= 0.25
    })
  const take = (x: T) => {
    const t = new Set(termsOf(x.c.title))
    if (out.includes(x) || (per.get(x.area) ?? 0) >= MAX_PER_AREA || repeats(t)) return false
    out.push(x)
    terms.push(t)
    per.set(x.area, (per.get(x.area) ?? 0) + 1)
    return true
  }
  for (const a of AREAS) {
    if (out.length >= max) break
    const best = ranked.find((x) => x.area === a && !out.includes(x))
    if (best) take(best)
  }
  for (const x of ranked) {
    if (out.length >= max) break
    take(x)
  }
  return out.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b))
}

export function interleave<T extends { area: Area }>(items: T[]): T[] {
  const pool = [...items]
  const out: T[] = []
  while (pool.length) {
    const last = out[out.length - 1]?.area
    const i = pool.findIndex((x) => x.area !== last)
    out.push(pool.splice(i === -1 ? 0 : i, 1)[0])
  }
  return out
}

function areaPhrase(items: { area: Area }[]): string {
  const counts = AREAS.map((a) => [a, items.filter((i) => i.area === a).length] as const).filter(([, n]) => n > 0)
  const names: Record<Area, string> = {
    dinheiro: 'de dinheiro',
    codigo: 'de código',
    ia: 'de IA',
    potencializa: 'de ferramentas',
    seguranca: 'de segurança',
    mundo: 'do mundo',
  }
  const parts = counts.sort((a, b) => b[1] - a[1]).map(([a, n]) => `${countWord(n)} ${names[a]}`)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0] ?? ''
}

export function fallbackOpening(items: BriefItem[]): string {
  if (!items.length) return 'Bom dia. Desde ontem, nada passou na peneira. Dia tranquilo.'
  const n = items.length
  return `Bom dia. Desde ontem, separei ${countWord(n)} ${n === 1 ? 'coisa que importa' : 'coisas que importam'} pra você: ${areaPhrase(items)}. Vamos lá.`
}

export function fallbackClosing(focus: BriefItem | null): string {
  if (!focus) return 'Por hoje é isso. Bom trabalho.'
  return `A coisa mais útil de hoje pra você é: ${focus.title}.${focus.action ? ` ${focus.action}` : ''} Bom trabalho.`
}

export function assemble(input: AssembleInput): Edition {
  const { candidates, judge } = input
  const judged = new Map<string, JudgedItem>((judge?.items ?? []).map((j) => [j.id, j]))
  const focusId = judge?.focusId ?? null

  let picked: { c: Candidate; j: JudgedItem | null; rank: number; area: Area }[]
  let rest: typeof picked
  if (judge) {
    const all = candidates.map((c) => {
      const j = judged.get(c.id) ?? null
      return { c, j, rank: importance(j, c, c.id === focusId), area: j?.area ?? c.area }
    })
    const kept = all.filter((x) => x.j?.keep).sort((a, b) => b.rank - a.rank)
    const first = pickWithCaps(kept, MAX_ITEMS, MAX_PER_AREA)
    picked = first.picked
    const dropped = all.filter((x) => !x.j?.keep).sort((a, b) => b.rank - a.rank)
    if (picked.length < MIN_ITEMS) {
      const strong = dropped.filter((x) => x.j && Math.max(...AREAS.map((a) => x.j!.scores[a])) >= 2)
      const top = pickWithCaps([...picked, ...strong], MIN_ITEMS, MAX_PER_AREA).picked
      picked = top
    }
    const used = new Set(picked.map((x) => x.c.id))
    rest = [...first.rest, ...dropped].filter((x) => !used.has(x.c.id)).sort((a, b) => b.rank - a.rank)
  } else {
    const ranked = candidates.map((c) => ({ c, j: null, rank: importance(null, c, false), area: c.area })).sort((a, b) => b.rank - a.rank)
    picked = diversePick(ranked, 8)
    const used = new Set(picked.map((x) => x.c.id))
    rest = ranked.filter((x) => !used.has(x.c.id))
  }

  const items = interleave(picked).map((x) => toItem(x.c, x.j, x.rank))
  const leftOut = rest.map((x) => {
    const it = toItem(x.c, x.j, x.rank)
    if (!it.reason) it.reason = x.j?.keep ? 'ficou de fora pela cota da área' : judge ? 'o juiz não achou relevante' : 'abaixo dos destaques de hoje'
    return it
  })
  const byRank = [...items].sort((a, b) => b.rank - a.rank)
  const focus = items.find((i) => i.id === focusId) ?? (judge ? byRank[0] : (byRank.find((i) => i.lang === 'pt') ?? byRank[0])) ?? null
  return {
    v: 1,
    date: input.date,
    createdAt: new Date(input.now).toISOString(),
    windowFrom: new Date(input.windowFrom).toISOString(),
    judge: judge ? 'codex' : 'fallback',
    judgeNote: judge ? null : input.judgeNote,
    model: judge?.model ?? null,
    opening: judge?.opening ?? fallbackOpening(items),
    closing: judge?.closing ?? fallbackClosing(focus),
    focusKey: focus?.key ?? null,
    items,
    leftOut,
    market: input.market,
    marketAt: input.marketAt,
    marketNarration: input.market.length ? (judge?.market ?? marketNarrationFallback(input.market)) : null,
    stats: input.stats,
  }
}

export type Screen =
  | { kind: 'opening'; narration: string }
  | { kind: 'item'; item: BriefItem; index: number; narration: string }
  | { kind: 'market'; narration: string }
  | { kind: 'closing'; narration: string; focus: BriefItem | null }

export function weatherSentence(w: { city: string; temp: number; label: string } | null): string {
  if (!w) return ''
  return `Em ${w.city}, ${Math.round(w.temp)} graus, ${w.label.toLowerCase()}.`
}

export function withWeather(opening: string, weather: string): string {
  if (!weather) return opening
  const m = opening.match(/^([^.!?]+[.!?])\s*(.*)$/s)
  return m ? `${m[1]} ${weather} ${m[2]}`.trim() : `${weather} ${opening}`
}

export function screensOf(e: Edition, weather = ''): Screen[] {
  const s: Screen[] = [{ kind: 'opening', narration: withWeather(e.opening, weather) }]
  e.items.forEach((item, index) => s.push({ kind: 'item', item, index, narration: item.narration }))
  if (e.market.length) s.push({ kind: 'market', narration: e.marketNarration ?? '' })
  s.push({ kind: 'closing', narration: e.closing, focus: e.items.find((i) => i.key === e.focusKey) ?? null })
  return s
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length

export function estimateSeconds(e: Edition, wpm = 185): number {
  return Math.round(screensOf(e).reduce((t, s) => t + (words(s.narration) / wpm) * 60 + 1.5, 0))
}

export function areaCounts(items: { area: Area }[]): { area: Area; count: number; label: string }[] {
  return AREAS.map((a) => ({ area: a, count: items.filter((i) => i.area === a).length, label: AREA_LONG[a] })).filter((x) => x.count > 0)
}
