import type { BibleBook } from '../data/bible'

export const PAGE_W = 1400
export const PAGE_H = 2030
export const LW = 470
export const LH = (LW * PAGE_H) / PAGE_W

export const FONT_BODY = '"EB Garamond", Georgia, serif'

export type VerseMode = 'lines' | 'flow'
export type TypeStyle = { fontScale: number; verseMode: VerseMode }

export type SegRole = 'body' | 'italic' | 'lead' | 'vnum'
export type Seg = { x: number; w: number; text: string; role: SegRole; chapter: number; verse: number }
export type Line = { line: number; segs: Seg[] }
export type Heading = { line: number; chapter: number; label: string; sup: string[]; lines: number }
export type Ref = { chapter: number; verse: number }

export type Page = {
  book: number
  lines: Line[]
  headings: Heading[]
  title: { name: string; subtitle: string } | null
  firstRef: Ref | null
  lastRef: Ref | null
  blank: boolean
  special?: 'credits' | 'titlepage'
}

export type Metrics = {
  fs: number
  lh: number
  margin: { top: number; bottom: number; inner: number; outer: number }
  blockW: number
  maxLines: number
  titleLines: number
  space: number
  style: TypeStyle
}

const measureCtx = new OffscreenCanvas(8, 8).getContext('2d')!
const widthCache = new Map<string, Map<string, number>>()

export function measure(font: string, text: string): number {
  let cache = widthCache.get(font)
  if (!cache) widthCache.set(font, (cache = new Map()))
  let w = cache.get(text)
  if (w === undefined) {
    measureCtx.font = font
    w = measureCtx.measureText(text).width
    cache.set(text, w)
  }
  return w
}

export function resetMeasure() {
  widthCache.clear()
}

export function fonts(m: Metrics) {
  const fs = m.fs
  return {
    body: `400 ${fs}px ${FONT_BODY}`,
    italic: `italic 400 ${fs}px ${FONT_BODY}`,
    lead: `500 ${Math.round(fs * 0.8)}px ${FONT_BODY}`,
    vnum: `600 ${Math.round(fs * 0.56)}px ${FONT_BODY}`,
    vnumLines: `600 ${Math.round(fs * 0.6)}px ${FONT_BODY}`,
    sup: `italic 400 ${Math.round(fs * 0.86)}px ${FONT_BODY}`,
  }
}

export function metricsFor(style: TypeStyle): Metrics {
  const fs = Math.round(41 * style.fontScale * 10) / 10
  const lh = Math.round(fs * 1.46 * 10) / 10
  const margin = { top: 196, bottom: 150, inner: 150, outer: 118 }
  const blockW = PAGE_W - margin.inner - margin.outer
  const maxLines = Math.floor((PAGE_H - margin.top - margin.bottom) / lh)
  const titleLines = Math.max(4, Math.ceil((fs * 3.2 + fs * 2.2 + fs * 2.4) / lh))
  return { fs, lh, margin, blockW, maxLines, titleLines, space: 0, style }
}

type Box = { segs: { text: string; role: SegRole; w: number }[]; w: number; chapter: number; verse: number; verseStart: boolean }

function words(text: string): { text: string; italic: boolean }[] {
  const out: { text: string; italic: boolean }[] = []
  let italic = false
  for (const raw of text.split(' ')) {
    if (!raw) continue
    const startsItalic = italic || raw.startsWith('\u0001')
    if (raw.includes('\u0001')) italic = true
    if (raw.includes('\u0002')) italic = false
    const clean = raw.replace(/[\u0001\u0002]/g, '')
    if (clean) out.push({ text: clean, italic: startsItalic })
  }
  return out
}

function wrapText(font: string, text: string, maxW: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const w of text.split(' ')) {
    const t = cur ? `${cur} ${w}` : w
    if (measure(font, t) > maxW && cur) {
      out.push(cur)
      cur = w
    } else cur = t
  }
  if (cur) out.push(cur)
  return out
}

export function frontMatter(): Page[] {
  const base = { book: -1, lines: [], headings: [], title: null, firstRef: null, lastRef: null, blank: false }
  return [
    { ...base, special: 'credits' },
    { ...base, special: 'titlepage' },
  ]
}

