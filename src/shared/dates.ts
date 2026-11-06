
const pad = (n: number) => String(n).padStart(2, '0')

export function civil(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseCivil(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: string, n: number): string {
  const d = parseCivil(s)
  d.setDate(d.getDate() + n)
  return civil(d)
}

export function weekday(s: string): number {
  return parseCivil(s).getDay()
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseCivil(b).getTime() - parseCivil(a).getTime()) / 86400000)
}

export const fmtLong = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
export const fmtShort = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
export const fmtWeekdayShort = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })

export function relativeDay(s: string, today = civil()): string {
  const diff = daysBetween(today, s)
  if (diff === 0) return 'hoje'
  if (diff === 1) return 'amanhã'
  if (diff === -1) return 'ontem'
  if (diff < 0) return `${-diff} dias atrás`
  if (diff < 7) return fmtWeekdayShort.format(parseCivil(s)).replace('.', '')
  return fmtShort.format(parseCivil(s)).replace('.', '')
}

export function greeting(d = new Date()): string {
  const h = d.getHours()
  if (h < 5) return 'Boa noite'
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}
