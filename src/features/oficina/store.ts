import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSyncExternalStore } from 'react'
import { track } from '../../shared/activity'
import { api, isTauri } from '../../shared/db/api'
import { alwaysOn, cofreOf, codexHome, getSettings, isBase, listSkills, mcpFor, skillsFor } from './cofre'
import { route as routeSkills, type Pick } from './router'

import { AGENT_NAME, deskContext, type AgentId } from './context.ts'
export { AGENT_NAME, type AgentId }
export const AGENTS: AgentId[] = ['claude', 'codex', 'local']
export type LocalModel = { name: string; params: string | null; context: number | null; size: number | null }

export type Mesa = {
  id: string
  companyId: string
  title: string
  cwd: string
  repos: string[]
  agent: AgentId
  flow?: 'livre' | 'maivado'
  isolate?: boolean
  trees?: Partial<Record<AgentId, string>>
  sync?: Partial<Record<AgentId, number>>
  accounts?: Partial<Record<AgentId, string>>
  itemId?: string
  ticket?: string | null
  draft?: string
  sessions: Partial<Record<AgentId, string>>
  prefs: Partial<Record<AgentId, Record<string, string>>>
  createdAt: string
  updatedAt: string
}

export type Option = { value: string; name: string; description?: string }
export type ConfigOption = { id: string; name: string; category?: string; currentValue: string; options: Option[] }
export type PlanEntry = { content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: string }
export type PermOption = { optionId: string; name: string; kind: string }
export type Command = { name: string; description: string }
export type Shot = { mime: string; data: string }

export const PERSONA = `Você é um tech lead brasileiro com mais de 10 anos de experiência em produção: back-end, front-end, banco de dados e infra. Fala com o Caio como parceiro de time no zap: português do Brasil, linguagem de rua, gíria e palavrão quando encaixar natural, sem forçar e sem ser grosseiro com ele.
Direto ao ponto: primeiro a resposta, depois o porquê em poucas linhas. Nada de textão, de enrolação ou de puxar saco. Um passo de cada vez.
Opina com firmeza quando tem certeza, avisa o risco quando vê e diz "não sei" quando não sabe. Nunca inventa nome de arquivo, função, comando, tabela ou biblioteca: confere antes de citar.
Pensa como quem já segurou incidente às 3 da manhã: segurança, dados de cliente, performance e rollback vêm antes de firula. Código é o mínimo que resolve, sem abstração sem uso real, com teste provando o que importa.
Na hora de escrever código, comentário, mensagem de commit ou descrição de PR, é profissional: limpo, sem gíria e sem palavrão.`

export type Item =
  | { id: string; agent: AgentId; role: 'user'; text: string; at: number; skills?: string[]; shared?: number }
  | { id: string; agent: AgentId; role: 'agent'; text: string; at: number; open: boolean; end?: number }
  | { id: string; agent: AgentId; role: 'thought'; text: string; at: number; open: boolean }
  | { id: string; agent: AgentId; role: 'tool'; title: string; kind: string; status: string; files: string[]; at: number }
  | { id: string; agent: AgentId; role: 'perm'; title: string; options: PermOption[]; rpc: unknown; answered: string | null; at: number }
  | { id: string; agent: AgentId; role: 'note'; text: string; tone: 'error' | 'info'; at: number }
  | { id: string; agent: AgentId; role: 'auth'; at: number; done: boolean }
  | { id: string; agent: AgentId; role: 'limit'; at: number; text: string; done: boolean }

export type Edit = { id: string; path: string; old: string; neu: string; at: number; status: string }
export type Output = { id: string; title: string; text: string; at: number }

export type Status = 'off' | 'opening' | 'idle' | 'thinking' | 'writing' | 'tool' | 'waiting' | 'error'

export type Live = {
  status: Status
  action: string
  account: string | null
  config: ConfigOption[]
  plan: PlanEntry[]
  usage: { used: number; size: number; cost: number | null } | null
  files: string[]
  commands: Command[]
  edits: Edit[]
  outputs: Output[]
  since: number | null
  turns: number
  error: string | null
}

type MesaLive = { items: Item[]; agents: Record<AgentId, Live> }

const cachedConfig = (agent: AgentId): ConfigOption[] => {
  try {
    return JSON.parse(localStorage.getItem(`oficina.config.${agent}`) ?? '[]') as ConfigOption[]
  } catch {
    return []
  }
}

const cacheConfig = (agent: AgentId, c: ConfigOption[]) => {
  if (c.length) localStorage.setItem(`oficina.config.${agent}`, JSON.stringify(c))
}

const blank = (agent: AgentId): Live => ({ status: 'off', action: '', account: null, config: cachedConfig(agent), plan: [], usage: null, files: [], commands: [], edits: [], outputs: [], since: null, turns: 0, error: null })

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
    m = { items: [], agents: { claude: blank('claude'), codex: blank('codex'), local: blank('local') } }
    try {
      const saved = JSON.parse(localStorage.getItem(`oficina.local.${id}`) ?? '[]') as Item[]
      if (saved.length) m.items = saved
    } catch {
      m.items = []
    }
    live.set(id, m)
  }
  return m
}

