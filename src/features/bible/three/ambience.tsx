import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { C } from './geometry'

export type BackgroundId = 'luz-da-manha' | 'montanha' | 'mar' | 'estudo' | 'mediterraneo' | 'floresta' | 'ceu' | 'aconchego' | 'noite'

export type AmbientKind = 'mar' | 'vento' | 'chuva' | 'lareira' | 'grilos'

export type LightPreset = {
  color: string
  intensity: number
  from: [number, number, number]
  sky: string
  ground: string
  ambient: number
  leaves: number
  shadow: number
  shadowColor: string
  sound: AmbientKind
}

export type BackgroundIcon = 'sun' | 'mountain' | 'wave' | 'lamp' | 'column' | 'tree' | 'cloud' | 'flame' | 'moon'

export const BACKGROUNDS: { id: BackgroundId; label: string; icon: BackgroundIcon; fallback: string; light: LightPreset }[] = [
  {
    id: 'luz-da-manha', label: 'Luz da manhã', icon: 'sun',
    fallback: 'radial-gradient(120% 90% at 25% 15%, #f6dfb8 0%, #c69a68 50%, #6b4a32 100%)',
    light: { color: '#ffdcb0', intensity: 2.3, from: [-2.2, 3.4, 1.3], sky: '#fff1dc', ground: '#6b4a32', ambient: 0.65, leaves: 1, shadow: 0.34, shadowColor: '#3a2414', sound: 'vento' },
  },
  {
    id: 'montanha', label: 'Montanha', icon: 'mountain',
    fallback: 'linear-gradient(180deg, #f2a65e 0%, #e0783e 38%, #6a4a52 62%, #2a2230 100%)',
    light: { color: '#ffb67e', intensity: 2.4, from: [1.4, 3.6, -1.6], sky: '#ffd6a8', ground: '#3a2a2a', ambient: 0.62, leaves: 0, shadow: 0.24, shadowColor: '#2a1410', sound: 'vento' },
  },
  {
    id: 'mar', label: 'Mar', icon: 'wave',
    fallback: 'linear-gradient(180deg, #f0b07a 0%, #e48a5a 40%, #4f6f88 60%, #2a3a4a 100%)',
    light: { color: '#ffc08a', intensity: 2.5, from: [1.0, 3.6, -1.8], sky: '#ffe0bd', ground: '#3b4a5a', ambient: 0.62, leaves: 0, shadow: 0.24, shadowColor: '#241a18', sound: 'mar' },
  },
  {
    id: 'estudo', label: 'Estudo', icon: 'lamp',
    fallback: 'radial-gradient(90% 80% at 35% 25%, #a8743e 0%, #4a2e1a 50%, #1a110a 100%)',
    light: { color: '#ffc27a', intensity: 2.6, from: [-1.4, 3.6, 1.0], sky: '#ffdcae', ground: '#2a1a10', ambient: 0.45, leaves: 0, shadow: 0.28, shadowColor: '#140a04', sound: 'chuva' },
  },
  {
    id: 'mediterraneo', label: 'Mediterrâneo', icon: 'column',
    fallback: 'linear-gradient(180deg, #f2c38a 0%, #d99a62 45%, #8a6a4a 70%, #4a3626 100%)',
    light: { color: '#ffcf94', intensity: 2.6, from: [1.8, 3.6, -1.0], sky: '#ffe7c4', ground: '#6a5038', ambient: 0.62, leaves: 0.7, shadow: 0.24, shadowColor: '#3a2410', sound: 'mar' },
  },
  {
    id: 'floresta', label: 'Floresta', icon: 'tree',
    fallback: 'radial-gradient(100% 80% at 40% 20%, #e8d08a 0%, #6a7a3a 45%, #22301a 100%)',
    light: { color: '#ffe2a8', intensity: 2.5, from: [-1.6, 3.8, -0.6], sky: '#f2f0d0', ground: '#2f3a22', ambient: 0.6, leaves: 1, shadow: 0.26, shadowColor: '#1c2410', sound: 'vento' },
  },
  {
    id: 'ceu', label: 'Céu', icon: 'cloud',
    fallback: 'linear-gradient(180deg, #f4c9a0 0%, #f0a878 45%, #c9a0a0 70%, #8a6a7a 100%)',
    light: { color: '#ffd2a0', intensity: 2.3, from: [0.8, 3.8, -1.4], sky: '#ffe9d0', ground: '#8a6a6a', ambient: 0.75, leaves: 0, shadow: 0.18, shadowColor: '#3a2420', sound: 'vento' },
  },
  {
    id: 'aconchego', label: 'Aconchego', icon: 'flame',
    fallback: 'radial-gradient(80% 70% at 40% 60%, #c8662a 0%, #4a2412 45%, #120a06 100%)',
    light: { color: '#ff9e58', intensity: 2.4, from: [-1.4, 3.4, 1.2], sky: '#ffb878', ground: '#1a0e08', ambient: 0.42, leaves: 0, shadow: 0.26, shadowColor: '#120804', sound: 'lareira' },
  },
  {
    id: 'noite', label: 'Noite', icon: 'moon',
    fallback: 'radial-gradient(90% 70% at 60% 20%, #2e3a66 0%, #121a33 50%, #05070f 100%)',
    light: { color: '#ffd29a', intensity: 2.0, from: [-1.4, 3.6, 1.4], sky: '#9fb2ff', ground: '#0a0e1c', ambient: 0.45, leaves: 0, shadow: 0.28, shadowColor: '#04060c', sound: 'grilos' },
  },
]

