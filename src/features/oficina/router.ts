import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../shared/db/api'
import { cofreOf, getSettings, listSkills, type SkillInfo } from './cofre'

export type Pick = { id: string; name: string; score: number; why: string; path: string }

const STOP = new Set(
  'a o e de da do das dos um uma uns umas para pra pro por com sem no na nos nas em que se eu me meu minha isso esse essa este esta ta tá ai aí ja já mais muito so só tem ter vai faz fazer como quando onde qual quais the and for with when use to of in on or is are this that any be as at by from your you it'.split(' '),
)

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export const tokens = (t: string) => new Set(norm(t).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5)))

type Entry = { s: SkillInfo; t: Set<string>; v: number[] | null }

let index: Entry[] | null = null
let idf = new Map<string, number>()
let building: Promise<Entry[]> | null = null
let embedOk = isTauri

const VKEY = 'sessao.skillvec.v1'

const unit = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => Math.round((x / n) * 1000) / 1000)
}

async function embed(texts: string[]): Promise<number[][] | null> {
  if (!embedOk || !texts.length) return null
  try {
    return (await invoke<number[][]>('oficina_embed', { texts })).map(unit)
  } catch {
    embedOk = false
    window.setTimeout(() => (embedOk = isTauri), 60_000)
    return null
  }
}

const textOf = (s: SkillInfo) => `${s.name}: ${s.description}`

async function build(): Promise<Entry[]> {
  const list = (await listSkills()).filter((s) => !s.manual)
  let cache: Record<string, number[]> = {}
  try {
    cache = JSON.parse(localStorage.getItem(VKEY) ?? '{}') as Record<string, number[]>
  } catch {
    cache = {}
  }
  const key = (s: SkillInfo) => `${s.id}|${s.description.length}`
  const missing = list.filter((s) => !cache[key(s)])
  if (missing.length) {
    const vecs = await embed(missing.map(textOf))
    if (vecs) {
      missing.forEach((s, i) => (cache[key(s)] = vecs[i]))
      const keep: Record<string, number[]> = {}
      for (const s of list) if (cache[key(s)]) keep[key(s)] = cache[key(s)]
      try {
        localStorage.setItem(VKEY, JSON.stringify(keep))
      } catch {
        localStorage.removeItem(VKEY)
      }
    }
  }
  const entries = list.map((s) => ({ s, t: tokens(`${s.name} ${s.description}`), v: cache[key(s)] ?? null }))
  const df = new Map<string, number>()
  for (const e of entries) for (const w of e.t) df.set(w, (df.get(w) ?? 0) + 1)
  idf = new Map([...df].map(([w, c]) => [w, Math.log((entries.length + 1) / (c + 0.5))]))
  index = entries
  return entries
}

export function warmRouter() {
  building ??= build().finally(() => (building = null))
  return building
}

export function resetRouter() {
  index = null
}

const cos = (a: number[], b: number[]) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export function allowedFor(companyId: string, s: SkillInfo) {
  const c = cofreOf(companyId)
  if (getSettings().base.includes(s.id)) return false
  if (c.skills.mode === 'all') return true
  return c.skills.on.includes(s.id)
}

export async function route(text: string, repos: string[], companyId: string): Promise<Pick[]> {
  const t = text.trim()
  if (t.length < 6 || t.startsWith('/')) return []
  const entries = index ?? (await warmRouter())
  const pool = entries.filter((e) => allowedFor(companyId, e.s))
  if (!pool.length) return []
  const q = tokens(t)
  const qWeight = [...q].reduce((a, w) => a + (idf.get(w) ?? 0.5), 0) || 1
  const repoT = new Set([...repos].flatMap((r) => [...tokens(r.split('/').pop() ?? r)]))
  const qv = pool.some((e) => e.v) ? ((await embed([t]))?.[0] ?? null) : null
  const scored = pool.map((e) => {
    const c = qv && e.v ? cos(qv, e.v) : 0
    const hits = [...q].filter((w) => e.t.has(w))
    const lex = hits.reduce((a, w) => a + (idf.get(w) ?? 0), 0) / qWeight
    const gate = qv ? (c >= 0.4 ? 1 : 0) : 1
    const repoHit = [...repoT].some((w) => e.t.has(w))
    const score = (qv ? 0.7 * c : 0) + (qv ? 0.3 : 0.8) * lex * gate + (repoHit ? 0.12 : 0)
    const why = repoHit && hits.length ? `combina com ${[...repoT][0]} e com o pedido` : repoHit ? `combina com o repositório` : hits.length ? 'combina com o pedido' : 'parecido com o pedido'
    return { id: e.s.id, name: e.s.name, score, why, path: e.s.path }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]?.score ?? 0
  const floor = qv ? 0.37 : 0.45
  return scored.filter((x) => x.score >= floor && x.score >= best * 0.6).slice(0, 3)
}