const KEY = 'oficina.mesas'

export async function loadMesas() {
  if (loaded) return
  try {
    const raw = isTauri ? await api.settingGet(KEY) : localStorage.getItem(KEY)
    mesas = raw ? (JSON.parse(raw) as Mesa[]).map((m) => ({ ...m, repos: m.repos ?? (m.cwd ? [m.cwd] : []) })) : []
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

export function createMesa(companyId: string, repos: string[], agent: AgentId): Mesa {
  const now = new Date().toISOString()
  const m: Mesa = { id: crypto.randomUUID(), companyId, title: '', cwd: repos[0] ?? '', repos, agent, sessions: {}, prefs: { claude: { model: 'auto' }, codex: { model: 'auto' }, local: {} }, createdAt: now, updatedAt: now }
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
  if (isTauri) void invoke('oficina_local_cancel', { mesa: id }).catch(() => {})
  localStorage.removeItem(`oficina.local.${id}`)
  if (isTauri && mesas.find((m) => m.id === id)?.trees) void invoke('oficina_worktree_remove', { mesa: id }).catch(() => {})
  mesas = mesas.filter((m) => m.id !== id)
  live.delete(id)
  save()
  emit()
}

const uid = () => Math.random().toString(36).slice(2, 10)

function lastOf(items: Item[], agent: AgentId) {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].agent === agent) return i
  return -1
}

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

