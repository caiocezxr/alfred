import * as THREE from 'three'
import { compareRef, globalFraction, type Bible, type VerseRef } from './data/bible'
import { HIGHLIGHT_FILL, dailyStore, notesStore } from './data/stores'
import { renderPage, type HeaderInfo, type PageMarks, type Side } from './layout/pageRenderer'
import {
  PAGE_H, PAGE_W, hitTest, metricsFor, spreadForRef, typesetBook,
  type Hit, type Metrics, type Page, type TypeStyle, type VerseMode,
} from './layout/typesetter'
import { playBookClose, playBookOpen, playBookPlace, playPageTurn, setSoundVolume } from './sound'
import { H, O, T, W } from './three/geometry'
import { normalizeBackground, type BackgroundId, type CoverId } from './three/ambience'

export type Pos = { book: number; spread: number }
export type View = { zoom: number; cx: number; cz: number }
export type Selection = { book: number; chapter: number; verse: number | null }

type Turn = {
  dir: 1 | -1
  from: Pos
  to: Pos
  u: number
  v: number
  target: number
  dragging: boolean
  corner: number
  stiffness: number
  sounded: boolean
  strength: number
  tw: { from: number; to: number; v0: number; t: number; dur: number } | null
}

export type FrameState = {
  openT: number
  shiftT: number
  camT: number
  arriveT: number
  glint: number
  fraction: number
  view: View
  left: THREE.Texture
  right: THREE.Texture
  ribbons: { red: RibbonState; gold: RibbonState }
  leaf: null | { front: THREE.Texture; back: THREE.Texture; theta: number; bend: number; dir: 1 | -1; corner: number }
}

export type Snapshot = {
  ref: VerseRef
  label: string
  style: TypeStyle
  isOpen: boolean
  canPrev: boolean
  canNext: boolean
  zoomed: boolean
  sound: boolean
  background: BackgroundId
  cover: CoverId
  ambientSound: boolean
  selection: Selection | null
  marker: VerseRef | null
  markerHere: boolean
  resumed: boolean
  volume: number
  first: VerseRef | null
  last: VerseRef | null
}

export type RibbonState = { mode: 'here' | 'left' | 'right'; depth: number }

export type PointerHit = { side: Side; edge: boolean; corner: number; hit: Hit | null; page: Page }

const STORAGE_KEY = 'ps.bible.v2'
export const FONT_SCALES = [0.84, 0.92, 1, 1.1, 1.22, 1.36, 1.52]
const RES_STEPS = [1024, 1536, 2048, 2560, 3072]

type Spring = { t: number; v: number }

function spring(s: Spring, target: number, k: number, dt: number) {
  const c = 2 * Math.sqrt(k)
  s.v += (k * (target - s.t) - c * s.v) * dt
  s.t += s.v * dt
  if (Math.abs(target - s.t) < 0.0004 && Math.abs(s.v) < 0.003) {
    s.t = target
    s.v = 0
    return false
  }
  return true
}

type LidMode = 'rest' | 'anim' | 'drag'

export class BookController {
  readonly bible: Bible
  style: TypeStyle
  metrics: Metrics
  pos: Pos
  anchor: VerseRef
  selection: Selection | null = null
  sound: boolean
  background: BackgroundId
  cover: CoverId
  ambientSound: boolean
  marker: VerseRef | null = null
  volume = 0.8
  readonly resumed: boolean

  reducedMotion = false
  maxAnisotropy = 8
  maxTexture = 4096
  res = 1536
  focusZoom = 1.6
  worldPerPx = 0.002

  kick: () => void = () => {}
  upload: (t: THREE.Texture) => void = () => {}
  picker: ((clientX: number, clientY: number) => { side: Side; u: number; v: number } | null) | null = null
  ground: ((clientX: number, clientY: number) => { x: number; z: number } | null) | null = null

  private cache = new Map<number, Page[]>()
  private textures = new Map<string, THREE.CanvasTexture>()
  private byPage = new Map<string, THREE.CanvasTexture>()
  private pumpTimer = 0
  private attached = false
  private lastDir: 1 | -1 = 1
  private lastMotionAt = 0
  readonly perf = { frames: 0, slow: 0, worst: 0, renders: [] as number[], reset() { this.frames = 0; this.slow = 0; this.worst = 0; this.renders = [] } }
  private marksCache = new Map<string, { marks: PageMarks; sig: string }>()
  private marksVersion = 0
  private turn: Turn | null = null
  private queue = 0
  private openTarget: 0 | 1 = 0
  private lid = { a: 0, v: 0, mode: 'rest' as LidMode, from: 0, to: 0, v0: 0, t: 0, dur: 1, cue: false, drag: 0, grab: 1 }
  private shift: Spring = { t: 0, v: 0 }
  private cam: Spring = { t: 0, v: 0 }
  private arrive: Spring = { t: 0, v: 0 }
  private glint = -1
  private lidHoverTarget = 0
  private closePending = false
  private fraction = 0
  private hover = { dir: 0 as -1 | 0 | 1, value: 0, corner: 0.6 }
  private view: View = { zoom: 1, cx: 0, cz: 0 }
  private viewCur: View = { zoom: 1, cx: 0, cz: 0 }
  private focusSide: Side | null = null
  private framed = false
  private pendingRes: { res: number; since: number } | null = null
  private listeners = new Set<() => void>()
  private snapshot!: Snapshot

