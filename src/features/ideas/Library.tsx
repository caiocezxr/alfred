import { useEffect, useRef } from 'react'
import { CloseIcon } from './icons'
import { PRINCIPLES } from './principles'
import type { PrincipleId } from './questions'
import { reducedMotion } from './util'

export function Library({ open, focus, onClose }: { open: boolean; focus: PrincipleId | null; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement as HTMLElement | null
    const el = panel.current
    requestAnimationFrame(() => {
      el?.focus({ preventScroll: true })
      if (focus) document.getElementById(`lab-p-${focus}`)?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
      else el?.querySelector('.lab-lib-list')?.scrollTo({ top: 0 })
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      returnTo.current?.focus({ preventScroll: true })
    }
  }, [open, focus, onClose])

  return (
    <div className={`lab-lib ${open ? 'is-open' : ''}`} inert={!open}>
      <div className="lab-lib-scrim" onClick={onClose} />
      <aside ref={panel} className="lab-lib-panel" role="dialog" aria-modal="true" aria-labelledby="lab-lib-title" tabIndex={-1}>
        <header className="lab-lib-head">
          <div>
            <span className="kicker">Biblioteca</span>
            <h2 id="lab-lib-title" className="display">Princípios</h2>
            <p>Curtos e práticos, para consultar no meio do caminho.</p>
          </div>
          <button className="lab-icon-btn" onClick={onClose} aria-label="Fechar princípios">
            <CloseIcon />
          </button>
        </header>
        <div className="lab-lib-list">
          {PRINCIPLES.map((p, i) => (
            <article key={p.id} id={`lab-p-${p.id}`} className={`lab-p ${focus === p.id ? 'is-focus' : ''}`} aria-labelledby={`lab-p-${p.id}-t`}>
              <span className="lab-p-n">{String(i + 1).padStart(2, '0')}</span>
              <h3 id={`lab-p-${p.id}-t`}>{p.title}</h3>
              <p className="lab-p-essence">{p.essence}</p>
              <ul>
                {p.points.map((pt) => (
                  <li key={pt}>{pt}</li>
                ))}
              </ul>
              <p className="lab-p-ask">
                <span>Pergunta-chave</span>
                {p.ask}
              </p>
            </article>
          ))}
        </div>
      </aside>
    </div>
  )
}