const LIMIT = /(usage limit|rate limit|limit reached|hit your limit|reached your|quota|too many requests|5-hour|weekly limit|limite de uso)/i
const LIMIT_MSG = /^\W*(claude ai usage limit reached|you'?ve (hit|reached) your (usage |weekly |5-hour )?limit|(5-hour|weekly|usage) limit reached|limite de uso)/i
const AUTH_MSG = /^\W*(invalid api key|failed to authenticate|oauth (token|session) (has )?expired|please run \/login|not logged in)/i

function capture(mesa: string, agent: AgentId, id: string, u: Record<string, unknown>) {
  const a = liveOf(mesa).agents[agent]
  const content = (u.content as { type?: string; path?: string; oldText?: string | null; newText?: string; content?: { type?: string; text?: string } }[] | undefined) ?? []
  let edits = a.edits
  let outputs = a.outputs
  const raw = (u.rawInput ?? {}) as { file_path?: string; old_string?: string; new_string?: string; content?: string }
  const diffs = content.filter((c) => c.type === 'diff' && c.path)
  const put = (path: string, old: string, neu: string) => {
    const e: Edit = { id, path, old, neu, at: Date.now(), status: (u.status as string) || 'in_progress' }
    const i = edits.findIndex((x) => x.id === id && x.path === path)
    edits = i >= 0 ? edits.map((x, j) => (j === i ? { ...e, at: x.at } : x)) : [...edits, e].slice(-40)
  }
  for (const d of diffs) put(d.path!, d.oldText ?? '', d.newText ?? '')
  if (!diffs.length && raw.file_path && (raw.new_string !== undefined || raw.content !== undefined)) put(raw.file_path, raw.old_string ?? '', raw.new_string ?? raw.content ?? '')
  if (u.status && !diffs.length) edits = edits.map((x) => (x.id === id ? { ...x, status: u.status as string } : x))
  const text = content
    .filter((c) => c.type === 'content' && c.content?.type === 'text')
    .map((c) => c.content!.text ?? '')
    .join('\n')
  if (text && (u.kind === 'execute' || /^(run|bash|exec)/i.test(String(u.title ?? '')))) {
    const o: Output = { id, title: String(u.title ?? 'comando'), text: text.slice(-6000), at: Date.now() }
    const i = outputs.findIndex((x) => x.id === id)
    outputs = i >= 0 ? outputs.map((x, j) => (j === i ? o : x)) : [...outputs, o].slice(-20)
  }
  if (edits !== a.edits || outputs !== a.outputs) setAgent(mesa, agent, { edits, outputs })
}

function limitCard(mesa: string, agent: AgentId, text: string, drop?: string) {
  const m = liveOf(mesa)
  if (drop) m.items = m.items.filter((x) => x.id !== drop)
  if (m.items.filter((x) => x.agent === agent).slice(-4).some((x) => x.role === 'limit' && !x.done)) return
  push(mesa, { id: uid(), agent, role: 'limit', at: Date.now(), text: text.slice(0, 240), done: false })
  setAgent(mesa, agent, { status: 'error', error: 'limite da conta', action: '' })
}

const AUTH_FAIL = /failed to authenticate|oauth session expired|authentication required|please run \/login|not logged in|invalid api key/i

function authCard(mesa: string, agent: AgentId, drop?: string) {
  const m = liveOf(mesa)
  m.items = m.items.filter((x) => x.id !== drop && !(x.agent === agent && x.role === 'note' && AUTH_FAIL.test(x.text)))
  if (!m.items.filter((x) => x.agent === agent).slice(-4).some((x) => x.role === 'auth' && !x.done)) push(mesa, { id: uid(), agent, role: 'auth', at: Date.now(), done: false })
  setAgent(mesa, agent, { status: 'error', error: agent === 'codex' ? 'conta do Codex sem login' : 'login do Claude expirado', action: '' })
}

export function markAuthDone(mesa: string, agent: AgentId) {
  const m = liveOf(mesa)
  m.items = m.items.map((x) => (x.role === 'auth' && x.agent === agent ? { ...x, done: true } : x))
  emit()
}

function apply(ev: Out) {
  const { mesa, agent } = ev
  if (loaded && !mesas.some((x) => x.id === mesa)) return
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
    const li = lastOf(m.items, agent)
    const last = li >= 0 ? m.items[li] : undefined
    const grow = (text: string) => {
      m.items = m.items.map((x, j) => (j === li ? ({ ...x, text: (x as { text: string }).text + text } as Item) : x))
    }
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const role = kind === 'agent_message_chunk' ? 'agent' : 'thought'
      const text = textOf(u.content)
      if (last && last.role === role && last.open) grow(text)
      else push(mesa, { id: uid(), agent, role, text, at: Date.now(), open: true } as Item)
      setAgent(mesa, agent, { status: role === 'agent' ? 'writing' : 'thinking', action: role === 'agent' ? 'escrevendo a resposta' : 'pensando' })
      return
    }
    if (kind === 'user_message_chunk') {
      const text = textOf(u.content)
      if (last && last.role === 'user') grow(text)
      else push(mesa, { id: uid(), agent, role: 'user', text, at: Date.now() })
      return
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const id = u.toolCallId as string
      capture(mesa, agent, id, u)
      const locs = ((u.locations as { path?: string }[] | undefined) ?? []).map((l) => l.path).filter(Boolean) as string[]
      const i = m.items.findIndex((x) => x.role === 'tool' && x.id === id)
      if (i >= 0) {
        const cur = m.items[i] as Extract<Item, { role: 'tool' }>
        const next = { ...cur, title: (u.title as string) || cur.title, status: (u.status as string) || cur.status, files: locs.length ? locs : cur.files }
        m.items = m.items.map((x, j) => (j === i ? next : x))
      } else {
        m.items = m.items.map((x) => (x.role === 'agent' || x.role === 'thought') && x.open && x.agent === agent ? { ...x, open: false, end: Date.now() } : x)
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
      if (opts) {
        cacheConfig(agent, opts)
        setAgent(mesa, agent, { config: opts })
      }
      return
    }
    if (kind === 'available_commands_update') {
      const cmds = (u.availableCommands as { name: string; description?: string }[] | undefined) ?? []
      setAgent(mesa, agent, { commands: cmds.map((c) => ({ name: c.name, description: c.description ?? '' })) })
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
    const k = `${mesa}:${agent}`
    if (agent !== 'local') {
      const want = prompts.get(k)
      if (want !== undefined && ev.data.id !== want) return
      prompts.delete(k)
    }
    if (agent === 'local') queueMicrotask(() => saveLocal(mesa))
    const err = ev.data.error as { message?: string } | undefined
    m.items = m.items.map((x) => (x.role === 'agent' || x.role === 'thought') && x.open && x.agent === agent ? { ...x, open: false, end: Date.now() } : x)
    const said = turnText(m.items, agent)
    if (!err && agent !== 'local' && said && said.text.length < 400) {
      if (AUTH_MSG.test(said.text)) {
        authCard(mesa, agent, said.id)
        setAgent(mesa, agent, { since: null })
        busy(mesa, agent, false)
        return
      }
      if (LIMIT_MSG.test(said.text)) {
        limitCard(mesa, agent, said.text, said.id)
        setAgent(mesa, agent, { since: null })
        busy(mesa, agent, false)
        return
      }
    }
    if (err && agent !== 'local' && AUTH_FAIL.test(err.message ?? '')) {
      authCard(mesa, agent)
      setAgent(mesa, agent, { since: null })
      busy(mesa, agent, false)
      return
    }
    if (err && LIMIT.test(err.message ?? '')) {
      limitCard(mesa, agent, err.message ?? '')
      setAgent(mesa, agent, { since: null })
      busy(mesa, agent, false)
      return
    }
    if (err) push(mesa, { id: uid(), agent, role: 'note', text: err.message ?? 'o agente falhou nesta mensagem', tone: 'error', at: Date.now() })
    if (m.agents[agent].status === 'error' && m.items.some((x) => x.agent === agent && x.role === 'auth' && !x.done)) {
      setAgent(mesa, agent, { since: null })
      busy(mesa, agent, false)
      return
    }
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
    settle(mesa, agent, false)
    prompts.delete(`${mesa}:${agent}`)
    setAgent(mesa, agent, { status: 'off', action: '', since: null })
    busy(mesa, agent, false)
  }
}

const prompts = new Map<string, number>()
const gens = new Map<string, number>()
const gen = (k: string) => gens.get(k) ?? 0

function turnText(items: Item[], agent: AgentId) {
  for (let i = items.length - 1; i >= 0; i--) {
    const x = items[i]
    if (x.agent !== agent) continue
    if (x.role === 'user') return null
    if (x.role === 'agent') return x
  }
  return null
}

function settle(mesa: string, agent: AgentId, reply: boolean) {
  const m = liveOf(mesa)
  for (const x of m.items) if (reply && x.agent === agent && x.role === 'perm' && !x.answered) void oficinaApi.reply(mesa, agent, x.rpc, { outcome: { outcome: 'cancelled' } }).catch(() => {})
  m.items = m.items.map((x) => {
    if (x.agent !== agent) return x
    if (x.role === 'perm' && !x.answered) return { ...x, answered: 'cancelled' }
    if ((x.role === 'agent' || x.role === 'thought') && x.open) return { ...x, open: false, end: Date.now() }
    return x
  })
}

let listening = false
export async function listenOficina() {
  if (listening || !isTauri) return
  listening = true
  await listen<Out>('oficina', (e) => feed(e.payload))
}

let localModels: LocalModel[] | null = null
let localLoading: Promise<LocalModel[]> | null = null

export function loadLocalModels(): Promise<LocalModel[]> {
  if (localModels) return Promise.resolve(localModels)
  localLoading ??= (isTauri ? invoke<LocalModel[]>('oficina_local_models') : Promise.resolve([]))
    .then((l) => {
      localModels = l
      emit()
      return l
    })
    .catch(() => {
      localModels = []
      return []
    })
  return localLoading
}

export const localList = () => localModels ?? []

export function localConfig(): ConfigOption[] {
  const list = localList()
  if (!list.length) return []
  const k = (n: number | null) => (n ? (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)) : '?')
  return [{ id: 'model', name: 'Modelo', category: 'model', currentValue: list[0].name, options: list.map((m) => ({ value: m.name, name: m.name, description: `${m.params ?? ''} · contexto de ${k(m.context)} tokens` })) }]
}

