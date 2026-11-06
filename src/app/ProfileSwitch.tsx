import { useEffect, useRef, useState } from 'react'
import { HYBRID, setProfile, useProfile } from '../shared/profile'
import { companyCreate, getWork, loadWork, useWork } from '../features/work/store'
import { CompanyMark } from '../features/work/brand'
import './profile.css'

const NEW_COLORS = ['#1F8A5B', '#E07A2E', '#7A4FE0', '#D4373F', '#1A9BB0', '#C9A227']

export function ProfileSwitch({ compact = false }: { compact?: boolean }) {
  const profile = useProfile()
  const companies = useWork().state?.companies ?? []
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(NEW_COLORS[0])
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadWork()
  }, [])

  useEffect(() => {
    const c = companies.find((x) => x.id === profile)
    setProfile(profile, c?.color ?? null)
  }, [companies.length, profile])

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey && e.shiftKey)) return
      const list = [...(getWork().state?.companies ?? []).map((c) => c.id), HYBRID]
      const n = Number(e.key)
      if (n >= 1 && n <= list.length) {
        e.preventDefault()
        pick(list[n - 1])
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const pick = (id: string) => {
    const c = getWork().state?.companies.find((x) => x.id === id)
    const go = () => setProfile(id, c?.color ?? null)
    const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown }
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(go)
    else go()
    setOpen(false)
  }

  const create = async () => {
    const n = name.trim()
    if (!n) return
    const before = new Set((getWork().state?.companies ?? []).map((c) => c.id))
    await companyCreate(n, color)
    const made = (getWork().state?.companies ?? []).find((c) => !before.has(c.id))
    setCreating(false)
    setName('')
    if (made) pick(made.id)
  }

  const current = companies.find((c) => c.id === profile) ?? null

  return (
    <div className={`pf ${compact ? 'is-compact' : ''}`} ref={box}>
      <button className="pf-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} style={{ ['--pc' as string]: current?.color ?? 'var(--accent)' }}>
        <span className="pf-mark">{current ? <CompanyMark company={current} size={20} /> : <HybridMark companies={companies} />}</span>
        {!compact && (
          <>
            <span className="pf-text">
              <span className="pf-label">Perfil</span>
              <span className="pf-name">{current?.name ?? 'Híbrido'}</span>
            </span>
            <svg className="pf-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        )}
      </button>
      {open && (
        <div className="pf-menu" role="menu">
          {[...companies.map((c) => ({ id: c.id, label: c.name, color: c.color, company: c })), { id: HYBRID, label: 'Híbrido', color: 'var(--text-2)', company: null }].map((o, i) => (
            <button key={o.id} role="menuitemradio" aria-checked={profile === o.id} className={`pf-item ${profile === o.id ? 'is-on' : ''}`} style={{ ['--pc' as string]: o.color, ['--k' as string]: i }} onClick={() => pick(o.id)}>
              <span className="pf-mark">{o.company ? <CompanyMark company={o.company} size={20} /> : <HybridMark companies={companies} />}</span>
              <span className="pf-item-name">{o.label}</span>
              <kbd>⌘⇧{i + 1}</kbd>
            </button>
          ))}
          <div className="pf-sep" />
          {creating ? (
            <form
              className="pf-new"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <input autoFocus value={name} maxLength={40} placeholder="Nome da empresa" onChange={(e) => setName(e.target.value)} aria-label="Nome do novo perfil" />
              <span className="pf-swatches">
                {NEW_COLORS.map((c) => (
                  <button type="button" key={c} className={c === color ? 'is-on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Cor ${c}`} />
                ))}
              </span>
              <button type="submit" className="pf-create" disabled={!name.trim()}>
                Criar perfil
              </button>
            </form>
          ) : (
            <button className="pf-item is-add" onClick={() => setCreating(true)}>
              <span className="pf-mark is-plus">+</span>
              <span className="pf-item-name">Novo perfil</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function HybridMark({ companies }: { companies: { id: string; color: string }[] }) {
  return (
    <span className="pf-hybrid" aria-hidden="true">
      {companies.slice(0, 4).map((c) => (
        <i key={c.id} style={{ background: c.color }} />
      ))}
    </span>
  )
}
