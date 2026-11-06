import type { MarketFact, Quote } from './types.ts'

const MINUS = '−'
const nf = (min: number, max: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max })
const N0 = nf(0, 0)
const N2 = nf(2, 2)
const N1 = nf(1, 1)

export function decimalsOf(q: Pick<Quote, 'unit' | 'value'>): number {
  if (q.unit === 'pts') return 0
  if (q.unit === 'usd') return q.value >= 1000 ? 0 : 2
  return 2
}

export function fmtNumber(v: number, decimals: number): string {
  return nf(decimals, decimals).format(v)
}

export function fmtValue(q: Pick<Quote, 'unit' | 'value'>): string {
  const d = decimalsOf(q)
  const n = fmtNumber(q.value, d)
  if (q.unit === 'usd') return `US$ ${n}`
  if (q.unit === 'brl') return `R$ ${n}`
  if (q.unit === 'pct') return `${n}%`
  return `${n} pts`
}

export function unitParts(q: Pick<Quote, 'unit'>): { pre: string; post: string } {
  if (q.unit === 'usd') return { pre: 'US$ ', post: '' }
  if (q.unit === 'brl') return { pre: 'R$ ', post: '' }
  if (q.unit === 'pct') return { pre: '', post: '%' }
  return { pre: '', post: ' pts' }
}

export function fmtChange(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return ''
  const abs = N1.format(Math.abs(p))
  if (Math.abs(p) < 0.05) return '0,0%'
  return `${p > 0 ? '+' : MINUS}${abs}%`
}

export type Direction = 'up' | 'down' | 'flat'
export const direction = (p: number | null): Direction => (p === null || Math.abs(p) < 0.05 ? 'flat' : p > 0 ? 'up' : 'down')

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export function monthLabel(iso: string | null): string {
  const m = iso?.match(/^(\d{4})-(\d{2})/)
  return m ? `${MONTHS[Number(m[2]) - 1]}/${m[1]}` : ''
}

export function periodLabel(q: Quote): string {
  if (q.period === '24 h') return 'em 24 h'
  if (q.period === 'dia') return 'no dia'
  if (q.period === '12 meses') return `em 12 meses${q.asOf ? ` (até ${monthLabel(q.asOf)})` : ''}`
  return q.period
}

export function marketFacts(quotes: Quote[]): MarketFact[] {
  return quotes.map((q) => {
    const ch = q.changePct === null ? '' : ` (${fmtChange(q.changePct)} ${periodLabel(q)})`
    const tail = q.changePct === null ? ` ${periodLabel(q)}` : ''
    return { label: q.label, text: `${fmtValue(q)}${ch}${tail}`.trim() }
  })
}

const verb = (p: number) => (Math.abs(p) < 0.05 ? 'ficou estável' : p > 0 ? `subiu ${N1.format(p)}%` : `caiu ${N1.format(-p)}%`)

export function marketNarrationFallback(quotes: Quote[]): string | null {
  if (!quotes.length) return null
  const moving = quotes.filter((q) => q.changePct !== null).sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
  const parts: string[] = []
  for (const q of moving.slice(0, 3)) {
    const name = q.id === 'dolar' || q.id === 'euro' ? `o ${q.label.toLowerCase()}` : q.id === 'ibovespa' ? 'o Ibovespa' : `o ${q.label.toLowerCase()}`
    const spokenValue = q.unit === 'pts' ? `${fmtInt(q.value)} pontos` : fmtValue(q)
    const spokenPeriod = periodLabel(q).replace('24 h', '24 horas')
    parts.push(`${name} ${verb(q.changePct!)} ${spokenPeriod}, a ${spokenValue}`)
  }
  const sentences: string[] = []
  if (parts.length) sentences.push(`No mercado, ${parts.join('; ')}.`)
  const selic = quotes.find((q) => q.id === 'selic')
  const ipca = quotes.find((q) => q.id === 'ipca')
  if (selic && ipca) sentences.push(`A Selic está em ${N2.format(selic.value)}% ao ano, e o IPCA soma ${N2.format(ipca.value)}% em 12 meses.`)
  else if (selic) sentences.push(`A Selic está em ${N2.format(selic.value)}% ao ano.`)
  return sentences.join(' ').replace(/^No mercado, o /, 'No mercado, o ')
}

export const fmtInt = (n: number) => N0.format(n)
