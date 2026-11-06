import { assess, type Assessment, type IdeaInput } from './engine.ts'
import type { Answers, Evidence, IdeaKind } from './types.ts'

type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void
  notEqual(actual: unknown, expected: unknown, message?: string): void
  deepEqual(actual: unknown, expected: unknown, message?: string): void
  ok(value: unknown, message?: string): void
}
const nodeTest = 'node:test'
const nodeAssert = 'node:assert/strict'
const { test } = (await import(nodeTest)) as { test: (name: string, fn: () => void) => void }
const assert = ((await import(nodeAssert)) as { default: Assert }).default

const TODAY = '2026-11-05'

function idea(kind: IdeaKind, picks: Record<string, string | [string, string]> = {}, evidence: Evidence[] = []): IdeaInput {
  const answers: Answers = {}
  for (const [q, v] of Object.entries(picks)) answers[q] = Array.isArray(v) ? { choice: v[0], note: v[1] } : { choice: v, note: '' }
  return { kind, answers, evidence, nextTest: null }
}

let seq = 0
function ev(p: Partial<Evidence> & Pick<Evidence, 'signal'>): Evidence {
  seq++
  return {
    id: `e${seq}`, ideaId: 'i', kind: 'note', criterion: null, text: 'registro', url: null, metric: null, value: null, cost: null,
    createdAt: `2026-11-0${Math.min(9, seq)}T10:00:00.000Z`, updatedAt: `2026-11-0${Math.min(9, seq)}T10:00:00.000Z`, ...p,
  }
}

const state = (a: Assessment, id: string) => a.criteria.find((c) => c.id === id)?.state
const flagIds = (a: Assessment) => a.flags.map((f) => f.id)

const STRONG_PRODUCT = {
  p_who: ['named', 'nutricionistas que atendem online'] as [string, string],
  p_payer: 'confirmed',
  p_problem: 'heard',
  p_today: 'pays',
  p_channel: ['access', 'grupo de nutricionistas no Telegram'] as [string, string],
  p_offer: 'defined',
  p_intent: 'paid',
  p_test: 'ready',
  p_mvp: 'done_before',
  p_deps: 'none',
}

const BASE_PRODUCT = {
  p_who: 'profile',
  p_payer: 'guess',
  p_problem: 'believe',
  p_today: 'workaround',
  p_channel: 'plausible',
  p_offer: 'defined',
  p_intent: 'said',
  p_test: 'idea',
  p_mvp: 'days',
  p_deps: 'light',
}

test('ideia sem respostas → não há informação suficiente, com perguntas para responder', () => {
  const a = assess(idea('product'), { today: TODAY })
  assert.equal(a.verdict, 'insufficient')
  assert.equal(a.progress.answered, 0)
  assert.ok(a.criteria.every((c) => c.state === 'unknown'), 'todos os critérios desconhecidos')
  assert.equal(a.gaps[0].questionId, 'p_who', 'a primeira lacuna é a dor/público')
  assert.ok(a.gaps.length === 10)
  assert.ok(a.motives.length >= 1 && a.motives.length <= 3)
  assert.ok(a.dontDo.length >= 1, 'sempre diz o que não fazer agora')
  assert.ok(a.suggestion.action.length > 0, 'sempre termina numa ação concreta')
  assert.equal(a.suggestion.deadline, '2026-11-12')
})

test('"não sei" em tudo expõe incerteza, não ruindade', () => {
  const picks: Record<string, string> = {}
  for (const q of ['p_who', 'p_payer', 'p_problem', 'p_today', 'p_channel', 'p_offer', 'p_test', 'p_mvp', 'p_deps']) picks[q] = 'unknown'
  picks.p_intent = 'not_yet'
  const a = assess(idea('product', picks), { today: TODAY })
  assert.equal(a.verdict, 'insufficient')
  assert.equal(a.flags.length, 0)
  assert.equal(a.progress.answered, 10)
  assert.ok(a.gaps.every((g) => g.answered), 'lacunas apontam as respostas "não sei"')
})

test('respostas fortes com evidência → testar barato', () => {
  const a = assess(idea('product', STRONG_PRODUCT), { today: TODAY })
  assert.equal(a.verdict, 'test')
  assert.equal(a.flags.length, 0)
  assert.equal(state(a, 'pain'), 'evidenced')
  assert.equal(state(a, 'distribution'), 'evidenced')
  assert.equal(state(a, 'evidence'), 'evidenced')
  assert.ok(a.motives.some((m) => m.tone === 'pos'))
  assert.ok(a.motives.length <= 3)
  assert.ok(a.suggestion.target.includes('nutricionistas'), 'quem abordar vem das palavras do usuário')
})

test('hipóteses sem alertas também levam a um teste barato — o teste troca suposição por evidência', () => {
  const a = assess(idea('product', BASE_PRODUCT), { today: TODAY })
  assert.equal(a.verdict, 'test')
  assert.equal(a.riskiest.criterion, 'pain', 'a dor é validada primeiro')
  assert.equal(a.suggestion.criterion, 'pain')
  assert.ok(a.motives.some((m) => m.tone === 'gap'))
})

test('o porquê de cada critério aponta a resposta que o gerou', () => {
  const a = assess(idea('product', { ...BASE_PRODUCT, p_channel: ['paid', 'Instagram Ads'] }), { today: TODAY })
  const dist = a.criteria.find((c) => c.id === 'distribution')!
  assert.equal(dist.state, 'alert')
  assert.equal(dist.reasons[0].questionId, 'p_channel')
  assert.equal(dist.reasons[0].note, 'Instagram Ads')
})

