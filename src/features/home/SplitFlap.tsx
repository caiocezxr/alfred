import { useEffect, useRef, useState } from 'react'

const POOL = 'abcdefghijklmnopqrstuvwxyzáéíóúãõç'
const KEY = 'ps.flap.played'

type Cell = { prev: string; cur: string; tick: number }

const pick = () => POOL[Math.floor(Math.random() * POOL.length)]

function waitIntro(fn: () => void) {
  const html = document.documentElement
  if (!html.dataset.intro) {
    fn()
    return () => {}
  }
  const mo = new MutationObserver(() => {
    if (!html.dataset.intro) {
      mo.disconnect()
      fn()
    }
  })
  mo.observe(html, { attributes: true, attributeFilter: ['data-intro'] })
  return () => mo.disconnect()
}

export function SplitFlap({ text, replay = 0 }: { text: string; replay?: number }) {
  const chars = [...text]
  const [cells, setCells] = useState<Cell[]>(() => chars.map((c) => ({ prev: c, cur: c, tick: 0 })))
  const timers = useRef<number[]>([])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let played = false
    try {
      played = sessionStorage.getItem(KEY) === text && replay === 0
    } catch {}
    setCells(chars.map((c) => ({ prev: c, cur: c, tick: 0 })))
    if (reduce || played) return

    const run = () => {
      try {
        sessionStorage.setItem(KEY, text)
      } catch {}
      chars.forEach((target, i) => {
        if (target === ' ') return
        const steps = 5 + i * 2 + Math.floor(Math.random() * 3)
        const seq = [...Array.from({ length: steps }, pick), target]
        let prev = ' '
        seq.forEach((ch, k) => {
          timers.current.push(
            window.setTimeout(() => {
              const p = prev
              prev = ch
              setCells((cs) => cs.map((c, j) => (j === i ? { prev: p, cur: ch, tick: c.tick + 1 } : c)))
            }, 260 + i * 34 + k * 58),
          )
        })
      })
    }
    setCells(chars.map(() => ({ prev: ' ', cur: ' ', tick: 0 })))
    const stop = waitIntro(() => timers.current.push(window.setTimeout(run, 120)))
    return () => {
      stop()
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [text, replay])

  return (
    <span className="sf" aria-label={text}>
      {cells.map((c, i) => (
        <span key={i} className={`sf-cell ${chars[i] === ' ' ? 'is-space' : ''}`} aria-hidden="true">
          <span className="sf-ghost">{chars[i] === ' ' ? ' ' : chars[i]}</span>
          {c.tick === 0 ? (
            <>
              <span className="sf-half sf-top">{c.cur}</span>
              <span className="sf-half sf-bot">{c.cur}</span>
            </>
          ) : (
            <span key={c.tick} className="sf-flip">
              <span className="sf-half sf-top sf-in">{c.cur}</span>
              <span className="sf-half sf-bot sf-out">{c.prev}</span>
              <span className="sf-half sf-top sf-fall">{c.prev}</span>
              <span className="sf-half sf-bot sf-rise">{c.cur}</span>
            </span>
          )}
        </span>
      ))}
    </span>
  )
}
