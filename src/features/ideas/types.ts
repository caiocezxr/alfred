
export type IdeaKind = 'product' | 'content'
export type IdeaStatus = 'captured' | 'evaluating' | 'testing' | 'paused' | 'archived'
export type IdeaDecision = 'continue' | 'adjust' | 'archive'

export type Answer = { choice: string; note: string }
export type Answers = Record<string, Answer>

export type NextTest = {
  action: string
  target: string
  maxSpend: number
  goal: string
  deadline: string
  criterion: string | null
  startedAt: string | null
}

export type EvidenceKind = 'note' | 'result'
export type EvidenceSignal = 'supports' | 'contradicts' | 'neutral'

export type Evidence = {
  id: string
  ideaId: string
  kind: EvidenceKind
  criterion: string | null
  signal: EvidenceSignal
  text: string
  url: string | null
  metric: string | null
  value: number | null
  cost: number | null
  createdAt: string
  updatedAt: string
}

export type Idea = {
  id: string
  kind: IdeaKind
  title: string
  description: string
  answers: Answers
  status: IdeaStatus
  nextTest: NextTest | null
  decision: IdeaDecision | null
  decisionNote: string
  decidedAt: string | null
  createdAt: string
  updatedAt: string
  evidence: Evidence[]
}

export type NewIdea = { kind: IdeaKind; title: string; description?: string }
export type IdeaPatch = {
  title?: string
  description?: string
  kind?: IdeaKind
  status?: IdeaStatus
  decision?: IdeaDecision | ''
  decisionNote?: string
}
export type NewEvidence = {
  ideaId: string
  kind: EvidenceKind
  criterion?: string | null
  signal?: EvidenceSignal
  text?: string
  url?: string | null
  metric?: string | null
  value?: number | null
  cost?: number | null
}
