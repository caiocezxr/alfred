import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { BookController, RibbonState } from '../controller'
import {
  C, H, LEAF_EPS, O, PageBlock, T, W,
  centerCurve, createLeafGeometry, shapeLeaf, sideShape, type LeafParams,
} from './geometry'
import { AmbienceScene, coverOf, type BackgroundId, type CoverId } from './ambience'
import { createCoverDecal, createGildedEdge, createLeather, createLinen, createRibbon, createSpine } from './materials'

const NX = 72
const NZ = 32
const NX_STATIC = 72
const NZ_STATIC = 2
const PLANE_Y = 0.1

function Setup({ controller, background }: { controller: BookController; background: BackgroundId }) {
  const { gl, scene, invalidate } = useThree()
  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping
    gl.toneMappingExposure = 1.02
    gl.setClearColor(0x000000, 0)
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    controller.maxAnisotropy = gl.capabilities.getMaxAnisotropy()
    controller.maxTexture = gl.capabilities.maxTextureSize
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.38
    scene.background = null
    scene.fog = null
    if (import.meta.env.DEV) (window as unknown as { __scene: THREE.Scene }).__scene = scene
    controller.kick = invalidate
    controller.upload = (t) => gl.initTexture(t)
    invalidate()
    return () => {
      env.dispose()
      pmrem.dispose()
      controller.kick = () => {}
      controller.upload = () => {}
    }
  }, [gl, scene, invalidate, controller])
  useEffect(() => {
    gl.shadowMap.needsUpdate = true
    invalidate()
  }, [background, invalidate, gl])
  return null
}

function contactShadowTexture() {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.85)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.75, 'rgba(0,0,0,0.16)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function sampleCurve(xs: Float32Array, ys: Float32Array, x: number) {
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    if ((x <= a && x >= b) || (x >= a && x <= b)) {
      const t = (x - a) / (b - a || 1)
      return ys[i] + (ys[i + 1] - ys[i]) * t
    }
  }
  return ys[ys.length - 1]
}

