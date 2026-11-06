import { useState } from 'react'
import { Icon, type IconName } from './icons'
import type { AlertKind, Nudge } from './logic'
import { openItemFrom, runNudge } from './store'

const ICON: Record<AlertKind, IconName> = {
  returned: 'back',
  overdue: 'flag',
  due_today: 'cal',
  validation: 'user',
  waiting: 'pause',
  unchecked: 'shield',
  close: 'check',
  stale: 'clock',
  wip: 'board',
}

export function Nudges({ list }: { list: Nudge[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [gone, setGone] = useState<string[]>([])
  const shown = list.filter((n) => !gone.includes(n.id))
  if (!shown.length)
    return (
      <div className="wk-nudges">
        <span className="wk-nudge is-calm">
          <Icon name="check" size={12} />
          Nada pedindo cobrança, retorno ou prazo
        </span>
      </div>
    )
  return (
    <div className="wk-nudges" role="list" aria-label="Sugestões do copiloto">
      {shown.map((n, i) => (
        <span key={n.id} role="listitem" className={`wk-nudge is-${n.tone} ${busy === n.id ? 'is-busy' : ''}`} style={{ ['--i' as string]: i }}>
          <Icon name={ICON[n.kind]} size={12} />
          <button className="wk-nudge-text" onClick={() => n.itemIds[0] && openItemFrom(n.itemIds[0], document.querySelector<HTMLElement>(`[data-card="${n.itemIds[0]}"]`))} title={n.text}>
            {n.text}
          </button>
          {n.action && (
            <button
              className="wk-nudge-act"
              disabled={busy === n.id}
              onClick={async () => {
                setBusy(n.id)
                await runNudge(n)
                setBusy(null)
                if (n.action!.kind !== 'open' && n.action!.kind !== 'show_doing') {
                  setGone((g) => [...g, n.id])
                  setTimeout(() => setGone((g) => g.filter((x) => x !== n.id)), 1500)
                }
              }}
            >
              {n.action.label}
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
