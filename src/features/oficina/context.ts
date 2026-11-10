import type { Item } from './store'

export type AgentId = 'claude' | 'codex' | 'local'
export const AGENT_NAME: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex', local: 'Local' }

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)
const SMALL_TALK = /^(oi+|ol[áa]|salve|e a[íi]|eai|fala|bom dia|boa tarde|boa noite|valeu|obrigad[oa]|vlw|ok|blz|beleza|show|top|tmj|kk+|haha+)[\s!.,?]*$/i

export type Turn = { agent: AgentId; ask: Extract<Item, { role: 'user' }> | null; reply: string; at: number; end: number; open: boolean }

export function turns(items: Item[]): Turn[] {
  const cur = new Map<AgentId, Turn>()
  const out: Turn[] = []
  for (const x of items) {
    if (x.role === 'user') {
      const t: Turn = { agent: x.agent, ask: x, reply: '', at: x.at, end: x.at, open: false }
      cur.set(x.agent, t)
      out.push(t)
    } else if (x.role === 'agent') {
      let t = cur.get(x.agent)
      if (!t) {
        t = { agent: x.agent, ask: null, reply: '', at: x.at, end: x.at, open: false }
        cur.set(x.agent, t)
        out.push(t)
      }
      if (x.text.trim()) t.reply += (t.reply ? '\n' : '') + x.text.trim()
      t.open = t.open || x.open
      if (!x.open) t.end = Math.max(t.end, x.end ?? x.at)
    }
  }
  return out
}

export const turnSource = (t: Turn) => [t.ask?.text.trim() && `Caio: ${t.ask.text.trim()}`, t.reply && `${AGENT_NAME[t.agent]}: ${t.reply}`].filter(Boolean).join('\n')

export const needsGist = (t: Turn) => !t.open && !!t.ask && t.ask.gist === undefined && turnSource(t).length > 280 && !SMALL_TALK.test(t.ask.text.trim())

export function deskContext(items: Item[], agent: AgentId, since: number, budget = 3000) {
  const lines: string[] = []
  for (const t of turns(items)) {
    if (t.agent === agent) continue
    const ask = t.ask?.text.trim() ?? ''
    if (SMALL_TALK.test(ask) && t.reply.length < 200) continue
    const newAsk = !!t.ask && t.at > since && !!ask
    const newReply = !t.open && t.end > since && !!t.reply
    if (!newAsk && !newReply) continue
    if (t.ask?.gist !== undefined && !t.open) {
      if (t.ask.gist) lines.push(`Com o ${AGENT_NAME[t.agent]}:\n${t.ask.gist}`)
      continue
    }
    if (newAsk) lines.push(`Caio → ${AGENT_NAME[t.agent]}: ${clip(ask, 600)}`)
    if (newReply) lines.push(`${AGENT_NAME[t.agent]}: ${clip(t.reply, 400)}`)
  }
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0 && size + lines[i].length <= budget; i--) {
    kept.unshift(lines[i])
    size += lines[i].length
  }
  if (!kept.length) return { text: '', count: 0 }
  return {
    text: `[Contexto da desk: o que o Caio tratou com outros agentes desde a sua última mensagem. Leve em conta, não responda.]\n${kept.join('\n')}\n\n[Mensagem do Caio para você]\n`,
    count: kept.length,
  }
}
