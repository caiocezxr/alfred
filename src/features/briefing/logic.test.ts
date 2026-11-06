import { applyTranslations, assemble, looksEnglish, sanitizeEdition, withTranslations, autoSegue, cleanExcerpt, estimateSeconds, firstSentences, interleave, narrationOf, screensOf, withWeather, MAX_ITEMS, MAX_PER_AREA } from './assemble.ts'
import { buildProgram, firstLineOf } from './program.ts'
import { applyAdjustments, historyLine, planAdjustments, shouldAsk } from './rating.ts'
import { applyTaste, explainByTaste } from './assemble.ts'
import { localModelLabel } from './profile.ts'
import { numberWords, splitSentences, toSpeech } from './speech.ts'
import { ipaToKokoro, phonemize, trimSilence } from './tts/phonemes.ts'
import { stretch } from './tts/stretch.ts'
import { learn, signalVector, termsOf } from './learn.ts'
import { direction, fmtChange, fmtValue, marketFacts, marketNarrationFallback } from './market.ts'
import { defaultProfile, normalizeProfile } from './profile.ts'
import { classifyArea, isGossip, quotas, sameStory, sieve, unwrapRedirect, windowStart, type Candidate, type Entry } from './sieve.ts'
import { AREAS, type Area, type Feedback, type JudgeOutput, type Quote } from './types.ts'

type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void
  deepEqual(actual: unknown, expected: unknown, message?: string): void
  notEqual(actual: unknown, expected: unknown, message?: string): void
  ok(value: unknown, message?: string): void
}
const assert: Assert = (await import('node:assert/strict' as string)).default
let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

const NOW = Date.parse('2026-11-06T13:00:00.000Z')
const H = 36e5
let n = 0
const entry = (title: string, o: Partial<Entry> & { hoursAgo?: number } = {}): Entry => {
  n++
  const url = o.url ?? `https://site${n}.example/n/${n}`
  return {
    sourceId: o.sourceId ?? `src${n}`,
    sourceName: o.sourceName ?? `Fonte ${n}`,
    sourceArea: o.sourceArea === undefined ? null : o.sourceArea,
    sourceWeight: o.sourceWeight ?? 1,
    lang: o.lang ?? 'pt',
    url,
    key: o.key ?? url,
    title,
    titleKey: title.toLowerCase(),
    excerpt: o.excerpt ?? '',
    publishedAt: o.publishedAt === undefined ? new Date(NOW - (o.hoursAgo ?? 3) * H).toISOString() : o.publishedAt,
  }
}
const opts = (extra: Partial<Parameters<typeof sieve>[1]> = {}) => ({ now: NOW, windowFrom: NOW - 30 * H, profile: defaultProfile(), learned: null, ...extra })

test('janela: desde a última edição, entre 18 h e 96 h; sem edição, 30 h', () => {
  assert.equal(windowStart(NOW, null), NOW - 30 * H)
  assert.equal(windowStart(NOW, new Date(NOW - 24 * H).toISOString()), NOW - 24 * H)
  assert.equal(windowStart(NOW, new Date(NOW - 2 * H).toISOString()), NOW - 18 * H)
  assert.equal(windowStart(NOW, new Date(NOW - 300 * H).toISOString()), NOW - 96 * H)
})

test('fora da janela, sem data e fofoca/termo ignorado ficam de fora', () => {
  const p = defaultProfile()
  p.ignores = ['eleições']
  const r = sieve(
    [
      entry('Terremoto de magnitude 7,8 atinge o Japão', { sourceArea: 'mundo' }),
      entry('Notícia velha sobre ransomware', { hoursAgo: 50 }),
      entry('Sem data nenhuma', { publishedAt: null }),
      entry('Flamengo vence e assume a liderança do Brasileirão'),
      entry('Resultado das eleições no Paraguai'),
    ],
    opts({ profile: p }),
  )
  assert.deepEqual(r.candidates.map((c) => c.title), ['Terremoto de magnitude 7,8 atinge o Japão'])
  assert.equal(r.stats.inWindow, 3)
  assert.equal(r.stats.muted, 2)
  assert.ok(isGossip('BBB 26: participante deixa a casa'))
  assert.ok(!isGossip('Ataque hacker derruba sistema de bancos'))
})

test('mesma URL e mesmo título viram uma entrada; fica a fonte de maior peso', () => {
  const a = entry('Falha crítica no OpenSSH permite execução remota de código', { sourceName: 'A', sourceWeight: 0.8, url: 'https://x.com/p?utm_source=rss' })
  const b = entry('Falha crítica no OpenSSH permite execução remota de código', { sourceName: 'B', sourceWeight: 1.1, url: 'https://y.com/q' })
  const c = entry('Outra coisa totalmente diferente sobre Rust', { sourceName: 'C', url: 'https://x.com/p' })
  const r = sieve([a, b, c], opts())
  assert.equal(r.stats.unique, 1, 'b duplica a por título; c duplica a por URL canônica')
  const ssh = r.candidates.find((x) => x.title.includes('OpenSSH'))!
  assert.equal(ssh.sourceName, 'B')
  assert.deepEqual(ssh.otherSources.sort(), ['A', 'C'])
})

