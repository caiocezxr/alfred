import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../icons'
import type { Scope } from '../logic'
import { Odometer } from '../Odometer'
import { PERSONAL_ID, type WorkState } from '../types'
import { CHECK_SHORT, checkOf, livePrs, openPr, prOpen, talkOf, useBoards, useGhSettings, useSeen, type LivePr } from '../github/api'
import { liveOf, openSession, refreshSessions, stationOf, sx, useSessions, type Session, type Turn } from './api'
import './sessions.css'

const rel = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 60) return `há ${Math.max(1, m)} min`
  const h = Math.round(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} d`
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const t = new Date()
  const y = new Date(Date.now() - 86400_000)
  if (dayKey(iso) === dayKey(t.toISOString())) return 'Hoje'
  if (dayKey(iso) === dayKey(y.toISOString())) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })
}

export function ToolMark({ tool, size = 16 }: { tool: Session['tool']; size?: number }) {
  return (
    <span className={`sx-mark is-${tool}`} style={{ ['--s' as string]: `${size}px` } as CSSProperties} title={tool === 'claude' ? 'Claude Code' : 'Codex'}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {tool === 'claude' ? <path d="M8 1.8v12.4M1.8 8h12.4M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" /> : <path d="M5.6 4.2L2 8l3.6 3.8M10.4 4.2L14 8l-3.6 3.8M9.2 3l-2.4 10" />}
      </svg>
    </span>
  )
}

function useScoped(state: WorkState, scope: Scope) {
  const gs = useGhSettings()
  const { sessions, error, loading } = useSessions()
  const logins = useMemo(() => [...new Set(Object.values(gs.stations).filter(Boolean))], [gs.stations])
  const boards = useBoards(logins)
  const live = livePrs(boards)
  const rows = (sessions ?? []).map((s) => {
    const pr = liveOf(s, live)
    return { s, pr, co: stationOf(s, state.companies, gs, pr) }
  })
  const scoped = rows.filter((r) => scope === 'all' || r.co === scope || (scope === PERSONAL_ID && !r.co))
  return { rows: scoped, error, loading }
}

export function SessionsView({ state, scope }: { state: WorkState; scope: Scope }) {
  const { rows, error, loading } = useScoped(state, scope)
  const [tool, setTool] = useState<'all' | 'claude' | 'codex'>('all')
  const [q, setQ] = useState('')
  const [more, setMore] = useState(30)
  useSeen()

  const filtered = [...rows].sort((a, b) => b.s.updated.localeCompare(a.s.updated)).filter(({ s }) => {
    if (tool !== 'all' && s.tool !== tool) return false
    if (!q.trim()) return true
    const hay = `${s.title} ${s.firstPrompt} ${s.lastPrompt} ${s.project} ${s.repo} ${s.branch}`.toLowerCase()
    return q
      .toLowerCase()
      .split(/\s+/)
      .every((w) => hay.includes(w))
  })

  const byPr = new Map<string, { pr: LivePr; list: Session[] }>()
  for (const r of filtered) {
    if (!r.pr) continue
    const k = r.pr.pr.url
    const g = byPr.get(k) ?? { pr: r.pr, list: [] }
    g.list.push(r.s)
    byPr.set(k, g)
  }
  const tracks = [...byPr.values()].sort((a, b) => b.list[0].updated.localeCompare(a.list[0].updated))

  const week = Date.now() - 7 * 86400_000
  const inWeek = rows.filter((r) => Date.parse(r.s.updated) >= week)
  const today = rows.filter((r) => dayKey(r.s.updated) === dayKey(new Date().toISOString()))
  const cost = inWeek.reduce((a, r) => a + (r.s.cost ?? 0), 0)

  const recent = filtered.slice(0, more)
  const days: { label: string; list: Session[] }[] = []
  for (const { s } of recent) {
    const label = dayLabel(s.updated)
    const last = days[days.length - 1]
    if (last && last.label === label) last.list.push(s)
    else days.push({ label, list: [s] })
  }

  return (
    <div className="sx">
      <section className="sx-board" aria-label="Resumo das sessões">
        <div className="sx-board-k">
          <span className="sx-led" aria-hidden="true" />
          Sessões de código
        </div>
        <div className="sx-kpis">
          <div>
            <Odometer value={today.length} digits={2} label="Sessões hoje" />
            <span>hoje</span>
          </div>
          <div>
            <Odometer value={inWeek.length} digits={2} label="Sessões na semana" />
            <span>na semana</span>
          </div>
          <div>
            <Odometer value={tracks.length} digits={2} label="PRs com sessão" />
            <span>em PR aberto</span>
          </div>
          <div className="sx-cost">
            <b>US$ {cost.toFixed(2)}</b>
            <span>custo · 7 dias</span>
          </div>
        </div>
      </section>

      <div className="sx-tools">
        <div className="sx-seg" role="tablist" aria-label="Ferramenta">
          {(['all', 'claude', 'codex'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tool === t} className={tool === t ? 'is-on' : ''} onClick={() => setTool(t)}>
              {t !== 'all' && <ToolMark tool={t} size={12} />}
              {t === 'all' ? 'Todas' : t === 'claude' ? 'Claude' : 'Codex'}
            </button>
          ))}
        </div>
        <label className="sx-search">
          <Icon name="search" size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por assunto, projeto, branch…" />
        </label>
        <button className="sx-refresh" onClick={() => void refreshSessions()} title="Atualizar" aria-label="Atualizar">
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {error && <p className="sx-empty">{error}</p>}
      {loading && (
        <div className="sx-skel" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}

      {tracks.length > 0 && (
        <section className="sx-sec">
          <h3>
            Em PR aberto <em>{tracks.length}</em>
          </h3>
          <ul className="sx-tracks">
            {tracks.map((t, i) => (
              <Track key={t.pr.pr.url} pr={t.pr} list={t.list} i={i} />
            ))}
          </ul>
        </section>
      )}

      {!loading && !error && days.length === 0 && <p className="sx-empty">{q ? 'Nada com essa busca.' : 'Nenhuma sessão do Claude Code ou do Codex por aqui ainda.'}</p>}

      {days.length > 0 && (
        <section className="sx-sec">
          <h3>Recentes</h3>
          <div className="sx-days">
            {days.map((d) => (
              <Fragment key={d.label}>
                <div className="sx-day">{d.label}</div>
                <ul className="sx-list">
                  {d.list.map((s, i) => (
                    <Row key={`${s.tool}-${s.id}`} s={s} i={i} pr={rows.find((r) => r.s === s)?.pr ?? null} />
                  ))}
                </ul>
              </Fragment>
            ))}
          </div>
          {filtered.length > more && (
            <button className="sx-more" onClick={() => setMore((m) => m + 40)}>
              Ver mais ({filtered.length - more})
            </button>
          )}
        </section>
      )}
    </div>
  )
}

function Track({ pr, list, i }: { pr: LivePr; list: Session[]; i: number }) {
  const check = checkOf(pr.pr)
  const talk = talkOf(pr.pr, pr.login)
  return (
    <li className={`sx-track is-${(check ?? 'none').toLowerCase()} ${talk.length ? 'has-talk' : ''}`} style={{ ['--k' as string]: i } as CSSProperties}>
      <button className="sx-track-head" onClick={() => openPr(prOpen(pr))} title="Ver o PR">
        <span className="sx-track-top">
          <span className="sx-repo">{pr.pr.repository.nameWithOwner.split('/')[1]}</span>
          <span className="sx-num">#{pr.pr.number}</span>
          <span className={`sx-check is-${(check ?? 'none').toLowerCase()}`}>
            <i aria-hidden="true" />
            {check ? CHECK_SHORT[check] : 'sem checks'}
          </span>
          {talk.length > 0 && (
            <span className="sx-talk">
              <Icon name="chat" size={10} />
              {talk.length}
            </span>
          )}
        </span>
        <span className="sx-track-title">{pr.pr.title}</span>
        <code className="sx-branch">{pr.pr.headRefName}</code>
      </button>
      <ol className="sx-rail">
        {list.slice(0, 4).map((s) => (
          <li key={s.id}>
            <button onClick={() => openSession(s)}>
              <ToolMark tool={s.tool} size={13} />
              <span className="sx-rail-t">{s.title}</span>
              <span className="sx-when">{rel(s.updated)}</span>
            </button>
          </li>
        ))}
        {list.length > 4 && <li className="sx-rail-more">+{list.length - 4} sessões</li>}
      </ol>
    </li>
  )
}

function Row({ s, i, pr }: { s: Session; i: number; pr: LivePr | null }) {
  const [busy, setBusy] = useState(false)
  const resume = async () => {
    if (!s.cwd) return
    setBusy(true)
    try {
      await sx.resume(s.tool, s.id, s.cwd)
    } finally {
      window.setTimeout(() => setBusy(false), 800)
    }
  }
  return (
    <li className="sx-row" style={{ ['--k' as string]: i } as CSSProperties}>
      <button className="sx-row-main" onClick={() => openSession(s)}>
        <ToolMark tool={s.tool} />
        <span className="sx-row-body">
          <span className="sx-row-title">{s.title}</span>
          <span className="sx-row-meta">
            {s.project && <span>{s.project}</span>}
            {s.branch && <code>{s.branch}</code>}
            <span>
              {s.prompts} {s.prompts === 1 ? 'pedido' : 'pedidos'}
            </span>
          </span>
        </span>
        <span className="sx-time">{hhmm(s.updated)}</span>
      </button>
      {pr && (
        <button className="sx-prchip" onClick={() => openPr(prOpen(pr))} title={pr.pr.title}>
          PR #{pr.pr.number}
        </button>
      )}
      {s.cwd && (
        <button className="sx-resume" onClick={() => void resume()} disabled={busy} title="Abrir no Terminal e continuar de onde parou">
          <Icon name="play" size={10} />
          {busy ? 'Abrindo…' : 'Retomar'}
        </button>
      )}
    </li>
  )
}

export function Text({ text }: { text: string }) {
  const parts = text.split(/```/)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <pre key={i} className="sx-code">
            {p.replace(/^[a-zA-Z0-9_+-]*\n/, '')}
          </pre>
        ) : (
          <p key={i}>{inline(p.trim())}</p>
        ),
      )}
    </>
  )
}

