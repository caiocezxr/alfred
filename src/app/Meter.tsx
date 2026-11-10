import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { activities } from '../shared/activity'
import { isTauri } from '../shared/db/api'
import { ROUTES, useRoute } from './router'

type Part = { role: 'app' | 'pagina' | 'graficos' | 'local'; cpu: number; gpu: number; mem: number }
export type MeterSample = { parts: Part[]; cpu: number; mem: number; gpu: number | null; cores: number }
type Consumer = { key: string; label: string; detail: string; cpu: number; gpu: number; local?: boolean }

export const meterApi = {
  sample: async (detail = true): Promise<MeterSample> => {
    if (!isTauri) throw new Error('fora do app')
    return invoke<MeterSample>('meter_sample', { detail })
  },
}

const N = 40

const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`)
const pct = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`
const tone = (cpu: number) => (cpu >= 80 ? 'hot' : cpu >= 25 ? 'warm' : 'calm')
const part = (s: MeterSample, role: Part['role']) => s.parts.find((p) => p.role === role) ?? { role, cpu: 0, gpu: 0, mem: 0 }

function loops() {
  return document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length
}

function attribute(s: MeterSample, worked: Map<string, number>, screen: string): Consumer[] {
  const acts = activities()
  const out: Consumer[] = []
  const page = part(s, 'pagina')
  const gfx = part(s, 'graficos')
  const core = part(s, 'app')
  const local = part(s, 'local')

  let pageLeft = page.cpu
  for (const a of acts.filter((x) => x.work)) {
    const cpu = Math.min(pageLeft, worked.get(a.id) ?? 0)
    pageLeft -= cpu
    out.push({ key: a.id, label: a.label, detail: a.detail, cpu, gpu: 0 })
  }
  for (const a of acts.filter((x) => !x.work && x.engine === 'worker')) out.push({ key: a.id, label: a.label, detail: a.detail, cpu: 0, gpu: 0 })

  const locals = acts.filter((x) => x.engine === 'local')
  for (const a of locals) out.push({ key: a.id, label: a.label, detail: `${a.detail} · modelo local (Ollama)`, cpu: local.cpu / locals.length, gpu: local.gpu / locals.length, local: true })

  const cores = acts.filter((x) => x.engine === 'core')
  if (cores.length) for (const a of cores) out.push({ key: a.id, label: a.label, detail: a.detail, cpu: core.cpu / cores.length, gpu: 0 })
  else out.push({ key: 'core', label: 'Núcleo do Shed', detail: 'banco de dados e serviços em segundo plano', cpu: core.cpu, gpu: core.gpu })

  const n = loops()
  const webgl = !!document.querySelector('canvas.curl, .bible canvas')
  out.push({
    key: 'tela',
    label: `Tela ${screen}`,
    detail: [n ? `${n} ${n === 1 ? 'animação' : 'animações'} em loop` : 'sem animação em loop', webgl ? 'livro em WebGL' : ''].filter(Boolean).join(' · '),
    cpu: Math.max(0, pageLeft) + gfx.cpu,
    gpu: page.gpu + gfx.gpu,
  })
  return out.filter((c) => c.cpu >= 0.05 || c.gpu >= 0.05 || c.key === 'tela').sort((a, b) => b.cpu + b.gpu - (a.cpu + a.gpu))
}

function Spark({ data, max }: { data: number[]; max: number }) {
  if (data.length < 2) return <svg className="mt-spark" viewBox="0 0 100 24" aria-hidden="true" />
  const top = Math.max(max, ...data, 1)
  const pts = data.map((v, i) => `${(i / (N - 1)) * 100},${24 - (v / top) * 22 - 1}`)
  const off = ((N - data.length) / (N - 1)) * 100
  return (
    <svg className="mt-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <g transform={`translate(${off} 0)`}>
        <polygon points={`0,24 ${pts.join(' ')} ${((data.length - 1) / (N - 1)) * 100},24`} />
        <polyline points={pts.join(' ')} />
      </g>
    </svg>
  )
}

