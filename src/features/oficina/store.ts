import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSyncExternalStore } from 'react'
import { track } from '../../shared/activity'
import { api, isTauri } from '../../shared/db/api'

export type AgentId = 'claude' | 'codex'
export const AGENTS: AgentId[] = ['claude', 'codex']
export const AGENT_NAME: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex' }

export type Mesa = {
  id: string
  companyId: string
  title: string
  cwd: string
  agent: AgentId
  sessions: Partial<Record<AgentId, string>>
  prefs: Partial<Record<AgentId, Record<string, string>>>
  createdAt: string
  updatedAt: string
}

export type Option = { value: string; name: string; description?: string }
export type ConfigOption = { id: string; name: string; category?: string; currentValue: string; options: Option[] }
export type PlanEntry = { content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: string }
export type PermOption = { optionId: string; name: string; kind: string }

export type Item =
  | { id: string; agent: AgentId; role: 'user'; text: string; at: number }
  | { id: string; agent: AgentId; role: 'agent'; text: string; at: number; open: boolean }
  | { id: string; agent: AgentId; role: 'thought'; text: string; at: number; open: boolean }
  | { id: string; agent: AgentId; role: 'tool'; title: string; kind: string; status: string; files: string[]; at: number }
  | { id: string; agent: AgentId; role: 'perm'; title: string; options: PermOption[]; rpc: unknown; answered: string | null; at: number }
  | { id: string; agent: AgentId; role: 'note'; text: string; tone: 'error' | 'info'; at: number }

export type Status = 'off' | 'opening' | 'idle' | 'thinking' | 'writing' | 'tool' | 'waiting' | 'error'

export type Live = {
  status: Status
  action: string
  account: string | null
  config: ConfigOption[]
  plan: PlanEntry[]
  usage: { used: number; size: number; cost: number | null } | null
  files: string[]
  since: number | null
  turns: number
  error: string | null
}

type MesaLive = { items: Item[]; agents: Record<AgentId, Live> }

const blank = (): Live => ({ status: 'off', action: '', account: null, config: [], plan: [], usage: null, files: [], since: null, turns: 0, error: null })

let mesas: Mesa[] = []
let loaded = false
const live = new Map<string, MesaLive>()
let ver = 0
const subs = new Set<() => void>()
const emit = () => {
  ver++
  subs.forEach((f) => f())
}

export function useOficina() {
  useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    () => ver,
  )
  return { mesas, loaded }
}

export function liveOf(id: string): MesaLive {
  let m = live.get(id)
  if (!m) {
    m = { items: [], agents: { claude: blank(), codex: blank() } }
    live.set(id, m)
  }
  return m
}

const KEY = 'oficina.mesas'

export async function loadMesas() {
  if (loaded) return
  try {
    const raw = isTauri ? await api.settingGet(KEY) : localStorage.getItem(KEY)
    mesas = raw ? (JSON.parse(raw) as Mesa[]) : []
  } catch {
    mesas = []
  }
  loaded = true
  emit()
}

let saveT = 0
function save() {
  window.clearTimeout(saveT)
  saveT = window.setTimeout(() => {
    const raw = JSON.stringify(mesas)
    if (isTauri) void api.settingSet(KEY, raw)
    else localStorage.setItem(KEY, raw)
  }, 300)
}

export function createMesa(companyId: string, cwd: string, agent: AgentId): Mesa {
  const now = new Date().toISOString()
  const m: Mesa = { id: crypto.randomUUID(), companyId, title: '', cwd, agent, sessions: {}, prefs: {}, createdAt: now, updatedAt: now }
  mesas = [m, ...mesas]
  save()
  emit()
  return m
}

export function patchMesa(id: string, patch: Partial<Mesa>) {
  mesas = mesas.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m))
  save()
  emit()
}

export async function removeMesa(id: string) {
  for (const a of AGENTS) await closeAgent(id, a)
  mesas = mesas.filter((m) => m.id !== id)
  live.delete(id)
  save()
  emit()
}

const uid = () => Math.random().toString(36).slice(2, 10)

function push(mesa: string, item: Item) {
  const m = liveOf(mesa)
  m.items = [...m.items, item]
}

