import { memo, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { coverOf, type CoverId } from '../ambience'
import type { BookController } from '../controller'
import './book.css'

type Pt = { x: number; y: number }

function ribbonPath(fromT: number, dx: number, len: number) {
  const P0 = { x: -3 + dx, y: 250 }
  const P1 = { x: -4.5 + dx, y: 540 }
  const P2 = { x: -1 + dx * 1.2, y: 690 }
  const P3 = { x: 14 + dx * 1.6, y: 682 + len }
  const pt = (t: number) => {
    const m = 1 - t
    return {
      x: m * m * m * P0.x + 3 * m * m * t * P1.x + 3 * m * t * t * P2.x + t * t * t * P3.x,
      y: m * m * m * P0.y + 3 * m * m * t * P1.y + 3 * m * t * t * P2.y + t * t * t * P3.y,
    }
  }
  const N = 40
  const L: Pt[] = []
  const R: Pt[] = []
  const C: Pt[] = []
  const hw = 5.4
  for (let i = 0; i <= N; i++) {
    const t = fromT + ((1 - fromT) * i) / N
    const a = pt(Math.max(0, t - 0.002))
    const b = pt(Math.min(1, t + 0.002))
    const p = pt(t)
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / l
    const ny = (b.x - a.x) / l
    L.push({ x: p.x + nx * hw, y: p.y + ny * hw })
    R.push({ x: p.x - nx * hw, y: p.y - ny * hw })
    C.push(p)
  }
  const end = pt(1)
  const pre = pt(0.965)
  const el = Math.hypot(end.x - pre.x, end.y - pre.y) || 1
  const notch = { x: end.x - ((end.x - pre.x) / el) * 9, y: end.y - ((end.y - pre.y) / el) * 9 }
  const f = (p: Pt) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  return {
    outline: `M${L.map(f).join(' L')} L${f(notch)} L${R.slice().reverse().map(f).join(' L')} Z`,
    center: `M${C.slice(0, -2).map(f).join(' L')}`,
  }
}

function Ribbon({ tail, gold, refEl }: { tail: boolean; gold: boolean; refEl: React.Ref<SVGSVGElement> }) {
  const { outline, center } = useMemo(() => ribbonPath(tail ? 0.82 : 0, gold ? 9 : 0, gold ? 52 : 70), [tail, gold])
  const id = `rb-${tail ? 't' : 'f'}-${gold ? 'g' : 'r'}`
  const fill = gold ? '#b8892f' : '#8e1b14'
  const sheen = gold ? 'rgba(255, 226, 150, 0.45)' : 'rgba(236, 104, 84, 0.38)'
  return (
    <svg ref={refEl} className={`bk-ribbon ${tail ? 'is-tail' : 'is-full'} ${gold ? 'is-gold' : 'is-red'}`} viewBox="-80 0 160 820" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id={id} x="-50%" y="-10%" width="200%" height="130%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <path d={outline} fill="rgba(30,8,4,.42)" transform="translate(1.8 2.6)" filter={`url(#${id})`} />
      <path d={outline} fill={fill} />
      <path d={center} fill="none" stroke={sheen} strokeWidth="3.2" strokeLinecap="round" />
      <path d={outline} fill="none" stroke="rgba(52,6,3,.5)" strokeWidth=".7" />
    </svg>
  )
}

function Olive() {
  return (
    <svg className="cv-orn-art" viewBox="0 0 200 90" aria-hidden="true">
      <path d="M20 78 C 70 70, 120 50, 182 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {[0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84].map((t, i) => {
        const x = 20 + 162 * t
        const y = 78 - 64 * t * t - 6 * t
        const up = i % 2 === 0
        return <path key={t} d={`M${x} ${y} q ${up ? -4 : 6} ${up ? -14 : 8} ${up ? 10 : 16} ${up ? -18 : 4} q ${up ? -2 : -10} ${up ? 12 : -2} ${up ? -10 : -16} ${up ? 18 : -4}`} fill="currentColor" opacity="0.92" />
      })}
    </svg>
  )
}

function Mountains() {
  return (
    <svg className="cv-orn-art" viewBox="0 0 200 70" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
      <path d="M6 62 L52 22 L74 40 L104 10 L140 46 L158 32 L194 62" />
      <path d="M30 62 L66 34 L84 46 L104 26 L128 50" opacity="0.6" />
      <path d="M4 66 H196" opacity="0.7" />
    </svg>
  )
}

