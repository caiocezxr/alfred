import { canonicalUrl, titleDedupEligible } from '../radar/normalize.ts'
import { compileKeywords, matchKeywords, recencyPoints, type Compiled, type KeywordLite } from '../radar/relevance.ts'
import { SEED_KEYWORDS } from '../radar/seed.ts'
import { termsOf, type Learned } from './learn.ts'
import { areaPref } from './profile.ts'
import { AREAS, type Area, type Lang, type Profile } from './types.ts'

export const DEFAULT_WINDOW_H = 30
export const MAX_WINDOW_H = 96
export const MIN_WINDOW_H = 18
export const TARGET = 44
export const PER_SOURCE = 4

export type Entry = {
  sourceId: string
  sourceName: string
  sourceArea: Area | null
  sourceWeight: number
  lang: Lang
  url: string
  key: string
  title: string
  titleKey: string
  excerpt: string
  publishedAt: string | null
}

export type Part = { label: string; value: number }
export type Candidate = Entry & {
  id: string
  area: Area
  score: number
  parts: Part[]
  outlets: number
  otherSources: string[]
}

const kw = (list: [string, number][], prefix: string): KeywordLite[] =>
  list.map(([term, weight], i) => ({ id: `${prefix}${i}`, term, weight, kind: 'boost', category: null }))

