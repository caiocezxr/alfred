import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BLOCKS, WALLS, resetLayout, setLayout, setWallImage, useHomeLayout, type WallId } from './layout'

export function Customize({ onClose }: { onClose: () => void }) {
  const { layout, image } = useHomeLayout()
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const pick = (id: WallId) => {
    if (id === 'imagem' && !image) return file.current?.click()
    setLayout({ wall: id })
  }

  return createPortal(
    <div className="hcz-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="hcz" role="dialog" aria-label="Personalizar o início">
        <header className="hcz-head">
          <div>
            <div className="kicker">Início</div>
            <h3>Do seu jeito</h3>
          </div>
          <button className="hcz-x" onClick={onClose} aria-label="Fechar">
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <section className="hcz-sec">
          <h4>Papel de parede</h4>
          <div className="hcz-walls">
            {WALLS.map((w) => (
              <button
                key={w.id}
                className={`hcz-wall is-${w.id} ${layout.wall === w.id ? 'is-on' : ''}`}
                style={w.id === 'imagem' && image ? { backgroundImage: `url(${image})` } : undefined}
                onClick={() => pick(w.id)}
                aria-pressed={layout.wall === w.id}
              >
                {w.id === 'imagem' && !image && <span className="hcz-plus">+</span>}
                <span className="hcz-wall-l">{w.label}</span>
              </button>
            ))}
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void setWallImage(f)
              e.target.value = ''
            }}
          />
          {layout.wall === 'imagem' && (
            <div className="hcz-row">
              <label className="hcz-slider">
                <span>Escurecer</span>
                <input type="range" min={0} max={0.8} step={0.05} value={layout.dim} onChange={(e) => setLayout({ dim: Number(e.target.value) })} />
              </label>
              <button className="btn quiet sm" onClick={() => file.current?.click()}>
                Trocar imagem
              </button>
            </div>
          )}
        </section>

        <section className="hcz-sec">
          <h4>O que aparece</h4>
          <ul className="hcz-list">
            {BLOCKS.map((b) => (
              <li key={b.id}>
                <label className="hcz-tog">
                  <span className="hcz-tog-t">
                    <b>{b.label}</b>
                    <small>{b.hint}</small>
                  </span>
                  <input type="checkbox" checked={layout.show[b.id]} onChange={(e) => setLayout({ show: { ...layout.show, [b.id]: e.target.checked } })} />
                  <i aria-hidden="true" />
                </label>
              </li>
            ))}
          </ul>
        </section>

        <footer className="hcz-foot">
          <button className="btn quiet sm" onClick={resetLayout}>
            Voltar ao padrão
          </button>
          <button className="btn primary sm" onClick={onClose}>
            Pronto
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  )
}
