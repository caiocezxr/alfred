import { useEffect, useRef, useState } from 'react'
import { HYBRID, getProfile, setProfile, useProfile } from '../shared/profile'
import { companyCreate, getWork, loadWork, useWork } from '../features/work/store'
import { CompanyMark } from '../features/work/brand'
import { useNeglect } from '../features/work/today'
import { isUnlocked, lockAll, markUnlocked, setPassword, verifyPassword, warmLocks } from '../shared/lock'
import './profile.css'

export const LOCK_EVENT = 'ps:lock'

const NEW_COLORS = ['#1F8A5B', '#E07A2E', '#7A4FE0', '#D4373F', '#1A9BB0', '#C9A227']

export function ProfileSwitch({ compact = false }: { compact?: boolean }) {
  const profile = useProfile()
  const companies = useWork().state?.companies ?? []
  const neglect = useNeglect()
  const anyAttention = companies.some((c) => neglect.byCompany[c.id]?.attention)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(NEW_COLORS[0])
  const [newPw, setNewPw] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [bad, setBad] = useState(0)
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadWork()
    warmLocks()
  }, [])

  useEffect(() => {
    if (open) return
    setAsking(null)
    setChanging(false)
    setCreating(false)
    setPw('')
    setBad(0)
    setCur('')
    setNext('')
    setAgain('')
    setMsg(null)
  }, [open])

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
      if (e.key !== 'Escape') return
      if (askingRef.current || changingRef.current) {
        setAsking(null)
        setChanging(false)
        return
      }
      setOpen(false)
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

  const askingRef = useRef(asking)
  askingRef.current = asking
  const changingRef = useRef(changing)
  changingRef.current = changing

  const pick = (id: string) => {
    if (id !== getProfile() && !isUnlocked(id)) {
      setOpen(true)
      setChanging(false)
      setCreating(false)
      setPw('')
      setBad(0)
      setAsking(id)
      return
    }
    swap(id)
  }

  const swap = (id: string) => {
    const c = getWork().state?.companies.find((x) => x.id === id)
    const go = () => setProfile(id, c?.color ?? null)
    const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown }
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(go)
    else go()
    setOpen(false)
  }

  const unlock = async () => {
    if (!asking || !pw || busy) return
    setBusy(true)
    const ok = await verifyPassword(asking, pw)
    setBusy(false)
    if (ok) swap(asking)
    else {
      setPw('')
      setBad((n) => n + 1)
    }
  }

  const change = async () => {
    if (busy) return
    if (next.length < 4) return setMsg('A nova senha precisa de 4 caracteres ou mais.')
    if (next !== again) return setMsg('As duas senhas novas não batem.')
    setBusy(true)
    const ok = await verifyPassword(profile, cur)
    if (!ok) {
      setBusy(false)
      setCur('')
      return setMsg('A senha atual está errada.')
    }
    await setPassword(profile, next)
    setBusy(false)
    setChanging(false)
    setCur('')
    setNext('')
    setAgain('')
    setMsg('Senha trocada.')
  }

  const lockNow = () => {
    lockAll()
    setOpen(false)
    window.dispatchEvent(new Event(LOCK_EVENT))
  }

  const create = async () => {
    const n = name.trim()
    if (!n || newPw.length < 4) return
    const before = new Set((getWork().state?.companies ?? []).map((c) => c.id))
    await companyCreate(n, color)
    const made = (getWork().state?.companies ?? []).find((c) => !before.has(c.id))
    setCreating(false)
    setName('')
    if (made) {
      await setPassword(made.id, newPw)
      markUnlocked(made.id)
      swap(made.id)
    }
    setNewPw('')
  }

  const current = companies.find((c) => c.id === profile) ?? null

  return (
    <div className={`pf ${compact ? 'is-compact' : ''}`} ref={box}>
      <button className="pf-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} style={{ ['--pc' as string]: current?.color ?? 'var(--accent)' }}>
        <span className="pf-mark">
          {current ? <CompanyMark company={current} size={20} /> : <HybridMark companies={companies} />}
          {anyAttention && <i className="pf-alert" title="Tem empresa pedindo atenção" />}
        </span>
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
      {open && asking && (
        <form
          className={`pf-menu pf-lock ${bad ? 'is-bad' : ''}`}
          style={{ ['--pc' as string]: companies.find((c) => c.id === asking)?.color ?? 'var(--accent)' }}
          onSubmit={(e) => {
            e.preventDefault()
            void unlock()
          }}
        >
          <span className="pf-lock-head">
            <span className="pf-mark">{companies.find((c) => c.id === asking) ? <CompanyMark company={companies.find((c) => c.id === asking)!} size={20} /> : <HybridMark companies={companies} />}</span>
            <span className="pf-lock-title">
              <small>Entrar em</small>
              {companies.find((c) => c.id === asking)?.name ?? 'Híbrido'}
            </span>
          </span>
          <span key={bad} className="pf-lock-field">
            <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Senha do perfil" aria-label="Senha do perfil" autoComplete="current-password" />
            <button type="submit" disabled={!pw || busy} aria-label="Entrar">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
              </svg>
            </button>
          </span>
          <span className="pf-lock-msg">{bad ? 'Senha incorreta.' : busy ? 'Conferindo…' : 'Esc volta'}</span>
        </form>
      )}
      {open && !asking && changing && (
        <form
          className="pf-menu pf-lock"
          onSubmit={(e) => {
            e.preventDefault()
            void change()
          }}
        >
          <span className="pf-lock-title is-plain">
            <small>Trocar senha de</small>
            {current?.name ?? 'Híbrido'}
          </span>
          <input autoFocus className="pf-lock-input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Senha atual" aria-label="Senha atual" autoComplete="current-password" />
          <input className="pf-lock-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Nova senha" aria-label="Nova senha" autoComplete="new-password" />
          <input className="pf-lock-input" type="password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="Repita a nova senha" aria-label="Repita a nova senha" autoComplete="new-password" />
          {msg && <span className="pf-lock-msg is-note">{msg}</span>}
          <button type="submit" className="pf-create" disabled={!cur || !next || !again || busy}>
            Salvar senha
          </button>
        </form>
      )}
      {open && !asking && !changing && (
        <div className="pf-menu" role="menu">
          {[...companies.map((c) => ({ id: c.id, label: c.name, color: c.color, company: c })), { id: HYBRID, label: 'Híbrido', color: 'var(--text-2)', company: null }].map((o, i) => (
            <button key={o.id} role="menuitemradio" aria-checked={profile === o.id} className={`pf-item ${profile === o.id ? 'is-on' : ''}`} style={{ ['--pc' as string]: o.color, ['--k' as string]: i }} onClick={() => pick(o.id)}>
              <span className="pf-mark">{o.company ? <CompanyMark company={o.company} size={20} /> : <HybridMark companies={companies} />}</span>
              <span className="pf-item-name">
                {o.label}
                {o.company && neglect.byCompany[o.id]?.attention && <em className="pf-item-alert">{neglect.byCompany[o.id]?.label}</em>}
              </span>
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
              <input type="password" value={newPw} placeholder="Senha (mín. 4)" onChange={(e) => setNewPw(e.target.value)} aria-label="Senha do novo perfil" autoComplete="new-password" />
              <span className="pf-swatches">
                {NEW_COLORS.map((c) => (
                  <button type="button" key={c} className={c === color ? 'is-on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Cor ${c}`} />
                ))}
              </span>
              <button type="submit" className="pf-create" disabled={!name.trim() || newPw.length < 4}>
                Criar perfil
              </button>
            </form>
          ) : (
            <>
              <button className="pf-item is-add" onClick={() => setCreating(true)}>
                <span className="pf-mark is-plus">+</span>
                <span className="pf-item-name">Novo perfil</span>
              </button>
              <div className="pf-tools">
                <button
                  className="pf-tool"
                  onClick={() => {
                    setMsg(null)
                    setChanging(true)
                  }}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                    <circle cx="5.5" cy="10.5" r="2.6" />
                    <path d="M7.4 8.6 13 3M11 5l1.6 1.6M9.6 6.4l1.2 1.2" />
                  </svg>
                  Trocar senha
                </button>
                <button className="pf-tool" onClick={lockNow}>
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                    <rect x="3" y="7" width="10" height="7" rx="1.6" />
                    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                  </svg>
                  Bloquear
                </button>
              </div>
              {msg && <span className="pf-lock-msg is-note is-inline">{msg}</span>}
            </>
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
