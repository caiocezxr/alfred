import { countWords, docToMarkdown, docToPlainText, escapeText, type JSONNode } from './markdown.ts'
import { HIT_END, HIT_START, makeSnippet, markTerms, matchesAll, normalize, relativeTime, safeFileName, searchTerms, sniffImage, splitHits } from './text.ts'
type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void
  deepEqual(actual: unknown, expected: unknown, message?: string): void
  ok(value: unknown, message?: string): void
  match(value: string, re: RegExp, message?: string): void
}
const nodeAssert = 'node:assert/strict'
const assert = ((await import(nodeAssert)) as { default: Assert }).default

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

const t = (text: string, ...marks: (string | { type: string; attrs?: Record<string, unknown> })[]): JSONNode => ({
  type: 'text',
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}),
})
const p = (...content: JSONNode[]): JSONNode => ({ type: 'paragraph', ...(content.length ? { content } : {}) })
const h = (level: number, text: string): JSONNode => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const li = (...content: JSONNode[]): JSONNode => ({ type: 'listItem', content })
const doc = (...content: JSONNode[]): JSONNode => ({ type: 'doc', content })
const link = (href: string) => ({ type: 'link', attrs: { href } })

test('título e blocos básicos', () => {
  const d = doc(h(1, 'Plano'), p(t('Primeiro parágrafo.')), h(2, 'Etapas'), h(3, 'Detalhe'), { type: 'horizontalRule' }, p(t('Fim')))
  assert.equal(
    docToMarkdown(d, { title: 'Minha nota' }),
    '# Minha nota\n\n# Plano\n\nPrimeiro parágrafo.\n\n## Etapas\n\n### Detalhe\n\n---\n\nFim\n',
  )
})

test('documento vazio', () => {
  assert.equal(docToMarkdown(doc(p())), '')
  assert.equal(docToMarkdown({ type: 'doc' }), '')
  assert.equal(docToPlainText(doc(p())), '')
})

test('marcas aninhadas e vizinhas', () => {
  const d = doc(p(t('a '), t('negrito', 'bold'), t(' e '), t('ambos', 'bold', 'italic'), t(' só itálico', 'italic'), t('.')))
  assert.equal(docToMarkdown(d), 'a **negrito** e ***ambos*** *só itálico*.\n')
  const d2 = doc(p(t('forte ', 'bold'), t('mais', 'bold', 'italic'), t(' forte', 'bold')))
  assert.equal(docToMarkdown(d2), '**forte *mais* forte**\n')
})

test('espaços ficam fora dos delimitadores', () => {
  const d = doc(p(t('x'), t(' negrito ', 'bold'), t('y')))
  assert.equal(docToMarkdown(d), 'x **negrito** y\n')
})

test('tachado, código e link', () => {
  const d = doc(p(t('velho', 'strike'), t(' use '), t('npm run app', 'code'), t(' e veja '), t('o site', link('https://exemplo.com/a b(c)'))))
  assert.equal(docToMarkdown(d), '~~velho~~ use `npm run app` e veja [o site](https://exemplo.com/a%20b%28c%29)\n')
})

test('código com crase e código em negrito', () => {
  assert.equal(docToMarkdown(doc(p(t('a`b', 'code')))), '`` a`b ``\n')
  assert.equal(docToMarkdown(doc(p(t('x', 'bold', 'code'), t('y', 'code')))), '**`x`**`y`\n')
  assert.equal(docToMarkdown(doc(p(t('ab', 'code'), t('cd', 'code')))), '`abcd`\n')
})

test('link com negrito dentro', () => {
  const d = doc(p(t('Veja '), t('isto', link('https://a.com')), t(' aqui', link('https://a.com'), 'bold')))
  assert.equal(docToMarkdown(d), 'Veja [isto **aqui**](https://a.com)\n')
})

