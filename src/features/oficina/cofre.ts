import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'
import { api, isTauri } from '../../shared/db/api'

export const SCHEMA = 2

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
}

export type SkillInfo = { id: string; name: string; description: string; source: 'user' | 'plugin' | 'alfred'; origin: string; path: string }

export const BASE_DEFAULT = ['i-have-adhd:i-have-adhd', 'ponytail:ponytail']

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
  return [...new Set([...state.base, ...c.skills.on])]
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