const AREA_TERMS: Record<Area, [string, number][]> = {
  dinheiro: [
    ['bitcoin', 3], ['btc', 2.5], ['ethereum', 3], ['ether', 2], ['cripto*', 2.5], ['crypto*', 2.5], ['stablecoin*', 2.5],
    ['etf*', 2], ['ibovespa', 3], ['bolsa', 1.5], ['acoes', 1.5], ['dolar', 2], ['selic', 3], ['copom', 3], ['juros', 2],
    ['vaga*', 1.5], ['freela*', 2.5], ['edital', 2.5], ['editais', 2.5], ['hackathon', 2], ['tesouro', 1.5], ['cdb', 2], ['cdi', 2],
    ['inflacao', 2], ['ipca', 2.5], ['investiment*', 2], ['investidor*', 1.5], ['tesouro direto', 2.5], ['renda fixa', 2.5],
    ['dividend*', 2], ['fundos imobiliarios', 2.5], ['imposto de renda', 2.5], ['receita federal', 1.5], ['pix', 2], ['drex', 2.5],
    ['open finance', 2], ['banco central', 2], ['fed', 1.5], ['nasdaq', 2], ['wall street', 1.5], ['earnings', 1.5],
    ['ipo', 2], ['monetiz*', 2.5], ['freelanc*', 2.5], ['renda extra', 3], ['salario*', 1.5], ['oportunidade*', 1.5],
    ['bug bount*', 2.5], ['grant*', 1.5], ['startup*', 1.5], ['venture capital', 1.5], ['mercado financeiro', 2],
    ['b3', 2], ['corretora*', 1.5], ['blockchain', 1.5], ['solana', 2], ['xrp', 2], ['token*', 1],
  ],
  codigo: [
    ['arquitetura de software', 3], ['software architecture', 3], ['architecture', 2], ['arquitetura', 1.5], ['refactor*', 2.5],
    ['design pattern*', 2.5], ['microservic*', 2.5], ['monolith*', 2], ['distributed system*', 2.5], ['system design', 3],
    ['database*', 2], ['banco de dados', 2], ['postgres*', 2], ['sqlite', 2], ['performance', 1.5], ['latency', 1.5],
    ['scalab*', 2], ['observability', 2], ['testing', 1.5], ['tdd', 2], ['code review', 2], ['clean code', 2.5],
    ['domain-driven', 2.5], ['event sourcing', 2.5], ['kafka', 1.5], ['engineering', 1.5], ['engenharia de software', 3],
    ['technical debt', 2.5], ['divida tecnica', 2.5], ['api design', 2.5], ['type system', 2], ['compiler*', 1.5],
    ['concurrency', 2], ['caching', 1.5], ['reliability', 1.5], ['incident*', 1], ['postmortem', 2], ['platform engineering', 2],
    ['devops', 1.5], ['ci/cd', 1.5], ['infrastructure', 1], ['software engineer*', 1.5], ['developer experience', 2],
  ],
  ia: [
    ...SEED_KEYWORDS.ai_dev, ...SEED_KEYWORDS.ai_content,
    ['inteligencia artificial', 3], ['ia', 2.5], ['ai', 2], ['openai', 3], ['anthropic', 3], ['chatgpt', 3],
    ['modelo de linguagem', 3], ['machine learning', 2], ['deep learning', 2], ['neural', 1.5], ['generative', 2],
    ['generativa', 2], ['agentes', 2], ['assistente*', 1],
  ],
  potencializa: [
    ...SEED_KEYWORDS.stack,
    ['framework*', 2], ['library', 2], ['libraries', 2], ['biblioteca*', 1.5], ['open source', 2], ['open-source', 2],
    ['ferramenta*', 1.5], ['tool*', 1.5], ['devtool*', 2.5], ['self-host*', 2.5], ['extension', 1], ['plugin*', 1],
    ['github', 1.5], ['vs code', 2], ['terminal', 1.5], ['database', 1], ['serverless', 1.5], ['cloudflare', 1.5],
    ['vercel', 1.5], ['supabase', 2], ['docker', 1.5], ['kubernetes', 1.5], ['app', 0.5], ['sdk', 1.5], ['cli', 1.5],
    ['beta', 1], ['lancamento*', 1], ['lanca', 1], ['now available', 1.5], ['show hn', 2],
  ],
  seguranca: [
    ['vulnerabilit*', 3], ['vulnerabilidade*', 3], ['cve*', 3], ['exploit*', 3], ['zero-day', 3], ['zero day', 3], ['0-day', 3],
    ['ransomware', 3], ['malware', 3], ['phishing', 3], ['breach*', 2.5], ['vazament*', 3], ['vazou', 2.5], ['hacker*', 2.5],
    ['ataque hacker', 3], ['ciberataque*', 3], ['cyberattack*', 3], ['backdoor*', 3], ['botnet*', 3], ['ddos', 2.5],
    ['patch*', 1.5], ['security', 1.5], ['seguranca digital', 2.5], ['ciberseguranca', 3], ['cybersecurity', 3],
    ['golpe*', 2], ['fraude*', 2], ['spyware', 3], ['infostealer*', 3], ['credential*', 2.5], ['senha*', 1.5],
    ['supply chain', 2.5], ['malicious', 2.5], ['malicios*', 2.5], ['trojan*', 3], ['rce', 2.5], ['cisa', 2],
    ['data leak*', 3], ['stolen', 1.5], ['compromised', 2], ['account takeover', 2.5], ['2fa', 2], ['passkey*', 2],
  ],
  mundo: [
    ['terremoto*', 4], ['sismo*', 3.5], ['tsunami*', 4], ['furacao', 3.5], ['tufao', 3.5], ['ciclone*', 3], ['tornado*', 3],
    ['enchente*', 3], ['inundac*', 3], ['deslizamento*', 3], ['queda de aviao', 4], ['aviao caiu', 4], ['acidente aereo', 4],
    ['aviao*', 1.5], ['explosao', 3], ['guerra', 3], ['missil', 3], ['misseis', 3], ['bombardeio*', 3], ['invasao', 2.5],
    ['cessar-fogo', 3], ['cessar fogo', 3], ['mortos', 2.5], ['vitimas', 2], ['desastre*', 3], ['erupcao', 3.5],
    ['vulcao', 3.5], ['pandemia', 3], ['surto*', 2], ['epidemia', 2.5], ['golpe de estado', 3.5], ['evacua*', 2.5],
    ['apagao', 3], ['incendio florestal', 3], ['incendios', 2], ['ataque terrorista', 4], ['atentado*', 3.5], ['refens', 3],
    ['earthquake', 4], ['war', 2.5], ['missile*', 3], ['plane crash', 4], ['wildfire*', 3], ['hurricane', 3.5],
    ['otan', 2], ['nato', 2], ['onu', 1.5], ['ucrania', 2], ['russia', 1.5], ['israel', 1.5], ['gaza', 2], ['ira', 1],
    ['estado de emergencia', 3], ['calamidade', 3], ['nuclear', 2.5],
  ],
  politica: [
    ['congresso', 2.5], ['camara dos deputados', 3], ['senado', 2.5], ['stf', 3], ['supremo', 2], ['planalto', 2.5],
    ['lula', 2], ['governo federal', 2.5], ['ministro*', 1.5], ['ministerio', 1.5], ['eleic*', 2.5], ['eleitor*', 1.5],
    ['pesquisa eleitoral', 3], ['reforma tributaria', 3], ['arcabouco fiscal', 3], ['orcamento', 2], ['pec', 2.5],
    ['medida provisoria', 3], ['projeto de lei', 2], ['haddad', 2.5], ['tarifa*', 2], ['tarifaco', 3], ['sancao', 2], ['sancoes', 2],
    ['casa branca', 2.5], ['white house', 2.5], ['trump', 2], ['biden', 1.5], ['congress', 2], ['senate', 2], ['tariff*', 2.5],
    ['election*', 2], ['xi jinping', 3], ['pequim', 2], ['beijing', 2], ['china', 1.5], ['eua', 1.5], ['estados unidos', 1.5],
    ['uniao europeia', 2.5], ['european union', 2.5], ['bruxelas', 2], ['brussels', 2], ['parlamento europeu', 2.5],
    ['comissao europeia', 2.5], ['european commission', 2.5], ['geopolitic*', 2.5], ['diplomac*', 1.5], ['politica', 1],
  ],
}

