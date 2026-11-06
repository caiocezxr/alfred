import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { isTauri } from '../../shared/db/api'
import { Icon } from '../work/icons'
import { getGh, gh, useGhSettings, type LocalRepo } from '../work/github/api'
import { initScope, loadWork, useWork } from '../work/store'
import { ToolMark, Text } from '../work/sessions/Sessions'
import { sx } from '../work/sessions/api'
import { PERSONAL_ID, type Company } from '../work/types'
import {
  AGENT_NAME,
  AGENTS,
  answer,
  cancel,
  closeAgent,
  createMesa,
  listenOficina,
  liveOf,
  loadMesas,
  patchMesa,
  removeMesa,
  seed,
  send,
  setOption,
  useOficina,
  type AgentId,
  type ConfigOption,
  type Item,
  type Live,
  type Mesa,
} from './store'
import './oficina.css'

const rel = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} d`
}

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

const MODE_PT: Record<string, string> = {
  default: 'Pede antes',
  manual: 'Pede antes',
  acceptEdits: 'Edita sozinho',
  plan: 'Só planeja',
  auto: 'Automático',
  'read-only': 'Só lê',
  'full-access': 'Acesso total',
}
const HIDDEN_VALUES = new Set(['bypassPermissions'])

const STATUS_PT: Record<Live['status'], string> = {
  off: 'desligado',
  opening: 'abrindo',
  idle: 'pronto',
  thinking: 'pensando',
  writing: 'escrevendo',
  tool: 'trabalhando',
  waiting: 'esperando você',
  error: 'com erro',
}

let repoCache: LocalRepo[] | null = null
let repoLoading: Promise<LocalRepo[]> | null = null

function useRepos() {
  const gs = useGhSettings()
  const [repos, setRepos] = useState<LocalRepo[] | null>(repoCache)
  useEffect(() => {
    if (repoCache || !isTauri) return
    repoLoading ??= gh.scan(gs.base || '~/Projetos').catch(() => [])
    void repoLoading.then((r) => {
      repoCache = r
      setRepos(r)
    })
  }, [gs.base])
  return repos ?? []
}

function companyOfRepo(r: LocalRepo, companies: Company[]): string | null {
  const gs = getGh()
  if (gs.repos[r.path]) return gs.repos[r.path]
  const owner = r.repo?.split('/')[0]?.toLowerCase() ?? ''
  const own = Object.entries(gs.stations).find(([co, login]) => co !== PERSONAL_ID && login?.toLowerCase() === owner)
  if (own) return own[0]
  const hay = `${owner} ${r.path.toLowerCase()}`
  const hit = companies.find((c) => c.id !== PERSONAL_ID && c.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 4 && hay.includes(w)))
  return hit?.id ?? null
}

function inScope(companyId: string | null, scope: string) {
  if (scope === 'all') return true
  if (scope === PERSONAL_ID) return !companyId || companyId === PERSONAL_ID
  return companyId === scope
}

function codexHomeFor(companyId: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem('oficina.codexHome') ?? '{}') as Record<string, string>
    return map[companyId] ?? null
  } catch {
    return null
  }
}

export default function Oficina() {
  const { state, scope } = useWork()
  const { mesas, loaded } = useOficina()
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem('oficina.current'))
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    initScope()
    void loadWork()
    void loadMesas()
    void listenOficina()
  }, [])

  const companies = state?.companies ?? []
  const visible = mesas.filter((m) => inScope(m.companyId, scope))
  const mesa = visible.find((m) => m.id === current) ?? null

  useEffect(() => {
    if (current) localStorage.setItem('oficina.current', current)
  }, [current])

  useEffect(() => {
    if (!mesa) return
    const m = liveOf(mesa.id)
    if (m.items.length) return
    const tasks = AGENTS.filter((a) => mesa.sessions[a]).map(async (a) => {
      const turns = await sx.read(a, mesa.sessions[a]!).catch(() => [])
      return turns.map((t, i): Item => {
        const at = t.at ? Date.parse(t.at) : i
        if (t.role === 'user') return { id: `h-${a}-${i}`, agent: a, role: 'user', text: t.text, at }
        if (t.role === 'tools') return { id: `h-${a}-${i}`, agent: a, role: 'tool', title: t.tools.join(' · '), kind: 'other', status: 'completed', files: [], at }
        return { id: `h-${a}-${i}`, agent: a, role: 'agent', text: t.text, at, open: false }
      })
    })
    void Promise.all(tasks).then((lists) => seed(mesa.id, lists.flat().sort((x, y) => x.at - y.at)))
  }, [mesa?.id])

  if (!loaded) return <div className="of" />

  return (
    <div className="of">
      <aside className="of-side">
        <header className="of-side-head">
          <div>
            <div className="of-k">Oficina</div>
            <h1 className="display">Mesas</h1>
          </div>
          <button className="of-new" onClick={() => setPicking(true)} title="Nova mesa (⌘N)">
            <Icon name="plus" size={14} />
          </button>
        </header>
        <ul className="of-list">
          {visible.length === 0 && <li className="of-empty-list">Nenhuma mesa ainda.</li>}
          {visible.map((m, i) => {
            const l = liveOf(m.id)
            const co = companies.find((c) => c.id === m.companyId)
            return (
              <li key={m.id} style={{ ['--k' as string]: i } as CSSProperties}>
                <button className={`of-mesa ${m.id === mesa?.id ? 'is-on' : ''}`} onClick={() => setCurrent(m.id)}>
                  <span className="of-mesa-t">{m.title || 'Mesa sem título'}</span>
                  <span className="of-mesa-m">
                    {scope === 'all' && co && <em style={{ ['--co' as string]: co.color } as CSSProperties}>{co.name}</em>}
                    <span>{base(m.cwd)}</span>
                    <span className="of-dots">
                      {AGENTS.filter((a) => m.sessions[a] || l.agents[a].status !== 'off').map((a) => (
                        <i key={a} className={`is-${a} is-${l.agents[a].status}`} title={`${AGENT_NAME[a]}: ${STATUS_PT[l.agents[a].status]}`} />
                      ))}
                    </span>
                    <time>{rel(m.updatedAt)}</time>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      {mesa ? (
        <Table key={mesa.id} mesa={mesa} onDelete={() => void removeMesa(mesa.id).then(() => setCurrent(null))} />
      ) : (
        <Welcome onNew={() => setPicking(true)} />
      )}

      {picking && (
        <RepoPicker
          scope={scope}
          companies={companies}
          onClose={() => setPicking(false)}
          onPick={(cwd, companyId) => {
            const m = createMesa(companyId, cwd, 'claude')
            setCurrent(m.id)
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}

function Welcome({ onNew }: { onNew: () => void }) {
  return (
    <section className="of-welcome">
      <div className="of-welcome-card">
        <div className="of-k">Oficina</div>
        <h2 className="display">Uma mesa por tarefa.</h2>
        <p>Escolha o repositório, chame o Claude ou o Codex na mesma conversa e acompanhe cada um trabalhando. Tudo pela sua assinatura.</p>
        <button className="of-go" onClick={onNew}>
          <Icon name="plus" size={13} /> Nova mesa
        </button>
      </div>
    </section>
  )
}

function RepoPicker({ scope, companies, onClose, onPick }: { scope: string; companies: Company[]; onClose: () => void; onPick: (cwd: string, companyId: string) => void }) {
  const repos = useRepos()
  const [q, setQ] = useState('')
  const list = repos
    .map((r) => ({ r, co: companyOfRepo(r, companies) }))
    .filter(({ co }) => inScope(co, scope))
    .filter(({ r }) => !q || `${r.name} ${r.repo ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="of-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="of-picker" role="dialog" aria-label="Escolher repositório">
        <div className="of-k">Nova mesa</div>
        <h3 className="display">Em qual repositório?</h3>
        <label className="of-search">
          <Icon name="search" size={13} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar repositório…" />
        </label>
        <ul className="of-repos">
          {!repoCache && <li className="of-muted">Procurando repositórios…</li>}
          {repoCache && list.length === 0 && <li className="of-muted">Nenhum repositório desta estação. Ligue repositórios a ela em GitHub › Estações.</li>}
          {list.map(({ r, co }, i) => {
            const c = companies.find((x) => x.id === co)
            return (
              <li key={r.path} style={{ ['--k' as string]: i } as CSSProperties}>
                <button onClick={() => onPick(r.path, co ?? (scope === 'all' ? PERSONAL_ID : scope))}>
                  <b>{r.name}</b>
                  <span>{r.repo ?? r.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                  {r.branch && <code>{r.branch}</code>}
                  {c && <em style={{ ['--co' as string]: c.color } as CSSProperties}>{c.name}</em>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function Table({ mesa, onDelete }: { mesa: Mesa; onDelete: () => void }) {
  useOficina()
  const l = liveOf(mesa.id)
  const [agent, setAgent] = useState<AgentId>(mesa.agent)
  const [text, setText] = useState('')
  const [show, setShow] = useState(150)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const box = useRef<HTMLTextAreaElement>(null)
  const codexHome = codexHomeFor(mesa.companyId)
  const items = l.items.slice(-show)

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [l.items])

  useEffect(() => {
    box.current?.focus()
  }, [mesa.id])

  const go = () => {
    const t = text.trim()
    if (!t) return
    setText('')
    stick.current = true
    if (agent !== mesa.agent) patchMesa(mesa.id, { agent })
    void send(mesa, agent, t, codexHome)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      go()
    }
    if (e.key === 'Escape' && (l.agents[agent].status === 'thinking' || l.agents[agent].status === 'writing' || l.agents[agent].status === 'tool')) void cancel(mesa.id, agent)
  }

  const used = AGENTS.filter((a) => mesa.sessions[a] || l.agents[a].status !== 'off' || a === agent)

  return (
    <>
      <section className="of-main">
        <header className="of-head">
          <input className="of-title display" value={mesa.title} placeholder="Mesa sem título" onChange={(e) => patchMesa(mesa.id, { title: e.target.value })} />
          <span className="of-repo" title={mesa.cwd}>
            <Icon name="board" size={12} /> {base(mesa.cwd)}
          </span>
          <button className="of-icon" onClick={onDelete} title="Apagar a mesa (as sessões continuam no histórico)">
            <Icon name="trash" size={13} />
          </button>
        </header>

        <div
          className="of-chat"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
        >
          {l.items.length > show && (
            <button className="of-more" onClick={() => setShow((n) => n + 150)}>
              Ver anteriores ({l.items.length - show})
            </button>
          )}
          {l.items.length === 0 && (
            <div className="of-hint">
              <ToolMark tool={agent} size={18} />
              <p>
                Escreva o que precisa. O {AGENT_NAME[agent]} trabalha em <b>{base(mesa.cwd)}</b>. Troque de agente a qualquer momento no seletor abaixo.
              </p>
            </div>
          )}
          {items.map((it) => (
            <Row key={it.id} it={it} mesa={mesa.id} />
          ))}
        </div>

        <div className={`of-composer is-${agent}`}>
          <textarea
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={`Peça algo ao ${AGENT_NAME[agent]}…  (Enter envia · Shift+Enter quebra linha · Esc interrompe)`}
            style={{ height: Math.min(220, 44 + Math.max(0, text.split('\n').length - 1) * 20) }}
          />
          <div className="of-bar">
            <div className="of-agents" role="radiogroup" aria-label="Agente">
              {AGENTS.map((a) => (
                <button key={a} role="radio" aria-checked={agent === a} className={agent === a ? 'is-on' : ''} onClick={() => setAgent(a)}>
                  <ToolMark tool={a} size={12} />
                  {AGENT_NAME[a]}
                  <i className={`is-${l.agents[a].status}`} aria-hidden="true" />
                </button>
              ))}
            </div>
            <Options mesa={mesa} agent={agent} live={l.agents[agent]} />
            <span className="of-grow" />
            {['thinking', 'writing', 'tool', 'waiting'].includes(l.agents[agent].status) ? (
              <button className="of-stop" onClick={() => void cancel(mesa.id, agent)} title="Interromper (Esc)">
                <Icon name="pause" size={12} /> Parar
              </button>
            ) : (
              <button className="of-send" onClick={go} disabled={!text.trim()} title="Enviar (Enter)">
                <Icon name="arrow" size={13} />
              </button>
            )}
          </div>
        </div>
      </section>

      <aside className="of-pista" aria-label="Agentes trabalhando">
        <div className="of-k">Pista</div>
        {used.map((a) => (
          <Lane key={a} mesa={mesa} agent={a} live={l.agents[a]} active={a === agent} onPick={() => setAgent(a)} />
        ))}
      </aside>
    </>
  )
}

function Options({ mesa, agent, live }: { mesa: Mesa; agent: AgentId; live: Live }) {
  const prefs = mesa.prefs[agent] ?? {}
  const pick = (c: ConfigOption) => {
    const order = c.options.filter((o) => !HIDDEN_VALUES.has(o.value))
    const cur = prefs[c.id] ?? c.currentValue
    const i = order.findIndex((o) => o.value === cur)
    const next = order[(i + 1) % order.length]
    if (next) void setOption(mesa, agent, c.id, next.value)
  }
  const shown = live.config.filter((c) => ['model', 'effort', 'mode', 'thought_level'].includes(c.id) || c.category === 'model' || c.category === 'mode')
  if (!shown.length) return <span className="of-opt is-ghost">{live.status === 'opening' ? 'abrindo…' : 'modelo e modo aparecem ao abrir o agente'}</span>
  return (
    <div className="of-opts">
      {shown.slice(0, 3).map((c) => {
        const cur = prefs[c.id] ?? c.currentValue
        const o = c.options.find((x) => x.value === cur)
        const label = c.category === 'mode' || c.id === 'mode' ? (MODE_PT[cur] ?? o?.name ?? cur) : (o?.name ?? cur)
        return (
          <button key={c.id} className="of-opt" onClick={() => pick(c)} title={`${c.name}: clique para trocar${o?.description ? ` · ${o.description}` : ''}`}>
            <small>{c.id === 'model' ? 'modelo' : c.id === 'effort' || c.category === 'thought_level' ? 'esforço' : 'modo'}</small>
            {label}
          </button>
        )
      })}
    </div>
  )
}

function Lane({ mesa, agent, live, active, onPick }: { mesa: Mesa; agent: AgentId; live: Live; active: boolean; onPick: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!live.since) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [live.since])
  const secs = live.since ? Math.round((Date.now() - live.since) / 1000) : 0
  const ctx = live.usage && live.usage.size ? Math.min(1, live.usage.used / live.usage.size) : null
  const done = live.plan.filter((p) => p.status === 'completed').length
  return (
    <section className={`of-lane is-${agent} is-${live.status} ${active ? 'is-active' : ''}`} onClick={onPick}>
      <header>
        <ToolMark tool={agent} size={15} />
        <b>{AGENT_NAME[agent]}</b>
        <span className="of-led" aria-hidden="true" />
        <em>{STATUS_PT[live.status]}</em>
        {live.since && <time>{secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}`}</time>}
      </header>
      {live.action && <p className="of-action">{live.action}</p>}
      {live.account && <p className="of-account">{live.account}</p>}
      {ctx !== null && (
        <div className="of-ctx" title={`${live.usage!.used.toLocaleString('pt-BR')} de ${live.usage!.size.toLocaleString('pt-BR')} tokens de contexto`}>
          <span>contexto</span>
          <i style={{ ['--w' as string]: `${ctx * 100}%` } as CSSProperties} className={ctx > 0.8 ? 'is-hot' : ''} />
          <b>{Math.round(ctx * 100)}%</b>
        </div>
      )}
      {live.plan.length > 0 && (
        <div className="of-plan">
          <span>
            plano · {done}/{live.plan.length}
          </span>
          <ol>
            {live.plan.slice(0, 8).map((p, i) => (
              <li key={i} className={`is-${p.status}`}>
                {p.content}
              </li>
            ))}
          </ol>
        </div>
      )}
      {live.files.length > 0 && (
        <div className="of-files">
          {live.files.slice(-6).map((f) => (
            <code key={f} title={f}>
              {base(f)}
            </code>
          ))}
        </div>
      )}
      <footer>
        {mesa.sessions[agent] && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void sx.resume(agent, mesa.sessions[agent]!, mesa.cwd)
            }}
            title="Continuar esta sessão no Terminal"
          >
            Terminal
          </button>
        )}
        {live.status !== 'off' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void closeAgent(mesa.id, agent)
            }}
            title="Fechar o agente para liberar memória (a conversa continua salva)"
          >
            Fechar
          </button>
        )}
      </footer>
    </section>
  )
}

function Row({ it, mesa }: { it: Item; mesa: string }) {
  const [open, setOpen] = useState(false)
  if (it.role === 'user')
    return (
      <div className="of-msg is-user">
        <span className="of-to">
          para <ToolMark tool={it.agent} size={10} /> {AGENT_NAME[it.agent]}
        </span>
        <div className="of-bubble">
          <Text text={it.text} />
        </div>
      </div>
    )
  if (it.role === 'agent')
    return (
      <div className={`of-msg is-agent is-${it.agent} ${it.open ? 'is-live' : ''}`}>
        <ToolMark tool={it.agent} size={13} />
        <div className="of-bubble">
          <Text text={it.text} />
        </div>
      </div>
    )
  if (it.role === 'thought')
    return (
      <button className={`of-thought ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <i aria-hidden="true" /> {it.open ? 'pensando…' : 'pensou'}
        {open && <span>{it.text}</span>}
      </button>
    )
  if (it.role === 'tool')
    return (
      <div className={`of-tool is-${it.status} is-k-${it.kind}`}>
        <i aria-hidden="true" />
        <span className="of-tool-t">{it.title}</span>
        {it.files.slice(0, 3).map((f) => (
          <code key={f}>{base(f)}</code>
        ))}
      </div>
    )
  if (it.role === 'perm')
    return (
      <div className={`of-perm ${it.answered ? 'is-done' : ''}`}>
        <div className="of-perm-t">
          <ToolMark tool={it.agent} size={12} /> {it.title}
        </div>
        {it.answered ? (
          <span className="of-perm-a">{it.answered === 'cancelled' ? 'recusado' : (it.options.find((o) => o.optionId === it.answered)?.name ?? 'respondido')}</span>
        ) : (
          <div className="of-perm-o">
            {it.options.map((o) => (
              <button key={o.optionId} className={`is-${o.kind}`} onClick={() => void answer(mesa, it.agent, it.id, o.optionId)}>
                {o.kind === 'allow_once' ? 'Permitir' : o.kind === 'allow_always' ? 'Sempre permitir' : o.kind === 'reject_once' ? 'Recusar' : o.kind === 'reject_always' ? 'Nunca' : o.name}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  return <div className={`of-note is-${it.tone}`}>{it.text}</div>
}