test('mesma história em vários veículos vira grupo; tamanho pesa forte em mundo', () => {
  const t = [
    'Terremoto de magnitude 7,8 atinge costa do Japão e gera alerta de tsunami',
    'Japão emite alerta de tsunami após terremoto de magnitude 7,8 na costa',
    'Forte terremoto atinge o Japão; alerta de tsunami na costa',
  ]
  const world = t.map((x, i) => entry(x, { sourceArea: 'mundo', sourceId: `w${i}`, sourceName: `Veículo ${i}` }))
  const lone = entry('Governo anuncia mudança em regra de aposentadoria', { sourceArea: 'mundo' })
  const r = sieve([...world, lone], opts())
  assert.equal(r.stats.stories, 2)
  const quake = r.candidates.find((c) => c.title.includes('Terremoto'))!
  assert.equal(quake.outlets, 3)
  assert.ok(quake.parts.some((p) => p.label === '3 veículos' && p.value === 3))
  assert.ok(quake.score > r.candidates.find((c) => c !== quake)!.score + 4)
  assert.ok(sameStory(new Set(termsOf(t[0])), new Set(termsOf(t[1]))))
  assert.ok(!sameStory(new Set(termsOf('Lula fala sobre economia')), new Set(termsOf('Lula viaja para a China'))))
})

test('classificação por palavras e fonte; folha desembrulha redirecionamento', () => {
  assert.equal(classifyArea({ title: 'New ransomware gang exploits zero-day in VPNs', excerpt: '', sourceArea: null }).area, 'seguranca')
  assert.equal(classifyArea({ title: 'Bitcoin cai 6% e Ethereum recua', excerpt: '', sourceArea: 'mundo' }).area, 'dinheiro')
  assert.equal(classifyArea({ title: 'Anthropic lança novo modelo Claude', excerpt: '', sourceArea: 'potencializa' }).area, 'ia')
  assert.equal(classifyArea({ title: 'Qualquer coisa', excerpt: '', sourceArea: 'codigo' }).area, 'codigo')
  assert.equal(
    unwrapRedirect('https://redir.folha.com.br/redir/online/mundo/rss091/*https://www1.folha.uol.com.br/mundo/2026/11/x.shtml'),
    'https://www1.folha.uol.com.br/mundo/2026/11/x.shtml',
  )
  assert.equal(unwrapRedirect('https://g1.globo.com/a'), 'https://g1.globo.com/a')
})

test('perfil: área desligada some, peso e termos curtidos somam', () => {
  const p = defaultProfile()
  p.areas.find((a) => a.id === 'mundo')!.enabled = false
  p.areas.find((a) => a.id === 'codigo')!.weight = 2
  p.likes = ['tauri']
  const r = sieve(
    [
      entry('Terremoto atinge o Japão', { sourceArea: 'mundo' }),
      entry('Refactoring a monolith into modules', { sourceArea: 'codigo', lang: 'en' }),
      entry('Tauri 3 beta is out', { sourceArea: 'potencializa', lang: 'en' }),
    ],
    opts({ profile: p }),
  )
  assert.equal(r.candidates.length, 2)
  const code = r.candidates.find((c) => c.area === 'codigo')!
  assert.ok(code.parts.some((x) => x.label.startsWith('peso da área') && x.value === 3))
  const tauri = r.candidates.find((c) => c.title.startsWith('Tauri'))!
  assert.ok(tauri.parts.some((x) => x.label.startsWith('você curte') && x.value === 2.5))
})

test('cotas: equilíbrio entre áreas e no máximo 4 por fonte', () => {
  const W = 'alfa bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu ameixa banana caju damasco'.split(' ')
  const many: Entry[] = []
  for (let i = 0; i < 30; i++) many.push(entry(`OpenAI ${W[i]} ${W[(i + 7) % 30]}zz release`, { sourceArea: 'ia', sourceId: `ia${i % 10}`, lang: 'en' }))
  for (let i = 0; i < 12; i++) many.push(entry(`Ransomware ${W[i]}yy ${W[(i + 11) % 30]}ww`, { sourceArea: 'seguranca', sourceId: 'sec' }))
  for (let i = 0; i < 12; i++) many.push(entry(`Copom ${W[i]}qq ${W[(i + 5) % 30]}rr`, { sourceArea: 'dinheiro', sourceId: `din${i % 4}` }))
  const r = sieve(many, opts({ target: 20 }))
  assert.equal(r.candidates.length, 20)
  assert.ok(r.candidates.filter((c) => c.sourceId === 'sec').length <= 4)
  assert.ok(r.candidates.filter((c) => c.area === 'dinheiro').length >= 3, 'dinheiro tem vaga mesmo com IA pontuando mais')
  assert.deepEqual(r.candidates.map((c) => c.id).slice(0, 3), ['c1', 'c2', 'c3'])
  const q = quotas(defaultProfile(), 40)
  assert.equal(Object.values(q).reduce((s, x) => s + x, 0), 40)
})

const fb = (o: Partial<Feedback>): Feedback => ({
  id: String(++n), editionDate: '2026-11-05', itemKey: `k${n}`, signal: 'up', reason: null, origin: 'slide', area: 'ia',
  sourceId: 's1', sourceName: 'S1', title: 'título', originalTitle: '', kept: true,
  createdAt: new Date(NOW - 24 * H).toISOString(), updatedAt: new Date(NOW - 24 * H).toISOString(), ...o,
})

