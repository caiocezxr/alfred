import { FONT_BODY, FONT_DISPLAY, PAGE_H, PAGE_W, fonts, type Metrics, type Page, type Seg } from './typesetter'

export type Side = 'left' | 'right'
export type HeaderInfo = { bookName: string; range: string }
export type EditionInfo = { name: string; abbr: string; variant: string; release: string; credit: string }
export type PageMarks = {
  verses: Map<string, { fill: string | null; note: boolean }>
  chapters: Set<number>
  selected: { chapter: number; verse: number } | null
}
export type RenderOptions = { res: number; header: HeaderInfo | null; edition?: EditionInfo; marks?: PageMarks; back?: Page | null }

const INK = '#2a221b'
const INK_SOFT = 'rgba(42, 34, 27, 0.72)'
const RUBRIC = '#8b2b22'
const RULE = 'rgba(42, 34, 27, 0.26)'

let paperBase: HTMLCanvasElement | null = null

function getPaperBase(): HTMLCanvasElement {
  if (paperBase) return paperBase
  const c = document.createElement('canvas')
  c.width = PAGE_W
  c.height = PAGE_H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#f2e6cd'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 110; i++) {
    const x = rnd() * PAGE_W
    const y = rnd() * PAGE_H
    const r = 90 + rnd() * 300
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const warm = rnd() > 0.5
    g.addColorStop(0, warm ? 'rgba(212, 186, 146, 0.05)' : 'rgba(255, 253, 247, 0.06)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  const img = ctx.getImageData(0, 0, PAGE_W, PAGE_H)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 5
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n * 0.85
  }
  ctx.putImageData(img, 0, 0)
  ctx.lineCap = 'round'
  for (let i = 0; i < 380; i++) {
    const x = rnd() * PAGE_W
    const y = rnd() * PAGE_H
    const a = rnd() * Math.PI
    const l = 6 + rnd() * 20
    ctx.strokeStyle = `rgba(150, 120, 80, ${0.025 + rnd() * 0.04})`
    ctx.lineWidth = 0.5 + rnd() * 0.7
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l)
    ctx.stroke()
  }
  paperBase = c
  return c
}

function spaced(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, tracking: number) {
  const chars = [...text]
  const widths = chars.map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1)
  let x = cx - total / 2
  const align = ctx.textAlign
  ctx.textAlign = 'left'
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y)
    x += widths[i] + tracking
  })
  ctx.textAlign = align
  return total
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(Math.PI / 4)
  ctx.fillRect(-r, -r, r * 2, r * 2)
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fill()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const w of text.split(' ')) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width > maxW && cur) {
      out.push(cur)
      cur = w
    } else cur = t
  }
  if (cur) out.push(cur)
  return out
}

export function pageCanvasSize(res: number) {
  return { w: res, h: Math.round((res * PAGE_H) / PAGE_W) }
}

