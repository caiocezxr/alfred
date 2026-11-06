import { extractFeed } from './feed.ts'
import { cleanupLocal, localCommand, seedDb, upsertLocal } from './localdb.ts'
import { parseXml } from './miniXml.test-util.ts'
import {
  canonicalUrl, cleanExcerpt, decodeEntities, displayTitle, githubRepo, htmlToText, normalizeEntry, normalizeText,
  parseDate, parseError, sanitizeXml, textLines, titleDedupEligible, titleKey, truncate, validateFeedUrl,
} from './normalize.ts'
import type { FeedItem, Keyword, NewFeedItem } from './types.ts'

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

const NOW = new Date('2026-11-05T22:00:00.000Z')

test('URL canônica tira rastreio, fragmento, barra final, www e força https', () => {
  assert.equal(
    canonicalUrl('http://www.Example.com/Post/?utm_source=rss&utm_medium=feed&b=2&a=1&fbclid=x#comments'),
    'https://example.com/Post?a=1&b=2',
  )
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com')
  assert.equal(canonicalUrl('https://example.com:443/x//'), 'https://example.com/x')
  assert.equal(canonicalUrl('http://example.com:8080/x?ref=hn'), 'https://example.com:8080/x')
  assert.equal(canonicalUrl('https://user:pw@example.com/x'), 'https://example.com/x')
  assert.equal(canonicalUrl('javascript:alert(1)'), null)
  assert.equal(canonicalUrl('mailto:a@b.com'), null)
  assert.equal(canonicalUrl('não é url'), null)
  assert.equal(canonicalUrl('http://openai.com/index/x/?utm_campaign=a'), canonicalUrl('https://www.openai.com/index/x#top'))
})

test('validação de URL de fonte espelha o Rust', () => {
  assert.equal(validateFeedUrl('  https://openai.com/news/rss.xml '), 'https://openai.com/news/rss.xml')
  for (const bad of ['', 'feed', 'ftp://a.com/x', 'file:///etc/passwd', 'http://localhost:5174/x', 'http://127.0.0.1/',
    'http://192.168.0.2/rss', 'http://10.1.2.3/', 'http://[::1]/', 'http://2130706433/', 'https://u:p@a.com/x']) {
    assert.throws(() => validateFeedUrl(bad), /^Error: \[url\]/, bad)
  }
})

test('normalizeText e titleKey: sem acentos, minúsculas, pontuação vira espaço', () => {
  assert.equal(normalizeText('Lançamento do Vídeo — “Veo 3”!'), 'lancamento do video veo 3')
  assert.equal(normalizeText('Node.js e C++ em three.js.'), 'node.js e c++ em three.js')
  assert.equal(normalizeText('GPT‑6 Cyber: what’s new'), 'gpt 6 cyber whats new')
  assert.equal(titleKey('  OpenAI lança novo modelo  '), 'openai lanca novo modelo')
  assert.ok(titleDedupEligible(titleKey('OpenAI lança novo modelo')))
  assert.ok(!titleDedupEligible(titleKey('vite v8.3.6')))
  assert.ok(!titleDedupEligible(titleKey('Show HN: X')))
})

test('entidades, HTML → texto e truncamento', () => {
  assert.equal(decodeEntities('AT&amp;T &mdash; &#8220;ok&#x201D; &nbsp;fim &foo;'), 'AT&T — “ok”  fim &foo;')
  assert.equal(textLines(htmlToText('<p>Um <b>dois</b></p><p>três<br>quatro</p><script>alert(1)</script>')).join('|'), 'Um dois|três|quatro')
  assert.equal(htmlToText('texto sem tags'), 'texto sem tags')
  const long = 'palavra '.repeat(80).trim()
  const cut = truncate(long, 60)
  assert.ok([...cut].length <= 60 && cut.endsWith('…') && !cut.includes('palavra…palavra'))
  assert.equal(truncate('curto', 60), 'curto')
})

test('XML quebrado é saneado: & solto e entidades HTML viram referências válidas', () => {
  assert.equal(sanitizeXml('<t>A & B &amp; C &nbsp; &mdash; &#38; &unknown;</t>'), '<t>A &amp; B &amp; C &#160; &#8212; &#38; &amp;unknown;</t>')
})

