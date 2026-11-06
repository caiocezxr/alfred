import { civil, daysBetween, parseCivil } from '../../shared/dates'
import type { Assessment, Verdict } from './engine'
import type { Evidence, Idea, IdeaDecision } from './types'

export type Stage = 'diagnosis' | 'verdict' | 'test' | 'result'

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'diagnosis', label: 'Diagnóstico' },
  { id: 'verdict', label: 'Parecer' },
  { id: 'test', label: 'Teste' },
  { id: 'result', label: 'Resultado' },
]

export const stageIndex = (s: Stage) => STAGES.findIndex((x) => x.id === s)

export type Focus = 'question' | 'record' | 'decide' | null

export const VERDICT_CHIP: Record<Verdict, string> = {
  test: 'Testar barato',
  investigate: 'Investigar',
  discard: 'Descartar por enquanto',
  insufficient: 'Sem dados suficientes',
}

export const VERDICT_TINY: Record<Verdict, string> = {
  test: 'testar',
  investigate: 'investigar',
  discard: 'descartar',
  insufficient: 'sem dados',
}

export const DECISION_LABEL: Record<IdeaDecision, string> = {
  continue: 'Continuar',
  adjust: 'Ajustar',
  archive: 'Arquivar',
}

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })

export function dueLabel(date: string, today: string): string {
  const diff = daysBetween(today, date)
  if (diff === 0) return 'hoje'
  if (diff === 1) return 'amanhã'
  if (diff === -1) return 'ontem'
  if (diff > 1 && diff < 7) return WEEKDAY[parseCivil(date).getDay()]
  return dayMonth.format(parseCivil(date)).replace('.', '')
}

export type TestRun = { day: number; total: number; over: boolean; deadline: string; left: number }

export function testRun(idea: Idea, today: string): TestRun | null {
  const t = idea.nextTest
  if (idea.status !== 'testing' || !t?.startedAt) return null
  const from = civil(new Date(t.startedAt))
  const to = t.deadline || today
  const total = Math.max(1, daysBetween(from, to) + 1)
  const day = daysBetween(from, today) + 1
  return { day: Math.max(1, Math.min(day, total)), total, over: today > to, deadline: to, left: Math.max(0, daysBetween(today, to)) }
}

const time = (iso: string) => Date.parse(iso) || 0

export function pendingResults(idea: Idea): Evidence[] {
  const t = idea.nextTest
  if (!t?.startedAt) return []
  const start = time(t.startedAt)
  const since = idea.decidedAt ? Math.max(start, time(idea.decidedAt)) : start
  return idea.evidence.filter((e) => e.kind === 'result' && time(e.createdAt) > since)
}

export type StepId = 'start' | 'answer' | 'plan' | 'discard' | 'begin' | 'running' | 'overdue' | 'decide' | 'paused' | 'archived'
export type Tone = 'accent' | 'pos' | 'warn' | 'muted'

export type NextStep = {
  id: StepId
  stage: Stage
  short: string
  title: string
  cta: string
  tone: Tone
}

export function nextStep(idea: Idea, a: Assessment, today: string): NextStep {
  const { answered, total } = a.progress
  const left = total - answered
  const t = idea.nextTest

  if (idea.status === 'archived')
    return { id: 'archived', stage: 'result', short: 'arquivada', title: 'Encerrada, com o aprendizado guardado.', cta: '', tone: 'muted' }
  if (idea.status === 'paused')
    return { id: 'paused', stage: answered < total ? 'diagnosis' : 'verdict', short: 'pausada', title: 'Fora do foco por enquanto. Retome quando quiser.', cta: 'Retomar', tone: 'muted' }

  const run = testRun(idea, today)
  if (run) {
    if (pendingResults(idea).length)
      return { id: 'decide', stage: 'result', short: 'decisão pendente', title: 'Resultado registrado. Hora de decidir: continuar, ajustar ou arquivar.', cta: 'Decidir', tone: 'accent' }
    if (run.over)
      return { id: 'overdue', stage: 'result', short: 'prazo encerrado', title: 'O prazo do teste acabou. Registre o que aconteceu.', cta: 'Registrar resultado', tone: 'warn' }
    const due = dueLabel(run.deadline, today)
    return {
      id: 'running',
      stage: 'result',
      short: `testar até ${due}`,
      title: `Teste em andamento até ${due}. Registre o resultado assim que tiver.`,
      cta: 'Registrar resultado',
      tone: 'pos',
    }
  }

  if (answered === 0)
    return { id: 'start', stage: 'diagnosis', short: 'diagnóstico por fazer', title: `Comece pelo diagnóstico: ${total} perguntas curtas, salvas a cada resposta.`, cta: 'Começar diagnóstico', tone: 'accent' }
  if (left > 0)
    return {
      id: 'answer',
      stage: 'diagnosis',
      short: left === 1 ? 'falta 1 pergunta' : `faltam ${left} perguntas`,
      title: left === 1 ? 'Responda a última pergunta do diagnóstico.' : `Responda as ${left} perguntas que faltam.`,
      cta: 'Continuar diagnóstico',
      tone: 'accent',
    }
  if (a.verdict === 'discard' && !idea.decision)
    return { id: 'discard', stage: 'verdict', short: 'decidir o que fazer', title: 'O parecer sugere descartar por enquanto. Decida se arquiva ou ajusta.', cta: 'Ver parecer', tone: 'warn' }
  if (t && !t.startedAt)
    return { id: 'begin', stage: 'test', short: 'começar o teste', title: 'O teste está desenhado. Revise e comece.', cta: 'Revisar o teste', tone: 'accent' }
  return {
    id: 'plan',
    stage: 'verdict',
    short: 'definir o teste',
    title: a.verdict === 'insufficient' ? 'Faltam dados para um parecer firme. Um teste curto pode trazê-los.' : 'O parecer está pronto. Defina um teste de 7 dias.',
    cta: 'Ver parecer',
    tone: 'accent',
  }
}

