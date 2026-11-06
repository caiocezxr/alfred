import { CADERNO_LABEL, CADERNOS, cadernoOf, type Area, type BriefItem, type Caderno, type Edition, type Quote } from './types.ts'

export type View = 'tudo' | Caderno
export type Region = 'BR' | 'EUA' | 'CN' | 'UE'
export type Shape = 'sq' | 'di' | 'ci'

export const VIEWS: { id: View; key: string; tab: string; long: string; desc: string }[] = [
  { id: 'tudo', key: '0', tab: 'Tudo', long: 'Primeira página', desc: 'O topo de cada caderno' },
  { id: 'politica', key: '1', tab: 'Política', long: 'Caderno Política', desc: 'Brasil, EUA, China, Europa e o mundo' },
  { id: 'investimentos', key: '2', tab: 'Investimentos', long: CADERNO_LABEL.investimentos, desc: 'Juros, câmbio, bolsa, cripto e oportunidades' },
  { id: 'ia_dev', key: '3', tab: 'IA e dev', long: CADERNO_LABEL.ia_dev, desc: 'Modelos, ferramentas, código e a segurança do seu stack' },
]

export const SHAPE: Record<Caderno, Shape> = { politica: 'sq', investimentos: 'di', ia_dev: 'ci' }

export const TYPE_LABEL: Record<Area, string> = {
  politica: 'Política',
  mundo: 'Mundo',
  dinheiro: 'Mercado',
  ia: 'IA',
  codigo: 'Código',
  potencializa: 'Ferramenta',
  seguranca: 'Segurança',
}

export const REGION_LABEL: Record<Region, string> = { BR: 'Brasil', EUA: 'Estados Unidos', CN: 'China', UE: 'Europa' }

const REGION_WORDS: [Region, RegExp][] = [
  ['BR', /\b(brasil|brasileir\w*|lula|stf|planalto|congresso nacional|câmara dos deputados|senado federal|haddad|copom|selic|ibovespa|bndes|tse|pix)\b/i],
  ['EUA', /\b(eua|estados unidos|trump|biden|washington|casa branca|white house|congress|senate|fed|wall street|democrata\w*|republican\w*)\b/i],
  ['CN', /\b(china|chin[eê]s\w*|pequim|beijing|xi jinping|taiwan|hong kong)\b/i],
  ['UE', /\b(europa|europe\w*|união europeia|uniao europeia|bruxelas|brussels|zona do euro|alemanha|frança|franca|itália|italia|reino unido)\b/i],
]

export function regionOf(it: Pick<BriefItem, 'title' | 'summary'>): Region | null {
  const text = `${it.title} ${it.summary}`
  let best: Region | null = null
  let bestAt = Infinity
  for (const [r, re] of REGION_WORDS) {
    const m = text.match(re)
    if (m && m.index !== undefined && m.index < bestAt) {
      best = r
      bestAt = m.index
    }
  }
  return best
}

export const confidenceOf = (outlets: number) => (outlets >= 3 ? 'alta' : outlets === 2 ? 'média' : 'fonte única')

export function tierOf(it: BriefItem, all: BriefItem[]): 1 | 2 | 3 {
  const ranks = [...all].map((x) => x.rank).sort((a, b) => b - a)
  const pos = ranks.indexOf(it.rank) / Math.max(1, ranks.length - 1)
  return pos <= 0.3 ? 1 : pos <= 0.7 ? 2 : 3
}

export const TIER_LABEL = { 1: 'alta', 2: 'média', 3: 'de contexto' } as const

export function dossieNumber(date: string): number {
  const d = Date.parse(`${date}T12:00:00Z`)
  const start = Date.UTC(new Date(d).getUTCFullYear(), 0, 1)
  return Math.floor((d - start) / 864e5) + 1
}

export type Front = { lead: BriefItem | null; leads: BriefItem[]; rest: (c: Caderno) => BriefItem[]; ordered: BriefItem[] }

export function frontOf(e: Edition): Front {
  const byKey = new Map(e.items.map((i) => [i.key, i]))
  const inCad = (c: Caderno) => {
    const keys = e.cadernos?.[c]?.keys
    const list = keys ? keys.map((k) => byKey.get(k)).filter((x): x is BriefItem => !!x) : e.items.filter((i) => cadernoOf(i.area) === c).sort((a, b) => b.rank - a.rank)
    return list
  }
  const lead = byKey.get(e.focusKey ?? '') ?? [...e.items].sort((a, b) => b.rank - a.rank)[0] ?? null
  const leads = CADERNOS.map((c) => {
    const k = e.cadernos?.[c]?.lead
    const pick = k ? byKey.get(k) : inCad(c)[0]
    return pick && pick !== lead && cadernoOf(pick.area) !== (lead ? cadernoOf(lead.area) : null) ? pick : null
  }).filter((x): x is BriefItem => !!x)
  const shown = new Set([lead, ...leads].filter(Boolean).map((x) => x!.key))
  const rest = (c: Caderno) => inCad(c).filter((i) => !shown.has(i.key))
  const ordered = [...(lead ? [lead] : []), ...leads, ...CADERNOS.flatMap((c) => rest(c))]
  return { lead, leads, rest, ordered }
}

