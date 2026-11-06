import { FONT_BODY, PAGE_H, PAGE_W, fonts, type Metrics, type Page, type Seg } from './typeset'

export type Marks = {
  verses: [string, string | null, boolean][]
  chapters: number[]
  selected: [number, number] | null
}

export type Edition = { name: string; abbr: string; variant: string; release: string; credit: string }

export type PaintOptions = {
  res: number
  left: boolean
  header: { bookName: string; number: number } | null
  edition: Edition | null
  marks: Marks | null
  back: Page | null
}

type Ctx = OffscreenCanvasRenderingContext2D

const INK = '#2a1e15'
const INK_SOFT = 'rgba(52, 38, 26, 0.7)'
const RUBRIC = '#9a2a1f'

let paperBase: OffscreenCanvas | null = null
let paperImage: ImageBitmap | null = null

export function setPaperImage(img: ImageBitmap | null) {
  paperImage = img
  paperBase = null
}

function getPaperBase(): OffscreenCanvas {
  if (paperBase) return paperBase
  const c = new OffscreenCanvas(PAGE_W, PAGE_H)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#f8f1e1'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  if (paperImage) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = 0.34
    ctx.drawImage(paperImage, 0, 0, PAGE_W, PAGE_H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const img = ctx.getImageData(0, 0, PAGE_W, PAGE_H)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 3.2
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n * 0.9
  }
  ctx.putImageData(img, 0, 0)
  ctx.lineCap = 'round'
  for (let i = 0; i < 160; i++) {
    const x = rnd() * PAGE_W
    const y = rnd() * PAGE_H
    const a = rnd() * Math.PI
    const l = 5 + rnd() * 14
    ctx.strokeStyle = `rgba(150, 120, 80, ${0.012 + rnd() * 0.02})`
    ctx.lineWidth = 0.5 + rnd() * 0.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l)
    ctx.stroke()
  }
  const g = ctx.createRadialGradient(PAGE_W * 0.5, PAGE_H * 0.45, PAGE_H * 0.25, PAGE_W * 0.5, PAGE_H * 0.5, PAGE_H * 0.8)
  g.addColorStop(0, 'rgba(255,250,238,0.05)')
  g.addColorStop(1, 'rgba(176,140,90,0.06)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  paperBase = c
  return c
}

function spaced(ctx: Ctx, text: string, cx: number, y: number, tracking: number, align: 'center' | 'left' | 'right' = 'center') {
  const chars = [...text]
  const widths = chars.map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1)
  let x = align === 'center' ? cx - total / 2 : align === 'right' ? cx - total : cx
  ctx.textAlign = 'left'
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y)
    x += widths[i] + tracking
  })
  return total
}

function diamond(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  ctx.fill()
}

function cross(ctx: Ctx, x: number, y: number, h: number) {
  const t = h * 0.075
  ctx.fillRect(x - t / 2, y - h / 2, t, h)
  ctx.fillRect(x - h * 0.32, y - h * 0.22 - t / 2, h * 0.64, t)
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fill()
}

