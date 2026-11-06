import {
  CATEGORY_POINTS, HIGHLIGHT_MIN, LOW_RELEVANCE, classify, compileKeywords, dismissAdjustments, isLow, matchKeywords,
  pickHighlights, recencyPoints, releaseInfo, scoreAll, scoreItem, type KeywordLite, type ScoreInput, type SourceLite,
} from './relevance.ts'
import { SEED_KEYWORDS } from './seed.ts'

type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void
  deepEqual(actual: unknown, expected: unknown, message?: string): void
  ok(value: unknown, message?: string): void
  throws(fn: () => unknown, expected?: RegExp, message?: string): void
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

const NOW = Date.parse('2026-11-05T22:00:00.000Z')
const H = 36e5

let n = 0
const kw = (term: string, weight: number, category: KeywordLite['category'] = null, kind: KeywordLite['kind'] = 'boost'): KeywordLite => ({
  id: `k${++n}`, term, weight, category, kind,
})
const SEED: KeywordLite[] = Object.entries(SEED_KEYWORDS).flatMap(([g, list]) =>
  list.map(([term, weight]) => kw(term, weight, g === 'ai_dev' || g === 'ai_content' || g === 'stack' ? g : null, g === 'mute' ? 'mute' : 'boost')),
)
const src = (id: string, category: SourceLite['category'], weight = 1, url = `https://${id}.example/feed`): SourceLite => ({ id, name: id, url, category, weight })
const item = (id: string, title: string, opts: Partial<ScoreInput> & { hoursAgo?: number } = {}): ScoreInput => ({
  id, title, excerpt: opts.excerpt ?? '', sourceId: opts.sourceId ?? 's', fetchedAt: new Date(NOW).toISOString(),
  publishedAt: new Date(NOW - (opts.hoursAgo ?? 2) * H).toISOString(),
})
const sum = (parts: { value: number }[]) => Math.round(parts.reduce((s, p) => s + p.value, 0) * 10) / 10

test('palavra inteira com plural; * é prefixo; acentos não importam', () => {
  const c = compileKeywords([kw('ide', 1), kw('cli', 1), kw('agent*', 2), kw('api', 1), kw('video*', 1), kw('three.js', 1), kw('fine-tun*', 1)])
  const terms = (t: string) => matchKeywords(t, '', c).map((m) => m.keyword.term).sort()
  assert.deepEqual(terms('Ideas to click on'), [])
  assert.deepEqual(terms('New IDE and CLI for agents'), ['agent*', 'cli', 'ide'])
  assert.deepEqual(terms('Agentic workflows via APIs'), ['agent*', 'api'])
  assert.deepEqual(terms('Edição de vídeos com IA'), ['video*'])
  assert.deepEqual(terms('three.js r187 released.'), ['three.js'])
  assert.deepEqual(terms('Fine-tuning small models'), ['fine-tun*'])
})

test('título vale o peso cheio, trecho vale metade; termo contido noutro conta uma vez', () => {
  const c = compileKeywords([kw('claude', 1.5), kw('claude code', 3), kw('mcp', 2)])
  const m = matchKeywords('Claude Code adds hooks', 'Now with MCP servers', c)
  assert.deepEqual(m.map((x) => [x.keyword.term, x.where, x.points]), [['claude code', 'title', 3], ['mcp', 'excerpt', 1]])
})

test('classificação: votos das palavras + voto da fonte; automática sem votos vira Geral', () => {
  const c = compileKeywords(SEED)
  const cat = (title: string, excerpt: string, sc: SourceLite['category']) => classify(matchKeywords(title, excerpt, c), sc)
  assert.equal(cat('Gemini Omni 1.2 Flash: longer video clips', '', 'auto'), 'ai_content')
  assert.equal(cat('GPT‑6 Cyber: aligned cybersecurity agents', '', 'auto'), 'ai_dev')
  assert.equal(cat('Setting a new standard for responsible AI infrastructure', '', 'auto'), 'other')
  assert.equal(cat('Copilot coding agent now in GitHub Actions', '', 'stack'), 'ai_dev', 'palavras fortes vencem a fonte')
  assert.equal(cat('vite v8.3.6', '', 'stack'), 'stack')
  assert.equal(cat('Tudo certo por aqui', '', 'ai_content'), 'ai_content', 'sem votos, fica a categoria da fonte')
  assert.equal(classify([], 'auto'), 'other')
  const tie = compileKeywords([kw('alpha', 1, 'stack'), kw('beta', 1, 'ai_dev')])
  assert.equal(classify(matchKeywords('alpha beta', '', tie), 'auto'), 'ai_dev')
})