test('sinais: "isso me interessa" é o mais forte; motivos pesam onde devem', () => {
  assert.ok(signalVector({ signal: 'interest', reason: null, origin: 'left_out' }).area > signalVector({ signal: 'up', reason: 'more', origin: 'slide' }).area)
  assert.ok(signalVector({ signal: 'down', reason: 'shallow', origin: 'slide' }).source < -1)
  assert.ok(signalVector({ signal: 'down', reason: 'not_mine', origin: 'slide' }).area <= -1.5)
  assert.ok(Math.abs(signalVector({ signal: 'down', reason: 'knew', origin: 'slide' }).area) < 0.5)
  assert.equal(signalVector({ signal: 'up', reason: null, origin: 'triage' }).area, 0.8)
})

test('aprende área, fonte e termos com teto e esquecimento', () => {
  const list = [
    fb({ title: 'Novo agente de código da OpenAI', area: 'ia' }),
    fb({ title: 'Agente de código open source bate recorde', area: 'ia', signal: 'interest', origin: 'left_out' }),
    fb({ title: 'Eleição no Paraguai', area: 'mundo', signal: 'down', reason: 'not_mine', sourceId: 's2', sourceName: 'S2' }),
    fb({ title: 'Muito antigo', area: 'codigo', updatedAt: new Date(NOW - 800 * 24 * H).toISOString() }),
  ]
  const l = learn(list, NOW)
  assert.equal(l.total, 3, 'o muito antigo já foi esquecido')
  assert.ok(l.area.ia > 0.4 && l.area.ia <= 2)
  assert.ok(l.area.mundo < 0)
  assert.equal(l.area.codigo, 0)
  assert.ok(l.source.get('s2')!.value < 0)
  const agente = l.terms.find((t) => t.term === 'agente')
  assert.ok(agente && agente.value > 0 && agente.count === 2)
  assert.ok(!l.terms.some((t) => t.term === 'paraguai'), 'termo visto uma vez só não vira peso')
  assert.deepEqual(termsOf('The new GPT-5 model is out in 2026'), ['gpt', 'model'])
  const r = sieve([entry('Agente de código que revisa PRs', { sourceArea: 'ia', sourceId: 's1' })], opts({ learned: l }))
  assert.ok(r.candidates[0].parts.some((p) => p.label.startsWith('aprendido: termos')))
  assert.ok(r.candidates[0].parts.some((p) => p.label === 'aprendido: área ia'))
})

const quotes: Quote[] = [
  { id: 'bitcoin', label: 'Bitcoin', value: 75904, unit: 'usd', changePct: -5.88, period: '24 h', asOf: null, source: 'CoinGecko' },
  { id: 'dolar', label: 'Dólar', value: 5.5037, unit: 'brl', changePct: 0.81, period: 'dia', asOf: null, source: 'AwesomeAPI' },
  { id: 'ibovespa', label: 'Ibovespa', value: 166191, unit: 'pts', changePct: 0.01, period: 'dia', asOf: null, source: 'Yahoo' },
  { id: 'selic', label: 'Selic', value: 13.75, unit: 'pct', changePct: null, period: 'ao ano', asOf: null, source: 'BCB' },
  { id: 'ipca', label: 'IPCA', value: 4.58, unit: 'pct', changePct: null, period: '12 meses', asOf: '2026-09-01', source: 'BCB' },
]

test('mercado em pt-BR, fatos para o juiz e narração sem conselho', () => {
  assert.equal(fmtValue(quotes[0]), 'US$ 75.904')
  assert.equal(fmtValue(quotes[1]), 'R$ 5,50')
  assert.equal(fmtValue(quotes[2]), '166.191 pts')
  assert.equal(fmtValue(quotes[3]), '13,75%')
  assert.equal(fmtChange(-5.88), '−5,9%')
  assert.equal(fmtChange(0.81), '+0,8%')
  assert.equal(direction(0.01), 'flat')
  const facts = marketFacts(quotes)
  assert.equal(facts[0].text, 'US$ 75.904 (−5,9% em 24 h)')
  assert.equal(facts[4].text, '4,58% em 12 meses (até set/2026)')
  const nar = marketNarrationFallback(quotes)!
  assert.ok(nar.startsWith('No mercado, o bitcoin caiu 5,9% em 24 horas, a US$ 75.904'), nar)
  assert.ok(nar.includes('A Selic está em 13,75% ao ano, e o IPCA soma 4,58% em 12 meses.'))
  assert.ok(!/compr|vend|recomend/i.test(nar))
  assert.equal(marketNarrationFallback([]), null)
})

const cand = (i: number, area: Area, lang: 'pt' | 'en' = 'en', score = 10 - i * 0.1): Candidate => ({
  ...entry(`Candidate ${i} ${area}`, { sourceArea: area, lang, excerpt: `Trecho ${i}. Segunda frase. Terceira.` }),
  id: `c${i}`, area, score, parts: [], outlets: 1, otherSources: [],
})
const stats = { sources: 10, sourcesOk: 9, entries: 300, candidates: 20, durationMs: 1000, judgeMs: 5000 }
const scores = (a: Area, v: number) => Object.fromEntries(AREAS.map((x) => [x, x === a ? v : 0])) as Record<Area, number>