const LEGACY: Record<string, BackgroundId> = {
  'por-do-sol': 'mar', montanhas: 'montanha', natureza: 'floresta', 'noite-serena': 'noite', biblioteca: 'estudo', chuva: 'estudo', praia: 'mar',
}

export function normalizeBackground(id: unknown): BackgroundId {
  if (typeof id !== 'string') return 'luz-da-manha'
  if (BACKGROUNDS.some((b) => b.id === id)) return id as BackgroundId
  return LEGACY[id] ?? 'luz-da-manha'
}

const BG_FILES = import.meta.glob('../../../assets/bible-backgrounds/*.{jpg,jpeg,png,webp}', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const BG_THUMBS = import.meta.glob('../../../assets/bible-backgrounds/thumbs/*.{jpg,jpeg,png,webp}', { query: '?url', import: 'default', eager: true }) as Record<string, string>

const fileFor = (files: Record<string, string>, id: BackgroundId) => {
  const k = Object.keys(files).find((f) => f.split('/').pop()!.replace(/\.(jpe?g|png|webp)$/, '') === id)
  return k ? files[k] : null
}

export function backgroundImage(id: BackgroundId): string | null {
  return fileFor(BG_FILES, id)
}

export function backgroundThumb(id: BackgroundId): string | null {
  return fileFor(BG_THUMBS, id) ?? fileFor(BG_FILES, id)
}

export function backgroundOf(id: BackgroundId) {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]
}

export type CoverId = 'classico' | 'executiva' | 'linho' | 'oliva' | 'horizonte'

export type CoverStyle = {
  id: CoverId
  label: string
  kind: 'leather' | 'linen'
  base: string
  ink: string
  frame: 'double' | 'single' | 'none'
  ornament: 'none' | 'olive' | 'mountains'
  edge: 'gilt' | 'ivory'
}

export const COVERS: CoverStyle[] = [
  { id: 'classico', label: 'Couro clássico', kind: 'leather', base: '#4a2516', ink: '#e2bf78', frame: 'double', ornament: 'none', edge: 'gilt' },
  { id: 'executiva', label: 'Executiva', kind: 'leather', base: '#161618', ink: '#d9b46a', frame: 'single', ornament: 'none', edge: 'gilt' },
  { id: 'linho', label: 'Linho', kind: 'linen', base: '#dcd0ba', ink: '#7a5634', frame: 'none', ornament: 'none', edge: 'ivory' },
  { id: 'oliva', label: 'Oliva', kind: 'leather', base: '#25402f', ink: '#d6b46c', frame: 'none', ornament: 'olive', edge: 'gilt' },
  { id: 'horizonte', label: 'Horizonte', kind: 'leather', base: '#1c2c48', ink: '#d8b46c', frame: 'none', ornament: 'mountains', edge: 'gilt' },
]

