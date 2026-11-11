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
  agentLabel,
  answer,
  cancel,
  castAgent,
  customOf,
  modelOf,
  removeCustom,
  saveCustom,
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
import { cofreOf, getSettings, loadSettings, useSettings, type CustomAgent } from './cofre'
import { route as routeSkills, warmRouter, type Pick } from './router'
import { draftFor, type PendingItem } from './bridge'
import { ApplyAlfred, useAlfredRepo } from './Apply'
import { navigate } from '../../app/router'
import { openItem } from '../work/store'
import './oficina.css'
import './arsenal.css'
import './sessao.css'

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
    <div className="ofc">
      <header className="ss-bar">
        <nav className="ss-areas" aria-label="Áreas da Sessão">
          {(
            [
              ['desks', 'Desks'],
              ['historico', 'Histórico'],
              ['arsenal', 'Arsenal'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={area === id ? 'is-on' : ''} onClick={() => (id === 'desks' && area === 'desks' ? newDesk() : setArea(id))}>
              {label}
            </button>
          ))}
        </nav>
        <div className="ss-tabs" role="tablist" aria-label="Desks abertas">
          {visible.map((m) => {
            const l = liveOf(m.id)
            const co = companies.find((c) => c.id === m.companyId)
            const busy = AGENTS.some((a) => WORKING.has(l.agents[a].status) && l.agents[a].status !== 'waiting')
            const ask = AGENTS.some((a) => l.agents[a].status === 'waiting')
            const on = area === 'desks' && m.id === desk?.id
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={on}
                className={`ss-tab ${on ? 'is-on' : ''} ${busy ? 'is-busy' : ''} ${ask ? 'is-ask' : ''}`}
                onClick={() => (setArea('desks'), setCurrent(m.id))}
                title={`${m.title || 'Desk nova'} · ${m.repos.length ? m.repos.map(base).join(' + ') : 'sem repositório'} · ${rel(m.updatedAt)}`}
                style={scope === 'all' && co ? ({ ['--co' as string]: co.color } as CSSProperties) : undefined}
              >
                {scope === 'all' && co && <i className="ss-tab-co" aria-hidden="true" />}
                <span>{m.title || 'Desk nova'}</span>
                {(busy || ask) && <i className="ss-tab-st" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
        <button className="ss-new" onClick={newDesk} title="Nova desk (⌘N)" aria-label="Nova desk">
          <Icon name="plus" size={13} />
        </button>
      </header>

      {area === 'arsenal' ? (
        <Arsenal companies={companies} scope={scope} />
      ) : area === 'historico' ? (
        <section className="ofc-hist">{state && <SessionsView state={state} scope={scope} />}</section>
      ) : desk ? (
        <DeskView key={desk.id} desk={desk} companies={companies} scope={scope} fallback={fallback} onDelete={() => void removeMesa(desk.id).then(() => setCurrent(null))} />
      ) : (
        <Launch companies={companies} scope={scope} recent={visible.slice(0, 24)} onOpen={setCurrent} onStart={start} />
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
            <div className="ofc-recent-k">Suas desks</div>
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
  const [bench, setBench] = useState(() => localStorage.getItem('sessao.bench') === 'open')
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
    <div ref={view} className={`ofc-desk-view ss-desk ${show ? (wide ? 'has-bench' : 'has-peek') : ''}`}>
      <section className="ss-main">
        <header className="ss-head">
          <div className="ss-head-l">
            <input className="ss-title" value={desk.title} placeholder="Desk nova" onChange={(e) => patchMesa(desk.id, { title: e.target.value })} spellCheck={false} />
            <div className="ss-meta">
              <RepoChips repos={desk.repos} onChange={(r) => void setRepos(desk, r)} companies={companies} scope={scope} />
              {desk.itemId && (
                <button
                  className="ss-meta-b"
                  onClick={() => {
                    navigate('work')
                    window.setTimeout(() => openItem(desk.itemId!), 120)
                  }}
                  title="Abrir o chamado no Quadro da Workstation"
                >
                  #{desk.ticket ? desk.ticket.replace(/^#/, '') : 'chamado'}
                </button>
              )}
              <button
                className={`ss-meta-b ${flow === 'maivado' ? 'is-on' : ''}`}
                onClick={() => patchMesa(desk.id, { flow: flow === 'livre' ? 'maivado' : 'livre' })}
                title={flow === 'livre' ? 'Conversa direta. Clique para o /maivado conduzir, com travas' : 'O /maivado conduz: rápido ou avançado, com travas. Clique para conversa direta'}
              >
                {flow === 'livre' ? 'livre' : 'mAIvado'}
              </button>
              {desk.repos.length > 0 && (
                <button
                  role="switch"
                  aria-checked={!!desk.isolate}
                  className={`ss-meta-b ${desk.isolate ? 'is-on' : ''}`}
                  onClick={() => void setIsolate(desk, !desk.isolate)}
                  title={desk.isolate ? `Cada agente na própria branch${desk.trees ? `: ${Object.values(desk.trees).join(', ')}` : ''}. Clique para voltar todos à pasta do repositório.` : 'Isolar: Claude e Codex trabalham ao mesmo tempo, cada um numa cópia própria do repositório (git worktree), sem pisar um no outro'}
                >
                  {desk.isolate ? 'isolados' : 'mesma pasta'}
                </button>
              )}
            </div>
          </div>
          <div className="ss-head-r">
            <Roster desk={desk} live={l} agent={agent} onPick={setAgent} />
            {alfred && <ApplyAlfred repo={alfred} />}
            <button className={`ss-ico ${show ? 'is-on' : ''}`} onClick={toggle} title={show ? 'Esconder a bancada' : 'Bancada: código, arquivos, plano e terminal'} aria-label="Bancada">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
                <path d="M10 2.75v10.5" />
              </svg>
              {working.length > 0 && editing && <i className="ss-ico-rec" aria-hidden="true" />}
            </button>
            <Kebab onDelete={onDelete} />
          </div>
        </header>
        <Feed desk={desk} agent={agent} fallback={fallback} />
        <Pulse desk={desk} live={l} items={l.items} />
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

const elapsed = (since: number) => {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Roster({ desk, live, agent, onPick }: { desk: Mesa; live: ReturnType<typeof liveOf>; agent: AgentId; onPick: (a: AgentId) => void }) {
  return (
    <div className="ss-roster" role="radiogroup" aria-label="Agentes desta desk">
      {AGENTS.map((a) => {
        const st = live.agents[a].status
        const custom = customOf(desk, a)
        return (
          <button
            key={a}
            role="radio"
            aria-checked={agent === a}
            className={`ss-who is-${a} is-${st} ${agent === a ? 'is-on' : ''} ${WORKING.has(st) ? 'is-working' : ''}`}
            onClick={() => onPick(a)}
            title={`${custom?.name ?? AGENT_NAME[a]}${custom ? ` (via ${AGENT_NAME[a]})` : ''} · ${STATUS_PT[st]} · ${modelOf(desk, a)}`}
          >
            <i aria-hidden="true" />
            {custom?.name ?? AGENT_NAME[a]}
          </button>
        )
      })}
    </div>
  )
}

function Pulse({ desk, live, items }: { desk: Mesa; live: ReturnType<typeof liveOf>; items: Item[] }) {
  const [, tick] = useState(0)
  const rows = AGENTS.map((a) => {
    const l = live.agents[a]
    const ctx = l.usage && l.usage.size ? Math.min(1, l.usage.used / l.usage.size) : 0
    return { a, l, ctx }
  }).filter(({ l, ctx }) => WORKING.has(l.status) || l.status === 'error' || ctx > 0.8)
  const ticking = rows.some(({ l }) => l.since)
  useEffect(() => {
    if (!ticking) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [ticking])
  if (!rows.length) return null
  return (
    <div className="ss-pulse" aria-live="polite">
      {rows.map(({ a, l, ctx }) => {
        const working = WORKING.has(l.status)
        const last = [...items].reverse().find((x): x is Extract<Item, { role: 'tool' }> => x.agent === a && x.role === 'tool')
        const file = working ? (last?.files[0] ?? l.edits[l.edits.length - 1]?.path) : undefined
        const line = l.status === 'error' ? (l.error ?? 'deu erro') : working ? l.action || STATUS_PT[l.status] : 'contexto quase cheio: use /compactar'
        return (
          <div key={a} className={`ss-pulse-r is-${a} is-${l.status}`}>
            <i aria-hidden="true" />
            <b>{agentLabel(desk, a)}</b>
            <span>{line}</span>
            {file && <code>{base(file)}</code>}
            {ctx > 0.8 && working && <em title={`Contexto: ${Math.round(ctx * 100)}% usado`}>{Math.round(ctx * 100)}%</em>}
            {l.since && working && <time>{elapsed(l.since)}</time>}
          </div>
        )
      })}
    </div>
  )
}

function AgentPick({ desk, agent, setAgent }: { desk: Mesa; agent: AgentId; setAgent: (a: AgentId) => void }) {
  const s = useSettings()
  const l = liveOf(desk.id)
  const [open, setOpen] = useState(false)
  const [forge, setForge] = useState<CustomAgent | 'new' | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(open, () => setOpen(false), ref)
  const mine = (s.agents ?? []).filter((a) => a.engine === agent)
  const cur = desk.cast?.[agent] ?? null
  const st = l.agents[agent].status
  return (
    <div className="ss-pick" ref={ref}>
      <button className={`ss-to is-${agent} is-${st} ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)} title="Para quem vai a mensagem e com qual papel">
        <i aria-hidden="true" />
        <b>{agentLabel(desk, agent)}</b>
        <Icon name="chevron" size={9} />
      </button>
      {open && (
        <div className="ofc-menu is-up ss-pick-menu">
          <p className="ss-menu-k">Mandar para</p>
          <div className="ofc-menu-list">
            {AGENTS.map((a) => (
              <Choice key={a} on={agent === a} name={agentLabel(desk, a)} desc={`${STATUS_PT[l.agents[a].status]} · ${modelOf(desk, a)}`} onClick={() => setAgent(a)} />
            ))}
          </div>
          <p className="ss-menu-k">Papel do {AGENT_NAME[agent]}</p>
          <div className="ofc-menu-list">
            <Choice on={!cur || !mine.some((a) => a.id === cur)} name={AGENT_NAME[agent]} desc="Padrão, sem instruções extras" onClick={() => castAgent(desk, agent, null)} />
            {mine.map((a) => (
              <div key={a.id} className="ofc-cast-row">
                <Choice on={cur === a.id} name={a.name} desc={a.brief.trim().split('\n')[0].slice(0, 80)} onClick={() => castAgent(desk, agent, a.id)} />
                <button className="ofc-cast-ed" onClick={() => (setForge(a), setOpen(false))}>
                  editar
                </button>
              </div>
            ))}
          </div>
          <button className="ofc-cast-new" onClick={() => (setForge('new'), setOpen(false))}>
            <Icon name="plus" size={11} /> Criar agente
          </button>
        </div>
      )}
      {forge && <AgentForge desk={desk} engine={agent} editing={forge === 'new' ? null : forge} onClose={() => setForge(null)} />}
    </div>
  )
}

function AgentForge({ desk, engine: engine0, editing, onClose }: { desk: Mesa; engine: AgentId; editing: CustomAgent | null; onClose: () => void }) {
  const [name, setName] = useState(editing?.name ?? '')
  const [engine, setEngine] = useState<AgentId>(editing?.engine ?? engine0)
  const [model, setModel] = useState(editing?.model ?? '')
  const [brief, setBrief] = useState(editing?.brief ?? '')
  const [arm, setArm] = useState(false)
  const live = liveOf(desk.id).agents[engine]
  const models = ((engine === 'local' ? localConfig() : live.config).find((c) => c.id === 'model')?.options ?? []).filter((o) => o.value !== 'default')
  const ok = name.trim().length > 1 && brief.trim().length > 9
  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  const save = () => {
    if (!ok) return
    const a: CustomAgent = { id: editing?.id ?? crypto.randomUUID(), name: name.trim().slice(0, 28), engine, brief: brief.trim().slice(0, 4000), model: model || undefined }
    saveCustom(a)
    if (editing && editing.engine !== engine && desk.cast?.[editing.engine] === a.id) castAgent(desk, editing.engine, null)
    castAgent(desk, engine, a.id)
    onClose()
  }
  return (
    <div className="ofc-forge-veil" onClick={onClose}>
      <form
        className={`ofc-forge is-${engine}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <h3 className="display">{editing ? 'Editar agente' : 'Criar agente'}</h3>
        <p className="ofc-forge-sub">Um agente seu é um papel com nome e instruções, rodando em cima de um dos motores. Ele assume o posto desse motor nesta desk e fica salvo para as outras.</p>
        <label>
          <span>Nome</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Revisor, Arquiteto, DBA…" maxLength={28} />
        </label>
        <div className="ofc-forge-f">
          <span>Motor</span>
          <div className="ofc-flow" role="radiogroup" aria-label="Motor">
            {AGENTS.map((a) => (
              <button type="button" key={a} role="radio" aria-checked={engine === a} className={engine === a ? 'is-on' : ''} onClick={() => (setEngine(a), setModel(''))}>
                {AGENT_NAME[a]}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span>Modelo</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">O que estiver no posto</option>
            {models.map((o) => (
              <option key={o.value} value={o.value}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Instruções</span>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="O que ele faz, como responde, o que nunca faz. Ex.: Você só revisa. Não edita arquivo. Aponta bug, risco de segurança e teste faltando, em ordem de gravidade." rows={7} />
        </label>
        <footer>
          {editing && (
            <button
              type="button"
              className="ofc-forge-del"
              onClick={() => {
                if (!arm) return setArm(true)
                if (desk.cast?.[editing.engine] === editing.id) castAgent(desk, editing.engine, null)
                removeCustom(editing.id)
                onClose()
              }}
            >
              {arm ? 'Confirmar exclusão' : 'Excluir'}
            </button>
          )}
          <span className="ofc-grow" />
          <button type="button" className="ofc-forge-no" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="ofc-forge-ok" disabled={!ok}>
            {editing ? 'Salvar' : 'Criar e pôr no posto'}
          </button>
        </footer>
      </form>
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
  const blocks = useMemo(() => {
    let prev = ''
    return group(l.items.slice(-show)).map((b) => {
      if (b.kind !== 'item' || (b.it.role !== 'agent' && b.it.role !== 'user')) return { b, cont: false }
      const who = `${b.it.role}:${b.it.agent}`
      const cont = b.it.role === 'agent' && who === prev
      prev = who
      return { b, cont }
    })
  }, [l.items, show])
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
      <div className="ss-feed-in">
        {l.items.length > show && (
          <button className="ofc-more" onClick={() => setShow((n) => n + 160)}>
            Ver anteriores ({l.items.length - show})
          </button>
        )}
        {l.items.length === 0 && (
          <div className="ss-empty">
            <h3>O que vamos fazer?</h3>
            <p>{desk.repos.length ? `Trabalhando em ${desk.repos.map(base).join(' + ')}, com ${agentLabel(desk, agent)}.` : 'Sem repositório: bom pra pensar, planejar e perguntar. Adicione um lá em cima quando for mexer em código.'}</p>
            <ul>
              {IDEAS.map((t) => (
                <li key={t}>
                  <button onClick={() => window.dispatchEvent(new CustomEvent('ofc:fill', { detail: t }))}>{t}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {blocks.map(({ b, cont }) => (b.kind === 'tools' ? <Tools key={b.id} list={b.list} /> : <Row key={b.it.id} it={b.it} cont={cont} desk={desk.id} mesa={desk} fallback={fallback} />))}
      </div>
    </div>
  )
}

const kinds = (list: Extract<Item, { role: 'tool' }>[]) => {
  const seen = new Map<string, number>()
  for (const t of list) for (const w of t.title.split(' · ')) seen.set(w, (seen.get(w) ?? 0) + 1)
  return [...seen].map(([w, n]) => (n > 1 ? `${w} ×${n}` : w)).join(', ')
}

function Tools({ list }: { list: Extract<Item, { role: 'tool' }>[] }) {
  const [open, setOpen] = useState(false)
  const last = list[list.length - 1]
  const running = list.some((t) => t.status === 'in_progress' || t.status === 'pending')
  const failed = list.filter((t) => t.status === 'failed').length
  return (
    <div className={`ss-tools ${open ? 'is-open' : ''} ${running ? 'is-running' : ''}`}>
      <button onClick={() => setOpen((o) => !o)}>
        <i aria-hidden="true" />
        <span className="ss-tools-t">{running ? last.title : `${list.length} ${list.length === 1 ? 'ação' : 'ações'}`}</span>
        {!running && <span className="ss-tools-l">{kinds(list)}</span>}
        {failed > 0 && <em>{failed} falhou</em>}
        <Icon name="chevron" size={9} />
      </button>
      <div className="ss-tools-b">
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

const clock = (at: number) => (at > 1e11 ? new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '')

function Row({ it, cont, desk, mesa, fallback }: { it: Item; cont?: boolean; desk: string; mesa: Mesa; fallback: string }) {
  const [open, setOpen] = useState(false)
  if (it.role === 'user')
    return (
      <div className={`ss-ask is-${it.agent}`}>
        <div className="ss-lbl">
          <span>
            para <b>{it.alias ?? AGENT_NAME[it.agent]}</b>
          </span>
          <time>{clock(it.at)}</time>
        </div>
        <div className="ss-ask-b">
          <Text text={it.text} />
          {(!!it.skills?.length || !!it.shared) && (
            <div className="ss-x">
              {!!it.skills?.length && (
                <span>
                  <Icon name="spark" size={10} /> com {it.skills.join(', ')}
                </span>
              )}
              {!!it.shared && (
                <span title={it.sharedText ?? 'O agente recebeu junto o que foi dito aos outros agentes desta desk desde a última mensagem dele'}>
                  <Icon name="link" size={10} /> levou {it.shared} {it.shared === 1 ? 'nota' : 'notas'} dos outros agentes
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    )
  if (it.role === 'agent')
    return (
      <article className={`ss-say is-${it.agent} ${it.open ? 'is-live' : ''} ${cont ? 'is-cont' : ''}`}>
        {!cont && (
          <div className="ss-lbl">
            <b>
              <i aria-hidden="true" />
              {it.alias ?? AGENT_NAME[it.agent]}
            </b>
            {it.model && <span title="Modelo que respondeu">{it.model}</span>}
            <time>{clock(it.at)}</time>
          </div>
        )}
        <div className="ss-say-b">
          <Text text={it.text} />
        </div>
      </article>
    )
  if (it.role === 'thought')
    return (
      <button className={`ss-th ${open ? 'is-open' : ''} ${it.open ? 'is-live' : ''}`} onClick={() => setOpen((o) => !o)}>
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(open, () => setOpen(false), ref)
  if (!cfg.length)
    return (
      <span className="ofc-wait">
        {agent === 'local' ? 'procurando modelos no Ollama…' : live.status === 'opening' ? 'abrindo o agente…' : 'opções aparecem na primeira mensagem'}
      </span>
    )
  const effortName = curEffort ? (EFFORT_PT[curEffort] ?? curEffort) : auto ? null : effort ? (EFFORT_PT[effort.currentValue] ?? effort.currentValue) : null
  const modeName = mode ? (MODE_PT[prefs.mode ?? mode.currentValue] ?? mode.currentValue) : null
  return (
    <div className="ss-tune" ref={ref}>
      <button className={`ss-tune-b ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)} title="Modelo, esforço e permissão">
        {[modelName, effortName, modeName].filter(Boolean).map((t, i) => (
          <span key={i}>{t}</span>
        ))}
        <Icon name="chevron" size={9} />
      </button>
      {open && (
        <div className="ofc-menu is-up ss-tune-menu">
          {model && (
            <section>
              <p className="ss-menu-k">Modelo</p>
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
                    onClick={() => set(model, 'auto')}
                  />
                )}
                {model.options
                  .filter((o) => o.value !== 'default')
                  .map((o) => (
                    <Choice key={o.value} on={!auto && curModel === o.value} name={o.name} desc={modelDesc(o.value, o.description)} onClick={() => set(model, o.value)} />
                  ))}
              </div>
            </section>
          )}
          {effort && (
            <section>
              <p className="ss-menu-k">Esforço</p>
              <div className="ofc-menu-list">
                {auto && <Choice on={!curEffort} name="Auto" desc="Acompanha o modelo" onClick={() => set(effort, null)} />}
                {effort.options
                  .filter((o) => o.value !== 'default')
                  .map((o) => (
                    <Choice key={o.value} on={(curEffort ?? (auto ? '' : effort.currentValue)) === o.value} name={EFFORT_PT[o.value] ?? o.name} onClick={() => set(effort, o.value)} />
                  ))}
              </div>
            </section>
          )}
          {mode && (
            <section>
              <p className="ss-menu-k">Permissão</p>
              <div className="ofc-menu-list">
                {mode.options
                  .filter((o) => !HIDE.has(o.value) || o.value === (prefs.mode ?? mode.currentValue))
                  .map((o) => (
                    <Choice key={o.value} on={(prefs.mode ?? mode.currentValue) === o.value} name={MODE_PT[o.value] ?? o.name} desc={o.description} onClick={() => set(mode, o.value)} />
                  ))}
              </div>
            </section>
          )}
        </div>
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
    el.style.height = `${Math.min(260, Math.max(24, el.scrollHeight))}px`
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
              {o.alfred && <em>Shed</em>}
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
        rows={1}
        placeholder={`Fala com o ${agentLabel(desk, agent)}…   / para comandos`}
      />
      <div className="ofc-deck-bar">
        <AgentPick desk={desk} agent={agent} setAgent={setAgent} />
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
