import { termsOf } from './learn.ts'
import { marketNarrationFallback } from './market.ts'
import { hashText, numberWords } from './speech.ts'
import type { Candidate } from './sieve.ts'
import { AREAS, AREA_LONG, type Area, type BriefItem, type Edition, type JudgeOutput, type JudgedItem, type Quote, type TasteScore, type Translated, CADERNOS, cadernoOf, type Caderno, type CadernoInfo } from './types.ts'

export const MIN_ITEMS = 10
export const MAX_ITEMS = 15
export const MIN_PER_CADERNO = 3
export const MAX_PER_AREA = 4
const AREA_CAP: Partial<Record<Area, number>> = { seguranca: 2, mundo: 1 }
export const capOf = (area: Area, outlets = 1) => (area === 'mundo' && outlets >= 6 ? 2 : (AREA_CAP[area] ?? MAX_PER_AREA))

export const AREA_WHY: Record<Area, string> = {
  dinheiro: 'Pode pôr dinheiro no seu bolso ou mexer com o que você já tem.',
  codigo: 'Pode melhorar o seu código e as suas decisões de arquitetura.',
  ia: 'É uma ferramenta de IA que você pode usar já.',
  potencializa: 'Pode entrar na sua stack e te poupar trabalho.',
  seguranca: 'Pode te afetar diretamente: vale conferir as suas contas e projetos.',
  politica: 'É uma decisão política que pode mexer com o mercado e com o seu bolso.',
  mundo: 'É um fato grande do mundo, do tipo que você precisa saber.',
}

const FIRST: Record<Area, string> = {
  dinheiro: 'Pra começar, uma de dinheiro.',
  codigo: 'Pra começar, uma pra quem programa.',
  ia: 'Pra começar, inteligência artificial.',
  potencializa: 'Pra começar, uma ferramenta nova.',
  seguranca: 'Pra começar, segurança.',
  politica: 'Pra começar, política.',
  mundo: 'Pra começar, o que aconteceu no mundo.',
}

const ENTER: Record<Area, string[]> = {
  dinheiro: ['Agora, dinheiro.', 'Do lado do dinheiro:', 'E falando em dinheiro:'],
  codigo: ['Agora, uma pra quem programa.', 'Na engenharia:', 'E no código:'],
  ia: ['Agora, inteligência artificial.', 'E falando em IA:', 'No mundo da IA:'],
  potencializa: ['Agora, uma ferramenta que pode te poupar trabalho.', 'Nas ferramentas:', 'E pra sua stack:'],
  seguranca: ['Agora, segurança.', 'E falando em segurança:', 'Na segurança:'],
  politica: ['Agora, política.', 'Em Brasília e lá fora:', 'Na política:'],
  mundo: ['Mudando de assunto, no mundo:', 'Agora, o mundo.', 'Lá fora:'],
}

const SAME = ['Ainda nesse assunto:', 'E tem mais nessa linha:', 'Seguindo no mesmo tema:']

export function autoSegue(index: number, total: number, area: Area, prev: Area | null, used: Set<string> = new Set()): string {
  if (index === 0 || !prev) return FIRST[area]
  const pool = prev === area ? SAME : ENTER[area]
  const last = total > 3 && index === total - 1
  const pick = pool.find((x) => !used.has(x)) ?? pool[index % pool.length]
  used.add(pick)
  if (!last) return pick
  return prev === area ? 'E pra fechar os destaques, mais uma nessa linha.' : `E pra fechar os destaques, ${pick.charAt(0).toLowerCase()}${pick.slice(1)}`
}

const JUNK = [
  /\s*(?:\[…\]|\[\.\.\.\]|\(\.\.\.\))\s*$/,
  /\s*(?:Leia mais|Continue lendo|Saiba mais|Leia a matéria completa|Clique aqui)[^.]*\.?\s*$/i,
  /\s*O post .+ apareceu primeiro em .+$/i,
  /\s*The post .+ appeared first on .+$/i,
]

const CREDIT = /^.{0,220}?(?:\/\s?(?:Reprodução|Divulgação|Arquivo|Agência \p{L}+)|Getty Images|Foto: [^.]{0,60}?(?=\s\p{Lu}))\s*/u