test('escapa marcação literal', () => {
  assert.equal(escapeText('2 * 3 = [x] `y` <b> ~z~ \\'), '2 \\* 3 = \\[x\\] \\`y\\` \\<b> \\~z\\~ \\\\')
  assert.equal(escapeText('snake_case _ênfase_'), 'snake_case \\_ênfase\\_')
  assert.equal(docToMarkdown(doc(p(t('# não é título')))), '\\# não é título\n')
  assert.equal(docToMarkdown(doc(p(t('1. não é lista')))), '1\\. não é lista\n')
  assert.equal(docToMarkdown(doc(p(t('- nem isto')))), '\\- nem isto\n')
  assert.equal(docToMarkdown(doc(p(t('> nem citação')))), '\\> nem citação\n')
})

test('quebra de linha', () => {
  const d = doc(p(t('linha um'), { type: 'hardBreak' }, t('linha dois')))
  assert.equal(docToMarkdown(d), 'linha um\\\nlinha dois\n')
  assert.equal(docToPlainText(d), 'linha um\nlinha dois')
})

test('listas, aninhamento e numeração', () => {
  const d = doc(
    { type: 'bulletList', content: [li(p(t('um'))), li(p(t('dois')), { type: 'bulletList', content: [li(p(t('dois.a')))] })] },
    { type: 'orderedList', attrs: { start: 9 }, content: [li(p(t('nove'))), li(p(t('dez')), { type: 'orderedList', content: [li(p(t('sub')))] })] },
  )
  assert.equal(docToMarkdown(d), '- um\n- dois\n  - dois.a\n\n9. nove\n10. dez\n    1. sub\n')
})

test('checklist', () => {
  const d = doc({
    type: 'taskList',
    content: [
      { type: 'taskItem', attrs: { checked: true }, content: [p(t('feito'))] },
      { type: 'taskItem', attrs: { checked: false }, content: [p(t('a fazer')), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p(t('sub'))] }] }] },
    ],
  })
  assert.equal(docToMarkdown(d), '- [x] feito\n- [ ] a fazer\n  - [ ] sub\n')
  assert.equal(docToPlainText(d), 'feito\na fazer\nsub')
})

test('citação com vários parágrafos e lista dentro', () => {
  const d = doc({ type: 'blockquote', content: [p(t('uma')), p(t('duas')), { type: 'bulletList', content: [li(p(t('item')))] }] })
  assert.equal(docToMarkdown(d), '> uma\n>\n> duas\n>\n> - item\n')
})

test('bloco de código preserva conteúdo e linguagem', () => {
  const code = 'fn main() {\n    println!("**oi**");\n}'
  const d = doc({ type: 'codeBlock', attrs: { language: 'rust' }, content: [t(code)] })
  assert.equal(docToMarkdown(d), '```rust\n' + code + '\n```\n')
  const fenced = doc({ type: 'codeBlock', attrs: { language: null }, content: [t('```\nx\n```')] })
  assert.equal(docToMarkdown(fenced), '````\n```\nx\n```\n````\n')
  assert.equal(docToPlainText(d), code)
})

test('bloco de código dentro de lista fica recuado', () => {
  const d = doc({ type: 'bulletList', content: [li(p(t('passo')), { type: 'codeBlock', content: [t('a\nb')] })] })
  assert.equal(docToMarkdown(d), '- passo\n\n  ```\n  a\n  b\n  ```\n')
})

test('imagens', () => {
  const d = doc({ type: 'image', attrs: { assetId: 'abc-123', alt: 'foto [1]' } }, { type: 'image', attrs: { src: 'javascript:alert(1)' } })
  assert.equal(docToMarkdown(d), '![foto  1](asset:abc-123)\n')
  assert.equal(docToMarkdown(d, { imageSrc: (a) => `data:${a.assetId}` }), '![foto  1](data:abc-123)\n\n![](data:undefined)\n')
  assert.equal(docToPlainText(d), '')
})