function setAgent(mesa: string, agent: AgentId, patch: Partial<Live>) {
  const m = liveOf(mesa)
  m.agents = { ...m.agents, [agent]: { ...m.agents[agent], ...patch } }
}

const stops = new Map<string, () => void>()
function busy(mesa: string, agent: AgentId, on: boolean) {
  const k = `${mesa}:${agent}`
  if (on && !stops.has(k)) stops.set(k, track(`oficina-${k}`, `Oficina · ${AGENT_NAME[agent]}`, 'core', 'agente trabalhando'))
  if (!on) {
    stops.get(k)?.()
    stops.delete(k)
  }
}

type Out = { mesa: string; agent: AgentId; kind: 'notify' | 'request' | 'response' | 'exit' | 'error'; data: Record<string, unknown> }

const queue: Out[] = []
let frame = 0

function flush() {
  frame = 0
  const batch = queue.splice(0)
  for (const ev of batch) apply(ev)
  if (batch.length) emit()
}

export function feed(ev: Out) {
  queue.push(ev)
  if (!frame) frame = requestAnimationFrame(flush)
}

const textOf = (c: unknown) => {
  const b = c as { type?: string; text?: string } | null
  return b && b.type === 'text' ? (b.text ?? '') : ''
}

function apply(ev: Out) {
  const { mesa, agent } = ev
  const m = liveOf(mesa)
  if (ev.kind === 'notify') {
    const method = ev.data.method as string
    const p = (ev.data.params ?? {}) as Record<string, unknown>
    if (method === '_auth/status_update') {
      const st = p.authStatus as { kind?: string; label?: string; account?: { email?: string } } | undefined
      setAgent(mesa, agent, { account: st?.account?.email ? `${st.label} · ${st.account.email}` : (st?.label ?? null) })
      return
    }
    if (method !== 'session/update') return
    const u = p.update as Record<string, unknown>
    const kind = u.sessionUpdate as string
    const last = m.items[m.items.length - 1]
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const role = kind === 'agent_message_chunk' ? 'agent' : 'thought'
      const text = textOf(u.content)
      if (last && last.agent === agent && last.role === role && last.open) {
        m.items = [...m.items.slice(0, -1), { ...last, text: last.text + text }]
      } else push(mesa, { id: uid(), agent, role, text, at: Date.now(), open: true } as Item)
      setAgent(mesa, agent, { status: role === 'agent' ? 'writing' : 'thinking', action: role === 'agent' ? 'escrevendo a resposta' : 'pensando' })
      return
    }
    if (kind === 'user_message_chunk') {
      const text = textOf(u.content)
      if (last && last.agent === agent && last.role === 'user') m.items = [...m.items.slice(0, -1), { ...last, text: last.text + text }]
      else push(mesa, { id: uid(), agent, role: 'user', text, at: Date.now() })
      return
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const id = u.toolCallId as string
      const locs = ((u.locations as { path?: string }[] | undefined) ?? []).map((l) => l.path).filter(Boolean) as string[]
      const i = m.items.findIndex((x) => x.role === 'tool' && x.id === id)
      if (i >= 0) {
        const cur = m.items[i] as Extract<Item, { role: 'tool' }>
        const next = { ...cur, title: (u.title as string) || cur.title, status: (u.status as string) || cur.status, files: locs.length ? locs : cur.files }
        m.items = m.items.map((x, j) => (j === i ? next : x))
      } else {
        m.items = m.items.map((x) => (x.role === 'agent' || x.role === 'thought') && x.open && x.agent === agent ? { ...x, open: false } : x)
        push(mesa, { id, agent, role: 'tool', title: (u.title as string) || 'ferramenta', kind: (u.kind as string) || 'other', status: (u.status as string) || 'pending', files: locs, at: Date.now() })
      }
      const st = (u.status as string) || 'in_progress'
      const touched = (u.kind === 'edit' || u.kind === 'delete' || u.kind === 'move') ? locs : []
      setAgent(mesa, agent, {
        status: st === 'completed' || st === 'failed' ? 'thinking' : 'tool',
        action: (u.title as string) || m.agents[agent].action,
        files: touched.length ? [...new Set([...m.agents[agent].files, ...touched])] : m.agents[agent].files,
      })
      return
    }
    if (kind === 'plan') {
      setAgent(mesa, agent, { plan: (u.entries as PlanEntry[]) ?? [] })
      return
    }
    if (kind === 'usage_update') {
      const cost = (u.cost as { amount?: number } | null)?.amount ?? null
      setAgent(mesa, agent, { usage: { used: Number(u.used) || 0, size: Number(u.size) || 0, cost } })
      return
    }
    if (kind === 'config_option_update') {
      const opts = u.configOptions as ConfigOption[] | undefined
      if (opts) setAgent(mesa, agent, { config: opts })
      return
    }
    if (kind === 'session_info_update') {
      const title = u.title as string | undefined
      const me = mesas.find((x) => x.id === mesa)
      if (title && me && !me.title) patchMesa(mesa, { title })
      return
    }
    return
  }
  if (ev.kind === 'request') {
    const method = ev.data.method as string
    if (method === 'session/request_permission') {
      const p = ev.data.params as { toolCall?: { title?: string }; options?: PermOption[] }
      push(mesa, { id: uid(), agent, role: 'perm', title: p.toolCall?.title ?? 'O agente pede permissão', options: p.options ?? [], rpc: ev.data.id, answered: null, at: Date.now() })
      setAgent(mesa, agent, { status: 'waiting', action: 'esperando você aprovar' })
    } else {
      void invoke('oficina_reply', { mesa, agent, id: ev.data.id, result: null }).catch(() => {})
    }
    return
  }
  if (ev.kind === 'response') {
    const err = ev.data.error as { message?: string } | undefined
    m.items = m.items.map((x) => (x.role === 'agent' || x.role === 'thought') && x.open && x.agent === agent ? { ...x, open: false } : x)
    if (err) push(mesa, { id: uid(), agent, role: 'note', text: err.message ?? 'o agente falhou nesta mensagem', tone: 'error', at: Date.now() })
    setAgent(mesa, agent, { status: 'idle', action: '', since: null, turns: m.agents[agent].turns + 1 })
    busy(mesa, agent, false)
    return
  }
  if (ev.kind === 'error') {
    push(mesa, { id: uid(), agent, role: 'note', text: String(ev.data.message ?? 'erro'), tone: 'error', at: Date.now() })
    setAgent(mesa, agent, { status: 'error', error: String(ev.data.message ?? 'erro') })
    busy(mesa, agent, false)
    return
  }
  if (ev.kind === 'exit') {
    const was = m.agents[agent].status
    const stderr = String(ev.data.stderr ?? '').trim()
    if (was !== 'off' && was !== 'idle' && stderr) push(mesa, { id: uid(), agent, role: 'note', text: stderr.split('\n').slice(-3).join('\n'), tone: 'error', at: Date.now() })
    setAgent(mesa, agent, { status: 'off', action: '', since: null })
    busy(mesa, agent, false)
  }
}