export const BookStage = memo(function BookStage({ controller, cover }: { controller: BookController; cover: CoverId }) {
  const root = useRef<HTMLDivElement>(null)
  const gl = useRef<HTMLCanvasElement>(null)
  const hit = useRef<HTMLDivElement>(null)
  const scene = useRef<HTMLDivElement>(null)
  const openHit = useRef<HTMLButtonElement>(null)
  const stackL = useRef<HTMLDivElement>(null)
  const stackR = useRef<HTMLDivElement>(null)
  const ribbonRed = useRef<SVGSVGElement>(null)
  const ribbonGold = useRef<SVGSVGElement>(null)
  const tailRed = useRef<SVGSVGElement>(null)
  const tailGold = useRef<SVGSVGElement>(null)
  const blockCanvas = useRef<HTMLCanvasElement>(null)
  const coverCanvas = useRef<HTMLCanvasElement>(null)

  useEffect(
    () =>
      controller.mount({
        root: root.current!,
        gl: gl.current!,
        hit: hit.current!,
        scene: scene.current!,
        openHit: openHit.current!,
        stackL: stackL.current!,
        stackR: stackR.current!,
        ribbonRed: ribbonRed.current as unknown as HTMLElement,
        ribbonGold: ribbonGold.current as unknown as HTMLElement,
        tailRed: tailRed.current as unknown as HTMLElement,
        tailGold: tailGold.current as unknown as HTMLElement,
        blockCanvas: blockCanvas.current!,
        coverCanvas: coverCanvas.current!,
      }),
    [controller],
  )

  const c = coverOf(cover)
  const vars = { ['--cv-base' as string]: c.base, ['--cv-light' as string]: c.light, ['--cv-dark' as string]: c.dark, ['--cv-ink' as string]: c.ink } as CSSProperties

  return (
    <div className={`bk kind-${c.kind} edge-${c.edge}`} ref={root} style={vars}>
      <div className="bk-open" aria-hidden="true">
        <div className="ob-shadow" />
        <div className="ob-board cv-skin">
          <div className="grain" />
          <div className="ob-spine" />
        </div>
        <div className="ob-stack left" ref={stackL} />
        <div className="ob-stack right" ref={stackR} />
        <Ribbon tail gold refEl={tailGold} />
        <Ribbon tail gold={false} refEl={tailRed} />
      </div>
      <canvas className="bk-gl" ref={gl} aria-hidden="true" />
      <Ribbon tail={false} gold refEl={ribbonGold} />
      <Ribbon tail={false} gold={false} refEl={ribbonRed} />
      <div className="bk-hit" ref={hit} />

      <div className={`bk-scene frame-${c.frame} orn-${c.ornament}`} ref={scene}>
        <div className="book3d">
          <div className="shadow3d" />
          <div className="ribbon3d" />
          <div className="back-cover cv-skin">
            <div className="grain" />
          </div>
          <div className="blk-bottom" />
          <div className="blk-fore" />
          <div className="blk-top">
            <canvas ref={blockCanvas} />
            <div className="blk-shade" />
          </div>
          <div className="spine cv-skin">
            <div className="grain" />
            <div className="spine-band b1" />
            <div className="spine-band b2" />
            <div className="spine-title">BÍBLIA SAGRADA</div>
            <div className="spine-band b3" />
            <div className="spine-band b4" />
          </div>
          <div className="cover">
            <div className="cv-front cv-skin">
              <div className="grain" />
              <div className="cv-frame" />
              <div className="cv-blind" />
              <svg className="cv-cross" viewBox="0 0 40 60" aria-hidden="true">
                <path d="M18.2 2h3.6v15.6H36v3.6H21.8V58h-3.6V21.2H4v-3.6h14.2z" fill="currentColor" />
              </svg>
              <div className="cv-title">BÍBLIA</div>
              <div className="cv-sub">SAGRADA</div>
              <div className="cv-orn">
                <i />
                <b />
                <i />
              </div>
              {c.ornament === 'olive' && (
                <div className="cv-ornament olive">
                  <Olive />
                </div>
              )}
              {c.ornament === 'mountains' && (
                <div className="cv-ornament mountains">
                  <Mountains />
                </div>
              )}
              <div className="cv-hinge" />
              <div className="cv-sheen" />
            </div>
            <div className="cv-back cv-skin">
              <div className="grain" />
              <div className="cv-back-stack" />
              <div className="cv-back-page">
                <canvas ref={coverCanvas} />
                <div className="cv-back-shade" />
              </div>
            </div>
            <div className="cv-edge-b" />
            <div className="cv-edge-r" />
          </div>
        </div>
        <button className="bk-open-hit" ref={openHit} type="button" aria-label="Abrir a Bíblia" />
      </div>
    </div>
  )
})
