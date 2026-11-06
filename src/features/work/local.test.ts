import { createLocal, slugify } from './local.ts'
import type { ItemChange, Todo, TodoCheck, WorkState } from './types.ts'

type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void
  deepEqual(actual: unknown, expected: unknown, message?: string): void
  ok(value: unknown, message?: string): void
  throws(fn: () => unknown, re?: RegExp): void
}
const nodeTest = 'node:test'
const nodeAssert = 'node:assert/strict'
const { test } = (await import(nodeTest)) as { test: (name: string, fn: () => void) => void }
const assert = ((await import(nodeAssert)) as { default: Assert }).default

function setup() {
  const mem = new Map<string, string>()
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
  let t = Date.parse('2026-11-06T12:00:00Z')
  let n = 0
  const api = createLocal(storage, () => new Date((t += 1000)), () => `id${++n}`)
  const x = <T>(cmd: string, a: Record<string, unknown> = {}) => api.exec(cmd, a) as T
  return { x, mem }
}

test('sementes e persistência', () => {
  const { x, mem } = setup()
  const s = x<WorkState>('work_load')
  assert.deepEqual(s.companies.map((c) => c.id), ['statix', 'livelo', 'pessoal'])
  assert.equal(s.checklist.length, 9)
  assert.equal(s.secrets.length, 0)
  x('work_item_create', { input: { companyId: 'statix', title: 'A' } })
  assert.ok(mem.get('ps.work.v1')?.includes('"title":"A"'))
})

test('mesma semântica de entrega, retorno e checklist do Rust', () => {
  const { x } = setup()
  const { item } = x<ItemChange>('work_item_create', { input: { companyId: 'livelo', title: 'API', ticket: ' #12 ' } })
  assert.equal(item.ticket, '#12')
  x('work_item_move', { id: item.id, stage: 'doing', force: false })
  assert.throws(() => x('work_item_move', { id: item.id, stage: 'delivered', force: false }), /checklist pendente: 4/)
  const d = x<ItemChange>('work_item_move', { id: item.id, stage: 'delivered', force: true })
  assert.equal(d.events.at(-1)!.pending, 4)
  assert.ok(d.item.deliveredAt)
  assert.throws(() => x('work_item_return', { id: item.id, reason: ' ' }), /por que/)
  x('work_item_check', { id: item.id, checkId: 'livelo-pr', on: true })
  assert.throws(() => x('work_item_check', { id: item.id, checkId: 'statix-sql', on: true }), /outra empresa/)
  const r = x<ItemChange>('work_item_return', { id: item.id, reason: 'faltou paginação' })
  assert.equal(r.item.stage, 'doing')
  assert.equal(r.item.returns, 1)
  assert.ok(r.item.returnOpen)
  assert.deepEqual(r.item.checks, [])
  assert.equal(r.item.deliveredAt, null)
  const res = x<ItemChange>('work_item_resume', { id: item.id })
  assert.ok(!res.item.returnOpen)
  assert.throws(() => x('work_item_create', { input: { companyId: 'statix', title: 'x', url: 'javascript:alert(1)' } }), /http/)
})

test('foco, aguardando, notas e exclusão', () => {
  const { x } = setup()
  const ids = [1, 2, 3, 4].map((k) => x<ItemChange>('work_item_create', { input: { companyId: 'statix', title: `t${k}` } }).item.id)
  for (const id of ids.slice(0, 3)) x('work_item_focus', { id, on: true })
  assert.throws(() => x('work_item_focus', { id: ids[3], on: true }), /no máximo 3/)
  const w = x<ItemChange>('work_item_wait', { id: ids[0], on: 'Ana' })
  assert.equal(w.item.waitingOn, 'Ana')
  const u = x<ItemChange>('work_item_wait', { id: ids[0], on: null })
  assert.equal(u.events.at(-1)!.kind, 'unblocked')
  const n = x<ItemChange>('work_item_note', { id: ids[0], text: 'liguei' })
  const noteId = n.events.at(-1)!.id
  x('work_note_delete', { eventId: noteId })
  const done = x<ItemChange>('work_item_move', { id: ids[1], stage: 'done', force: true })
  assert.equal(done.item.focusedAt, null)
  x('work_item_delete', { id: ids[0] })
  const s = x<WorkState>('work_load')
  assert.equal(s.items.length, 3)
  assert.ok(s.events.every((e) => e.itemId !== ids[0]))
})

test('to-dos, conversão, importação, segredos indisponíveis e dias', () => {
  const { x } = setup()
  const d = x<Todo>('work_todo_create', { input: { companyId: 'statix', title: 'Fila', mode: 'daily', weekdaysOnly: true, remindTime: '09:00' } })
  assert.ok(d.weekdaysOnly)
  assert.throws(() => x('work_todo_done', { id: d.id, on: true }), /por dia/)
  assert.equal(x<TodoCheck[]>('work_todo_check', { id: d.id, date: '2026-11-06', on: true }).length, 1)
  assert.throws(() => x('work_todo_create', { input: { companyId: 'pessoal', title: 'x', mode: 'dated' } }), /data/)
  const p = x<Todo>('work_todo_create', { input: { companyId: 'livelo', title: 'Mandar horas', dueDate: '2026-11-07', priority: 'alta' } })
  assert.equal(p.mode, 'dated')
  const conv = x<{ todo: Todo; change: ItemChange }>('work_todo_convert', { id: p.id })
  assert.equal(conv.change.item.companyId, 'livelo')
  assert.equal(conv.change.item.priority, 'alta')
  assert.ok(conv.todo.doneAt && conv.todo.itemId === conv.change.item.id)
  assert.throws(() => x('work_todo_convert', { id: d.id }), /diário/)
  const f = x<Todo>('work_todo_update', { id: p.id, patch: { mode: 'fixed' } })
  assert.equal(f.dueDate, null)
  assert.equal(x<number>('work_todos_import', { tasks: [{ title: 'Pagar luz', note: '', dueDate: '2026-11-10', priority: 1, doneAt: null }, { title: ' ', note: '', dueDate: null, priority: 0, doneAt: null }] }), 1)
  assert.equal(x<number>('work_todos_import', { tasks: [{ title: 'De novo', note: '', dueDate: null, priority: 0, doneAt: null }] }), 0)
  const st = x<WorkState>('work_load')
  const imported = st.todos.find((t) => t.title === 'Pagar luz')!
  assert.equal(imported.companyId, 'pessoal')
  assert.equal(imported.priority, 'alta')
  assert.throws(() => x('work_company_delete', { id: 'pessoal' }), /espaço tem/)
  assert.throws(() => x('work_secret_add', { itemId: 'a', label: 'x', value: 'y' }), /app instalado/)
  x('work_day_set', { date: '2026-11-06', green: true, openCount: 0, handledCount: 2 })
  x('work_day_set', { date: '2026-11-06', green: false, openCount: 1, handledCount: 2 })
  assert.deepEqual(x<WorkState>('work_load').days, [{ date: '2026-11-06', green: false, openCount: 1, handledCount: 2 }])
})

test('utilitários', () => {
  assert.equal(slugify('Ação Pagamentos!'), 'acao-pagamentos')
})