let listening = false
export async function listenOficina() {
  if (listening || !isTauri) return
  listening = true
  await listen<Out>('oficina', (e) => feed(e.payload))
}

export const oficinaApi = {
  status: () => invoke<{ claude: boolean; codex: boolean; open: string[] }>('oficina_status'),
  start: (mesa: string, agent: AgentId, cwd: string, resume: string | null, codexHome: string | null) =>
    invoke<{ agent: unknown; session: { sessionId: string; configOptions?: ConfigOption[] } }>('oficina_start', { mesa, agent, cwd, resume, codexHome }),
  prompt: (mesa: string, agent: AgentId, text: string) => invoke<number>('oficina_prompt', { mesa, agent, text }),
  cancel: (mesa: string, agent: AgentId) => invoke<void>('oficina_cancel', { mesa, agent }),
  config: (mesa: string, agent: AgentId, option: string, value: string) => invoke<unknown>('oficina_config', { mesa, agent, option, value }),
  reply: (mesa: string, agent: AgentId, id: unknown, result: unknown) => invoke<void>('oficina_reply', { mesa, agent, id, result }),
  close: (mesa: string, agent: AgentId) => invoke<void>('oficina_close', { mesa, agent }),
}

const opening = new Map<string, Promise<void>>()

export function ensureAgent(mesa: Mesa, agent: AgentId, codexHome: string | null): Promise<void> {
  const k = `${mesa.id}:${agent}`
  const st = liveOf(mesa.id).agents[agent].status
  if (st !== 'off' && st !== 'error') return opening.get(k) ?? Promise.resolve()
  const p = (async () => {
    setAgent(mesa.id, agent, { status: 'opening', action: 'abrindo o agente', error: null })
    emit()
    try {
      const r = await oficinaApi.start(mesa.id, agent, mesa.cwd, mesa.sessions[agent] ?? null, agent === 'codex' ? codexHome : null)
      const sid = r.session.sessionId
      if (mesa.sessions[agent] !== sid) patchMesa(mesa.id, { sessions: { ...mesas.find((x) => x.id === mesa.id)?.sessions, [agent]: sid } })
      setAgent(mesa.id, agent, { status: 'idle', action: '', config: r.session.configOptions ?? liveOf(mesa.id).agents[agent].config })
      const prefs = mesa.prefs[agent] ?? {}
      for (const [opt, val] of Object.entries(prefs)) await oficinaApi.config(mesa.id, agent, opt, val).catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAgent(mesa.id, agent, { status: 'error', error: msg, action: '' })
      push(mesa.id, { id: uid(), agent, role: 'note', text: msg, tone: 'error', at: Date.now() })
    } finally {
      opening.delete(k)
      emit()
    }
  })()
  opening.set(k, p)
  return p
}

