import type { Item } from './store'

export type AgentId = 'claude' | 'codex' | 'local'
export const AGENT_NAME: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex', local: 'Local' }

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)

export function deskContext(items: Item[], agent: AgentId, since: number, budget = 6000) {
  const lines: string[] = []
  for (const x of items) {
    if (x.agent === agent) continue
    if (x.role === 'user' && x.at > since && x.text.trim()) lines.push(`Caio → ${AGENT_NAME[x.agent]}: ${clip(x.text.trim(), 1200)}`)
    else if (x.role === 'agent' && !x.open && (x.end ?? x.at) > since && x.text.trim()) lines.push(`${AGENT_NAME[x.agent]}: ${clip(x.text.trim(), 1200)}`)
  }
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0 && size + lines[i].length <= budget; i--) {
    kept.unshift(lines[i])
    size += lines[i].length
  }
  if (!kept.length) return { text: '', count: 0 }
  return {
    text: `[Contexto da desk: o Caio também conversou com outros agentes nesta desk desde a sua última mensagem. Leve em conta o que foi dito e combinado ali, sem responder essas mensagens.]\n${kept.join('\n')}\n\n[Mensagem do Caio para você]\n`,
    count: kept.length,
  }
}