test('datas RFC 822 e ISO viram ISO UTC; futuro vira agora; lixo vira null', () => {
  assert.equal(parseDate('Thu, 05 Nov 2026 20:00:00 GMT', NOW), '2026-11-05T20:00:00.000Z')
  assert.equal(parseDate('Fri, 06 Nov 2026 00:08:31 +0000', new Date('2026-11-06T02:00:00Z')), '2026-11-06T00:08:31.000Z')
  assert.equal(parseDate('2026-11-05T17:34:03+00:00', NOW), '2026-11-05T17:34:03.000Z')
  assert.equal(parseDate('2026-11-05 10:00:00Z', NOW), '2026-11-05T10:00:00.000Z')
  assert.equal(parseDate('2030-01-01T00:00:00Z', NOW), NOW.toISOString())
  assert.equal(parseDate('ontem', NOW), null)
  assert.equal(parseDate('1970-01-01T00:00:00Z', NOW), null)
  assert.equal(parseDate(null, NOW), null)
})

test('títulos de releases do GitHub ganham o nome do repositório', () => {
  assert.deepEqual(githubRepo('https://github.com/vitejs/vite/releases.atom'), { owner: 'vitejs', repo: 'vite' })
  assert.deepEqual(githubRepo('https://github.com/mrdoob/three.js/tags.atom'), { owner: 'mrdoob', repo: 'three.js' })
  assert.equal(githubRepo('https://openai.com/news/rss.xml'), null)
  assert.equal(displayTitle('v8.3.6', 'https://github.com/vitejs/vite/releases.atom'), 'vite v8.3.6')
  assert.equal(displayTitle('r187', 'https://github.com/mrdoob/three.js/tags.atom'), 'three.js r187')
  assert.equal(displayTitle('tauri v2.12.5', 'https://github.com/tauri-apps/tauri/releases.atom'), 'tauri v2.12.5')
  assert.equal(displayTitle('plugin-legacy@8.2.4', 'https://github.com/vitejs/vite/releases.atom'), 'plugin-legacy@8.2.4')
  assert.equal(displayTitle('v1.0', 'https://openai.com/news/rss.xml'), 'v1.0')
})

test('trechos: rodapé do HN some, cabeçalhos de release somem, título não se repete', () => {
  const hn = '<p>Article URL: <a href="https://x.com">https://x.com</a></p>\n<p>Comments URL: <a href="https://news.ycombinator.com/item?id=1">…</a></p>\n<p>Points: 312</p>\n<p># Comments: 140</p>'
  assert.equal(cleanExcerpt(htmlToText(hn), { title: 'X', release: false, hn: true }), '')
  const rel = '<h2>What\'s changed</h2><ul><li>Added MCP server support by @alice in https://github.com/o/r/pull/12</li><li>Fixed --continue losing history</li></ul><p><strong>Full Changelog</strong>: https://github.com/o/r/compare/v1...v2</p>'
  assert.equal(cleanExcerpt(htmlToText(rel), { title: 'v2', release: true, hn: false }), 'Added MCP server support · Fixed --continue losing history')
  assert.equal(cleanExcerpt('Meu título. E o resto do texto.', { title: 'Meu título', release: false, hn: false }), 'E o resto do texto.')
  assert.ok([...cleanExcerpt('x '.repeat(400), { title: '', release: false, hn: false })].length <= 280)
})

