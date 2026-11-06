import type { NewFeedItem } from './types.ts'

export const EXCERPT_MAX = 280
export const TITLE_MAX = 300

const TRACKING = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', '_hsenc', '_hsmi',
  'mkt_tok', 'yclid', 'ref', 'ref_src', 'ref_url', 'spm', 'cmpid', 'ncid', 'sr_share', 'oly_enc_id', 'oly_anon_id',
  'vero_id', '_ga', '_gl', 'trk', 'trkcampaign', 'campaign_id', 'share', 'via', 'cid',
])

export function canonicalUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (!host) return null
  const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : ''
  const params = [...u.searchParams]
    .filter(([k]) => !/^utm_/i.test(k) && !TRACKING.has(k.toLowerCase()))
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
  const search = params.length ? `?${new URLSearchParams(params).toString()}` : ''
  const path = u.pathname.replace(/\/+$/, '')
  return `https://${host}${port}${path}${search}`
}

export function validateFeedUrl(raw: string): string {
  const s = raw.trim()
  if (!s) throw new Error('[url] informe o endereço do feed')
  if (s.length > 2048) throw new Error('[url] endereço longo demais')
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new Error('[url] endereço inválido')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('[url] use um endereço que comece com http:// ou https://')
  if (u.username || u.password) throw new Error('[url] endereços com usuário e senha não são aceitos')
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (isLocalHost(h)) throw new Error('[url] endereços locais ou de rede interna não são aceitos')
  return s
}

function isLocalHost(h: string): boolean {
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || (a === 100 && b >= 64 && b < 128) || h === '255.255.255.255'
  }
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:')
  return /^[\d.x]+$/.test(h)
}

export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/(^|\s)\.+|\.+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const titleKey = (title: string) => normalizeText(title).slice(0, TITLE_MAX)

export function titleDedupEligible(key: string): boolean {
  return key.split(' ').filter(Boolean).length >= 3 && [...key].length >= 16
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·', copy: '©',
  reg: '®', trade: '™', deg: '°', times: '×', rarr: '→', larr: '←', euro: '€', pound: '£', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', egrave: 'è', acirc: 'â',
  ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç',
  szlig: 'ß', zwj: '', zwnj: '', shy: '',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m
  })
}

const BLOCK = /<\s*\/?\s*(p|div|li|ul|ol|h[1-6]|tr|blockquote|pre|section|article|header|footer|dd|dt|figcaption|table|hr)\b[^>]*>|<\s*br\s*\/?>/gi

export function htmlToTextFallback(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|iframe|svg|math|pre|details|table)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(BLOCK, '\n')
      .replace(/<[^>]*>/g, ''),
  )
}

export function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return html
  if (typeof DOMParser === 'undefined') return htmlToTextFallback(html)
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  doc.querySelectorAll('script,style,noscript,template,iframe,object,embed,svg,math,pre,details,table').forEach((n) => n.remove())
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'))
  doc
    .querySelectorAll('p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,tr,blockquote,pre,section,article,header,footer,dd,dt,figcaption,table,hr')
    .forEach((n) => n.append('\n'))
  return doc.body?.textContent ?? ''
}

export function textLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/[\s ​]+/g, ' ').trim())
    .filter(Boolean)
}

export const oneLine = (s: string) => s.replace(/[\s ​]+/g, ' ').trim()

export function truncate(s: string, max: number): string {
  const chars = [...s]
  if (chars.length <= max) return s
  const cut = chars.slice(0, max - 1).join('')
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—·]+$/, '')}…`
}

export function sanitizeXml(xml: string): string {
  return xml.replace(/&(?!#\d+;|#x[0-9a-f]+;)([a-z][a-z0-9]*;)?/gi, (m, ent?: string) => {
    if (!ent) return '&amp;'
    const name = ent.slice(0, -1)
    if (name === 'amp' || name === 'lt' || name === 'gt' || name === 'quot' || name === 'apos') return m
    const ch = NAMED[name] ?? NAMED[name.toLowerCase()]
    return ch !== undefined ? (ch ? `&#${ch.codePointAt(0)};` : '') : `&amp;${ent}`
  })
}

export function parseDate(s: string | null | undefined, now: Date): string | null {
  if (!s) return null
  let t = Date.parse(s.trim())
  if (Number.isNaN(t)) {
    t = Date.parse(s.trim().replace(' ', 'T'))
    if (Number.isNaN(t)) return null
  }
  if (t < Date.UTC(1995, 0, 1)) return null
  if (t > now.getTime() + 36e5) t = now.getTime()
  return new Date(t).toISOString()
}

