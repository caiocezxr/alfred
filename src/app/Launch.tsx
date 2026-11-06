import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HYBRID, getProfile, setProfile, type Profile } from '../shared/profile'
import { companyCreate, getWork, loadWork, useWork } from '../features/work/store'
import { CompanyMark } from '../features/work/brand'
import { isUnlocked, markUnlocked, setPassword, verifyPassword, warmLocks } from '../shared/lock'
import './launch.css'

const NEW_COLORS = ['#1F8A5B', '#E07A2E', '#7A4FE0', '#D4373F', '#1A9BB0', '#C9A227']

const KEY = 'ps.launch.played'

export function shouldLaunch() {
  if (!isUnlocked(getProfile())) return true
  try {
    return sessionStorage.getItem(KEY) !== '1'
  } catch {
    return false
  }
}

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Phase = 'ignite' | 'rise' | 'pick' | 'open' | 'done'

export function Launch({ onDone, intoRitual }: { onDone: () => void; intoRitual: boolean }) {
  const [phase, setPhase] = useState<Phase>(() => (calm() ? 'pick' : 'ignite'))
  const [lock, setLock] = useState<Profile | null>(null)
  const [pw, setPw] = useState('')
  const [bad, setBad] = useState(0)
  const [checking, setChecking] = useState(false)
  const lockRef = useRef<Profile | null>(null)
  lockRef.current = lock
  const emblem = useRef<HTMLDivElement>(null)
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
  const [newPw, setNewPw] = useState('')
  const creatingRef = useRef(false)
  creatingRef.current = creating
  const ritualRef = useRef(intoRitual)
  ritualRef.current = intoRitual
  const chooseRef = useRef<(p: Profile) => void>(() => {})

  useEffect(() => {
    void loadWork()
    warmLocks()
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {}
    const html = document.documentElement
    html.dataset.intro = '1'
    html.dataset.launch = '1'
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
    if (!calm()) {
      at(380, () => setPhase('rise'))
      at(900, () => setPhase('pick'))
    }
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
      if (lockRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setLock(null)
          setPw('')
        }
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

    let raf = 0
    let mx = 0
    let my = 0
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5
      my = e.clientY / window.innerHeight - 0.5
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = emblem.current
        if (!el) return
        el.style.setProperty('--tx', mx.toFixed(3))
        el.style.setProperty('--ty', my.toFixed(3))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    return () => {
      timers.current.forEach(clearTimeout)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
      delete html.dataset.launch
    }
  }, [])

  const enter = (p: Profile) => {
    if (phaseRef.current !== 'pick') return
    setSel(p)
    setProfile(p, getWork().state?.companies.find((c) => c.id === p)?.color ?? null)
    phaseRef.current = 'open'
    window.setTimeout(open, 160)
  }

  const choose = (p: Profile) => {
    if (phaseRef.current !== 'pick') return
    setSel(p)
    if (isUnlocked(p)) return enter(p)
    setPw('')
    setBad(0)
    setLock(p)
  }
  chooseRef.current = choose

  const unlock = async () => {
    const p = lockRef.current
    if (!p || !pw || checking) return
    setChecking(true)
    const ok = await verifyPassword(p, pw)
    setChecking(false)
    if (ok) {
      setLock(null)
      enter(p)
    } else {
      setPw('')
      setBad((n) => n + 1)
    }
  }

  const create = async () => {
    const name = newName.trim()
    if (!name || newPw.length < 4) return
    const before = new Set((getWork().state?.companies ?? []).map((c) => c.id))
    await companyCreate(name, newColor)
    const made = (getWork().state?.companies ?? []).find((c) => !before.has(c.id))
    setCreating(false)
    setNewName('')
    if (made) {
      await setPassword(made.id, newPw)
      markUnlocked(made.id)
      enter(made.id)
    }
    setNewPw('')
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
    }, ritual ? 600 : 820)
  }

  if (phase === 'done') return null

  const ticks = Array.from({ length: 60 }, (_, i) => i)
  const lockOpt = lock ? options.find((o) => o.id === lock) ?? null : null
  const lockCompany = lock ? companies.find((c) => c.id === lock) ?? null : null

  return createPortal(
    <div ref={root} className={`ln is-${phase} ${intoRitual ? 'to-ritual' : ''} ${lock ? 'is-locking' : ''}`}>
      <div className="ln-door is-top" />
      <div className="ln-door is-bottom" />
      <div className="ln-stage">
        <div className="ln-emblem" ref={emblem} aria-hidden="true">
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
          <p className="ln-ask">{lock ? 'Digite a senha do perfil' : 'Com qual perfil você começa hoje?'}</p>
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
                <input type="password" value={newPw} placeholder="Senha (mín. 4)" onChange={(e) => setNewPw(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(false)} aria-label="Senha do novo perfil" autoComplete="new-password" />
                <span className="ln-swatches">
                  {NEW_COLORS.map((c) => (
                    <button type="button" key={c} className={c === newColor ? 'is-on' : ''} style={{ background: c }} onClick={() => setNewColor(c)} aria-label={`Cor ${c}`} />
                  ))}
                </span>
                <button type="submit" className="ln-create" disabled={!newName.trim() || newPw.length < 4}>
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
          {lockOpt && (
            <form
              key={lockOpt.id}
              className={`ln-lock ${bad ? 'is-bad' : ''}`}
              style={{ ['--pc' as string]: lockOpt.color }}
              onSubmit={(e) => {
                e.preventDefault()
                void unlock()
              }}
            >
              <span className="ln-lock-mark">
                {lockCompany ? (
                  <CompanyMark company={lockCompany} size={30} />
                ) : (
                  <span className="ln-hybrid">
                    {companies.slice(0, 4).map((c) => (
                      <i key={c.id} style={{ background: c.color }} />
                    ))}
                  </span>
                )}
              </span>
              <span className="ln-lock-body">
                <span className="ln-lock-name">{lockOpt.label}</span>
                <span key={bad} className="ln-lock-field">
                  <svg className="ln-lock-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                    <rect x="3" y="7" width="10" height="7" rx="1.6" />
                    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                  </svg>
                  <input
                    autoFocus
                    type="password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="Senha do perfil"
                    aria-label={`Senha do perfil ${lockOpt.label}`}
                    autoComplete="current-password"
                  />
                  <button type="submit" className="ln-lock-go" disabled={!pw || checking} aria-label="Entrar">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
                    </svg>
                  </button>
                </span>
                <span className="ln-lock-msg" role={bad ? 'alert' : undefined}>
                  {bad ? 'Senha incorreta. Tente de novo.' : checking ? 'Conferindo…' : ' '}
                </span>
              </span>
              <button
                type="button"
                className="ln-lock-back"
                onClick={() => {
                  setLock(null)
                  setPw('')
                }}
              >
                Trocar perfil <kbd>Esc</kbd>
              </button>
            </form>
          )}
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
