import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../shared/db/api'
import { defaultProfile, normalizeProfile } from './profile.ts'
import { BRIEFING_SOURCES } from './sources.ts'
import type {
  BeginResult, BriefSource, CodexStatus, Edition, EditionRow, Feedback, FeedbackInput, JudgeInput, JudgeOutput, Market,
  Profile, TodayInfo, Voice,
} from './types.ts'

const KEY = 'ps.briefing.v1'
const STALE_MS = 10 * 60 * 1000

type LocalDb = {
  v: 1
  editions: Record<string, EditionRow>
  feedback: Feedback[]
  profile: Profile | null
  sources: Record<string, { enabled: boolean; weight: number }>
}

function readLocal(): LocalDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as LocalDb
      if (db?.v === 1 && db.editions && Array.isArray(db.feedback)) return db
    }
  } catch {
  }
  return { v: 1, editions: {}, feedback: [], profile: null, sources: {} }
}

function writeLocal(db: LocalDb) {
  const dates = Object.keys(db.editions).sort().reverse()
  for (const d of dates.slice(14)) delete db.editions[d]
  db.feedback = db.feedback.slice(0, 1500)
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    throw new Error('o armazenamento do navegador está cheio')
  }
}

const now = () => new Date().toISOString()
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))

function prevReady(db: LocalDb, date: string) {
  return Object.values(db.editions)
    .filter((e) => e.status === 'ready' && e.date < date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
}

const local = {
  today(date: string): TodayInfo {
    const db = readLocal()
    const e = db.editions[date] ?? null
    const p = prevReady(db, date)
    return {
      edition: e,
      previousDate: p?.date ?? null,
      windowFrom: p?.startedAt ?? null,
      stale: !!e && e.status === 'running' && Date.now() - Date.parse(e.startedAt) > STALE_MS,
    }
  },
  begin(date: string, force: boolean): BeginResult {
    const db = readLocal()
    const e = db.editions[date]
    const busy = !!e && e.status === 'running' && Date.now() - Date.parse(e.startedAt) < STALE_MS
    const go = !e || (force ? !busy : e.status === 'error' || (e.status === 'running' && !busy))
    if (go) {
      db.editions[date] = e
        ? { ...e, status: 'running', startedAt: now(), error: null, attempts: e.attempts + 1 }
        : { id: uid(), date, status: 'running', judge: null, startedAt: now(), finishedAt: null, error: null, payload: null, attempts: 1 }
      writeLocal(db)
    }
    return { started: go, edition: db.editions[date], windowFrom: prevReady(db, date)?.startedAt ?? null }
  },
  finish(date: string, payload: Edition, judge: string): EditionRow {
    const db = readLocal()
    const e = db.editions[date] ?? { id: uid(), date, startedAt: now(), attempts: 1 }
    db.editions[date] = { ...e, status: 'ready', judge: judge as EditionRow['judge'], payload, finishedAt: now(), error: null } as EditionRow
    writeLocal(db)
    return db.editions[date]
  },
  fail(date: string, error: string): EditionRow {
    const db = readLocal()
    const e = db.editions[date]
    const msg = error.slice(0, 600) || 'erro desconhecido'
    db.editions[date] = e
      ? { ...e, status: e.payload ? 'ready' : 'error', error: msg }
      : { id: uid(), date, status: 'error', judge: null, startedAt: now(), finishedAt: null, error: msg, payload: null, attempts: 1 }
    writeLocal(db)
    return db.editions[date]
  },
  sources(): BriefSource[] {
    const db = readLocal()
    return BRIEFING_SOURCES.map(([id, name, url, area, lang, weight]) => ({
      id, name, url, area, lang, builtin: true, lastStatus: null, lastError: null, lastFetchedAt: null,
      enabled: db.sources[id]?.enabled ?? true,
      weight: db.sources[id]?.weight ?? weight,
    }))
  },
  sourceUpdate(id: string, patch: { enabled?: boolean; weight?: number }): BriefSource {
    const db = readLocal()
    const base = local.sources().find((s) => s.id === id)
    if (!base) throw new Error('fonte não encontrada')
    db.sources[id] = { enabled: patch.enabled ?? base.enabled, weight: patch.weight ?? base.weight }
    writeLocal(db)
    return { ...base, ...db.sources[id] }
  },
  feedbackSet(f: FeedbackInput): Feedback {
    const db = readLocal()
    const i = db.feedback.findIndex((x) => x.editionDate === f.editionDate && x.itemKey === f.itemKey)
    const t = now()
    const row: Feedback = {
      id: i >= 0 ? db.feedback[i].id : uid(),
      editionDate: f.editionDate,
      itemKey: f.itemKey,
      signal: f.signal,
      reason: f.reason ?? null,
      origin: f.origin,
      area: f.area ?? null,
      sourceId: f.sourceId ?? null,
      sourceName: f.sourceName ?? '',
      title: f.title,
      originalTitle: f.originalTitle ?? '',
      kept: !!f.kept,
      createdAt: i >= 0 ? db.feedback[i].createdAt : t,
      updatedAt: t,
    }
    if (i >= 0) db.feedback.splice(i, 1)
    db.feedback.unshift(row)
    writeLocal(db)
    return row
  },
  feedbackRemove(date: string, key: string) {
    const db = readLocal()
    db.feedback = db.feedback.filter((x) => !(x.editionDate === date && x.itemKey === key))
    writeLocal(db)
  },
  profileGet: (): Profile => normalizeProfile(readLocal().profile ?? defaultProfile()),
  profileSave(p: Profile): Profile {
    const db = readLocal()
    db.profile = normalizeProfile(p)
    writeLocal(db)
    return db.profile
  },
}

async function devGet(path: string): Promise<Response> {
  let r: Response
  try {
    r = await fetch(path, { cache: 'no-store' })
  } catch {
    throw new Error('[rede] sem conexão com o servidor de desenvolvimento')
  }
  if (!r.ok) {
    const text = await r.text()
    throw new Error(/^\[/.test(text) ? text : `[rede] o proxy respondeu ${r.status}`)
  }
  return r
}

export const briefingApi = {
  today: (date: string) => (isTauri ? invoke<TodayInfo>('briefing_today', { date }) : Promise.resolve(local.today(date))),
  begin: (date: string, force = false) => (isTauri ? invoke<BeginResult>('briefing_begin', { date, force }) : Promise.resolve(local.begin(date, force))),
  finish: (date: string, payload: Edition, judge: Edition['judge']) =>
    isTauri ? invoke<EditionRow>('briefing_finish', { date, payload, judge }) : Promise.resolve(local.finish(date, payload, judge)),
  fail: (date: string, error: string) => (isTauri ? invoke<EditionRow>('briefing_fail', { date, error }) : Promise.resolve(local.fail(date, error))),

  sources: () => (isTauri ? invoke<BriefSource[]>('briefing_sources_list') : Promise.resolve(local.sources())),
  sourceUpdate: (id: string, patch: { enabled?: boolean; weight?: number }) =>
    isTauri ? invoke<BriefSource>('briefing_source_update', { id, patch }) : Promise.resolve(local.sourceUpdate(id, patch)),
  fetchFeed: async (url: string): Promise<string> =>
    isTauri ? invoke<string>('briefing_fetch', { url }) : (await devGet(`/__briefing/feed?url=${encodeURIComponent(url)}`)).text(),
  market: async (): Promise<Market> => (isTauri ? invoke<Market>('briefing_market') : (await devGet('/__briefing/market')).json()),

  judge: (input: JudgeInput): Promise<JudgeOutput> =>
    isTauri
      ? invoke<JudgeOutput>('briefing_judge', { input })
      : Promise.reject(new Error('[codex-ausente] o juiz só roda no app; no navegador o briefing sai sem ele')),
  codexStatus: (): Promise<CodexStatus> =>
    isTauri
      ? invoke<CodexStatus>('briefing_codex_status')
      : Promise.resolve({ found: false, path: null, configured: false, error: 'o juiz só roda no app' }),

  voices: (): Promise<Voice[]> => (isTauri ? invoke<Voice[]>('briefing_voices') : Promise.resolve([])),
  tts: (text: string, voice: string, rate: number) => invoke<ArrayBuffer>('briefing_tts', { text, voice, rate }),

  feedbackList: (limit = 500) =>
    isTauri ? invoke<Feedback[]>('briefing_feedback_list', { limit }) : Promise.resolve(readLocal().feedback.slice(0, limit)),
  feedbackSet: (input: FeedbackInput) => (isTauri ? invoke<Feedback>('briefing_feedback_set', { input }) : Promise.resolve(local.feedbackSet(input))),
  feedbackRemove: (editionDate: string, itemKey: string) =>
    isTauri ? invoke<void>('briefing_feedback_remove', { editionDate, itemKey }) : Promise.resolve(local.feedbackRemove(editionDate, itemKey)),

  profileGet: async () => normalizeProfile(isTauri ? await invoke<Profile>('briefing_profile_get') : local.profileGet()),
  profileSave: async (profile: Profile) =>
    normalizeProfile(isTauri ? await invoke<Profile>('briefing_profile_save', { profile }) : local.profileSave(profile)),
}

export function splitError(e: unknown): { code: string; message: string } {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e)
  const m = raw.match(/^\[([a-z0-9 -]+)\]\s*(.*)$/is)
  return m ? { code: m[1].toLowerCase(), message: m[2] || raw } : { code: 'outro', message: raw }
}
