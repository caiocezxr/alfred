import type { Adjust, Area, Profile, Rating, RatingInput, RatingLevel, RatingReason } from './types.ts'

export const LEVELS: { id: RatingLevel; label: string }[] = [
  { id: 'otimo', label: 'Ótimo' },
  { id: 'ok', label: 'Ok' },
  { id: 'fraco', label: 'Fraco' },
]

export const REASONS: { id: RatingReason; label: string }[] = [
  { id: 'faltou_dinheiro', label: 'faltou oportunidade de dinheiro' },
  { id: 'faltou_ferramenta', label: 'faltou ferramenta prática' },
  { id: 'faltou_codigo', label: 'faltou código' },
  { id: 'muito_mundo', label: 'muito mundo' },
  { id: 'muita_ia', label: 'muita IA' },
  { id: 'muita_politica', label: 'muita política' },
  { id: 'noticia_velha', label: 'notícia velha' },
  { id: 'muito_raso', label: 'muito raso' },
  { id: 'fontes_ruins', label: 'fontes ruins' },
]

const AREA_WORD: Record<Area, string> = { dinheiro: 'dinheiro', codigo: 'código', ia: 'IA', potencializa: 'ferramentas', seguranca: 'segurança', politica: 'política', mundo: 'mundo' }
const REASON_AREA: Partial<Record<RatingReason, [Area, number]>> = {
  faltou_dinheiro: ['dinheiro', 0.1],
  faltou_ferramenta: ['potencializa', 0.1],
  faltou_codigo: ['codigo', 0.1],
  muito_mundo: ['mundo', -0.1],
  muita_ia: ['ia', -0.1],
  muita_politica: ['politica', -0.1],
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function planAdjustments(input: Pick<RatingInput, 'rating' | 'reasons' | 'moreAreas'>): Adjust[] {
  if (input.rating === 'otimo') return []
  const out: Adjust[] = []
  const area = (key: Area, delta: number) => {
    const cur = out.find((a) => a.kind === 'area' && a.key === key)
    if (cur) cur.delta = Math.max(-0.2, Math.min(0.2, r1(cur.delta + delta)))
    else out.push({ kind: 'area', key, delta, label: '' })
  }
  for (const r of input.reasons) {
    const m = REASON_AREA[r]
    if (m) area(m[0], m[1])
  }
  for (const a of input.moreAreas) area(a, 0.1)
  if (input.reasons.includes('noticia_velha')) out.push({ kind: 'tuning', key: 'fresh', delta: 1, label: '' })
  if (input.reasons.includes('muito_raso')) out.push({ kind: 'tuning', key: 'depth', delta: 1, label: '' })
  return out
    .filter((a) => Math.abs(a.delta) > 1e-9)
    .map((a) => ({
      ...a,
      label: a.kind === 'area' ? `${a.delta > 0 ? 'mais' : 'menos'} ${AREA_WORD[a.key as Area]}` : a.key === 'fresh' ? 'notícias mais frescas' : 'menos notícia rasa',
    }))
}

export function applyAdjustments(p: Profile, adj: Adjust[], sign: 1 | -1): { profile: Profile; applied: Adjust[] } {
  const next: Profile = { ...p, areas: p.areas.map((a) => ({ ...a })), tuning: { ...p.tuning } }
  const applied: Adjust[] = []
  for (const a of adj) {
    if (a.kind === 'area') {
      const pref = next.areas.find((x) => x.id === a.key)
      if (!pref) continue
      const before = pref.weight
      pref.weight = Math.max(0.3, Math.min(2, r1(pref.weight + sign * a.delta)))
      const real = r1(pref.weight - before)
      if (Math.abs(real) > 1e-9) applied.push({ ...a, delta: real * sign })
    } else {
      const k = a.key === 'fresh' ? 'fresh' : 'depth'
      const before = next.tuning[k]
      next.tuning[k] = Math.max(0, Math.min(3, before + sign * a.delta))
      if (next.tuning[k] !== before) applied.push({ ...a, delta: (next.tuning[k] - before) * sign })
    }
  }
  return { profile: next, applied }
}

export function historyLine(list: Rating[]): string {
  const live = list.filter((r) => !r.undone)
  if (!live.length) return 'Nenhuma avaliação nos últimos 7 dias.'
  const n = (l: RatingLevel) => live.filter((r) => r.rating === l).length
  const parts = [
    n('otimo') ? `${n('otimo')} ${n('otimo') === 1 ? 'ótimo' : 'ótimos'}` : '',
    n('ok') ? `${n('ok')} ok` : '',
    n('fraco') ? `${n('fraco')} ${n('fraco') === 1 ? 'fraco' : 'fracos'}` : '',
  ].filter(Boolean)
  return `Últimos ${live.length} ${live.length === 1 ? 'briefing' : 'briefings'}: ${parts.join(', ')}.`
}

export const shouldAsk = (o: { rated: boolean; dismissed: boolean; votes: number; finished: boolean; progress: number }) =>
  !o.rated && !o.dismissed && (o.finished || o.votes >= 2 || o.progress >= 0.6)
