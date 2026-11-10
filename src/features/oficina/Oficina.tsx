import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { onIntent } from '../../app/router'
import { isTauri } from '../../shared/db/api'
import { Icon } from '../work/icons'
import { getGh, gh, useGhSettings, type LocalRepo } from '../work/github/api'

const getGhSettingsSafe = () => getGh()
import { initScope, loadWork, useWork } from '../work/store'
import { SessionHost, SessionsView, ToolMark, Text } from '../work/sessions/Sessions'
import { sx } from '../work/sessions/api'
import { PERSONAL_ID, type Company } from '../work/types'
import {
  AGENT_NAME,
  AGENTS,
  answer,
  cancel,
  closeAgent,
  createMesa,
  effortKey,
  freshSession,
  listenOficina,
  liveOf,
  loadLocalModels,
  loadMesas,
  localConfig,
  markAuthDone,
  patchMesa,
  removeMesa,
  seed,
  send,
  setOption,
  setIsolate,
  setRepos,
  switchAccount,
  handoff,
  useOficina,
  type AgentId,
  type ConfigOption,
  type Item,
  type Live,
  type Mesa,
  type Shot,
} from './store'
import { Arsenal } from './Arsenal'
import { Bench } from './Bench'
import { cofreOf, getSettings, loadSettings, useSettings } from './cofre'
import { route as routeSkills, warmRouter, type Pick } from './router'
import { draftFor, type PendingItem } from './bridge'
import { ApplyAlfred, useAlfredRepo } from './Apply'
import { navigate } from '../../app/router'
import { openItem } from '../work/store'
import './oficina.css'
import './arsenal.css'

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
  'workspace-write': 'Edita no projeto',
  agent: 'Agente',
  'agent-full-access': 'Acesso total',
}
const HIDE = new Set(['bypassPermissions', 'default'])
const MODEL_PT: [RegExp, string][] = [
  [/^opus/, 'O mais forte para tarefa complexa'],
  [/fable/, 'Para os problemas mais cabeludos e longos'],
  [/^sonnet/, 'Rápido e bom para o dia a dia'],
  [/^haiku/, 'O mais rápido, para pedido simples'],
]
const modelDesc = (value: string, fallback?: string) => MODEL_PT.find(([re]) => re.test(value))?.[1] ?? fallback?.replace(/ · \$.*$/, '')

const EFFORT_PT: Record<string, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo', ultra: 'Ultra' }

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
const WORKING = new Set<Live['status']>(['opening', 'thinking', 'writing', 'tool', 'waiting'])

const IDEAS = ['Me explica esse projeto em 5 linhas', 'Revisa o que mudou na minha branch', 'Investiga um bug comigo', 'Planeja uma feature nova']

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
  return repos
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

const cofreFlow = (co: string) => cofreOf(co).flow

const inScope = (companyId: string | null, scope: string) => (scope === 'all' ? true : scope === PERSONAL_ID ? !companyId || companyId === PERSONAL_ID : companyId === scope)

function codexHomeFor(companyId: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem('oficina.codexHome') ?? '{}') as Record<string, string>)[companyId] ?? null
  } catch {
    return null
  }
}

function useOutside(open: boolean, close: () => void, ...refs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => !refs.some((r) => r.current?.contains(e.target as Node)) && close()
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', out)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', out)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
}

