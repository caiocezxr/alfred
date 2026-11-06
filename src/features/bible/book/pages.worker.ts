import type { BibleBook, BibleEdition } from '../data/bible'
import { paintPage, setPaperImage, type Marks } from './paint'
import { frontMatter, hitTest, metricsFor, resetMeasure, typesetBook, type Metrics, type Page, type TypeStyle } from './typeset'

type FontSpec = { url: string; weight: string; style: string }
type Cached = { starts: Int32Array; total: number }

type In =
  | { t: 'init'; url: string; fonts: FontSpec[]; paper: ImageBitmap | null; style: TypeStyle; gen: number; priority: number; cached: Cached | null }
  | { t: 'style'; style: TypeStyle; gen: number; priority: number; cached: Cached | null }
  | { t: 'render'; i: number; res: number; key: string; marks: Marks | null; gen: number }
  | { t: 'hit'; id: number; i: number; x: number; y: number; gen: number }

type Scope = { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<In>) => void) | null; fonts: FontFaceSet }

const scope = self as unknown as Scope

let books: BibleBook[] = []
let edition: BibleEdition | null = null
let metrics: Metrics = metricsFor({ fontScale: 1, verseMode: 'lines' })
let gen = 0
let loaded: Promise<void> = new Promise(() => {})
let run = 0
let pages: (Page | undefined)[] = []
let starts: Int32Array | null = null
let done = new Set<number>()
const waiting: Extract<In, { t: 'render' } | { t: 'hit' }>[] = []
const canvas = new OffscreenCanvas(8, 8)

const pause = () => new Promise<void>((r) => setTimeout(r, 0))

function bookOf(i: number) {
  if (!starts || i < 2) return -1
  let b = 0
  while (b + 1 < starts.length && starts[b + 1] <= i) b++
  return b
}

function place(b: number, list: Page[]) {
  if (!starts) return
  list.forEach((p, k) => (pages[starts![b] + k] = p))
}

async function typesetAll(style: TypeStyle, priority: number, cached: Cached | null) {
  const me = ++run
  resetMeasure()
  metrics = metricsFor(style)
  done = new Set()
  const fm = frontMatter()
  const results: Page[][] = []
  pages = []
  pages[0] = fm[0]
  pages[1] = fm[1]
  starts = cached ? cached.starts : null
  const order = [priority, ...books.map((_, i) => i).filter((i) => i !== priority)].filter((i) => i >= 0 && i < books.length)
  for (const b of order) {
    results[b] = typesetBook(books[b], b, metrics)
    if (starts) {
      place(b, results[b])
      done.add(b)
      serveWaiting()
    }
    await pause()
    if (me !== run) return
  }
  const real: number[] = []
  let n = fm.length
  books.forEach((_, b) => {
    real.push(n)
    n += results[b].length
  })
  const same = !!cached && cached.total === n && real.every((s, b) => cached.starts[b] === s)
  if (!same) {
    starts = Int32Array.from(real)
    pages = [...fm]
    books.forEach((_, b) => {
      place(b, results[b])
      done.add(b)
    })
  }
  const meta = new Int16Array(n * 5)
  for (let i = 0; i < n; i++) {
    const p = pages[i]!
    meta[i * 5] = p.book
    meta[i * 5 + 1] = p.firstRef ? p.firstRef.chapter : -1
    meta[i * 5 + 2] = p.firstRef ? p.firstRef.verse : -1
    meta[i * 5 + 3] = p.lastRef ? p.lastRef.chapter : -1
    meta[i * 5 + 4] = p.lastRef ? p.lastRef.verse : -1
  }
  scope.postMessage({ t: 'layout', gen, starts: Int32Array.from(starts!), meta, total: n, changed: !same }, [meta.buffer])
  serveWaiting()
}

function available(i: number) {
  if (i < 2) return true
  const b = bookOf(i)
  return b >= 0 && done.has(b)
}

function serveWaiting() {
  for (let k = 0; k < waiting.length; ) {
    const m = waiting[k]
    if (m.gen !== gen) {
      waiting.splice(k, 1)
      continue
    }
    if (available(m.i)) {
      waiting.splice(k, 1)
      serve(m)
    } else k++
  }
}

function header(i: number, p: Page) {
  if (p.book < 0 || p.blank || p.title || !p.firstRef) return null
  return { bookName: books[p.book].name.toLocaleUpperCase('pt-BR'), number: i - 1 }
}

function serve(m: Extract<In, { t: 'render' } | { t: 'hit' }>) {
  if (m.t === 'hit') {
    const p = pages[m.i]
    const hit = p && !p.special && !p.blank ? hitTest(p, m.i % 2 === 0, metrics, m.x, m.y) : null
    scope.postMessage({ t: 'hit', id: m.id, hit })
    return
  }
  const p = pages[m.i] ?? null
  const back = m.i % 2 === 1 ? pages[m.i + 1] : pages[m.i - 1]
  paintPage(canvas, p, metrics, {
    res: m.res,
    left: m.i % 2 === 0,
    header: p ? header(m.i, p) : null,
    edition,
    marks: m.marks,
    back: back ?? null,
  })
  const bmp = canvas.transferToImageBitmap()
  scope.postMessage({ t: 'page', i: m.i, key: m.key, gen: m.gen, bmp }, [bmp])
}

scope.onmessage = (e: MessageEvent<In>) => {
  const m = e.data
  if (m.t === 'init') {
    gen = m.gen
    if (m.paper) setPaperImage(m.paper)
    loaded = (async () => {
      await Promise.all(
        m.fonts.map(async (f) => {
          try {
            const face = new FontFace('EB Garamond', `url(${f.url})`, { weight: f.weight, style: f.style })
            await face.load()
            scope.fonts.add(face)
          } catch {
            return
          }
        }),
      )
      const data = (await (await fetch(m.url)).json()) as { edition: BibleEdition; books: BibleBook[] }
      books = data.books
      edition = data.edition
    })()
    void loaded.then(() => typesetAll(m.style, m.priority, m.cached))
    return
  }
  if (m.t === 'style') {
    gen = m.gen
    waiting.length = 0
    void loaded.then(() => typesetAll(m.style, m.priority, m.cached))
    return
  }
  if (m.gen !== gen) return
  void loaded.then(() => {
    if (m.gen !== gen) return
    if (available(m.i)) serve(m)
    else waiting.push(m)
  })
}
