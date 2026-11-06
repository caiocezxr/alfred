import type { Answers, Evidence, IdeaKind, NextTest } from './types.ts'
import {
  CRITERIA, DONT_BASE, FLAGS, QUESTIONS, SCALE,
  type CriterionDef, type CriterionId, type FlagId, type Level, type PrincipleId, type TestPlan,
} from './questions.ts'

export type Verdict = 'test' | 'investigate' | 'discard' | 'insufficient'

export const VERDICT_LABEL: Record<Verdict, string> = {
  test: 'Testar barato',
  investigate: 'Investigar',
  discard: 'Descartar por enquanto',
  insufficient: 'Não há informação suficiente',
}
export const VERDICT_SHORT: Record<Verdict, string> = {
  test: 'testar barato',
  investigate: 'investigar',
  discard: 'descartar por enquanto',
  insufficient: 'sem dados',
}

export type Reason = {
  text: string
  note: string | null
  questionId: string | null
  evidenceId: string | null
  level: Level
}

export type CriterionResult = {
  id: CriterionId
  label: string
  state: Level
  core: boolean
  principle: PrincipleId
  reasons: Reason[]
  fromEvidence: boolean
}

export type FlagResult = { id: FlagId; label: string; detail: string; criterion: CriterionId; questionIds: string[] }
export type Motive = { tone: 'pos' | 'neg' | 'gap'; text: string; criterion: CriterionId | null }
export type Gap = { questionId: string; prompt: string; criterion: CriterionId; answered: boolean }

export type Assessment = {
  kind: IdeaKind
  verdict: Verdict
  summary: string
  motives: Motive[]
  criteria: CriterionResult[]
  flags: FlagResult[]
  riskiest: { criterion: CriterionId | null; label: string; text: string }
  validateFirst: string
  cheapTest: string
  dontDo: string[]
  gaps: Gap[]
  suggestion: NextTest
  principles: PrincipleId[]
  progress: { answered: number; total: number }
  tally: { supports: number; contradicts: number; neutral: number; spent: number }
}

export type IdeaInput = {
  kind: IdeaKind
  answers: Answers
  evidence: Evidence[]
  nextTest: NextTest | null
}

const FLAG_ORDER: FlagId[] = ['no_audience', 'no_pain', 'no_channel', 'spend_first', 'expensive_dep']
const OPTIONAL = new Set<CriterionId>(['future'])
const REAL: Record<IdeaKind, CriterionId> = { product: 'evidence', content: 'signal' }
const COST: Record<IdeaKind, CriterionId> = { product: 'execution', content: 'cost' }
const WHO: Record<IdeaKind, string> = { product: 'p_who', content: 'c_audience' }
const WHERE: Record<IdeaKind, string> = { product: 'p_channel', content: 'c_discovery' }

const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const quote = (s: string) => `“${clip(s, 64)}”`