function saveLocal(mesa: string) {
  const items = liveOf(mesa).items.filter((x) => x.agent === 'local' && (x.role === 'user' || x.role === 'agent')).slice(-80)
  localStorage.setItem(`oficina.local.${mesa}`, JSON.stringify(items.map((x) => (x.role === 'agent' ? { ...x, open: false } : x))))
}

export const oficinaApi = {
  status: () => invoke<{ claude: boolean; codex: boolean; open: string[] }>('oficina_status'),
  start: (a: { mesa: string; agent: AgentId; cwd: string; dirs: string[]; persona: string; resume: string | null; codexHome: string | null; skills: string[] | null; mcp: unknown[]; claudeAccount: string | null }) =>
    invoke<{ agent: unknown; session: { sessionId: string; configOptions?: ConfigOption[] } }>('oficina_start', a),
  prompt: (mesa: string, agent: AgentId, text: string, images: Shot[]) => invoke<number>('oficina_prompt', { mesa, agent, text, images }),
  cancel: (mesa: string, agent: AgentId) => invoke<void>('oficina_cancel', { mesa, agent }),
  config: (mesa: string, agent: AgentId, option: string, value: string) => invoke<unknown>('oficina_config', { mesa, agent, option, value }),
  reply: (mesa: string, agent: AgentId, id: unknown, result: unknown) => invoke<void>('oficina_reply', { mesa, agent, id, result }),
  close: (mesa: string, agent: AgentId) => invoke<void>('oficina_close', { mesa, agent }),
}

const opening = new Map<string, Promise<void>>()

export function deskPlace(mesa: Mesa, fallback: string) {
  const repos = mesa.repos.length ? mesa.repos : []
  return { cwd: repos[0] ?? fallback, dirs: repos.slice(1) }
}

async function placeFor(mesa0: Mesa, agent: AgentId, fallback: string) {
  const mesa = mesas.find((x) => x.id === mesa0.id) ?? mesa0
  const place = deskPlace(mesa, fallback)
  if (!mesa.isolate || !isTauri || !mesa.repos.length) return place
  const made: string[] = []
  let branch = ''
  const all = await Promise.all(
    [place.cwd, ...place.dirs].map((repo) =>
      invoke<{ path: string; branch: string; created: boolean }>('oficina_worktree', { mesa: mesa.id, agent, repo })
        .then((w) => {
          if (w.branch) branch = w.branch
          if (w.created) made.push(base(repo))
          return w.path
        })
        .catch((e) => {
          throw new Error(`não deu para criar a cópia isolada de ${base(repo)}: ${e instanceof Error ? e.message : String(e)}`)
        }),
    ),
  )
  if (branch && mesas.find((x) => x.id === mesa.id)?.trees?.[agent] !== branch) patchMesa(mesa.id, { trees: { ...(mesas.find((x) => x.id === mesa.id)?.trees ?? {}), [agent]: branch } })
  if (made.length) push(mesa.id, { id: uid(), agent, role: 'note', text: `O ${AGENT_NAME[agent]} trabalha numa cópia isolada de ${made.join(' + ')}, na branch ${branch}. Nada muda na sua pasta até você juntar essa branch.`, tone: 'info', at: Date.now() })
  return { cwd: all[0], dirs: all.slice(1) }
}

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export async function setIsolate(mesa: Mesa, on: boolean) {
  for (const a of AGENTS) if (a !== 'local' && liveOf(mesa.id).agents[a].status !== 'off') await closeAgent(mesa.id, a)
  const { claude: _c, codex: _x, ...rest } = mesas.find((x) => x.id === mesa.id)?.sessions ?? {}
  patchMesa(mesa.id, { isolate: on, sessions: rest })
  push(mesa.id, { id: uid(), agent: mesa.agent, role: 'note', text: on ? 'Agentes isolados: cada um trabalha na própria branch. A próxima mensagem abre sessões novas, já na cópia isolada.' : 'Agentes de volta à pasta do repositório. A próxima mensagem abre sessões novas, sem o contexto anterior.', tone: 'info', at: Date.now() })
  emit()
}