const SIGNAL = kw(SEED_KEYWORDS.signal, 's')

const GOSSIP: [string, number][] = [
  ['bbb', 3], ['big brother', 3], ['reality show', 3], ['novela*', 3], ['celebridade*', 3], ['famosos', 3], ['famosa', 2],
  ['fofoca*', 3], ['horoscopo', 3], ['signo*', 2], ['futebol', 3], ['brasileirao', 3], ['libertadores', 3], ['campeonato', 2],
  ['flamengo', 3], ['corinthians', 3], ['palmeiras', 3], ['sao paulo fc', 3], ['neymar', 3], ['copa do brasil', 3],
  ['gol de', 2], ['escalacao', 3], ['receita de', 3], ['veja fotos', 3], ['assista', 2], ['quiz', 3], ['loteria*', 3],
  ['mega-sena', 3], ['mega sena', 3], ['lotofacil', 3], ['quina', 2], ['ex-bbb', 3], ['influenciador*', 2], ['look', 2],
  ['casamento', 2], ['namoro', 3], ['separacao', 2], ['cantor*', 2], ['cantora', 2], ['ator', 1.5], ['atriz', 1.5],
  ['coupon*', 3], ['cupom', 3], ['black friday', 3], ['promocao', 2], ['desconto*', 2], ['oferta*', 2], ['sponsored', 3],
  ['publieditorial', 3], ['podcast', 1], ['celebrity', 3], ['nfl', 3], ['nba', 3], ['premier league', 3],
]

const COMPILED: Record<Area, Compiled[]> = Object.fromEntries(AREAS.map((a) => [a, compileKeywords(kw(AREA_TERMS[a], a))])) as Record<Area, Compiled[]>
const COMPILED_SIGNAL = compileKeywords(SIGNAL)
const COMPILED_GOSSIP = compileKeywords(kw(GOSSIP, 'g'))