test('com o juiz: mantidos com teto por área e por edição, foco, descartados com motivo', () => {
  const cands = [...Array.from({ length: 6 }, (_, i) => cand(i + 1, 'ia')), cand(7, 'seguranca'), cand(8, 'mundo', 'pt'), cand(9, 'dinheiro', 'pt'), cand(10, 'codigo'), cand(11, 'mundo', 'pt'), cand(12, 'codigo'), cand(13, 'potencializa'), cand(14, 'politica', 'pt'), cand(15, 'dinheiro', 'pt'), cand(16, 'codigo')]
  const judge: JudgeOutput = {
    opening: 'Bom dia. Desde ontem, muita IA.',
    closing: 'A coisa mais útil de hoje pra você é atualizar o VPN.',
    focusId: 'c7',
    market: 'O bitcoin caiu.',
    model: 'gpt-x',
    elapsedMs: 9000,
    items: cands.map((c) => ({
      id: c.id, keep: c.id !== 'c10', area: c.area, scores: scores(c.area, c.id === 'c7' ? 3 : 2), title: `PT ${c.id}`,
      summary: c.id !== 'c10' ? `Resumo ${c.id}.` : null, why: 'Porque sim.', action: null, narration: `Narração ${c.id}.`,
      reason: c.id === 'c10' ? 'raso demais' : null,
    })),
  }
  const e = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW - 24 * H, candidates: cands, judge, judgeNote: null, market: quotes, marketAt: null, stats })
  assert.equal(e.judge, 'codex')
  assert.ok(e.items.length <= MAX_ITEMS && e.items.length >= 10)
  assert.ok(e.items.filter((i) => i.area === 'ia').length <= MAX_PER_AREA)
  assert.equal(e.items.filter((i) => i.area === 'mundo').length, 1, 'mundo só um por dia')
  assert.equal(e.focusKey, cands[6].key)
  assert.equal(e.items[0].id, 'c7', 'o foco é o mais importante')
  for (let i = 1; i < e.items.length; i++) if (e.items[i].area === e.items[i - 1].area) assert.ok(e.items.slice(i).every((x) => x.area === e.items[i].area), 'só repete área quando não há outra')
  const iaCut = e.leftOut.find((x) => x.area === 'ia')!
  assert.equal(iaCut.reason, 'ficou de fora pela cota da área')
  assert.equal(e.leftOut.find((x) => x.id === 'c10')!.reason, 'raso demais')
  assert.equal(e.items.length + e.leftOut.length, cands.length)
  assert.equal(e.marketNarration, 'O bitcoin caiu.')
  const screens = screensOf(e, 'Em Fortaleza, 29 graus, céu limpo.')
  assert.deepEqual([screens[0].kind, screens[screens.length - 2].kind, screens[screens.length - 1].kind], ['opening', 'market', 'closing'])
  assert.equal(screens[0].narration, 'Bom dia. Em Fortaleza, 29 graus, céu limpo. Desde ontem, muita IA.')
  assert.ok(estimateSeconds(e) > 10)
})

test('juiz mantendo pouco: completa até 10 com descartados de nota alta', () => {
  const cands = Array.from({ length: 14 }, (_, i) => cand(i + 1, AREAS[i % 6]))
  const judge: JudgeOutput = {
    opening: null, closing: null, focusId: null, market: null, model: null, elapsedMs: 1,
    items: cands.map((c, i) => ({ id: c.id, keep: i < 3, area: c.area, scores: scores(c.area, i < 11 ? 2 : 0), title: `PT ${c.id}`, summary: null, why: null, action: null, narration: null, reason: 'x' })),
  }
  const e = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: cands, judge, judgeNote: null, market: [], marketAt: null, stats })
  assert.ok(e.items.length >= 10 && e.items.length <= MAX_ITEMS, String(e.items.length))
  const per = (k: string) => e.items.filter((i) => i.caderno === k).length
  assert.ok(per('investimentos') >= 3 && per('ia_dev') >= 3, 'cada caderno com pelo menos 3')
  assert.equal(per('politica'), 2, 'política só tinha 2 candidatos')
  assert.ok(/^Bom dia! Desde ontem, separei (dez|onze|doze|treze|quatorze|quinze) coisas/.test(e.opening), e.opening)
  assert.equal(e.cadernos!.investimentos.keys.length, per('investimentos'))
  assert.equal(e.cadernos!.investimentos.lead, e.cadernos!.investimentos.keys[0])
  assert.equal(e.marketNarration, null)
  assert.ok(screensOf(e).every((s) => s.kind !== 'market'))
  const en = e.items.find((i) => i.lang === 'en')!
  assert.equal(en.summary, '', 'trecho em inglês nunca aparece')
  assert.equal(en.narration, `${en.title}.`)
  assert.ok(e.items.every((i) => !!i.segue), 'toda notícia tem ponte')
})

test('cadernos: pelo menos 3 em cada, destaque do juiz quando é do caderno', () => {
  const cands = [
    ...Array.from({ length: 8 }, (_, i) => cand(i + 1, i % 2 ? 'ia' : 'codigo')),
    cand(9, 'dinheiro', 'pt'), cand(10, 'dinheiro', 'pt'), cand(11, 'dinheiro', 'pt'), cand(12, 'dinheiro', 'pt'),
    cand(13, 'politica', 'pt'), cand(14, 'politica', 'pt'), cand(15, 'mundo', 'pt'), cand(16, 'potencializa'),
  ]
  const keep = new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c16', 'c9', 'c13'])
  const judge: JudgeOutput = {
    opening: null, closing: null, focusId: 'c1', market: null, model: null, elapsedMs: 1,
    leads: { politica: 'c13', investimentos: 'c2', iaDev: 'c3' },
    items: cands.map((c) => ({ id: c.id, keep: keep.has(c.id), area: c.area, scores: scores(c.area, keep.has(c.id) ? 3 : 1), title: `PT ${c.id}`, summary: 'R.', why: 'P.', action: 'Faça.', narration: 'N.', reason: keep.has(c.id) ? null : 'x' })),
  }
  const e = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: cands, judge, judgeNote: null, market: [], marketAt: null, stats })
  const per = (k: string) => e.items.filter((i) => i.caderno === k).length
  assert.ok(per('politica') >= 3 && per('investimentos') >= 3 && per('ia_dev') >= 3, `${per('politica')} ${per('investimentos')} ${per('ia_dev')}`)
  assert.ok(e.items.length >= 10 && e.items.length <= MAX_ITEMS)
  assert.equal(e.items.filter((i) => i.area === 'mundo').length, 1)
  const key = (id: string) => cands.find((c) => c.id === id)!.key
  assert.equal(e.cadernos!.politica.lead, key('c13'))
  assert.equal(e.cadernos!.ia_dev.lead, key('c3'), 'destaque do juiz')
  assert.notEqual(e.cadernos!.investimentos.lead, key('c2'), 'destaque de outro caderno é ignorado')
  assert.ok(e.cadernos!.investimentos.keys.every((k) => e.items.find((i) => i.key === k)!.caderno === 'investimentos'))
  assert.deepEqual(new Set(Object.values(e.cadernos!).flatMap((c) => c.keys)).size, e.items.length)
})