function shapeRibbon(geo: THREE.BufferGeometry, x0: number, x1: number, yAt: (x: number) => number, width: number, lift: number, floating: boolean, depth = 0) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  const n = arr.length / 6 - 1
  const zTop = -H / 2 - 0.012
  const zEdge = H / 2 + 0.004
  const onPage = floating ? 0.62 : 0.7
  const yDesk = -C + 0.0025
  for (let j = 0; j <= n; j++) {
    const k = j / n
    let x: number
    let y: number
    let z: number
    if (k <= onPage) {
      const t = k / onPage
      x = x0 + (x1 - x0) * t
      z = zTop + (zEdge - zTop) * t
      y = yAt(x) + lift - depth
    } else {
      const t = (k - onPage) / (1 - onPage)
      const yTop = yAt(x1) + lift - depth
      if (floating) {
        const bend = 0.18
        if (t < bend) {
          const a = (t / bend) * (Math.PI / 2)
          y = yTop - Math.sin(a) * 0.03
          z = zEdge + (1 - Math.cos(a)) * 0.03 + Math.sin(a) * 0.004
        } else {
          const u = (t - bend) / (1 - bend)
          y = yTop - 0.03 - u * 0.42
          z = zEdge + 0.034 + Math.sin(u * 2.4) * 0.03 * u
        }
        x = x1 - 0.02 * t
      } else {
        x = x1 - 0.025 * t
        const drop = yTop - yDesk
        const bendPart = 0.45
        if (t < bendPart) {
          const a = (t / bendPart) * (Math.PI / 2)
          y = yTop - drop * (1 - Math.cos(a))
          z = zEdge + Math.sin(a) * Math.min(0.05, drop + 0.02)
        } else {
          y = yDesk
          z = zEdge + Math.min(0.05, drop + 0.02) + ((t - bendPart) / (1 - bendPart)) * 0.24
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const idx = (j * 2 + i) * 3
      arr[idx] = x + (i === 0 ? -width / 2 : width / 2)
      arr[idx + 1] = y
      arr[idx + 2] = z
    }
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
}

type ShadeUniforms = {
  uSide: { value: number }
  uEdge: { value: THREE.Vector2 }
  uLift: { value: THREE.Vector2 }
  uAmt: { value: number }
  uGutter: { value: number }
}

function shadedPaper(side: 1 | -1, gutter: number) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0, color: '#ffffff' })
  const u: ShadeUniforms = {
    uSide: { value: side },
    uEdge: { value: new THREE.Vector2() },
    uLift: { value: new THREE.Vector2() },
    uAmt: { value: 0 },
    uGutter: { value: gutter },
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = transformed;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vLocalPos;
uniform float uSide;
uniform vec2 uEdge;
uniform vec2 uLift;
uniform float uAmt;
uniform float uGutter;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float ax = vLocalPos.x * uSide;
float tz = clamp(vLocalPos.z / ${H.toFixed(4)} + 0.5, 0.0, 1.0);
float shade = uGutter * (1.0 - smoothstep(0.0, 0.11, ax)) * 0.16;
if (uAmt > 0.001) {
  float e = mix(uEdge.x, uEdge.y, tz);
  float h = max(0.0, mix(uLift.x, uLift.y, tz));
  float d = ax - e;
  float k = uAmt / (1.0 + h * 4.0);
  float soft = 0.018 + h * 0.6;
  shade += d < 0.0 ? k * 0.42 : k * 0.34 * exp(-d / soft);
}
diffuseColor.rgb *= 1.0 - min(shade, 0.5);`,
      )
  }
  m.customProgramCacheKey = () => `shaded-paper-${side}`
  return { m, u }
}

function leafExtent(pos: Float32Array, nx: number, row: number, side: 1 | -1, base: number) {
  let best = 0
  let lift = 0
  for (let i = 0; i <= nx; i++) {
    const k = (row * (nx + 1) + i) * 3
    const x = pos[k] * side
    if (x > best) {
      best = x
      lift = pos[k + 1] - base
    }
  }
  return { e: best, h: lift }
}

function Book({ controller, cover }: { controller: BookController; cover: CoverId }) {
  const invalidate = useThree((s) => s.invalidate)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)

  const parts = useMemo(() => {
    const cs = coverOf(cover)
    const leather = cs.kind === 'linen' ? createLinen(cs.base) : createLeather(cs.base)
    const gilded = createGildedEdge(cs.edge)
    const decal = createCoverDecal({ ink: cs.ink, frame: cs.frame, ornament: cs.ornament, metallic: cs.kind !== 'linen' })
    const ribbonA = createRibbon([118, 22, 30])
    const ribbonB = createRibbon([170, 132, 70])

    const root = new THREE.Group()
    const leftGroup = new THREE.Group()
    root.add(leftGroup)

    const coverGeo = new RoundedBoxGeometry(W + O, C, H + 2 * O, 4, 0.016)
    const rightCover = new THREE.Mesh(coverGeo, leather)
    rightCover.position.set((W + O) / 2, -C / 2, 0)
    const leftCover = new THREE.Mesh(coverGeo, leather)
    leftCover.position.set(-(W + O) / 2, -C / 2, 0)
    for (const m of [rightCover, leftCover]) {
      m.castShadow = true
      m.receiveShadow = true
    }
    root.add(rightCover)
    leftGroup.add(leftCover)

    const decalMesh = new THREE.Mesh(new THREE.PlaneGeometry((W + O) * 0.985, (H + 2 * O) * 0.985), decal)
    decalMesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeRotationZ(Math.PI).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)),
    )
    decalMesh.position.set(-(W + O) / 2, -C - 0.0007, 0)
    leftGroup.add(decalMesh)

    const spineGeo = new THREE.CylinderGeometry(1, 1, H + 2 * O - 0.006, 48, 1, true, Math.PI, Math.PI)
    spineGeo.rotateX(Math.PI / 2)
    const spineMat = createSpine(leather as THREE.MeshPhysicalMaterial, cs.ink)
    const spine = new THREE.Mesh(spineGeo, spineMat)
    spine.castShadow = true
    root.add(spine)

    const rightBlock = new PageBlock(NX_STATIC)
    const leftBlock = new PageBlock(NX_STATIC)
    const rb = new THREE.Mesh(rightBlock.geometry, gilded)
    const lb = new THREE.Mesh(leftBlock.geometry, gilded)
    rb.receiveShadow = lb.receiveShadow = true
    rb.castShadow = lb.castShadow = true
    root.add(rb)
    leftGroup.add(lb)

    const rightPageGeo = createLeafGeometry(NX_STATIC, NZ_STATIC, false)
    const leftPageGeo = createLeafGeometry(NX_STATIC, NZ_STATIC, true)
    const rightShade = shadedPaper(1, 1)
    const leftShade = shadedPaper(-1, 1)
    const rightPage = new THREE.Mesh(rightPageGeo, rightShade.m)
    const leftMat = leftShade.m
    leftMat.side = THREE.BackSide
    const leftPage = new THREE.Mesh(leftPageGeo, leftMat)
    rightPage.receiveShadow = leftPage.receiveShadow = true
    root.add(rightPage)
    leftGroup.add(leftPage)

    const leafFrontGeo = createLeafGeometry(NX, NZ, false)
    const leafBackGeo = createLeafGeometry(NX, NZ, true, leafFrontGeo.getAttribute('position') as THREE.BufferAttribute)
    const leafMat = () =>
      new THREE.MeshPhysicalMaterial({ roughness: 0.8, metalness: 0, color: '#ffffff', sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color('#fff6e6') })
    const leafFront = new THREE.Mesh(leafFrontGeo, leafMat())
    const backMat = leafMat()
    backMat.side = THREE.BackSide
    const leafBack = new THREE.Mesh(leafBackGeo, backMat)
    leafFront.receiveShadow = leafBack.receiveShadow = true
    leafFront.frustumCulled = leafBack.frustumCulled = false
    root.add(leafFront, leafBack)

    const ribbonGeoA = new THREE.PlaneGeometry(1, 1, 1, 60)
    const ribbonGeoB = new THREE.PlaneGeometry(1, 1, 1, 60)
    const ribA = new THREE.Mesh(ribbonGeoA, ribbonA)
    const ribB = new THREE.Mesh(ribbonGeoB, ribbonB)
    ribA.castShadow = ribB.castShadow = true
    ribA.receiveShadow = ribB.receiveShadow = true
    ribA.frustumCulled = ribB.frustumCulled = false
    root.add(ribA, ribB)

    const blobTex = contactShadowTexture()
    const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.62, toneMapped: false })
    const blobGeo = new THREE.PlaneGeometry(1, 1)
    const blob = new THREE.Mesh(blobGeo, blobMat)
    blob.rotation.x = -Math.PI / 2
    blob.position.y = -C - 0.0004
    blob.renderOrder = -1

    return {
      blob, rightShade, leftShade,
      root, leftGroup, spine, rightBlock, leftBlock, rightPage, leftPage, rightPageGeo, leftPageGeo,
      leafFront, leafBack, leafFrontGeo, leafBackGeo, ribA, ribB, ribbonGeoA, ribbonGeoB,
      tmpX: new Float32Array(NX_STATIC + 1), tmpY: new Float32Array(NX_STATIC + 1),
      leftX: new Float32Array(NX_STATIC + 1), leftY: new Float32Array(NX_STATIC + 1),
      lastFraction: -1,
      lastOpen: -1,
      lastRibbons: '',
      lastModes: '',
      dispose: () => {
        for (const g of [coverGeo, spineGeo, rightBlock.geometry, leftBlock.geometry, rightPageGeo, leftPageGeo, leafFrontGeo, leafBackGeo, ribbonGeoA, ribbonGeoB, blobGeo]) g.dispose()
        for (const m of [leather, spineMat, gilded, decal, ribbonA, ribbonB, blobMat, rightShade.m, leftShade.m, leafFront.material, leafBack.material]) m.dispose()
        blobTex.dispose()
      },
    }
  }, [cover])

  useEffect(() => {
    gl.shadowMap.needsUpdate = true
    return () => parts.dispose()
  }, [parts, gl])

  useEffect(() => {
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLANE_Y)
    const hitPoint = new THREE.Vector3()
    const toNdc = (cx: number, cy: number) => {
      const r = gl.domElement.getBoundingClientRect()
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
    }
    controller.picker = (cx, cy) => {
      toNdc(cx, cy)
      const hits = ray.intersectObjects([parts.rightPage, parts.leftPage], false)
      const h = hits[0]
      if (!h?.uv) return null
      return { side: h.object === parts.rightPage ? 'right' : 'left', u: h.uv.x, v: h.uv.y }
    }
    controller.ground = (cx, cy) => {
      toNdc(cx, cy)
      if (!ray.ray.intersectPlane(plane, hitPoint)) return null
      return { x: hitPoint.x - parts.root.position.x, z: hitPoint.z }
    }
    return () => {
      controller.picker = null
      controller.ground = null
    }
  }, [controller, camera, gl, parts])

  const lastT = useRef(0)
  const wasMoving = useRef(false)
  const shadowAt = useRef({ open: -1, shift: -1, fraction: -1 })
  const glint = useRef<THREE.PointLight>(null)
  useFrame(() => {
    const now = performance.now()
    const gap = now - lastT.current
    if (wasMoving.current && lastT.current && gap < 250) {
      const pf = controller.perf
      pf.frames++
      if (gap > 20) pf.slow++
      if (gap > pf.worst) pf.worst = Math.round(gap)
    }
    const dt = lastT.current && gap < 100 ? gap / 1000 : 1 / 60
    lastT.current = now
    let moving = controller.update(dt)
    const f = controller.frame()
    const p = parts

    const hL = Math.max(0.003, T * f.fraction)
    const hR = Math.max(0.003, T * (1 - f.fraction))
    const openR = sideShape(hR, f.openT)
    const openL = sideShape(hL, f.openT)
    const rs = f.ribbons
    const ribSig = `${rs.red.mode}${rs.red.depth.toFixed(4)}${rs.gold.mode}${rs.gold.depth.toFixed(4)}`
    if (Math.abs(p.lastFraction - f.fraction) > 1e-5 || p.lastOpen !== f.openT || p.lastRibbons !== ribSig) {
      p.lastRibbons = ribSig
      p.lastFraction = f.fraction
      p.lastOpen = f.openT
      const base: LeafParams = { theta: 0, right: openR, left: openL, bend: 0, dir: 1, corner: 0, lift: 0 }
      const rp = p.rightPageGeo.getAttribute('position') as THREE.BufferAttribute
      shapeLeaf(rp.array as Float32Array, NX_STATIC, NZ_STATIC, base)
      rp.needsUpdate = true
      p.rightPageGeo.computeVertexNormals()
      p.rightPageGeo.computeBoundingSphere()
      centerCurve(rp.array as Float32Array, NX_STATIC, p.tmpX, p.tmpY)
      p.rightBlock.update(p.tmpX, p.tmpY)

      const lp = p.leftPageGeo.getAttribute('position') as THREE.BufferAttribute
      shapeLeaf(lp.array as Float32Array, NX_STATIC, NZ_STATIC, { ...base, theta: Math.PI })
      lp.needsUpdate = true
      p.leftPageGeo.computeVertexNormals()
      p.leftPageGeo.computeBoundingSphere()
      centerCurve(lp.array as Float32Array, NX_STATIC, p.leftX, p.leftY)
      p.leftBlock.update(p.leftX, p.leftY)

      const yL = (x: number) => sampleCurve(p.leftX, p.leftY, x)
      const yR = (x: number) => sampleCurve(p.tmpX, p.tmpY, x)
      const place = (geo: THREE.BufferGeometry, r: RibbonState, a: number, b: number, w: number, lift: number) => {
        if (r.mode === 'right') shapeRibbon(geo, a, b, yR, w, lift, false, r.depth)
        else shapeRibbon(geo, -a, -b, yL, w, lift, false, r.mode === 'left' ? r.depth : 0)
      }
      place(p.ribbonGeoA, rs.red, 0.03, 0.075, 0.016, 0.0042)
      place(p.ribbonGeoB, rs.gold, 0.05, 0.11, 0.014, rs.gold.mode === 'here' && rs.red.mode === 'here' ? 0.0062 : 0.0036)
      const modes = rs.red.mode + rs.gold.mode
      if (modes !== p.lastModes) {
        p.lastModes = modes
        gl.shadowMap.needsUpdate = true
      }
    }

    const rm = p.rightPage.material as THREE.MeshStandardMaterial
    const lm = p.leftPage.material as THREE.MeshStandardMaterial
    if (rm.map !== f.right) { rm.map = f.right; rm.needsUpdate = true }
    if (lm.map !== f.left) { lm.map = f.left; lm.needsUpdate = true }

    if (f.leaf) {
      const pos = p.leafFrontGeo.getAttribute('position') as THREE.BufferAttribute
      shapeLeaf(pos.array as Float32Array, NX, NZ, {
        theta: f.leaf.theta, right: openR, left: openL, bend: f.leaf.bend, dir: f.leaf.dir, corner: f.leaf.corner, lift: LEAF_EPS,
      })
      pos.needsUpdate = true
      p.leafFrontGeo.computeVertexNormals()
      if (!p.leafBackGeo.getAttribute('normal')) p.leafBackGeo.setAttribute('normal', p.leafFrontGeo.getAttribute('normal'))
      p.leafBackGeo.getAttribute('normal').needsUpdate = true
      const fm = p.leafFront.material as THREE.MeshStandardMaterial
      const bm = p.leafBack.material as THREE.MeshStandardMaterial
      if (fm.map !== f.leaf.front) { fm.map = f.leaf.front; fm.needsUpdate = true }
      if (bm.map !== f.leaf.back) { bm.map = f.leaf.back; bm.needsUpdate = true }
      p.leafFront.visible = p.leafBack.visible = true
      const arr = pos.array as Float32Array
      for (const [sd, sh, side] of [[openR, p.rightShade.u, 1], [openL, p.leftShade.u, -1]] as const) {
        const top = leafExtent(arr, NX, 0, side, sd.hinge)
        const bot = leafExtent(arr, NX, NZ, side, sd.hinge)
        sh.uEdge.value.set(top.e, bot.e)
        sh.uLift.value.set(top.h, bot.h)
        sh.uAmt.value = top.e > 0.002 || bot.e > 0.002 ? 0.9 : 0
      }
    } else {
      p.leafFront.visible = p.leafBack.visible = false
      p.rightShade.u.uAmt.value = p.leftShade.u.uAmt.value = 0
    }

    const a = Math.PI * f.openT
    p.leftGroup.rotation.z = a - Math.PI
    p.leftGroup.position.y = (T + 0.004) * (1 + Math.cos(a)) * 0.5
    p.root.position.x = THREE.MathUtils.lerp(-(W + O) / 2, 0, f.shiftT)
    const R = T / 2 + C
    const closedK = 1 - f.openT
    p.spine.scale.set(THREE.MathUtils.lerp(0.012, R * 0.45, closedK), THREE.MathUtils.lerp(C / 2, R, closedK), 1)
    p.spine.position.y = THREE.MathUtils.lerp(-C / 2, T / 2, closedK)
    p.ribA.visible = p.ribB.visible = f.openT > 0.985
    p.blob.scale.set((W + O) * THREE.MathUtils.lerp(1, 2, f.shiftT) * 1.55, (H + 2 * O) * 1.42, 1)

    const aspect = size.width / Math.max(1, size.height)
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const fitW = (span: number) => span / 2 / (tanV * aspect)
    const fitH = (span: number) => span / 2 / tanV
    const safe = THREE.MathUtils.clamp((size.height - 150) / size.height, 0.6, 1)
    const openD = Math.max(fitW(2 * (W + O) * 1.08), fitH((H + 2 * O) * 1.04) / safe)
    const closedD = Math.max(fitW((W + O) * 2.2), fitH((H + 2 * O) * 1.5))
    const focusD = Math.min(fitH(H * 1.06), fitW(W * 1.75))
    controller.focusZoom = THREE.MathUtils.clamp(openD / focusD, 1.35, 3)
    const v = f.view
    const k = f.camT
    const away = 1 - f.arriveT
    const zk = THREE.MathUtils.clamp((v.zoom - 1) / 0.8, 0, 1)
    const elev = THREE.MathUtils.lerp(0.68 + away * 0.3, 1.2, k) + zk * 0.3 * k
    const azim = THREE.MathUtils.lerp(-0.36 - away * 0.5, 0, k)
    const d = THREE.MathUtils.lerp(closedD * (1 + away * 0.38), openD / v.zoom, k)
    const target = new THREE.Vector3(
      v.cx * k,
      THREE.MathUtils.lerp(T * 0.45, PLANE_Y, k),
      THREE.MathUtils.lerp(0.25, 0.03 + v.cz, k),
    )
    camera.position.set(
      target.x + d * Math.cos(elev) * Math.sin(azim),
      target.y + d * Math.sin(elev),
      target.z + d * Math.cos(elev) * Math.cos(azim),
    )
    camera.lookAt(target)
    camera.updateMatrixWorld()

    controller.worldPerPx = (2 * d * tanV) / size.height
    const pageDevicePx = (W / controller.worldPerPx) * gl.getPixelRatio()
    if (f.camT > 0.99 && f.openT > 0.99 && controller.requestRes(pageDevicePx, now)) moving = true

    const gl2 = glint.current
    if (gl2) {
      if (f.glint >= 0) {
        const g = f.glint
        const e = g * g * (3 - 2 * g)
        gl2.position.set(THREE.MathUtils.lerp(-1.5, 1.7, e), 0.95, THREE.MathUtils.lerp(-0.55, -1.25, e))
        gl2.intensity = Math.pow(Math.sin(Math.PI * g), 2) * 1.6
      } else gl2.intensity = 0
    }

    const sh = shadowAt.current
    if (Math.abs(sh.open - f.openT) > 1e-4 || Math.abs(sh.shift - f.shiftT) > 1e-4 || Math.abs(sh.fraction - f.fraction) > 2e-4) {
      sh.open = f.openT
      sh.shift = f.shiftT
      sh.fraction = f.fraction
      gl.shadowMap.needsUpdate = true
    }

    wasMoving.current = moving
    if (moving) invalidate()
  })

  return (
    <>
      <primitive object={parts.root} />
      <primitive object={parts.blob} />
      <pointLight ref={glint} color="#fff1d2" intensity={0} distance={3.2} decay={0} position={[0, 0.95, -1]} />
    </>
  )
}

export const BookScene = memo(function BookScene({ controller, background, cover }: { controller: BookController; background: BackgroundId; cover: CoverId }) {
  const getOpen = useMemo(() => () => controller.openEased, [controller])
  return (
    <Canvas
      shadows="soft"
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 26, near: 0.05, far: 40, position: [0, 3, 2] }}
    >
      <Setup controller={controller} background={background} />
      <AmbienceScene background={background} getOpen={getOpen} />
      <Book controller={controller} cover={cover} />
    </Canvas>
  )
})