  constructor(bible: Bible) {
    this.bible = bible
    const saved = this.load()
    this.marker = saved?.marker ?? null
    this.volume = saved?.volume ?? 0.8
    setSoundVolume(this.volume)
    this.resumed = !!saved?.ref
    this.style = saved?.style ?? { fontScale: 1, verseMode: 'lines' }
    this.sound = saved?.sound ?? true
    this.background = saved?.background ?? 'luz-da-manha'
    this.cover = saved?.cover ?? 'classico'
    this.ambientSound = saved?.ambientSound ?? true
    this.metrics = metricsFor(this.style)
    this.anchor = saved?.ref ?? { book: 0, chapter: 0, verse: 0 }
    this.pos = saved?.ref ? this.posForRef(this.anchor) : { book: -1, spread: 0 }
    this.fraction = this.fractionOf(this.pos)
    this.refreshSnapshot()
  }

  attach() {
    const unsubDaily = dailyStore.subscribe(() => {
      this.goldRef = dailyStore.get().cursor
      this.kick()
    })
    const unsub = notesStore.subscribe(() => {
      this.marksVersion++
      this.marksCache.clear()
      this.kick()
    })
    this.marksVersion++
    this.marksCache.clear()
    this.attached = true
    return () => {
      unsub()
      unsubDaily()
      this.persist()
      this.attached = false
      clearTimeout(this.pumpTimer)
      this.pumpTimer = 0
      this.disposeTextures()
    }
  }

  pages(book: number): Page[] {
    let p = this.cache.get(book)
    if (!p) {
      if (book === -1) {
        const base = { book: -1, lines: [], headings: [], title: null, firstRef: null, lastRef: null, blank: false }
        p = [
          { ...base, index: 0, special: 'credits' as const },
          { ...base, index: 1, special: 'titlepage' as const },
        ]
      } else {
        p = typesetBook(this.bible, book, this.style)
      }
      this.cache.set(book, p)
    }
    return p
  }

  spreads(book: number) {
    return this.pages(book).length / 2
  }

  next(pos: Pos): Pos | null {
    if (pos.spread + 1 < this.spreads(pos.book)) return { book: pos.book, spread: pos.spread + 1 }
    if (pos.book + 1 < this.bible.books.length) return { book: pos.book + 1, spread: 0 }
    return null
  }

  prev(pos: Pos): Pos | null {
    if (pos.spread > 0) return { book: pos.book, spread: pos.spread - 1 }
    if (pos.book > -1) return { book: pos.book - 1, spread: this.spreads(pos.book - 1) - 1 }
    return null
  }

  pageAt(pos: Pos, side: Side): Page {
    return this.pages(pos.book)[pos.spread * 2 + (side === 'left' ? 0 : 1)]
  }

  posForRef(ref: VerseRef): Pos {
    return { book: ref.book, spread: spreadForRef(this.pages(ref.book), ref) }
  }

  firstRefOf(pos: Pos): VerseRef {
    if (pos.book === -1) return { book: 0, chapter: 0, verse: 0 }
    return this.pageAt(pos, 'left').firstRef ?? this.pageAt(pos, 'right').firstRef ?? { book: pos.book, chapter: 0, verse: 0 }
  }

  fractionOf(pos: Pos): number {
    if (pos.book === -1) return 0
    return globalFraction(this.bible, this.firstRefOf(pos))
  }

  private header(page: Page, side: Side): HeaderInfo | null {
    if (page.book < 0 || page.blank || page.title || !page.firstRef || !page.lastRef) return null
    const r = side === 'left' ? page.firstRef : page.lastRef
    return {
      bookName: this.bible.books[page.book].name.toLocaleUpperCase('pt-BR'),
      range: `${r.chapter + 1}:${r.verse + 1}`,
    }
  }

  private marksFor(page: Page): { marks: PageMarks; sig: string } {
    const empty = { marks: { verses: new Map(), chapters: new Set<number>(), selected: null }, sig: '' }
    if (page.book < 0 || !page.firstRef || !page.lastRef) return empty
    const sel = this.selection
    const selKey = sel && sel.book === page.book ? `${sel.chapter}:${sel.verse}` : ''
    const key = `${page.book}:${page.index}:${this.styleKey()}:${this.marksVersion}:${selKey}`
    const hit = this.marksCache.get(key)
    if (hit) return hit
    const c0 = page.firstRef.chapter
    const c1 = page.lastRef.chapter
    const marks: PageMarks = { verses: new Map(), chapters: new Set(), selected: null }
    const parts: string[] = []
    for (const n of notesStore.get().items) {
      if (n.book !== page.book || n.chapter < c0 || n.chapter > c1) continue
      if (n.verse === null) {
        if (page.headings.some((h) => h.chapter === n.chapter) && n.text.trim()) {
          marks.chapters.add(n.chapter)
          parts.push(`c${n.chapter}`)
        }
        continue
      }
      marks.verses.set(`${n.chapter}:${n.verse}`, { fill: n.color ? HIGHLIGHT_FILL[n.color] : null, note: !!n.text.trim() })
      parts.push(`${n.chapter}:${n.verse}:${n.color ?? ''}:${n.text.trim() ? 1 : 0}`)
    }
    if (sel && sel.book === page.book && sel.verse !== null && sel.chapter >= c0 && sel.chapter <= c1) {
      marks.selected = { chapter: sel.chapter, verse: sel.verse }
      parts.push(`s${sel.chapter}:${sel.verse}`)
    }
    const out = { marks, sig: parts.join('|') }
    this.marksCache.set(key, out)
    return out
  }

