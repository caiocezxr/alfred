import { normalizeText } from '../radar/normalize.ts'
import { AREAS, type Area, type Feedback } from './types.ts'

export const HALF_LIFE_DAYS = 45
const DAY = 864e5

type Vec = { area: number; source: number; terms: number }

export function signalVector(f: Pick<Feedback, 'signal' | 'reason' | 'origin'>): Vec {
  let v: Vec
  if (f.signal === 'interest') v = { area: 2, source: 1, terms: 1.5 }
  else if (f.signal === 'up') v = f.reason === 'more' ? { area: 1.5, source: 1, terms: 1.5 } : { area: 1, source: 0.7, terms: 1 }
  else if (f.reason === 'knew') v = { area: -0.2, source: 0, terms: -0.3 }
  else if (f.reason === 'shallow') v = { area: -0.4, source: -1.2, terms: -0.4 }
  else if (f.reason === 'not_mine') v = { area: -1.5, source: -0.5, terms: -1 }
  else v = { area: -0.8, source: -0.6, terms: -0.8 }
  const k = f.origin === 'triage' ? 0.8 : 1
  return { area: v.area * k, source: v.source * k, terms: v.terms * k }
}

const STOP = new Set(
  (
    'a o as os um uma uns umas de da do das dos em no na nos nas por para pra com sem sobre entre ate apos e ou mas que se ' +
    'sua seu suas seus ele ela eles elas isso este esta esse essa como mais menos muito ja nao sim foi ser sao tem ter ha ' +
    'diz dizem apos contra novo nova novos novas pode podem vai vao ano anos dia dias hoje ontem agora brasil veja ' +
    'the a an of to in on for with by from at as is are was were be been it its this that these those and or but not ' +
    'new how why what when who your you our we can will just more now into over out about after than via using use ' +
    'says said make makes made get gets first launches launch introduces announces'
  ).split(' '),
)

export function termsOf(text: string): string[] {
  const out = new Set<string>()
  for (const w of normalizeText(text).split(' ')) {
    const t = w.replace(/^[.#+]+|[.]+$/g, '')
    if (t.length < 3 || STOP.has(t) || /^\d+$/.test(t)) continue
    out.add(t)
  }
  return [...out]
}

export type LearnedTerm = { term: string; value: number; count: number }
export type Learned = {
  area: Record<Area, number>
  source: Map<string, { name: string; value: number; count: number }>
  terms: LearnedTerm[]
  total: number
}

const soft = (x: number, scale: number, cap: number) => Math.round(Math.tanh(x / scale) * cap * 100) / 100

export function emptyLearned(): Learned {
  return { area: Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<Area, number>, source: new Map(), terms: [], total: 0 }
}

export function learn(feedback: Feedback[], now: number): Learned {
  const areaSum = Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<Area, number>
  const src = new Map<string, { name: string; sum: number; count: number }>()
  const terms = new Map<string, { sum: number; count: number }>()
  let total = 0
  for (const f of feedback) {
    const age = Math.max(0, now - Date.parse(f.updatedAt || f.createdAt)) / DAY
    const decay = Number.isFinite(age) ? 0.5 ** (age / HALF_LIFE_DAYS) : 1
    if (decay < 0.01) continue
    total++
    const v = signalVector(f)
    if (f.area) areaSum[f.area] += v.area * decay
    if (f.sourceId) {
      const s = src.get(f.sourceId) ?? { name: f.sourceName, sum: 0, count: 0 }
      s.sum += v.source * decay
      s.count++
      src.set(f.sourceId, s)
    }
    for (const t of new Set([...termsOf(f.title), ...termsOf(f.originalTitle)])) {
      const e = terms.get(t) ?? { sum: 0, count: 0 }
      e.sum += v.terms * decay
      e.count++
      terms.set(t, e)
    }
  }
  const area = Object.fromEntries(AREAS.map((a) => [a, soft(areaSum[a], 5, 2)])) as Record<Area, number>
  const source = new Map<string, { name: string; value: number; count: number }>()
  for (const [id, s] of src) {
    const value = soft(s.sum, 4, 2)
    if (value !== 0) source.set(id, { name: s.name, value, count: s.count })
  }
  const learnedTerms = [...terms]
    .filter(([, e]) => e.count >= 2 && Math.abs(e.sum) >= 0.5)
    .map(([term, e]) => ({ term, value: soft(e.sum, 3, 1.5), count: e.count }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || b.count - a.count)
    .slice(0, 40)
  return { area, source, terms: learnedTerms, total }
}
