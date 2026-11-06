import { useSyncExternalStore } from 'react'
import { civil } from '../../shared/dates'
import { assemble } from './assemble.ts'
import { briefingApi, splitError } from './api.ts'
import { collect, feedList } from './collect.ts'
import { learn } from './learn.ts'
import { marketFacts } from './market.ts'
import { sieve, windowStart, type Candidate } from './sieve.ts'
import type { Edition, EditionRow, Feedback, FeedbackInput, JudgeOutput, Profile, Reason, Signal, BriefItem } from './types.ts'

export type Phase = 'idle' | 'checking' | 'waiting' | 'collecting' | 'judging' | 'assembling' | 'ready' | 'error'

export type Progress = {
  step: 0 | 1 | 2
  done: number
  total: number
  current: string
  startedAt: number
  judgeStartedAt: number | null
  judgeExpectedMs: number
}

export type BriefState = {
  phase: Phase
  date: string
  edition: Edition | null
  redoError: string | null
  error: string | null
  progress: Progress
  votes: Map<string, Feedback>
  profile: Profile | null
}

const JUDGE_MS_KEY = 'ps.briefing.judgeMs'
const expectedJudgeMs = () => {
  const v = Number(localStorage.getItem(JUDGE_MS_KEY))
  return Number.isFinite(v) && v > 5000 ? v : 100_000
}

const blankProgress = (): Progress => ({ step: 0, done: 0, total: 0, current: '', startedAt: Date.now(), judgeStartedAt: null, judgeExpectedMs: expectedJudgeMs() })

let state: BriefState = { phase: 'idle', date: '', edition: null, redoError: null, error: null, progress: blankProgress(), votes: new Map(), profile: null }
const listeners = new Set<() => void>()
function set(patch: Partial<BriefState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
const setProgress = (p: Partial<Progress>) => set({ progress: { ...state.progress, ...p } })

export function useBriefing(): BriefState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}
export const getBriefing = () => state

const DAY_LABEL = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function judgeNoteOf(e: unknown): string {
  const { code, message } = splitError(e)
  switch (code) {
    case 'codex-ausente':
      return /navegador|só roda no app/.test(message) ? 'no navegador o juiz não roda' : 'o Codex não foi encontrado'
    case 'codex-login':
      return 'o Codex não está conectado à sua conta'
    case 'codex-limite':
      return 'o limite do ChatGPT acabou por agora'
    case 'codex-tempo':
      return 'o juiz demorou demais'
    case 'codex-rede':
      return 'o Codex ficou sem conexão'
    default:
      return 'o juiz falhou'
  }
}

export function friendlyError(e: unknown): string {
  const { code, message } = splitError(e)
  if (code === 'rede' || code === 'tempo') return 'Sem conexão para buscar as notícias agora.'
  return message.charAt(0).toUpperCase() + message.slice(1)
}

let running: Promise<void> | null = null
const autoTried = new Set<string>()

export async function ensureToday(): Promise<void> {
  const date = civil()
  if (running) return running
  if (state.date === date && (state.phase === 'ready' || state.phase === 'checking' || state.phase === 'waiting')) return
  if (state.date === date && state.phase === 'error' && autoTried.has(date)) return
  set({ phase: 'checking', date, error: null })
  try {
    const info = await briefingApi.today(date)
    const e = info.edition
    if (e && e.status === 'ready' && e.payload) return showReady(e)
    if (e && e.status === 'running' && !info.stale) return waitForOther(date)
    if (e && e.status === 'error' && autoTried.has(date)) {
      set({ phase: 'error', error: friendlyError(e.error ?? '') })
      return
    }
  } catch (err) {
    set({ phase: 'error', error: friendlyError(err) })
    return
  }
  autoTried.add(date)
  return prepare(false)
}

export function prepare(force: boolean): Promise<void> {
  if (running) return running
  running = run(civil(), force).finally(() => {
    running = null
  })
  return running
}

async function showReady(row: EditionRow) {
  set({ phase: 'ready', date: row.date, edition: row.payload, redoError: row.error, error: null })
  void loadVotes(row.date)
  void loadProfile()
}

async function waitForOther(date: string) {
  set({ phase: 'waiting', progress: { ...blankProgress(), current: 'preparando em outra janela' } })
  const until = Date.now() + 10 * 60_000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000))
    const info = await briefingApi.today(date).catch(() => null)
    const e = info?.edition
    if (e?.status === 'ready' && e.payload) return showReady(e)
    if (!e || e.status === 'error' || info?.stale) break
  }
  return prepare(false)
}

