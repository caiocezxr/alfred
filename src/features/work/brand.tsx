import type { CSSProperties } from 'react'
import type { Company } from './types'

const FILES = import.meta.glob('../../assets/companies/*.{svg,png}', { query: '?url', import: 'default', eager: true }) as Record<string, string>

function bundled(id: string, kind: 'mark' | 'logo'): string | null {
  for (const ext of ['svg', 'png']) {
    const hit = Object.entries(FILES).find(([k]) => k.endsWith(`/${id}-${kind}.${ext}`))
    if (hit) return hit[1]
  }
  return null
}

export const markUrl = (c: Company) => c.logo ?? bundled(c.id, 'mark')
export const logoUrl = (c: Company) => bundled(c.id, 'logo') ?? c.logo ?? bundled(c.id, 'mark')

export function CompanyMark({ company, size = 18, className = '' }: { company: Company | null | undefined; size?: number; className?: string }) {
  if (!company) return null
  const url = markUrl(company)
  const style = { width: size, height: size, ['--co' as string]: company.color } as CSSProperties
  if (url) return <img className={`wk-mark ${className}`} src={url} alt="" style={style} draggable={false} />
  return (
    <span className={`wk-mark is-mono ${className}`} style={{ ...style, fontSize: Math.round(size * 0.58) }} aria-hidden="true">
      {company.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

export const coStyle = (c: Company | null | undefined) => ({ ['--co' as string]: c?.color ?? 'var(--accent)' }) as CSSProperties