export function storiesOf(e: Edition, view: View): BriefItem[] {
  const f = frontOf(e)
  if (view === 'tudo') return f.ordered
  return f.ordered.filter((i) => cadernoOf(i.area) === view)
}

export function cadernoLeads(e: Edition): { caderno: Caderno; item: BriefItem }[] {
  const f = frontOf(e)
  return [...(f.lead ? [f.lead] : []), ...f.leads].map((item) => ({ caderno: cadernoOf(item.area), item }))
}

export type Annex =
  | { kind: 'model'; vendor: string; model: string; changed: string; specs: [string, string][] }
  | { kind: 'changelog'; product: string; version: string; lines: string[] }
  | { kind: 'advisory'; ids: string[]; severity: 1 | 2 | 3 | 4 | null; fixed: boolean | null }
  | { kind: 'rate'; selic: number; ipca: number; real: number }
  | { kind: 'price'; quotes: Quote[] }
  | { kind: 'dispatch'; region: Region | null }

const MODELS: [RegExp, string][] = [
  [/\b(GPT[-‑ ]?\d+(?:\.\d+)?(?:[- ](?:mini|nano|pro|turbo|cyber|astra|o))?)\b/i, 'OpenAI'],
  [/\b(o\d(?:-mini|-pro)?)\b/, 'OpenAI'],
  [/\b(Gemini(?: Omni)?(?: \d+(?:\.\d+)?)?(?: (?:Pro|Flash|Ultra|Nano)(?: Lite)?)?)\b/i, 'Google'],
  [/\b(Gemma ?\d+(?:\.\d+)?(?: ?[\dE]+B)?)\b/i, 'Google'],
  [/\b(Claude(?: (?:Opus|Sonnet|Haiku))?(?: \d+(?:\.\d+)?)?)\b/i, 'Anthropic'],
  [/\b(Llama ?\d+(?:\.\d+)?)\b/i, 'Meta'],
  [/\b(Qwen ?\d+(?:\.\d+)?(?:-\w+)?)\b/i, 'Alibaba'],
  [/\b(DeepSeek(?:[- ][VR]\d+(?:\.\d+)?)?)\b/i, 'DeepSeek'],
  [/\b(Mistral(?: \w+)?|Mixtral \w+)\b/i, 'Mistral'],
  [/\b(ERNIE \d+(?:\.\d+)?(?: \w+)*?)(?= com| with|,|\.|$)/i, 'Baidu'],
  [/\b(Grok ?\d+(?:\.\d+)?)\b/i, 'xAI'],
]

const SPEC_RX: [string, RegExp][] = [
  ['Parâmetros', /(\d+(?:[.,]\d+)?\s*(?:bilhões|bilhão|milhões|trilhões|[BT])\s*(?:de\s*)?parâmetros)/i],
  ['Contexto', /(contexto de [\d.,]+\s*(?:mil|milhão|milhões)?\s*(?:de\s*)?tokens|[\d.,]+\s*(?:mil|milhão|milhões|k|M)\s*(?:de\s*)?tokens de contexto)/i],
  ['Preço', /((?:US\$|R\$)\s?[\d.,]+(?:\s*(?:por|\/)\s*(?:milhão de tokens|1M tokens|mês|usuário))?)/i],
  ['Licença', /\b(open[- ]source|código aberto|pesos abertos|open weights)\b/i],
  ['Disponível', /\b(disponível (?:hoje|agora|para [^.,;]+)|já disponível[^.,;]*)/i],
]

const sentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[\p{Lu}"“])/u).map((x) => x.trim()).filter(Boolean)

function modelAnnex(it: BriefItem): Annex | null {
  const text = `${it.title}. ${it.summary}`
  for (const [rx, vendor] of MODELS) {
    const m = it.title.match(rx) ?? text.match(rx)
    if (!m) continue
    const model = m[1].replace(/‑/g, '-').trim()
    if (model.length < 3) continue
    const specs: [string, string][] = []
    for (const [label, re] of SPEC_RX) {
      const s = text.match(re)
      if (s) specs.push([label, s[1].replace(/\s+/g, ' ')])
    }
    const changed = sentences(it.summary)[0] ?? ''
    if (!changed && !specs.length) return null
    return { kind: 'model', vendor, model, changed, specs }
  }
  return null
}

const VERSION_RX = /\b([A-Z][\w.+#-]*(?: [A-Z][\w.+#-]*)?)\s+v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\b/

function changelogAnnex(it: BriefItem): Annex | null {
  const text = `${it.title}. ${it.summary}`
  const m = it.title.match(VERSION_RX) ?? text.match(VERSION_RX)
  if (!m) return null
  const lines = sentences(it.summary).slice(0, 3)
  if (!lines.length) return null
  return { kind: 'changelog', product: m[1], version: m[2], lines }
}

function advisoryAnnex(it: BriefItem): Annex | null {
  const text = `${it.title}. ${it.summary}`
  const ids = [...new Set(text.match(/CVE-\d{4}-\d{4,7}/g) ?? [])]
  const severity = /\bcr[ií]tic[ao]s?\b|critical/i.test(text) ? 4 : /\b(grave|alta severidade|high severity)\b/i.test(text) ? 3 : /\bmoderad[ao]\b|medium/i.test(text) ? 2 : null
  const fixed = /\b(corrigid[ao]s?|correção|patch|atualiza(?:ção|r)|fix(?:ed)?)\b/i.test(text) ? true : /\b(sem correção|não corrigid|zero[- ]day|dia zero)\b/i.test(text) ? false : null
  if (!ids.length && severity === null) return null
  return { kind: 'advisory', ids, severity, fixed }
}

function marketAnnex(it: BriefItem, e: Edition): Annex | null {
  const text = `${it.title} ${it.summary}`.toLowerCase()
  const q = (id: string) => e.market.find((x) => x.id === id)
  const selic = q('selic')
  const ipca = q('ipca')
  if (selic && ipca && /\b(selic|copom|juros?|renda fixa|tesouro|cdi|cdb)\b/.test(text)) {
    const real = ((1 + selic.value / 100) / (1 + ipca.value / 100) - 1) * 100
    return { kind: 'rate', selic: selic.value, ipca: ipca.value, real: Math.round(real * 10) / 10 }
  }
  const map: [RegExp, string][] = [
    [/\b(d[oó]lar|câmbio|cambio)\b/, 'dolar'],
    [/\beuro\b/, 'euro'],
    [/\b(ibovespa|bolsa|b3)\b/, 'ibovespa'],
    [/\b(bitcoin|btc)\b/, 'bitcoin'],
    [/\b(ethereum|ether|eth)\b/, 'ethereum'],
  ]
  const quotes = map.filter(([re]) => re.test(text)).map(([, id]) => q(id)).filter((x): x is Quote => !!x)
  return quotes.length ? { kind: 'price', quotes: quotes.slice(0, 2) } : null
}

export function annexOf(it: BriefItem, e: Edition): Annex | null {
  switch (it.area) {
    case 'ia':
      return modelAnnex(it) ?? changelogAnnex(it)
    case 'potencializa':
    case 'codigo':
      return changelogAnnex(it) ?? (it.area === 'codigo' ? null : modelAnnex(it))
    case 'seguranca':
      return advisoryAnnex(it)
    case 'dinheiro':
      return marketAnnex(it, e)
    case 'politica':
    case 'mundo':
      return { kind: 'dispatch', region: regionOf(it) }
  }
}

export function timelineOf(e: Edition, list: BriefItem[]): { key: string; pos: number; shape: Shape; title: string; at: string; lane: number }[] {
  const from = Date.parse(e.windowFrom)
  const to = Date.parse(e.createdAt)
  const span = Math.max(1, to - from)
  const pts = list
    .filter((i) => i.publishedAt && Number.isFinite(Date.parse(i.publishedAt)))
    .map((i) => ({ key: i.key, pos: Math.min(100, Math.max(0, ((Date.parse(i.publishedAt!) - from) / span) * 100)), shape: SHAPE[cadernoOf(i.area)], title: i.title, at: i.publishedAt!, lane: 0 }))
    .sort((a, b) => a.pos - b.pos)
  const lastIn = [-99, -99, -99]
  for (const p of pts) {
    const lane = lastIn.findIndex((x) => p.pos - x > 3)
    p.lane = lane === -1 ? lastIn.indexOf(Math.min(...lastIn)) : lane
    lastIn[p.lane] = p.pos
  }
  return pts
}

export function timelineTicks(e: Edition): { pos: number; label: string }[] {
  const from = Date.parse(e.windowFrom)
  const to = Date.parse(e.createdAt)
  const span = Math.max(1, to - from)
  const out: { pos: number; label: string }[] = []
  const start = new Date(from)
  start.setMinutes(0, 0, 0)
  for (let t = start.getTime() + 36e5; t < to; t += 36e5) {
    const h = new Date(t).getHours()
    if (h % 6 !== 0) continue
    const pos = ((t - from) / span) * 100
    if (pos < 6 || pos > 88) continue
    out.push({ pos, label: h === 0 ? `0h · ${new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '').replace(' de ', ' ')}` : `${h}h` })
  }
  return out
}

export function confidenceLine(items: BriefItem[]): string {
  const n = (f: (o: number) => boolean) => items.filter((i) => f(i.outlets)).length
  const parts = [
    `${n((o) => o >= 3)} com 3 ou mais veículos`,
    `${n((o) => o === 2)} com 2`,
    `${n((o) => o <= 1)} de fonte única`,
  ]
  return parts.join(' · ')
}

export type Skin = 'papel' | 'tech' | 'revista'
export const skinOf = (style: string | undefined): Skin => (style === 'papel' ? 'papel' : style === 'tecnologico' ? 'tech' : 'revista')
