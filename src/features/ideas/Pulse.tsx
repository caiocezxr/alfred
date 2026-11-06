import { focusFor, PULSE, pulseKey, type NextStep, type PulseKey } from './flow'
import type { OpenIdea } from './Ideas'
import type { Idea } from './types'

export function Pulse({ ideas, steps, selectedId, onOpen }: {
  ideas: Idea[]
  steps: Map<string, NextStep>
  selectedId: string
  onOpen: OpenIdea
}) {
  const buckets = new Map<PulseKey, Idea[]>()
  for (const i of ideas) {
    const k = pulseKey(steps.get(i.id)!)
    if (k) buckets.set(k, [...(buckets.get(k) ?? []), i])
  }
  const items = PULSE.filter((p) => buckets.get(p.key)?.length)

  if (!items.length) {
    const active = ideas.filter((i) => i.status !== 'archived').length
    return (
      <p className="lab-sub">
        {active
          ? `Nada pendente · ${active} ${active === 1 ? 'ideia ativa' : 'ideias ativas'}, nenhuma esperando você`
          : 'Tudo arquivado. Capture a próxima ideia quando ela aparecer.'}
      </p>
    )
  }

  return (
    <nav className="lab-pulse" aria-label="O que precisa de atenção">
      {items.map((p) => {
        const list = buckets.get(p.key)!
        const n = list.length
        const at = list.findIndex((i) => i.id === selectedId)
        const target = list[(at + 1) % n]
        const names = list.map((i) => `“${i.title}”`).join(', ')
        return (
          <button
            key={p.key}
            className={`lab-pulse-item is-${p.tone}`}
            title={names}
            onClick={() => {
              const s = steps.get(target.id)!
              onOpen(target.id, s.stage, focusFor(s))
            }}
          >
            <b>{n}</b>
            {n === 1 ? p.one : p.many}
          </button>
        )
      })}
    </nav>
  )
}
