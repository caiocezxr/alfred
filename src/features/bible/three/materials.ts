import * as THREE from 'three'
import { FONT_DISPLAY } from '../layout/typesetter'

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export function createLeather(base = '#231915'): THREE.MeshPhysicalMaterial {
  const size = 1024
  const col = canvas(size, size)
  const bump = canvas(size, size)
  const cc = col.getContext('2d')!
  const bc = bump.getContext('2d')!
  cc.fillStyle = base
  cc.fillRect(0, 0, size, size)
  bc.fillStyle = '#808080'
  bc.fillRect(0, 0, size, size)
  const r = rng(11)
  for (let i = 0; i < 26000; i++) {
    const x = r() * size
    const y = r() * size
    const rad = 1.2 + r() * 3.6
    const light = r()
    bc.fillStyle = `rgba(${light > 0.5 ? 255 : 0},${light > 0.5 ? 255 : 0},${light > 0.5 ? 255 : 0},${0.08 + r() * 0.12})`
    bc.beginPath()
    bc.ellipse(x, y, rad, rad * (0.6 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2)
    bc.fill()
    if (i % 3 === 0) {
      cc.fillStyle = light > 0.5 ? `rgba(255,220,190,${0.03 + r() * 0.04})` : `rgba(10,6,4,${0.14 + r() * 0.2})`
      cc.beginPath()
      cc.ellipse(x, y, rad, rad * 0.8, 0, 0, Math.PI * 2)
      cc.fill()
    }
  }
  for (let i = 0; i < 70; i++) {
    bc.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`
    bc.lineWidth = 0.8 + r() * 1.6
    bc.beginPath()
    let x = r() * size
    let y = r() * size
    bc.moveTo(x, y)
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 70
      y += (r() - 0.5) * 70
      bc.lineTo(x, y)
    }
    bc.stroke()
  }
  const map = new THREE.CanvasTexture(col)
  map.colorSpace = THREE.SRGBColorSpace
  const bumpMap = new THREE.CanvasTexture(bump)
  for (const t of [map, bumpMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1.6, 1.6)
    t.anisotropy = 8
  }
  return new THREE.MeshPhysicalMaterial({
    map,
    bumpMap,
    bumpScale: 0.9,
    roughness: 0.52,
    metalness: 0,
    sheen: 0.55,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color('#7a5c48'),
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    color: '#ffffff',
  })
}

export function createGildedEdge(edge: 'gilt' | 'ivory' = 'gilt'): THREE.MeshStandardMaterial {
  const c = canvas(16, 2048)
  const ctx = c.getContext('2d')!
  const r = rng(5)
  const base = edge === 'gilt' ? [236, 196, 118] : [240, 230, 210]
  for (let y = 0; y < 2048; y++) {
    const v = (edge === 'gilt' ? 0.78 : 0.9) + r() * (edge === 'gilt' ? 0.22 : 0.1)
    const dark = r() < 0.08 ? (edge === 'gilt' ? 0.72 : 0.9) : 1
    const k = v * dark
    ctx.fillStyle = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`
    ctx.fillRect(0, y, 16, 1)
  }
  if (edge === 'ivory') {
    const map = new THREE.CanvasTexture(c)
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    return new THREE.MeshStandardMaterial({ map, metalness: 0, roughness: 0.85, side: THREE.DoubleSide })
  }
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.anisotropy = 8
  return new THREE.MeshStandardMaterial({
    map,
    metalness: 0.85,
    roughness: 0.32,
    side: THREE.DoubleSide,
  })
}

export type DecalStyle = { ink: string; frame: 'double' | 'single' | 'none'; ornament: 'none' | 'olive' | 'mountains'; metallic: boolean }

export function createCoverDecal(style: DecalStyle = { ink: '#d9b46a', frame: 'double', ornament: 'none', metallic: true }): THREE.MeshStandardMaterial {
  const w = 1024
  const h = Math.round(1024 * (1.45 + 0.09) / (1 + 0.045))
  const col = canvas(w, h)
  const mr = canvas(w, h)
  const cc = col.getContext('2d')!
  const mc = mr.getContext('2d')!
  mc.fillStyle = 'rgb(0, 200, 0)'
  mc.fillRect(0, 0, w, h)

  const gold = (ctx: CanvasRenderingContext2D, isMr: boolean) => {
    ctx.fillStyle = isMr ? (style.metallic ? 'rgb(0, 70, 255)' : 'rgb(0, 190, 0)') : style.ink
    ctx.strokeStyle = ctx.fillStyle
  }
  const draw = (ctx: CanvasRenderingContext2D, isMr: boolean) => {
    if (!isMr) {
      ctx.save()
      ctx.setLineDash([9, 7])
      ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 3.4
      ctx.strokeRect(19, 19, w - 38, h - 38)
      ctx.strokeStyle = 'rgba(214, 196, 168, 0.62)'
      ctx.lineWidth = 2.2
      ctx.strokeRect(18, 18, w - 36, h - 36)
      ctx.restore()
    }
    if (!isMr && style.frame !== 'none') {
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 4
      ctx.strokeRect(34, 34, w - 68, h - 68)
      ctx.strokeStyle = 'rgba(255,232,205,0.05)'
      ctx.lineWidth = 2
      ctx.strokeRect(37, 37, w - 68, h - 68)
    }
    gold(ctx, isMr)
    if (style.frame === 'single') {
      ctx.lineWidth = 2
      ctx.strokeRect(62, 62, w - 124, h - 124)
    }
    if (style.frame === 'double') {
      const i1 = 70
      const i2 = 84
      ctx.lineWidth = 3.2
      ctx.strokeRect(i1, i1, w - i1 * 2, h - i1 * 2)
      ctx.lineWidth = 1.4
      ctx.strokeRect(i2, i2, w - i2 * 2, h - i2 * 2)
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const ox = sx > 0 ? i2 : w - i2
        const oy = sy > 0 ? i2 : h - i2
        ctx.save()
        ctx.translate(ox, oy)
        ctx.scale(sx, sy)
        ctx.beginPath()
        ctx.moveTo(26, 8)
        ctx.lineTo(36, 18)
        ctx.lineTo(26, 28)
        ctx.lineTo(16, 18)
        ctx.closePath()
        ctx.fill()
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(52, 18, 12, Math.PI, Math.PI * 1.9)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(18, 52, 12, Math.PI * 1.6, Math.PI * 2.5)
        ctx.stroke()
        ctx.restore()
      }
    }
    if (style.ornament === 'olive') {
      const branch = (ox: number, oy: number, rot: number, scale: number) => {
        ctx.save()
        ctx.translate(ox, oy)
        ctx.rotate(rot)
        ctx.scale(scale, scale)
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.quadraticCurveTo(-120, 60, -260, 70)
        ctx.stroke()
        for (let i = 0; i < 11; i++) {
          const t = (i + 0.6) / 11.5
          const x = -260 * t
          const y = 70 * t * t * 1.15 + 3
          const side = i % 2 === 0 ? -1 : 1
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(side * 0.62 - 0.35 + t * 0.2)
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.quadraticCurveTo(-18, side * -10, -40, side * -2)
          ctx.quadraticCurveTo(-18, side * 6, 0, 0)
          ctx.fill()
          ctx.restore()
        }
        for (const [ox, oy] of [[-120, 40], [-190, 58]]) {
          ctx.beginPath()
          ctx.ellipse(ox, oy + 14, 7, 9, 0.3, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
      branch(w - 70, 90, 0.15, 1)
      branch(70, h - 90, Math.PI + 0.15, 0.7)
    }
    if (style.ornament === 'mountains') {
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      const base = h - 150
      const ridge = (pts: [number, number][]) => {
        ctx.beginPath()
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
      }
      ridge([[80, base], [230, base - 150], [330, base - 80], [470, base - 230], [600, base - 110], [720, base - 190], [860, base - 60], [w - 80, base - 20]])
      ctx.lineWidth = 1.8
      ridge([[80, base + 40], [260, base - 40], [420, base + 10], [560, base - 70], [760, base + 5], [w - 80, base - 10]])
      ctx.beginPath()
      ctx.arc(w * 0.72, base - 300, 34, 0, Math.PI * 2)
      ctx.stroke()
    }
    const cx = w / 2
    const cy = h * 0.31
    ctx.fillRect(cx - 3.5, cy - 82, 7, 176)
    ctx.fillRect(cx - 48, cy - 34, 96, 7)
    for (const [x, y] of [[cx, cy - 86], [cx, cy + 98], [cx - 52, cy - 30.5], [cx + 52, cy - 30.5]]) {
      ctx.beginPath()
      ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = `500 116px ${FONT_DISPLAY}`
    spaced(ctx, 'BÍBLIA', cx, h * 0.52, 24)
    ctx.font = `500 60px ${FONT_DISPLAY}`
    spaced(ctx, 'SAGRADA', cx, h * 0.52 + 92, 22)
    ctx.fillRect(cx - 90, h * 0.52 + 136, 64, 1.6)
    ctx.fillRect(cx + 26, h * 0.52 + 136, 64, 1.6)
    ctx.save()
    ctx.translate(cx, h * 0.52 + 137)
    ctx.rotate(Math.PI / 4)
    ctx.fillRect(-5, -5, 10, 10)
    ctx.restore()
  }
  draw(cc, false)
  draw(mc, true)

  const map = new THREE.CanvasTexture(col)
  map.colorSpace = THREE.SRGBColorSpace
  const metal = new THREE.CanvasTexture(mr)
  for (const t of [map, metal]) t.anisotropy = 8
  return new THREE.MeshStandardMaterial({
    map,
    metalnessMap: metal,
    roughnessMap: metal,
    metalness: style.metallic ? 1 : 0,
    roughness: 1,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
}

function spaced(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, tracking: number) {
  const chars = [...text]
  const ws = chars.map((c) => ctx.measureText(c).width)
  let x = cx - (ws.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1)) / 2
  ctx.textAlign = 'left'
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y)
    x += ws[i] + tracking
  })
  ctx.textAlign = 'center'
}

export function createLinen(base: string): THREE.MeshPhysicalMaterial {
  const size = 512
  const col = canvas(size, size)
  const bump = canvas(size, size)
  const cc = col.getContext('2d')!
  const bc = bump.getContext('2d')!
  cc.fillStyle = base
  cc.fillRect(0, 0, size, size)
  bc.fillStyle = '#808080'
  bc.fillRect(0, 0, size, size)
  const r = rng(23)
  for (let i = 0; i < size; i += 2) {
    const a = 0.05 + r() * 0.08
    cc.fillStyle = `rgba(80, 60, 40, ${a})`
    cc.fillRect(0, i, size, 1)
    cc.fillRect(i, 0, 1, size)
    bc.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.2})`
    bc.fillRect(0, i, size, 1)
    bc.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.2})`
    bc.fillRect(i + 1, 0, 1, size)
  }
  for (let i = 0; i < 1400; i++) {
    cc.fillStyle = `rgba(${r() > 0.5 ? '255,250,240' : '90,70,50'}, ${0.05 + r() * 0.06})`
    cc.fillRect(r() * size, r() * size, 1 + r() * 6, 1)
  }
  const map = new THREE.CanvasTexture(col)
  map.colorSpace = THREE.SRGBColorSpace
  const bumpMap = new THREE.CanvasTexture(bump)
  for (const t of [map, bumpMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(3, 3)
    t.anisotropy = 8
  }
  return new THREE.MeshPhysicalMaterial({ map, bumpMap, bumpScale: 0.6, roughness: 0.92, metalness: 0, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color('#fff4e0') })
}

export function createDesk(): THREE.MeshPhysicalMaterial {
  const size = 1024
  const c = canvas(size, size)
  const rough = canvas(size, size)
  const ctx = c.getContext('2d')!
  const rc = rough.getContext('2d')!
  ctx.fillStyle = '#2a1c13'
  ctx.fillRect(0, 0, size, size)
  rc.fillStyle = '#7a7a7a'
  rc.fillRect(0, 0, size, size)
  const r = rng(19)
  for (let i = 0; i < 520; i++) {
    const y0 = r() * size
    const amp = 2 + r() * 10
    const freq = 0.002 + r() * 0.01
    const ph = r() * 10
    const dark = r() > 0.45
    ctx.strokeStyle = dark ? `rgba(14, 8, 5, ${0.12 + r() * 0.22})` : `rgba(92, 62, 40, ${0.08 + r() * 0.16})`
    ctx.lineWidth = 0.6 + r() * (dark ? 2.6 : 1.6)
    ctx.beginPath()
    for (let x = -10; x <= size + 10; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph * 2) * amp * 0.3
      if (x === -10) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    if (i % 4 === 0) {
      rc.strokeStyle = `rgba(${dark ? 200 : 60},${dark ? 200 : 60},${dark ? 200 : 60},0.25)`
      rc.lineWidth = ctx.lineWidth
      rc.beginPath()
      for (let x = -10; x <= size + 10; x += 8) {
        const y = y0 + Math.sin(x * freq + ph) * amp
        if (x === -10) rc.moveTo(x, y)
        else rc.lineTo(x, y)
      }
      rc.stroke()
    }
  }
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 10
    img.data[i] += n
    img.data[i + 1] += n * 0.8
    img.data[i + 2] += n * 0.6
  }
  ctx.putImageData(img, 0, 0)
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  const roughnessMap = new THREE.CanvasTexture(rough)
  for (const t of [map, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(2.2, 2.2)
    t.anisotropy = 8
  }
  return new THREE.MeshPhysicalMaterial({
    map,
    roughnessMap,
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.38,
  })
}

export function createRibbon(base: [number, number, number]): THREE.MeshPhysicalMaterial {
  const c = canvas(64, 8)
  const ctx = c.getContext('2d')!
  for (let x = 0; x < 64; x++) {
    const k = 0.86 + 0.14 * Math.sin((x / 64) * Math.PI * 12)
    ctx.fillStyle = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`
    ctx.fillRect(x, 0, 1, 8)
  }
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: 0.34,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.3,
    sheenColor: new THREE.Color(base[0] / 255, base[1] / 255, base[2] / 255).multiplyScalar(1.6),
    side: THREE.DoubleSide,
  })
}

export function createSpine(leather: THREE.MeshPhysicalMaterial, ink = '#d9b46a'): THREE.MeshPhysicalMaterial {
  const w = 256
  const h = 2048
  const col = canvas(w, h)
  const bump = canvas(w, h)
  const cc = col.getContext('2d')!
  const bc = bump.getContext('2d')!
  const src = (leather.map as THREE.CanvasTexture).image as HTMLCanvasElement
  cc.drawImage(src, 0, 0, src.width, src.height, 0, 0, w * 2, h)
  bc.drawImage((leather.bumpMap as THREE.CanvasTexture).image as HTMLCanvasElement, 0, 0, w * 2, h)
  const bands = [0.1, 0.17, 0.83, 0.9]
  for (const b of bands) {
    const y = b * h
    cc.fillStyle = 'rgba(0,0,0,0.45)'
    cc.fillRect(0, y - 14, w, 28)
    cc.fillStyle = ink
    cc.fillRect(0, y - 9, w, 2.5)
    cc.fillRect(0, y + 7, w, 2.5)
    bc.fillStyle = '#ffffff'
    bc.fillRect(0, y - 10, w, 20)
  }
  cc.save()
  cc.translate(w / 2, h / 2)
  cc.rotate(-Math.PI / 2)
  cc.fillStyle = ink
  cc.textAlign = 'center'
  cc.textBaseline = 'middle'
  cc.font = `500 64px ${FONT_DISPLAY}`
  spaced(cc, 'BÍBLIA SAGRADA', 0, 4, 12)
  cc.restore()
  const map = new THREE.CanvasTexture(col)
  map.colorSpace = THREE.SRGBColorSpace
  const bumpMap = new THREE.CanvasTexture(bump)
  const m = leather.clone()
  m.map = map
  m.bumpMap = bumpMap
  m.bumpScale = 2.4
  m.side = THREE.DoubleSide
  return m
}