  private disposeTextures() {
    for (const t of this.textures.values()) t.dispose()
    this.textures.clear()
    this.byPage.clear()
  }

  private styleKey() {
    return `${this.style.fontScale}${this.style.verseMode}`
  }

  private pageKey(pos: Pos, side: Side) {
    const page = this.pageAt(pos, side)
    const { sig } = this.marksFor(page)
    return `${pos.book}:${page.index}:${this.styleKey()}|${sig}`
  }

  private renderTexture(pos: Pos, side: Side, res: number): THREE.CanvasTexture {
    const t0 = performance.now()
    const page = this.pageAt(pos, side)
    const { marks } = this.marksFor(page)
    const pageKey = this.pageKey(pos, side)
    const canvas = document.createElement('canvas')
    renderPage(canvas, page, side, this.metrics, { res, header: this.header(page, side), edition: this.bible.edition, marks, back: this.backOf(pos, side) })
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = this.maxAnisotropy
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    this.upload(tex)
    this.textures.set(`${pageKey}@${res}`, tex)
    this.byPage.set(pageKey, tex)
    const cap = this.res >= 2560 ? 9 : 14
    while (this.textures.size > cap) {
      const [oldKey, old] = this.textures.entries().next().value as [string, THREE.CanvasTexture]
      this.textures.delete(oldKey)
      const pk = oldKey.slice(0, oldKey.lastIndexOf('@'))
      if (this.byPage.get(pk) === old) this.byPage.delete(pk)
      old.dispose()
    }
    this.perf.renders.push(Math.round(performance.now() - t0))
    if (this.perf.renders.length > 60) this.perf.renders.shift()
    return tex
  }

  private backOf(pos: Pos, side: Side): Page | null {
    if (pos.book < 0) return null
    const pages = this.pages(pos.book)
    const i = pos.spread * 2 + (side === 'left' ? 0 : 1) + (side === 'left' ? -1 : 1)
    return pages[i] ?? null
  }

  private has(pos: Pos, side: Side, res = this.res) {
    return this.textures.has(`${this.pageKey(pos, side)}@${res}`)
  }

  texture(pos: Pos, side: Side): THREE.CanvasTexture {
    const pageKey = this.pageKey(pos, side)
    const key = `${pageKey}@${this.res}`
    const tex = this.textures.get(key)
    if (tex) {
      this.textures.delete(key)
      this.textures.set(key, tex)
      return tex
    }
    const fallback = this.byPage.get(pageKey)
    if (fallback) {
      this.prefetch()
      return fallback
    }
    const moving = !!this.turn || this.lid.mode !== 'rest'
    if (moving) this.prefetch()
    return this.renderTexture(pos, side, moving ? Math.min(this.res, 1024) : this.res)
  }

  private wanted(): [Pos, Side][] {
    const out: [Pos, Side][] = []
    const add = (p: Pos | null) => {
      if (!p) return
      out.push([p, 'left'], [p, 'right'])
    }
    const n = this.next(this.pos)
    const pv = this.prev(this.pos)
    const far = this.res < 2560
    add(this.pos)
    if (this.lastDir === -1) {
      add(pv)
      add(n)
      if (far) add(pv && this.prev(pv))
    } else {
      add(n)
      add(pv)
      if (far) add(n && this.next(n))
    }
    return out
  }

  private get busy() {
    return !!this.turn || this.lid.mode !== 'rest' || performance.now() - this.lastMotionAt < 140
  }

  prefetch() {
    if (this.pumpTimer) return
    this.pumpTimer = window.setTimeout(this.pump, 60)
  }

  private pump = () => {
    this.pumpTimer = 0
    if (!this.attached) return
    if (this.busy) {
      this.pumpTimer = window.setTimeout(this.pump, 160)
      return
    }
    for (const [p, side] of this.wanted()) {
      if (this.has(p, side)) continue
      this.renderTexture(p, side, this.res)
      if (p.book === this.pos.book && p.spread === this.pos.spread) this.kick()
      this.pumpTimer = window.setTimeout(this.pump, 40)
      return
    }
  }

  requestRes(devicePx: number, now: number): boolean {
    const steps = RES_STEPS.filter((r) => r <= this.maxTexture)
    const want = steps.find((r) => r >= devicePx * 1.08) ?? steps[steps.length - 1]
    if (want === this.res || (want < this.res && devicePx > this.res * 0.55)) {
      this.pendingRes = null
      return false
    }
    if (!this.pendingRes || this.pendingRes.res !== want) {
      this.pendingRes = { res: want, since: now }
      return true
    }
    if (now - this.pendingRes.since > 260 && !this.turn) {
      this.res = want
      this.pendingRes = null
      this.prefetch()
      return false
    }
    return true
  }