test('versões de releases do GitHub', () => {
  const vite = 'https://github.com/vitejs/vite/releases.atom'
  assert.deepEqual(releaseInfo('vite v8.0.0', vite), { kind: 'major', secondary: null })
  assert.deepEqual(releaseInfo('vite v8.3.0', vite), { kind: 'minor', secondary: null })
  assert.deepEqual(releaseInfo('vite v8.3.6', vite), { kind: 'patch', secondary: null })
  assert.deepEqual(releaseInfo('plugin-legacy@8.2.4', vite), { kind: 'patch', secondary: 'plugin-legacy' })
  assert.deepEqual(releaseInfo('codex 0.168.0-alpha.7', 'https://github.com/openai/codex/releases.atom'), { kind: 'pre', secondary: null })
  assert.deepEqual(releaseInfo('tauri-macros v2.7.4', 'https://github.com/tauri-apps/tauri/releases.atom'), { kind: 'patch', secondary: 'tauri-macros' })
  assert.deepEqual(releaseInfo('react 19.3.1 (October 14th, 2026)', 'https://github.com/facebook/react/releases.atom'), { kind: 'patch', secondary: null })
  assert.deepEqual(releaseInfo('three.js r187', 'https://github.com/mrdoob/three.js/tags.atom'), { kind: 'minor', secondary: null })
  assert.deepEqual(releaseInfo('TypeScript 7.0 RC', 'https://github.com/microsoft/TypeScript/releases.atom'), { kind: 'pre', secondary: null })
  assert.deepEqual(releaseInfo('Gemini 3.5 Pro Preview', 'https://deepmind.google/blog/rss.xml'), { kind: null, secondary: null }, 'blogs não têm regra de versão')
})

test('recência decai suave: +1,5 agora, ~+0,5 em 1,5 dia, −0,4 numa semana', () => {
  assert.equal(recencyPoints(0), 1.5)
  assert.equal(recencyPoints(36 * H), 0.5)
  assert.equal(recencyPoints(7 * 24 * H), -0.4)
  assert.ok(recencyPoints(H) > recencyPoints(10 * H))
})

test('a soma das partes é a pontuação, e IA dev > IA conteúdo > Stacks', () => {
  const c = compileKeywords([])
  const s = (cat: SourceLite['category']) => scoreItem(item('x', 'Algo novo'), src('s', cat), c, NOW)
  const [dev, content, stack] = [s('ai_dev'), s('ai_content'), s('stack')]
  for (const r of [dev, content, stack]) assert.equal(r.score, sum(r.parts))
  assert.ok(dev.score > content.score && content.score > stack.score)
  assert.equal(Math.round((dev.score - stack.score) * 10) / 10, CATEGORY_POINTS.ai_dev - CATEGORY_POINTS.stack)
})

test('penalizações (vagas, eventos, institucional) derrubam o item', () => {
  const c = compileKeywords(SEED)
  const s = src('openai', 'auto')
  const good = scoreItem(item('a', 'Introducing the Codex SDK for coding agents'), s, c, NOW)
  const job = scoreItem(item('b', 'We are hiring: careers in AI agents'), s, c, NOW)
  const inst = scoreItem(item('c', 'Setting a new policy blueprint for the economy'), s, c, NOW)
  assert.ok(good.score >= HIGHLIGHT_MIN, `bom: ${good.score}`)
  assert.ok(isLow(job), `vaga: ${job.score}`)
  assert.ok(isLow(inst), `institucional: ${inst.score}`)
  assert.ok(job.parts.some((p) => p.kind === 'mute' && p.value < 0))
})

test('teto de palavras-chave aparece como linha explicada', () => {
  const c = compileKeywords([kw('a1', 3), kw('a2', 3), kw('a3', 3)])
  const r = scoreItem(item('x', 'a1 a2 a3'), src('s', 'ai_dev'), c, NOW)
  const cap = r.parts.find((p) => p.kind === 'cap')!
  assert.equal(cap.value, -3)
  assert.equal(r.score, sum(r.parts))
})

test('peso da fonte é explicável: (peso − 1) × 2,5', () => {
  const c = compileKeywords([])
  const base = scoreItem(item('x', 'Algo'), src('s', 'stack', 1), c, NOW)
  const low = scoreItem(item('x', 'Algo'), src('s', 'stack', 0.6), c, NOW)
  assert.equal(base.parts.find((p) => p.kind === 'source'), undefined)
  assert.equal(low.parts.find((p) => p.kind === 'source')!.value, -1)
  assert.equal(Math.round((base.score - low.score) * 10) / 10, 1)
})