export function personaText(companyId?: string) {
  return (companyId ? cofreOf(companyId).persona : null) ?? PERSONA
}

export async function skillIndex(companyId: string) {
  const all = await listSkills().catch(() => [])
  const allowed = skillsFor(companyId)
  const list = all.filter((s) => !s.manual && (allowed === null || allowed.includes(s.id)))
  if (!list.length) return ''
  const lines: string[] = []
  let size = 0
  for (const s of list) {
    const line = `- ${s.name}: ${s.description.replace(/\s+/g, ' ').slice(0, 140)} (${s.path}/SKILL.md)`
    if (size + line.length > 9000) break
    lines.push(line)
    size += line.length
  }
  return `\n\nSkills disponíveis neste perfil. Quando um pedido combinar com uma delas, leia o SKILL.md indicado e siga as instruções antes de começar:\n${lines.join('\n')}`
}

export function accountOf(mesa: Mesa, agent: AgentId) {
  const c = cofreOf(mesa.companyId)
  return mesa.accounts?.[agent] ?? (agent === 'claude' ? c.claudeAccount : agent === 'codex' ? c.codexAccount : 'default')
}

export function ensureAgent(mesa: Mesa, agent: AgentId, codexHome_: string | null, fallback: string): Promise<void> {
  if (agent === 'local') {
    return loadLocalModels().then((l) => {
      setAgent(mesa.id, agent, l.length ? { status: 'idle', config: localConfig(), account: 'Ollama · nesta máquina' } : { status: 'error', error: 'o Ollama não está rodando ou não tem modelos' })
      emit()
    })
  }
  const k = `${mesa.id}:${agent}`
  const st = liveOf(mesa.id).agents[agent].status
  if (st !== 'off' && st !== 'error') return opening.get(k) ?? Promise.resolve()
  const g = gen(k)
  const stale = () => gen(k) !== g
  const p = (async () => {
    setAgent(mesa.id, agent, { status: 'opening', action: 'abrindo o agente', error: null })
    emit()
    try {
      const place = await placeFor(mesa, agent, fallback)
      const acct = accountOf(mesa, agent)
      const home = agent === 'codex' ? ((await codexHome(acct)) ?? codexHome_) : null
      const r = await oficinaApi.start({
        mesa: mesa.id,
        agent,
        cwd: place.cwd,
        dirs: place.dirs,
        persona: personaText(mesa.companyId) + (await alwaysOn()) + (agent === 'codex' ? await skillIndex(mesa.companyId) : ''),
        resume: mesa.sessions[agent] ?? null,
        codexHome: home,
        skills: agent === 'claude' ? skillsFor(mesa.companyId) : null,
        mcp: mcpFor(mesa.companyId),
        claudeAccount: agent === 'claude' ? acct : null,
      })
      if (stale()) return
      const sid = r.session.sessionId
      const lost = (r.session as { resumeFailed?: string }).resumeFailed
      if (lost) push(mesa.id, { id: uid(), agent, role: 'note', text: `Não deu para retomar a conversa anterior do ${AGENT_NAME[agent]} (${lost}). Abri uma sessão nova.`, tone: 'info', at: Date.now() })
      if (mesa.sessions[agent] !== sid) patchMesa(mesa.id, { sessions: { ...mesas.find((x) => x.id === mesa.id)?.sessions, [agent]: sid } })
      const cfg = r.session.configOptions ?? liveOf(mesa.id).agents[agent].config
      cacheConfig(agent, cfg)
      setAgent(mesa.id, agent, { status: 'idle', action: '', config: cfg })
      const prefs = mesas.find((x) => x.id === mesa.id)?.prefs[agent] ?? {}
      for (const [opt, val] of Object.entries(prefs)) if (val !== 'auto') await oficinaApi.config(mesa.id, agent, opt, val).catch(() => {})
    } catch (e) {
      if (stale()) return
      const msg = e instanceof Error ? e.message : String(e)
      if (AUTH_FAIL.test(msg)) authCard(mesa.id, agent)
      else {
        setAgent(mesa.id, agent, { status: 'error', error: msg, action: '' })
        push(mesa.id, { id: uid(), agent, role: 'note', text: msg, tone: 'error', at: Date.now() })
      }
    } finally {
      if (!stale()) opening.delete(k)
      emit()
    }
  })()
  opening.set(k, p)
  return p
}