  get isOpen() {
    return this.openTarget === 1
  }

  get readable() {
    return this.openTarget === 1 && this.lid.mode === 'rest' && this.lid.a > Math.PI - 0.01 && this.cam.t > 0.9
  }

  open() {
    if (this.openTarget === 1) return
    this.openTarget = 1
    this.closePending = false
    this.lidHoverTarget = 0
    if (this.reducedMotion) return this.snapOpen(true)
    this.animateLid(Math.PI)
    if (this.sound) playBookOpen()
    this.refreshSnapshot()
  }

  close() {
    if (this.openTarget === 0) return
    this.openTarget = 0
    this.turn = null
    this.queue = 0
    this.resetView()
    if (this.reducedMotion) return this.snapOpen(false)
    this.closePending = true
    this.refreshSnapshot()
  }

  snapOpen(open: boolean) {
    const v = open ? 1 : 0
    this.openTarget = open ? 1 : 0
    this.lid = { ...this.lid, a: Math.PI * v, v: 0, mode: 'rest', cue: true }
    this.shift = { t: v, v: 0 }
    this.cam = { t: v, v: 0 }
    this.arrive = { t: 1, v: 0 }
    this.glint = -1
    this.closePending = false
    this.refreshSnapshot()
  }

  overClosedBook(clientX: number, clientY: number): boolean {
    if (this.openTarget === 1 || this.lid.mode !== 'rest' || !this.ground) return false
    const g = this.ground(clientX, clientY)
    if (!g) return false
    const m = 0.07
    return g.x > -m && g.x < W + O + m && Math.abs(g.z) < H / 2 + O + m
  }

  setLidHover(on: boolean) {
    const t = on && this.openTarget === 0 && this.lid.mode === 'rest' ? Math.PI * 0.035 : 0
    if (t === this.lidHoverTarget) return
    this.lidHoverTarget = t
    this.kick()
  }

  beginLidDrag(clientX: number, clientY: number): boolean {
    if (this.openTarget === 1 || this.lid.mode === 'anim' || !this.ground) return false
    const g = this.ground(clientX, clientY)
    if (!g) return false
    const L = W + O
    this.lid.grab = THREE.MathUtils.clamp(g.x, L * 0.3, L)
    this.lid.mode = 'drag'
    this.lid.drag = this.lid.a
    this.lid.v = 0
    this.lidHoverTarget = 0
    this.kick()
    return true
  }

  dragLid(clientX: number, clientY: number) {
    if (this.lid.mode !== 'drag' || !this.ground) return
    const g = this.ground(clientX, clientY)
    if (!g) return
    this.lid.drag = Math.acos(THREE.MathUtils.clamp(g.x / this.lid.grab, -1, 1))
    this.kick()
  }

  endLidDrag() {
    const L = this.lid
    if (L.mode !== 'drag') return
    const goOpen = L.v > 2.2 ? true : L.v < -2.2 ? false : L.a > Math.PI / 2
    this.openTarget = goOpen ? 1 : 0
    this.animateLid(goOpen ? Math.PI : 0, L.v)
    if (goOpen && this.sound && L.a < Math.PI * 0.6) playBookOpen()
    this.refreshSnapshot()
  }

  private animateLid(to: number, v0 = 0) {
    const L = this.lid
    const span = Math.abs(to - L.a)
    const base = to > 1 ? 1.25 : 1.1
    L.mode = 'anim'
    L.from = L.a
    L.to = to
    L.t = 0
    L.cue = false
    L.dur = base * (0.4 + 0.6 * Math.min(1, span / Math.PI))
    const vmax = (1.4 * span) / L.dur
    L.v0 = Math.sign(to - L.a) === Math.sign(v0) ? Math.min(Math.abs(v0), vmax) * Math.sign(v0) : 0
    this.kick()
  }

  private startTurn(dir: 1 | -1, corner: number, dragging: boolean, u0 = 0): boolean {
    const to = dir === 1 ? this.next(this.pos) : this.prev(this.pos)
    if (!to || !this.readable) return false
    if (this.reducedMotion && !dragging) {
      this.settle(to)
      return true
    }
    this.lastDir = dir
    this.turn = { dir, from: this.pos, to, u: u0, v: 0, target: 1, dragging, corner, stiffness: 44, sounded: false, strength: 0.55, tw: null }
    return true
  }

  requestTurn(dir: 1 | -1, corner = 0.55) {
    if (!this.isOpen) return
    if (this.turn) {
      if (this.turn.dir === dir && this.turn.target === 1 && !this.turn.dragging) {
        this.queue = Math.min(this.queue + 1, 8)
        this.turn.stiffness = 140
        this.turn.strength = 0.4
        this.turn.tw = null
      }
      return
    }
    const fromHover = this.hover.dir === dir ? this.hover.value : 0
    this.hover.value = 0
    this.startTurn(dir, corner, false, fromHover)
    this.kick()
  }

  forward() {
    if (this.view.zoom > 1.15 && this.focusSide === 'left') return this.focus('right')
    if (this.view.zoom > 1.15 && this.focusSide === 'right') {
      if (!this.next(this.pos)) return
      this.requestTurn(1)
      return this.focus('left')
    }
    this.requestTurn(1)
  }