test('erros "[código] mensagem" são classificados', () => {
  assert.deepEqual(parseError(new Error('[http 404] o feed não existe mais neste endereço')), { code: 'http', status: 404, message: 'o feed não existe mais neste endereço' })
  assert.equal(parseError('[tempo] a fonte demorou demais').code, 'tempo')
  assert.equal(parseError(new TypeError('Failed to fetch')).code, 'rede')
  assert.equal(parseError('banco ocupado').code, 'outro')
})

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title><![CDATA[OpenAI News]]></title>
    <link>https://openai.com/news</link>
    <atom:link href="https://openai.com/news/rss.xml" rel="self" type="application/rss+xml"/>
    <item>
      <title><![CDATA[Introducing GPT‑6 Cyber &amp; agents]]></title>
      <description><![CDATA[<p>A model for <b>finding</b> vulnerabilities &amp; fixing them.</p><img src="https://track.example/p.gif">]]></description>
      <link>https://openai.com/index/introducing-gpt-6-cyber/?utm_source=rss</link>
      <guid isPermaLink="true">https://openai.com/index/introducing-gpt-6-cyber</guid>
      <category><![CDATA[Product]]></category>
      <pubDate>Thu, 05 Nov 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Sem link, só guid permalink</title>
      <guid>https://example.com/guid-link</guid>
      <dc:date>2026-11-04T12:00:00Z</dc:date>
      <content:encoded>&lt;p&gt;Corpo &lt;em&gt;longo&lt;/em&gt;&lt;/p&gt;</content:encoded>
    </item>
    <item>
      <title>Link perigoso</title>
      <link>javascript:alert(1)</link>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <id>tag:github.com,2008:https://github.com/anthropics/claude-code/releases</id>
  <link type="text/html" rel="alternate" href="https://github.com/anthropics/claude-code/releases"/>
  <link type="application/atom+xml" rel="self" href="https://github.com/anthropics/claude-code/releases.atom"/>
  <title>Release notes from claude-code</title>
  <updated>2026-11-04T00:00:44Z</updated>
  <entry>
    <id>tag:github.com,2008:Repository/937253475/v2.1.318</id>
    <updated>2026-11-04T00:01:03Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/anthropics/claude-code/releases/tag/v2.1.318"/>
    <title>v2.1.318</title>
    <content type="html">&lt;h2&gt;What&#39;s changed&lt;/h2&gt;
&lt;ul&gt;
&lt;li&gt;Added a record of your answer when Claude Code asks to turn on mods&lt;/li&gt;
&lt;li&gt;Fixed &lt;code&gt;--continue&lt;/code&gt; losing the conversation&lt;/li&gt;
&lt;/ul&gt;</content>
    <author><name>github-actions</name></author>
  </entry>
  <entry>
    <id>urn:post:2</id>
    <title type="html">Post &lt;em&gt;relativo&lt;/em&gt;</title>
    <link href="/blog/post-2"/>
    <published>2026-11-03T10:00:00+00:00</published>
    <updated>2026-11-04T10:00:00+00:00</updated>
    <summary>Resumo em texto puro com &lt;tag&gt; literal.</summary>
  </entry>
</feed>`

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.org/"><title>Exemplo RDF</title><link>https://example.org/</link></channel>
  <item rdf:about="https://example.org/a"><title>Item RDF</title><link>https://example.org/a</link><dc:date>2026-11-01T08:00:00Z</dc:date><description>Texto</description></item>
</rdf:RDF>`

test('RSS 2.0: CDATA, entidades, guid como link, dc:date, content:encoded', () => {
  const f = extractFeed(parseXml(RSS))
  assert.equal(f.kind, 'rss')
  assert.equal(f.title, 'OpenAI News')
  assert.equal(f.link, 'https://openai.com/news')
  assert.equal(f.entries.length, 3)
  const [a, b] = f.entries
  assert.equal(a.title, 'Introducing GPT‑6 Cyber &amp; agents')
  assert.equal(a.link, 'https://openai.com/index/introducing-gpt-6-cyber/?utm_source=rss')
  assert.equal(a.published, 'Thu, 05 Nov 2026 09:00:00 GMT')
  assert.equal(a.summaryType, 'html')
  assert.equal(b.link, 'https://example.com/guid-link')
  assert.equal(b.published, '2026-11-04T12:00:00Z')
  assert.equal(b.summary, '<p>Corpo <em>longo</em></p>')
})

test('Atom: link alternate, conteúdo HTML escapado, link relativo, published antes de updated', () => {
  const f = extractFeed(parseXml(ATOM))
  assert.equal(f.kind, 'atom')
  assert.equal(f.link, 'https://github.com/anthropics/claude-code/releases')
  const [a, b] = f.entries
  assert.equal(a.link, 'https://github.com/anthropics/claude-code/releases/tag/v2.1.318')
  assert.equal(a.guid, 'tag:github.com,2008:Repository/937253475/v2.1.318')
  assert.equal(a.summaryType, 'html')
  assert.ok(a.summary!.startsWith("<h2>What's changed</h2>"))
  assert.equal(a.published, null)
  assert.equal(a.updated, '2026-11-04T00:01:03Z')
  assert.equal(b.link, 'https://github.com/blog/post-2')
  assert.equal(b.summaryType, 'text')
  assert.equal(b.title, 'Post <em>relativo</em>')
})