const MODEL_KEY: Record<AgentId, string> = { claude: 'model', codex: 'model', local: 'model' }
const EFFORT_KEY: Record<AgentId, string> = { claude: 'effort', codex: 'reasoning_effort', local: 'effort' }
export const effortKey = (agent: AgentId) => EFFORT_KEY[agent]

const RISK = /(segurança|seguranca|vazamento|vaza|tenant|isolamento|multi-?tenant|pagamento|cobran|financeir|dinheiro|saldo|token|senha|credencial|lgpd|auth|permiss[aã]o|webhook|produ[cç][aã]o caiu|incidente)/i
const BIG = /(arquitet|planej|refator|migra|investig|bug|erro|exce[cç][aã]o|stack ?trace|performance|lent|concorr|race|deadlock|desenh|spec|design|integra|banco de dados|query|sql)/i
const SMALL = /^(explica|o que [eé]|renomeia|traduz|resume|resumo|ajusta (o )?texto|corrige (o )?typo|mensagem de commit|lista|mostra|qual|como)/i

export type Route = { model: string; effort: string; why: string }

export function route(agent: AgentId, text: string, repos: number): Route {
  const t = text.trim()
  const pick = (c: string, x: string, e: string, why: string): Route => ({ model: agent === 'claude' ? c : x, effort: e, why })
  if (RISK.test(t)) return pick('claude-fable-5-1[1m]', 'gpt-6.1-sol', 'xhigh', 'mexe com risco (segurança, dinheiro ou dado de cliente)')
  if (BIG.test(t) || t.length > 700 || repos > 1) return pick('opus', 'gpt-6.1-sol', 'high', repos > 1 ? 'envolve mais de um repositório' : 'tarefa de raciocínio pesado')
  if (SMALL.test(t) && t.length < 220) return pick('haiku', 'gpt-6.1-sol', 'low', 'pedido rápido')
  return pick('sonnet', 'gpt-6.1-sol', 'medium', 'tarefa do dia a dia')
}

function withSkills(agent: AgentId, text: string, picks: Pick[]) {
  if (!picks.length || agent === 'local' || text.startsWith('/')) return text
  if (agent === 'claude') return `[Shed: para este pedido, use as skills ${picks.map((p) => p.id).join(', ')} com a ferramenta Skill antes de começar.]\n\n${text}`
  return `[Shed: antes de começar, leia e siga estas instruções: ${picks.map((p) => `${p.path}/SKILL.md`).join(', ')}]\n\n${text}`
}

const BUSY = new Set<Status>(['opening', 'thinking', 'writing', 'tool', 'waiting'])
export const isBusy = (mesa: string, agent: AgentId) => BUSY.has(liveOf(mesa).agents[agent].status)

