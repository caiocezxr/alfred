import { sanitizeXml, type RawEntry } from './normalize.ts'

export type XEl = {
  readonly localName: string
  readonly textContent: string | null
  getAttribute(name: string): string | null
  readonly children: ArrayLike<XEl>
}

export type ParsedFeed = { kind: 'rss' | 'atom' | 'rdf'; title: string; link: string | null; entries: RawEntry[] }

const nameOf = (el: XEl) => {
  const n = el.localName.toLowerCase()
  const i = n.indexOf(':')
  return i >= 0 ? n.slice(i + 1) : n
}
const kids = (el: XEl, name: string) => Array.from(el.children).filter((c) => nameOf(c) === name)
const first = (el: XEl, ...names: string[]) => {
  for (const n of names) {
    const k = kids(el, n)[0]
    if (k) return k
  }
  return null
}
const text = (el: XEl | null) => el?.textContent?.trim() ?? ''
const orNull = (s: string) => s || null

function resolve(href: string, base: string | null): string {
  try {
    return new URL(href, base ?? undefined).toString()
  } catch {
    return href
  }
}

function atomLink(el: XEl, base: string | null): string | null {
  const links = kids(el, 'link')
  const pick =
    links.find((l) => (l.getAttribute('rel') ?? 'alternate') === 'alternate' && (l.getAttribute('type') ?? 'text/html').includes('html')) ??
    links.find((l) => (l.getAttribute('rel') ?? 'alternate') === 'alternate') ??
    null
  const href = pick?.getAttribute('href')?.trim()
  return href ? resolve(href, base) : null
}

function atomEntry(entry: XEl, base: string | null): RawEntry {
  const summary = first(entry, 'summary', 'content')
  const type = (summary?.getAttribute('type') ?? 'text').toLowerCase()
  return {
    title: text(first(entry, 'title')),
    link: atomLink(entry, base),
    guid: orNull(text(first(entry, 'id'))),
    summary: summary ? text(summary) : null,
    summaryType: type === 'html' || type === 'text/html' ? 'html' : 'text',
    published: orNull(text(first(entry, 'published', 'issued'))),
    updated: orNull(text(first(entry, 'updated', 'modified'))),
  }
}

function rssItem(item: XEl, base: string | null): RawEntry {
  let link: string | null = null
  for (const l of kids(item, 'link')) {
    const v = text(l) || l.getAttribute('href')?.trim() || ''
    if (v) {
      link = resolve(v, base)
      break
    }
  }
  const guidEl = first(item, 'guid')
  const guid = text(guidEl)
  if (!link && guid && guidEl?.getAttribute('isPermaLink') !== 'false' && /^https?:\/\//i.test(guid)) link = guid
  const summary = first(item, 'description', 'summary', 'encoded')
  return {
    title: text(first(item, 'title')),
    link,
    guid: orNull(guid),
    summary: summary ? text(summary) : null,
    summaryType: 'html',
    published: orNull(text(first(item, 'pubdate', 'date', 'published'))),
    updated: orNull(text(first(item, 'updated', 'modified'))),
  }
}

export function extractFeed(root: XEl): ParsedFeed {
  const name = nameOf(root)
  if (name === 'feed') {
    const link = atomLink(root, null)
    return { kind: 'atom', title: text(first(root, 'title')), link, entries: kids(root, 'entry').map((e) => atomEntry(e, link)) }
  }
  if (name === 'rss') {
    const channel = first(root, 'channel')
    if (!channel) throw new Error('[formato] RSS sem <channel>')
    const link = orNull(text(first(channel, 'link')))
    return { kind: 'rss', title: text(first(channel, 'title')), link, entries: kids(channel, 'item').map((i) => rssItem(i, link)) }
  }
  if (name === 'rdf') {
    const channel = first(root, 'channel')
    const link = channel ? orNull(text(first(channel, 'link'))) : null
    return { kind: 'rdf', title: channel ? text(first(channel, 'title')) : '', link, entries: kids(root, 'item').map((i) => rssItem(i, link)) }
  }
  throw new Error('[formato] o conteúdo não é um feed RSS ou Atom')
}

export function parseFeedText(xml: string): ParsedFeed {
  const parse = (s: string) => {
    const doc = new DOMParser().parseFromString(s, 'application/xml')
    return doc.getElementsByTagName('parsererror').length ? null : doc.documentElement
  }
  const root = parse(xml) ?? parse(sanitizeXml(xml))
  if (!root) throw new Error('[formato] o XML do feed está quebrado')
  return extractFeed(root)
}
