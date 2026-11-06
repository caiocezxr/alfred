import { useEffect, useRef, useState } from 'react'
import { civil, fmtLong } from '../shared/dates'
import { greetingFor } from '../shared/greeting'

const KEY = 'ps.intro.day'

export function shouldPlayIntro(route: string) {
  if (route !== 'home') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  try {
    return localStorage.getItem(KEY) !== civil()
  } catch {
    return false
  }
}

export function MorningIntro({ onDone }: { onDone: () => void }) {
  const [now] = useState(() => new Date())
  const g = greetingFor(now)
  const period = g.period === 'entardecer' ? 'tarde' : g.period
  const text = `${g.hello},`
  const root = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const finished = useRef(false)

  useEffect(() => {
    localStorage.setItem(KEY, civil(now))
    const html = document.documentElement
    html.dataset.intro = '1'
    const timers: number[] = []
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))

    const end = () => {
      if (finished.current) return
      finished.current = true
      const hero = document.querySelector<HTMLElement>('.home .h-hero')
      if (hero) hero.style.animation = 'none'
      delete html.dataset.intro
      onDone()
    }

    const fly = () => {
      const el = title.current
      const overlay = root.current
      const target = document.querySelector<HTMLElement>('.home-hello > .hello-main')
      if (!el || !overlay) return end()
      overlay.classList.add('is-leaving')
      if (!target) {
        later(420, end)
        return
      }
      const word = el.querySelector<HTMLElement>('.intro-word') ?? el
      const a = word.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      const b = target.getBoundingClientRect()
      const s = parseFloat(getComputedStyle(target).fontSize) / parseFloat(getComputedStyle(el).fontSize)
      el.style.transformOrigin = `${a.left - box.left}px ${a.top - box.top}px`
      el.animate(
        [{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${s})` }],
        { duration: 720, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
      )
      later(700, end)
    }

    const start = performance.now()
    const waitHome = () => {
      if (finished.current) return
      if (document.querySelector('.home-hello > .hello-main') || performance.now() - start > 2600) fly()
      else requestAnimationFrame(waitHome)
    }
    later(1400, waitHome)

    const skip = () => {
      if (finished.current) return
      timers.forEach(clearTimeout)
      root.current?.classList.add('is-leaving', 'is-quick')
      later(220, end)
    }
    window.addEventListener('keydown', skip, { once: true })
    window.addEventListener('pointerdown', skip, { once: true })
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
      delete html.dataset.intro
    }
  }, [])

  return (
    <div ref={root} className={`intro is-${period}`} aria-hidden="true">
      <div className="intro-center">
        <span className={`intro-orb is-${period}`} />
        <div className="intro-kicker">{fmtLong.format(now)}</div>
        <h1 ref={title} className="display intro-title">
          <span className="intro-word">
            {[...text].map((ch, i) => (
              <span key={i} className="intro-ch" style={{ ['--k' as string]: i }}>
                {ch === ' ' ? '\u00a0' : ch}
              </span>
            ))}
          </span>
          <span className="intro-nick">{g.nick}</span>
        </h1>
      </div>
    </div>
  )
}