test('RSS 1.0 (RDF) também é lido', () => {
  const f = extractFeed(parseXml(RDF))
  assert.equal(f.kind, 'rdf')
  assert.equal(f.entries[0].link, 'https://example.org/a')
  assert.equal(f.entries[0].published, '2026-11-01T08:00:00Z')
})

test('documento que não é feed lança [formato]', () => {
  assert.throws(() => extractFeed(parseXml('<html><body>oi</body></html>')), /\[formato\]/)
})

test('normalizeEntry: do feed ao item pronto para o banco', () => {
  const rss = extractFeed(parseXml(RSS))
  const src = { url: 'https://openai.com/news/rss.xml' }
  const a = normalizeEntry(rss.entries[0], src, NOW)!
  assert.equal(a.title, 'Introducing GPT‑6 Cyber & agents')
  assert.equal(a.titleKey, 'introducing gpt 6 cyber agents')
  assert.equal(a.canonicalUrl, 'https://openai.com/index/introducing-gpt-6-cyber')
  assert.equal(a.excerpt, 'A model for finding vulnerabilities & fixing them.')
  assert.equal(a.publishedAt, '2026-11-05T09:00:00.000Z')
  assert.equal(normalizeEntry(rss.entries[1], src, NOW)!.excerpt, 'Corpo longo')
  assert.equal(normalizeEntry(rss.entries[2], src, NOW), null, 'javascript: é descartado')

  const atom = extractFeed(parseXml(ATOM))
  const rel = normalizeEntry(atom.entries[0], { url: 'https://github.com/anthropics/claude-code/releases.atom' }, NOW)!
  assert.equal(rel.title, 'claude-code v2.1.318')
  assert.equal(rel.excerpt, 'Added a record of your answer when Claude Code asks to turn on mods · Fixed --continue losing the conversation')
  assert.equal(rel.publishedAt, '2026-11-04T00:01:03.000Z')
  const post = normalizeEntry(atom.entries[1], { url: 'https://example.com/feed.atom' }, NOW)!
  assert.equal(post.title, 'Post relativo')
  assert.equal(post.excerpt, 'Resumo em texto puro com <tag> literal.', 'texto puro não é tratado como HTML')
  assert.equal(post.publishedAt, '2026-11-03T10:00:00.000Z')
})

const newItem = (url: string, title: string, publishedAt: string | null = '2026-11-05T10:00:00.000Z'): NewFeedItem => ({
  guid: url, url, canonicalUrl: canonicalUrl(url)!, title, titleKey: titleKey(title), excerpt: 'trecho',
  category: 'ai_dev', relevance: 4, publishedAt,
})

test('banco local: semente igual em fontes e palavras', () => {
  const db = seedDb(NOW.toISOString())
  assert.equal(db.sources.length, 18)
  assert.ok(db.keywords.length > 150)
  assert.ok(db.keywords.every((k) => k.kind === 'boost' || k.category === null))
})

test('banco local: upsert não duplica e preserva lido/salvo/dispensado', () => {
  const db = seedDb(NOW.toISOString())
  let r = upsertLocal(db, 'seed-openai', [newItem('https://example.com/a', 'Primeira notícia sobre agentes'), newItem('https://example.com/b', 'Segunda notícia sobre modelos')], NOW)
  assert.deepEqual(r, { inserted: 2, updated: 0, unchanged: 0, duplicates: 0, skipped: 0 })
  const a = db.items.find((i) => i.canonicalUrl === 'https://example.com/a')!
  localCommand(db, 'radar_item_set', { id: a.id, patch: { read: true, saved: true } }, NOW)
  r = upsertLocal(db, 'seed-openai', [
    { ...newItem('http://www.example.com/a/?utm_source=x', 'Primeira notícia sobre agentes (editada)'), publishedAt: '2026-11-05T21:00:00.000Z' },
    newItem('https://example.com/b', 'Segunda notícia sobre modelos'),
  ], NOW)
  assert.deepEqual([r.inserted, r.updated, r.unchanged], [0, 1, 1])
  assert.equal(db.items.length, 2)
  const a2 = db.items.find((i) => i.id === a.id)!
  assert.ok(a2.readAt && a2.savedAt)
  assert.equal(a2.publishedAt, '2026-11-05T10:00:00.000Z', 'republicação não muda a data')
  r = upsertLocal(db, 'seed-hn', [newItem('https://news.example/x', 'Segunda notícia sobre modelos'), newItem('https://example.com/b', 'Outro título qualquer aqui')], NOW)
  assert.equal(r.duplicates, 2)
  r = upsertLocal(db, 'seed-vite', [newItem('https://github.com/a/a/releases/tag/v1', 'v1.0.0'), newItem('https://github.com/b/b/releases/tag/v1', 'v1.0.0'),
    newItem('https://example.com/velho', 'Notícia velha demais aqui', '2026-01-01T00:00:00.000Z'), { ...newItem('https://example.com/x', '   ') }], NOW)
  assert.deepEqual([r.inserted, r.skipped], [2, 2])
  assert.throws(() => upsertLocal(db, 'nao-existe', [], NOW), /fonte não encontrada/)
})