  backward() {
    if (this.view.zoom > 1.15 && this.focusSide === 'right') return this.focus('left')
    if (this.view.zoom > 1.15 && this.focusSide === 'left') {
      if (!this.prev(this.pos)) return
      this.requestTurn(-1)
      return this.focus('right')
    }
    this.requestTurn(-1)
  }

  beginDrag(dir: 1 | -1, corner: number): boolean {
    if (this.turn || !this.isOpen) return false
    const fromHover = this.hover.dir === dir ? this.hover.value : 0
    this.hover.value = 0
    const ok = this.startTurn(dir, corner, true, fromHover)
    this.kick()
    return ok
  }

  dragTo(u: number) {
    if (this.turn?.dragging) this.turn.target = Math.max(0, Math.min(1, u))
    this.kick()
  }

  endDrag(commit: boolean, strength = 0.5) {
    if (!this.turn?.dragging) return
    this.turn.dragging = false
    this.turn.target = commit ? 1 : 0
    this.turn.stiffness = 64
    this.turn.tw = null
    this.turn.strength = Math.max(0, Math.min(1, strength))
    this.kick()
  }

  get isTurning() {
    return !!this.turn
  }

  setHover(dir: -1 | 0 | 1, corner = 0.55) {
    if (this.turn) return
    const can = dir === 0 || (dir === 1 ? this.next(this.pos) : this.prev(this.pos))
    const nd = can ? dir : 0
    if (nd === this.hover.dir && Math.abs(corner - this.hover.corner) < 0.05) return
    this.hover.dir = nd
    this.hover.corner = corner
    this.kick()
  }

  goTo(ref: VerseRef) {
    this.turn = null
    this.queue = 0
    this.hover.value = 0
    const pos = this.posForRef(ref)
    if (this.sound && this.isOpen && (pos.book !== this.pos.book || pos.spread !== this.pos.spread)) playPageTurn(0.35, true)
    this.settle(pos, ref)
    if (this.view.zoom > 1.15) {
      const leftPage = this.pageAt(pos, 'left')
      const onLeft = leftPage.lastRef && (leftPage.lastRef.chapter > ref.chapter || (leftPage.lastRef.chapter === ref.chapter && leftPage.lastRef.verse >= ref.verse))
      this.focus(onLeft ? 'left' : 'right')
    }
  }

  setStyle(patch: Partial<TypeStyle>) {
    const next = { ...this.style, ...patch }
    if (next.fontScale === this.style.fontScale && next.verseMode === this.style.verseMode) return
    this.style = next
    this.metrics = metricsFor(next)
    this.cache.clear()
    this.marksCache.clear()
    this.disposeTextures()
    this.turn = null
    this.queue = 0
    if (this.pos.book !== -1) this.pos = this.posForRef(this.anchor)
    this.persist()
    this.refreshSnapshot()
    this.prefetch()
  }

  stepFont(step: 1 | -1) {
    const i = FONT_SCALES.indexOf(this.style.fontScale)
    const next = FONT_SCALES[Math.max(0, Math.min(FONT_SCALES.length - 1, (i < 0 ? 2 : i) + step))]
    this.setStyle({ fontScale: next })
  }

  setVerseMode(verseMode: VerseMode) {
    this.setStyle({ verseMode })
  }

  setBackground(b: BackgroundId) {
    this.background = b
    this.persist()
    this.refreshSnapshot()
  }

  setCover(c: CoverId) {
    this.cover = c
    this.persist()
    this.refreshSnapshot()
  }

  get openEased() {
    return this.cam.t
  }