const FOCUS: Partial<Record<StepId, Focus>> = { start: 'question', answer: 'question', running: 'record', overdue: 'record', decide: 'decide' }
export const focusFor = (step: NextStep): Focus => FOCUS[step.id] ?? null

export type Action = { label: string; stage: Stage; focus: Focus; resume?: true }

export function actionFor(step: NextStep, current: Stage): Action | null {
  if (step.id === 'archived') return null
  if (step.id === 'paused') return { label: 'Retomar a ideia', stage: current, focus: null, resume: true }
  if (current === 'verdict') {
    if (step.id === 'plan') return { label: 'Definir o teste', stage: 'test', focus: null }
    if (step.id === 'discard') return { label: 'Decidir o que fazer', stage: 'result', focus: 'decide' }
  }
  if (current === 'test' && step.id === 'plan') return null
  if (current === 'result' && step.id === 'discard') return null
  if (step.stage === current) return null
  return { label: step.cta, stage: step.stage, focus: focusFor(step) }
}

export type StageState = 'done' | 'next' | 'todo'
export type StageInfo = { state: StageState; sub: string }

export function stageInfo(idea: Idea, a: Assessment, step: NextStep, today: string): Record<Stage, StageInfo> {
  const { answered, total } = a.progress
  const t = idea.nextTest
  const run = testRun(idea, today)
  const pending = pendingResults(idea).length > 0
  const live = step.id !== 'archived' && step.id !== 'paused'
  const state = (s: Stage, done: boolean): StageState => (live && step.stage === s ? 'next' : done ? 'done' : 'todo')
  const n = idea.evidence.length

  return {
    diagnosis: {
      state: state('diagnosis', answered === total),
      sub: answered === total ? 'completo' : answered === 0 ? `${total} perguntas` : `${answered} de ${total}`,
    },
    verdict: {
      state: state('verdict', answered === total && (!!t || !!idea.decision)),
      sub: answered === 0 ? 'depois das respostas' : VERDICT_TINY[a.verdict],
    },
    test: {
      state: state('test', !!t?.startedAt),
      sub: !t
        ? 'a definir'
        : !t.startedAt
          ? 'pronto para começar'
          : run
            ? run.over
              ? 'prazo encerrado'
              : `dia ${run.day} de ${run.total}`
            : idea.status === 'paused'
              ? 'pausado'
              : 'encerrado',
    },
    result: {
      state: state('result', !!idea.decision && !pending),
      sub: idea.decision ? DECISION_LABEL[idea.decision].toLowerCase() : n ? `${n} ${n === 1 ? 'registro' : 'registros'}` : 'nada ainda',
    },
  }
}

export type PulseKey = 'decide' | 'overdue' | 'running' | 'diagnose' | 'plan'

export const PULSE: { key: PulseKey; one: string; many: string; tone: Tone }[] = [
  { key: 'decide', one: 'decisão pendente', many: 'decisões pendentes', tone: 'accent' },
  { key: 'overdue', one: 'prazo encerrado', many: 'prazos encerrados', tone: 'warn' },
  { key: 'running', one: 'em teste', many: 'em teste', tone: 'pos' },
  { key: 'diagnose', one: 'esperando diagnóstico', many: 'esperando diagnóstico', tone: 'muted' },
  { key: 'plan', one: 'teste por definir', many: 'testes por definir', tone: 'muted' },
]

export function pulseKey(step: NextStep): PulseKey | null {
  switch (step.id) {
    case 'decide':
    case 'discard':
      return 'decide'
    case 'overdue':
      return 'overdue'
    case 'running':
      return 'running'
    case 'start':
    case 'answer':
      return 'diagnose'
    case 'plan':
    case 'begin':
      return 'plan'
    default:
      return null
  }
}

export function reopenStatus(idea: Idea): Idea['status'] {
  return Object.keys(idea.answers).length ? 'evaluating' : 'captured'
}

export function resumeStatus(idea: Idea): Idea['status'] {
  return idea.nextTest?.startedAt ? 'testing' : reopenStatus(idea)
}