test('marcas desconhecidas (sublinhado) caem em texto puro', () => {
  assert.equal(docToMarkdown(doc(p(t('sub', 'underline')))), 'sub\n')
})

test('nó desconhecido preserva o texto', () => {
  assert.equal(docToMarkdown(doc({ type: 'callout', content: [p(t('dentro'))] })), 'dentro\n')
})

test('nota longa com tudo', () => {
  const d = doc(
    h(1, 'Projeto'),
    p(t('Texto com '), t('ênfase', 'italic'), t('.')),
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p(t('revisar'))] }] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1')] },
    { type: 'blockquote', content: [p(t('citação'))] },
  )
  const md = docToMarkdown(d)
  assert.ok(md.includes('# Projeto\n\nTexto com *ênfase*.\n\n- [ ] revisar\n\n```ts\nconst a = 1\n```\n\n> citação\n'))
  assert.equal(docToPlainText(d), 'Projeto\nTexto com ênfase.\nrevisar\nconst a = 1\ncitação')
})

test('contagem de palavras', () => {
  assert.equal(countWords(''), 0)
  assert.equal(countWords('Olá, mundo! Guarda-chuva d’água 2026 — fim.'), 6)
})

test('normalização e termos', () => {
  assert.equal(normalize('AÇÃO Ñandú'), 'acao nandu')
  assert.deepEqual(searchTerms('  Pão-de-Açúcar, 2026 '), ['pao', 'de', 'acucar', '2026'])
  assert.ok(matchesAll('Reunião de Março', ['reuniao', 'mar']))
  assert.ok(!matchesAll('Reunião', ['reuniao', 'abril']))
})

test('destaque mantém o texto original com acento', () => {
  assert.equal(markTerms('Ação e reação', ['acao']), `${HIT_START}Ação${HIT_END} e re${HIT_START}ação${HIT_END}`)
  assert.deepEqual(splitHits(`a ${HIT_START}b${HIT_END} c`), [
    { text: 'a ', hit: false },
    { text: 'b', hit: true },
    { text: ' c', hit: false },
  ])
})

test('trecho em volta da ocorrência', () => {
  const long = 'palavra '.repeat(40) + 'girassol amarelo ' + 'fim '.repeat(40)
  const s = makeSnippet(long, ['girassol'], 30)
  assert.ok(s.startsWith('…') && s.endsWith('…'))
  assert.ok(s.includes(`${HIT_START}girassol${HIT_END}`))
  assert.ok(s.length < 120)
  assert.equal(makeSnippet('curto', ['nada']), 'curto')
})

test('tempo relativo', () => {
  const now = new Date(2026, 10, 5, 15, 0, 0).getTime()
  const ago = (ms: number) => new Date(now - ms).toISOString()
  assert.equal(relativeTime(ago(10_000), now), 'agora')
  assert.equal(relativeTime(ago(5 * 60_000), now), 'há 5 min')
  assert.equal(relativeTime(ago(3 * 3600_000), now), 'há 3 h')
  assert.equal(relativeTime(new Date(2026, 10, 4, 20, 0).toISOString(), now), 'ontem')
  assert.equal(relativeTime(new Date(2026, 10, 2, 9, 0).toISOString(), now), 'há 3 dias')
  assert.match(relativeTime(new Date(2026, 9, 12).toISOString(), now), /^em 12 de out/)
  assert.match(relativeTime(new Date(2024, 0, 3).toISOString(), now), /2024/)
})

test('tipo de imagem pelo conteúdo', () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])), 'image/png')
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a...')), 'image/gif')
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
  assert.equal(sniffImage(new TextEncoder().encode('<svg>')), null)
})

test('nome de arquivo seguro', () => {
  assert.equal(safeFileName('Reunião: 5/11 <final>?'), 'Reunião- 5-11 -final')
  assert.equal(safeFileName('../..'), 'nota')
  assert.equal(safeFileName(''), 'nota')
})

console.log(`✓ ${passed} testes de Markdown e texto passaram`)