export async function send(mesa: Mesa, agent: AgentId, text0: string, images: Shot[], codexHome: string | null, fallback: string, picks?: Pick[], share = true) {
  if (isBusy(mesa.id, agent)) {
    push(mesa.id, { id: uid(), agent, role: 'note', text: `O ${AGENT_NAME[agent]} ainda está trabalhando. Espere terminar ou pare (Esc) antes de mandar outra.`, tone: 'info', at: Date.now() })
    emit()
    return
  }
  const flow = mesa.flow ?? cofreOf(mesa.companyId).flow
  const maivado = flow === 'maivado' && agent === 'claude' && !mesa.sessions.claude && text0 && !text0.startsWith('/')
  const chosen = (maivado ? [] : (picks ?? (getSettings().autoSkills === false ? [] : await routeSkills(text0, mesa.repos, mesa.companyId).catch(() => [])))).filter((p) => !isBase(p, getSettings().base))
  const command = maivado || text0.startsWith('/')
  const now = Date.now()
  const cur = mesas.find((x) => x.id === mesa.id) ?? mesa
  const desk = share && !command ? deskContext(liveOf(mesa.id).items, agent, cur.sync?.[agent] ?? 0) : { text: '', count: 0 }
  if (!command) patchMesa(mesa.id, { sync: { ...(cur.sync ?? {}), [agent]: now } })
  const text = maivado ? `/maivado ${text0}` : desk.text + withSkills(agent, text0, chosen)
  const shown = images.length ? `${text0}${text0 ? '\n' : ''}[${images.length} imagem${images.length > 1 ? 's' : ''}]` : text0
  push(mesa.id, { id: uid(), agent, role: 'user', text: maivado ? `/maivado ${text0}` : shown, at: now, skills: chosen.map((p) => p.name), shared: desk.count || undefined })
  if (!mesa.title && text0) patchMesa(mesa.id, { title: text0.split('\n')[0].slice(0, 70) })
  emit()
  await ensureAgent(mesa, agent, codexHome, fallback)
  if (liveOf(mesa.id).agents[agent].status === 'error') return
  const prefs = mesas.find((x) => x.id === mesa.id)?.prefs[agent] ?? {}
  if (agent === 'local') {
    const list = localList()
    const model = list.find((m) => m.name === prefs.model)?.name ?? list[0]?.name
    const ctx = list.find((m) => m.name === model)?.context ?? null
    const history = liveOf(mesa.id).items.filter((x) => x.agent === 'local' && (x.role === 'user' || x.role === 'agent')).map((x) => ({ role: x.role === 'agent' ? 'assistant' : 'user', content: (x as { text: string }).text }))
    if (desk.text && history.length) history[history.length - 1].content = desk.text + history[history.length - 1].content
    setAgent(mesa.id, agent, { status: 'thinking', action: `carregando ${model}`, since: Date.now() })
    busy(mesa.id, agent, true)
    emit()
    await invoke('oficina_local_chat', { mesa: mesa.id, model, messages: history, persona: personaText(), context: ctx }).catch((e) => {
      push(mesa.id, { id: uid(), agent, role: 'note', text: e instanceof Error ? e.message : String(e), tone: 'error', at: Date.now() })
      setAgent(mesa.id, agent, { status: 'idle', since: null })
      busy(mesa.id, agent, false)
      emit()
    })
    return
  }
  if ((prefs.model ?? 'auto') === 'auto') {
    const r = route(agent, text, mesa.repos.length)
    const cfg = liveOf(mesa.id).agents[agent].config
    const match = (id: string, v: string) => cfg.find((c) => c.id === id)?.options.find((o) => o.value === v || o.value.startsWith(`${v}[`))?.value
    const has = (id: string, v: string) => !!match(id, v)
    const model = match(MODEL_KEY[agent], r.model)
    if (model) await oficinaApi.config(mesa.id, agent, MODEL_KEY[agent], model).catch(() => {})
    if (!prefs[EFFORT_KEY[agent]] && has(EFFORT_KEY[agent], r.effort)) await oficinaApi.config(mesa.id, agent, EFFORT_KEY[agent], r.effort).catch(() => {})
    const name = cfg.find((c) => c.id === MODEL_KEY[agent])?.options.find((o) => o.value === model)?.name ?? r.model
    const PT: Record<string, string> = { low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'muito alto', max: 'máximo', ultra: 'ultra' }
    const eff = prefs[EFFORT_KEY[agent]] ?? r.effort
    push(mesa.id, { id: uid(), agent, role: 'note', text: `Auto: ${name} · esforço ${PT[eff] ?? eff}, porque é ${r.why}`, tone: 'info', at: Date.now() })
  }
  setAgent(mesa.id, agent, { status: 'thinking', action: 'lendo o pedido', since: Date.now() })
  busy(mesa.id, agent, true)
  emit()
  try {
    prompts.set(`${mesa.id}:${agent}`, await oficinaApi.prompt(mesa.id, agent, text, images))
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
  await oficinaApi.reply(mesa, agent, it.rpc, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } }).catch(() => {
    setAgent(mesa, agent, { status: 'off', action: '' })
    push(mesa, { id: uid(), agent, role: 'note', text: `O ${AGENT_NAME[agent]} já tinha fechado. Mande a mensagem de novo.`, tone: 'error', at: Date.now() })
    emit()
  })
}

export async function setOption(mesa: Mesa, agent: AgentId, option: string, value: string | null) {
  const cur = { ...(mesas.find((x) => x.id === mesa.id)?.prefs[agent] ?? {}) }
  if (value === null) delete cur[option]
  else cur[option] = value
  patchMesa(mesa.id, { prefs: { ...mesa.prefs, [agent]: cur } })
  const a = liveOf(mesa.id).agents[agent]
  if (value && value !== 'auto') setAgent(mesa.id, agent, { config: a.config.map((c) => (c.id === option ? { ...c, currentValue: value } : c)) })
  emit()
  if (agent !== 'local' && value && value !== 'auto' && a.status !== 'off' && a.status !== 'error' && a.status !== 'opening') await oficinaApi.config(mesa.id, agent, option, value).catch(() => {})
}

export async function switchAccount(mesa: Mesa, agent: AgentId, account: string, itemId: string, fallback: string) {
  const m = liveOf(mesa.id)
  m.items = m.items.map((x) => (x.id === itemId && x.role === 'limit' ? { ...x, done: true } : x))
  patchMesa(mesa.id, { accounts: { ...(mesa.accounts ?? {}), [agent]: account } })
  await closeAgent(mesa.id, agent)
  const last = [...m.items].reverse().find((x) => x.agent === agent && x.role === 'user') as { text: string } | undefined
  const label = getSettings().accounts[agent === 'codex' ? 'codex' : 'claude'].find((a) => a.id === account)?.label ?? account
  push(mesa.id, { id: uid(), agent, role: 'note', text: `Trocou para ${label}. Continuando a mesma conversa.`, tone: 'info', at: Date.now() })
  emit()
  const fresh = mesas.find((x) => x.id === mesa.id) ?? mesa
  if (last) await send(fresh, agent, 'Continua de onde parou. O limite da conta anterior estourou no meio da tarefa.', [], null, fallback, [])
}

