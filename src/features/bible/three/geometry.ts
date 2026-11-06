import * as THREE from 'three'

export const W = 1
export const H = 1.45
export const T = 0.17
export const C = 0.034
export const O = 0.045
export const LEAF_EPS = 0.0016

export type Gutter = { amp: number; width: number }
export type SideShape = { gutter: Gutter; hinge: number }

function gutterShape(s: number, g: Gutter) {
  const x = THREE.MathUtils.clamp(s / g.width, 0, 1)
  return 1 - x * x * (3 - 2 * x)
}

function gutterRise(g: Gutter) {
  const n = 48
  const ds = g.width / n
  let y = 0
  for (let i = 0; i < n; i++) y += Math.sin(g.amp * gutterShape((i + 0.5) * ds, g)) * ds
  return y
}

export function sideShape(h: number, open: number): SideShape {
  const dip = Math.min(Math.max(h - 0.002, 0), 0.05) * open + 0.0005
  const width = THREE.MathUtils.clamp(dip * 3.4, 0.07, 0.19)
  let amp = Math.min(1.0, (2 * dip) / width)
  const g = { amp, width }
  for (let k = 0; k < 3; k++) {
    const r = gutterRise(g)
    if (r > 1e-6) g.amp = amp = Math.min(1.2, amp * (dip / r))
  }
  return { gutter: g, hinge: h - gutterRise(g) }
}

export type LeafParams = {
  theta: number
  right: SideShape
  left: SideShape
  bend: number
  dir: 1 | -1
  corner: number
  lift: number
}

const tmpPhi = new Float32Array(256)

export function shapeLeaf(pos: Float32Array, nx: number, nz: number, p: LeafParams) {
  const ds = W / nx
  const tp = THREE.MathUtils.clamp(p.theta / Math.PI, 0, 1)
  const hinge = THREE.MathUtils.lerp(p.right.hinge, p.left.hinge, tp)
  for (let j = 0; j <= nz; j++) {
    const zn = (j / nz) * 2 - 1
    const z = -H / 2 + (j / nz) * H
    const cornerK = 1 + 0.38 * zn * p.corner
    for (let i = 0; i <= nx; i++) {
      const s = i * ds
      const gR = gutterShape(s, p.right.gutter) * p.right.gutter.amp
      const gL = gutterShape(s, p.left.gutter) * p.left.gutter.amp
      let phi = p.theta + (1 - tp) * gR - tp * gL
      const sn = s / W
      phi += p.dir * p.bend * Math.pow(sn, 1.5) * cornerK
      phi = THREE.MathUtils.clamp(phi, gR, Math.PI - gL)
      tmpPhi[i] = phi
    }
    let x = 0
    let y = hinge
    for (let i = 0; i <= nx; i++) {
      if (i > 0) {
        const a = (tmpPhi[i - 1] + tmpPhi[i]) / 2
        x += Math.cos(a) * ds
        y += Math.sin(a) * ds
      }
      const phi = tmpPhi[i]
      const k = (j * (nx + 1) + i) * 3
      pos[k] = x - Math.sin(phi) * p.lift
      pos[k + 1] = y + Math.cos(phi) * p.lift
      pos[k + 2] = z
    }
  }
}

export function createLeafGeometry(nx: number, nz: number, back: boolean, sharedPos?: THREE.BufferAttribute) {
  const geo = new THREE.BufferGeometry()
  const count = (nx + 1) * (nz + 1)
  const pos = sharedPos ?? new THREE.BufferAttribute(new Float32Array(count * 3), 3)
  pos.setUsage(THREE.DynamicDrawUsage)
  const uv = new Float32Array(count * 2)
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = (j * (nx + 1) + i) * 2
      uv[k] = back ? 1 - i / nx : i / nx
      uv[k + 1] = 1 - j / nz
    }
  }
  const idx: number[] = []
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i
      const b = a + (nx + 1)
      const c = a + 1
      const d = b + 1
      idx.push(a, b, c, b, d, c)
    }
  }
  geo.setAttribute('position', pos)
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return geo
}

export class PageBlock {
  readonly geometry = new THREE.BufferGeometry()
  private nx: number
  private pos: Float32Array
  private uv: Float32Array

  constructor(nx: number) {
    this.nx = nx
    const quads = nx * 2 + 1
    this.pos = new Float32Array(quads * 6 * 3)
    this.uv = new Float32Array(quads * 6 * 2)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2))
  }

  update(curveX: Float32Array, curveY: Float32Array) {
    const { nx, pos, uv } = this
    let q = 0
    const quad = (p: number[][], t: number[][]) => {
      const order = [0, 1, 2, 0, 2, 3]
      for (let n = 0; n < 6; n++) {
        const v = p[order[n]]
        const tt = t[order[n]]
        const k = (q * 6 + n) * 3
        pos[k] = v[0]
        pos[k + 1] = v[1]
        pos[k + 2] = v[2]
        const ku = (q * 6 + n) * 2
        uv[ku] = tt[0]
        uv[ku + 1] = tt[1]
      }
      q++
    }
    for (const z of [H / 2, -H / 2]) {
      for (let i = 0; i < nx; i++) {
        const x0 = curveX[i], x1 = curveX[i + 1]
        const y0 = curveY[i] - 0.0006, y1 = curveY[i + 1] - 0.0006
        quad(
          [[x0, 0, z], [x1, 0, z], [x1, y1, z], [x0, y0, z]],
          [[Math.abs(x0) / W, 0], [Math.abs(x1) / W, 0], [Math.abs(x1) / W, y1 / T], [Math.abs(x0) / W, y0 / T]],
        )
      }
    }
    const xe = curveX[nx]
    const ye = curveY[nx] - 0.0006
    quad(
      [[xe, 0, H / 2], [xe, 0, -H / 2], [xe, ye, -H / 2], [xe, ye, H / 2]],
      [[0, 0], [1, 0], [1, ye / T], [0, ye / T]],
    )
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.uv.needsUpdate = true
    this.geometry.computeVertexNormals()
    this.geometry.computeBoundingSphere()
  }
}

export function centerCurve(pos: Float32Array, nx: number, outX: Float32Array, outY: Float32Array) {
  for (let i = 0; i <= nx; i++) {
    outX[i] = pos[i * 3]
    outY[i] = pos[i * 3 + 1]
  }
}
