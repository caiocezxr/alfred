import { invoke } from '@tauri-apps/api/core'
import { useEffect, useSyncExternalStore } from 'react'
import { api, isTauri } from '../../../shared/db/api'

export type GhAccount = { login: string; active: boolean; ok: boolean; scopes: string }
export type Check = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null
export type Pr = {
  number: number
  title: string
  url: string
  isDraft: boolean
  updatedAt: string
  headRefName: string
  baseRefName: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  additions: number
  deletions: number
  repository: { nameWithOwner: string }
  author: { login: string } | null
  commits: { nodes: { commit: { statusCheckRollup: { state: Check } | null } }[] }
  comments?: { totalCount: number; nodes: { author: { login: string; avatarUrl: string } | null; bodyText: string; createdAt: string }[] }
  reviews?: { nodes: { author: { login: string; avatarUrl: string } | null; state: string; bodyText: string; submittedAt: string | null; comments: { totalCount: number } }[] }
}
export type Issue = { number: number; title: string; url: string; updatedAt: string; repository: { nameWithOwner: string }; labels: { nodes: { name: string; color: string }[] } }
export type Dashboard = {
  viewer: { login: string; name: string | null; avatarUrl: string; databaseId: number }
  mine: { nodes: Pr[] }
  review: { nodes: Pr[] }
  issues: { nodes: Issue[] }
}
export type Repo = { nameWithOwner: string; isPrivate: boolean; pushedAt: string; defaultBranchRef: { name: string } | null }
export type Branches = {
  repository: {
    defaultBranchRef: { name: string } | null
    refs: { nodes: { name: string; target: { committedDate?: string; messageHeadline?: string } }[] }
    pullRequests: { nodes: { number: number; headRefName: string; url: string }[] }
  }
}
export type CheckCtx = { __typename: 'CheckRun'; name: string; conclusion: string | null; status: string; detailsUrl: string | null } | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null }
export type PrDetail = {
  pr: {
    number: number
    title: string
    url: string
    state: 'OPEN' | 'CLOSED' | 'MERGED'
    isDraft: boolean
    merged: boolean
    mergeable: Pr['mergeable']
    reviewDecision: Pr['reviewDecision']
    headRefName: string
    baseRefName: string
    additions: number
    deletions: number
    changedFiles: number
    createdAt: string
    bodyHTML: string
    author: { login: string; avatarUrl: string } | null
    commits: { nodes: { commit: { oid: string; statusCheckRollup: { state: Check; contexts: { nodes: CheckCtx[] } } | null } }[] }
    reviews: { nodes: { author: { login: string; avatarUrl: string } | null; state: string; submittedAt: string; bodyText: string }[] }
    comments: { nodes: { author: { login: string; avatarUrl: string } | null; bodyText: string; createdAt: string }[] }
  }
  files: { filename: string; status: string; additions: number; deletions: number; patch: string }[]
}

export type LocalRepo = {
  path: string
  name: string
  remote: string | null
  repo: string | null
  ssh: boolean
  branch: string | null
  nameCfg: string | null
  emailCfg: string | null
  emailLocal: boolean
  account: string | null
}

const need = () => {
  if (!isTauri) throw new Error('A integração com o GitHub roda no app, com o GitHub CLI instalado.')
}

const friendly = (e: unknown) => {
  const msg = String(e instanceof Error ? e.message : e)
  return new Error(msg.replace(/^\[[a-z-]+\]\s*/, ''))
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  need()
  try {
    return await invoke<T>(cmd, args)
  } catch (e) {
    throw friendly(e)
  }
}