function wrap(ctx: Ctx, text: string, maxW: number): string[] {
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

export function pageSize(res: number) {
  return { w: res, h: Math.round((res * PAGE_H) / PAGE_W) }
}

export function paintPage(canvas: OffscreenCanvas, page: Page | null, m: Metrics, opts: PaintOptions) {
  const { w, h } = pageSize(opts.res)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(w / PAGE_W, 0, 0, h / PAGE_H, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(getPaperBase(), 0, 0, PAGE_W, PAGE_H)

  if (opts.back && !opts.back.blank && !opts.back.special && opts.back.lines.length) drawShowThrough(ctx, opts.back, !opts.left, m)
  if (!page || page.blank) return
  if (page.special) {
    renderSpecial(ctx, page.special, opts.left, opts.edition)
    return
  }

  const f = fonts(m)
  const left = opts.left ? m.margin.outer : m.margin.inner
  const cx = left + m.blockW / 2
  const top = m.margin.top
  const baseline = (line: number) => top + line * m.lh + m.lh * 0.72
  ctx.textBaseline = 'alphabetic'

  if (opts.header) {
    const hy = m.margin.top - 84
    ctx.font = `500 30px ${FONT_BODY}`
    ctx.fillStyle = INK_SOFT
    spaced(ctx, opts.header.bookName, cx, hy, 8.5)
    ctx.font = `400 35px ${FONT_BODY}`
    ctx.textAlign = opts.left ? 'left' : 'right'
    ctx.fillText(String(opts.header.number), opts.left ? left : left + m.blockW, hy + 1)
    ctx.textAlign = 'left'
  }

  if (page.title) {
    const ts = Math.round(m.fs * 2.3)
    ctx.font = `500 ${Math.round(m.fs * 0.62)}px ${FONT_BODY}`
    ctx.fillStyle = INK_SOFT
    const y0 = top + m.fs * 0.6
    if (page.title.subtitle) {
      const sub = page.title.subtitle.toLocaleUpperCase('pt-BR')
      let size = Math.round(m.fs * 0.62)
      while (size > 18) {
        ctx.font = `500 ${size}px ${FONT_BODY}`
        if ([...sub].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + size * 0.3 * sub.length < m.blockW) break
        size -= 2
      }
      spaced(ctx, sub, cx, y0, size * 0.3)
    }
    let size = ts
    let tw = 0
    do {
      ctx.font = `500 ${size}px ${FONT_BODY}`
      tw = [...page.title.name].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + size * 0.2 * (page.title.name.length - 1)
      if (tw > m.blockW) size -= 4
    } while (tw > m.blockW && size > 30)
    ctx.fillStyle = INK
    const y1 = y0 + m.fs * 0.5 + size * 0.95
    spaced(ctx, page.title.name, cx, y1, size * 0.2)
    const y = y1 + m.fs * 1.05
    ctx.fillStyle = RUBRIC
    diamond(ctx, cx, y, m.fs * 0.13)
    ctx.fillStyle = 'rgba(154, 42, 31, 0.5)'
    ctx.fillRect(cx - m.fs * 3.2, y - 0.9, m.fs * 2.7, 1.8)
    ctx.fillRect(cx + m.fs * 0.5, y - 0.9, m.fs * 2.7, 1.8)
  }

  for (const hd of page.headings) {
    const yTop = top + hd.line * m.lh
    ctx.fillStyle = RUBRIC
    ctx.font = `600 ${Math.round(m.fs * 0.5)}px ${FONT_BODY}`
    spaced(ctx, hd.label, cx, yTop + m.lh * 0.66, m.fs * 0.32)
    const ns = Math.round(m.fs * 2.1)
    ctx.font = `500 ${ns}px ${FONT_BODY}`
    ctx.textAlign = 'center'
    const ny = yTop + m.lh * 0.66 + ns * 0.9
    ctx.fillText(String(hd.chapter + 1), cx, ny)
    const nw = ctx.measureText(String(hd.chapter + 1)).width
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(154, 42, 31, 0.55)'
    const ry = ny - ns * 0.32
    ctx.fillRect(cx - nw / 2 - m.fs * 2.9, ry, m.fs * 2.2, 2.2)
    ctx.fillRect(cx + nw / 2 + m.fs * 0.7, ry, m.fs * 2.2, 2.2)
    if (opts.marks?.chapters.includes(hd.chapter)) {
      ctx.fillStyle = RUBRIC
      ctx.beginPath()
      ctx.arc(cx + nw / 2 + m.fs * 3.3, ry + 1, m.fs * 0.14, 0, Math.PI * 2)
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
  const vmarks = new Map<string, { fill: string | null; note: boolean }>()
  if (marks) for (const [k, fill, note] of marks.verses) vmarks.set(k, { fill, note })
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
        const mk = vmarks.get(`${g.chapter}:${g.verse}`)
        const sel = marks.selected && marks.selected[0] === g.chapter && marks.selected[1] === g.verse
        const fills = [mk?.fill, sel ? 'rgba(154, 42, 31, 0.12)' : null].filter(Boolean) as string[]
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
        if (!noted.has(k) && vmarks.get(k)?.note) {
          noted.add(k)
          ctx.fillStyle = RUBRIC
          ctx.beginPath()
          ctx.arc(left + m.blockW + m.fs * 0.55, y - m.fs * 0.3, m.fs * 0.12, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }
}

let ghost: OffscreenCanvas | null = null
const GHOST_K = 0.34

function drawShowThrough(ctx: Ctx, back: Page, backLeft: boolean, m: Metrics) {
  const w = Math.round(PAGE_W * GHOST_K)
  const h = Math.round(PAGE_H * GHOST_K)
  if (!ghost) ghost = new OffscreenCanvas(w, h)
  const g = ghost.getContext('2d')!
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, w, h)
  g.setTransform(GHOST_K, 0, 0, GHOST_K, 0, 0)
  g.textBaseline = 'alphabetic'
  const f = fonts(m)
  const left = backLeft ? m.margin.outer : m.margin.inner
  for (const ln of back.lines) {
    const y = m.margin.top + ln.line * m.lh + m.lh * 0.72
    for (const sg of ln.segs) drawSeg(g, sg, left, y, m, f)
  }
  ctx.save()
  ctx.globalAlpha = 0.017
  ctx.translate(PAGE_W, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(ghost, 0, 0, PAGE_W, PAGE_H)
  ctx.restore()
}

function drawSeg(ctx: Ctx, s: Seg, left: number, y: number, m: Metrics, f: ReturnType<typeof fonts>) {
  switch (s.role) {
    case 'vnum': {
      const hanging = s.x < 0
      ctx.font = hanging ? f.vnumLines : f.vnum
      ctx.fillStyle = RUBRIC
      ctx.fillText(s.text, left + s.x, hanging ? y - m.fs * 0.03 : y - m.fs * 0.36)
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

function renderSpecial(ctx: Ctx, kind: 'credits' | 'titlepage', left: boolean, ed: Edition | null) {
  const cx = PAGE_W / 2 + (left ? -12 : 12)
  ctx.textBaseline = 'alphabetic'
  if (kind === 'titlepage') {
    const y0 = PAGE_H * 0.36
    ctx.fillStyle = RUBRIC
    cross(ctx, cx, y0 - 230, 120)
    ctx.fillStyle = INK
    ctx.font = `500 132px ${FONT_BODY}`
    spaced(ctx, 'BÍBLIA', cx, y0, 30)
    ctx.font = `500 64px ${FONT_BODY}`
    spaced(ctx, 'SAGRADA', cx, y0 + 104, 30)
    ctx.fillStyle = RUBRIC
    diamond(ctx, cx, y0 + 196, 9)
    ctx.fillStyle = 'rgba(154, 42, 31, 0.5)'
    ctx.fillRect(cx - 190, y0 + 195, 160, 2)
    ctx.fillRect(cx + 30, y0 + 195, 160, 2)
    ctx.fillStyle = INK_SOFT
    ctx.font = `italic 400 48px ${FONT_BODY}`
    ctx.textAlign = 'center'
    ctx.fillText('Antigo e Novo Testamento', cx, y0 + 290)
    ctx.font = `500 30px ${FONT_BODY}`
    spaced(ctx, (ed?.name ?? 'Bíblia Livre').toLocaleUpperCase('pt-BR'), cx, PAGE_H * 0.84, 8)
    ctx.font = `italic 400 30px ${FONT_BODY}`
    ctx.textAlign = 'center'
    ctx.fillText(ed?.variant ?? '', cx, PAGE_H * 0.84 + 50)
    ctx.textAlign = 'left'
    return
  }
  if (!ed) return
  ctx.fillStyle = INK_SOFT
  ctx.font = `400 30px ${FONT_BODY}`
  ctx.textAlign = 'center'
  let y = PAGE_H * 0.66
  for (const l of wrap(ctx, ed.credit, PAGE_W * 0.58)) {
    ctx.fillText(l, cx, y)
    y += 44
  }
  ctx.font = `italic 400 27px ${FONT_BODY}`
  ctx.fillText(`${ed.abbr} · versão ${ed.release} · ${ed.variant}`, cx, y + 32)
  ctx.fillText('Reprodução permitida desde que mencionados fonte e autores.', cx, y + 74)
  ctx.textAlign = 'left'
}