function recap(mesa: string, from: AgentId) {
  const m = liveOf(mesa)
  const talk = m.items
    .filter((x) => (x.role === 'user' || x.role === 'agent') && x.agent === from)
    .slice(-8)
    .map((x) => `${x.role === 'user' ? 'Caio' : AGENT_NAME[from]}: ${(x as { text: string }).text.slice(0, 1500)}`)
    .join('\n\n')
  const a = m.agents[from]
  const files = [...new Set([...a.files, ...a.edits.map((e) => e.path)])]
  const plan = a.plan.map((p) => `- [${p.status === 'completed' ? 'x' : ' '}] ${p.content}`).join('\n')
  return { talk, files, plan }
}

export async function handoff(mesa: Mesa, from: AgentId, to: AgentId, kind: 'review' | 'continue', fallback: string) {
  const r = recap(mesa.id, from)
  const head =
    kind === 'review'
      ? `Revisão cruzada. O ${AGENT_NAME[from]} trabalhou nesta tarefa. Revise criticamente o que ele fez: bugs, escopo além do pedido, nomes inventados, riscos de segurança e testes que não provam nada. Leia os arquivos antes de opinar. Não edite nada, só aponte com caminho:linha.`
      : `Passagem de bastão. O ${AGENT_NAME[from]} estava nesta tarefa e você continua daqui, sem refazer o que já está pronto. Confira o estado dos arquivos antes de mexer.`
  const branch = (mesas.find((x) => x.id === mesa.id) ?? mesa).isolate ? mesa.trees?.[from] : undefined
  const iso = branch && `Atenção: os agentes estão isolados. O ${AGENT_NAME[from]} trabalhou na cópia dele, na branch ${branch}, e os caminhos acima são dessa cópia. ${kind === 'review' ? 'Leia os arquivos de lá.' : 'Antes de continuar, traga o trabalho dele para a sua cópia (commit lá e merge dessa branch aqui).'}`
  const body = [head, r.plan && `Plano:\n${r.plan}`, r.files.length && `Arquivos mexidos:\n${r.files.map((f) => `- ${f}`).join('\n')}`, iso, r.talk && `Conversa recente:\n${r.talk}`].filter(Boolean).join('\n\n')
  await send(mesa, to, body, [], null, fallback, [], false)
}

export async function setRepos(mesa: Mesa, repos: string[]) {
  const cur = mesas.find((x) => x.id === mesa.id) ?? mesa
  const moved = (repos[0] ?? '') !== (cur.repos[0] ?? '')
  const sessions = { ...cur.sessions }
  if (moved) {
    delete sessions.claude
    delete sessions.codex
  }
  patchMesa(mesa.id, { repos, cwd: repos[0] ?? '', sessions })
  for (const a of AGENTS) if (liveOf(mesa.id).agents[a].status !== 'off') await closeAgent(mesa.id, a)
}

export async function freshSession(mesa: Mesa, agent: AgentId) {
  if (agent === 'local') {
    localStorage.removeItem(`oficina.local.${mesa.id}`)
    const m = liveOf(mesa.id)
    m.items = m.items.filter((x) => x.agent !== 'local')
  }
  await closeAgent(mesa.id, agent)
  const sessions = { ...(mesas.find((x) => x.id === mesa.id)?.sessions ?? {}) }
  delete sessions[agent]
  patchMesa(mesa.id, { sessions })
  setAgent(mesa.id, agent, { usage: null, plan: [], files: [] })
  push(mesa.id, { id: uid(), agent, role: 'note', text: `Sessão nova do ${AGENT_NAME[agent]}: o contexto começa do zero na próxima mensagem.`, tone: 'info', at: Date.now() })
  emit()
}

export async function cancel(mesa: string, agent: AgentId) {
  if (agent === 'local') return void (await invoke('oficina_local_cancel', { mesa }).catch(() => {}))
  settle(mesa, agent, true)
  emit()
  await oficinaApi.cancel(mesa, agent).catch(() => {})
}

export async function closeAgent(mesa: string, agent: AgentId) {
  const k = `${mesa}:${agent}`
  gens.set(k, gen(k) + 1)
  opening.delete(k)
  prompts.delete(k)
  if (agent !== 'local') await oficinaApi.close(mesa, agent).catch(() => {})
  settle(mesa, agent, false)
  setAgent(mesa, agent, { status: 'off', action: '' })
  busy(mesa, agent, false)
  emit()
}

export function seed(mesa: string, items: Item[]) {
  const m = liveOf(mesa)
  if (m.items.some((x) => x.agent !== 'local')) return
  m.items = items
  emit()
}