test('eliminatórias são sinalizadas; duas ou mais → descartar por enquanto', () => {
  const a = assess(idea('product', { ...BASE_PRODUCT, p_who: 'anyone', p_channel: 'paid', p_test: 'build' }), { today: TODAY })
  assert.deepEqual(flagIds(a), ['no_audience', 'no_channel', 'spend_first'])
  assert.equal(a.verdict, 'discard')
  assert.equal(a.motives[0].tone, 'neg')
  assert.ok(a.dontDo[0].startsWith('Investir mais tempo'))
  assert.ok(a.flags.every((f) => f.questionIds.length > 0), 'cada sinal aponta a pergunta de origem')
})

test('uma eliminatória isolada pede investigação, não descarte', () => {
  const a = assess(idea('product', { ...BASE_PRODUCT, p_deps: 'heavy' }), { today: TODAY })
  assert.deepEqual(flagIds(a), ['expensive_dep'])
  assert.equal(a.verdict, 'investigate')
  assert.equal(a.riskiest.criterion, 'execution')
  assert.ok(a.dontDo.includes('Assinar serviços recorrentes só para testar.'))
})

test('"não resolve dor nem tem diferencial" só quando as duas coisas aparecem', () => {
  const both = assess(idea('product', { ...BASE_PRODUCT, p_problem: 'rare', p_today: 'solved' }), { today: TODAY })
  assert.ok(flagIds(both).includes('no_pain'))
  const one = assess(idea('product', { ...BASE_PRODUCT, p_problem: 'rare' }), { today: TODAY })
  assert.ok(!flagIds(one).includes('no_pain'))
  assert.equal(state(one, 'pain'), 'alert')
  assert.equal(one.verdict, 'investigate')
})

test('conteúdo usa critérios próprios, sem presumir monetização', () => {
  const a = assess(
    idea('content', {
      c_audience: ['defined', 'devs iniciantes em Python, no YouTube'],
      c_value: 'clear',
      c_format: 'defined',
      c_manual: 'yes',
      c_discovery: 'search',
      c_future: 'not_goal',
      c_metric: 'defined',
      c_cost: 'low',
      c_proof: 'none',
    }),
    { today: TODAY },
  )
  const ids = a.criteria.map((c) => c.id)
  assert.deepEqual(ids, ['audience', 'discovery', 'format', 'signal', 'cost', 'future'])
  assert.ok(!ids.includes('monetization' as never), 'não usa o critério de venda de software')
  assert.equal(a.verdict, 'test')
  assert.notEqual(a.riskiest.criterion, 'future', 'monetização futura nunca lidera o risco')
  assert.ok(a.dontDo.some((d) => d.includes('peças manuais')))
})

test('conteúdo amplo e sem descoberta é sinalizado com regras de conteúdo', () => {
  const a = assess(idea('content', { c_audience: 'broad', c_discovery: 'none', c_format: 'defined', c_manual: 'yes' }), { today: TODAY })
  assert.deepEqual(flagIds(a), ['no_audience', 'no_channel'])
  assert.equal(a.flags[0].criterion, 'audience')
  assert.equal(a.flags[1].criterion, 'discovery')
  assert.equal(a.verdict, 'discard')
})

test('evidência nova muda o parecer: canal comprovado desfaz o alerta', () => {
  const picks = { ...BASE_PRODUCT, p_channel: 'paid' }
  const before = assess(idea('product', picks), { today: TODAY })
  assert.equal(before.verdict, 'investigate')
  assert.deepEqual(flagIds(before), ['no_channel'])

  const after = assess(idea('product', picks, [ev({ criterion: 'distribution', signal: 'supports', text: 'Post no grupo trouxe 30 respostas' })]), { today: TODAY })
  assert.equal(state(after, 'distribution'), 'evidenced')
  assert.equal(after.flags.length, 0)
  assert.equal(after.verdict, 'test')
  assert.equal(state(after, 'evidence'), 'evidenced', 'evidência a favor também conta como evidência real')
})

test('evidências contrárias à dor levam a descartar por enquanto', () => {
  const evs = [
    ev({ criterion: 'pain', signal: 'contradicts', text: '4 de 5 não lembram a última vez' }),
    ev({ kind: 'result', criterion: 'pain', signal: 'contradicts', metric: 'conversas com caso real', value: 1, text: '' }),
  ]
  const a = assess(idea('product', BASE_PRODUCT, evs), { today: TODAY })
  assert.equal(state(a, 'pain'), 'alert')
  assert.equal(a.criteria.find((c) => c.id === 'pain')!.reasons[0].evidenceId !== null, true)
  assert.equal(a.verdict, 'discard')
})

test('gasto acima do teto do teste vira alerta de custo', () => {
  const i = idea('product', BASE_PRODUCT, [ev({ kind: 'result', signal: 'neutral', metric: 'cliques', value: 40, cost: 120 })])
  i.nextTest = { action: 'a', target: 't', maxSpend: 50, goal: 'g', deadline: '2026-11-12', criterion: 'pain', startedAt: null }
  const a = assess(i, { today: TODAY })
  assert.equal(state(a, 'execution'), 'alert')
  assert.ok(a.criteria.find((c) => c.id === 'execution')!.reasons[0].text.includes('passou do teto'))
  assert.equal(a.tally.spent, 120)
})

test('determinístico: mesma entrada, mesmo parecer', () => {
  const i = idea('product', { ...BASE_PRODUCT, p_deps: 'heavy' }, [ev({ criterion: 'pain', signal: 'supports' })])
  assert.deepEqual(assess(i, { today: TODAY }), assess(i, { today: TODAY }))
})

test('tudo evidenciado → próximo passo é repetir com mais gente', () => {
  const a = assess(idea('product', STRONG_PRODUCT), { today: TODAY })
  assert.equal(a.riskiest.criterion, null)
  assert.ok(a.cheapTest.includes('dobro'))
})
