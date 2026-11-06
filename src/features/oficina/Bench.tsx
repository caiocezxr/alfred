import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../work/icons'
import { ToolMark } from '../work/sessions/Sessions'
import { AGENT_NAME, AGENTS, handoff, liveOf, useOficina, type AgentId, type Edit, type Live, type Mesa } from './store'

type Tab = 'codigo' | 'arquivos' | 'plano' | 'terminal' | 'agentes'
type Line = { kind: 'same' | 'add' | 'del'; text: string; n: number | null }

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export function diffLines(a: string, b: string): Line[] {
  const x = a ? a.split('\n') : []
  const y = b.split('\n')
  if (x.length * y.length > 250_000) return y.map((t, i) => ({ kind: 'add', text: t, n: i + 1 }))
  const m = x.length
  const n = y.length
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Line[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (x[i] === y[j]) {
      out.push({ kind: 'same', text: y[j], n: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: 'del', text: x[i++], n: null })
    else {
      out.push({ kind: 'add', text: y[j], n: j + 1 })
      j++
    }
  }
  while (i < m) out.push({ kind: 'del', text: x[i++], n: null })
  while (j < n) {
    out.push({ kind: 'add', text: y[j], n: j + 1 })
    j++
  }
  return out
}

function hunks(lines: Line[], ctx = 4): (Line | null)[] {
  const keep = new Set<number>()
  lines.forEach((l, i) => {
    if (l.kind !== 'same') for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep.add(k)
  })
  if (!keep.size) return lines.slice(0, 60)
  const out: (Line | null)[] = []
  let last = -2
  for (let i = 0; i < lines.length; i++) {
    if (!keep.has(i)) continue
    if (i !== last + 1 && out.length) out.push(null)
    out.push(lines[i])
    last = i
  }
  return out
}

function Code({ edit, live }: { edit: Edit; live: boolean }) {
  const rows = useMemo(() => hunks(diffLines(edit.old, edit.neu)), [edit.old, edit.neu])
  const adds = rows.filter((r) => r?.kind === 'add').length
  const dels = rows.filter((r) => r?.kind === 'del').length
  let k = 0
  return (
    <div className={`bn-code ${live ? 'is-live' : ''}`}>
      <header>
        <Icon name="text" size={12} />
        <b title={edit.path}>{base(edit.path)}</b>
        <span className="bn-path">{edit.path.replace(/^\/Users\/[^/]+/, '~').split('/').slice(0, -1).join('/')}</span>
        <span className="ofc-grow" />
        <i>+{adds}</i>
        <s>−{dels}</s>
      </header>
      <pre>
        {rows.map((r, i) =>
          r === null ? (
            <span key={i} className="bn-gap">
              ⋯
            </span>
          ) : (
            <span key={i} className={`bn-l is-${r.kind}`} style={r.kind === 'add' && live ? ({ ['--d' as string]: `${Math.min(40, k++) * 45}ms` } as CSSProperties) : undefined}>
              <em>{r.n ?? ''}</em>
              <b>{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</b>
              {r.text || ' '}
            </span>
          ),
        )}
      </pre>
    </div>
  )
}

export function Lane({ agent, live, active, onPick }: { agent: AgentId; live: Live; active: boolean; onPick: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!live.since) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [live.since])
  const secs = live.since ? Math.round((Date.now() - live.since) / 1000) : 0
  const ctx = live.usage && live.usage.size ? Math.min(1, live.usage.used / live.usage.size) : null
  const account = live.account && !/not logged/i.test(live.account) ? live.account : null
  const STATUS: Record<Live['status'], string> = { off: 'desligado', opening: 'abrindo', idle: 'pronto', thinking: 'pensando', writing: 'escrevendo', tool: 'trabalhando', waiting: 'esperando você', error: 'com erro' }
  return (
    <section className={`ofc-lane is-${agent} is-${live.status} ${active ? 'is-active' : ''}`} onClick={onPick}>
      <header>
        <ToolMark tool={agent} size={14} />
        <b>{AGENT_NAME[agent]}</b>
        <span className="ofc-led" aria-hidden="true" />
        <em>{STATUS[live.status]}</em>
        {live.since && <time>{secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}`}</time>}
      </header>
      {live.action && live.status !== 'idle' && live.status !== 'off' && <p className="ofc-lane-a">{live.action}</p>}
      {live.error && live.status === 'error' && <p className="ofc-lane-e">{live.error}</p>}
      {ctx !== null && (
        <div className="ofc-ctx" title={`${live.usage!.used.toLocaleString('pt-BR')} de ${live.usage!.size.toLocaleString('pt-BR')} tokens`}>
          <span>contexto</span>
          <i style={{ ['--w' as string]: `${ctx * 100}%` } as CSSProperties} className={ctx > 0.8 ? 'is-hot' : ''} />
          <b>{Math.round(ctx * 100)}%</b>
        </div>
      )}
      {account && <p className="ofc-acct">{account}</p>}
    </section>
  )
}

export function Bench({ desk, agent, setAgent, fallback, onClose }: { desk: Mesa; agent: AgentId; setAgent: (a: AgentId) => void; fallback: string; onClose: () => void }) {
  useOficina()
  const l = liveOf(desk.id)
  const a = l.agents[agent]
  const working = a.status === 'tool' || a.status === 'writing' || a.status === 'thinking'
  const edits = AGENTS.flatMap((x) => l.agents[x].edits.map((e) => ({ ...e, agent: x }))).sort((p, q) => p.at - q.at)
  const latest = [...edits].reverse().find((e) => e.agent === agent) ?? edits[edits.length - 1]
  const [tab, setTab] = useState<Tab>(() => (edits.length ? 'codigo' : 'agentes'))
  const [pick, setPick] = useState<string | null>(null)
  const plan = AGENTS.map((x) => ({ x, plan: l.agents[x].plan })).filter((p) => p.plan.length)
  const outputs = AGENTS.flatMap((x) => l.agents[x].outputs.map((o) => ({ ...o, agent: x }))).sort((p, q) => q.at - p.at)
  const files = useMemo(() => {
    const by = new Map<string, { path: string; old: string; neu: string; agent: AgentId; n: number }>()
    for (const e of edits) {
      const cur = by.get(e.path)
      by.set(e.path, cur ? { ...cur, neu: e.neu, agent: e.agent, n: cur.n + 1, old: cur.old } : { path: e.path, old: e.old, neu: e.neu, agent: e.agent, n: 1 })
    }
    return [...by.values()]
  }, [edits.length, latest?.neu])

  useEffect(() => {
    if (edits.length && tab === 'agentes' && working) setTab('codigo')
  }, [edits.length])

  const others = AGENTS.filter((x) => x !== agent && x !== 'local')
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'codigo', label: 'Código' },
    { id: 'arquivos', label: 'Arquivos', n: files.length },
    { id: 'plano', label: 'Plano', n: plan.reduce((s, p) => s + p.plan.length, 0) },
    { id: 'terminal', label: 'Terminal', n: outputs.length },
    { id: 'agentes', label: 'Agentes' },
  ]
  const chosen = pick ? files.find((f) => f.path === pick) : null

  let body: ReactNode = null
  if (tab === 'codigo')
    body = latest ? (
      <Code key={`${latest.id}-${latest.path}`} edit={latest} live={working} />
    ) : (
      <div className="bn-empty">
        <Icon name="text" size={18} />
        <p>Quando o agente editar um arquivo, o código aparece aqui sendo escrito, com o que entrou e o que saiu.</p>
      </div>
    )
  if (tab === 'arquivos')
    body = chosen ? (
      <>
        <button className="bn-back" onClick={() => setPick(null)}>
          <Icon name="back" size={11} /> todos os arquivos
        </button>
        <Code edit={{ id: 'f', path: chosen.path, old: chosen.old, neu: chosen.neu, at: 0, status: 'completed' }} live={false} />
      </>
    ) : files.length ? (
      <ul className="bn-files">
        {files.map((f) => {
          const d = diffLines(f.old, f.neu)
          return (
            <li key={f.path}>
              <button onClick={() => setPick(f.path)}>
                <ToolMark tool={f.agent} size={10} />
                <b>{base(f.path)}</b>
                <span>{f.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                <i>+{d.filter((x) => x.kind === 'add').length}</i>
                <s>−{d.filter((x) => x.kind === 'del').length}</s>
              </button>
            </li>
          )
        })}
      </ul>
    ) : (
      <div className="bn-empty">
        <Icon name="board" size={18} />
        <p>Nenhum arquivo mexido nesta desk ainda.</p>
      </div>
    )
  if (tab === 'plano')
    body = plan.length ? (
      <div className="bn-plans">
        {plan.map(({ x, plan: p }) => (
          <div key={x} className="ofc-plan">
            <span>
              <ToolMark tool={x} size={10} /> {AGENT_NAME[x]} · {p.filter((e) => e.status === 'completed').length}/{p.length}
            </span>
            <ol>
              {p.map((e, i) => (
                <li key={i} className={`is-${e.status}`}>
                  {e.content}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    ) : (
      <div className="bn-empty">
        <Icon name="list" size={18} />
        <p>Quando o agente montar um plano, cada passo aparece aqui e vai sendo riscado.</p>
      </div>
    )
  if (tab === 'terminal')
    body = outputs.length ? (
      <div className="bn-term">
        {outputs.map((o) => (
          <div key={o.id}>
            <header>
              <ToolMark tool={o.agent} size={10} /> <b>{o.title}</b>
            </header>
            <pre>{o.text}</pre>
          </div>
        ))}
      </div>
    ) : (
      <div className="bn-empty">
        <Icon name="hash" size={18} />
        <p>Saída dos comandos que o agente rodar: testes, build, git.</p>
      </div>
    )
  if (tab === 'agentes')
    body = (
      <div className="bn-agents">
        {AGENTS.filter((x) => desk.sessions[x] || l.agents[x].status !== 'off' || l.items.some((it) => it.agent === x) || x === agent).map((x) => (
          <Lane key={x} agent={x} live={l.agents[x]} active={x === agent} onPick={() => setAgent(x)} />
        ))}
        {agent !== 'local' && l.items.some((it) => it.agent === agent && it.role === 'agent') && (
          <div className="bn-cross">
            <div className="bn-cross-k">Interligar</div>
            {others.map((o) => (
              <div key={o} className="bn-cross-row">
                <button onClick={() => void handoff(desk, agent, o, 'review', fallback).then(() => setAgent(o))}>
                  <ToolMark tool={o} size={12} />
                  <span>
                    <b>Pedir revisão ao {AGENT_NAME[o]}</b>
                    <small>Ele lê o que o {AGENT_NAME[agent]} fez e aponta problema, sem editar</small>
                  </span>
                </button>
                <button onClick={() => void handoff(desk, agent, o, 'continue', fallback).then(() => setAgent(o))}>
                  <ToolMark tool={o} size={12} />
                  <span>
                    <b>Passar a tarefa ao {AGENT_NAME[o]}</b>
                    <small>Leva plano, arquivos e conversa recente e continua daqui</small>
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )

  return (
    <aside className="bn" aria-label="Bancada">
      <nav className="bn-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
            {!!t.n && <em>{t.n}</em>}
            {t.id === 'codigo' && working && edits.length > 0 && <i className="bn-rec" aria-hidden="true" />}
          </button>
        ))}
        <span className="ofc-grow" />
        <button className="bn-close" onClick={onClose} aria-label="Fechar a bancada">
          <Icon name="x" size={11} />
        </button>
      </nav>
      <div className="bn-body" key={tab}>
        {body}
      </div>
    </aside>
  )
}
