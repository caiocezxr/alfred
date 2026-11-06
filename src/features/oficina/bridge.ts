import type { LivePr } from '../work/github/api'
import type { Company, WorkItem } from '../work/types'

export type PendingItem = { itemId: string; companyId: string; title: string; ticket: string | null; url: string | null; notes: string; company: string; pr: { repo: string; number: number; branch: string; url: string } | null }

export function openInSessao(item: WorkItem, company: Company | undefined, pr: LivePr | null, ticketLink: string | null) {
  const p: PendingItem = {
    itemId: item.id,
    companyId: item.companyId,
    title: item.title,
    ticket: item.ticket,
    url: ticketLink ?? item.url,
    notes: item.notes ?? '',
    company: company?.name ?? '',
    pr: pr ? { repo: pr.pr.repository.nameWithOwner, number: pr.pr.number, branch: pr.pr.headRefName, url: pr.pr.url } : null,
  }
  localStorage.setItem('sx.pendingItem', JSON.stringify(p))
  if (location.hash.includes('oficina')) window.dispatchEvent(new Event('sx:pending-item'))
  else location.hash = '#/oficina'
}

export function draftFor(p: PendingItem) {
  const head = [p.ticket ? `Chamado ${p.ticket.startsWith('#') ? p.ticket : `#${p.ticket}`}: ${p.title}` : p.title, p.company && `Empresa: ${p.company}`, p.url && `Link: ${p.url}`, p.pr && `PR aberto: ${p.pr.repo} #${p.pr.number} (branch ${p.pr.branch})`].filter(Boolean).join('\n')
  const notes = p.notes.trim() ? `\n\nNotas do chamado:\n${p.notes.trim().slice(0, 3000)}` : ''
  return `${head}${notes}\n\nInvestiga a causa, me mostra o que achou e propõe a correção antes de mexer. Não fecha o chamado.`
}