test('repetição: releases antigas da mesma fonte perdem pontos; a mais nova não', () => {
  const s = src('cc', 'ai_dev', 1, 'https://github.com/anthropics/claude-code/releases.atom')
  const items = [0, 1, 2, 3].map((d) => item(`v${d}`, `claude-code v2.1.${318 - d}`, { sourceId: 'cc', hoursAgo: 2 + d * 24 }))
  const scored = scoreAll(items, new Map([['cc', s]]), SEED, NOW)
  const series = (id: string) => scored.get(id)!.parts.find((p) => p.kind === 'series')?.value ?? 0
  assert.deepEqual(['v0', 'v1', 'v2', 'v3'].map(series), [0, -0.6, -1.2, -1.8])
  const blog = src('hn', 'auto')
  const posts = [0, 1, 2].map((i) => item(`p${i}`, `Post ${i} sobre rust`, { sourceId: 'hn', hoursAgo: 1 + i }))
  const sb = scoreAll(posts, new Map([['hn', blog]]), SEED, NOW)
  assert.equal(sb.get('p2')!.parts.find((p) => p.kind === 'series')!.value, -0.2)
})

test('pacotes secundários e pré-lançamentos ficam em pouca relevância', () => {
  const vite = src('vite', 'stack', 1, 'https://github.com/vitejs/vite/releases.atom')
  const codex = src('codex', 'ai_dev', 1, 'https://github.com/openai/codex/releases.atom')
  const c = compileKeywords(SEED)
  const main = scoreItem(item('a', 'vite v8.3.6', { sourceId: 'vite' }), vite, c, NOW)
  const plugin = scoreItem(item('b', 'plugin-legacy@8.2.4', { sourceId: 'vite' }), vite, c, NOW)
  const alpha = scoreItem(item('c', 'codex 0.168.0-alpha.7', { sourceId: 'codex' }), codex, c, NOW)
  const stable = scoreItem(item('d', 'codex 0.167.0', { sourceId: 'codex' }), codex, c, NOW)
  assert.ok(!isLow(main) && isLow(plugin), `${main.score} vs ${plugin.score}`)
  const noisy = scoreItem(item('e', 'vite v8.3.7', { sourceId: 'vite', excerpt: 'typescript rolldown css' }), vite, c, NOW)
  assert.ok(!noisy.parts.some((p) => p.label.includes('no trecho')))
  const queue = scoreAll([item('m', 'vite v8.3.6', { sourceId: 'vite', hoursAgo: 5 }), item('p', 'create-vite@9.3.4', { sourceId: 'vite', hoursAgo: 1 })], new Map([['vite', vite]]), SEED, NOW)
  assert.equal(queue.get('m')!.parts.find((p) => p.kind === 'series'), undefined)
  assert.ok(stable.score - alpha.score >= 2.4, `${stable.score} vs ${alpha.score}`)
})

test('destaques: até 5, um por fonte, só acima do mínimo, sem lidos', () => {
  const items = [
    { id: 'a1', sourceId: 'a', sourceName: 'A', read: false, score: 9 },
    { id: 'a2', sourceId: 'a', sourceName: 'A', read: false, score: 8.5 },
    { id: 'b1', sourceId: 'b', sourceName: 'B', read: true, score: 8 },
    { id: 'c1', sourceId: 'c', sourceName: 'C', read: false, score: 7 },
    { id: 'd1', sourceId: 'd', sourceName: 'D', read: false, score: 6 },
    { id: 'e1', sourceId: 'e', sourceName: 'E', read: false, score: 5.6 },
    { id: 'f1', sourceId: 'f', sourceName: 'F', read: false, score: 5.5 },
    { id: 'g1', sourceId: 'g', sourceName: 'G', read: false, score: 9.5 },
    { id: 'h1', sourceId: 'h', sourceName: 'H', read: false, score: 3 },
  ]
  const scored = new Map(items.map((i) => [i.id, { score: i.score, category: 'ai_dev' as const, parts: [], matched: [] }]))
  const h = pickHighlights(items, scored, (i) => !i.read)
  assert.deepEqual(h.map((i) => i.id), ['g1', 'a1', 'c1', 'd1', 'e1'])
  assert.ok(LOW_RELEVANCE < HIGHLIGHT_MIN)
})

test('"não me interessa" reduz um pouco a fonte e as palavras do título, com limite', () => {
  const c = compileKeywords([kw('agent*', 2, 'ai_dev'), kw('sdk', 2, 'ai_dev'), kw('cli', 1, 'ai_dev'), kw('rust', 2, 'stack')])
  const s = src('s', 'ai_dev', 1)
  const r = scoreItem(item('x', 'New agents SDK and CLI', { excerpt: 'written in rust' }), s, c, NOW)
  const adj = dismissAdjustments(r, s)
  assert.deepEqual(adj.source, { id: 's', from: 1, to: 0.9 })
  assert.deepEqual(adj.keywords.map((k) => [k.term, k.from, k.to]), [['agent*', 2, 1.75], ['sdk', 2, 1.75]], 'só as duas mais fortes do título')
  const floor = dismissAdjustments(r, { ...s, weight: 0.2 })
  assert.equal(floor.source, null, 'não desce abaixo do mínimo')
})

console.log(`relevance.test.ts: ${passed} testes ok`)