export async function send(mesa: Mesa, agent: AgentId, text: string, codexHome: string | null) {
  push(mesa.id, { id: uid(), agent, role: 'user', text, at: Date.now() })
  if (!mesa.title) patchMesa(mesa.id, { title: text.split('\n')[0].slice(0, 70) })
  emit()
  await ensureAgent(mesa, agent, codexHome)
  if (liveOf(mesa.id).agents[agent].status === 'error') return
  setAgent(mesa.id, agent, { status: 'thinking', action: 'lendo o pedido', since: Date.now() })
  busy(mesa.id, agent, true)
  emit()
  try {
    await oficinaApi.prompt(mesa.id, agent, text)
  } catch (e) {
    push(mesa.id, { id: uid(), agent, role: 'note', text: e instanceof Error ? e.message : String(e), tone: 'error', at: Date.now() })
    setAgent(mesa.id, agent, { status: 'idle', since: null })
    busy(mesa.id, agent, false)
    emit()
  }
}

export async function answer(mesa: string, agent: AgentId, itemId: string, optionId: string | null) {
  const m = liveOf(mesa)
  const it = m.items.find((x) => x.id === itemId)
  if (!it || it.role !== 'perm' || it.answered) return
  m.items = m.items.map((x) => (x.id === itemId ? { ...it, answered: optionId ?? 'cancelled' } : x))
  setAgent(mesa, agent, { status: 'tool', action: optionId ? 'continuando' : 'pedido recusado' })
  emit()
  await oficinaApi.reply(mesa, agent, it.rpc, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
}

export async function setOption(mesa: Mesa, agent: AgentId, option: string, value: string) {
  patchMesa(mesa.id, { prefs: { ...mesa.prefs, [agent]: { ...(mesa.prefs[agent] ?? {}), [option]: value } } })
  const a = liveOf(mesa.id).agents[agent]
  setAgent(mesa.id, agent, { config: a.config.map((c) => (c.id === option ? { ...c, currentValue: value } : c)) })
  emit()
  if (a.status !== 'off' && a.status !== 'error' && a.status !== 'opening') await oficinaApi.config(mesa.id, agent, option, value).catch(() => {})
}

export async function cancel(mesa: string, agent: AgentId) {
  await oficinaApi.cancel(mesa, agent).catch(() => {})
}

export async function closeAgent(mesa: string, agent: AgentId) {
  await oficinaApi.close(mesa, agent).catch(() => {})
  setAgent(mesa, agent, { status: 'off', action: '' })
  busy(mesa, agent, false)
  emit()
}

export function seed(mesa: string, items: Item[]) {
  const m = liveOf(mesa)
  if (m.items.length) return
  m.items = items
  emit()
}