test('roteiro do juiz: ordem, pontes e texto contínuo', () => {
  const cands = [cand(1, 'seguranca'), cand(2, 'ia'), cand(3, 'dinheiro', 'pt'), cand(4, 'mundo', 'pt'), cand(5, 'codigo'), cand(6, 'potencializa')]
  const judge: JudgeOutput = {
    opening: 'Bom dia! Hoje tem segurança e uma boa pra quem programa.', closing: 'Pra fechar: a coisa mais útil de hoje pra você é atualizar. Bom trabalho!',
    focusId: 'c1', market: 'Antes de fechar, uma olhada no mercado: o dólar subiu.', model: null, elapsedMs: 1,
    rundown: [{ id: 'c5', segue: 'Pra começar, uma pra quem programa:' }, { id: 'c1', segue: 'E falando em segurança,' }, { id: 'c2', segue: '' }, { id: 'zz', segue: 'x' }, { id: 'c4', segue: 'Lá fora:' }],
    items: cands.map((c) => ({ id: c.id, keep: true, area: c.area, scores: scores(c.area, 2), title: `PT ${c.id}`, summary: 'Resumo.', why: 'Porque.', action: null, narration: `Uma frase sobre ${c.id}.`, reason: null })),
  }
  const e = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: cands, judge, judgeNote: null, market: quotes, marketAt: null, stats })
  assert.equal(e.judge, 'codex')
  assert.deepEqual(e.items.slice(0, 4).map((i) => i.id), ['c5', 'c1', 'c2', 'c4'])
  assert.equal(e.items[0].segue, 'Pra começar, uma pra quem programa:')
  assert.equal(e.items[1].segue, 'E falando em segurança,')
  assert.ok(e.items[2].segue && e.items[2].segue !== '', 'ponte vazia vira ponte automática')
  assert.notEqual(e.items[3].segue, 'Lá fora:', 'ponte só vale se o anterior é o mesmo do roteiro')
  assert.deepEqual(e.items.slice(4).map((i) => i.id).sort(), ['c3', 'c6'])
  const screens = screensOf(e)
  assert.equal(narrationOf(screens[2], e), 'E falando em segurança, uma frase sobre c1.')
  assert.equal(e.script, 2)
  const p = buildProgram(e, 'Em Fortaleza, 29 graus, céu limpo.', 'pf_dora')
  assert.equal(p.chapters.length, screens.length)
  assert.ok(p.chapters.every((c) => c.count > 0))
  assert.equal(p.lines[0].text, 'Bom dia!')
  assert.equal(p.lines[1].text, 'Em Fortaleza, 29 graus, céu limpo.')
  assert.equal(p.lines[1].speech, 'Em Fortaleza, vinte e nove graus, céu limpo.')
  assert.equal(p.chapters[2].key, e.items[1].key)
  assert.equal(firstLineOf(p, 2), p.chapters[2].first)
  assert.equal(p.lines.at(-1)!.pause, 0)
  assert.ok(p.lines.filter((l) => l.chapter === 0).at(-1)!.pause > p.lines[0].pause)
  assert.equal(new Set(p.lines.map((l) => l.id)).size, p.lines.length)
  assert.notEqual(buildProgram(e, '', 'pf_dora').key, p.key)
  assert.equal(buildProgram(e, 'Em Fortaleza, 29 graus, céu limpo.', 'pf_dora').key, p.key)
})

