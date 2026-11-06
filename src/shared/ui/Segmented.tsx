import { useLayoutEffect, useRef, useState } from 'react'

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { id: T; label: string; count?: number }[]
  onChange: (v: T) => void
  label: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLButtonElement>(`[data-id="${value}"]`)
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth })
  }, [value, options])

  return (
    <div className="seg" role="tablist" aria-label={label} ref={box}>
      {pill && <span className="seg-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
      {options.map((o) => (
        <button key={o.id} data-id={o.id} role="tab" aria-selected={value === o.id} className="seg-btn" onClick={() => onChange(o.id)}>
          {o.label}
          {!!o.count && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
