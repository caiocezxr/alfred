import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../shared/db/api'
import { STYLES, THEMES, THEME_ORDER, setStyle, setTheme } from '../shared/themes/themes'
import { ROUTES, navigate, requestIntent } from './router'

type Cmd = { id: string; label: string; hint?: string; group: string; run: () => void }

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export function CommandPalette({ onClose, onToast }: { onClose: () => void; onToast: (s: string) => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  const cmds = useMemo<Cmd[]>(
    () => [
      { id: 'new-task', label: 'Novo to-do', hint: '⌘N na Workstation', group: 'Ações', run: () => { navigate('work'); setTimeout(() => requestIntent('new-task'), 60) } },
      { id: 'new-habit', label: 'Novo hábito', hint: '⌘N em Hábitos', group: 'Ações', run: () => { navigate('habits'); setTimeout(() => requestIntent('new-habit'), 60) } },
      { id: 'new-idea', label: 'Nova ideia', hint: '⌘N no Laboratório', group: 'Ações', run: () => { navigate('ideas'); setTimeout(() => requestIntent('new-idea'), 120) } },
      { id: 'new-note', label: 'Nova nota', hint: '⌘N em Notas', group: 'Ações', run: () => { navigate('notes'); setTimeout(() => requestIntent('new-note'), 160) } },
      { id: 'refresh-radar', label: 'Atualizar o Radar', group: 'Ações', run: () => { navigate('radar'); setTimeout(() => requestIntent('refresh-radar'), 160) } },
      { id: 'open-bible', label: 'Abrir a Bíblia', group: 'Ações', run: () => navigate('bible') },
      {
        id: 'backup',
        label: 'Fazer backup agora',
        group: 'Ações',
        run: async () => {
          try {
            const p = await api.backupNow()
            onToast(`Backup salvo em ${p}`)
          } catch (e) {
            onToast(`Não foi possível fazer o backup: ${e}`)
          }
        },
      },
      ...ROUTES.filter((r) => r.ready).map((r) => ({ id: `go-${r.id}`, label: `Ir para ${r.label}`, hint: `⌘${r.key}`, group: 'Navegar', run: () => navigate(r.id) })),
      ...THEME_ORDER.map((t) => ({ id: `theme-${t}`, label: `Modo ${THEMES[t].name.toLowerCase()}`, hint: THEMES[t].tagline, group: 'Aparência', run: () => setTheme(t) })),
      ...STYLES.map((x) => ({ id: `style-${x.id}`, label: `Estilo: ${x.name}`, hint: x.tagline, group: 'Aparência', run: () => setStyle(x.id) })),
    ],
    [onToast],
  )

  const filtered = useMemo(() => {
    const nq = norm(q.trim())
    if (!nq) return cmds
    return cmds.filter((c) => norm(`${c.label} ${c.hint ?? ''} ${c.group}`).includes(nq))
  }, [cmds, q])

  useEffect(() => setI(0), [q])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [i])

  const run = (c: Cmd | undefined) => {
    if (!c) return
    onClose()
    c.run()
  }

  let lastGroup = ''
  return (
    <div className="palette-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Comandos">
        <input
          autoFocus
          className="palette-input"
          placeholder="O que você quer fazer?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setI((v) => Math.min(filtered.length - 1, v + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setI((v) => Math.max(0, v - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(filtered[i])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
        />
        <ul className="palette-list" id="palette-list" role="listbox" ref={list}>
          {filtered.length === 0 && <li className="palette-empty">Nenhum comando para “{q}”.</li>}
          {filtered.map((c, idx) => {
            const head = c.group !== lastGroup
            lastGroup = c.group
            return (
              <li key={c.id} role="presentation">
                {head && <div className="palette-group">{c.group}</div>}
                <button
                  role="option"
                  aria-selected={idx === i}
                  className="palette-item"
                  onMouseMove={() => setI(idx)}
                  onClick={() => run(c)}
                >
                  <span>{c.label}</span>
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