test('fala: números, moedas, siglas e frases para o ouvido', () => {
  assert.equal(numberWords(2026), 'dois mil e vinte e seis')
  assert.equal(numberWords(1250), 'mil duzentos e cinquenta')
  assert.equal(numberWords(75904), 'setenta e cinco mil novecentos e quatro')
  assert.equal(numberWords(1_200_000), 'um milhão e duzentos mil')
  assert.equal(numberWords(2, true), 'duas')
  assert.equal(numberWords(221, true), 'duzentas e vinte e uma')
  assert.equal(toSpeech('O bitcoin caiu 5,9% em 24 h, a US$ 75.904.'), 'O bitcoin caiu cinco vírgula nove por cento em vinte e quatro horas, a setenta e cinco mil novecentos e quatro dólares.')
  assert.equal(toSpeech('O dólar fechou a R$ 5,50.'), 'O dólar fechou a cinco reais e cinquenta centavos.')
  assert.equal(toSpeech('Rodada de US$ 75 mil e outra de R$ 1,2 bilhão.'), 'Rodada de setenta e cinco mil dólares e outra de um vírgula dois bilhão de reais.')
  assert.equal(toSpeech('O GPT-6 chegou com uma API nova da OpenAI (e 2 falhas).'), 'O gê pê tê seis chegou com uma á pê i nova da Ópen ei ai, e duas falhas.')
  assert.equal(toSpeech('São 2 dias e 2 vulnerabilidades; 3x mais rápido.'), 'São dois dias e duas vulnerabilidades, três vezes mais rápido.')
  assert.equal(toSpeech('Às 10h30, 29 °C — céu limpo.'), 'Às dez e trinta, vinte e nove graus, céu limpo.')
  assert.equal(toSpeech('Selic em 15% e IPCA de 4,58%.'), 'Selic em quinze por cento e i pê cê á de quatro vírgula cinquenta e oito por cento.')
  assert.equal(toSpeech('Veja https://x.com/a agora.'), 'Veja agora.')
  assert.ok(!/[%$#*_/()]/.test(toSpeech('**IA** (nova) 50% R$ 3 #tag a/b')))
  assert.ok(toSpeech('A CVE-2026-1234 no iOS 26.1').includes('cê vê é dois mil e vinte e seis, um dois três quatro'))
  assert.ok(toSpeech('A CVE-2026-1234 no iOS 26.1').includes('ai ó és vinte e seis ponto um'))
  assert.deepEqual(splitSentences('Bom dia! Hoje tem segurança. O Sr. Silva disse que a versão 2.5 saiu. E agora? Fim…'), ['Bom dia!', 'Hoje tem segurança.', 'O Sr. Silva disse que a versão 2.5 saiu.', 'E agora?', 'Fim…'])
  const long = splitSentences(`${'palavra '.repeat(30)}, ${'outra '.repeat(30)}fim.`, 120)
  assert.ok(long.length > 1 && long.every((x) => x.length <= 120))
})

test('voz: fonemas no formato do Kokoro, silêncio aparado e velocidade sem mudar o tom', () => {
  assert.equal(ipaToKokoro('b_ˈo_ŋ dʒ_ˈi__æ\nt_ˈu_d_ʊ b_ˈeɪ_ŋ\n'), 'bˈoŋ ʤˈiæ tˈudʊ bˈAŋ')
  assert.equal(ipaToKokoro('n_ˌo_tʃ_ˈi_s_j_æ s_ˈeɪ_s'), 'nˌoʧˈisjæ sˈAs')
  const calls: string[] = []
  const ph = phonemize('Bom dia, tudo bem? Sim.', (c) => (calls.push(c), 'x_a'))
  assert.deepEqual(calls, ['Bom dia', 'tudo bem', 'Sim'])
  assert.equal(ph, 'xa, xa? xa.')
  const sr = 24000
  const pcm = new Float32Array(sr)
  for (let i = 6000; i < 18000; i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr)
  const t = trimSilence(pcm, sr)
  assert.ok(t.length < 14000 && t.length > 12000)
  const tone = new Float32Array(sr)
  for (let i = 0; i < sr; i++) tone[i] = 0.4 * Math.sin((2 * Math.PI * 200 * i) / sr)
  const fast = stretch(tone, sr, 1.3)
  assert.ok(Math.abs(fast.length - sr / 1.3) < sr * 0.04, `duração ${fast.length}`)
  let crossings = 0
  for (let i = 2000; i < fast.length - 2000; i++) if (fast[i - 1] < 0 && fast[i] >= 0) crossings++
  const hz = crossings / ((fast.length - 4000) / sr)
  assert.ok(Math.abs(hz - 200) < 8, `tom preservado: ${hz} Hz`)
  assert.equal(stretch(tone, sr, 1), tone)
  assert.ok(Math.abs(stretch(tone, sr, 0.9).length - sr / 0.9) < sr * 0.04)
})

test('português sempre: tradução, inglês escondido e resumo limpo', () => {
  const cands = [cand(1, 'ia', 'en', 9), cand(2, 'seguranca', 'en', 8), cand(3, 'mundo', 'pt', 5)]
  const r = applyTranslations(cands, null, [{ id: 'c1', title: 'Modelo novo da OpenAI', summary: 'Saiu hoje.' }])
  assert.equal(r.hidden, 1)
  assert.deepEqual(r.candidates.map((c) => [c.id, c.lang, c.title]), [['c1', 'pt', 'Modelo novo da OpenAI'], ['c3', 'pt', cands[2].title]])
  assert.equal(r.originals.get('c1'), cands[0].title)
  const judged: JudgeOutput = { opening: null, closing: null, focusId: null, market: null, model: null, elapsedMs: 1, items: [{ id: 'c2', keep: true, area: 'seguranca', scores: scores('seguranca', 2), title: 'Falha', summary: null, why: null, action: null, narration: null, reason: null }] }
  assert.equal(applyTranslations(cands, judged, []).hidden, 1, 'o que o juiz leu não precisa de tradução')
  assert.equal(cleanExcerpt('Banco Central sobe juros. O comitê decidiu por unanimidade. Leia mais', 'Banco Central sobe juros'), 'Banco Central sobe juros. O comitê decidiu por unanimidade.')
  assert.equal(cleanExcerpt('Uma frase completa aqui. E outra que ficou cortada no…', 'X'), 'Uma frase completa aqui.')
  assert.equal(cleanExcerpt('Título igual', 'Título igual'), '')
  assert.equal(cleanExcerpt('O post Algo apareceu primeiro em Site.', 'X'), '')
  const used = new Set<string>()
  const s = [autoSegue(0, 5, 'ia', null, used), autoSegue(1, 5, 'seguranca', 'ia', used), autoSegue(2, 5, 'seguranca', 'seguranca', used), autoSegue(3, 5, 'seguranca', 'seguranca', used), autoSegue(4, 5, 'mundo', 'seguranca', used)]
  assert.equal(s[0], 'Pra começar, inteligência artificial.')
  assert.equal(new Set(s).size, 5, 'sem repetir ponte')
  assert.ok(s[4].startsWith('E pra fechar os destaques'))
  assert.equal(localModelLabel('gemma4:e2b'), 'Gemma 4 E2B')
  assert.equal(localModelLabel('gemma4:12b'), 'Gemma 4 12B')
})

test('sem o juiz: edição determinística, nunca vazia, português na frente', () => {
  const cands = [cand(1, 'ia', 'en', 9), cand(2, 'ia', 'pt', 8.5), cand(3, 'mundo', 'pt', 5), cand(4, 'seguranca', 'en', 7)]
  const e = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: cands, judge: null, judgeNote: 'o Codex não foi encontrado', market: quotes, marketAt: null, stats })
  assert.equal(e.judge, 'fallback')
  assert.equal(e.items.length, 2, 'sem juiz e sem tradutor, inglês fica de fora')
  assert.equal(e.hiddenEnglish, 2)
  assert.ok(e.judgeNote!.startsWith('o Codex não foi encontrado; 2 notícias em inglês ficaram de fora'), e.judgeNote!)
  assert.ok(e.items.every((i) => i.lang === 'pt'))
  assert.ok(e.opening.startsWith('Bom dia! Desde ontem, separei duas coisas que importam pra você: uma de IA e uma do mundo'), e.opening)
  assert.ok(e.closing.startsWith('Pra fechar: a coisa mais útil de hoje pra você é'))
  assert.ok(e.marketNarration!.startsWith('Antes de fechar, uma olhada rápida no mercado: '), e.marketNarration!)
  assert.equal(e.items[0].summary, 'Trecho 2. Segunda frase. Terceira.')
  assert.equal(e.items[0].narration, `${cands[1].title}. Trecho 2. Segunda frase.`)
  assert.equal(e.items[0].segue, 'Pra começar, inteligência artificial.')
  assert.equal(e.focusKey, cands[1].key, 'o foco sem juiz prefere português')
  const many = [cand(11, 'ia', 'pt', 9.9), cand(12, 'ia', 'pt', 9.8), cand(13, 'ia', 'pt', 9.7), cand(14, 'ia', 'pt', 9.6), cand(15, 'codigo', 'pt', 2)]
  many[1].title = 'GPT Cyber model breaks systems'
  many[2].title = 'Introducing GPT Cyber for defenders'
  const fe = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: many, judge: null, judgeNote: null, market: [], marketAt: null, stats })
  assert.ok(fe.items.some((i) => i.area === 'codigo'), 'código entra mesmo com nota baixa')
  assert.ok(!(fe.items.some((i) => i.id === 'c12') && fe.items.some((i) => i.id === 'c13')), 'mesma história não entra duas vezes')
  const empty = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: [], judge: null, judgeNote: null, market: [], marketAt: null, stats })
  assert.ok(empty.opening.includes('nada passou'))
  assert.equal(screensOf(empty).length, 2)
})