const AREA_BASE: Record<Area, number> = { dinheiro: 2.2, codigo: 2.2, ia: 2.2, potencializa: 2, seguranca: 1.2, politica: 1.6, mundo: 0.6 }
const AREA_SHARE: Record<Area, number> = { dinheiro: 0.2, codigo: 0.16, ia: 0.18, potencializa: 0.16, seguranca: 0.08, politica: 0.14, mundo: 0.08 }

const round1 = (n: number) => Math.round(n * 10) / 10
const DAY_MS = 864e5

export function unwrapRedirect(url: string): string {
  const m = url.match(/^https?:\/\/redir\.[^/]+\/.*?\*(https?:\/\/.+)$/i)
  return m ? m[1] : url
}

export function windowStart(now: number, previousStartedAt: string | null): number {
  const prev = previousStartedAt ? Date.parse(previousStartedAt) : NaN
  if (!Number.isFinite(prev)) return now - DEFAULT_WINDOW_H * 36e5
  return Math.min(now - MIN_WINDOW_H * 36e5, Math.max(now - MAX_WINDOW_H * 36e5, prev))
}

const tokensOf = (title: string) => new Set(termsOf(title))

export function sameStory(a: Set<string>, b: Set<string>): boolean {
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  const min = Math.min(a.size, b.size)
  if (min === 0) return false
  const r = shared / min
  return (shared >= 4 && r >= 0.5) || (shared >= 3 && r >= 0.6) || (shared >= 2 && r >= 0.8 && min <= 3)
}

function matchPoints(title: string, excerpt: string, compiled: Compiled[]): { points: number; terms: string[] } {
  const m = matchKeywords(title, excerpt, compiled)
  return { points: m.reduce((s, x) => s + x.points, 0), terms: m.map((x) => x.keyword.term) }
}

export function classifyArea(e: Pick<Entry, 'title' | 'excerpt' | 'sourceArea'>): { area: Area; votes: Record<Area, number> } {
  const votes = Object.fromEntries(AREAS.map((a) => [a, matchPoints(e.title, e.excerpt, COMPILED[a]).points])) as Record<Area, number>
  if (e.sourceArea) votes[e.sourceArea] += 2.5
  let best: Area = e.sourceArea ?? 'potencializa'
  for (const a of AREAS) if (votes[a] > votes[best]) best = a
  return { area: best, votes }
}

export const isGossip = (title: string) => matchKeywords(title, '', COMPILED_GOSSIP).length > 0

export type SieveOptions = {
  now: number
  windowFrom: number
  profile: Profile
  learned: Learned | null
  target?: number
  seen?: Set<string>
}

export type SieveStats = { entries: number; inWindow: number; muted: number; unique: number; stories: number; candidates: number }

type Group = { members: { e: Entry; others: Set<string> }[]; tokens: Set<string>[] }