function inline(t: string): ReactNode[] {
  return t.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).map((x, i) =>
    x.startsWith('`') && x.endsWith('`') && x.length > 2 ? (
      <code key={i}>{x.slice(1, -1)}</code>
    ) : x.startsWith('**') && x.endsWith('**') && x.length > 4 ? (
      <b key={i}>{x.slice(2, -2)}</b>
    ) : (
      x
    ),
  )
}

function Tools({ list }: { list: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`sx-tools-row ${open ? 'is-open' : ''}`}>
      <button onClick={() => setOpen((o) => !o)}>
        <Icon name="gear" size={11} />
        {list.length} {list.length === 1 ? 'ação' : 'ações'}
        <Icon name="chevron" size={10} />
      </button>
      <div className="sx-tools-body">
        <ul>
          {list.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function SessionSheet({ s, onClose }: { s: Session; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [show, setShow] = useState(80)
  const [leaving, setLeaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const gs = useGhSettings()
  const logins = useMemo(() => [...new Set(Object.values(gs.stations).filter(Boolean))], [gs.stations])
  const pr = liveOf(s, livePrs(useBoards(logins)))

  const close = () => {
    setLeaving(true)
    window.setTimeout(onClose, 220)
  }

  useEffect(() => {
    sx.read(s.tool, s.id)
      .then(setTurns)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [s.tool, s.id])

  useEffect(() => {
    if (turns && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [turns])

  const cmd = `cd ${JSON.stringify(s.cwd ?? '~')} && ${s.tool === 'claude' ? 'claude --resume' : 'codex resume'} ${s.id}`
  const resume = async () => {
    if (!s.cwd) return
    setNote(null)
    try {
      await sx.resume(s.tool, s.id, s.cwd)
      setNote('Aberto no Terminal')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }
  const copy = async () => {
    await navigator.clipboard.writeText(cmd)
    setNote('Comando copiado')
  }

  const visible = turns ? turns.slice(Math.max(0, turns.length - show)) : []
  const hidden = turns ? Math.max(0, turns.length - show) : 0

  return createPortal(
    <div className={`sx-scrim ${leaving ? 'is-leaving' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <aside className={`sx-sheet is-${s.tool}`} role="dialog" aria-label={s.title ?? 'Sessão'}>
        <header className="sx-sheet-head">
          <div className="sx-sheet-top">
            <ToolMark tool={s.tool} size={18} />
            <span className="sx-sheet-k">{s.tool === 'claude' ? 'Claude Code' : 'Codex'}</span>
            {s.project && <span className="sx-sheet-proj">{s.project}</span>}
            <span className="sx-grow" />
            <button className="sx-x" onClick={close} aria-label="Fechar">
              <Icon name="x" size={13} />
            </button>
          </div>
          <h2 className="display">{s.title}</h2>
          <div className="sx-sheet-meta">
            {s.branch && <code>{s.branch}</code>}
            {s.started && <span>começou {rel(s.started)}</span>}
            <span>última atividade {rel(s.updated)}</span>
            <span>
              {s.prompts} {s.prompts === 1 ? 'pedido' : 'pedidos'}
            </span>
            {s.cost != null && s.cost > 0 && <span>US$ {s.cost.toFixed(2)}</span>}
            {!!(s.linesAdded || s.linesRemoved) && (
              <span className="sx-diffn">
                <i>+{s.linesAdded ?? 0}</i> <s>−{s.linesRemoved ?? 0}</s>
              </span>
            )}
          </div>
          {(pr || s.prs.length > 0) && (
            <div className="sx-sheet-prs">
              {pr ? (
                <button className={`sx-prbig is-${(checkOf(pr.pr) ?? 'none').toLowerCase()}`} onClick={() => openPr(prOpen(pr))}>
                  <i aria-hidden="true" />
                  <b>PR #{pr.pr.number}</b>
                  <span>{pr.pr.title}</span>
                  <Icon name="arrow" size={11} />
                </button>
              ) : null}
              {s.prs
                .filter((p) => !pr || p.url !== pr.pr.url)
                .slice(0, 4)
                .map((p) => (
                  <span key={p.url} className="sx-prold" title={p.url}>
                    {p.repo.split('/')[1]} #{p.number}
                  </span>
                ))}
            </div>
          )}
        </header>

        <div className="sx-chat" ref={body}>
          {err && <p className="sx-empty">{err}</p>}
          {!turns && !err && (
            <div className="sx-skel" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          )}
          {hidden > 0 && (
            <button className="sx-more" onClick={() => setShow((n) => n + 120)}>
              Carregar anteriores ({hidden})
            </button>
          )}
          {visible.map((t, i) =>
            t.role === 'tools' ? (
              <Tools key={i} list={t.tools} />
            ) : (
              <div key={i} className={`sx-msg is-${t.role}`} style={{ ['--k' as string]: Math.max(0, i - visible.length + 12) } as CSSProperties}>
                {t.role === 'user' && t.at && <span className="sx-msg-at">{hhmm(t.at)}</span>}
                <div className="sx-bubble">
                  <Text text={t.text} />
                </div>
              </div>
            ),
          )}
        </div>

        <footer className="sx-foot">
          <code className="sx-cmd" title={cmd}>
            {s.tool === 'claude' ? 'claude --resume' : 'codex resume'} {s.id.slice(0, 8)}…
          </code>
          <button className="sx-ghost" onClick={() => void copy()}>
            <Icon name="copy" size={12} />
            Copiar
          </button>
          <span className="sx-grow" />
          {note && <span className="sx-note">{note}</span>}
          {s.cwd && (
            <button className="sx-go" onClick={() => void resume()}>
              <Icon name="play" size={11} />
              Retomar no Terminal
            </button>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  )
}

export function SessionHost() {
  const [s, setS] = useState<Session | null>(null)
  useEffect(() => {
    const on = (e: Event) => setS((e as CustomEvent<Session>).detail)
    window.addEventListener('sx:open', on)
    return () => window.removeEventListener('sx:open', on)
  }, [])
  if (!s) return null
  return <SessionSheet key={`${s.tool}-${s.id}`} s={s} onClose={() => setS(null)} />
}