test('frases: não corta em números com ponto', () => {
  assert.equal(firstSentences('Gemini 1.2 Flash custa US$ 0.07 por segundo. Segunda frase aqui. Terceira.', 2), 'Gemini 1.2 Flash custa US$ 0.07 por segundo. Segunda frase aqui.')
})

test('utilidades', () => {
  assert.deepEqual(interleave([{ area: 'ia' as Area }, { area: 'ia' as Area }, { area: 'mundo' as Area }]).map((x) => x.area), ['ia', 'mundo', 'ia'])
  assert.equal(withWeather('Sem pontuação', 'Chove.'), 'Chove. Sem pontuação')
  const p = normalizeProfile({ areas: [{ id: 'ia', enabled: false, weight: 5, note: 'x' }] as never, voice: { rate: 200 } as never })
  assert.equal(p.areas.length, 7)
  assert.equal(p.areas.find((a) => a.id === 'ia')!.weight, 1)
  assert.equal(p.areas.find((a) => a.id === 'ia')!.enabled, false)
  assert.equal(p.voice.voice, 'pf_dora')
  assert.equal(p.voice.rate, 200)
  assert.equal(p.voice.jarvis, false)
  const old = normalizeProfile({ voice: { voice: 'Luciana', rate: 212, jarvis: true } })
  assert.deepEqual(old.voice, { voice: 'pf_dora', rate: 212, jarvis: false })
  assert.equal(old.translateModel, 'gemma4:e2b')
  assert.equal(old.embedModel, 'embeddinggemma')
  assert.equal(old.localAi, true)
})