export function githubRepo(sourceUrl: string): { owner: string; repo: string } | null {
  const m = sourceUrl.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:releases|tags)\.atom(?:[?#].*)?$/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

export function displayTitle(title: string, sourceUrl: string): string {
  const gh = githubRepo(sourceUrl)
  if (!gh) return title
  if (/^(v?\d|r\d)/i.test(title) && !normalizeText(title).includes(normalizeText(gh.repo))) return `${gh.repo} ${title}`
  return title
}

const RELEASE_BOILERPLATE = /^(what['’]?s (changed|new)|changes|changelog|highlights|release notes|new contributors|contributors|bug fixes|features|fixes|full changelog\b.*|.*\bmade their first contribution\b.*|https?:\/\/\S+)$/i
const HN_BOILERPLATE = /^(article url|comments url|points|# comments)\s*:/i
const FOOTER = /^(tags?\s*:.*|the post .* appeared first on .*|continue reading.*|read more.*|leia mais.*|\[(…|\.\.\.)\])$/i

export function cleanExcerpt(text: string, opts: { title: string; release: boolean; hn: boolean }): string {
  let lines = textLines(text).map((l) => l.replace(/\s*The post .* appeared first on .*$/i, '').trim()).filter((l) => l && !FOOTER.test(l))
  if (opts.hn) lines = lines.filter((l) => !HN_BOILERPLATE.test(l))
  if (opts.release) {
    lines = lines
      .map((l) => l.replace(/\s+by @[\w-]+(?:\s+in\s+(?:https?:\/\/\S+|#\d+))?/g, '').replace(/^[*\-•]\s*/, '').trim())
      .filter((l) => l && !RELEASE_BOILERPLATE.test(l.replace(/:$/, '')))
  }
  let out = lines.join(opts.release ? ' · ' : ' ')
  const t = oneLine(opts.title)
  if (t && out.toLowerCase().startsWith(t.toLowerCase())) out = out.slice(t.length).replace(/^[\s:.\-–—|·]+/, '')
  return truncate(oneLine(out), EXCERPT_MAX)
}

export type RawEntry = {
  title: string
  link: string | null
  guid: string | null
  summary: string | null
  summaryType: 'html' | 'text'
  published: string | null
  updated: string | null
}

export type NormalizedEntry = Omit<NewFeedItem, 'category' | 'relevance'>

export function normalizeEntry(raw: RawEntry, source: { url: string }, now: Date): NormalizedEntry | null {
  const link = raw.link?.trim() || (raw.guid && /^https?:\/\//i.test(raw.guid.trim()) ? raw.guid.trim() : '')
  if (!link) return null
  const canonical = canonicalUrl(link)
  if (!canonical) return null
  let url: string
  try {
    url = new URL(link).toString()
  } catch {
    return null
  }
  const rawTitle = oneLine(raw.title.includes('<') || raw.title.includes('&') ? htmlToText(raw.title) : raw.title)
  if (!rawTitle) return null
  const title = truncate(displayTitle(rawTitle, source.url), TITLE_MAX)
  const summary = raw.summary ?? ''
  const text = raw.summaryType === 'html' ? htmlToText(summary) : summary
  const excerpt = cleanExcerpt(text, { title: rawTitle, release: !!githubRepo(source.url), hn: /(^|\.)hnrss\.org$/i.test(hostOf(source.url)) })
  return {
    guid: raw.guid ? raw.guid.trim().slice(0, 500) || null : null,
    url,
    canonicalUrl: canonical,
    title,
    titleKey: titleKey(title),
    excerpt,
    publishedAt: parseDate(raw.published, now) ?? parseDate(raw.updated, now),
  }
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}

export type RadarErrorCode = 'rede' | 'tempo' | 'http' | 'formato' | 'tamanho' | 'url' | 'outro'
export type RadarError = { code: RadarErrorCode; status?: number; message: string }

export function parseError(e: unknown): RadarError {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e)
  const m = raw.match(/^\[(rede|tempo|http|formato|tamanho|url)(?:\s+(\d{3}))?\]\s*(.*)$/s)
  if (m) return { code: m[1] as RadarErrorCode, status: m[2] ? Number(m[2]) : undefined, message: m[3] || raw }
  if (/failed to fetch|load failed|networkerror|network error/i.test(raw)) return { code: 'rede', message: 'sem conexão' }
  return { code: 'outro', message: raw }
}

export const isNetworkError = (e: RadarError) => e.code === 'rede' || e.code === 'tempo'
