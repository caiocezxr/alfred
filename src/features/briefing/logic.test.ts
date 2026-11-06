import { assemble, estimateSeconds, firstSentences, interleave, screensOf, withWeather, MAX_ITEMS, MAX_PER_AREA } from './assemble.ts'
import { learn, signalVector, termsOf } from './learn.ts'
import { direction, fmtChange, fmtValue, marketFacts, marketNarrationFallback } from './market.ts'
import { defaultProfile, normalizeProfile } from './profile.ts'
import { classifyArea, isGossip, quotas, sameStory, sieve, unwrapRedirect, windowStart, type Candidate, type Entry } from './sieve.ts'
import { AREAS, type Area, type Feedback, type JudgeOutput, type Quote } from './types.ts'

type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void
  deepEqual(actual: unknown, expected: unknown, message?: string): void
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
  const cands = [...Array.from({ length: 6 }, (_, i) => cand(i + 1, 'ia')), cand(7, 'seguranca'), cand(8, 'mundo', 'pt'), cand(9, 'dinheiro', 'pt'), cand(10, 'codigo')]
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
  assert.ok(e.items.length <= MAX_ITEMS && e.items.length >= 6)
  assert.ok(e.items.filter((i) => i.area === 'ia').length <= MAX_PER_AREA)
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

test('juiz mantendo pouco: completa até 6 com descartados de nota alta', () => {
  const cands = Array.from({ length: 10 }, (_, i) => cand(i + 1, AREAS[i % 6]))
  const judge: JudgeOutput = {
    opening: null, closing: null, focusId: null, market: null, model: null, elapsedMs: 1,
    items: cands.map((c, i) => ({ id: c.id, keep: i < 3, area: c.area, scores: scores(c.area, i < 8 ? 2 : 0), title: `PT ${c.id}`, summary: null, why: null, action: null, narration: null, reason: 'x' })),
  }
  const e = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: cands, judge, judgeNote: null, market: [], marketAt: null, stats })
  assert.equal(e.items.length, 6)
  assert.ok(e.opening.startsWith('Bom dia. Desde ontem, separei seis coisas'))
  assert.equal(e.marketNarration, null)
  assert.ok(screensOf(e).every((s) => s.kind !== 'market'))
  const en = e.items.find((i) => i.lang === 'en')!
  assert.equal(en.summary, '')
  assert.ok(en.narration.endsWith(`${en.title}.`) && en.narration.includes(`no ${en.source}`))
})

test('sem o juiz: edição determinística, nunca vazia, português na frente', () => {
  const cands = [cand(1, 'ia', 'en', 9), cand(2, 'ia', 'pt', 8.5), cand(3, 'mundo', 'pt', 5), cand(4, 'seguranca', 'en', 7)]
  const e = assemble({ date: '2026-11-06', now: NOW, windowFrom: NOW, candidates: cands, judge: null, judgeNote: 'o Codex não foi encontrado', market: quotes, marketAt: null, stats })
  assert.equal(e.judge, 'fallback')
  assert.equal(e.judgeNote, 'o Codex não foi encontrado')
  assert.equal(e.items.length, 4)
  assert.ok(e.opening.startsWith('Bom dia. Desde ontem, separei quatro coisas que importam pra você: duas de IA'), e.opening)
  assert.ok(e.closing.startsWith('A coisa mais útil de hoje pra você é'))
  assert.ok(e.marketNarration!.startsWith('No mercado'))
  assert.equal(e.items[0].summary, 'Trecho 2. Segunda frase. Terceira.')
  assert.ok(e.items.find((i) => i.id === 'c1')!.narration === `Em IA, no ${cands[0].sourceName}: ${cands[0].title}.`, 'inglês sem juiz: só fonte e título')
  assert.equal(e.focusKey, cands[1].key, 'o foco sem juiz prefere português')
  const many = [cand(11, 'ia', 'en', 9.9), cand(12, 'ia', 'en', 9.8), cand(13, 'ia', 'en', 9.7), cand(14, 'ia', 'en', 9.6), cand(15, 'codigo', 'en', 2)]
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
  assert.equal(p.areas.length, 6)
  assert.equal(p.areas.find((a) => a.id === 'ia')!.weight, 1)
  assert.equal(p.areas.find((a) => a.id === 'ia')!.enabled, false)
  assert.equal(p.voice.voice, 'Luciana')
  assert.equal(p.voice.rate, 200)
})

console.log(`✓ ${passed} testes do briefing passaram`)