export default function Oficina() {
  const { state, scope } = useWork()
  const { mesas, loaded } = useOficina()
  const gs = useGhSettings()
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem('oficina.current'))
  const [rail, setRail] = useState(() => localStorage.getItem('oficina.rail') !== 'closed')
  const [area, setArea] = useState<'desks' | 'historico' | 'arsenal'>(() => (localStorage.getItem('sessao.area') as 'desks' | 'historico' | 'arsenal') || 'desks')
  useEffect(() => localStorage.setItem('sessao.area', area), [area])

  useEffect(() => {
    initScope()
    void loadWork()
    void loadMesas()
    void listenOficina()
    void loadLocalModels()
    void loadSettings().then(() => window.setTimeout(() => void warmRouter(), 1500))
  }, [])

  useEffect(() => localStorage.setItem('oficina.rail', rail ? 'open' : 'closed'), [rail])

  const companies = state?.companies ?? []
  const visible = mesas.filter((m) => inScope(m.companyId, scope))
  const desk = visible.find((m) => m.id === current) ?? null
  const fallback = gs.base || '~/Projetos'

  useEffect(() => {
    if (current) localStorage.setItem('oficina.current', current)
  }, [current])

  useEffect(() => {
    if (!desk) return
    const m = liveOf(desk.id)
    if (m.items.some((x) => x.agent !== 'local')) return
    const tasks = (['claude', 'codex'] as const).filter((a) => desk.sessions[a]).map(async (a) => {
      const turns = await sx.read(a, desk.sessions[a]!).catch(() => [])
      return turns.map((t, i): Item => {
        const at = t.at ? Date.parse(t.at) : i
        if (t.role === 'user') return { id: `h-${a}-${i}`, agent: a, role: 'user', text: t.text, at }
        if (t.role === 'tools') return { id: `h-${a}-${i}`, agent: a, role: 'tool', title: t.tools.join(' · '), kind: 'other', status: 'completed', files: [], at }
        return { id: `h-${a}-${i}`, agent: a, role: 'agent', text: t.text, at, open: false }
      })
    })
    void Promise.all(tasks).then((lists) => {
      const all = [...lists.flat(), ...m.items].sort((x, y) => x.at - y.at)
      if (all.length) seed(desk.id, all)
    })
  }, [desk?.id])

  const co = scope === 'all' ? PERSONAL_ID : scope
  const newDesk = () => {
    setArea('desks')
    setCurrent(null)
    localStorage.removeItem('oficina.current')
    window.setTimeout(() => window.dispatchEvent(new Event('ofc:focus')), 30)
  }

  useEffect(() => onIntent((i) => i === 'new-desk' && newDesk()), [])

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<{ tool: 'claude' | 'codex'; id: string; cwd: string | null; title: string | null }>).detail
      const existing = mesas.find((m) => m.sessions[d.tool] === d.id)
      if (existing) {
        setArea('desks')
        setCurrent(existing.id)
        return
      }
      const m = createMesa(co, d.cwd ? [d.cwd] : [], d.tool)
      patchMesa(m.id, { title: d.title ?? '', sessions: { [d.tool]: d.id } })
      setArea('desks')
      setCurrent(m.id)
    }
    const fromItem = () => {
      const raw = localStorage.getItem('sx.pendingItem')
      if (!raw || !loaded) return
      localStorage.removeItem('sx.pendingItem')
      let p: PendingItem
      try {
        p = JSON.parse(raw) as PendingItem
      } catch {
        return
      }
      const existing = mesas.find((m) => m.itemId === p.itemId)
      setArea('desks')
      if (existing) return setCurrent(existing.id)
      const gs = getGhSettingsSafe()
      const mapped = Object.entries(gs.repos).filter(([, c]) => c === p.companyId).map(([path]) => path)
      const m = createMesa(p.companyId, mapped.length === 1 ? mapped : [], 'claude')
      patchMesa(m.id, { title: p.ticket ? `${p.ticket.startsWith('#') ? p.ticket : `#${p.ticket}`} ${p.title}` : p.title, itemId: p.itemId, ticket: p.ticket, draft: draftFor(p) })
      setCurrent(m.id)
    }
    window.addEventListener('sx:pending-item', fromItem)
    fromItem()
    window.addEventListener('sx:to-desk', open)
    const pending = localStorage.getItem('sx.pendingDesk')
    if (pending && loaded) {
      localStorage.removeItem('sx.pendingDesk')
      try {
        open(new CustomEvent('sx:to-desk', { detail: JSON.parse(pending) }))
      } catch {
        localStorage.removeItem('sx.pendingDesk')
      }
    }
    return () => {
      window.removeEventListener('sx:to-desk', open)
      window.removeEventListener('sx:pending-item', fromItem)
    }
  }, [mesas, co, loaded])

  const start = (agent: AgentId, repos: string[], text: string) => {
    const d = createMesa(co, repos, agent)
    setCurrent(d.id)
    void send(d, agent, text, [], codexHomeFor(co), fallback)
  }

  if (!loaded) return <div className="ofc" />

  return (
    <div className={`ofc ${rail ? '' : 'is-railless'}`}>
      <aside className="ofc-rail">
        <header>
          <button className="ofc-rail-t" onClick={() => setRail((r) => !r)} title={rail ? 'Recolher' : 'Expandir'}>
            <Icon name="list" size={14} />
            {rail && <span>Sessão</span>}
          </button>
          {rail && (
            <button className="ofc-plus" onClick={newDesk} title="Nova desk (⌘N)">
              <Icon name="plus" size={13} />
            </button>
          )}
        </header>
        <nav className={`ofc-areas ${rail ? '' : 'is-icons'}`} aria-label="Áreas da Sessão">
          {(
            [
              ['desks', 'Desks', 'board'],
              ['historico', 'Histórico', 'clock'],
              ['arsenal', 'Arsenal', 'gear'],
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} className={area === id ? 'is-on' : ''} onClick={() => setArea(id)} title={label}>
              <Icon name={icon} size={13} />
              {rail && <span>{label}</span>}
            </button>
          ))}
        </nav>
        {rail && area === 'desks' && (
          <ul>
            {visible.length === 0 && <li className="ofc-muted">Nenhuma desk ainda.</li>}
            {visible.map((m, i) => {
              const l = liveOf(m.id)
              const co = companies.find((c) => c.id === m.companyId)
              const on = AGENTS.filter((a) => l.agents[a].status !== 'off' || m.sessions[a])
              return (
                <li key={m.id} style={{ ['--k' as string]: i } as CSSProperties}>
                  <button className={`ofc-desk ${m.id === desk?.id ? 'is-on' : ''}`} onClick={() => (setArea('desks'), setCurrent(m.id))}>
                    <span className="ofc-desk-t">{m.title || 'Desk nova'}</span>
                    <span className="ofc-desk-m">
                      {scope === 'all' && co && <em style={{ ['--co' as string]: co.color } as CSSProperties}>{co.name}</em>}
                      <span>{m.repos.length ? m.repos.map(base).join(' + ') : 'sem repositório'}</span>
                      <span className="ofc-dots">
                        {on.map((a) => (
                          <i key={a} className={`is-${a} is-${l.agents[a].status}`} />
                        ))}
                      </span>
                      <time>{rel(m.updatedAt)}</time>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {!rail && (
          <button className="ofc-plus is-solo" onClick={newDesk} title="Nova desk (⌘N)">
            <Icon name="plus" size={13} />
          </button>
        )}
      </aside>

      {area === 'arsenal' ? (
        <Arsenal companies={companies} scope={scope} />
      ) : area === 'historico' ? (
        <section className="ofc-hist">{state && <SessionsView state={state} scope={scope} />}</section>
      ) : desk ? (
        <DeskView key={desk.id} desk={desk} companies={companies} scope={scope} fallback={fallback} onDelete={() => void removeMesa(desk.id).then(() => setCurrent(null))} />
      ) : (
        <Launch companies={companies} scope={scope} recent={visible.slice(0, 6)} onOpen={setCurrent} onStart={start} />
      )}
      <SessionHost />
    </div>
  )
}

function Launch({ companies, scope, recent, onOpen, onStart }: { companies: Company[]; scope: string; recent: Mesa[]; onOpen: (id: string) => void; onStart: (agent: AgentId, repos: string[], text: string) => void }) {
  const [agent, setAgent] = useState<AgentId>(() => (localStorage.getItem('oficina.lastAgent') as AgentId) || 'claude')
  const [repos, setRepos] = useState<string[]>([])
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    box.current?.focus()
    const f = () => box.current?.focus()
    window.addEventListener('ofc:focus', f)
    return () => window.removeEventListener('ofc:focus', f)
  }, [])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(240, Math.max(84, el.scrollHeight))}px`
  }, [text])
  const go = () => {
    const t = text.trim()
    if (!t) return
    localStorage.setItem('oficina.lastAgent', agent)
    onStart(agent, repos, t)
  }
  return (
    <section className="ofc-launch">
      <div className="ofc-launch-in">
        <div className="ofc-launch-k">
          <span className="ofc-hero-marks">
            <ToolMark tool="claude" size={14} />
            <ToolMark tool="codex" size={14} />
            <ToolMark tool="local" size={14} />
          </span>
          Oficina
        </div>
        <h2 className="display">O que vamos construir?</h2>
        <p className="ofc-launch-sub">Cada conversa vira uma desk: Claude, Codex e modelos locais trabalhando juntos, nos repositórios que você escolher, pela sua assinatura.</p>
        <div className={`ofc-deck is-big is-${agent}`}>
          <textarea
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                go()
              }
            }}
            placeholder="Descreve a tarefa, cola um erro, pede uma revisão…"
          />
          <div className="ofc-deck-bar">
            <div className="ofc-agents" role="radiogroup" aria-label="Agente">
              {AGENTS.map((a) => (
                <button key={a} role="radio" aria-checked={agent === a} className={agent === a ? 'is-on' : ''} onClick={() => setAgent(a)}>
                  <ToolMark tool={a} size={12} />
                  <span>{AGENT_NAME[a]}</span>
                </button>
              ))}
            </div>
            <RepoChips repos={repos} onChange={setRepos} companies={companies} scope={scope} />
            <span className="ofc-grow" />
            <button className="ofc-send" onClick={go} disabled={!text.trim()} title="Começar (Enter)">
              <Icon name="up" size={14} />
            </button>
          </div>
        </div>
        <div className="ofc-ideas">
          {IDEAS.map((t) => (
            <button key={t} onClick={() => setText(t)}>
              {t}
            </button>
          ))}
        </div>
        {recent.length > 0 && (
          <div className="ofc-recent">
            <div className="ofc-recent-k">Desks recentes</div>
            <div className="ofc-recent-grid">
              {recent.map((m, i) => {
                const l = liveOf(m.id)
                const ags = AGENTS.filter((a) => m.sessions[a] || l.agents[a].status !== 'off' || l.items.some((x) => x.agent === a))
                return (
                  <button key={m.id} className="ofc-card" onClick={() => onOpen(m.id)} style={{ ['--k' as string]: i } as CSSProperties}>
                    <span className="ofc-card-t">{m.title || 'Desk nova'}</span>
                    <span className="ofc-card-r">{m.repos.length ? m.repos.map(base).join(' + ') : 'sem repositório'}</span>
                    <span className="ofc-card-f">
                      <span className="ofc-card-a">
                        {ags.map((a) => (
                          <span key={a} className={`ofc-av is-${l.agents[a].status}`}>
                            <ToolMark tool={a} size={10} />
                          </span>
                        ))}
                      </span>
                      <time>{rel(m.updatedAt)}</time>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function DeskView({ desk, companies, scope, fallback, onDelete }: { desk: Mesa; companies: Company[]; scope: string; fallback: string; onDelete: () => void }) {
  useOficina()
  useSettings()
  const l = liveOf(desk.id)
  const [agent, setAgent] = useState<AgentId>(desk.agent)
  const [bench, setBench] = useState(() => localStorage.getItem('sessao.bench') !== 'closed')
  const [wide, setWide] = useState(true)
  const [peek, setPeek] = useState(false)
  const view = useRef<HTMLDivElement>(null)
  const working = AGENTS.filter((a) => WORKING.has(l.agents[a].status))
  const editing = AGENTS.some((a) => l.agents[a].edits.length > 0)

  useEffect(() => localStorage.setItem('sessao.bench', bench ? 'open' : 'closed'), [bench])
  useLayoutEffect(() => {
    const el = view.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= 960))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const show = wide ? bench : peek
  const toggle = () => (wide ? setBench((p) => !p) : setPeek((p) => !p))
  const flow = desk.flow ?? cofreFlow(desk.companyId)
  const alfred = useAlfredRepo(desk.repos)

  return (
    <div ref={view} className={`ofc-desk-view ${show ? (wide ? 'has-bench' : 'has-peek') : ''}`}>
      <section className="ofc-center">
        <header className="ofc-top">
          <input className="ofc-title display" value={desk.title} placeholder="Desk nova" onChange={(e) => patchMesa(desk.id, { title: e.target.value })} />
          <RepoChips repos={desk.repos} onChange={(r) => void setRepos(desk, r)} companies={companies} scope={scope} />
          {desk.itemId && (
            <button
              className="ofc-item"
              onClick={() => {
                navigate('work')
                window.setTimeout(() => openItem(desk.itemId!), 120)
              }}
              title="Abrir o chamado no Quadro da Workstation"
            >
              <Icon name="hash" size={11} />
              {desk.ticket ? desk.ticket.replace(/^#/, '') : 'chamado'}
            </button>
          )}
          <span className="ofc-grow" />
          {alfred && <ApplyAlfred repo={alfred} />}
          {desk.repos.length > 0 && (
            <div className="ofc-flow">
              <button
                role="switch"
                aria-checked={!!desk.isolate}
                className={desk.isolate ? 'is-on' : ''}
                onClick={() => void setIsolate(desk, !desk.isolate)}
                title={desk.isolate ? `Cada agente na própria branch${desk.trees ? `: ${Object.values(desk.trees).join(', ')}` : ''}. Clique para voltar todos à pasta do repositório.` : 'Isolar: Claude e Codex trabalham ao mesmo tempo, cada um numa cópia própria do repositório (git worktree), sem pisar um no outro'}
              >
                Isolar
              </button>
            </div>
          )}
          <div className="ofc-flow" role="radiogroup" aria-label="Fluxo">
            {(['livre', 'maivado'] as const).map((f) => (
              <button key={f} role="radio" aria-checked={flow === f} className={flow === f ? 'is-on' : ''} onClick={() => patchMesa(desk.id, { flow: f })} title={f === 'livre' ? 'Conversa direta' : 'O /maivado conduz: rápido ou avançado, com travas'}>
                {f === 'livre' ? 'Livre' : 'mAIvado'}
              </button>
            ))}
          </div>
          <button className={`ofc-benchbtn ${show ? 'is-on' : ''}`} onClick={toggle} title={show ? 'Esconder a bancada' : 'Mostrar a bancada: código, arquivos, plano e agentes'}>
            <span className="ofc-avs">
              {AGENTS.filter((a) => desk.sessions[a] || l.agents[a].status !== 'off').map((a) => (
                <span key={a} className={`ofc-av is-${l.agents[a].status}`}>
                  <ToolMark tool={a} size={11} />
                </span>
              ))}
            </span>
            Bancada
            {working.length > 0 && editing && <i className="bn-rec" aria-hidden="true" />}
          </button>
          <Kebab onDelete={onDelete} />
        </header>
        <Feed desk={desk} agent={agent} fallback={fallback} />
        <Deck desk={desk} agent={agent} setAgent={setAgent} fallback={fallback} />
      </section>
      {show && (
        <div className={`ofc-bench ${wide ? '' : 'is-float'}`}>
          <Bench desk={desk} agent={agent} setAgent={setAgent} fallback={fallback} onClose={toggle} />
        </div>
      )}
    </div>
  )
}

function Kebab({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [arm, setArm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(open, () => {
    setOpen(false)
    setArm(false)
  }, ref)
  return (
    <div className="ofc-kebab" ref={ref}>
      <button className="ofc-icon" onClick={() => setOpen((o) => !o)} aria-label="Mais opções">
        <Icon name="grip" size={14} />
      </button>
      {open && (
        <div className="ofc-menu is-down is-right">
          <button className={arm ? 'is-danger' : ''} onClick={() => (arm ? onDelete() : setArm(true))}>
            <Icon name="trash" size={12} /> {arm ? 'Confirmar: apagar desk' : 'Apagar desk'}
          </button>
          <p>As sessões continuam no histórico do Claude e do Codex.</p>
        </div>
      )}
    </div>
  )
}

function RepoChips({ repos: chosen, onChange, companies, scope }: { repos: string[]; onChange: (r: string[]) => void; companies: Company[]; scope: string }) {
  const repos = useRepos()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useOutside(open, () => setOpen(false), ref)
  const list = (repos ?? [])
    .map((r) => ({ r, co: companyOfRepo(r, companies) }))
    .filter(({ co }) => inScope(co, scope))
    .filter(({ r }) => !chosen.includes(r.path))
    .filter(({ r }) => !q || `${r.name} ${r.repo ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="ofc-repos" ref={ref}>
      <div className="ofc-repos-in">
      {chosen.map((p, i) => (
        <span key={p} className={`ofc-repo ${i === 0 ? 'is-main' : ''}`} title={i === 0 ? `${p} (pasta principal)` : p}>
          <Icon name="board" size={11} />
          {base(p)}
          <button onClick={() => onChange(chosen.filter((x) => x !== p))} aria-label={`Tirar ${base(p)}`}>
            <Icon name="x" size={9} />
          </button>
        </span>
      ))}
      </div>
      <button className="ofc-repo is-add" onClick={() => setOpen((o) => !o)} title="Adicionar repositório">
        <Icon name="plus" size={10} /> {chosen.length ? 'repositório' : 'repositórios'}
      </button>
      {open && (
        <div className="ofc-menu ofc-repo-menu">
          <label className="ofc-find">
            <Icon name="search" size={12} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar repositório…" />
          </label>
          <div className="ofc-menu-list">
            {!repos && <p>Procurando repositórios…</p>}
            {repos && list.length === 0 && <p>Nada desta estação por aqui. Ligue repositórios a ela em GitHub › Estações.</p>}
            {list.slice(0, 60).map(({ r }) => (
              <button
                key={r.path}
                onClick={() => {
                  onChange([...chosen, r.path])
                  setQ('')
                }}
              >
                <b>{r.name}</b>
                <span>{r.repo ?? r.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                {r.branch && <code>{r.branch}</code>}
              </button>
            ))}
          </div>
          <p className="ofc-menu-hint">Escolha quantos quiser. O primeiro é a pasta principal; o agente enxerga todos.</p>
        </div>
      )}
    </div>
  )
}

type Block = { kind: 'item'; it: Item } | { kind: 'tools'; id: string; agent: AgentId; list: Extract<Item, { role: 'tool' }>[] }

function group(items: Item[]): Block[] {
  const out: Block[] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (it.role === 'tool') {
      if (last && last.kind === 'tools' && last.agent === it.agent) last.list.push(it)
      else out.push({ kind: 'tools', id: `g-${it.id}`, agent: it.agent, list: [it] })
    } else out.push({ kind: 'item', it })
  }
  return out
}

function Feed({ desk, agent, fallback }: { desk: Mesa; agent: AgentId; fallback: string }) {
  const l = liveOf(desk.id)
  const [show, setShow] = useState(160)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const blocks = useMemo(() => group(l.items.slice(-show)), [l.items, show])
  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [l.items])
  return (
    <div
      className="ofc-feed"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
      }}
    >
      <div className="ofc-feed-in">
        {l.items.length > show && (
          <button className="ofc-more" onClick={() => setShow((n) => n + 160)}>
            Ver anteriores ({l.items.length - show})
          </button>
        )}
        {l.items.length === 0 && (
          <div className="ofc-empty">
            <ToolMark tool={agent} size={26} />
            <h3 className="display">O que vamos fazer?</h3>
            <p>{desk.repos.length ? `Trabalhando em ${desk.repos.map(base).join(' + ')}.` : 'Sem repositório: bom pra pensar, planejar e perguntar. Adicione um ou mais lá em cima quando for mexer em código.'}</p>
            <div className="ofc-ideas">
              {IDEAS.map((t) => (
                <button key={t} onClick={() => window.dispatchEvent(new CustomEvent('ofc:fill', { detail: t }))}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {blocks.map((b) => (b.kind === 'tools' ? <Tools key={b.id} list={b.list} /> : <Row key={b.it.id} it={b.it} desk={desk.id} mesa={desk} fallback={fallback} />))}
      </div>
    </div>
  )
}

function Tools({ list }: { list: Extract<Item, { role: 'tool' }>[] }) {
  const [open, setOpen] = useState(false)
  const last = list[list.length - 1]
  const running = list.some((t) => t.status === 'in_progress' || t.status === 'pending')
  const failed = list.filter((t) => t.status === 'failed').length
  return (
    <div className={`ofc-tools ${open ? 'is-open' : ''} ${running ? 'is-running' : ''}`}>
      <button onClick={() => setOpen((o) => !o)}>
        <i aria-hidden="true" />
        <span className="ofc-tools-t">{running ? last.title : `${list.length} ${list.length === 1 ? 'ação' : 'ações'}`}</span>
        {!running && <span className="ofc-tools-l">{last.title}</span>}
        {failed > 0 && <em>{failed} falhou</em>}
        <Icon name="chevron" size={10} />
      </button>
      <div className="ofc-tools-b">
        <ol>
          {list.map((t) => (
            <li key={t.id} className={`is-${t.status}`}>
              <span>{t.title}</span>
              {t.files.slice(0, 2).map((f) => (
                <code key={f}>{base(f)}</code>
              ))}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function Row({ it, desk, mesa, fallback }: { it: Item; desk: string; mesa: Mesa; fallback: string }) {
  const [open, setOpen] = useState(false)
  if (it.role === 'user')
    return (
      <div className="ofc-u">
        <span className="ofc-u-to">
          para <ToolMark tool={it.agent} size={10} /> {AGENT_NAME[it.agent]}
        </span>
        <div className="ofc-u-b">
          <Text text={it.text} />
        </div>
        {!!it.skills?.length && (
          <span className="ofc-u-sk">
            <Icon name="spark" size={10} /> com {it.skills.join(', ')}
          </span>
        )}
      </div>
    )
  if (it.role === 'agent')
    return (
      <article className={`ofc-a is-${it.agent} ${it.open ? 'is-live' : ''}`}>
        <header>
          <ToolMark tool={it.agent} size={13} />
          <b>{AGENT_NAME[it.agent]}</b>
        </header>
        <div className="ofc-a-b">
          <Text text={it.text} />
        </div>
      </article>
    )
  if (it.role === 'thought')
    return (
      <button className={`ofc-th ${open ? 'is-open' : ''} ${it.open ? 'is-live' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span>
          <i aria-hidden="true" /> {it.open ? 'pensando' : 'raciocínio'}
          <Icon name="chevron" size={9} />
        </span>
        {open && <p>{it.text}</p>}
      </button>
    )
  if (it.role === 'perm')
    return (
      <div className={`ofc-perm ${it.answered ? 'is-done' : ''}`}>
        <div className="ofc-perm-t">
          <ToolMark tool={it.agent} size={12} />
          <span>{it.title}</span>
        </div>
        {it.answered ? (
          <em>{it.answered === 'cancelled' ? 'recusado' : (it.options.find((o) => o.optionId === it.answered)?.name ?? 'respondido')}</em>
        ) : (
          <div className="ofc-perm-o">
            {it.options.map((o) => (
              <button key={o.optionId} className={`is-${o.kind}`} onClick={() => void answer(desk, it.agent, it.id, o.optionId)}>
                {o.kind === 'allow_once' ? 'Permitir' : o.kind === 'allow_always' ? 'Sempre' : o.kind === 'reject_once' ? 'Recusar' : o.kind === 'reject_always' ? 'Nunca' : o.name}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  if (it.role === 'note') return <div className={`ofc-note is-${it.tone}`}>{it.text}</div>
  if (it.role === 'auth') return it.agent === 'codex' ? <CodexAuthCard mesa={mesa} done={it.done} /> : <AuthCard desk={desk} done={it.done} />
  if (it.role === 'limit') return <LimitCard it={it} mesa={mesa} fallback={fallback} />
  return null
}

function LimitCard({ it, mesa, fallback }: { it: Extract<Item, { role: 'limit' }>; mesa: Mesa; fallback: string }) {
  const s = getSettings()
  const kind = it.agent === 'codex' ? 'codex' : 'claude'
  const cur = mesa.accounts?.[it.agent] ?? (kind === 'claude' ? cofreOf(mesa.companyId).claudeAccount : cofreOf(mesa.companyId).codexAccount)
  const others = s.accounts[kind].filter((a) => a.id !== cur)
  const other = it.agent === 'claude' ? 'codex' : 'claude'
  if (it.done) return <div className="ofc-note is-info">Conta trocada.</div>
  return (
    <div className="ofc-limit">
      <header>
        <ToolMark tool={it.agent} size={14} />
        <b>Limite da conta estourou</b>
      </header>
      <p>{it.text}</p>
      <div className="ofc-limit-o">
        {others.map((a) => (
          <button key={a.id} className="is-go" onClick={() => void switchAccount(mesa, it.agent, a.id, it.id, fallback)}>
            Continuar com {a.label}
          </button>
        ))}
        {it.agent !== 'local' && (
          <button onClick={() => void handoff(mesa, it.agent, other, 'continue', fallback)}>
            Passar a tarefa ao {AGENT_NAME[other]}
          </button>
        )}
      </div>
      {others.length === 0 && <small>Cadastre outra conta em Arsenal › Contas para trocar sem perder a conversa.</small>}
    </div>
  )
}

function CodexAuthCard({ mesa, done }: { mesa: Mesa; done: boolean }) {
  const [msg, setMsg] = useState<string | null>(null)
  const acct = mesa.accounts?.codex ?? cofreOf(mesa.companyId).codexAccount
  const label = getSettings().accounts.codex.find((a) => a.id === acct)?.label ?? acct
  if (done)
    return (
      <div className="ofc-auth is-done">
        <ToolMark tool="codex" size={12} /> Pronto. Manda a mensagem de novo.
      </div>
    )
  return (
    <div className="ofc-auth is-codex">
      <header>
        <ToolMark tool="codex" size={16} />
        <b>A conta “{label}” do Codex não está logada</b>
      </header>
      <ol>
        <li>
          <span>Abre o Terminal com o login desta conta. Você entra pelo navegador com o ChatGPT dela.</span>
          <button onClick={() => void invoke('sessao_codex_login', { id: acct }).catch((e) => setMsg(String(e)))} disabled={acct === 'default'}>
            <Icon name="key" size={12} /> Entrar nesta conta
          </button>
          {acct === 'default' && <small>A conta padrão é a do Codex instalado: rode codex login no Terminal.</small>}
        </li>
        <li>
          <span>Terminou? Confirma aqui.</span>
          <button
            className="is-go"
            onClick={() => {
              void closeAgent(mesa.id, 'codex').then(() => markAuthDone(mesa.id, 'codex'))
            }}
          >
            Já entrei
          </button>
        </li>
      </ol>
      {msg && <p className="ofc-auth-e">{msg}</p>}
    </div>
  )
}

function AuthCard({ desk, done }: { desk: string; done: boolean }) {
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [alt, setAlt] = useState(false)
  if (done)
    return (
      <div className="ofc-auth is-done">
        <ToolMark tool="claude" size={12} /> Pronto, o Claude está liberado. Manda a mensagem de novo.
      </div>
    )
  const finish = async () => {
    await closeAgent(desk, 'claude')
    markAuthDone(desk, 'claude')
  }
  const check = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const st = await invoke<{ loggedIn: boolean }>('oficina_claude_status')
      if (st.loggedIn) await finish()
      else setMsg('Ainda não aparece logado. Termine o login no navegador e clique de novo.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await invoke('oficina_claude_token', { token, account: null })
      await finish()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ofc-auth">
      <header>
        <ToolMark tool="claude" size={16} />
        <b>O Claude Code desta máquina não está logado</b>
      </header>
      <p className="ofc-auth-p">O app do Claude e o Claude Code têm logins separados. A Sessão usa o do Claude Code, pela sua assinatura. É uma vez só.</p>
      <ol>
        <li>
          <span>Abre o Terminal com o login. Você entra pelo navegador com a sua conta.</span>
          <button onClick={() => void invoke('oficina_claude_signin').catch((e) => setMsg(String(e)))}>
            <Icon name="key" size={12} /> Entrar no Claude Code
          </button>
        </li>
        <li>
          <span>Terminou no navegador? Confirma aqui.</span>
          <button className="is-go" onClick={() => void check()} disabled={busy}>
            {busy ? 'Conferindo…' : 'Já entrei'}
          </button>
        </li>
      </ol>
      {!alt ? (
        <button className="ofc-auth-alt" onClick={() => setAlt(true)}>
          Prefiro usar um token da assinatura
        </button>
      ) : (
        <div className="ofc-auth-in">
          <button onClick={() => void invoke('oficina_claude_login').catch((e) => setMsg(String(e)))}>Gerar token</button>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-ant-oat…" autoComplete="off" spellCheck={false} />
          <button className="is-go" onClick={() => void save()} disabled={!token.trim() || busy}>
            Salvar
          </button>
        </div>
      )}
      {msg && <p className="ofc-auth-e">{msg}</p>}
    </div>
  )
}

function Menu({ label, value, title, children, wide }: { label: string; value: ReactNode; title?: string; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(open, () => setOpen(false), ref)
  return (
    <div className="ofc-pick" ref={ref}>
      <button className={`ofc-pick-b ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)} title={title}>
        <small>{label}</small>
        <span>{value}</span>
        <Icon name="chevron" size={9} />
      </button>
      {open && <div className={`ofc-menu is-up ${wide ? 'is-wide' : ''}`}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

function Choice({ on, name, desc, onClick }: { on: boolean; name: ReactNode; desc?: string; onClick: () => void }) {
  return (
    <button className={`ofc-choice ${on ? 'is-on' : ''}`} onClick={onClick}>
      <span>
        <b>{name}</b>
        {desc && <small>{desc}</small>}
      </span>
      {on && <Icon name="check" size={12} />}
    </button>
  )
}

function Controls({ desk, agent, live }: { desk: Mesa; agent: AgentId; live: Live }) {
  const prefs = desk.prefs[agent] ?? {}
  const cfg = agent === 'local' ? (live.config.length ? live.config : localConfig()) : live.config
  const model = cfg.find((c) => c.id === 'model')
  const effort = cfg.find((c) => c.id === effortKey(agent))
  const mode = cfg.find((c) => c.id === 'mode')
  const auto = agent !== 'local' && (prefs.model ?? 'auto') === 'auto'
  const curModel = prefs.model && prefs.model !== 'auto' ? prefs.model : model?.currentValue
  const modelName = auto ? 'Auto' : (model?.options.find((o) => o.value === curModel)?.name ?? curModel ?? '—')
  const curEffort = prefs[effortKey(agent)] ?? null
  const set = (c: ConfigOption | undefined, v: string | null) => c && void setOption(desk, agent, c.id, v)
  if (!cfg.length)
    return (
      <span className="ofc-wait">
        {agent === 'local' ? 'procurando modelos no Ollama…' : live.status === 'opening' ? 'abrindo o agente…' : 'opções aparecem na primeira mensagem'}
      </span>
    )
  return (
    <div className="ofc-ctrls">
      {model && (
        <Menu label="modelo" value={modelName} wide>
          {(close) => (
            <div className="ofc-menu-list">
              {agent !== 'local' && (
                <Choice
                  on={auto}
                  name={
                    <>
                      Auto <em className="ofc-tag">recomendado</em>
                    </>
                  }
                  desc="Escolhe modelo e esforço a cada mensagem, pelo tipo do pedido"
                  onClick={() => {
                    set(model, 'auto')
                    close()
                  }}
                />
              )}
              {model.options
                .filter((o) => o.value !== 'default')
                .map((o) => (
                  <Choice
                    key={o.value}
                    on={!auto && curModel === o.value}
                    name={o.name}
                    desc={modelDesc(o.value, o.description)}
                    onClick={() => {
                      set(model, o.value)
                      close()
                    }}
                  />
                ))}
            </div>
          )}
        </Menu>
      )}
      {effort && (
        <Menu label="esforço" value={curEffort ? (EFFORT_PT[curEffort] ?? curEffort) : auto ? 'Auto' : (EFFORT_PT[effort.currentValue] ?? effort.currentValue)}>
          {(close) => (
            <div className="ofc-menu-list">
              {auto && (
                <Choice
                  on={!curEffort}
                  name="Auto"
                  desc="Acompanha o modelo escolhido pelo Auto"
                  onClick={() => {
                    set(effort, null)
                    close()
                  }}
                />
              )}
              {effort.options
                .filter((o) => o.value !== 'default')
                .map((o) => (
                  <Choice
                    key={o.value}
                    on={(curEffort ?? (auto ? '' : effort.currentValue)) === o.value}
                    name={EFFORT_PT[o.value] ?? o.name}
                    onClick={() => {
                      set(effort, o.value)
                      close()
                    }}
                  />
                ))}
            </div>
          )}
        </Menu>
      )}
      {mode && (
        <Menu label="permissão" value={MODE_PT[prefs.mode ?? mode.currentValue] ?? mode.currentValue}>
          {(close) => (
            <div className="ofc-menu-list">
              {mode.options
                .filter((o) => !HIDE.has(o.value) || o.value === (prefs.mode ?? mode.currentValue))
                .map((o) => (
                  <Choice
                    key={o.value}
                    on={(prefs.mode ?? mode.currentValue) === o.value}
                    name={MODE_PT[o.value] ?? o.name}
                    desc={o.description}
                    onClick={() => {
                      set(mode, o.value)
                      close()
                    }}
                  />
                ))}
            </div>
          )}
        </Menu>
      )}
    </div>
  )
}

const readImage = (f: File) =>
  new Promise<Shot | null>((res) => {
    if (!f.type.startsWith('image/') || f.size > 8_000_000) return res(null)
    const r = new FileReader()
    r.onload = () => res({ mime: f.type, data: String(r.result).split(',')[1] ?? '' })
    r.onerror = () => res(null)
    r.readAsDataURL(f)
  })

function Deck({ desk, agent, setAgent, fallback }: { desk: Mesa; agent: AgentId; setAgent: (a: AgentId) => void; fallback: string }) {
  const l = liveOf(desk.id)
  const live = l.agents[agent]
  const [text, setText] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [slash, setSlash] = useState(0)
  const [picks, setPicks] = useState<Pick[]>([])
  const [dropped, setDropped] = useState<Set<string>>(new Set())
  const box = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const busy = WORKING.has(live.status) && live.status !== 'opening'
  const auto = useSettings().autoSkills !== false
  const flowNow = desk.flow ?? cofreOf(desk.companyId).flow

  useEffect(() => {
    if (!auto || agent === 'local' || text.trim().length < 6 || text.startsWith('/')) {
      setPicks([])
      return
    }
    let alive = true
    const t = window.setTimeout(() => {
      void routeSkills(text, desk.repos, desk.companyId)
        .then((p) => alive && setPicks(p))
        .catch(() => alive && setPicks([]))
    }, 420)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [text, agent, auto, desk.repos.join('|')])
  const chosen = picks.filter((p) => !dropped.has(p.id))

  useEffect(() => {
    if (desk.draft) {
      setText(desk.draft)
      patchMesa(desk.id, { draft: undefined })
    }
  }, [desk.id])

  useEffect(() => {
    box.current?.focus()
    const fill = (e: Event) => {
      setText((e as CustomEvent<string>).detail)
      box.current?.focus()
    }
    window.addEventListener('ofc:fill', fill)
    return () => window.removeEventListener('ofc:fill', fill)
  }, [desk.id])

  useEffect(() => {
    if (agent === 'local') void loadLocalModels()
  }, [agent])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(260, Math.max(56, el.scrollHeight))}px`
  }, [text])

  const go = () => {
    const t = text.trim()
    if ((!t && !shots.length) || WORKING.has(live.status)) return
    setText('')
    setShots([])
    setPicks([])
    setDropped(new Set())
    if (agent !== desk.agent) patchMesa(desk.id, { agent })
    void send(desk, agent, t, shots, codexHomeFor(desk.companyId), fallback, auto ? chosen : [])
  }

  const showSlash = text.startsWith('/') && !text.includes(' ') && !text.includes('\n')
  const q = text.slice(1).toLowerCase()
  const actions: { name: string; desc: string; run: () => void }[] = [
    { name: 'nova-sessao', desc: `Começa do zero com o ${AGENT_NAME[agent]}`, run: () => void freshSession(desk, agent) },
    ...(agent !== 'local' ? [{ name: 'compactar', desc: 'Resume a conversa para liberar contexto', run: () => void send(desk, agent, '/compact', [], codexHomeFor(desk.companyId), fallback) }] : []),
    ...(agent !== 'local' && desk.sessions[agent] ? [{ name: 'terminal', desc: 'Continua esta sessão no Terminal', run: () => void sx.resume(agent, desk.sessions[agent]!, desk.repos[0] ?? fallback) }] : []),
    ...(live.status !== 'off' ? [{ name: 'fechar', desc: 'Fecha o agente e libera memória', run: () => void closeAgent(desk.id, agent) }] : []),
  ]
  const opts = [
    ...actions.filter((a) => a.name.includes(q)).map((a) => ({ key: `a-${a.name}`, label: `/${a.name}`, desc: a.desc, alfred: true, pick: () => (a.run(), setText('')) })),
    ...live.commands.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12).map((c) => ({ key: `c-${c.name}`, label: `/${c.name}`, desc: c.description, alfred: false, pick: () => setText(`/${c.name} `) })),
  ]
  const sel = Math.min(slash, Math.max(0, opts.length - 1))

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash && opts.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSlash((s) => (s + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        opts[sel].pick()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      go()
    }
    if (e.key === 'Escape' && busy) void cancel(desk.id, agent)
  }

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    const got = (await Promise.all(files.map(readImage))).filter(Boolean) as Shot[]
    setShots((s) => [...s, ...got].slice(0, 6))
  }

  return (
    <div className={`ofc-deck is-${agent}`}>
      {showSlash && opts.length > 0 && (
        <div className="ofc-slash">
          {opts.map((o, i) => (
            <button key={o.key} className={i === sel ? 'is-on' : ''} onMouseEnter={() => setSlash(i)} onClick={o.pick}>
              <b>{o.label}</b>
              <span>{o.desc}</span>
              {o.alfred && <em>Alfred</em>}
            </button>
          ))}
        </div>
      )}
      {chosen.length > 0 && !(flowNow === 'maivado' && agent === 'claude' && !desk.sessions.claude) && (
        <div className="ofc-skchips" aria-label="Skills escolhidas para esta mensagem">
          <span className="ofc-skchips-k">
            <Icon name="spark" size={11} /> skills
          </span>
          {chosen.map((p) => (
            <span key={p.id} className="ofc-skchip" title={`${p.id} · ${p.why}`}>
              {p.name}
              <button onClick={() => setDropped((d) => new Set(d).add(p.id))} aria-label={`Não usar ${p.name}`}>
                <Icon name="x" size={8} />
              </button>
            </span>
          ))}
        </div>
      )}
      {shots.length > 0 && (
        <div className="ofc-shots">
          {shots.map((s, i) => (
            <span key={i}>
              <img src={`data:${s.mime};base64,${s.data}`} alt="" />
              <button onClick={() => setShots((x) => x.filter((_, j) => j !== i))} aria-label="Tirar imagem">
                <Icon name="x" size={9} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={box}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setSlash(0)
        }}
        onKeyDown={onKey}
        onPaste={(e) => void onPaste(e)}
        placeholder={`Fala com o ${AGENT_NAME[agent]}…   / para comandos`}
      />
      <div className="ofc-deck-bar">
        <div className="ofc-agents" role="radiogroup" aria-label="Agente">
          {AGENTS.map((a) => (
            <button key={a} role="radio" aria-checked={agent === a} className={agent === a ? 'is-on' : ''} onClick={() => setAgent(a)} title={`${AGENT_NAME[a]}: ${STATUS_PT[l.agents[a].status]}`}>
              <ToolMark tool={a} size={12} />
              <span>{AGENT_NAME[a]}</span>
              <i className={`is-${l.agents[a].status}`} aria-hidden="true" />
            </button>
          ))}
        </div>
        <Controls desk={desk} agent={agent} live={live} />
        <span className="ofc-grow" />
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={async (e) => {
            const got = (await Promise.all([...(e.target.files ?? [])].map(readImage))).filter(Boolean) as Shot[]
            setShots((s) => [...s, ...got].slice(0, 6))
            e.target.value = ''
          }}
        />
        <button className="ofc-icon" onClick={() => file.current?.click()} title="Anexar imagem (ou cole com ⌘V)">
          <Icon name="image" size={14} />
        </button>
        {busy ? (
          <button className="ofc-stop" onClick={() => void cancel(desk.id, agent)} title="Interromper (Esc)">
            <Icon name="pause" size={12} />
          </button>
        ) : (
          <button className="ofc-send" onClick={go} disabled={!text.trim() && !shots.length} title="Enviar (Enter)">
            <Icon name="up" size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