  setAmbientSound(on: boolean) {
    this.ambientSound = on
    this.persist()
    this.refreshSnapshot()
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v))
    setSoundVolume(this.volume)
    this.persist()
    this.refreshSnapshot()
  }

  previewSound() {
    if (this.sound) playPageTurn(0.5)
  }

  setSound(on: boolean) {
    this.sound = on
    this.persist()
    this.refreshSnapshot()
  }

  select(sel: Selection | null) {
    this.selection = sel
    this.refreshSnapshot()
  }

  pointerHit(clientX: number, clientY: number): PointerHit | null {
    if (!this.picker || this.turn || !this.readable) return null
    const p = this.picker(clientX, clientY)
    if (!p) return null
    const page = this.pageAt(this.pos, p.side)
    const px = p.u * PAGE_W
    const py = (1 - p.v) * PAGE_H
    const edge = p.side === 'right' ? p.u > 0.86 : p.u < 0.14
    const corner = Math.max(-1, Math.min(1, ((py / PAGE_H) * 2 - 1) * 1.15))
    const hit = page.special || page.blank ? null : hitTest(page, p.side, this.metrics, px, py)
    return { side: p.side, edge, corner, hit, page }
  }

  private refOnSpread(ref: VerseRef | null) {
    if (!ref || this.pos.book < 0 || ref.book !== this.pos.book) return false
    if (compareRef(ref, this.firstRefOf(this.pos)) < 0) return false
    const n = this.next(this.pos)
    if (n && n.book === this.pos.book) return compareRef(ref, this.firstRefOf(n)) < 0
    return true
  }

  markerHere() {
    return this.refOnSpread(this.marker)
  }

  toggleMarker() {
    if (this.pos.book < 0) return
    this.marker = this.markerHere() ? null : { ...this.anchor }
    this.persist()
    this.refreshSnapshot()
  }

  goToMarker() {
    if (!this.marker) return
    this.goTo(this.marker)
    if (!this.isOpen) this.open()
  }

  private goldRef: VerseRef = dailyStore.get().cursor

  private ribbonFor(ref: VerseRef | null, here: boolean): RibbonState {
    const t = this.turn
    if (here && (!t || (t.dir === 1 && t.u < 0.5))) return { mode: 'here', depth: 0 }
    const f = ref ? globalFraction(this.bible, ref) : 1
    const d = f - this.fraction
    if (here && t && t.dir === 1) return { mode: 'left', depth: 0.006 }
    if (here && t) return { mode: 'right', depth: 0.006 }
    return d < 0 ? { mode: 'left', depth: Math.max(0.006, -d * T) } : { mode: 'right', depth: Math.max(0.006, d * T) }
  }

  private ribbons() {
    return { red: this.ribbonFor(this.marker, this.markerHere()), gold: this.ribbonFor(this.goldRef, this.refOnSpread(this.goldRef)) }
  }

  get inFocus() {
    return this.view.zoom > 1.15 && this.framed
  }

  get zoomed() {
    return this.view.zoom > 1.03
  }

  zoomAt(factor: number, clientX: number, clientY: number) {
    if (!this.isOpen) return
    const z0 = this.view.zoom
    const z1 = THREE.MathUtils.clamp(z0 * factor, 1, 4.2)
    const g = this.ground?.(clientX, clientY)
    if (g) {
      const k = 1 - z0 / z1
      this.view.cx += (g.x - this.view.cx) * k
      this.view.cz += (g.z - this.view.cz) * k
    }
    this.view.zoom = z1
    this.framed = false
    this.focusSide = this.view.cx < 0 ? 'left' : 'right'
    this.clampView()
    this.afterView()
  }

  pan(dxPx: number, dyPx: number) {
    if (!this.zoomed) return
    this.view.cx += dxPx * this.worldPerPx
    this.view.cz += dyPx * this.worldPerPx
    this.focusSide = this.view.cx < 0 ? 'left' : 'right'
    this.clampView()
    this.afterView()
  }

  focus(side: Side) {
    if (!this.isOpen) return
    this.focusSide = side
    this.framed = true
    this.view.zoom = this.focusZoom
    this.view.cx = side === 'left' ? -W / 2 : W / 2
    this.view.cz = -H / 2
    this.clampView()
    this.afterView()
  }

  toggleFocus(side?: Side) {
    if (this.zoomed) this.resetView()
    else this.focus(side ?? this.focusSide ?? 'left')
  }

  resetView() {
    this.view = { zoom: 1, cx: 0, cz: 0 }
    this.afterView()
  }

  private clampView() {
    const z = this.view.zoom
    if (z <= 1.001) {
      this.view = { zoom: 1, cx: 0, cz: 0 }
      return
    }
    const mx = Math.max(0, 1.22 - 0.97 / z)
    const mz = Math.max(0, 0.9 - 0.78 / z)
    this.view.cx = THREE.MathUtils.clamp(this.view.cx, -mx, mx)
    this.view.cz = THREE.MathUtils.clamp(this.view.cz, -mz, mz)
  }

  private afterView() {
    const was = this.snapshot?.zoomed
    if (was !== this.zoomed) this.refreshSnapshot()
    this.kick()
  }

  private settle(pos: Pos, ref?: VerseRef) {
    this.pos = pos
    this.anchor = ref ?? this.firstRefOf(pos)
    this.prefetch()
    if (!ref) {
      this.flushLater()
      return
    }
    this.persist()
    this.refreshSnapshot()
  }

  private flushTimer = 0
  private flushLater() {
    clearTimeout(this.flushTimer)
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0
      if (this.turn) return this.flushLater()
      this.persist()
      this.refreshSnapshot()
    }, 90)
  }

  update(dt: number): boolean {
    dt = Math.min(dt, 1 / 30)
    let moving = false

    if (this.stageUpdate(dt)) moving = true

    const t = this.turn
    if (t) {
      if (t.dragging) {
        const k = 220
        const a = k * (t.target - t.u) - 2 * Math.sqrt(k) * t.v
        t.v += a * dt
        t.u += t.v * dt
      } else {
        if (!t.tw || t.tw.to !== t.target) {
          const span = Math.abs(t.target - t.u)
          const base = t.stiffness >= 140 ? 0.36 : t.stiffness >= 64 ? 0.5 : 0.7
          const dur = base * (0.4 + 0.6 * span)
          const vmax = (1.6 * span) / dur
          const v0 = Math.sign(t.v) === Math.sign(t.target - t.u) ? Math.min(Math.abs(t.v), vmax) * Math.sign(t.v) : 0
          t.tw = { from: t.u, to: t.target, v0, t: 0, dur }
        }
        const w = t.tw
        w.t = Math.min(1, w.t + dt / w.dur)
        const q = Math.pow(w.t, 0.82)
        const ease = q * q * q * (q * (q * 6 - 15) + 10)
        const h10 = w.t * w.t * w.t - 2 * w.t * w.t + w.t
        const prev = t.u
        t.u = w.from + (w.to - w.from) * ease + w.v0 * w.dur * h10
        t.v = (t.u - prev) / Math.max(dt, 1e-3)
        if (w.t >= 1) {
          t.u = w.to
          t.v = 0
        }
      }
      if (t.u < 0) { t.u = 0; t.v = 0 }
      if (t.u > 1) { t.u = 1; t.v = 0 }
      if (!t.sounded && !t.dragging && t.target > 0.5 && t.u > 0.02) {
        t.sounded = true
        if (this.sound) playPageTurn(t.strength, t.stiffness > 100)
      }
      moving = true
      if (!t.dragging && t.tw && t.tw.t >= 1) {
        const done = t.target >= 0.5
        this.turn = null
        if (done) {
          this.settle(t.to)
          if (this.queue > 0) {
            this.queue--
            this.startTurn(t.dir, t.corner, false)
            if (this.turn) {
              ;(this.turn as Turn).stiffness = this.queue > 0 ? 140 : 70
              ;(this.turn as Turn).strength = 0.4
            }
          }
        }
      }
    }

    const hTarget = this.hover.dir !== 0 && !this.turn && this.readable ? 0.05 : 0
    if (Math.abs(this.hover.value - hTarget) > 0.0005) {
      this.hover.value += (hTarget - this.hover.value) * Math.min(1, dt * 11)
      moving = true
    } else this.hover.value = hTarget

    const fTarget = this.turn
      ? THREE.MathUtils.lerp(this.fractionOf(this.turn.from), this.fractionOf(this.turn.to), this.turn.u)
      : this.fractionOf(this.pos)
    if (Math.abs(this.fraction - fTarget) > 0.0002) {
      this.fraction += (fTarget - this.fraction) * Math.min(1, dt * (this.turn ? 30 : 5))
      moving = true
    } else this.fraction = fTarget

    const r = Math.min(1, dt * 8.5)
    const vc = this.viewCur
    const vt = this.view
    if (Math.abs(vc.zoom - vt.zoom) > 0.0005 || Math.abs(vc.cx - vt.cx) > 0.0004 || Math.abs(vc.cz - vt.cz) > 0.0004) {
      vc.zoom += (vt.zoom - vc.zoom) * r
      vc.cx += (vt.cx - vc.cx) * r
      vc.cz += (vt.cz - vc.cz) * r
      moving = true
    } else {
      vc.zoom = vt.zoom
      vc.cx = vt.cx
      vc.cz = vt.cz
    }

    if (moving) this.lastMotionAt = performance.now()
    return moving
  }

  private stageUpdate(dt: number): boolean {
    const PI = Math.PI
    const L = this.lid
    let moving = false

    if (this.reducedMotion && this.arrive.t < 1) this.arrive = { t: 1, v: 0 }
    if (spring(this.arrive, 1, 5.5, dt)) moving = true

    if (this.glint < 0 && this.arrive.t > 0.86 && this.openTarget === 0 && L.mode === 'rest' && !this.reducedMotion) this.glint = 0
    if (this.glint >= 0 && this.glint <= 1) {
      this.glint += dt / 1.6
      if (this.glint > 1 || this.openTarget === 1) this.glint = 2
      moving = true
    }

    if (this.closePending && this.cam.t < 0.62) {
      this.closePending = false
      this.animateLid(0)
    }

    if (L.mode === 'drag') {
      const prev = L.a
      L.a += (L.drag - L.a) * Math.min(1, dt * 22)
      L.v = L.v * 0.55 + ((L.a - prev) / dt) * 0.45
      moving = true
    } else if (L.mode === 'anim') {
      L.t += dt / L.dur
      const k = Math.min(1, L.t)
      const ease = k * k * k * (k * (k * 6 - 15) + 10)
      const h10 = k * k * k - 2 * k * k + k
      const prev = L.a
      L.a = L.from + (L.to - L.from) * ease + L.v0 * L.dur * h10
      L.v = (L.a - prev) / Math.max(dt, 1e-3)
      const opening = L.to > 1
      if (!L.cue && k > (opening ? 0.84 : 0.8)) {
        L.cue = true
        if (this.sound) {
          if (opening) playBookPlace(0.45)
          else playBookClose()
        }
      }
      if (k >= 1) {
        L.a = L.to
        L.v = 0
        L.mode = 'rest'
        this.openTarget = opening ? 1 : 0
        if (!opening && this.sound) playBookPlace(0.2)
        this.refreshSnapshot()
      }
      moving = true
    } else if (this.openTarget === 0 && !this.closePending && L.a < 0.3) {
      const t = this.lidHoverTarget
      if (Math.abs(L.a - t) > 0.0005) {
        L.a += (t - L.a) * Math.min(1, dt * 9)
        moving = true
      } else L.a = t
    }

    const lidT = L.a / PI
    if (L.mode !== 'drag' && spring(this.shift, THREE.MathUtils.clamp((lidT - 0.04) / 0.96, 0, 1), 34, dt)) moving = true
    const camTarget = this.openTarget === 1 && L.mode !== 'drag' && lidT > 0.16 ? 1 : 0
    if (spring(this.cam, camTarget, 7.5, dt)) moving = true
    return moving
  }

  frame(): FrameState {
    const st = { openT: this.lid.a / Math.PI, shiftT: this.shift.t, camT: this.cam.t, arriveT: this.arrive.t, glint: this.glint >= 0 && this.glint <= 1 ? this.glint : -1, ribbons: this.ribbons() }
    const view = { ...this.viewCur }
    const t = this.turn
    if (t) {
      const cur = t.from
      const nxt = t.to
      const front = t.dir === 1 ? this.texture(cur, 'right') : this.texture(nxt, 'right')
      const back = t.dir === 1 ? this.texture(nxt, 'left') : this.texture(cur, 'left')
      const left = t.dir === 1 ? this.texture(cur, 'left') : this.texture(nxt, 'left')
      const right = t.dir === 1 ? this.texture(nxt, 'right') : this.texture(cur, 'right')
      const theta = t.dir === 1 ? Math.PI * t.u : Math.PI * (1 - t.u)
      const bend = Math.sin(Math.PI * t.u) * (1.3 - 1.55 * t.u) * (t.dragging ? 1.15 : 1)
      return { ...st, fraction: this.fraction, view, left, right, leaf: { front, back, theta, bend, dir: t.dir, corner: t.corner } }
    }
    const left = this.texture(this.pos, 'left')
    const right = this.texture(this.pos, 'right')
    if (this.hover.value > 0.001 && this.hover.dir !== 0) {
      const d = this.hover.dir
      const other = d === 1 ? this.next(this.pos) : this.prev(this.pos)
      if (other) {
        const u = this.hover.value
        return {
          ...st,
          fraction: this.fraction,
          view,
          left: d === 1 ? left : this.texture(other, 'left'),
          right: d === 1 ? this.texture(other, 'right') : right,
          leaf: {
            front: d === 1 ? right : this.texture(other, 'right'),
            back: d === 1 ? this.texture(other, 'left') : left,
            theta: d === 1 ? Math.PI * u : Math.PI * (1 - u),
            bend: 2.4 * u,
            dir: d,
            corner: this.hover.corner,
          },
        }
      }
    }
    return { ...st, fraction: this.fraction, view, left, right, leaf: null }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSnapshot = () => this.snapshot

  private refreshSnapshot() {
    const ref = this.anchor
    const book = this.bible.books[ref.book]
    let label = 'Folha de rosto'
    if (this.pos.book >= 0) {
      const last = this.pageAt(this.pos, 'right').lastRef ?? this.pageAt(this.pos, 'left').lastRef ?? ref
      label =
        last.chapter !== ref.chapter
          ? `${book.name} ${ref.chapter + 1}:${ref.verse + 1} – ${last.chapter + 1}:${last.verse + 1}`
          : `${book.name} ${ref.chapter + 1}:${ref.verse + 1}–${last.verse + 1}`
    }
    this.snapshot = {
      ref,
      label,
      style: this.style,
      isOpen: this.isOpen,
      canPrev: !!this.prev(this.pos),
      canNext: !!this.next(this.pos),
      zoomed: this.zoomed,
      sound: this.sound,
      background: this.background,
      cover: this.cover,
      ambientSound: this.ambientSound,
      selection: this.selection,
      marker: this.marker,
      markerHere: this.markerHere(),
      resumed: this.resumed,
      volume: this.volume,
      first: this.pos.book >= 0 ? this.firstRefOf(this.pos) : null,
      last: this.pos.book >= 0 ? (this.pageAt(this.pos, 'right').lastRef ?? this.pageAt(this.pos, 'left').lastRef) : null,
    }
    for (const l of this.listeners) l()
    this.kick()
  }

  private persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ref: this.pos.book === -1 ? null : this.anchor, marker: this.marker, volume: this.volume, style: this.style, sound: this.sound, background: this.background, cover: this.cover, ambientSound: this.ambientSound }),
      )
    } catch {
    }
  }

  private load(): { ref: VerseRef | null; marker: VerseRef | null; volume: number; style: TypeStyle; sound: boolean; background: BackgroundId; cover: CoverId; ambientSound: boolean } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const d = JSON.parse(raw)
      const ref = d?.ref && typeof d.ref.book === 'number' && this.bible.books[d.ref.book] ? (d.ref as VerseRef) : null
      const fontScale = FONT_SCALES.includes(d?.style?.fontScale) ? d.style.fontScale : 1
      const verseMode: VerseMode = d?.style?.verseMode === 'flow' ? 'flow' : 'lines'
      const background: BackgroundId = normalizeBackground(d?.background)
      const cover: CoverId = typeof d?.cover === 'string' ? d.cover : 'classico'
      const okRef = (r: unknown): r is VerseRef => {
        const v = r as VerseRef | null
        return !!v && typeof v.book === 'number' && !!this.bible.books[v.book]?.chapters[v.chapter] && typeof v.verse === 'number'
      }
      const marker = okRef(d?.marker) ? d.marker : null
      const volume = typeof d?.volume === 'number' ? Math.max(0, Math.min(1, d.volume)) : 0.8
      return { ref, marker, volume, style: { fontScale, verseMode }, sound: d?.sound !== false, background, cover, ambientSound: d?.ambientSound !== false }
    } catch {
      return null
    }
  }
}
