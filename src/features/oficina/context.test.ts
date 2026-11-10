import { deskContext } from './context.ts'
import type { Item } from './store'

const assert = (await import('node:assert/strict' as string)).default as { equal(a: unknown, b: unknown, m?: string): void; ok(v: unknown, m?: string): void }

const u = (agent: Item['agent'], text: string, at: number): Item => ({ id: `u${at}`, agent, role: 'user', text, at })
const a = (agent: Item['agent'], text: string, at: number, open = false): Item => ({ id: `a${at}`, agent, role: 'agent', text, at, open, end: open ? undefined : at + 1 })

const items: Item[] = [
  u('codex', 'salve', 1),
  a('codex', 'fala meu sheik, qual é a missão?', 2),
  u('local', 'salve', 10),
  a('local', 'Fala, Caio! Manda a brisa.', 11),
  u('local', 'se perguntar meu nome é salve jorge pelo menos nessa sessao ok?', 12),
  a('local', 'Entendido, Jorge.', 13),
]

const toCodex = deskContext(items, 'codex', 5)
assert.equal(toCodex.count, 4, 'o Codex recebe as 4 mensagens trocadas com o Local')
assert.ok(toCodex.text.includes('Caio → Local: se perguntar meu nome é salve jorge'), 'leva o pedido do nome')
assert.ok(toCodex.text.includes('Local: Entendido, Jorge.'), 'leva a resposta do Local')
assert.ok(!toCodex.text.includes('fala meu sheik'), 'não repete a conversa do próprio Codex')
assert.ok(toCodex.text.endsWith('[Mensagem do Caio para você]\n'), 'termina antes da mensagem nova')

assert.equal(deskContext(items, 'codex', 20).count, 0, 'nada novo desde a última mensagem, nada a mandar')
assert.equal(deskContext(items, 'local', 0).count, 2, 'o Local recebe a conversa anterior do Codex')

const live = [...items, a('claude', 'ainda escrevendo', 14, true)]
assert.equal(deskContext(live, 'codex', 5).count, 4, 'resposta ainda sendo escrita fica para a próxima')
const done = [...items, { ...(a('claude', 'pronto', 14) as Extract<Item, { role: 'agent' }>), end: 30 }]
assert.equal(deskContext(done, 'codex', 20).count, 1, 'resposta que terminou depois entra mesmo tendo começado antes')

const big = Array.from({ length: 40 }, (_, i) => u('claude', 'x'.repeat(1000), 100 + i))
const capped = deskContext(big, 'codex', 0)
assert.ok(capped.text.length < 6600 && capped.count === 5, 'respeita o teto e fica com as mais recentes')

console.log('✓ contexto compartilhado entre agentes')
