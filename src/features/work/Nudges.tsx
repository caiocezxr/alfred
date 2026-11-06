import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './icons'
import type { AlertKind, Nudge } from './logic'
import { openItemFrom, runNudge } from './store'

const ICON: Record<AlertKind, IconName> = {
  neglect: 'eye',
  returned: 'back',
  sla: 'alarm',
  overdue: 'flag',
  due_today: 'cal',
  validation: 'user',
  waiting: 'pause',
  unchecked: 'shield',
  close: 'check',
  stale: 'clock',
  wip: 'board',
}

function NudgeRow({ n, onDone }: { n: Nudge; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <span className={`wk-nudge is-${n.tone} ${busy ? 'is-busy' : ''}`}>
      <Icon name={ICON[n.kind]} size={12} />
      <button className="wk-nudge-text" onClick={() => n.itemIds[0] && openItemFrom(n.itemIds[0], document.querySelector<HTMLElement>(`[data-card="${n.itemIds[0]}"]`))} title={n.text}>
        {n.text}
      </button>
      {n.action && (
        <button
          className="wk-nudge-act"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await runNudge(n)
            setBusy(false)
            if (n.action!.kind !== 'open' && n.action!.kind !== 'show_doing') onDone(n.id)
          }}
        >
          {n.action.label}
        </button>
      )}
    </span>
  )
}

export function NudgeLine({ list }: { list: Nudge[] }) {
  const [gone, setGone] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  const shown = list.filter((n) => !gone.includes(n.id))
  const done = (id: string) => {
    setGone((g) => [...g, id])
    setTimeout(() => setGone((g) => g.filter((x) => x !== id)), 1500)
  }
  if (!shown.length)
    return (
      <div className="wk-nudge-line is-calm">
        <Icon name="check" size={12} />
        <span>Nada pedindo cobrança, retorno ou prazo.</span>
      </div>
    )
  const [first, ...rest] = shown
  return (
    <div className={`wk-nudge-line ${open ? 'is-open' : ''}`} ref={box}>
      <NudgeRow n={first} onDone={done} />
      {rest.length > 0 && (
        <button className="wk-nudge-more" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Ver todas as sugestões">
          +{rest.length}
          <Icon name="down" size={10} />
        </button>
      )}
      {open && rest.length > 0 && (
        <div className="wk-nudge-pop" role="list">
          {rest.map((n) => (
            <div key={n.id} role="listitem">
              <NudgeRow n={n} onDone={done} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
