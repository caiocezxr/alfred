import { civil } from './dates'

export type Period = 'manha' | 'tarde' | 'entardecer' | 'noite'

export const DEFAULT_NICKS = ['meu sheik', 'chefinho', 'Caio', 'patrão', 'meu rei', 'chefe', 'campeão']

const KEY = 'ps.nicks.v1'

export function periodOf(d: Date): Period {
  const h = d.getHours() + d.getMinutes() / 60
  if (h >= 5 && h < 12) return 'manha'
  if (h >= 12 && h < 16.75) return 'tarde'
  if (h >= 16.75 && h < 18.5) return 'entardecer'
  return 'noite'
}

const HELLO: Record<Period, string> = { manha: 'Bom dia', tarde: 'Boa tarde', entardecer: 'Boa tarde', noite: 'Boa noite' }

export function loadNicks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (Array.isArray(v)) {
      const list = v.map((x) => String(x).trim()).filter(Boolean)
      if (list.length) return list
    }
  } catch {
    return DEFAULT_NICKS
  }
  return DEFAULT_NICKS
}

export function saveNicks(list: string[]) {
  const clean = list.map((x) => x.trim()).filter(Boolean).slice(0, 30)
  localStorage.setItem(KEY, JSON.stringify(clean.length ? clean : DEFAULT_NICKS))
}

function seeded(seed: number) {
  let s = (seed * 2654435761) % 4294967296
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function orderFor(cycle: number, n: number) {
  const r = seeded(cycle + 7)
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

export function nickFor(date = civil(), list = loadNicks()) {
  const n = list.length
  if (n === 1) return list[0]
  const day = Math.floor(Date.parse(`${date}T12:00:00Z`) / 86400000)
  const cycle = Math.floor(day / n)
  const pos = ((day % n) + n) % n
  const order = orderFor(cycle, n)
  if (pos === 0) {
    const prev = orderFor(cycle - 1, n)
    if (order[0] === prev[n - 1]) [order[0], order[1]] = [order[1], order[0]]
  }
  return list[order[pos]]
}

export function greetingFor(d = new Date()) {
  const period = periodOf(d)
  return { period, hello: HELLO[period], nick: nickFor(civil(d)) }
}
