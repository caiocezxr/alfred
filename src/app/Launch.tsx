import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { HYBRID, getProfile, setProfile, type Profile } from '../shared/profile'
import { companyCreate, getWork, loadWork, useWork } from '../features/work/store'
import { CompanyMark } from '../features/work/brand'
import { isUnlocked, markUnlocked, setPassword, verifyPassword, warmLocks } from '../shared/lock'
import './launch.css'

const NEW_COLORS = ['#1F8A5B', '#E07A2E', '#7A4FE0', '#D4373F', '#1A9BB0', '#C9A227']
const KEY = 'ps.launch.played'
const NEW = '__novo'
const TICKS = 120
const CLICK = 12
const PINS = 14

export function shouldLaunch() {
  if (!isUnlocked(getProfile())) return true
  try {
    return sessionStorage.getItem(KEY) !== '1'
  } catch {
    return false
  }
}

type Phase = 'pick' | 'lock' | 'new' | 'open' | 'done'
type Status = 'idle' | 'checking' | 'bad' | 'ok'
type Opt = { id: string; label: string; hint: string; color: string }

const fmtNow = (d: Date) =>
  `${new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d)} · ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(d)}`

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))
const angleAt = (x: number, y: number, cx: number, cy: number) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI

export function Launch({ onDone, intoRitual }: { onDone: () => void; intoRitual: boolean }) {
  const companies = useWork().state?.companies ?? []
  const options: Opt[] = [
    ...companies.map((c) => ({ id: c.id, label: c.name, hint: c.id === 'pessoal' ? 'Sua vida fora do trabalho' : `Só o trabalho da ${c.name}`, color: c.color })),
    { id: HYBRID, label: 'Híbrido', hint: 'Tudo junto, num lugar só', color: '#c9a46a' },
    { id: NEW, label: 'Novo perfil', hint: 'Outra empresa ou projeto', color: '#8a8f99' },
  ]
  const n = options.length
  const step = 360 / n

  const [phase, setPhase] = useState<Phase>('pick')
  const [status, setStatus] = useState<Status>('idle')
  const [turn, setTurn] = useState(() => Math.max(0, options.findIndex((o) => o.id === getProfile())))
  const [drag, setDrag] = useState<number | null>(null)
  const idx = ((turn % n) + n) % n
  const cur = options[idx] ?? options[0]
  const [pw, setPw] = useState('')
  const [caps, setCaps] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(NEW_COLORS[0])
  const [newPw, setNewPw] = useState('')
  const [now, setNow] = useState(() => new Date())
  const input = useRef<HTMLInputElement>(null)
  const dial = useRef<HTMLDivElement>(null)
  const tilt = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const synced = useRef(false)

  const live = useRef({ phase, idx, turn, n, options, status })
  live.current = { phase, idx, turn, n, options, status }

  useEffect(() => {
    void loadWork()
    warmLocks()
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {}
    const html = document.documentElement
    html.dataset.intro = '1'
    html.dataset.launch = '1'
    const t = window.setInterval(() => setNow(new Date()), 15000)
    return () => {
      window.clearInterval(t)
      delete html.dataset.launch
    }
  }, [])

  useEffect(() => {
    if (synced.current || !companies.length) return
    synced.current = true
    const i = options.findIndex((o) => o.id === getProfile())
    if (i >= 0) setTurn(i)
  }, [companies.length])

  const rotateTo = (target: number) => {
    const { idx: from, n: total, turn: t } = live.current
    let d = (target - from) % total
    if (d > total / 2) d -= total
    if (d < -total / 2) d += total
    setTurn(t + d)
  }

  const nudge = (dir: number) => setTurn((t) => t + dir)

  const back = () => {
    if (live.current.status === 'checking' || live.current.status === 'ok') return
    setPhase('pick')
    setStatus('idle')
    setPw('')
  }

  const enter = (i = live.current.idx) => {
    const o = live.current.options[i]
    if (!o || live.current.phase !== 'pick') return
    if (i !== live.current.idx) rotateTo(i)
    if (o.id === NEW) {
      setPhase('new')
      return
    }
    if (isUnlocked(o.id)) return finish(o.id)
    setPw('')
    setStatus('idle')
    setPhase('lock')
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
  }

  const finish = (id: Profile) => {
    setProfile(id, getWork().state?.companies.find((c) => c.id === id)?.color ?? null)
    setStatus('ok')
    setPhase('open')
    setTurn((t) => t + live.current.n)
    const html = document.documentElement
    const fast = calm()
    window.setTimeout(() => {
      delete html.dataset.launch
      if (!intoRitual) delete html.dataset.intro
    }, fast ? 0 : 380)
    window.setTimeout(() => {
      setPhase('done')
      onDone()
    }, fast ? 120 : 760)
  }

  const unlock = async () => {
    if (!pw || live.current.status === 'checking' || cur.id === NEW) return
    setStatus('checking')
    const [ok] = await Promise.all([verifyPassword(cur.id, pw), sleep(calm() ? 0 : 420)])
    if (ok) finish(cur.id)
    else {
      setStatus('bad')
      window.setTimeout(() => {
        setPw('')
        setStatus('idle')
      }, 460)
    }
  }

  useEffect(() => {
    if (phase === 'lock' && status === 'idle') input.current?.focus({ preventScroll: true })
  }, [phase, status])

  const create = async () => {
    const name = newName.trim()
    if (!name || newPw.length < 4) return
    const before = new Set((getWork().state?.companies ?? []).map((c) => c.id))
    await companyCreate(name, newColor)
    const made = (getWork().state?.companies ?? []).find((c) => !before.has(c.id))
    if (!made) return
    await setPassword(made.id, newPw)
    markUnlocked(made.id)
    setNewName('')
    setNewPw('')
    finish(made.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = live.current.phase
      if (p === 'open' || p === 'done') return
      if (p === 'lock' || p === 'new') {
        if (e.key === 'Escape') {
          e.preventDefault()
          back()
        }
        return
      }
      const k = e.key
      if (k === 'ArrowRight' || k === 'ArrowDown') {
        e.preventDefault()
        nudge(1)
      } else if (k === 'ArrowLeft' || k === 'ArrowUp') {
        e.preventDefault()
        nudge(-1)
      } else if (k === 'Enter' || k === ' ') {
        e.preventDefault()
        enter()
      } else if (k.toLowerCase() === 'n') {
        e.preventDefault()
        rotateTo(live.current.n - 1)
        setPhase('new')
      } else if (/^[1-9]$/.test(k) && Number(k) <= live.current.n - 1) {
        e.preventDefault()
        enter(Number(k) - 1)
      }
    }
    let acc = 0
    let last = 0
    const onWheel = (e: WheelEvent) => {
      if (live.current.phase !== 'pick') return
      e.preventDefault()
      const t = performance.now()
      if (t - last > 220) acc = 0
      last = t
      acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (Math.abs(acc) >= 36) {
        nudge(acc > 0 ? 1 : -1)
        acc = 0
      }
    }
    let raf = 0
    let mx = 0
    let my = 0
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5
      my = e.clientY / window.innerHeight - 0.5
      if (raf || calm()) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = tilt.current
        if (!el) return
        el.style.setProperty('--rx', `${(mx * 10).toFixed(2)}deg`)
        el.style.setProperty('--ry', `${(-my * 8).toFixed(2)}deg`)
      })
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (live.current.phase !== 'pick' || e.button !== 0) return
    if ((e.target as HTMLElement).closest('.lx-core')) return
    const r = dial.current!.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let prev = angleAt(e.clientX, e.clientY, cx, cy)
    let total = 0
    let moved = false
    let raf = 0
    dragged.current = false
    const move = (ev: PointerEvent) => {
      const a = angleAt(ev.clientX, ev.clientY, cx, cy)
      let d = a - prev
      if (d > 180) d -= 360
      if (d < -180) d += 360
      prev = a
      total += d
      if (!moved && Math.abs(total) > 4) {
        moved = true
        dragged.current = true
      }
      if (moved && !raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          setDrag(total)
        })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      cancelAnimationFrame(raf)
      if (moved) setTurn((t) => t - Math.round(total / (360 / live.current.n)))
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const ticks = useMemo(
    () =>
      Array.from({ length: TICKS }, (_, i) => {
        const a = (i / TICKS) * Math.PI * 2
        const major = i % 10 === 0
        const r1 = major ? 181 : 186
        return <line key={i} className={major ? 'is-major' : ''} x1={200 + Math.sin(a) * r1} y1={200 - Math.cos(a) * r1} x2={200 + Math.sin(a) * 193} y2={200 - Math.cos(a) * 193} />
      }),
    [],
  )

  if (phase === 'done') return null

  const locking = phase === 'lock' || (phase === 'open' && status === 'ok')
  const ring = -turn * step + (drag ?? 0) + (phase === 'lock' ? pw.length * CLICK : 0)
  const company = companies.find((c) => c.id === cur.id)
  const pc = cur.id === NEW ? newColor : cur.color
  const pins = Math.min(PINS, Math.max(6, pw.length))

  const mark = (o: Opt, size: number) => {
    const c = companies.find((x) => x.id === o.id)
    if (c) return <CompanyMark company={c} size={size} />
    if (o.id === HYBRID)
      return (
        <span className="lx-hybrid">
          {companies.slice(0, 4).map((x) => (
            <i key={x.id} style={{ background: x.color }} />
          ))}
        </span>
      )
    return <span className="lx-plus">+</span>
  }

  return createPortal(
    <div
      className={`lx is-${phase} st-${status} ${locking ? 'is-locking' : ''} ${drag !== null ? 'is-dragging' : ''} ${intoRitual ? 'to-ritual' : ''}`}
      style={{ ['--pc' as string]: pc, ['--span' as string]: `${step}deg` } as CSSProperties}
    >
      <div className="lx-bg" aria-hidden="true">
        <span className="lx-glow" />
      </div>

      <header className="lx-top">
        <span className="lx-word">Personal Space</span>
        <span className="lx-now">{fmtNow(now)}</span>
      </header>

      <div className="lx-stage">
        <div className="lx-tilt" ref={tilt}>
          <div className="lx-dial" ref={dial} onPointerDown={startDrag}>
            <span className="lx-sector" aria-hidden="true" />
            <span className="lx-notch" aria-hidden="true" />
            <div className="lx-ring" style={{ transform: `rotate(${ring}deg)` }}>
              <svg className="lx-ticks" viewBox="0 0 400 400" aria-hidden="true">
                {ticks}
              </svg>
              {options.map((o, i) => {
                const a = i * step
                return (
                  <div key={o.id} className="lx-station" style={{ transform: `rotate(${a}deg) translateY(-148px)` }}>
                    <button
                      type="button"
                      className={`lx-st ${i === idx ? 'is-on' : ''} ${o.id === NEW ? 'is-new' : ''}`}
                      style={{ transform: `rotate(${-(a + ring)}deg)`, ['--sc' as string]: o.color } as CSSProperties}
                      onClick={() => {
                        if (dragged.current) {
                          dragged.current = false
                          return
                        }
                        if (i === idx) enter(i)
                        else rotateTo(i)
                      }}
                      tabIndex={phase === 'pick' ? 0 : -1}
                      aria-label={o.label}
                      aria-pressed={i === idx}
                    >
                      <span className="lx-st-mark">{mark(o, 22)}</span>
                      <span className="lx-st-name">{o.label}</span>
                    </button>
                  </div>
                )
              })}
            </div>

            <div className={`lx-core ${status === 'bad' ? 'is-bad' : ''}`}>
              <span className="lx-core-face" aria-hidden="true" />
              <svg className="lx-arc" viewBox="0 0 220 220" aria-hidden="true">
                <circle className="lx-arc-track" cx="110" cy="110" r="106" />
                <circle className="lx-arc-run" cx="110" cy="110" r="106" pathLength={100} />
              </svg>
              {[0, 90, 180, 270].map((r) => (
                <span key={r} className="lx-bolt" style={{ ['--r' as string]: `${r}deg` } as CSSProperties} aria-hidden="true">
                  <i />
                </span>
              ))}
              {phase === 'lock' ? (
                <form
                  className="lx-lock"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void unlock()
                  }}
                >
                  <span className="lx-lock-mark">{company ? <CompanyMark company={company} size={20} /> : mark(cur, 20)}</span>
                  <span className="lx-k">{status === 'bad' ? 'Senha incorreta' : status === 'checking' ? 'Conferindo' : caps ? 'Caps Lock ligado' : cur.label}</span>
                  <label className="lx-pins">
                    {Array.from({ length: pins }, (_, i) => (
                      <i key={i} className={i < pw.length ? 'is-on' : ''} style={{ ['--k' as string]: i } as CSSProperties} />
                    ))}
                    {pw.length > PINS && <b>+{pw.length - PINS}</b>}
                    <input
                      ref={input}
                      autoFocus
                      type="password"
                      value={pw}
                      readOnly={status === 'checking' || status === 'bad'}
                      onChange={(e) => live.current.status === 'idle' && setPw(e.target.value)}
                      onKeyDown={(e) => setCaps(e.getModifierState('CapsLock'))}
                      onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                      onBlur={() => window.setTimeout(() => live.current.phase === 'lock' && input.current?.focus({ preventScroll: true }), 0)}
                      aria-label={`Senha do perfil ${cur.label}`}
                      autoComplete="current-password"
                    />
                  </label>
                  <span className="lx-hint">
                    {pw ? (
                      <>
                        <kbd>Enter</kbd> abre o cofre
                      </>
                    ) : (
                      <>
                        digite a senha · <kbd>Esc</kbd> volta
                      </>
                    )}
                  </span>
                </form>
              ) : phase === 'open' ? (
                <div className="lx-open">
                  <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  <span className="lx-k">{cur.id === NEW ? 'Pronto' : cur.label}</span>
                </div>
              ) : (
                <button type="button" className="lx-pick" onClick={() => enter()} tabIndex={-1} aria-hidden="true">
                  <span className="lx-pick-mark" key={cur.id}>
                    {company ? <CompanyMark company={company} size={34} /> : mark(cur, 34)}
                  </span>
                  <span className="lx-name" key={`n${cur.id}`}>
                    {cur.label}
                  </span>
                  <span className="lx-sub" key={`h${cur.id}`}>
                    {cur.hint}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {phase === 'new' ? (
          <form
            className="lx-new"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <input autoFocus value={newName} maxLength={40} placeholder="Nome da empresa" onChange={(e) => setNewName(e.target.value)} aria-label="Nome do novo perfil" />
            <span className="lx-swatches">
              {NEW_COLORS.map((c) => (
                <button type="button" key={c} className={c === newColor ? 'is-on' : ''} style={{ background: c }} onClick={() => setNewColor(c)} aria-label={`Cor ${c}`} />
              ))}
            </span>
            <input type="password" value={newPw} placeholder="Senha (mín. 4)" onChange={(e) => setNewPw(e.target.value)} aria-label="Senha do novo perfil" autoComplete="new-password" />
            <button type="submit" className="lx-create" disabled={!newName.trim() || newPw.length < 4}>
              Criar e entrar
            </button>
          </form>
        ) : (
          <p className="lx-help">
            {phase === 'pick' ? (
              <>
                <kbd>←</kbd>
                <kbd>→</kbd> role ou arraste o anel · <kbd>Enter</kbd> abre · <kbd>1</kbd>–<kbd>{n - 1}</kbd> direto
              </>
            ) : phase === 'lock' ? (
              <>cada tecla gira o anel um dente</>
            ) : (
              ' '
            )}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}