test('edição salva: inglês detectado some ou é traduzido, roteiro antigo é atualizado', () => {
  assert.ok(looksEnglish("OpenAI's GPT-6 Cyber can both break into systems and propose how to fix them"))
  assert.ok(looksEnglish('The new model is available for developers'))
  assert.ok(!looksEnglish('Petróleo opera abaixo de US$ 100 após revés de Trump'))
  assert.ok(!looksEnglish('Ibovespa perde os 167 mil pontos e fecha em queda'))
  assert.ok(!looksEnglish('React 20'))
  const cands = [cand(1, 'ia', 'en', 9), cand(2, 'mundo', 'pt', 8), cand(3, 'dinheiro', 'pt', 7)]
  const raw = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: cands, judge: null, judgeNote: null, market: [], marketAt: null, stats })
  const legacy = { ...raw, script: undefined, hiddenEnglish: 0, items: [...raw.items, { ...raw.items[0], key: 'en1', id: 'c9', title: 'The new model is available for developers', lang: 'en' as const, segue: undefined }] }
  legacy.items[0] = { ...legacy.items[0], summary: 'Foto de capa Jornal Nacional/ Reprodução Os preços caíram ontem. O resto.', segue: undefined }
  const { edition, english } = sanitizeEdition(legacy)
  assert.equal(english.length, 1)
  assert.equal(edition.items.length, 2)
  assert.equal(edition.hiddenEnglish, 1)
  assert.equal(edition.script, 2)
  assert.ok(edition.items.every((i) => !!i.segue))
  assert.equal(edition.items[0].summary, 'Os preços caíram ontem. O resto.')
  assert.ok(edition.opening.includes('duas coisas'))
  const back = withTranslations(edition, english, [{ id: 'c9', title: 'O modelo novo está disponível para desenvolvedores', summary: null }])
  assert.equal(back.items.length, 3)
  assert.equal(back.items[2].lang, 'pt')
  assert.equal(back.hiddenEnglish, 0)
  assert.ok(back.opening.includes('três coisas'))
  assert.equal(withTranslations(edition, english, [{ id: 'c9', title: 'Still English for the users of this', summary: null }]), edition)
  assert.equal(sanitizeEdition(edition).edition, edition, 'edição limpa não muda')
})

test('avaliação do dia: mesmos ajustes do Rust, reversíveis, e pergunta sem insistir', () => {
  const plan = planAdjustments({ rating: 'fraco', reasons: ['faltou_dinheiro', 'muito_mundo', 'muito_raso', 'fontes_ruins'], moreAreas: ['dinheiro', 'codigo'] })
  const d = (k: string) => plan.find((a) => a.key === k)?.delta
  assert.deepEqual([d('dinheiro'), d('codigo'), d('mundo'), d('depth')], [0.2, 0.1, -0.1, 1])
  assert.ok(plan.every((a) => a.label))
  assert.deepEqual(planAdjustments({ rating: 'otimo', reasons: ['muito_raso'], moreAreas: ['ia'] }), [])
  const p0 = defaultProfile()
  const { profile: p1, applied } = applyAdjustments(p0, plan, 1)
  assert.equal(p1.areas.find((a) => a.id === 'dinheiro')!.weight, 1.2)
  assert.equal(p1.tuning.depth, 1)
  assert.deepEqual(applyAdjustments(p1, applied, -1).profile, p0)
  assert.equal(historyLine([]), 'Nenhuma avaliação nos últimos 7 dias.')
  const r = (rating: 'otimo' | 'ok' | 'fraco') => ({ editionDate: '2026-11-06', rating, reasons: [], moreAreas: [], note: null, adjustments: [], undone: false, updatedAt: '' })
  assert.equal(historyLine([r('otimo'), r('otimo'), r('ok'), r('fraco')]), 'Últimos 4 briefings: 2 ótimos, 1 ok, 1 fraco.')
  assert.ok(!shouldAsk({ rated: false, dismissed: false, votes: 0, finished: false, progress: 0.1 }), 'não pergunta antes de ele ver')
  assert.ok(shouldAsk({ rated: false, dismissed: false, votes: 2, finished: false, progress: 0 }))
  assert.ok(shouldAsk({ rated: false, dismissed: false, votes: 0, finished: true, progress: 0 }))
  assert.ok(!shouldAsk({ rated: false, dismissed: true, votes: 5, finished: true, progress: 1 }), 'dispensou, não insiste')
  assert.ok(!shouldAsk({ rated: true, dismissed: false, votes: 5, finished: true, progress: 1 }), 'uma vez por dia')
})

test('gosto pessoal: reordena candidatos e explica pelo item curtido mais parecido', () => {
  const cs = [cand(1, 'mundo', 'pt', 9), cand(2, 'codigo', 'pt', 8), cand(3, 'dinheiro', 'pt', 7)]
  const out = applyTaste(cs, [{ id: 'c1', score: -0.4, z: -1.5, near: null, nearSim: null }, { id: 'c3', score: 0.5, z: 1.4, near: null, nearSim: null }])
  assert.deepEqual(out.map((c) => c.id), ['c3', 'c2', 'c1'])
  assert.equal(cs[0].score, 9, 'não muda a lista original')
  const e = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: out, judge: null, judgeNote: null, market: [], marketAt: null, stats })
  explainByTaste(e.items, [{ id: 'c3', score: 0.5, z: 1.4, near: 'Tesouro Selic rende mais em novembro', nearSim: 0.81 }, { id: 'c2', score: 0, z: 0, near: 'Algo distante', nearSim: 0.4 }])
  assert.equal(e.items.find((i) => i.id === 'c3')!.why, 'Parecido com “Tesouro Selic rende mais em novembro”, que você curtiu.')
  assert.ok(!e.items.find((i) => i.id === 'c2')!.why.startsWith('Parecido'))
})

console.log(`✓ ${passed} testes do briefing passaram`)
