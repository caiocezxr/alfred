import { useEffect, useRef, useState } from 'react'

const STEP_MS = 95

const calm = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function Flap({ ch, riffle }: { ch: string; riffle: number }) {
  const [cur, setCur] = useState(ch)
  const [prev, setPrev] = useState(ch)
  const [turn, setTurn] = useState(0)
  const curRef = useRef(ch)
  const timer = useRef(0)

  const run = (seq: string[]) => {
    window.clearTimeout(timer.current)
    if (calm() || !seq.length) {
      const last = seq[seq.length - 1] ?? curRef.current
      setPrev(last)
      setCur(last)
      curRef.current = last
      return
    }
    let i = 0
    const tick = () => {
      const next = seq[i++]
      setPrev(curRef.current)
      setCur(next)
      curRef.current = next
      setTurn((t) => t + 1)
      if (i < seq.length) timer.current = window.setTimeout(tick, STEP_MS)
    }
    tick()
  }

  useEffect(() => {
    if (ch === curRef.current) return
    const from = Number(curRef.current)
    const to = Number(ch)
    const seq: string[] = []
    if (Number.isFinite(from) && Number.isFinite(to)) for (let d = from; d !== to; ) seq.push(String((d = (d + 1) % 10)))
    else seq.push(ch)
    run(seq)
  }, [ch])

  useEffect(() => {
    if (!riffle) return
    const start = Number(curRef.current) || 0
    run(Array.from({ length: 10 }, (_, k) => String((start + k + 1) % 10)))
  }, [riffle])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <span className="sfl">
      <span className="sfl-half is-top">
        <b>{cur}</b>
      </span>
      <span className="sfl-half is-bot">
        <b>{prev}</b>
      </span>
      {turn > 0 && (
        <>
          <span key={`a${turn}`} className="sfl-half is-top is-fall">
            <b>{prev}</b>
          </span>
          <span key={`b${turn}`} className="sfl-half is-bot is-rise">
            <b>{cur}</b>
          </span>
        </>
      )}
      <i className="sfl-hinge" aria-hidden="true" />
    </span>
  )
}

export function Odometer({ value, digits = 2, label }: { value: number; digits?: number; label: string }) {
  const [riffle, setRiffle] = useState(0)
  const last = useRef(0)
  const str = String(Math.max(0, Math.min(10 ** digits - 1, value))).padStart(digits, '0')
  return (
    <span
      className="wk-odo sfb"
      aria-label={`${label}: ${value}`}
      role="img"
      onPointerEnter={() => {
        const t = Date.now()
        if (t - last.current < 2200) return
        last.current = t
        setRiffle((r) => r + 1)
      }}
    >
      {[...str].map((ch, i) => (
        <Flap key={i} ch={ch} riffle={riffle} />
      ))}
    </span>
  )
}
