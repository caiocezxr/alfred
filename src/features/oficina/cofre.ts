import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'
import { api, isTauri } from '../../shared/db/api'

export const SCHEMA = 3

export type Mcp = { id: string; name: string; type: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; on: boolean; note?: string }
export type Account = { id: string; label: string }
export type Flow = 'livre' | 'maivado'

export type Cofre = {
  persona: string | null
  skills: { mode: 'all' | 'pick'; on: string[] }
  mcp: Mcp[]
  claudeAccount: string
  codexAccount: string
  flow: Flow
}

export type Settings = {
  schema: number
  base: string[]
  accounts: { claude: Account[]; codex: Account[] }
  cofres: Record<string, Cofre>
  autoSkills?: boolean
  agents?: CustomAgent[]
}

export type CustomAgent = { id: string; name: string; engine: 'claude' | 'codex' | 'local'; brief: string; model?: string }

export type SkillInfo = { id: string; name: string; description: string; source: 'user' | 'plugin' | 'alfred'; origin: string; path: string; manual?: boolean }

export const BASE_DEFAULT = ['i-have-adhd:i-have-adhd', 'alfred:ponytail', 'alfred:caveman']

const nameOf = (id: string) => id.split(':').pop() ?? id
export const isBase = (s: { id: string; name: string }, base: string[]) => base.some((b) => b === s.id || nameOf(b) === s.name)

export const MCP_PRESETS: Omit<Mcp, 'id' | 'on'>[] = [
  { name: 'playwright', type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], note: 'Navegador: o agente abre, clica e testa páginas' },
  { name: 'context7', type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'], note: 'Documentação atualizada de bibliotecas, na versão certa' },
  { name: 'chrome-devtools', type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], note: 'Console, rede e performance de uma página no Chrome' },
]

const blankCofre = (): Cofre => ({ persona: null, skills: { mode: 'all', on: [] }, mcp: [], claudeAccount: 'default', codexAccount: 'default', flow: 'livre' })

const fresh = (): Settings => ({ schema: SCHEMA, base: BASE_DEFAULT, accounts: { claude: [{ id: 'default', label: 'Conta principal' }], codex: [{ id: 'default', label: 'Conta do Codex instalada' }] }, cofres: {} })

function migrate(raw: unknown): Settings {
  const s = { ...fresh(), ...(raw as Partial<Settings>) }
  if (!s.accounts?.claude?.length) s.accounts = { ...fresh().accounts, ...s.accounts }
  if (!s.accounts.codex?.length) s.accounts.codex = fresh().accounts.codex
  for (const [k, c] of Object.entries(s.cofres ?? {})) s.cofres[k] = { ...blankCofre(), ...c }
  if ((s.schema ?? 0) < 3) s.base = [...s.base, ...BASE_DEFAULT.filter((d) => !s.base.some((b) => nameOf(b) === nameOf(d)))]
  s.schema = SCHEMA
  return s
}

const KEY = 'sessao.settings'
let state: Settings = fresh()
let loaded = false
let ver = 0
const subs = new Set<() => void>()
const emit = () => {
  ver++
  subs.forEach((f) => f())
}

export async function loadSettings() {
  if (loaded) return state
  try {
    const raw = isTauri ? await api.settingGet(KEY) : localStorage.getItem(KEY)
    state = migrate(raw ? JSON.parse(raw) : null)
  } catch {
    state = fresh()
  }
  loaded = true
  emit()
  return state
}

function save() {
  const raw = JSON.stringify(state)
  if (isTauri) void api.settingSet(KEY, raw)
  else localStorage.setItem(KEY, raw)
}

export function useSettings() {
  useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    () => ver,
  )
  return state
}

export const getSettings = () => state

export function cofreOf(companyId: string): Cofre {
  return state.cofres[companyId] ?? blankCofre()
}

export function patchCofre(companyId: string, patch: Partial<Cofre>) {
  state = { ...state, cofres: { ...state.cofres, [companyId]: { ...cofreOf(companyId), ...patch } } }
  save()
  emit()
}

export function patchSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch }
  save()
  emit()
}

export function skillsFor(companyId: string): string[] | null {
  const c = cofreOf(companyId)
  if (c.skills.mode === 'all') return null
  const base = (skillCache ?? []).filter((s) => isBase(s, state.base)).map((s) => s.id)
  return [...new Set([...state.base, ...base, ...c.skills.on])]
}

export async function alwaysOn(): Promise<string> {
  if (!isTauri) return ''
  const ids = (await listSkills().catch(() => [])).filter((s) => isBase(s, state.base)).map((s) => s.id)
  if (!ids.length) return ''
  const list = await invoke<{ id: string; name: string; path: string; body: string }[]>('sessao_skill_bodies', { ids }).catch(() => [])
  if (!list.length) return ''
  const parts: string[] = []
  const seen = new Set<string>()
  let size = 0
  for (const s of list) {
    if (seen.has(s.name)) continue
    seen.add(s.name)
    const part = `### ${s.name}\n(pasta da skill: ${s.path})\n\n${s.body}`
    if (size + part.length > 30000) {
      parts.push(`### ${s.name}\nFicou de fora por tamanho. Se precisar, leia ${s.path}/SKILL.md.`)
      continue
    }
    parts.push(part)
    size += part.length
  }
  return `\n\n## Skills sempre ligadas\nAs skills abaixo valem em toda resposta desta conversa, sem precisar de comando. O idioma continua português do Brasil.\n\n${parts.join('\n\n')}`
}

export function mcpFor(companyId: string) {
  return cofreOf(companyId)
    .mcp.filter((m) => m.on)
    .map((m) => (m.type === 'http' ? { type: 'http', name: m.name, url: m.url, headers: [] } : { name: m.name, command: m.command, args: m.args ?? [], env: [] }))
}

let skillCache: SkillInfo[] | null = null
export async function listSkills(force = false): Promise<SkillInfo[]> {
  if (skillCache && !force) return skillCache
  skillCache = isTauri ? await invoke<SkillInfo[]>('sessao_skills') : []
  emit()
  return skillCache
}
export const cachedSkills = () => skillCache

export const codexHomes = new Map<string, string>()
export async function codexHome(account: string): Promise<string | null> {
  if (!account || account === 'default' || !isTauri) return null
  const hit = codexHomes.get(account)
  if (hit) return hit
  const p = await invoke<string>('sessao_codex_account', { id: account })
  codexHomes.set(account, p)
  return p
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || `conta-${Date.now().toString(36)}`