test('banco local: limpeza deixa lápide e salvos sobrevivem; remover fonte guarda salvos', () => {
  const db = seedDb(NOW.toISOString())
  const old = (id: string, saved: boolean): FeedItem => ({
    id, sourceId: 'seed-openai', sourceName: 'OpenAI News', guid: null, url: `https://example.com/${id}`, canonicalUrl: `https://example.com/${id}`,
    title: id, titleKey: id, excerpt: '', category: 'ai_dev', relevance: 0, publishedAt: '2026-08-01T00:00:00.000Z',
    fetchedAt: '2026-08-01T00:00:00.000Z', readAt: null, savedAt: saved ? '2026-08-02T00:00:00.000Z' : null, dismissedAt: null,
  })
  db.items.push(old('velho', false), old('salvo', true))
  assert.equal(cleanupLocal(db, 60, NOW), 1)
  assert.deepEqual(db.items.map((i) => i.id), ['salvo'])
  assert.equal(upsertLocal(db, 'seed-openai', [newItem('https://example.com/velho', 'O velho voltou no feed hoje')], NOW).skipped, 1)

  upsertLocal(db, 'seed-vite', [newItem('https://example.com/v1', 'Item um da fonte vite'), newItem('https://example.com/v2', 'Item dois da fonte vite')], NOW)
  const v1 = db.items.find((i) => i.canonicalUrl === 'https://example.com/v1')!
  localCommand(db, 'radar_item_set', { id: v1.id, patch: { saved: true } }, NOW)
  localCommand(db, 'radar_source_delete', { id: 'seed-vite' }, NOW)
  const left = db.items.filter((i) => i.sourceName === 'Vite')
  assert.equal(left.length, 1)
  assert.equal(left[0].sourceId, null)
})

test('banco local: fontes e palavras validam como no Rust', () => {
  const db = seedDb(NOW.toISOString())
  assert.throws(() => localCommand(db, 'radar_source_add', { input: { name: 'x', url: 'https://openai.com/news/rss.xml', category: 'auto' } }, NOW), /já está no Radar/)
  assert.throws(() => localCommand(db, 'radar_source_add', { input: { name: 'x', url: 'http://localhost/x', category: 'auto' } }, NOW), /\[url\]/)
  assert.throws(() => localCommand(db, 'radar_source_update', { id: 'seed-openai', patch: { weight: 9 } }, NOW), /0,2 a 2/)
  const k = localCommand(db, 'radar_keyword_save', { input: { term: '  Model   Routing ', kind: 'mute', category: 'ai_dev', weight: 1.234 } }, NOW) as Keyword
  assert.deepEqual([k.term, k.category, k.weight], ['model routing', null, 1.23])
  assert.throws(() => localCommand(db, 'radar_keyword_save', { input: { term: 'MODEL ROUTING', kind: 'boost', weight: 1 } }, NOW), /já está na lista/)
  const rep = localCommand(db, 'radar_source_report', { id: 'seed-hn', ok: false, error: '[tempo] demorou' }, NOW) as { lastStatus: string; lastOkAt: string | null }
  assert.deepEqual([rep.lastStatus, rep.lastOkAt], ['error', null])
})

console.log(`normalize.test.ts: ${passed} testes ok`)