function lc(s: string): string {
  if (!s) return s
  if (s.length > 1 && s[1] === s[1].toUpperCase() && s[1] !== s[1].toLowerCase()) return s
  return s[0].toLowerCase() + s.slice(1)
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function evidenceReason(e: Evidence): Reason {
  const dir = e.signal === 'supports' ? 'a favor' : e.signal === 'contradicts' ? 'contra' : 'neutro'
  const what =
    e.kind === 'result'
      ? `${clip(e.metric ?? 'resultado', 40)} = ${e.value === null ? '—' : num.format(e.value)}${e.cost ? ` (custo R$ ${num.format(e.cost)})` : ''}`
      : e.text.trim()
        ? quote(e.text)
        : e.url
          ? 'link registrado'
          : 'registro'
  return {
    text: `${e.kind === 'result' ? 'Resultado' : 'Evidência'} ${dir}: ${what}`,
    note: e.kind === 'result' && e.text.trim() ? clip(e.text, 120) : null,
    questionId: null,
    evidenceId: e.id,
    level: e.signal === 'supports' ? 'evidenced' : e.signal === 'contradicts' ? 'alert' : 'unknown',
  }
}

type Bucket = Record<Level, Reason[]>
const SEVERITY: Level[] = ['alert', 'evidenced', 'hypothesis', 'unknown']

function stateOf(b: Bucket): Level {
  if (b.alert.length) return 'alert'
  if (b.evidenced.length && b.evidenced.length >= b.hypothesis.length) return 'evidenced'
  if (b.evidenced.length || b.hypothesis.length) return 'hypothesis'
  return 'unknown'
}

function riskRank(r: CriterionResult): number {
  if (r.state === 'evidenced') return 99
  const base = r.state === 'alert' ? 0 : r.state === 'unknown' ? 2 : 3
  return base + (r.core ? 0 : r.state === 'alert' ? 1 : 2) + (OPTIONAL.has(r.id) ? 20 : 0)
}

export function assess(idea: IdeaInput, opts: { today: string }): Assessment {
  const { kind } = idea
  const questions = QUESTIONS[kind]
  const defs = CRITERIA[kind]

  const buckets = new Map<CriterionId, Bucket>(defs.map((d) => [d.id, { alert: [], evidenced: [], hypothesis: [], unknown: [] }]))
  const rawFlags = new Map<FlagId, string[]>()
  const marks = new Map<string, string>()
  const gaps: Gap[] = []
  const notes = new Map<string, string>()
  let answered = 0

  for (const q of questions) {
    const a = idea.answers[q.id]
    const choice = a ? q.choices.find((c) => c.id === a.choice) : undefined
    if (!a || !choice) {
      gaps.push({ questionId: q.id, prompt: q.prompt, criterion: q.criterion, answered: false })
      continue
    }
    answered++
    const note = a.note?.trim() ? a.note.trim() : null
    if (note) notes.set(q.id, note)
    let informative = false
    for (const [cid, level] of Object.entries(choice.effects) as [CriterionId, Level][]) {
      const b = buckets.get(cid)
      if (!b) continue
      b[level].push({ text: choice.means, note, questionId: q.id, evidenceId: null, level })
      if (level !== 'unknown') informative = true
    }
    if (!informative) gaps.push({ questionId: q.id, prompt: q.prompt, criterion: q.criterion, answered: true })
    if (choice.flag) rawFlags.set(choice.flag, [...(rawFlags.get(choice.flag) ?? []), q.id])
    for (const m of choice.marks ?? []) marks.set(m, q.id)
  }
  if (marks.has('weak_pain') && marks.has('no_edge')) rawFlags.set('no_pain', [marks.get('weak_pain')!, marks.get('no_edge')!])

  const evidence = [...idea.evidence].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  const tally = { supports: 0, contradicts: 0, neutral: 0, spent: 0 }
  for (const e of evidence) {
    tally[e.signal]++
    if (e.kind === 'result' && e.cost) tally.spent += e.cost
  }

  const criteria: CriterionResult[] = defs.map((d) => {
    const b = buckets.get(d.id)!
    let state = stateOf(b)
    const answerReasons = [...b[state], ...SEVERITY.filter((l) => l !== state).flatMap((l) => b[l])]
    const evReasons: Reason[] = []
    let fromEvidence = false

    const mine = evidence.filter((e) => e.signal !== 'neutral' && (d.id === REAL[kind] || e.criterion === d.id))
    const s = mine.filter((e) => e.signal === 'supports').length
    const x = mine.length - s
    evReasons.push(...mine.map(evidenceReason))
    if (s > x) {
      if (state === 'alert') evReasons.push({ text: 'O que aconteceu pesa mais que a resposta do diagnóstico.', note: null, questionId: null, evidenceId: null, level: 'evidenced' })
      state = 'evidenced'
      fromEvidence = true
    } else if (x > s) {
      state = 'alert'
      fromEvidence = true
    } else if (s > 0) {
      evReasons.unshift({ text: 'Há evidências nos dois sentidos — ainda inconclusivo.', note: null, questionId: null, evidenceId: null, level: 'hypothesis' })
      if (state === 'unknown') state = 'hypothesis'
    }

    if (d.id === COST[kind] && idea.nextTest && tally.spent > idea.nextTest.maxSpend) {
      state = 'alert'
      evReasons.unshift({
        text: `O gasto registrado (R$ ${num.format(tally.spent)}) passou do teto do teste (R$ ${num.format(idea.nextTest.maxSpend)}).`,
        note: null, questionId: null, evidenceId: null, level: 'alert',
      })
    }

    return { id: d.id, label: d.label, state, core: d.core, principle: d.principle, reasons: [...evReasons, ...answerReasons], fromEvidence }
  })
  const byId = new Map(criteria.map((c) => [c.id, c]))

  const flags: FlagResult[] = []
  for (const fid of FLAG_ORDER) {
    const qids = rawFlags.get(fid)
    if (!qids) continue
    const f = FLAGS[fid].byKind[kind]
    const crit = byId.get(f.criterion)!
    if (crit.fromEvidence && crit.state === 'evidenced') continue
    flags.push({ id: fid, label: FLAGS[fid].label, detail: f.detail, criterion: f.criterion, questionIds: qids })
  }

  const known = criteria.filter((c) => c.state !== 'unknown').length
  const alerts = criteria.filter((c) => c.state === 'alert')
  const core = criteria.filter((c) => c.core)
  const againstCore = tally.contradicts >= 2 && tally.contradicts > tally.supports && core.some((c) => c.state === 'alert' && c.fromEvidence)

  let verdict: Verdict
  if (flags.length >= 2 || (flags.length >= 1 && alerts.length >= 3) || againstCore) verdict = 'discard'
  else if (known < 3 || (core[0].state === 'unknown' && core[1].state === 'unknown')) verdict = 'insufficient'
  else if (flags.length === 0 && alerts.length === 0 && core.every((c) => c.state !== 'unknown')) verdict = 'test'
  else verdict = 'investigate'

  const flag = flags[0] ?? null
  let risk: CriterionResult | null = flag ? byId.get(flag.criterion)! : null
  if (!risk) {
    let best = 99
    for (const c of criteria) {
      const r = riskRank(c)
      if (r < best) {
        best = r
        risk = c
      }
    }
  }
  const def: CriterionDef | null = risk ? defs.find((d) => d.id === risk!.id)! : null
  const noteOf = (qid: string) => (notes.has(qid) ? quote(notes.get(qid)!) : null)
  const flagKind = flag ? FLAGS[flag.id].byKind[kind] : null
  const plan: TestPlan = flagKind?.plan ?? def?.plan ?? SCALE[kind].plan
  const riskiest = {
    criterion: risk?.id ?? null,
    label: risk?.label ?? 'Repetição',
    text: def ? def.hypothesis(noteOf) : SCALE[kind].hypothesis,
  }
  const validateFirst = flagKind?.validate ?? def?.validate ?? SCALE[kind].validate

  const who = notes.get(WHO[kind])
  const where = notes.get(WHERE[kind])
  const target = who || where ? [who && `Quem: ${clip(who, 80)}`, where && `Onde: ${clip(where, 80)}`].filter(Boolean).join(' · ') : plan.target
  const suggestion: NextTest = {
    action: plan.action,
    target,
    maxSpend: 0,
    goal: plan.goal,
    deadline: addDays(opts.today, 7),
    criterion: risk?.id ?? null,
    startedAt: null,
  }

  const motives: Motive[] = []
  const push = (m: Motive) => {
    if (motives.length < 3 && !motives.some((x) => x.text === m.text)) motives.push(m)
  }
  const why = (c: CriterionResult) => `${c.label}: ${lc(c.reasons[0]?.text ?? 'sem detalhes')}`
  const unknownCore = core.filter((c) => c.state === 'unknown')

  if (verdict === 'insufficient') {
    push({ tone: 'gap', text: `Só ${known} de ${criteria.length} critérios têm alguma informação.`, criterion: null })
    if (unknownCore.length) push({ tone: 'gap', text: `Faltam pontos centrais: ${joinList(unknownCore.map((c) => c.label.toLowerCase()))}.`, criterion: unknownCore[0].id })
    for (const f of flags) push({ tone: 'neg', text: `${f.label}. ${f.detail}`, criterion: f.criterion })
  } else if (verdict === 'test') {
    for (const c of criteria.filter((c) => c.state === 'evidenced').slice(0, 2)) push({ tone: 'pos', text: why(c), criterion: c.id })
    if (!motives.length) push({ tone: 'pos', text: 'Nenhum critério em alerta e nenhum sinal eliminatório.', criterion: null })
    if (risk) push({ tone: 'gap', text: `${risk.label} ainda é ${risk.state === 'unknown' ? 'desconhecido' : 'hipótese'} — é isso que o teste vai checar.`, criterion: risk.id })
  } else {
    for (const f of flags) push({ tone: 'neg', text: `${f.label}. ${f.detail}`, criterion: f.criterion })
    for (const c of alerts) if (!flags.some((f) => f.criterion === c.id)) push({ tone: 'neg', text: why(c), criterion: c.id })
    for (const c of unknownCore) push({ tone: 'gap', text: `${c.label}: ainda sem informação.`, criterion: c.id })
    const unknownRest = criteria.filter((c) => !c.core && c.state === 'unknown' && !OPTIONAL.has(c.id))
    if (unknownRest.length) push({ tone: 'gap', text: `Ainda sem informação sobre ${joinList(unknownRest.map((c) => c.label.toLowerCase()))}.`, criterion: unknownRest[0].id })
    if (verdict === 'investigate') for (const c of criteria.filter((c) => c.state === 'evidenced')) push({ tone: 'pos', text: why(c), criterion: c.id })
  }

  const dont: string[] = []
  if (verdict === 'discard') dont.push('Investir mais tempo nesta versão da ideia.')
  for (const f of flags) dont.push(FLAGS[f.id].byKind[kind].dont)
  if (verdict === 'test' && !risk)
    dont.push(kind === 'product' ? 'Construir a versão completa antes de repetir o teste com mais gente.' : 'Mudar o formato ou automatizar antes de 4 semanas de cadência.')
  dont.push(...DONT_BASE[kind])
  const dontDo = [...new Set(dont)].slice(0, 3)

  const order = new Map(defs.map((d, i) => [d.id, (d.core ? 0 : 10) + i]))
  const qIndex = new Map(questions.map((q, i) => [q.id, i]))
  gaps.sort((a, b) => order.get(a.criterion)! - order.get(b.criterion)! || qIndex.get(a.questionId)! - qIndex.get(b.questionId)!)

  const principles = [...new Set([risk?.principle, ...alerts.map((c) => c.principle)].filter((p): p is PrincipleId => !!p))]
  if (!principles.length) principles.push('validation')

  return {
    kind,
    verdict,
    summary: summaryFor(verdict, kind, !risk),
    motives,
    criteria,
    flags,
    riskiest,
    validateFirst,
    cheapTest: plan.action,
    dontDo,
    gaps,
    suggestion,
    principles: principles.slice(0, 3),
    progress: { answered, total: questions.length },
    tally,
  }
}

function summaryFor(v: Verdict, kind: IdeaKind, allEvidenced: boolean): string {
  switch (v) {
    case 'test':
      if (allEvidenced) return 'Os critérios estão evidenciados. O próximo passo é ver se o resultado se repete com mais gente.'
      return kind === 'product'
        ? 'Os pontos centrais têm base e não há sinais de alerta. Vale um teste curto e barato antes de construir qualquer coisa.'
        : 'Os pontos centrais têm base e não há sinais de alerta. Vale um experimento curto antes de automatizar ou investir em produção.'
    case 'investigate':
      return 'Há lacunas ou alertas que um teste agora não resolveria. Investigue o ponto mais arriscado antes de desenhar o teste.'
    case 'discard':
      return 'Os sinais de alerta pesam mais que o resto — por enquanto. Não é sentença: se algo mudar, o parecer muda junto.'
    case 'insufficient':
      return 'Faltam respostas para um parecer honesto. Isso não diz nada de ruim sobre a ideia — só que ainda não dá para avaliar.'
  }
}
