
export const HIT_START = '\u0001'
export const HIT_END = '\u0002'

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let i = 0
  for (const ch of s) {
    const n = normalize(ch)
    for (let k = 0; k < n.length; k++) map.push(i)
    norm += n
    i += ch.length
  }
  map.push(i)
  return { norm, map }
}

export function searchTerms(q: string): string[] {
  return normalize(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
}

export function matchesAll(text: string, terms: string[]): boolean {
  const n = normalize(text)
  return terms.every((t) => n.includes(t))
}

export function markTerms(text: string, terms: string[]): string {
  if (!terms.length || !text) return text
  const { norm, map } = normalizeWithMap(text)
  const ranges: [number, number][] = []
  for (const t of terms) {
    let at = norm.indexOf(t)
    while (at >= 0) {
      ranges.push([map[at], map[at + t.length]])
      at = norm.indexOf(t, at + t.length)
    }
  }
  if (!ranges.length) return text
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  let out = ''
  let pos = 0
  for (const [a, b] of merged) {
    out += text.slice(pos, a) + HIT_START + text.slice(a, b) + HIT_END
    pos = b
  }
  return out + text.slice(pos)
}

export function makeSnippet(text: string, terms: string[], radius = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const { norm, map } = normalizeWithMap(flat)
  let first = -1
  for (const t of terms) {
    const at = norm.indexOf(t)
    if (at >= 0 && (first < 0 || at < first)) first = at
  }
  if (first < 0) return flat.length > radius * 2 ? flat.slice(0, radius * 2).replace(/\s\S*$/, '') + '…' : flat
  const center = map[first]
  let start = Math.max(0, center - radius)
  let end = Math.min(flat.length, center + radius * 1.6)
  if (start > 0) {
    const sp = flat.indexOf(' ', start)
    if (sp >= 0 && sp < center) start = sp + 1
  }
  if (end < flat.length) {
    const sp = flat.lastIndexOf(' ', end)
    if (sp > center) end = sp
  }
  return (start > 0 ? '…' : '') + markTerms(flat.slice(start, end), terms) + (end < flat.length ? '…' : '')
}

export function splitHits(s: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  let hit = false
  let buf = ''
  for (const ch of s) {
    if (ch === HIT_START || ch === HIT_END) {
      if (buf) out.push({ text: buf, hit })
      buf = ''
      hit = ch === HIT_START
    } else buf += ch
  }
  if (buf) out.push({ text: buf, hit })
  return out
}

const fmtDay = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
const fmtDayYear = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'agora'
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  const d0 = new Date(now)
  d0.setHours(0, 0, 0, 0)
  const startToday = d0.getTime()
  if (t >= startToday) return `há ${h} h`
  if (t >= startToday - 86400000) return 'ontem'
  const days = Math.ceil((startToday - t) / 86400000)
  if (days < 7) return `há ${days} dias`
  const d = new Date(t)
  const fmt = d.getFullYear() === new Date(now).getFullYear() ? fmtDay : fmtDayYear
  return `em ${fmt.format(d)}`
}

export function sniffImage(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  const at = (i: number) => b[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  const head = String.fromCharCode(...b.subarray(0, 12))
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  return null
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function safeFileName(title: string): string {
  const s = title
    .replace(/[^\p{L}\p{N} _.,-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)
    .replace(/[.\s-]+$/g, '')
  return s || 'nota'
}