export function cleanExcerpt(excerpt: string, title: string): string {
  let s = excerpt.replace(/\s+/g, ' ').trim().replace(CREDIT, '')
  for (const re of JUNK) s = s.replace(re, '')
  const sentences = s.split(/(?<=[.!?])\s+(?=["“(\p{Lu}])/u)
  if (sentences.length > 1 && /…$|\.\.\.$/.test(sentences[sentences.length - 1])) sentences.pop()
  s = sentences.join(' ').trim()
  if (/…$|\.\.\.$/.test(s)) s = s.replace(/\s*\S*(?:…|\.\.\.)$/, '').trim()
  if (s && !/[.!?]$/.test(s)) s += '.'
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\d]+/gu, ' ').trim()
  if (norm(s).startsWith(norm(title)) && norm(s).length - norm(title).length < 12) return ''
  return s.length >= 20 ? s : ''
}

export function fallbackNarration(title: string, summary: string): string {
  const t = title.replace(/[.!?…:]+$/, '').trim()
  const body = summary ? firstSentences(summary, 2) : ''
  return `${t}.${body ? ` ${body}` : ''}`
}

const NUM_WORD = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']
export const countWord = (n: number) => NUM_WORD[n] ?? numberWords(n, true)

export function firstSentences(s: string, n: number): string {
  const parts = s.split(/(?<=[.!?…])\s+(?=["“'(\p{Lu}])/u)
  return parts.slice(0, n).join(' ').trim() || s
}

export function applyTaste(candidates: Candidate[], scores: TasteScore[], weight = 1.5): Candidate[] {
  const z = new Map(scores.map((s) => [s.id, s.z]))
  return candidates
    .map((c) => ({ ...c, score: Math.round((c.score + weight * Math.max(-2.5, Math.min(2.5, z.get(c.id) ?? 0))) * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
}

export const NEAR_MIN = 0.72

export function explainByTaste(items: BriefItem[], scores: TasteScore[]) {
  const by = new Map(scores.map((s) => [s.id, s]))
  for (const it of items) {
    const s = by.get(it.id)
    if (!s?.near || (s.nearSim ?? 0) < NEAR_MIN || s.near.toLowerCase() === it.title.toLowerCase() || looksEnglish(s.near)) continue
    const near = s.near.length > 70 ? `${s.near.slice(0, 68).trimEnd()}…` : s.near
    it.why = `Parecido com “${near}”, que você curtiu.`
  }
}

export type AssembleInput = {
  hiddenEnglish?: number
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
  const summary = j?.summary ?? (j && c.lang === 'en' ? '' : cleanExcerpt(c.excerpt, title))
  const narration = j?.narration ?? fallbackNarration(title, summary)
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

export function balanceCadernos<T extends { c: Candidate; area: Area; rank: number; j: JudgedItem | null }>(picked: T[], rest: T[], min = MIN_PER_CADERNO): { picked: T[]; rest: T[] } {
  const out = [...picked]
  const pool = [...rest].sort((a, b) => Number(!!b.j?.keep) - Number(!!a.j?.keep) || b.rank - a.rank)
  const count = (k: Caderno) => out.filter((x) => cadernoOf(x.area) === k).length
  const areaCount = (a: Area) => out.filter((x) => x.area === a).length
  for (const k of CADERNOS) {
    while (count(k) < min) {
      const next = pool.find((x) => cadernoOf(x.area) === k && !out.includes(x) && areaCount(x.area) < capOf(x.area, x.c.outlets))
      if (!next) break
      if (out.length >= MAX_ITEMS) {
        const donor = [...CADERNOS].filter((d) => d !== k && count(d) > min).sort((a, b) => count(b) - count(a))[0]
        if (!donor) break
        const weakest = out.filter((x) => cadernoOf(x.area) === donor).sort((a, b) => a.rank - b.rank)[0]
        out.splice(out.indexOf(weakest), 1)
        pool.push(weakest)
      }
      out.push(next)
      pool.splice(pool.indexOf(next), 1)
    }
  }
  const used = new Set(out.map((x) => x.c.id))
  return { picked: out, rest: [...pool, ...rest.filter((x) => !pool.includes(x))].filter((x, i, arr) => !used.has(x.c.id) && arr.indexOf(x) === i).sort((a, b) => b.rank - a.rank) }
}

export function withCadernos(e: Edition, leads?: { politica: string | null; investimentos: string | null; iaDev: string | null } | null): Edition {
  const items = e.items.map((it) => (it.caderno === cadernoOf(it.area) ? it : { ...it, caderno: cadernoOf(it.area) }))
  const prev = e.cadernos
  const chosen: Record<Caderno, string | null> = {
    politica: leads?.politica ?? prev?.politica.lead ?? null,
    investimentos: leads?.investimentos ?? prev?.investimentos.lead ?? null,
    ia_dev: leads?.iaDev ?? prev?.ia_dev.lead ?? null,
  }
  const byId = new Map(items.map((i) => [i.id, i]))
  const byKey = new Map(items.map((i) => [i.key, i]))
  const cadernos = Object.fromEntries(
    CADERNOS.map((k) => {
      const list = items.filter((i) => i.caderno === k).sort((a, b) => b.rank - a.rank)
      const pick = chosen[k] ? (byId.get(chosen[k]!) ?? byKey.get(chosen[k]!)) : undefined
      const lead = pick && pick.caderno === k ? pick : list.find((i) => i.key === e.focusKey) ?? list[0]
      const keys = lead ? [lead.key, ...list.filter((i) => i !== lead).map((i) => i.key)] : []
      return [k, { lead: lead?.key ?? null, keys } satisfies CadernoInfo]
    }),
  ) as Record<Caderno, CadernoInfo>
  return { ...e, items, cadernos }
}

function pickWithCaps<T extends { area: Area; c: Candidate }>(ranked: T[], max: number, cap: number): { picked: T[]; rest: T[] } {
  const per = new Map<Area, number>()
  const picked: T[] = []
  const rest: T[] = []
  for (const x of ranked) {
    if (picked.length < max && (per.get(x.area) ?? 0) < Math.min(cap, capOf(x.area, x.c.outlets))) {
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
    if (out.includes(x) || (per.get(x.area) ?? 0) >= capOf(x.area, x.c.outlets) || repeats(t)) return false
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
  for (const x of ranked) {
    if (out.length >= Math.min(max, MIN_ITEMS)) break
    const t = new Set(termsOf(x.c.title))
    if (!out.includes(x) && x.area !== 'mundo' && !repeats(t)) {
      out.push(x)
      terms.push(t)
    }
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
    politica: 'de política',
    mundo: 'do mundo',
  }
  const parts = counts.sort((a, b) => b[1] - a[1]).map(([a, n]) => `${countWord(n)} ${names[a]}`)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0] ?? ''
}

export function fallbackOpening(items: BriefItem[]): string {
  if (!items.length) return 'Bom dia! Desde ontem, nada passou na peneira. Dia tranquilo.'
  const n = items.length
  return `Bom dia! Desde ontem, separei ${countWord(n)} ${n === 1 ? 'coisa que importa' : 'coisas que importam'} pra você: ${areaPhrase(items)}. Vamos lá?`
}

export function fallbackClosing(focus: BriefItem | null): string {
  if (!focus) return 'Por hoje é isso. Bom trabalho!'
  return `Pra fechar: a coisa mais útil de hoje pra você é ${focus.title.replace(/[.!?…]+$/, '')}.${focus.action ? ` ${focus.action}` : ''} Bom trabalho!`
}

export function applyTranslations(candidates: Candidate[], judge: JudgeOutput | null, translated: Translated[]) {
  const judgedIds = new Set((judge?.items ?? []).map((j) => j.id))
  const map = new Map(translated.map((t) => [t.id, t]))
  const originals = new Map<string, string>()
  let hidden = 0
  const out: Candidate[] = []
  for (const c of candidates) {
    if (c.lang !== 'en' || judgedIds.has(c.id)) {
      out.push(c)
      continue
    }
    const t = map.get(c.id)
    if (!t) {
      hidden++
      continue
    }
    originals.set(c.id, c.title)
    out.push({ ...c, title: t.title, excerpt: t.summary ?? '', lang: 'pt' })
  }
  return { candidates: out, hidden, originals }
}

export function assemble(input: AssembleInput): Edition {
  const { judge } = input
  const judged = new Map<string, JudgedItem>((judge?.items ?? []).map((j) => [j.id, j]))
  const safe = applyTranslations(input.candidates, judge, [])
  const candidates = safe.candidates
  const hiddenEnglish = (input.hiddenEnglish ?? 0) + safe.hidden
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
      const strong = [...dropped.filter((x) => x.j && Math.max(...AREAS.map((a) => x.j!.scores[a] ?? 0)) >= 2), ...dropped.filter((x) => !x.j || Math.max(...AREAS.map((a) => x.j!.scores[a] ?? 0)) < 2)]
      const top = pickWithCaps([...picked, ...strong], MIN_ITEMS, MAX_PER_AREA).picked
      picked = top
      if (picked.length < MIN_ITEMS) picked = [...picked, ...strong.filter((x) => !picked.includes(x) && x.area !== 'mundo').slice(0, MIN_ITEMS - picked.length)]
    }
    const used = new Set(picked.map((x) => x.c.id))
    rest = [...first.rest, ...dropped].filter((x) => !used.has(x.c.id)).sort((a, b) => b.rank - a.rank)
  } else {
    const ranked = candidates.map((c) => ({ c, j: null, rank: importance(null, c, false), area: c.area })).sort((a, b) => b.rank - a.rank)
    picked = diversePick(ranked, 12)
    const used = new Set(picked.map((x) => x.c.id))
    rest = ranked.filter((x) => !used.has(x.c.id))
  }

  const balanced = balanceCadernos(picked, rest)
  picked = balanced.picked
  rest = balanced.rest

  const rundown = judge?.rundown ?? []
  const pos = new Map(rundown.map((r, i) => [r.id, i]))
  const ordered = rundown.length
    ? [...picked].sort((a, b) => (pos.get(a.c.id) ?? 99 + picked.indexOf(a)) - (pos.get(b.c.id) ?? 99 + picked.indexOf(b)))
    : interleave(picked)
  const used = new Set<string>()
  const items = ordered.map((x, i) => {
    const it = toItem(x.c, x.j, x.rank)
    const r = pos.get(x.c.id)
    const prevR = i > 0 ? pos.get(ordered[i - 1].c.id) : -1
    const ponte = r !== undefined && prevR === r - 1 ? rundown[r].segue : ''
    it.segue = ponte || autoSegue(i, ordered.length, it.area, i > 0 ? ordered[i - 1].area : null, used)
    return it
  })
  const leftOut = rest.map((x) => {
    const it = toItem(x.c, x.j, x.rank)
    if (!it.reason) it.reason = x.j?.keep ? 'ficou de fora pela cota da área' : judge ? 'o juiz não achou relevante' : 'abaixo dos destaques de hoje'
    return it
  })
  const byRank = [...items].sort((a, b) => b.rank - a.rank)
  const focus = items.find((i) => i.id === focusId) ?? (judge ? byRank[0] : (byRank.find((i) => i.lang === 'pt') ?? byRank[0])) ?? null
  return withCadernos({
    v: 1,
    date: input.date,
    createdAt: new Date(input.now).toISOString(),
    windowFrom: new Date(input.windowFrom).toISOString(),
    judge: judge ? 'codex' : 'fallback',
    judgeNote: judge ? null : [input.judgeNote, safe.hidden ? englishNote(safe.hidden) : null].filter(Boolean).join('; ') || null,
    model: judge?.model ?? null,
    opening: judge?.opening ?? fallbackOpening(items),
    closing: judge?.closing ?? fallbackClosing(focus),
    focusKey: focus?.key ?? null,
    items,
    leftOut,
    market: input.market,
    marketAt: input.marketAt,
    marketNarration: input.market.length ? (judge?.market ?? marketSegue(marketNarrationFallback(input.market))) : null,
    script: 2,
    hiddenEnglish,
    stats: input.stats,
  }, judge?.leads)
}

export const englishNote = (n: number) => `${n === 1 ? 'uma notícia em inglês ficou de fora' : `${n} notícias em inglês ficaram de fora`} por falta de tradução`

function marketSegue(s: string | null): string | null {
  if (!s) return s
  return s.replace(/^No mercado, /, 'Antes de fechar, uma olhada rápida no mercado: ')
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

export function narrationOf(s: Screen, e: Edition): string {
  if (s.kind !== 'item' || e.script !== 2 || !s.item.segue) return s.narration
  const n = s.narration
  const glue = /,$/.test(s.item.segue) && /^\p{Lu}\p{Ll}/u.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n
  return `${s.item.segue} ${glue}`
}

export function estimateSeconds(e: Edition, wpm = 185): number {
  return Math.round(screensOf(e).reduce((t, s) => t + (words(narrationOf(s, e)) / wpm) * 60 + 0.8, 0))
}

export const editionKey = (e: Edition) => hashText(`${e.date}|${e.createdAt}`)

export function areaCounts(items: { area: Area }[]): { area: Area; count: number; label: string }[] {
  return AREAS.map((a) => ({ area: a, count: items.filter((i) => i.area === a).length, label: AREA_LONG[a] })).filter((x) => x.count > 0)
}

const EN_WORDS = new Set(['the', 'and', 'of', 'to', 'in', 'is', 'for', 'on', 'with', 'as', 'by', 'from', 'at', 'that', 'this', 'it', 'are', 'be', 'was', 'were', 'new', 'how', 'why', 'what', 'your', 'you', 'can', 'will', 'has', 'have', 'its', "it's", 'an', 'into', 'after', 'over', 'about', 'than', 'now', 'just', 'their', 'they', 'which', 'who', 'not', 'but', 'or', 'all', 'more', 'most', 'out', 'up', 'get', 'gets', 'says', 'said', 'could', 'would', 'should', 'may', 'been', 'being', 'there', 'here', 'when', 'where', 'while', 'these', 'those', 'our', 'we', 'his', 'her', 'them', 'both', 'like', 'make', 'makes', 'using', 'use', 'via', 'amid', 'against', 'between', 'without', 'within', 'launches', 'announces', 'introduces', 'release', 'released', 'releases'])
const PT_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'que', 'e', 'o', 'os', 'as', 'em', 'no', 'na', 'nos', 'nas', 'para', 'pra', 'com', 'por', 'um', 'uma', 'é', 'não', 'se', 'mais', 'como', 'ao', 'aos', 'sobre', 'seu', 'sua', 'seus', 'suas', 'ele', 'ela', 'isso', 'esse', 'essa', 'este', 'esta', 'foi', 'são', 'ser', 'tem', 'têm', 'há', 'já', 'mas', 'ou', 'quando', 'onde', 'pelo', 'pela', 'entre', 'até', 'você', 'novo', 'nova', 'após', 'contra', 'sem', 'também', 'faz', 'diz'])

export function looksEnglish(text: string | null | undefined): boolean {
  if (!text) return false
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length < 3) return false
  let en = 0
  let pt = 0
  for (const w of words) {
    if (EN_WORDS.has(w)) en++
    if (PT_WORDS.has(w)) pt++
  }
  if (/[ãõçáéíóúâêôà]/i.test(text)) pt += 2
  return en >= 2 && en > pt
}

export type Hidden = { item: BriefItem; kept: boolean }

function upgradeScript(e: Edition): Edition {
  if (e.script === 2) return e
  if (e.judge !== 'fallback') return { ...e, script: 2, items: e.items.map((it) => ({ ...it, segue: '' })) }
  const used = new Set<string>()
  const items = e.items.map((it, i) => {
    const summary = cleanExcerpt(it.summary, it.title) || ''
    return { ...it, summary, narration: fallbackNarration(it.title, summary), segue: autoSegue(i, e.items.length, it.area, i > 0 ? e.items[i - 1].area : null, used) }
  })
  const leftOut = e.leftOut.map((it) => ({ ...it, summary: cleanExcerpt(it.summary, it.title) }))
  const focus = items.find((i) => i.key === e.focusKey) ?? null
  return { ...e, script: 2, items, leftOut, opening: fallbackOpening(items), closing: fallbackClosing(focus), marketNarration: marketSegue(e.marketNarration) }
}

export function sanitizeEdition(input: Edition): { edition: Edition; english: Hidden[] } {
  const e = upgradeScript(input)
  const english: Hidden[] = []
  const fix = (it: BriefItem, kept: boolean): BriefItem | null => {
    if (looksEnglish(it.title) || (it.lang === 'en' && e.judge === 'fallback' && !it.scores)) {
      english.push({ item: it, kept })
      return null
    }
    const summary = looksEnglish(it.summary) ? '' : it.summary
    const why = looksEnglish(it.why) ? AREA_WHY[it.area] : it.why
    const action = looksEnglish(it.action) ? null : it.action
    const narration = looksEnglish(it.narration) || /, no .+: /.test(it.narration) && it.lang === 'en' ? fallbackNarration(it.title, summary) : it.narration
    const segue = it.segue && looksEnglish(it.segue) ? '' : it.segue
    const reason = looksEnglish(it.reason) ? null : it.reason
    if (summary === it.summary && why === it.why && action === it.action && narration === it.narration && segue === it.segue && reason === it.reason) return it
    return { ...it, summary, why, action, narration, segue, reason }
  }
  const items = e.items.map((x) => fix(x, true)).filter((x): x is BriefItem => !!x)
  const leftOut = e.leftOut.map((x) => fix(x, false)).filter((x): x is BriefItem => !!x)
  if (!english.length && items.every((x, i) => x === e.items[i]) && leftOut.every((x, i) => x === e.leftOut[i])) return { edition: e.cadernos && e.items.every((i) => i.caderno) ? e : withCadernos(e), english }
  const removedItems = items.length !== e.items.length
  if (removedItems && e.judge === 'fallback') {
    const used = new Set<string>()
    items.forEach((it, i) => (items[i] = { ...it, segue: autoSegue(i, items.length, it.area, i > 0 ? items[i - 1].area : null, used) }))
  }
  const focus = items.find((i) => i.key === e.focusKey) ?? (removedItems ? ([...items].sort((a, b) => b.rank - a.rank)[0] ?? null) : null)
  const fallback = e.judge === 'fallback'
  return {
    edition: withCadernos({
      ...e,
      items,
      leftOut,
      focusKey: focus?.key ?? null,
      opening: (fallback && removedItems) || looksEnglish(e.opening) ? fallbackOpening(items) : e.opening,
      closing: (removedItems && e.focusKey !== focus?.key) || looksEnglish(e.closing) ? fallbackClosing(focus) : e.closing,
      marketNarration: looksEnglish(e.marketNarration) ? null : e.marketNarration,
      hiddenEnglish: (e.hiddenEnglish ?? 0) + english.length,
    }),
    english,
  }
}

export function withTranslations(e: Edition, english: Hidden[], translated: Translated[]): Edition {
  const map = new Map(translated.map((t) => [t.id, t]))
  const items = [...e.items]
  const leftOut = [...e.leftOut]
  const added: BriefItem[] = []
  for (const { item: it, kept } of english) {
    const t = map.get(it.id)
    if (!t || looksEnglish(t.title)) continue
    const summary = t.summary && !looksEnglish(t.summary) ? t.summary : ''
    const fixed: BriefItem = { ...it, title: t.title, summary, why: looksEnglish(it.why) ? AREA_WHY[it.area] : it.why, narration: fallbackNarration(t.title, summary), lang: 'pt' }
    added.push(fixed)
    if (kept && items.length < MAX_ITEMS) items.push(fixed)
    else leftOut.push(fixed)
  }
  if (!added.length) return e
  const used = new Set<string>()
  const fresh = new Set(added)
  items.forEach((it, i) => {
    if (fresh.has(it) || !it.segue) items[i] = { ...it, segue: autoSegue(i, items.length, it.area, i > 0 ? items[i - 1].area : null, used) }
  })
  return withCadernos({
    ...e,
    items,
    leftOut,
    opening: e.judge === 'fallback' ? fallbackOpening(items) : e.opening,
    hiddenEnglish: Math.max(0, (e.hiddenEnglish ?? 0) - added.length),
  })
}