export const gh = {
  accounts: () => call<GhAccount[]>('github_accounts'),
  switchTo: (login: string) => call<GhAccount[]>('github_switch', { login }),
  dashboard: (login: string) => call<Dashboard>('github_dashboard', { login }),
  repos: async (login: string) => (await call<{ viewer: { repositories: { nodes: Repo[] } } }>('github_repos', { login })).viewer.repositories.nodes,
  branches: (login: string, repo: string) => call<Branches>('github_branches', { login, repo }),
  createPr: (login: string, repo: string, head: string, base: string, title: string, body: string, draft: boolean) =>
    call<{ number: number; url: string }>('github_pr_create', { login, repo, head, base, title, body, draft }),
  mergePr: (login: string, repo: string, number: number, method = 'squash') => call<{ merged: boolean; message: string }>('github_pr_merge', { login, repo, number, method }),
  prDetail: (login: string, repo: string, number: number) => call<PrDetail>('github_pr_detail', { login, repo, number }),
  review: (login: string, repo: string, number: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body = '') => call<{ state: string }>('github_pr_review', { login, repo, number, event, body }),
  scan: (base: string) => call<LocalRepo[]>('github_local_scan', { base }),
  applyIdentity: (path: string, login: string, name: string, email: string) => call<LocalRepo>('github_identity_apply', { path, login, name, email }),
}

export type Person = { name: string; email: string }
export type GhSettings = { stations: Record<string, string>; people: Record<string, Person>; repos: Record<string, string>; base: string }

const KEY = 'ps.github.v1'
const SETTING = 'github.settings'
const DEFAULT: GhSettings = { stations: {}, people: {}, repos: {}, base: '~/Projetos' }

let state: GhSettings = (() => {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}) }
  } catch {
    return DEFAULT
  }
})()
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  listeners.forEach((l) => l())
}

void api
  .settingGet(SETTING)
  .then((raw) => {
    if (!raw) return
    state = { ...DEFAULT, ...JSON.parse(raw) }
    emit()
  })
  .catch(() => {})

export const getGh = () => state

export function setGh(patch: Partial<GhSettings>) {
  state = { ...state, ...patch }
  const raw = JSON.stringify(state)
  try {
    localStorage.setItem(KEY, raw)
  } catch {}
  void api.settingSet(SETTING, raw).catch(() => {})
  emit()
}

export function useGhSettings() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => version,
  )
  return state
}

export const checkOf = (p: Pr): Check => p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null
export const noreply = (d: Dashboard['viewer']) => `${d.databaseId}+${d.login}@users.noreply.github.com`

const boards = new Map<string, { at: number; data: Dashboard }>()
const loadingBoards = new Map<string, Promise<Dashboard>>()
let boardVer = 0
const boardSubs = new Set<() => void>()
const boardEmit = () => {
  boardVer++
  boardSubs.forEach((f) => f())
}

export const boardOf = (login: string) => boards.get(login)?.data ?? null

export function dropBoard(login: string) {
  boards.delete(login)
  boardEmit()
}

export async function loadBoard(login: string, force = false): Promise<Dashboard> {
  const hit = boards.get(login)
  if (hit && !force && Date.now() - hit.at < 180_000) return hit.data
  const running = loadingBoards.get(login)
  if (running) return running
  const p = gh
    .dashboard(login)
    .then((d) => {
      boards.set(login, { at: Date.now(), data: d })
      boardEmit()
      return d
    })
    .finally(() => loadingBoards.delete(login))
  loadingBoards.set(login, p)
  return p
}

export function useBoards(logins: string[]) {
  useSyncExternalStore(
    (fn) => {
      boardSubs.add(fn)
      return () => boardSubs.delete(fn)
    },
    () => boardVer,
  )
  const key = [...new Set(logins)].sort().join(',')
  useEffect(() => {
    if (!key) return
    const run = () => key.split(',').forEach((l) => void loadBoard(l).catch(() => {}))
    run()
    const id = window.setInterval(run, 180_000)
    return () => window.clearInterval(id)
  }, [key])
  return key ? key.split(',').map((l) => ({ login: l, data: boardOf(l) })) : []
}

export type LivePr = { pr: Pr; login: string; review: boolean }

