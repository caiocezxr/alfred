import { useEffect, useRef, useState } from 'react'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

export function Odometer({ value, digits = 2, label }: { value: number; digits?: number; label: string }) {
  const prev = useRef(value)
  const [rolling, setRolling] = useState(false)
  useEffect(() => {
    if (prev.current === value) return
    prev.current = value
    setRolling(true)
    const id = setTimeout(() => setRolling(false), 720)
    return () => clearTimeout(id)
  }, [value])
  const str = String(Math.max(0, Math.min(10 ** digits - 1, value))).padStart(digits, '0')
  return (
    <span className={`wk-odo ${rolling ? 'is-rolling' : ''}`} aria-label={`${label}: ${value}`} role="img">
      {[...str].map((ch, i) => (
        <span key={i} className="wk-odo-drum" aria-hidden="true">
          <span className="wk-odo-strip" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
            {DIGITS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}