export function sieve(entries: Entry[], opts: SieveOptions): { candidates: Candidate[]; stats: SieveStats } {
  const { now, windowFrom, profile, learned } = opts
  const target = opts.target ?? TARGET
  const stats: SieveStats = { entries: entries.length, inWindow: 0, muted: 0, unique: 0, stories: 0, candidates: 0 }

  const inWindow = entries.filter((e) => {
    if (!e.publishedAt) return false
    const t = Date.parse(e.publishedAt)
    return Number.isFinite(t) && t >= windowFrom && t <= now + 36e5 && !opts.seen?.has(e.key)
  })
  stats.inWindow = inWindow.length

  const ignores = compileKeywords(profile.ignores.map((term, i) => ({ id: `i${i}`, term, weight: 1, kind: 'mute', category: null })))
  const kept = inWindow.filter((e) => {
    const mutedTitle = matchKeywords(e.title, '', ignores).length > 0 || isGossip(e.title)
    if (mutedTitle) stats.muted++
    return !mutedTitle
  })

  type Unique = { e: Entry; others: Set<string> }
  const byKey = new Map<string, Unique>()
  const byTitle = new Map<string, Unique>()
  const better = (a: Entry, b: Entry) => (a.sourceWeight !== b.sourceWeight ? a.sourceWeight > b.sourceWeight : a.lang === 'pt' && b.lang !== 'pt')
  for (const e of kept) {
    const k = canonicalUrl(e.key) ?? e.key
    const tk = titleDedupEligible(e.titleKey) ? e.titleKey : null
    const hit = byKey.get(k) ?? (tk ? byTitle.get(tk) : undefined)
    if (hit) {
      if (better(e, hit.e)) {
        hit.others.add(hit.e.sourceName)
        hit.e = e
      } else hit.others.add(e.sourceName)
      byKey.set(k, hit)
      if (tk) byTitle.set(tk, hit)
      continue
    }
    const u: Unique = { e, others: new Set() }
    byKey.set(k, u)
    if (tk) byTitle.set(tk, u)
  }
  const unique = [...new Set(byKey.values())]
  stats.unique = unique.length

  const groups: Group[] = []
  for (const u of unique) {
    const tk = tokensOf(u.e.title)
    const g = groups.find((x) => x.tokens.some((t) => sameStory(t, tk)))
    if (g) {
      g.members.push(u)
      g.tokens.push(tk)
    } else groups.push({ members: [u], tokens: [tk] })
  }
  stats.stories = groups.length

  const likes = compileKeywords(profile.likes.map((term, i) => ({ id: `l${i}`, term, weight: 2.5, kind: 'boost', category: null })))
  const learnedTerms = learned ? compileKeywords(learned.terms.map((t, i) => ({ id: `t${i}`, term: t.term, weight: t.value, kind: 'boost', category: null }))) : []
  const scored: Candidate[] = []
  for (const g of groups) {
    const rep = [...g.members].map((m) => m.e).sort((a, b) => repScore(b, now) - repScore(a, now))[0]
    const others = new Set<string>()
    for (const m of g.members) {
      if (m.e.sourceName !== rep.sourceName) others.add(m.e.sourceName)
      for (const s of m.others) if (s !== rep.sourceName) others.add(s)
    }
    const allOutlets = 1 + others.size

    const { area, votes } = classifyArea(rep)
    const pref = areaPref(profile, area)
    if (!pref.enabled) continue
    const parts: Part[] = [{ label: `área ${area}`, value: AREA_BASE[area] }]
    if (Math.abs(pref.weight - 1) > 0.01) parts.push({ label: `peso da área no perfil (${pref.weight})`, value: (pref.weight - 1) * 3 })
    const areaKw = Math.min(5, votes[area] - (rep.sourceArea === area ? 2.5 : 0))
    if (areaKw > 0) parts.push({ label: 'palavras da área', value: areaKw })
    const sig = matchPoints(rep.title, rep.excerpt, COMPILED_SIGNAL)
    if (sig.points > 0) parts.push({ label: `sinais (${sig.terms.join(', ')})`, value: Math.min(3, sig.points) })
    const lk = matchKeywords(rep.title, rep.excerpt, likes)
    if (lk.length) parts.push({ label: `você curte (${lk.map((m) => m.keyword.term).join(', ')})`, value: Math.min(5, lk.reduce((s, m) => s + m.points, 0)) })
    if (Math.abs(rep.sourceWeight - 1) > 0.01) parts.push({ label: `peso da fonte ${rep.sourceName}`, value: (rep.sourceWeight - 1) * 2.5 })
    if (learned && profile.learning) {
      if (learned.area[area]) parts.push({ label: `aprendido: área ${area}`, value: learned.area[area] })
      const ls = learned.source.get(rep.sourceId)
      if (ls) parts.push({ label: `aprendido: fonte ${rep.sourceName}`, value: ls.value })
      const lt = matchKeywords(rep.title, '', learnedTerms)
      if (lt.length) {
        const v = Math.max(-3, Math.min(3, lt.reduce((s, m) => s + m.keyword.weight, 0)))
        parts.push({ label: `aprendido: termos (${lt.map((m) => m.keyword.term).join(', ')})`, value: v })
      }
    }
    const age = now - Date.parse(rep.publishedAt ?? '')
    parts.push({ label: 'recência', value: recencyPoints(age) })
    const tune = profile.tuning ?? { depth: 0, fresh: 0 }
    if (tune.fresh > 0 && age > 12 * 36e5) parts.push({ label: 'você pediu notícia mais fresca', value: -tune.fresh * Math.min(3, (age / 36e5 - 12) / 12) })
    if (tune.depth > 0 && (rep.excerpt?.length ?? 0) < 120) parts.push({ label: 'você pediu menos notícia rasa', value: -0.8 * tune.depth })
    if (allOutlets > 1) {
      const v = area === 'mundo' ? Math.min(6, 1.5 * (allOutlets - 1)) : Math.min(2, 0.6 * (allOutlets - 1))
      parts.push({ label: `${allOutlets} veículos`, value: v })
    }
    if (rep.lang === 'pt') parts.push({ label: 'em português', value: 0.3 })
    const rounded = parts.map((p) => ({ ...p, value: round1(p.value) }))
    scored.push({
      ...rep,
      id: '',
      area,
      score: round1(rounded.reduce((s, p) => s + p.value, 0)),
      parts: rounded,
      outlets: allOutlets,
      otherSources: [...others].slice(0, 6),
    })
  }

  const picked = applyQuotas(scored, profile, target)
  picked.forEach((c, i) => (c.id = `c${i + 1}`))
  stats.candidates = picked.length
  return { candidates: picked, stats }
}