export function typesetBook(book: BibleBook, bookIdx: number, m: Metrics): Page[] {
  const f = fonts(m)
  const space = measure(f.body, ' ')
  m.space = space
  const pages: Page[] = []
  const linesMode = m.style.verseMode === 'lines'
  const vnGap = m.fs * 0.16

  let page!: Page
  let line = 0
  const newPage = () => {
    page = { book: bookIdx, lines: [], headings: [], title: null, firstRef: null, lastRef: null, blank: false }
    pages.push(page)
    line = 0
  }
  const ensure = (n: number) => {
    if (line + n > m.maxLines) newPage()
  }

  newPage()
  page.title = { name: book.name.toLocaleUpperCase('pt-BR'), subtitle: book.title !== book.name ? book.title : '' }
  line = m.titleLines

  const isPsalms = book.id === 'PSA'

  for (let c = 0; c < book.chapters.length; c++) {
    const supText = book.superscriptions?.[String(c)] ?? ''
    const sup = supText ? wrapText(f.sup, supText, m.blockW * 0.8) : []
    const headLines = 3 + (sup.length ? sup.length + 0.5 : 0)
    const gapBefore = line > (pages.length === 1 ? m.titleLines : 0) ? 1 : 0
    if (line + gapBefore + Math.ceil(headLines) + 2 > m.maxLines) newPage()
    else line += gapBefore
    page.headings.push({ line, chapter: c, label: isPsalms ? 'SALMO' : 'CAPÍTULO', sup, lines: Math.ceil(headLines) })
    line += Math.ceil(headLines)

    const boxes: Box[] = []
    book.chapters[c].forEach((text, v) => {
      words(text).forEach((wd, i) => {
        const segs: Box['segs'] = []
        let w = 0
        if (i === 0 && v === 0) {
          const t = wd.text.toLocaleUpperCase('pt-BR')
          const ww = measure(f.lead, t)
          segs.push({ text: t, role: 'lead', w: ww })
          w += ww
        } else {
          if (i === 0 && !linesMode) {
            const n = String(v + 1)
            const nw = measure(f.vnum, n)
            segs.push({ text: n, role: 'vnum', w: nw })
            w += nw + vnGap
          }
          const role: SegRole = wd.italic ? 'italic' : 'body'
          const ww = measure(wd.italic ? f.italic : f.body, wd.text)
          segs.push({ text: wd.text, role, w: ww })
          w += ww
        }
        boxes.push({ segs, w, chapter: c, verse: v, verseStart: i === 0 })
      })
    })

    let i = 0
    while (i < boxes.length) {
      ensure(1)
      let j = i
      let width = 0
      while (j < boxes.length) {
        if (linesMode && j > i && boxes[j].verseStart) break
        const add = (j > i ? space : 0) + boxes[j].w
        if (width + add > m.blockW && j > i) break
        width += add
        j++
      }
      const endsParagraph = j >= boxes.length || (linesMode && boxes[j].verseStart)
      const gaps = j - i - 1
      let gap = space
      if (!endsParagraph && gaps > 0) {
        const extra = (m.blockW - width) / gaps
        if (extra < space * 1.5) gap = space + extra
      }
      const segs: Seg[] = []
      let x = 0
      for (let k = i; k < j; k++) {
        const b = boxes[k]
        if (linesMode && b.verseStart) {
          const n = String(b.verse + 1)
          const nw = measure(f.vnumLines, n)
          segs.push({ x: -nw - m.fs * 0.38, w: nw, text: n, role: 'vnum', chapter: b.chapter, verse: b.verse })
        }
        let bx = x
        for (const s of b.segs) {
          segs.push({ x: bx, w: s.w, text: s.text, role: s.role, chapter: b.chapter, verse: b.verse })
          bx += s.w + (s.role === 'vnum' ? vnGap : 0)
        }
        const ref = { chapter: b.chapter, verse: b.verse }
        if (!page.firstRef) page.firstRef = ref
        page.lastRef = ref
        x += b.w + gap
      }
      page.lines.push({ line, segs })
      line++
      i = j
    }
  }

  if (pages.length % 2 === 1) pages.push({ book: bookIdx, lines: [], headings: [], title: null, firstRef: null, lastRef: null, blank: true })
  return pages
}

export type Hit = { kind: 'verse'; chapter: number; verse: number } | { kind: 'chapter'; chapter: number }

export function hitTest(page: Page, left: boolean, m: Metrics, px: number, py: number): Hit | null {
  const x0 = left ? m.margin.outer : m.margin.inner
  const x = px - x0
  const ln = Math.floor((py - m.margin.top) / m.lh)
  for (const h of page.headings) {
    if (ln >= h.line && ln < h.line + h.lines && x > -40 && x < m.blockW + 40) return { kind: 'chapter', chapter: h.chapter }
  }
  const line = page.lines.find((l) => l.line === ln)
  if (!line || x < -m.fs * 2.4 || x > m.blockW + m.fs) return null
  let best: Seg | null = null
  let bestD = Infinity
  for (const s of line.segs) {
    const d = x < s.x ? s.x - x : x > s.x + s.w ? x - (s.x + s.w) : 0
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best ? { kind: 'verse', chapter: best.chapter, verse: best.verse } : null
}
