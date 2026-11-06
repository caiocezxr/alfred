import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HYBRID, getProfile, setProfile, type Profile } from '../shared/profile'
import { companyCreate, getWork, loadWork, useWork } from '../features/work/store'
import { CompanyMark } from '../features/work/brand'
import './launch.css'

const NEW_COLORS = ['#1F8A5B', '#E07A2E', '#7A4FE0', '#D4373F', '#1A9BB0', '#C9A227']

const KEY = 'ps.launch.played'

export function shouldLaunch() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  try {
    return sessionStorage.getItem(KEY) !== '1'
  } catch {
    return false
  }
}

type Phase = 'ignite' | 'rise' | 'pick' | 'open' | 'done'

export function Launch({ onDone, intoRitual }: { onDone: () => void; intoRitual: boolean }) {
  const [phase, setPhase] = useState<Phase>('ignite')
  const root = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  const fast = useRef(false)
  const [sel, setSel] = useState<Profile>(getProfile)
  const phaseRef = useRef<Phase>('ignite')
  phaseRef.current = phase
  const selRef = useRef(sel)
  selRef.current = sel
  const companies = useWork().state?.companies ?? []
  const options: { id: Profile; label: string; hint: string; color: string }[] = [
    ...companies.map((c) => ({ id: c.id, label: c.name, hint: c.id === 'pessoal' ? 'Sua vida fora do trabalho' : `Só o trabalho da ${c.name}`, color: c.color })),
    { id: HYBRID, label: 'Híbrido', hint: 'Tudo junto, como hoje', color: '#c9b28a' },
  ]
  const optsRef = useRef(options)
  optsRef.current = options
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(NEW_COLORS[0])
  const creatingRef = useRef(false)
  creatingRef.current = creating
  const ritualRef = useRef(intoRitual)
  ritualRef.current = intoRitual
  const chooseRef = useRef<(p: Profile) => void>(() => {})

  useEffect(() => {
    void loadWork()
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {}
    const html = document.documentElement
    html.dataset.intro = '1'
    html.dataset.launch = '1'
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
    at(650, () => setPhase('rise'))
    at(1500, () => setPhase('pick'))
    const skip = () => {
      if (fast.current) return
      fast.current = true
      timers.current.forEach(clearTimeout)
      timers.current = []
      setPhase('pick')
    }
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'pick') {
        skip()
        return
      }
      if (creatingRef.current) return
      const order = optsRef.current.map((p) => p.id)
      const n = Number(e.key)
      if (n >= 1 && n <= order.length) {
        e.preventDefault()
        chooseRef.current(order[n - 1])
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setCreating(true)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const i = order.indexOf(selRef.current)
        setSel(order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length])
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        chooseRef.current(selRef.current)
      }
    }
    const onDown = () => phaseRef.current !== 'pick' && skip()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)

    const onMove = (e: PointerEvent) => {
      const el = root.current
      if (!el) return
      const x = e.clientX / window.innerWidth - 0.5
      const y = e.clientY / window.innerHeight - 0.5
      el.style.setProperty('--tx', x.toFixed(3))
      el.style.setProperty('--ty', y.toFixed(3))
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    return () => {
      timers.current.forEach(clearTimeout)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      delete html.dataset.launch
    }
  }, [])

  const choose = (p: Profile) => {
    if (phaseRef.current !== 'pick') return
    setSel(p)
    setProfile(p, getWork().state?.companies.find((c) => c.id === p)?.color ?? null)
    phaseRef.current = 'open'
    window.setTimeout(open, 260)
  }
  chooseRef.current = choose

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    const before = new Set((getWork().state?.companies ?? []).map((c) => c.id))
    await companyCreate(name, newColor)
    const made = (getWork().state?.companies ?? []).find((c) => !before.has(c.id))
    setCreating(false)
    setNewName('')
    if (made) choose(made.id)
  }

  const open = () => {
    setPhase('open')
    const html = document.documentElement
    const ritual = ritualRef.current
    window.setTimeout(() => {
      if (!ritualRef.current) delete html.dataset.intro
    }, ritual ? 0 : 260)
    window.setTimeout(() => {
      setPhase('done')
      onDone()
    }, ritual ? 700 : 1050)
  }

  if (phase === 'done') return null

  const ticks = Array.from({ length: 60 }, (_, i) => i)

  return createPortal(
    <div ref={root} className={`ln is-${phase} ${intoRitual ? 'to-ritual' : ''}`} aria-hidden="true">
      <div className="ln-door is-top" />
      <div className="ln-door is-bottom" />
      <div className="ln-stage">
        <div className="ln-emblem">
          <svg className="ln-bezel" viewBox="0 0 200 200">
            {ticks.map((i) => {
              const a = (i / 60) * Math.PI * 2 - Math.PI / 2
              const long = i % 5 === 0
              const r1 = long ? 82 : 86
              return (
                <line
                  key={i}
                  x1={100 + Math.cos(a) * r1}
                  y1={100 + Math.sin(a) * r1}
                  x2={100 + Math.cos(a) * 92}
                  y2={100 + Math.sin(a) * 92}
                  style={{ ['--k' as string]: i }}
                  className={long ? 'is-long' : ''}
                />
              )
            })}
          </svg>
          <div className="ln-window">
            <div className="ln-sun" />
            <div className="ln-water" />
          </div>
          <div className="ln-glint" />
        </div>
        <div className="ln-pick" role="radiogroup" aria-label="Com qual perfil você quer começar?">
          <p className="ln-ask">Com qual perfil você começa hoje?</p>
          <div className="ln-cards">
            {options.map((p, i) => {
              const company = companies.find((c) => c.id === p.id)
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={sel === p.id}
                  className={`ln-card ${sel === p.id ? 'is-on' : ''}`}
                  style={{ ['--pc' as string]: p.color, ['--k' as string]: i }}
                  onMouseEnter={() => setSel(p.id)}
                  onFocus={() => setSel(p.id)}
                  onClick={() => choose(p.id)}
                >
                  <span className="ln-card-mark">
                    {company ? (
                      <CompanyMark company={company} size={34} />
                    ) : (
                      <span className="ln-hybrid">
                        {companies.slice(0, 4).map((c) => (
                          <i key={c.id} style={{ background: c.color }} />
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="ln-card-name">{p.label}</span>
                  <span className="ln-card-hint">{p.hint}</span>
                  <kbd>{i + 1}</kbd>
                </button>
              )
            })}
            {creating ? (
              <form
                className="ln-card is-new is-form"
                style={{ ['--pc' as string]: newColor, ['--k' as string]: options.length }}
                onSubmit={(e) => {
                  e.preventDefault()
                  void create()
                }}
              >
                <input autoFocus value={newName} maxLength={40} placeholder="Nome da empresa" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(false)} aria-label="Nome do novo perfil" />
                <span className="ln-swatches">
                  {NEW_COLORS.map((c) => (
                    <button type="button" key={c} className={c === newColor ? 'is-on' : ''} style={{ background: c }} onClick={() => setNewColor(c)} aria-label={`Cor ${c}`} />
                  ))}
                </span>
                <button type="submit" className="ln-create" disabled={!newName.trim()}>
                  Criar e entrar
                </button>
              </form>
            ) : (
              <button className="ln-card is-new" style={{ ['--k' as string]: options.length }} onClick={() => setCreating(true)}>
                <span className="ln-card-mark is-plus">+</span>
                <span className="ln-card-name">Novo perfil</span>
                <span className="ln-card-hint">Outra empresa ou projeto</span>
                <kbd>N</kbd>
              </button>
            )}
          </div>
          <p className="ln-help">
            <kbd>←</kbd> <kbd>→</kbd> escolhe · <kbd>Enter</kbd> entra · troque a qualquer momento no app
          </p>
        </div>
        <div className="ln-word">
          {'PERSONAL SPACE'.split('').map((c, i) => (
            <span key={i} style={{ ['--k' as string]: i }}>
              {c === ' ' ? ' ' : c}
            </span>
          ))}
        </div>
      </div>
      <div className="ln-line" />
    </div>,
    document.body,
  )
}