function repScore(e: Entry, now: number): number {
  const age = (now - Date.parse(e.publishedAt ?? '')) / DAY_MS
  return e.sourceWeight * 2 + (e.lang === 'pt' ? 0.6 : 0) + (e.excerpt ? 0.3 : 0) - (Number.isFinite(age) ? age * 0.2 : 1)
}

export function quotas(profile: Profile, target: number): Record<Area, number> {
  const share = AREAS.map((a) => {
    const p = areaPref(profile, a)
    return p.enabled ? AREA_SHARE[a] * Math.max(0.25, p.weight) : 0
  })
  const sum = share.reduce((s, x) => s + x, 0) || 1
  const raw = share.map((x) => (x / sum) * target)
  const out = raw.map(Math.floor)
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0, left = target - out.reduce((s, x) => s + x, 0); k < order.length && left > 0; k++, left--) out[order[k][1]]++
  return Object.fromEntries(AREAS.map((a, i) => [a, out[i]])) as Record<Area, number>
}

function applyQuotas(scored: Candidate[], profile: Profile, target: number): Candidate[] {
  const q = quotas(profile, target)
  const ranked = [...scored].sort((a, b) => b.score - a.score)
  const perSource = new Map<string, number>()
  const perArea = new Map<Area, number>()
  const out: Candidate[] = []
  const take = (c: Candidate) => {
    out.push(c)
    perSource.set(c.sourceId, (perSource.get(c.sourceId) ?? 0) + 1)
    perArea.set(c.area, (perArea.get(c.area) ?? 0) + 1)
  }
  const sourceOk = (c: Candidate) => (perSource.get(c.sourceId) ?? 0) < PER_SOURCE
  for (const c of ranked) {
    if (out.length >= target) break
    if ((perArea.get(c.area) ?? 0) < q[c.area] && sourceOk(c)) take(c)
  }
  for (const c of ranked) {
    if (out.length >= target) break
    if (!out.includes(c) && sourceOk(c)) take(c)
  }
  return out.sort((a, b) => b.score - a.score)
}