export function ResourceMeter({ compact }: { compact: boolean }) {
  const route = useRoute()
  const screen = ROUTES.find((r) => r.id === route)?.label ?? 'atual'
  const [s, setS] = useState<MeterSample | null>(null)
  const [who, setWho] = useState<Consumer[]>([])
  const [hist, setHist] = useState<number[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
  const last = useRef<{ t: number; work: Map<string, number> } | null>(null)
  const screenRef = useRef(screen)
  screenRef.current = screen

  useEffect(() => {
    let alive = true
    let t = 0
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const x = await meterApi.sample(open)
          if (!alive) return
          const now = performance.now()
          const work = new Map(activities().filter((a) => a.work).map((a) => [a.id, a.work!()]))
          const worked = new Map<string, number>()
          const prev = last.current
          if (prev) for (const [id, w] of work) worked.set(id, Math.max(0, ((w - (prev.work.get(id) ?? w)) / (now - prev.t)) * 100))
          last.current = { t: now, work }
          setS(x)
          setWho(attribute(x, worked, screenRef.current))
          setHist((h) => [...h.slice(-(N - 1)), x.cpu])
        } catch {
          if (alive) setS(null)
        }
      }
      if (alive) t = window.setTimeout(tick, open ? 1500 : 4000)
    }
    void tick()
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const r = box.current?.getBoundingClientRect()
    if (r) setAt({ left: r.right + 14, bottom: Math.max(12, window.innerHeight - r.bottom) })
    const out = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', out)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', out)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!s) return null
  const local = part(s, 'local')
  const busyLocal = who.some((c) => c.local)
  const cpu = s.cpu + (busyLocal ? local.cpu : 0)
  const mem = s.mem + (busyLocal ? local.mem : 0)
  const level = Math.min(1, cpu / 100)
  const top = who[0]
  const heavy = top && top.cpu + top.gpu >= 8 ? top : null
  const peak = Math.max(1, ...who.map((c) => c.cpu + c.gpu))

  return (
    <div className={`mt is-${tone(cpu)} ${open ? 'is-open' : ''}`} ref={box}>
      {open &&
        at &&
        createPortal(
          <div className={`mt-pop is-${tone(cpu)}`} ref={pop} role="dialog" aria-label="Consumo do Shed" style={{ left: at.left, bottom: at.bottom } as CSSProperties}>
            <div className="mt-pop-head">
              <span>Consumo do Shed</span>
              <em>ao vivo</em>
            </div>
            <Spark data={hist} max={50} />
            <dl className="mt-big">
              <div>
                <dt>CPU</dt>
                <dd>{pct(cpu)}</dd>
              </div>
              <div>
                <dt>Memória</dt>
                <dd>{mb(mem)}</dd>
              </div>
              <div>
                <dt>GPU</dt>
                <dd>{s.gpu == null ? '—' : `${Math.round(s.gpu)}%`}</dd>
              </div>
            </dl>
            <div className="mt-who-k">Pesando agora</div>
            <ul className="mt-who">
              {who.map((c, i) => (
                <li key={c.key} className={i === 0 && heavy ? 'is-top' : ''} style={{ ['--k' as string]: i } as CSSProperties}>
                  <div className="mt-who-row">
                    <span className="mt-who-l">{c.label}</span>
                    <b>{pct(c.cpu)}</b>
                    <em>{c.gpu >= 0.1 ? `GPU ${pct(c.gpu)}` : ''}</em>
                  </div>
                  <i style={{ ['--w' as string]: `${Math.min(100, ((c.cpu + c.gpu) / peak) * 100)}%` }} aria-hidden="true" />
                  {c.detail && <span className="mt-who-d">{c.detail}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-help">
              CPU medida por processo, como no Monitor de Atividade: 100% é um núcleo inteiro (este Mac tem {s.cores}). GPU do topo é o uso total da placa de vídeo do Mac.
              {busyLocal ? ` CPU e memória incluem o modelo local enquanto ele trabalha para o Shed.` : ''}
            </p>
          </div>,
          document.body,
        )}
      <button
        className="mt-btn"
        onClick={() => setOpen((o) => !o)}
        title={`CPU ${pct(cpu)} · ${mb(mem)}${s.gpu != null ? ` · GPU ${Math.round(s.gpu)}%` : ''}${heavy ? ` · pesando: ${heavy.label}` : ''}`}
        aria-expanded={open}
      >
        <span className="mt-dial" style={{ ['--lv' as string]: level }} aria-hidden="true">
          <i />
        </span>
        {!compact && (
          <span className="mt-read">
            <span>
              <b>CPU</b> {pct(cpu)}
            </span>
            <span>
              <b>MEM</b> {mb(mem)}
            </span>
            {s.gpu != null && (
              <span>
                <b>GPU</b> {Math.round(s.gpu)}%
              </span>
            )}
            {heavy && <span className="mt-heavy">▲ {heavy.label}</span>}
          </span>
        )}
      </button>
    </div>
  )
}
