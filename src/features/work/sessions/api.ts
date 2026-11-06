import { invoke } from '@tauri-apps/api/core'
import { useEffect, useSyncExternalStore } from 'react'
import { isTauri } from '../../../shared/db/api'
import type { GhSettings, LivePr } from '../github/api'
import { PERSONAL_ID, type Company } from '../types'

export type SessionPr = { number: number; url: string; repo: string }
export type Session = {
  id: string
  tool: 'claude' | 'codex'
  cwd: string | null
  project: string | null
  repo: string | null
  branch: string | null
  title: string | null
  firstPrompt: string | null
  lastPrompt: string | null
  started: string | null
  updated: string
  prompts: number
  prs: SessionPr[]
  cost: number | null
  linesAdded: number | null
  linesRemoved: number | null
  bytes: number
}
export type Turn = { role: 'user' | 'assistant' | 'tools'; text: string; at: string | null; tools: string[] }

const call = async <T,>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
  if (!isTauri) throw new Error('As sessões locais aparecem no app instalado.')
  try {
    return await invoke<T>(cmd, args)
  } catch (e) {
    throw new Error(String(e instanceof Error ? e.message : e))
  }
}

export const sx = {
  list: () => call<Session[]>('sessions_list'),
  read: (tool: string, id: string) => call<Turn[]>('sessions_read', { tool, id }),
  resume: (tool: string, id: string, cwd: string) => call<void>('sessions_resume', { tool, id, cwd }),
}

let data: Session[] | null = null
let error: string | null = null
let loading: Promise<void> | null = null
let ver = 0
const subs = new Set<() => void>()
const bump = () => {
  ver++
  subs.forEach((f) => f())
}

export function refreshSessions() {
  if (loading) return loading
  loading = sx
    .list()
    .then((d) => {
      data = d
      error = null
    })
    .catch((e) => {
      error = e instanceof Error ? e.message : String(e)
    })
    .finally(() => {
      loading = null
      bump()
    })
  return loading
}

export function useSessions() {
  useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    () => ver,
  )
  useEffect(() => {
    void refreshSessions()
    const id = window.setInterval(() => void refreshSessions(), 60_000)
    const focus = () => void refreshSessions()
    window.addEventListener('focus', focus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', focus)
    }
  }, [])
  return { sessions: data, error, loading: !!loading && !data }
}

export function liveOf(s: Session, live: LivePr[]): LivePr | null {
  for (const p of s.prs) {
    const hit = live.find((l) => l.pr.url === p.url || (l.pr.number === p.number && l.pr.repository.nameWithOwner.toLowerCase() === p.repo.toLowerCase()))
    if (hit) return hit
  }
  if (s.repo && s.branch) {
    const repo = s.repo.toLowerCase()
    return live.find((l) => l.pr.repository.nameWithOwner.toLowerCase() === repo && l.pr.headRefName === s.branch) ?? null
  }
  return null
}

export function sessionsOfPr(list: Session[], repo: string, number: number, branch: string | null): Session[] {
  const r = repo.toLowerCase()
  return list.filter((s) => s.prs.some((p) => p.number === number && p.repo.toLowerCase() === r) || (!!branch && s.branch === branch && s.repo?.toLowerCase() === r))
}

const words = (c: Company) =>
  c.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)

export function stationOf(s: Session, companies: Company[], gs: GhSettings, live: LivePr | null): string | null {
  if (s.cwd) {
    const mapped = Object.entries(gs.repos)
      .filter(([path]) => s.cwd === path || s.cwd!.startsWith(path + '/'))
      .sort((a, b) => b[0].length - a[0].length)[0]
    if (mapped) return mapped[1]
  }
  if (live) {
    const hit = Object.entries(gs.stations).find(([co, login]) => login === live.login && co !== PERSONAL_ID)
    if (hit) return hit[0]
  }
  const owner = s.repo?.split('/')[0]?.toLowerCase() ?? ''
  const own = Object.entries(gs.stations).find(([co, login]) => co !== PERSONAL_ID && login?.toLowerCase() === owner)
  if (own) return own[0]
  const hay = `${owner} ${(s.cwd ?? '').toLowerCase()}`
  const named = companies.find((c) => c.id !== PERSONAL_ID && words(c).some((w) => hay.includes(w)))
  return named?.id ?? null
}

export function openSession(s: Session) {
  window.dispatchEvent(new CustomEvent<Session>('sx:open', { detail: s }))
}
