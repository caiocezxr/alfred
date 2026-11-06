
export const AREAS = ['dinheiro', 'codigo', 'ia', 'potencializa', 'seguranca', 'mundo'] as const
export type Area = (typeof AREAS)[number]
export type Lang = 'pt' | 'en'

export const AREA_LABEL: Record<Area, string> = {
  dinheiro: 'Dinheiro',
  codigo: 'Código',
  ia: 'IA',
  potencializa: 'Ferramentas',
  seguranca: 'Segurança',
  mundo: 'Mundo',
}

export const AREA_LONG: Record<Area, string> = {
  dinheiro: 'Dinheiro e oportunidades',
  codigo: 'Código e arquitetura',
  ia: 'IA e modelos',
  potencializa: 'Stacks e ferramentas',
  seguranca: 'Cibersegurança',
  mundo: 'Mundo',
}

export const isArea = (s: unknown): s is Area => typeof s === 'string' && (AREAS as readonly string[]).includes(s)

export type EditionStatus = 'running' | 'ready' | 'error'
export type JudgeKind = 'codex' | 'fallback'

export type EditionRow = {
  id: string
  date: string
  status: EditionStatus
  judge: JudgeKind | null
  startedAt: string
  finishedAt: string | null
  error: string | null
  payload: Edition | null
  attempts: number
}

export type TodayInfo = { edition: EditionRow | null; previousDate: string | null; windowFrom: string | null; stale: boolean }
export type BeginResult = { started: boolean; edition: EditionRow; windowFrom: string | null }

export type BriefSource = {
  id: string
  name: string
  url: string
  area: Area
  lang: Lang
  enabled: boolean
  weight: number
  builtin: boolean
  lastStatus: 'ok' | 'error' | null
  lastError: string | null
  lastFetchedAt: string | null
}

export type Signal = 'up' | 'down' | 'interest'
export type Reason = 'more' | 'knew' | 'shallow' | 'not_mine'
export type Origin = 'slide' | 'triage' | 'left_out'

export const REASON_LABEL: Record<Reason, string> = {
  more: 'quero mais disso',
  knew: 'já sabia',
  shallow: 'raso',
  not_mine: 'não é minha área',
}

export type FeedbackInput = {
  editionDate: string
  itemKey: string
  signal: Signal
  reason?: Reason | null
  origin: Origin
  area?: Area | null
  sourceId?: string | null
  sourceName?: string | null
  title: string
  originalTitle?: string | null
  kept?: boolean
}

export type Feedback = {
  id: string
  editionDate: string
  itemKey: string
  signal: Signal
  reason: Reason | null
  origin: Origin
  area: Area | null
  sourceId: string | null
  sourceName: string
  title: string
  originalTitle: string
  kept: boolean
  createdAt: string
  updatedAt: string
}

export type AreaPref = { id: Area; enabled: boolean; weight: number; note: string }
export type VoicePrefs = { voice: string; rate: number; jarvis: boolean }
export type Profile = {
  v: number
  areas: AreaPref[]
  likes: string[]
  ignores: string[]
  about: string
  useRadarSources: boolean
  learning: boolean
  voice: VoicePrefs
  codexPath: string | null
  judgeEffort: 'low' | 'medium' | 'high'
}

export type CodexStatus = { found: boolean; path: string | null; configured: boolean; error: string | null }
export type Voice = { id: string; name: string; locale: string }

export type QuoteUnit = 'usd' | 'brl' | 'pct' | 'pts'
export type Quote = {
  id: string
  label: string
  value: number
  unit: QuoteUnit
  changePct: number | null
  period: string
  asOf: string | null
  source: string
}
export type Market = { quotes: Quote[]; errors: string[] }

export type JudgeCandidate = {
  id: string
  source: string
  area: Area
  lang: Lang
  title: string
  excerpt: string
  ageHours: number | null
  outlets: number
}
export type MarketFact = { label: string; text: string }
export type JudgeInput = { dayLabel: string; candidates: JudgeCandidate[]; market: MarketFact[]; marketTime: string | null }

export type Scores = Record<Area, number>
export type JudgedItem = {
  id: string
  keep: boolean
  area: Area
  scores: Scores
  title: string
  summary: string | null
  why: string | null
  action: string | null
  narration: string | null
  reason: string | null
}
export type JudgeOutput = {
  opening: string | null
  closing: string | null
  focusId: string | null
  market: string | null
  items: JudgedItem[]
  model: string | null
  elapsedMs: number
}

export type BriefItem = {
  key: string
  id: string
  area: Area
  title: string
  originalTitle: string
  summary: string
  why: string
  action: string | null
  narration: string
  source: string
  sourceId: string
  url: string
  publishedAt: string | null
  lang: Lang
  outlets: number
  otherSources: string[]
  scores: Scores | null
  rank: number
  reason: string | null
}

export type Edition = {
  v: 1
  date: string
  createdAt: string
  windowFrom: string
  judge: JudgeKind
  judgeNote: string | null
  model: string | null
  opening: string
  closing: string
  focusKey: string | null
  items: BriefItem[]
  leftOut: BriefItem[]
  market: Quote[]
  marketAt: string | null
  marketNarration: string | null
  stats: { sources: number; sourcesOk: number; entries: number; candidates: number; durationMs: number; judgeMs: number | null }
}
