import f400 from '@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2?url'
import f500 from '@fontsource/eb-garamond/files/eb-garamond-latin-500-normal.woff2?url'
import f600 from '@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2?url'
import f400i from '@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2?url'
import paperUrl from '../../assets/bible-paper/papel_marfin.jpg?url'
import { compareRef, globalFraction, type Bible, type VerseRef } from './data/bible'
import { HIGHLIGHT_FILL, dailyStore, notesStore } from './data/stores'
import { playBookClose, playBookOpen, playBookPlace, playPageTurn, setSoundVolume } from './sound'
import { normalizeBackground, normalizeCover, type BackgroundId, type CoverId } from './ambience'
import { CurlRenderer, type DrawState, type TurnGeom, type Xform } from './book/curl'
import type { Marks } from './book/paint'
import { LH as H, LW as W, PAGE_W, type Hit, type TypeStyle, type VerseMode } from './book/typeset'

export type Selection = { book: number; chapter: number; verse: number | null }
export type Side = 'left' | 'right'
export type Phase = 'closed' | 'opening' | 'open' | 'closing'

export type Snapshot = {
  ref: VerseRef
  label: string
  style: TypeStyle
  isOpen: boolean
  phase: Phase
  ready: boolean
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

export type StageEls = {
  root: HTMLElement
  gl: HTMLCanvasElement
  hit: HTMLElement
  scene: HTMLElement
  openHit: HTMLElement
  stackL: HTMLElement
  stackR: HTMLElement
  ribbonRed: HTMLElement
  ribbonGold: HTMLElement
  tailRed: HTMLElement
  tailGold: HTMLElement
  blockCanvas: HTMLCanvasElement
  coverCanvas: HTMLCanvasElement
}

type V = { x: number; y: number }
type Anim = { from: V; to: V; t0: number; dur: number; complete: boolean; lift: number; ease: (t: number) => number }
type Turn = {
  dir: 1 | -1
  C: V
  P: V
  target: V
  mode: 'peel' | 'drag' | 'anim'
  src: 'pointer' | 'wheel' | 'auto'
  anim?: Anim
  grab: V
  samples: { x: number; t: number }[]
  strength: number
}
type View = { s: number; gx: number; top: number }

const STORAGE_KEY = 'ps.bible.v2'
const LAYOUT_KEY = 'ps.bible.layout.v1'

function toB64(a: Int16Array) {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

function fromB64(s: string) {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}
export const FONT_SCALES = [0.84, 0.92, 1, 1.1, 1.22, 1.36, 1.52]
const BAR = 64
const NAV = 92

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const sm = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeTurn = (t: number) => 0.22 * t + 0.78 * inOutCubic(t)
const outCubic = (t: number) => 1 - Math.pow(1 - t, 3)

function clampP(P: V, C: V): V {
  let x = P.x
  let y = P.y
  for (let it = 0; it < 4; it++) {
    for (const sy of [0, H]) {
      const R = Math.hypot(C.x, C.y - sy)
      const vy = y - sy
      const l = Math.hypot(x, vy)
      if (l > R) {
        x = (x * R) / l
        y = sy + (vy * R) / l
      }
    }
  }
  return { x, y }
}

function geom(t: Turn): TurnGeom {
  const dx = t.C.x - t.P.x
  const dy = t.C.y - t.P.y
  const dist = Math.hypot(dx, dy)
  if (dist < 0.5) return { side: t.dir, A: [t.C.x + 10, t.C.y], d: [1, 0], r: 0.001, f: 1, str: 0 }
  const d: [number, number] = [dx / dist, dy / dist]
  const r = Math.max(0.001, Math.min(50 * sm(0, 0.55 * W, dist) + 7, dist / 3.3) * sm(0, 0.42 * W, 2 * W - dist))
  const sC = (dist + Math.PI * r) / 2
  return {
    side: t.dir,
    A: [t.C.x - d[0] * sC, t.C.y - d[1] * sC],
    d,
    r,
    f: 1 - 0.85 * sm(0, 0.5 * W, dist) * sm(0, 0.5 * W, 2 * W - dist),
    str: sm(0, 26, dist) * sm(0, 0.3 * W, 2 * W - dist),
  }
}

type Saved = { ref: VerseRef | null; marker: VerseRef | null; volume: number; style: TypeStyle; sound: boolean; background: BackgroundId; cover: CoverId; ambientSound: boolean }

export class BookController {
  readonly bible: Bible
  style: TypeStyle
  spread = 0
  anchor: VerseRef
  selection: Selection | null = null
  sound: boolean
  background: BackgroundId
  cover: CoverId
  ambientSound: boolean
  marker: VerseRef | null
  volume: number
  readonly resumed: boolean
  reducedMotion = false

  onVerse: (sel: Selection, at: { x: number; y: number }) => void = () => {}
  onBlank: () => void = () => {}
  onTurned: () => void = () => {}

  private phase: Phase = 'closed'
  private ready = false
  private gen = 0
  private starts: Int32Array = new Int32Array(0)
  private meta: Int16Array = new Int16Array(0)
  private total = 0
  private els: StageEls | null = null
  private renderer: CurlRenderer | null = null
  private worker: Worker | null = null
  private workerReady = false
  private pending = new Map<number, string>()
  private arrived = new Map<number, { bmp: ImageBitmap; key: string }>()
  private warmQueue: number[] = []
  private hitWait = new Map<number, (h: Hit | null) => void>()
  private hitId = 0
  private turn: Turn | null = null
  private queued = 0
  private fade: { from: number; to: number; t0: number; dur: number } | null = null
  private raf = 0
  private lastT = 0
  private lastDraw = 0
  private stageW = 1
  private stageH = 1
  private dpr = 1
  private view: View = { s: 1, gx: 0, top: 0 }
  private zoomAnim: { from: View; to: View; t0: number; dur: number } | null = null
  private focusSide: Side | null = null
  private texRes = 0
  private marksVersion = 0
  private goldRef: VerseRef = dailyStore.get().cursor
  private pendingOpen = false
  private pendingSnap = false
  private timers: number[] = []
  private persistTimer = 0
  private flushTimer = 0
  private ribbonState = ''
  private closedKeys = ['', '']
  private listeners = new Set<() => void>()
  private snapshot!: Snapshot
  private cleanup: (() => void)[] = []

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
    this.anchor = saved?.ref ?? { book: 0, chapter: 0, verse: 0 }
    this.refreshSnapshot()
  }

  get isOpen() {
    return this.phase === 'open' || this.phase === 'opening'
  }

  get zoomed() {
    return this.focusSide !== null
  }

  get inFocus() {
    return this.focusSide !== null
  }

  get spreads() {
    return this.total / 2
  }

  attach() {
    const unsubNotes = notesStore.subscribe(() => {
      this.marksVersion++
      this.requestVisible()
    })
    const unsubDaily = dailyStore.subscribe(() => {
      this.goldRef = dailyStore.get().cursor
      this.syncRibbons()
    })
    this.startWorker()
    return () => {
      unsubNotes()
      unsubDaily()
      this.persist()
      this.detach()
    }
  }

  private detach() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    clearTimeout(this.persistTimer)
    this.persistTimer = 0
    if (this.notifyPending) this.emit()
    this.worker?.terminate()
    this.worker = null
    this.workerReady = false
    for (const a of this.arrived.values()) a.bmp.close()
    this.arrived.clear()
    this.pending.clear()
    for (const cb of this.hitWait.values()) cb(null)
    this.hitWait.clear()
  }

  private unmount() {
    for (const c of this.cleanup) c()
    this.cleanup = []
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.renderer?.dispose()
    this.renderer = null
    this.els = null
    this.warmed = false
    this.ribbonState = ''
    this.closedKeys = ['', '']
  }

  private layoutKey() {
    return `${this.bible.edition.release}|${this.bible.counts.verses}|${this.style.fontScale}|${this.style.verseMode}`
  }

  private hadCache = false

  private whenIdle(fn: () => void) {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const run = () => {
      if (this.raf || this.busy()) {
        window.setTimeout(() => this.whenIdle(fn), 300)
        return
      }
      fn()
    }
    if (ric) ric(run, { timeout: 2000 })
    else window.setTimeout(run, 200)
  }

  private loadCachedLayout() {
    try {
      const d = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null')
      if (!d || d.key !== this.layoutKey() || !Array.isArray(d.starts) || typeof d.meta !== 'string') return false
      const meta = fromB64(d.meta)
      if (meta.length !== d.total * 5) return false
      this.applyLayout(Int32Array.from(d.starts), meta, d.total)
      this.hadCache = true
      return true
    } catch {
      return false
    }
  }

  private storeLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ key: this.layoutKey(), starts: Array.from(this.starts), total: this.total, meta: toB64(this.meta) }))
    } catch {
      return
    }
  }

  private layoutVer = 0

  private applyLayout(starts: Int32Array, meta: Int16Array, total: number) {
    const was = this.ready
    this.starts = starts
    this.meta = meta
    this.total = total
    this.layoutVer++
    this.ready = true
    this.marksCache.clear()
    if (was) {
      this.renderer?.clear()
      for (const a of this.arrived.values()) a.bmp.close()
      this.arrived.clear()
      this.closedKeys = ['', '']
    }
    this.pending.clear()
    this.turn = null
    this.fade = null
    this.queued = 0
    this.spread = this.resumed || this.anchorSet ? this.spreadForRef(this.anchor) : 0
    if (!this.resumed && !this.anchorSet) this.anchor = this.firstRefOf(0)
    this.refreshSnapshot()
    this.updateStacks()
    this.syncRibbons()
    this.requestVisible()
    if (this.phase !== 'open') this.paintClosedFromTextures()
    else this.draw()
    if (this.pendingSnap) {
      this.pendingSnap = false
      this.pendingOpen = false
      this.snapOpen(true)
    } else if (this.pendingOpen) {
      this.pendingOpen = false
      this.open()
    }
  }

  private startWorker() {
    if (!this.ready) this.loadCachedLayout()
    const w = new Worker(new URL('./book/pages.worker.ts', import.meta.url), { type: 'module' })
    this.worker = w
    w.onmessage = (e: MessageEvent) => this.onWorker(e.data)
    const fonts = [
      { url: f400, weight: '400', style: 'normal' },
      { url: f500, weight: '500', style: 'normal' },
      { url: f600, weight: '600', style: 'normal' },
      { url: f400i, weight: '400', style: 'italic' },
    ].map((f) => ({ ...f, url: new URL(f.url, location.href).href }))
    const send = (paper: ImageBitmap | null) => {
      if (this.worker !== w) return
      const cached = this.ready ? { starts: this.starts, total: this.total } : null
      w.postMessage({ t: 'init', url: new URL('/bible/blivre-tr.json', location.href).href, fonts, paper, style: this.style, gen: this.gen, priority: this.anchor.book, cached }, paper ? [paper] : [])
      this.workerReady = true
      this.requestVisible()
      if (this.phase !== 'open') this.paintClosedFromTextures()
    }
    fetch(paperUrl)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then(send, () => send(null))
  }

  private onWorker(m: { t: 'layout'; gen: number; starts: Int32Array; meta: Int16Array; total: number; changed: boolean } | { t: 'page'; i: number; key: string; gen: number; bmp: ImageBitmap } | { t: 'hit'; id: number; hit: Hit | null }) {
    if (m.t === 'layout') {
      if (m.gen !== this.gen) return
      this.workerReady = true
      if (m.changed || !this.ready) this.applyLayout(m.starts, m.meta, m.total)
      if (m.changed || !this.hadCache) this.whenIdle(() => this.storeLayout())
      this.pump()
      return
    }
    if (m.t === 'hit') {
      const cb = this.hitWait.get(m.id)
      this.hitWait.delete(m.id)
      cb?.(m.hit)
      return
    }
    if (this.pending.get(m.i) === m.key) this.pending.delete(m.i)
    if (m.gen !== this.gen || m.key !== this.keyFor(m.i)) {
      m.bmp.close()
      this.pump()
      return
    }
    this.paintClosedFrom(m.i, m.bmp, m.key)
    const old = this.arrived.get(m.i)
    if (old) old.bmp.close()
    this.arrived.set(m.i, { bmp: m.bmp, key: m.key })
    this.scheduleFlush()
    this.pump()
  }

  private anchorSet = false

  mount(els: StageEls) {
    this.els = els
    try {
      this.renderer = new CurlRenderer(els.gl)
    } catch {
      this.renderer = null
    }
    const ro = new ResizeObserver(() => this.relayout())
    ro.observe(els.root)
    this.cleanup.push(() => ro.disconnect())
    this.bindInput(els)
    this.relayout(true)
    this.applyPhaseClasses()
    els.scene.classList.toggle('is-open', this.phase === 'open' || this.phase === 'opening')
    els.scene.classList.add('no-anim')
    const unAnim = requestAnimationFrame(() => requestAnimationFrame(() => els.scene.classList.remove('no-anim')))
    this.cleanup.push(() => cancelAnimationFrame(unAnim))
    this.syncRibbons()
    this.updateStacks()
    if (this.ready) {
      this.requestVisible()
      if (this.phase !== 'open') this.paintClosedFromTextures()
    }
    if (this.arrived.size) this.scheduleFlush()
    if (this.notifyPending) this.queueNotify()
    return () => this.unmount()
  }

  private relayout(first = false) {
    const els = this.els
    if (!els) return
    const r = els.root.getBoundingClientRect()
    this.stageW = Math.max(1, r.width)
    this.stageH = Math.max(1, r.height)
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.zoomAnim = null
    this.applyView(this.targetView())
    const want = this.resFor(this.view.s)
    if (first || !this.texRes) this.texRes = want
    else if (Math.abs(want - this.texRes) / this.texRes > 0.04) {
      clearTimeout(this.resTimer)
      this.resTimer = window.setTimeout(() => {
        this.texRes = want
        this.requestVisible()
        if (this.phase !== 'open') this.closedKeys = ['', '']
      }, 180)
    }
    this.updateStacks()
    this.draw()
  }

  private resTimer = 0
  private pumpTimer = 0

  private resFor(s: number) {
    return Math.round(clamp(W * s * this.dpr * 1.25, 512, 3200))
  }

  private baseView(): View {
    const w = this.stageW
    const h = this.stageH
    const bw = 2 * (W + 14) + 24
    const bh = H + 28 + 18
    const s = Math.min((w - 72) / bw, (h - BAR - NAV) / bh, 1.6)
    return { s, gx: Math.round(w / 2), top: Math.round(BAR + (h - BAR - NAV - bh * s) / 2 + 16 * s) }
  }

  private targetView(): View {
    const base = this.baseView()
    if (!this.focusSide) return base
    const w = this.stageW
    const h = this.stageH
    const s = Math.max(base.s, Math.min((h - 40) / (H + 10), (w - 60) / (W + 30), base.s * 2.2))
    const gx = Math.round(w / 2 + (this.focusSide === 'left' ? 1 : -1) * (W / 2) * s)
    const top = Math.round((h - H * s) / 2 + 6)
    return { s, gx, top }
  }

  private applyView(v: View, canvasFor?: View[]) {
    this.view = v
    const els = this.els
    if (!els) return
    const st = els.root.style
    st.setProperty('--s', v.s.toFixed(5))
    st.setProperty('--gx', v.gx.toFixed(2) + 'px')
    st.setProperty('--top', v.top.toFixed(2) + 'px')
    const views = canvasFor ?? [v]
    const focused = this.focusSide !== null || !!this.zoomAnim
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const q of views) {
      x0 = Math.min(x0, q.gx - (W + 52) * q.s)
      x1 = Math.max(x1, q.gx + (W + 52) * q.s)
      y0 = Math.min(y0, q.top - 72 * q.s)
      y1 = Math.max(y1, q.top + (H + 40) * q.s)
    }
    const cx = Math.max(0, Math.floor(x0))
    const cy = Math.max(focused ? 0 : 56, Math.floor(y0))
    const cw = Math.max(1, Math.min(this.stageW, Math.ceil(x1)) - cx)
    const ch = Math.max(1, Math.min(this.stageH - (focused ? 0 : 70), Math.ceil(y1)) - cy)
    const xf: Xform = { vw: this.stageW, vh: this.stageH, dpr: this.dpr, s: v.s, gx: v.gx, top: v.top, cx, cy, cw, ch }
    this.renderer?.setXform(xf)
    this.renderer && (this.renderer.bias = -Math.log2(1.25))
  }

  private applyPhaseClasses() {
    const els = this.els
    if (!els) return
    const c = els.root.classList
    c.remove('phase-closed', 'phase-opening', 'phase-open', 'phase-closing')
    c.add('phase-' + this.phase)
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.applyPhaseClasses()
    this.syncRibbons()
    this.refreshSnapshot()
  }

  private keyFor(i: number) {
    return `${this.gen}.${this.layoutVer}|${this.texRes}|${this.marksFor(i).sig}`
  }

  private pageBook(i: number) {
    return i >= 0 && i < this.total ? this.meta[i * 5] : -1
  }

  private pageFirst(i: number): VerseRef | null {
    if (i < 0 || i >= this.total || this.meta[i * 5 + 1] < 0) return null
    return { book: this.meta[i * 5], chapter: this.meta[i * 5 + 1], verse: this.meta[i * 5 + 2] }
  }

  private pageLast(i: number): VerseRef | null {
    if (i < 0 || i >= this.total || this.meta[i * 5 + 3] < 0) return null
    return { book: this.meta[i * 5], chapter: this.meta[i * 5 + 3], verse: this.meta[i * 5 + 4] }
  }

  private marksCache = new Map<number, { v: number; sel: string; marks: Marks | null; sig: string }>()

  private marksFor(i: number): { marks: Marks | null; sig: string } {
    const a = this.pageFirst(i)
    const b = this.pageLast(i)
    const sel = this.selection
    const selKey = sel ? `${sel.book}:${sel.chapter}:${sel.verse}` : ''
    const c = this.marksCache.get(i)
    if (c && c.v === this.marksVersion && c.sel === selKey) return c
    let out: { marks: Marks | null; sig: string } = { marks: null, sig: '' }
    if (a && b) {
      const marks: Marks = { verses: [], chapters: [], selected: null }
      const parts: string[] = []
      const inRange = (ch: number, v: number) => compareRef({ book: a.book, chapter: ch, verse: v }, a) >= 0 && compareRef({ book: a.book, chapter: ch, verse: v }, b) <= 0
      for (const n of notesStore.get().items) {
        if (n.book !== a.book || n.chapter < a.chapter || n.chapter > b.chapter) continue
        if (n.verse === null) {
          if (inRange(n.chapter, 0) && n.text.trim()) {
            marks.chapters.push(n.chapter)
            parts.push(`c${n.chapter}`)
          }
          continue
        }
        if (!inRange(n.chapter, n.verse)) continue
        marks.verses.push([`${n.chapter}:${n.verse}`, n.color ? HIGHLIGHT_FILL[n.color] : null, !!n.text.trim()])
        parts.push(`${n.chapter}:${n.verse}:${n.color ?? ''}:${n.text.trim() ? 1 : 0}`)
      }
      if (sel && sel.book === a.book && sel.verse !== null && inRange(sel.chapter, sel.verse)) {
        marks.selected = [sel.chapter, sel.verse]
        parts.push(`s${sel.chapter}:${sel.verse}`)
      }
      out = { marks: parts.length ? marks : null, sig: parts.join('|') }
    }
    this.marksCache.set(i, { v: this.marksVersion, sel: selKey, ...out })
    return out
  }

  private visiblePages(): number[] {
    const k = this.spread
    const out = [2 * k, 2 * k + 1]
    if (this.turn) out.push(...(this.turn.dir > 0 ? [2 * k + 2, 2 * k + 3] : [2 * k - 1, 2 * k - 2]))
    if (this.fade) out.push(2 * this.fade.to, 2 * this.fade.to + 1)
    return out.filter((i) => i >= 0 && i < this.total)
  }

  private requestVisible() {
    if (!this.ready) return
    const k = this.spread
    const list = [...this.visiblePages(), 2 * k + 2, 2 * k + 3, 2 * k - 1, 2 * k - 2, 2 * k + 4, 2 * k + 5, 2 * k - 3, 2 * k - 4]
    this.warmQueue = [...new Set(list)].filter((i) => i >= 0 && i < this.total)
    this.pump()
  }

  private pump() {
    const w = this.worker
    if (!w || !this.workerReady) return
    const vis = this.busy() ? new Set(this.visiblePages()) : null
    while (this.pending.size < 2 && this.warmQueue.length) {
      if (vis && !vis.has(this.warmQueue[0])) {
        if (!this.pumpTimer)
          this.pumpTimer = window.setTimeout(() => {
            this.pumpTimer = 0
            this.pump()
          }, 120)
        break
      }
      const i = this.warmQueue.shift()!
      const key = this.keyFor(i)
      if (this.renderer?.has(i, key) || this.pending.get(i) === key || this.arrived.get(i)?.key === key) continue
      this.pending.set(i, key)
      w.postMessage({ t: 'render', i, res: this.texRes, key, marks: this.marksFor(i).marks, gen: this.gen })
    }
  }

  private busy() {
    return !!this.fade || !!this.zoomAnim || (!!this.turn && this.turn.mode !== 'peel')
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = window.setTimeout(this.flushArrived, 0)
  }

  private flushArrived = () => {
    this.flushTimer = 0
    const vis = new Set(this.visiblePages())
    let drew = false
    for (const [i, got] of this.arrived) {
      const visible = vis.has(i)
      if (this.busy() && !visible) continue
      this.arrived.delete(i)
      if (got.key === this.keyFor(i)) {
        this.renderer?.upload(i, got.bmp, got.key)
        if (visible) drew = true
      }
      got.bmp.close()
      if (!visible) break
    }
    if (drew && !this.raf) this.draw()
    if (this.arrived.size) this.flushTimer = window.setTimeout(this.flushArrived, this.busy() ? 90 : 4)
  }

  private paintClosedFrom(i: number, bmp: ImageBitmap, key: string) {
    const els = this.els
    if (!els || (this.phase === 'open' && !this.closingPaint)) return
    const slot = i === 2 * this.spread ? 0 : i === 2 * this.spread + 1 ? 1 : -1
    if (slot < 0 || this.closedKeys[slot] === key) return
    const cv = slot === 0 ? els.coverCanvas : els.blockCanvas
    if (cv.width !== bmp.width || cv.height !== bmp.height) {
      cv.width = bmp.width
      cv.height = bmp.height
    }
    cv.getContext('2d')?.drawImage(bmp, 0, 0)
    this.closedKeys[slot] = key
  }

  private paintClosedFromTextures() {
    if (!this.els || !this.ready) return
    for (const slot of [0, 1]) {
      const i = 2 * this.spread + slot
      const key = this.keyFor(i)
      if (this.closedKeys[slot] === key) continue
      const a = this.arrived.get(i)
      if (a && a.key === key) this.paintClosedFrom(i, a.bmp, key)
      else this.forceRerender(i)
    }
    this.requestVisible()
  }

  private closedFresh() {
    return [0, 1].every((slot) => this.closedKeys[slot] === this.keyFor(2 * this.spread + slot))
  }

  private forceRerender(i: number) {
    const w = this.worker
    if (!w || !this.workerReady) return
    const key = this.keyFor(i)
    this.pending.set(i, key)
    w.postMessage({ t: 'render', i, res: this.texRes, key, marks: this.marksFor(i).marks, gen: this.gen })
  }

  spreadForRef(ref: VerseRef): number {
    if (!this.total) return 0
    const start = this.starts[ref.book] ?? 2
    const end = ref.book + 1 < this.starts.length ? this.starts[ref.book + 1] : this.total
    let best = start
    for (let i = start; i < end; i++) {
      const f = this.pageFirst(i)
      if (!f) continue
      if (compareRef(f, ref) <= 0) best = i
      else break
    }
    return Math.floor(best / 2)
  }

  firstRefOf(spread: number): VerseRef {
    const a = this.pageFirst(2 * spread) ?? this.pageFirst(2 * spread + 1)
    if (a) return a
    const b = this.pageBook(2 * spread + 1)
    return { book: Math.max(0, b), chapter: 0, verse: 0 }
  }

  private lastRefOf(spread: number): VerseRef | null {
    return this.pageLast(2 * spread + 1) ?? this.pageLast(2 * spread)
  }

  private canTurn(dir: number) {
    return this.ready && (dir > 0 ? this.spread < this.spreads - 1 : this.spread > 0)
  }

  private refOnSpread(ref: VerseRef | null) {
    if (!ref || !this.ready || this.spread === 0) return false
    return this.spreadForRef(ref) === this.spread
  }

  markerHere() {
    return this.refOnSpread(this.marker)
  }

  open() {
    if (this.phase === 'open' || this.phase === 'opening') return
    if (!this.ready) {
      this.pendingOpen = true
      return
    }
    if (this.phase === 'closing') return
    const els = this.els
    this.requestVisible()
    this.paintClosedFromTextures()
    if (!els || this.reducedMotion) {
      els?.scene.classList.add('no-anim', 'is-open')
      this.setPhase('open')
      this.afterOpen()
      return
    }
    els.scene.classList.remove('no-anim', 'hover')
    this.setPhase('opening')
    if (this.sound) playBookOpen()
    requestAnimationFrame(() => els.scene.classList.add('is-open'))
    this.later(() => {
      if (this.sound) playBookPlace(0.45)
    }, 1080)
    this.later(() => {
      if (this.phase !== 'opening') return
      this.setPhase('open')
      this.afterOpen()
    }, 1340)
  }

  private afterOpen() {
    this.updateStacks()
    this.syncRibbons()
    this.draw()
  }

  close() {
    if (this.phase !== 'open') {
      this.pendingOpen = false
      return
    }
    this.turn = null
    this.queued = 0
    this.fade = null
    const els = this.els
    if (this.focusSide) {
      this.focusSide = null
      this.applyView(this.targetView())
    }
    this.closingPaint = true
    this.paintClosedFromTextures()
    if (!els || this.reducedMotion) {
      els?.scene.classList.add('no-anim')
      els?.scene.classList.remove('is-open')
      this.setPhase('closed')
      return
    }
    const begin = () => {
      els.scene.classList.add('no-anim', 'is-open')
      void els.scene.offsetWidth
      els.scene.classList.remove('no-anim')
      this.setPhase('closing')
      this.later(() => els.scene.classList.remove('is-open'), 380)
      this.later(() => this.sound && playBookClose(), 380 + 820)
      this.later(() => this.sound && playBookPlace(0.2), 380 + 1500)
      this.later(() => {
        this.closingPaint = false
        this.setPhase('closed')
      }, 380 + 1650)
    }
    const t0 = performance.now()
    const wait = () => {
      if (this.closedFresh() || performance.now() - t0 > 420) begin()
      else this.later(wait, 24)
    }
    wait()
  }

  private closingPaint = false

  snapOpen(open: boolean) {
    const els = this.els
    if (!this.ready) {
      this.pendingSnap = open
      return
    }
    els?.scene.classList.add('no-anim')
    els?.scene.classList.toggle('is-open', open)
    this.setPhase(open ? 'open' : 'closed')
    if (open) this.afterOpen()
    else this.paintClosedFromTextures()
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms))
  }

  forward() {
    if (this.focusSide === 'left') return this.focus('right')
    if (this.focusSide === 'right') {
      if (!this.canTurn(1)) return
      this.requestTurn(1)
      return this.focus('left')
    }
    this.requestTurn(1)
  }

  backward() {
    if (this.focusSide === 'right') return this.focus('left')
    if (this.focusSide === 'left') {
      if (!this.canTurn(-1)) return
      this.requestTurn(-1)
      return this.focus('right')
    }
    this.requestTurn(-1)
  }

  private newTurn(dir: 1 | -1, C: V, mode: Turn['mode'], src: Turn['src']): Turn {
    return { dir, C, P: { ...C }, target: { ...C }, mode, src, grab: { x: 0, y: 0 }, samples: [], strength: 0.55 }
  }

  requestTurn(dir: 1 | -1, fast = false) {
    if (this.phase !== 'open' || this.fade) return
    if (this.turn && this.turn.mode === 'anim') {
      if (this.turn.anim?.complete && this.turn.dir === dir && Math.abs(this.queued) < 3) {
        const target = this.spread + this.queued + dir * 2
        if (target < 0 || target > this.spreads - 1) return
        this.queued += dir
        const a = this.turn.anim
        if (a.t0 >= 0) {
          const now = performance.now()
          const p = clamp((now - a.t0) / a.dur, 0, 1)
          a.dur *= 0.62
          a.t0 = now - p * a.dur
        } else a.dur *= 0.62
      }
      return
    }
    if (this.turn && this.turn.mode === 'drag') return
    if (!this.canTurn(dir)) return
    if (this.reducedMotion) {
      this.jump(this.spread + dir, 240)
      return
    }
    const C = this.turn && this.turn.dir === dir ? this.turn.C : { x: W, y: H }
    const from = this.turn && this.turn.dir === dir ? { ...this.turn.P } : { ...C }
    const t = this.newTurn(dir, C, 'anim', 'auto')
    t.P = from
    t.anim = { from, to: { x: -W, y: C.y }, t0: -1, dur: fast ? 520 : 820, complete: true, lift: C.y >= H - 1 ? -0.04 * H : C.y <= 1 ? 0.04 * H : 0, ease: easeTurn }
    this.turn = t
    if (this.sound) playPageTurn(fast ? 0.4 : 0.55, fast)
    this.syncRibbons()
    this.requestVisible()
    this.kick()
  }

  private jump(target: number, dur = 440, ref?: VerseRef) {
    target = clamp(target, 0, Math.max(0, this.spreads - 1))
    if (this.phase !== 'open') {
      this.settle(target, ref)
      if (this.phase === 'closed') this.paintClosedFromTextures()
      return
    }
    if (target === this.spread) {
      this.settle(target, ref)
      return
    }
    this.turn = null
    this.queued = 0
    this.fade = { from: this.spread, to: target, t0: performance.now(), dur: this.reducedMotion ? Math.min(dur, 240) : dur }
    this.fadeRef = ref
    if (this.sound) playPageTurn(0.35, true)
    this.requestVisible()
    this.syncRibbons()
    this.kick()
  }

  private fadeRef: VerseRef | undefined

  goTo(ref: VerseRef) {
    this.anchor = ref
    this.anchorSet = true
    if (!this.ready) {
      this.refreshSnapshot()
      return
    }
    const s = this.spreadForRef(ref)
    if (Math.abs(s - this.spread) === 1 && this.phase === 'open' && !this.reducedMotion && !this.turn) {
      this.requestTurn(s > this.spread ? 1 : -1)
      this.pendingAnchor = ref
    } else this.jump(s, 440, ref)
    if (this.focusSide) {
      const leftLast = this.pageLast(2 * s)
      const onLeft = !!leftLast && compareRef(leftLast, ref) >= 0
      this.focus(onLeft ? 'left' : 'right')
    }
  }

  private pendingAnchor: VerseRef | null = null

  focusAnchor() {
    const leftLast = this.pageLast(2 * this.spread)
    const onLeft = !!leftLast && compareRef(leftLast, this.anchor) >= 0
    this.focus(onLeft || this.spread === 0 ? 'left' : 'right')
  }

  private settle(spread: number, ref?: VerseRef) {
    this.spread = spread
    this.anchor = ref ?? this.pendingAnchor ?? this.firstRefOf(spread)
    this.pendingAnchor = null
    this.updateStacks()
    this.syncRibbons()
    this.requestVisible()
    clearTimeout(this.persistTimer)
    this.persistTimer = window.setTimeout(() => this.whenIdle(() => this.persist()), 400)
    this.refreshSnapshot()
  }

  setStyle(patch: Partial<TypeStyle>) {
    const next = { ...this.style, ...patch }
    if (next.fontScale === this.style.fontScale && next.verseMode === this.style.verseMode) return
    this.style = next
    this.gen++
    this.ready = false
    this.workerReady = false
    this.turn = null
    this.queued = 0
    this.fade = null
    this.anchorSet = true
    this.renderer?.clear()
    for (const a of this.arrived.values()) a.bmp.close()
    this.arrived.clear()
    this.pending.clear()
    this.marksCache.clear()
    this.closedKeys = ['', '']
    this.loadCachedLayout()
    this.worker?.postMessage({ t: 'style', style: next, gen: this.gen, priority: this.anchor.book, cached: this.ready ? { starts: this.starts, total: this.total } : null })
    this.workerReady = !!this.worker
    this.requestVisible()
    this.persist()
    this.refreshSnapshot()
  }

  stepFont(step: 1 | -1) {
    const i = FONT_SCALES.indexOf(this.style.fontScale)
    this.setStyle({ fontScale: FONT_SCALES[clamp((i < 0 ? 2 : i) + step, 0, FONT_SCALES.length - 1)] })
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

  setAmbientSound(on: boolean) {
    this.ambientSound = on
    this.persist()
    this.refreshSnapshot()
  }

  setVolume(v: number) {
    this.volume = clamp(v, 0, 1)
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
    const prev = this.selection
    this.selection = sel
    if (prev?.book !== sel?.book || prev?.chapter !== sel?.chapter || prev?.verse !== sel?.verse) this.requestVisible()
    this.refreshSnapshot()
  }

  toggleMarker() {
    if (this.phase !== 'open' || this.spread === 0) return
    this.marker = this.markerHere() ? null : { ...this.anchor }
    this.persist()
    this.syncRibbons()
    this.refreshSnapshot()
  }

  goToMarker() {
    if (!this.marker) return
    this.goTo(this.marker)
    if (!this.isOpen) this.open()
  }

  focus(side: Side) {
    if (this.phase !== 'open') return
    if (this.focusSide === side && !this.zoomAnim) return
    this.focusSide = side
    this.animateView()
    this.refreshSnapshot()
  }

  toggleFocus(side?: Side) {
    if (this.focusSide) this.resetView()
    else this.focus(side ?? 'left')
  }

  resetView() {
    if (!this.focusSide) return
    this.focusSide = null
    this.animateView()
    this.refreshSnapshot()
  }

  private animateView() {
    const to = this.targetView()
    if (this.reducedMotion || !this.els) {
      this.zoomAnim = null
      this.applyView(to)
      this.afterZoom()
      return
    }
    this.zoomAnim = { from: { ...this.view }, to, t0: -1, dur: 520 }
    this.kick()
  }

  private afterZoom() {
    const res = this.resFor(this.view.s)
    if (Math.abs(res - this.texRes) / this.texRes > 0.04) {
      this.texRes = res
      this.requestVisible()
    }
    this.updateStacks()
    this.draw()
  }

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    const dt = this.lastT ? Math.min(50, now - this.lastT) : 16
    this.lastT = now
    let more = false
    if (this.zoomAnim) {
      const z = this.zoomAnim
      if (z.t0 < 0) z.t0 = now
      const t = clamp((now - z.t0) / z.dur, 0, 1)
      const e = inOutCubic(t)
      const v = { s: z.from.s + (z.to.s - z.from.s) * e, gx: z.from.gx + (z.to.gx - z.from.gx) * e, top: z.from.top + (z.to.top - z.from.top) * e }
      if (t >= 1) {
        this.zoomAnim = null
        this.applyView(z.to)
        this.afterZoom()
      } else {
        this.applyView(v, [z.from, z.to])
        more = true
      }
    }
    if (this.fade) {
      if (now - this.fade.t0 >= this.fade.dur) {
        const to = this.fade.to
        const ref = this.fadeRef
        this.fade = null
        this.fadeRef = undefined
        this.settle(to, ref)
        this.onTurned()
      } else more = true
    }
    const t = this.turn
    if (t) {
      if (t.mode === 'anim' && t.anim) {
        const a = t.anim
        if (a.t0 < 0) a.t0 = now
        const p = clamp((now - a.t0) / a.dur, 0, 1)
        const e = a.ease(p)
        t.P = clampP({ x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e + a.lift * Math.sin(Math.PI * e) }, t.C)
        if (p >= 1) {
          this.finishTurn(a.complete)
          if (this.turn) more = true
        } else more = true
      } else {
        const k = 1 - Math.exp(-dt / (t.mode === 'drag' ? (t.src === 'wheel' ? 42 : 24) : 70))
        t.P = { x: t.P.x + (t.target.x - t.P.x) * k, y: t.P.y + (t.target.y - t.P.y) * k }
        const rem = Math.hypot(t.target.x - t.P.x, t.target.y - t.P.y)
        const home = Math.hypot(t.C.x - t.P.x, t.C.y - t.P.y)
        if (t.mode === 'peel' && t.target.x === t.C.x && t.target.y === t.C.y && home < 0.35) this.turn = null
        else if (rem > 0.05) more = true
      }
    }
    this.draw(now)
    if (more) this.kick()
    else {
      this.lastT = 0
      if (this.notifyPending) this.emit()
    }
  }

  private finishTurn(complete: boolean) {
    const dir = this.turn?.dir ?? 1
    this.turn = null
    if (complete) {
      this.settle(clamp(this.spread + dir, 0, this.spreads - 1))
      this.onTurned()
      if (this.queued !== 0) {
        const qd = Math.sign(this.queued) as 1 | -1
        this.queued -= qd
        if (qd === dir && this.canTurn(qd)) this.requestTurn(qd, true)
        else this.queued = 0
      }
    } else {
      this.queued = 0
      this.syncRibbons()
    }
  }

  private drawState(now: number): DrawState {
    const k = this.spread
    if (this.fade) {
      const t = clamp((now - this.fade.t0) / this.fade.dur, 0, 1)
      return { left: 2 * this.fade.from, right: 2 * this.fade.from + 1, fade: { left: 2 * this.fade.to, right: 2 * this.fade.to + 1, t: inOutCubic(t) } }
    }
    if (this.turn) {
      const g = geom(this.turn)
      if (this.turn.dir > 0) return { left: 2 * k, right: 2 * k + 3, leaf: { side: 1, front: 2 * k + 1, back: 2 * k + 2, geom: g } }
      return { left: 2 * k - 2, right: 2 * k + 1, leaf: { side: -1, front: 2 * k, back: 2 * k - 1, geom: g } }
    }
    return { left: 2 * k, right: 2 * k + 1 }
  }

  private warmed = false

  private draw(now = performance.now()) {
    const r = this.renderer
    if (!r || !this.ready) return
    this.lastDraw = now
    const st = this.drawState(now)
    if (!this.warmed && this.phase === 'open') {
      this.warmed = true
      const fake = this.newTurn(1, { x: W, y: H }, 'anim', 'auto')
      fake.P = { x: 0, y: H * 0.95 }
      r.draw({ left: st.left, right: st.right, leaf: { side: 1, front: st.right, back: st.left, geom: geom(fake) } })
    }
    r.draw(st)
  }

  private wake = () => {
    if (this.phase === 'open' && !this.raf && performance.now() - this.lastDraw > 900) this.draw()
  }

  private syncRibbons() {
    const els = this.els
    if (!els) return
    const moving = !!this.fade || (!!this.turn && this.turn.mode !== 'peel')
    const open = this.phase === 'open'
    const red = open && !moving && this.markerHere()
    const gold = open && !moving && this.refOnSpread(this.goldRef)
    const key = `${red}|${gold}|${!!this.marker}`
    if (key === this.ribbonState) return
    this.ribbonState = key
    els.ribbonRed.classList.toggle('on', red)
    els.ribbonGold.classList.toggle('on', gold)
    els.tailRed.classList.toggle('on', !!this.marker && !red)
    els.tailGold.classList.toggle('on', !gold)
  }

  private updateStacks() {
    const els = this.els
    if (!els) return
    const s = this.view.s
    const prog = this.ready && this.spread > 0 ? globalFraction(this.bible, this.anchor) : 0
    const nl = Math.round(3 + 9 * prog)
    const nr = Math.round(3 + 9 * (1 - prog))
    const make = (n: number, side: number) => {
      const out: string[] = []
      for (let i = 1; i <= n; i++) {
        const dx = side * (1.8 + i * 1.0) * s
        const dy = (0.9 + i * 0.58) * s
        out.push(`${dx.toFixed(2)}px ${dy.toFixed(2)}px 0 ${i % 3 === 0 ? '#bfa983' : i % 2 ? '#f1e6cf' : '#d9c8a6'}`)
      }
      out.push(`${(side * (2.8 + n * 1.0) * s).toFixed(2)}px ${((1.6 + n * 0.58) * s).toFixed(2)}px 0 rgba(92,58,32,.75)`)
      out.push(`${(side * (n + 2) * s).toFixed(2)}px ${(n * 0.6 * s + 3).toFixed(2)}px ${(6 * s).toFixed(2)}px rgba(20,10,4,.45)`)
      return out.join(',')
    }
    els.stackL.style.boxShadow = make(nl, -1)
    els.stackR.style.boxShadow = make(nr, 1)
  }

  private local(e: { clientX: number; clientY: number }): V {
    const r = this.els!.root.getBoundingClientRect()
    return { x: (e.clientX - r.left - this.view.gx) / this.view.s, y: (e.clientY - r.top - this.view.top) / this.view.s }
  }

  private hitAt(i: number, px: number, py: number): Promise<Hit | null> {
    const w = this.worker
    if (!w || !this.workerReady) return Promise.resolve(null)
    const id = ++this.hitId
    return new Promise((res) => {
      this.hitWait.set(id, res)
      w.postMessage({ t: 'hit', id, i, x: px, y: py, gen: this.gen })
    })
  }

  private bindInput(els: StageEls) {
    const hit = els.hit
    let press: { id: number; x: number; y: number; t: number; dir: 1 | -1; edge: boolean; started: boolean; tp: V } | null = null

    const onMove = (e: PointerEvent) => {
      if (this.phase !== 'open') return
      const p = this.local(e)
      const t = this.turn
      if (press && press.id === e.pointerId) {
        if (!press.started && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 7) {
          if (this.fade || (t && t.mode === 'anim') || !this.canTurn(press.dir) || this.reducedMotion) {
            press.started = true
            return
          }
          const tp = press.tp
          const cy = tp.y < 0.2 * H ? 0 : tp.y > 0.8 * H ? H : clamp(tp.y, 0, H)
          const C = { x: W, y: cy }
          const prevP = t && t.dir === press.dir && t.C.y === cy ? { ...t.P } : { ...C }
          const nt = this.newTurn(press.dir, C, 'drag', 'pointer')
          nt.P = prevP
          nt.grab = { x: C.x - tp.x, y: C.y - tp.y }
          nt.samples = [{ x: tp.x, t: performance.now() }]
          this.turn = nt
          press.started = true
          hit.classList.add('grabbing')
          this.syncRibbons()
          this.requestVisible()
        }
        const cur = this.turn
        if (cur && cur.mode === 'drag' && cur.src === 'pointer') {
          const tp = { x: cur.dir * p.x, y: p.y }
          const now = performance.now()
          cur.samples.push({ x: tp.x, t: now })
          while (cur.samples.length > 2 && now - cur.samples[0].t > 90) cur.samples.shift()
          cur.target = clampP({ x: tp.x + cur.grab.x, y: tp.y + cur.grab.y }, cur.C)
          this.kick()
        }
        return
      }
      if ((t && (t.mode === 'anim' || t.mode === 'drag')) || this.fade) return
      const dir: 1 | -1 = p.x >= 0 ? 1 : -1
      const tp = { x: dir * p.x, y: p.y }
      const u = tp.x / W
      const onPage = u >= 0 && u <= 1.02 && tp.y >= 0 && tp.y <= H
      hit.classList.toggle('edge', onPage && u > 0.86 && this.canTurn(dir))
      const corner = !this.reducedMotion && u > 0.83 && u <= 1.04 && (tp.y < 0.14 * H || tp.y > 0.86 * H) && tp.y > -10 && tp.y < H + 10 && this.canTurn(dir)
      if (corner) {
        const cy = tp.y < H / 2 ? 0 : H
        if (!t || t.dir !== dir || t.C.y !== cy) {
          this.turn = this.newTurn(dir, { x: W, y: cy }, 'peel', 'pointer')
          this.requestVisible()
        }
        const pull = clamp(1 - (W - tp.x) / (0.17 * W), 0, 1)
        const amt = 26 + 16 * pull
        this.turn!.target = clampP({ x: W - amt * 1.25, y: cy === 0 ? amt * 0.8 : H - amt * 0.8 }, this.turn!.C)
        this.kick()
      } else if (t && t.mode === 'peel') {
        t.target = { ...t.C }
        this.kick()
      }
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || this.phase !== 'open') return
      const p = this.local(e)
      const dir: 1 | -1 = p.x >= 0 ? 1 : -1
      const tp = { x: dir * p.x, y: p.y }
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dir, edge: tp.x / W > 0.86, started: false, tp }
      hit.setPointerCapture(e.pointerId)
    }

    const onUp = (e: PointerEvent) => {
      const pr = press
      if (!pr || pr.id !== e.pointerId) return
      press = null
      hit.classList.remove('grabbing')
      if (hit.hasPointerCapture(e.pointerId)) hit.releasePointerCapture(e.pointerId)
      const t = this.turn
      if (t && t.mode === 'drag' && t.src === 'pointer') {
        const s0 = t.samples[0]
        const s1 = t.samples[t.samples.length - 1]
        const vx = s1 && s0 && s1.t - s0.t > 8 ? (s1.x - s0.x) / (s1.t - s0.t) : 0
        const complete = e.type === 'pointerup' && (vx < -0.4 || (vx < 0.4 && t.target.x < 0.22 * W))
        const to = complete ? { x: -W, y: t.C.y } : { ...t.C }
        const from = { ...t.P }
        const remaining = Math.hypot(to.x - from.x, to.y - from.y)
        t.mode = 'anim'
        t.anim = { from, to, t0: -1, dur: complete ? clamp(200 + remaining * 0.5, 240, 640) : clamp(170 + remaining * 0.55, 190, 480), complete, lift: 0, ease: outCubic }
        if (complete && this.sound) playPageTurn(clamp(0.35 + Math.abs(vx) * 0.25, 0.3, 1))
        this.kick()
        return
      }
      if (pr.started || e.type !== 'pointerup' || this.phase !== 'open') return
      if (pr.edge && this.canTurn(pr.dir)) {
        if (pr.dir > 0) this.forward()
        else this.backward()
        return
      }
      const p = this.local(e)
      const left = p.x < 0
      const i = 2 * this.spread + (left ? 0 : 1)
      const px = ((left ? p.x + W : p.x) / W) * PAGE_W
      const py = (p.y / W) * PAGE_W
      const at = { x: e.clientX, y: e.clientY }
      if (p.y < 0 || p.y > H || Math.abs(p.x) > W) {
        this.onBlank()
        return
      }
      void this.hitAt(i, px, py).then((h) => {
        const book = this.pageBook(i)
        if (!h || book < 0) return this.onBlank()
        this.onVerse(h.kind === 'verse' ? { book, chapter: h.chapter, verse: h.verse } : { book, chapter: h.chapter, verse: null }, at)
      })
    }

    const onDbl = (e: MouseEvent) => {
      if (this.phase !== 'open') return
      if (this.focusSide) this.resetView()
      else this.focus(this.local(e).x < 0 ? 'left' : 'right')
    }

    const onLeave = () => {
      hit.classList.remove('edge')
      const t = this.turn
      if (t && t.mode === 'peel') {
        t.target = { ...t.C }
        this.kick()
      }
    }

    hit.addEventListener('pointermove', onMove)
    hit.addEventListener('pointerdown', onDown)
    hit.addEventListener('pointerup', onUp)
    hit.addEventListener('pointercancel', onUp)
    hit.addEventListener('dblclick', onDbl)
    hit.addEventListener('pointerleave', onLeave)
    hit.addEventListener('pointerenter', this.wake)

    let wAcc = 0
    let wActive = false
    let wLocked = false
    let wDir: 1 | -1 = 1
    let wQuiet = 0
    let pinch = 0
    const finishWheel = (force: boolean) => {
      wActive = false
      wLocked = true
      const t = this.turn
      if (!t || t.src !== 'wheel' || t.mode !== 'drag') return
      const travel = W - t.target.x
      const complete = force || travel > 0.36 * W
      const to = complete ? { x: -W, y: t.C.y } : { ...t.C }
      const from = { ...t.P }
      const remaining = Math.hypot(to.x - from.x, to.y - from.y)
      t.mode = 'anim'
      t.anim = { from, to, t0: -1, dur: complete ? clamp(220 + remaining * 0.55, 260, 680) : clamp(180 + remaining * 0.6, 200, 460), complete, lift: 0, ease: outCubic }
      if (complete && this.sound) playPageTurn(0.5)
      this.kick()
    }
    const wheelQuiet = () => {
      wQuiet = 0
      if (wActive) finishWheel(false)
      wActive = false
      wLocked = false
      wAcc = 0
      pinch = 0
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (this.phase !== 'open') return
      clearTimeout(wQuiet)
      wQuiet = window.setTimeout(wheelQuiet, 130)
      if (e.ctrlKey) {
        if (wLocked) return
        pinch += e.deltaY
        if (pinch < -24 && !this.focusSide) {
          wLocked = true
          this.focus(this.local(e).x < 0 ? 'left' : 'right')
        } else if (pinch > 24 && this.focusSide) {
          wLocked = true
          this.resetView()
        }
        return
      }
      if (wLocked) return
      const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX
      const inv = (e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean }).webkitDirectionInvertedFromDevice
      const finger = inv === false ? dx : -dx
      if (!wActive) {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.1) return
        const t = this.turn
        if ((t && t.mode !== 'peel') || this.fade) {
          wLocked = true
          return
        }
        if (wAcc !== 0 && Math.sign(finger) !== Math.sign(wAcc)) wAcc = 0
        wAcc += finger
        if (Math.abs(wAcc) < 8) return
        const dir: 1 | -1 = wAcc > 0 ? 1 : -1
        if (this.focusSide) {
          wLocked = true
          if (dir > 0) this.forward()
          else this.backward()
          return
        }
        if (!this.canTurn(dir) || this.reducedMotion) {
          wLocked = true
          if (this.canTurn(dir)) this.requestTurn(dir)
          return
        }
        const prevP = t && t.dir === dir && t.C.y === H ? { ...t.P } : { x: W, y: H }
        const nt = this.newTurn(dir, { x: W, y: H }, 'drag', 'wheel')
        nt.P = prevP
        this.turn = nt
        wActive = true
        wDir = dir
        wAcc = Math.abs(wAcc)
        this.syncRibbons()
        this.requestVisible()
      } else wAcc += finger * wDir
      const cur = this.turn
      if (!cur || cur.src !== 'wheel') return
      const travel = clamp(wAcc * 1.3, 0, 2 * W)
      const pr = travel / (2 * W)
      cur.target = clampP({ x: W - travel, y: H - 0.05 * H * Math.sin(Math.PI * pr) }, cur.C)
      if (travel >= 1.88 * W) finishWheel(true)
      this.kick()
    }
    els.root.addEventListener('wheel', onWheel, { passive: false })

    const openHit = els.openHit
    const onOpenClick = () => this.open()
    const onEnter = () => {
      if (this.phase === 'closed' && !this.reducedMotion) els.scene.classList.add('hover')
    }
    const onExit = () => els.scene.classList.remove('hover')
    openHit.addEventListener('click', onOpenClick)
    openHit.addEventListener('pointerenter', onEnter)
    openHit.addEventListener('pointerleave', onExit)

    this.cleanup.push(() => {
      hit.removeEventListener('pointermove', onMove)
      hit.removeEventListener('pointerdown', onDown)
      hit.removeEventListener('pointerup', onUp)
      hit.removeEventListener('pointercancel', onUp)
      hit.removeEventListener('dblclick', onDbl)
      hit.removeEventListener('pointerleave', onLeave)
      hit.removeEventListener('pointerenter', this.wake)
      els.root.removeEventListener('wheel', onWheel)
      openHit.removeEventListener('click', onOpenClick)
      openHit.removeEventListener('pointerenter', onEnter)
      openHit.removeEventListener('pointerleave', onExit)
      clearTimeout(wQuiet)
      clearTimeout(this.resTimer)
      clearTimeout(this.flushTimer)
      clearTimeout(this.pumpTimer)
      this.resTimer = 0
      this.flushTimer = 0
      this.pumpTimer = 0
    })
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
    let first: VerseRef | null = null
    let last: VerseRef | null = null
    if (!this.ready) label = `${book?.name ?? 'Gênesis'} ${ref.chapter + 1}`
    else if (this.spread > 0) {
      first = this.firstRefOf(this.spread)
      last = this.lastRefOf(this.spread) ?? ref
      const a = ref.book === last.book ? ref : first
      const bk = this.bible.books[a.book]
      label =
        last.chapter !== a.chapter || last.book !== a.book
          ? `${bk.name} ${a.chapter + 1}:${a.verse + 1} – ${last.chapter + 1}:${last.verse + 1}`
          : `${bk.name} ${a.chapter + 1}:${a.verse + 1}–${last.verse + 1}`
    }
    this.snapshot = {
      ref,
      label,
      style: this.style,
      isOpen: this.isOpen,
      phase: this.phase,
      ready: this.ready,
      canPrev: this.ready && this.spread > 0,
      canNext: this.ready && this.spread < this.spreads - 1,
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
      first,
      last,
    }
    this.queueNotify()
  }

  private notifyTimer = 0
  private safetyTimer = 0
  private notifyPending = false

  private animating() {
    return !!this.raf || this.turn?.mode === 'drag'
  }

  private emit() {
    this.notifyPending = false
    clearTimeout(this.notifyTimer)
    clearTimeout(this.safetyTimer)
    this.notifyTimer = 0
    this.safetyTimer = 0
    for (const l of this.listeners) l()
  }

  private queueNotify() {
    this.notifyPending = true
    if (!this.safetyTimer)
      this.safetyTimer = window.setTimeout(() => {
        this.safetyTimer = 0
        if (this.notifyPending) this.emit()
      }, 1500)
    if (this.animating() || this.notifyTimer) return
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = 0
      if (this.notifyPending && !this.animating()) this.emit()
    }, 0)
  }

  private persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ref: this.ready && this.spread === 0 ? null : this.anchor, marker: this.marker, volume: this.volume, style: this.style, sound: this.sound, background: this.background, cover: this.cover, ambientSound: this.ambientSound }),
      )
    } catch {
      return
    }
  }

  private load(): Saved | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const d = JSON.parse(raw)
      const okRef = (r: unknown): r is VerseRef => {
        const v = r as VerseRef | null
        return !!v && typeof v.book === 'number' && !!this.bible.books[v.book]?.chapters[v.chapter] && typeof v.verse === 'number'
      }
      const fontScale = FONT_SCALES.includes(d?.style?.fontScale) ? d.style.fontScale : 1
      const verseMode: VerseMode = d?.style?.verseMode === 'flow' ? 'flow' : 'lines'
      return {
        ref: okRef(d?.ref) ? d.ref : null,
        marker: okRef(d?.marker) ? d.marker : null,
        volume: typeof d?.volume === 'number' ? clamp(d.volume, 0, 1) : 0.8,
        style: { fontScale, verseMode },
        sound: d?.sound !== false,
        background: normalizeBackground(d?.background),
        cover: normalizeCover(d?.cover),
        ambientSound: d?.ambientSound !== false,
      }
    } catch {
      return null
    }
  }
}