export function livePrs(list: { login: string; data: Dashboard | null }[]): LivePr[] {
  const out: LivePr[] = []
  for (const { login, data } of list) {
    if (!data) continue
    for (const pr of data.mine.nodes) out.push({ pr, login, review: false })
    for (const pr of data.review.nodes) out.push({ pr, login, review: true })
  }
  return out
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function linkPr(item: { ticket?: string | null; url?: string | null }, prs: LivePr[]): LivePr | null {
  if (item.url) {
    const hit = prs.find((p) => p.pr.url === item.url)
    if (hit) return hit
  }
  const raw = item.ticket?.trim()
  if (!raw) return null
  const t = raw.replace(/^#/, '')
  if (t.length < 2) return null
  const re = new RegExp(`(^|[^A-Za-z0-9])${esc(t)}([^A-Za-z0-9]|$)`, 'i')
  return prs.find((p) => !p.review && (re.test(p.pr.title) || re.test(p.pr.headRefName))) ?? prs.find((p) => re.test(p.pr.title) || re.test(p.pr.headRefName)) ?? null
}

export type OpenPr = { login: string; repo: string; number: number; review: boolean }

export function openPr(p: OpenPr) {
  window.dispatchEvent(new CustomEvent<OpenPr>('gh:open-pr', { detail: p }))
}

export const prOpen = (l: LivePr): OpenPr => ({ login: l.login, repo: l.pr.repository.nameWithOwner, number: l.pr.number, review: l.review })

export const CHECK_SHORT: Record<string, string> = { SUCCESS: 'checks ok', FAILURE: 'checks falhando', ERROR: 'checks com erro', PENDING: 'checks rodando', EXPECTED: 'checks esperando' }

export type Talk = { who: string; avatar: string | null; text: string; at: string; kind: 'comment' | 'changes' | 'review' | 'approved' }

const SEEN_KEY = 'gh.seen.v1'
const SINCE_KEY = 'gh.seen.since'
let seenVer = 0
const seenSubs = new Set<() => void>()

function seenMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function seenSince(): string {
  let v = localStorage.getItem(SINCE_KEY)
  if (!v) {
    v = new Date(Date.now() - 3 * 86400_000).toISOString()
    localStorage.setItem(SINCE_KEY, v)
  }
  return v
}

export function markSeen(repo: string, number: number) {
  const m = seenMap()
  m[`${repo}#${number}`] = new Date().toISOString()
  const keys = Object.keys(m)
  if (keys.length > 400) keys.sort((a, b) => m[a].localeCompare(m[b])).slice(0, keys.length - 400).forEach((k) => delete m[k])
  localStorage.setItem(SEEN_KEY, JSON.stringify(m))
  seenVer++
  seenSubs.forEach((f) => f())
}

export function useSeen() {
  return useSyncExternalStore(
    (fn) => {
      seenSubs.add(fn)
      return () => seenSubs.delete(fn)
    },
    () => seenVer,
  )
}

export function talkOf(pr: Pr, me: string): Talk[] {
  const since = seenMap()[`${pr.repository.nameWithOwner}#${pr.number}`] ?? seenSince()
  const out: Talk[] = []
  for (const c of pr.comments?.nodes ?? []) {
    if (!c.author || c.author.login === me || c.author.login.endsWith('[bot]') || c.createdAt <= since) continue
    out.push({ who: c.author.login, avatar: c.author.avatarUrl, text: c.bodyText, at: c.createdAt, kind: 'comment' })
  }
  for (const r of pr.reviews?.nodes ?? []) {
    if (!r.author || !r.submittedAt || r.author.login === me || r.author.login.endsWith('[bot]') || r.submittedAt <= since) continue
    const kind = r.state === 'CHANGES_REQUESTED' ? 'changes' : r.state === 'APPROVED' ? 'approved' : 'review'
    if (kind === 'review' && !r.bodyText.trim() && !r.comments.totalCount) continue
    const text = r.bodyText.trim() || (r.comments.totalCount ? `${r.comments.totalCount} comentário${r.comments.totalCount > 1 ? 's' : ''} no código` : kind === 'approved' ? 'aprovou' : 'pediu ajustes')
    out.push({ who: r.author.login, avatar: r.author.avatarUrl, text, at: r.submittedAt, kind })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}