async function run(date: string, force: boolean) {
  const started = Date.now()
  const previous = state.edition
  set({ phase: 'collecting', date, error: null, redoError: null, progress: blankProgress() })
  try {
    const begin = await briefingApi.begin(date, force)
    if (!begin.started) {
      if (begin.edition.status === 'ready' && begin.edition.payload) return showReady(begin.edition)
      return waitForOther(date)
    }
    const profile = await briefingApi.profileGet()
    set({ profile })
    const feedback = await briefingApi.feedbackList(800).catch(() => [] as Feedback[])
    const learned = profile.learning ? learn(feedback, Date.now()) : null
    const marketP = briefingApi.market().catch(() => ({ quotes: [], errors: ['sem cotações'] }))
    const feeds = await feedList(profile)
    setProgress({ total: feeds.length })
    const col = await collect(feeds, (done, total, current) => setProgress({ done, total, current }))
    if (col.ok === 0) throw new Error('[rede] nenhuma fonte respondeu — sem conexão?')

    const now = Date.now()
    const from = windowStart(now, begin.windowFrom)
    let sv = sieve(col.entries, { now, windowFrom: from, profile, learned })
    if (sv.candidates.length < 8) sv = sieve(col.entries, { now, windowFrom: now - 72 * 36e5, profile, learned })
    const market = await marketP
    const marketAt = market.quotes.length ? new Date().toISOString() : null

    let judge: JudgeOutput | null = null
    let judgeNote: string | null = null
    if (sv.candidates.length) {
      setProgress({ step: 1, judgeStartedAt: Date.now(), judgeExpectedMs: expectedJudgeMs(), current: `${sv.candidates.length} candidatos` })
      set({ phase: 'judging' })
      try {
        judge = await briefingApi.judge({
          dayLabel: DAY_LABEL.format(new Date()),
          candidates: sv.candidates.map(toJudgeCandidate),
          market: marketFacts(market.quotes),
          marketTime: marketAt ? `às ${TIME.format(new Date(marketAt))}` : null,
        })
        localStorage.setItem(JUDGE_MS_KEY, String(Math.round(judge.elapsedMs * 0.7 + state.progress.judgeExpectedMs * 0.3)))
      } catch (err) {
        judgeNote = judgeNoteOf(err)
      }
    }
    setProgress({ step: 2, current: '' })
    set({ phase: 'assembling' })
    const edition = assemble({
      date,
      now: Date.now(),
      windowFrom: from,
      candidates: sv.candidates,
      judge,
      judgeNote,
      market: market.quotes,
      marketAt,
      stats: {
        sources: col.sources,
        sourcesOk: col.ok,
        entries: col.entries.length,
        candidates: sv.candidates.length,
        durationMs: Date.now() - started,
        judgeMs: judge?.elapsedMs ?? null,
      },
    })
    const row = await briefingApi.finish(date, edition, edition.judge)
    await showReady(row)
  } catch (err) {
    const msg = friendlyError(err)
    const row = await briefingApi.fail(date, msg).catch(() => null)
    if (row?.status === 'ready' && row.payload) set({ phase: 'ready', edition: row.payload, redoError: msg })
    else if (previous) set({ phase: 'ready', edition: previous, redoError: msg })
    else set({ phase: 'error', error: msg })
  }
}

const toJudgeCandidate = (c: Candidate) => ({
  id: c.id,
  source: c.sourceName,
  area: c.area,
  lang: c.lang,
  title: c.title,
  excerpt: c.excerpt,
  ageHours: c.publishedAt ? Math.max(0, (Date.now() - Date.parse(c.publishedAt)) / 36e5) : null,
  outlets: c.outlets,
})

async function loadVotes(date: string) {
  const list = await briefingApi.feedbackList(400).catch(() => [] as Feedback[])
  set({ votes: new Map(list.filter((f) => f.editionDate === date).map((f) => [f.itemKey, f])) })
}

async function loadProfile() {
  if (state.profile) return
  const profile = await briefingApi.profileGet().catch(() => null)
  if (profile) set({ profile })
}

export async function vote(item: BriefItem, signal: Signal, origin: FeedbackInput['origin'], reason: Reason | null = null, kept = true) {
  const date = state.edition?.date ?? state.date
  const cur = state.votes.get(item.key)
  const votes = new Map(state.votes)
  if (cur && cur.signal === signal && reason === null && origin !== 'triage') {
    votes.delete(item.key)
    set({ votes })
    await briefingApi.feedbackRemove(date, item.key).catch(() => {})
    return
  }
  const input: FeedbackInput = {
    editionDate: date,
    itemKey: item.key,
    signal,
    reason,
    origin,
    area: item.area,
    sourceId: item.sourceId,
    sourceName: item.source,
    title: item.title,
    originalTitle: item.originalTitle,
    kept,
  }
  const now = new Date().toISOString()
  votes.set(item.key, { id: cur?.id ?? 'tmp', ...input, reason, area: item.area, sourceId: item.sourceId, sourceName: item.source, originalTitle: item.originalTitle, kept, createdAt: cur?.createdAt ?? now, updatedAt: now })
  set({ votes })
  try {
    const saved = await briefingApi.feedbackSet(input)
    const v2 = new Map(state.votes)
    v2.set(item.key, saved)
    set({ votes: v2 })
  } catch {
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
export function updateProfile(patch: Partial<Profile> | ((p: Profile) => Profile), delay = 500): Promise<Profile | null> {
  const base = state.profile
  if (!base) return Promise.resolve(null)
  const next = typeof patch === 'function' ? patch(base) : { ...base, ...patch }
  set({ profile: next })
  if (saveTimer) clearTimeout(saveTimer)
  return new Promise((resolve, reject) => {
    saveTimer = setTimeout(() => {
      briefingApi
        .profileSave(state.profile ?? next)
        .then((p) => {
          set({ profile: p })
          resolve(p)
        })
        .catch(reject)
    }, delay)
  })
}

export async function ensureProfile(): Promise<Profile> {
  if (state.profile) return state.profile
  const p = await briefingApi.profileGet()
  set({ profile: p })
  return p
}