export function coverOf(id: CoverId) {
  return COVERS.find((c) => c.id === id) ?? COVERS[0]
}

function leafCookie() {
  const s = 512
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, s, s)
  let seed = 11
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const leaf = (x: number, y: number, ang: number, len: number) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(len * 0.5, -len * 0.22, len, 0)
    ctx.quadraticCurveTo(len * 0.5, len * 0.22, 0, 0)
    ctx.fill()
    ctx.restore()
  }
  for (let b = 0; b < 9; b++) {
    let x = r() * s * 0.7
    let y = r() * s * 0.45
    let a = Math.PI * (0.15 + r() * 0.35)
    ctx.strokeStyle = 'rgba(30, 22, 14, 0.9)'
    ctx.lineWidth = 2
    for (let i = 0; i < 14; i++) {
      const nx = x + Math.cos(a) * 16
      const ny = y + Math.sin(a) * 16
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(nx, ny)
      ctx.stroke()
      x = nx
      y = ny
      a += (r() - 0.5) * 0.35
      for (const side of [-1, 1]) {
        ctx.fillStyle = `rgba(28, 20, 12, ${0.75 + r() * 0.2})`
        leaf(x, y, a + side * (0.6 + r() * 0.5), 22 + r() * 16)
      }
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function Lights({ light, getOpen }: { light: LightPreset; getOpen: () => number }) {
  const key = useRef<THREE.DirectionalLight>(null)
  const sun = useRef<THREE.SpotLight>(null)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const cookie = useMemo(() => leafCookie(), [])
  useEffect(() => () => cookie.dispose(), [cookie])

  useEffect(() => {
    const k = key.current
    if (k) {
      k.shadow.mapSize.set(2048, 2048)
      const cam = k.shadow.camera
      cam.left = cam.bottom = -2
      cam.right = cam.top = 2
      cam.near = 0.5
      cam.far = 14
      cam.updateProjectionMatrix()
      k.shadow.bias = -0.0003
      k.shadow.normalBias = 0.015
      k.shadow.radius = 8
    }
    const sp = sun.current
    if (sp) {
      sp.target.position.set(0.2, 0, 0.1)
      scene.add(sp.target)
      sp.map = cookie
      sp.shadow.mapSize.set(1024, 1024)
      sp.shadow.bias = -0.0003
    }
    return () => {
      if (sp) scene.remove(sp.target)
    }
  }, [scene, cookie])

  useFrame(() => {
    const leaves = light.leaves * (1 - getOpen() * 0.8)
    if (key.current) key.current.intensity = light.intensity * (1 - leaves * 0.45)
    if (sun.current) {
      sun.current.intensity = light.intensity * leaves * 0.9
      const vis = leaves > 0.02
      if (sun.current.visible !== vis) {
        sun.current.visible = vis
        gl.shadowMap.needsUpdate = true
      }
    }
  })
  const [x, y, z] = light.from
  return (
    <>
      <directionalLight ref={key} position={[x, y, z]} intensity={light.intensity} color={light.color} castShadow />
      <spotLight
        ref={sun}
        position={[x * 1.2, y * 1.2, z * 1.2]}
        angle={0.7}
        penumbra={0.6}
        decay={0}
        intensity={0}
        color={light.color}
        castShadow={light.leaves > 0.05}
      />
      <hemisphereLight args={[light.sky, light.ground, light.ambient]} />
    </>
  )
}

function ShadowCatcher({ opacity, color }: { opacity: number; color: string }) {
  const mat = useMemo(() => new THREE.ShadowMaterial({ opacity, color: new THREE.Color(color).multiplyScalar(0.35) }), [opacity, color])
  useEffect(() => () => mat.dispose(), [mat])
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-C - 0.0008} receiveShadow material={mat}>
      <planeGeometry args={[6, 4.6]} />
    </mesh>
  )
}

export function AmbienceScene({ background, getOpen }: { background: BackgroundId; getOpen: () => number }) {
  const light = backgroundOf(background).light
  return (
    <>
      <Lights light={light} getOpen={getOpen} />
      <ShadowCatcher opacity={light.shadow} color={light.shadowColor} />
    </>
  )
}
