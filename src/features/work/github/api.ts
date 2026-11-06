import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'
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