export function renderPage(canvas: HTMLCanvasElement, page: Page | null, side: Side, m: Metrics, opts: RenderOptions) {
  const { w, h } = pageCanvasSize(opts.res)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(w / PAGE_W, 0, 0, h / PAGE_H, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(getPaperBase(), 0, 0, PAGE_W, PAGE_H)

  const innerX = side === 'right' ? 0 : PAGE_W
  const gw = PAGE_W * 0.13
  const g = ctx.createLinearGradient(innerX, 0, side === 'right' ? gw : PAGE_W - gw, 0)
  g.addColorStop(0, 'rgba(96, 70, 40, 0.18)')
  g.addColorStop(0.3, 'rgba(96, 70, 40, 0.08)')
  g.addColorStop(1, 'rgba(96, 70, 40, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  const outerX = side === 'right' ? PAGE_W : 0
  const g2 = ctx.createLinearGradient(outerX, 0, side === 'right' ? PAGE_W - 34 : 34, 0)
  g2.addColorStop(0, 'rgba(120, 95, 60, 0.09)')
  g2.addColorStop(1, 'rgba(120, 95, 60, 0)')
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  if (opts.back && !opts.back.blank && !opts.back.special && opts.back.lines.length) drawShowThrough(ctx, opts.back, side === 'right' ? 'left' : 'right', m)

  if (!page || page.blank) return
  if (page.special) {
    renderSpecial(ctx, page.special, side, opts.edition)
    return
  }

  const f = fonts(m)
  const left = side === 'right' ? m.margin.inner : m.margin.outer
  const cx = left + m.blockW / 2
  const top = m.margin.top
  const baseline = (line: number) => top + line * m.lh + m.lh * 0.72
  ctx.textBaseline = 'alphabetic'

  if (opts.header) {
    const hy = m.margin.top - 96
    ctx.font = `500 ${Math.round(Math.min(m.fs, 44) * 0.56)}px ${FONT_BODY}`
    ctx.fillStyle = INK_SOFT
    spaced(ctx, opts.header.bookName, cx, hy, 7)
    ctx.font = `italic 400 ${Math.round(Math.min(m.fs, 44) * 0.64)}px ${FONT_BODY}`
    ctx.textAlign = side === 'right' ? 'right' : 'left'
    ctx.fillText(opts.header.range, side === 'right' ? left + m.blockW : left, hy)
    ctx.textAlign = 'left'
    ctx.fillStyle = RULE
    ctx.fillRect(left, hy + 22, m.blockW, 1.3)
  }

  if (page.title) {
    const ts = Math.round(m.fs * 2.7)
    const y1 = top + ts * 0.9
    ctx.fillStyle = INK
    ctx.font = `500 ${ts}px ${FONT_DISPLAY}`
    let tw = 0
    let size = ts
    do {
      ctx.font = `500 ${size}px ${FONT_DISPLAY}`
      tw = [...page.title.name].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + size * 0.16 * (page.title.name.length - 1)
      if (tw > m.blockW) size -= 4
    } while (tw > m.blockW && size > 30)
    spaced(ctx, page.title.name, cx, y1, size * 0.16)
    let y = y1
    if (page.title.subtitle) {
      ctx.font = `italic 400 ${Math.round(m.fs * 0.95)}px ${FONT_BODY}`
      ctx.fillStyle = INK_SOFT
      ctx.textAlign = 'center'
      y += m.fs * 1.7
      ctx.fillText(page.title.subtitle, cx, y)
      ctx.textAlign = 'left'
    }
    y += m.fs * 1.25
    ctx.fillStyle = RUBRIC
    diamond(ctx, cx, y, m.fs * 0.11)
    ctx.fillStyle = 'rgba(139, 43, 34, 0.5)'
    ctx.fillRect(cx - m.fs * 3.6, y - 0.7, m.fs * 3.0, 1.4)
    ctx.fillRect(cx + m.fs * 0.6, y - 0.7, m.fs * 3.0, 1.4)
  }

  for (const hd of page.headings) {
    const yTop = top + hd.line * m.lh
    ctx.fillStyle = 'rgba(139, 43, 34, 0.8)'
    ctx.font = `500 ${Math.round(m.fs * 0.46)}px ${FONT_BODY}`
    spaced(ctx, hd.label, cx, yTop + m.lh * 0.62, m.fs * 0.2)
    const ns = Math.round(m.fs * 1.75)
    ctx.font = `400 ${ns}px ${FONT_BODY}`
    ctx.fillStyle = RUBRIC
    ctx.textAlign = 'center'
    const ny = yTop + m.lh * 0.62 + ns * 0.92
    ctx.fillText(String(hd.chapter + 1), cx, ny)
    const nw = ctx.measureText(String(hd.chapter + 1)).width
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(139, 43, 34, 0.35)'
    const ry = ny - ns * 0.3
    ctx.fillRect(cx - nw / 2 - m.fs * 2.6, ry, m.fs * 1.9, 1.2)
    ctx.fillRect(cx + nw / 2 + m.fs * 0.7, ry, m.fs * 1.9, 1.2)
    if (opts.marks?.chapters.has(hd.chapter)) {
      ctx.fillStyle = RUBRIC
      ctx.beginPath()
      ctx.arc(cx + nw / 2 + m.fs * 3.1, ry, m.fs * 0.14, 0, Math.PI * 2)
      ctx.fill()
    }
    if (hd.sup.length) {
      ctx.font = f.sup
      ctx.fillStyle = INK_SOFT
      ctx.textAlign = 'center'
      let sy = yTop + 3 * m.lh + m.lh * 0.45
      for (const l of hd.sup) {
        ctx.fillText(l, cx, sy)
        sy += m.lh * 0.92
      }
      ctx.textAlign = 'left'
    }
  }

  const marks = opts.marks
  if (marks) {
    for (const ln of page.lines) {
      const y = baseline(ln.line)
      const groups = new Map<number, { x0: number; x1: number; chapter: number; verse: number }>()
      for (const s of ln.segs) {
        if (s.role === 'vnum' && s.x < 0) continue
        const key = s.chapter * 10000 + s.verse
        const g = groups.get(key)
        if (g) g.x1 = s.x + s.w
        else groups.set(key, { x0: s.x, x1: s.x + s.w, chapter: s.chapter, verse: s.verse })
      }
      for (const g of groups.values()) {
        const mk = marks.verses.get(`${g.chapter}:${g.verse}`)
        const sel = marks.selected && marks.selected.chapter === g.chapter && marks.selected.verse === g.verse
        const fills = [mk?.fill, sel ? 'rgba(139, 43, 34, 0.11)' : null].filter(Boolean) as string[]
        for (const fill of fills) {
          ctx.fillStyle = fill
          roundRect(ctx, left + g.x0 - m.fs * 0.18, y - m.fs * 0.86, g.x1 - g.x0 + m.fs * 0.36, m.fs * 1.18, m.fs * 0.16)
        }
      }
    }
  }

  const noted = new Set<string>()
  for (const ln of page.lines) {
    const y = baseline(ln.line)
    for (const s of ln.segs) drawSeg(ctx, s, left, y, m, f)
    if (marks) {
      for (const s of ln.segs) {
        const k = `${s.chapter}:${s.verse}`
        if (!noted.has(k) && marks.verses.get(k)?.note) {
          noted.add(k)
          ctx.fillStyle = RUBRIC
          ctx.beginPath()
          ctx.arc(left + m.blockW + m.fs * 0.62, y - m.fs * 0.3, m.fs * 0.13, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }
}

let ghost: HTMLCanvasElement | null = null
const GHOST_K = 0.34

function drawShowThrough(ctx: CanvasRenderingContext2D, back: Page, backSide: Side, m: Metrics) {
  const w = Math.round(PAGE_W * GHOST_K)
  const h = Math.round(PAGE_H * GHOST_K)
  if (!ghost) {
    ghost = document.createElement('canvas')
    ghost.width = w
    ghost.height = h
  }
  const g = ghost.getContext('2d')!
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, w, h)
  g.setTransform(GHOST_K, 0, 0, GHOST_K, 0, 0)
  g.textBaseline = 'alphabetic'
  const f = fonts(m)
  const left = backSide === 'right' ? m.margin.inner : m.margin.outer
  for (const ln of back.lines) {
    const y = m.margin.top + ln.line * m.lh + m.lh * 0.72
    for (const sg of ln.segs) drawSeg(g, sg, left, y, m, f)
  }
  ctx.save()
  ctx.globalAlpha = 0.085
  ctx.translate(PAGE_W, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(ghost, 0, 0, PAGE_W, PAGE_H)
  ctx.restore()
}

function drawSeg(ctx: CanvasRenderingContext2D, s: Seg, left: number, y: number, m: Metrics, f: ReturnType<typeof fonts>) {
  switch (s.role) {
    case 'vnum': {
      const hanging = s.x < 0
      ctx.font = hanging ? f.vnumLines : f.vnum
      ctx.fillStyle = hanging ? 'rgba(139, 43, 34, 0.82)' : RUBRIC
      ctx.fillText(s.text, left + s.x, hanging ? y - m.fs * 0.02 : y - m.fs * 0.36)
      break
    }
    case 'lead':
      ctx.font = f.lead
      ctx.fillStyle = INK
      ctx.fillText(s.text, left + s.x, y)
      break
    case 'italic':
      ctx.font = f.italic
      ctx.fillStyle = INK
      ctx.fillText(s.text, left + s.x, y)
      break
    default:
      ctx.font = f.body
      ctx.fillStyle = INK
      ctx.fillText(s.text, left + s.x, y)
  }
}

function renderSpecial(ctx: CanvasRenderingContext2D, kind: 'credits' | 'titlepage', side: Side, ed?: EditionInfo) {
  const cx = PAGE_W / 2 + (side === 'right' ? 12 : -12)
  ctx.textBaseline = 'alphabetic'
  if (kind === 'titlepage') {
    const y0 = PAGE_H * 0.36
    ctx.fillStyle = INK
    ctx.font = `500 150px ${FONT_DISPLAY}`
    spaced(ctx, 'BÍBLIA', cx, y0, 30)
    ctx.font = `500 78px ${FONT_DISPLAY}`
    spaced(ctx, 'SAGRADA', cx, y0 + 118, 26)
    ctx.fillStyle = RUBRIC
    diamond(ctx, cx, y0 + 214, 8)
    ctx.fillStyle = 'rgba(139, 43, 34, 0.5)'
    ctx.fillRect(cx - 170, y0 + 213, 140, 1.6)
    ctx.fillRect(cx + 30, y0 + 213, 140, 1.6)
    ctx.fillStyle = INK_SOFT
    ctx.font = `italic 400 46px ${FONT_BODY}`
    ctx.textAlign = 'center'
    ctx.fillText('Antigo e Novo Testamento', cx, y0 + 304)
    ctx.font = `500 28px ${FONT_BODY}`
    spaced(ctx, (ed?.name ?? 'BÍBLIA LIVRE').toLocaleUpperCase('pt-BR'), cx, PAGE_H * 0.82, 7)
    ctx.font = `italic 400 28px ${FONT_BODY}`
    ctx.fillText(ed?.variant ?? '', cx, PAGE_H * 0.82 + 48)
    ctx.textAlign = 'left'
    return
  }
  if (!ed) return
  ctx.fillStyle = INK_SOFT
  ctx.font = `400 29px ${FONT_BODY}`
  ctx.textAlign = 'center'
  let y = PAGE_H * 0.68
  for (const l of wrap(ctx, ed.credit, PAGE_W * 0.58)) {
    ctx.fillText(l, cx, y)
    y += 42
  }
  ctx.font = `italic 400 26px ${FONT_BODY}`
  ctx.fillText(`${ed.abbr} · versão ${ed.release} · ${ed.variant}`, cx, y + 30)
  ctx.fillText('Reprodução permitida desde que mencionados fonte e autores.', cx, y + 70)
  ctx.textAlign = 'left'
}
