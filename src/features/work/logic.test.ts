import {
  commitMessage, fmtHours, hoursCsv, hoursReport, hoursText, matchTicketUrl, renderSnippet, roundMinutes, searchWork, slaFor, ticketUrl,
  boardColumns, weekScore, gaugeSegments, handledEntries, healthSummary, inQuiet, neglectFor, neglectNudges, fmtClock, fmtDur, itemTimeMs, moveSelection, nudges, rangeTimeMs, rulerModel, runningSession, sumTime,
  computeAlerts, computeHealth, computeMetrics, dayGrid, deliveryCycles, deliveryWeeks, dueState, findDuplicate, fixedTodos, forgetList,
  handledToday, healthLabel, parseCapture, parseDateWord, pendingChecks, planNotifications, previousWorkday, pruneSent, standup, streak,
  suggestFocus, todayTodos, upcomingTodos, weekStart,
} from './logic.ts'
import type { ChecklistEntry, Company, Session, Todo, TodoCheck, WorkEvent, WorkItem } from './types.ts'
import { DEFAULT_SETTINGS } from './types.ts'

type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void
  deepEqual(actual: unknown, expected: unknown, message?: string): void
  ok(value: unknown, message?: string): void
}
const nodeTest = 'node:test'
const nodeAssert = 'node:assert/strict'
const { test } = (await import(nodeTest)) as { test: (name: string, fn: () => void) => void }
const assert = ((await import(nodeAssert)) as { default: Assert }).default

const TODAY = '2026-11-06'
const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).toISOString()

const COMPANIES: Company[] = [
  { id: 'statix', name: 'Statix', color: '#2D62DB', logo: null, sort: 1, ticketUrl: 'https://statix.zendesk.com/agent/tickets/{id}', slaResponseMin: 240, slaResolutionMin: 2880 },
  { id: 'livelo', name: 'Livelo', color: '#E5008C', logo: null, sort: 2, ticketUrl: 'https://jira.livelo.com.br/browse/{id}', slaResponseMin: null, slaResolutionMin: null },
  { id: 'pessoal', name: 'Pessoal', color: '#8C8F96', logo: null, sort: 3, ticketUrl: null, slaResponseMin: null, slaResolutionMin: null },
]
const CHECKLIST: ChecklistEntry[] = [
  { id: 's1', companyId: 'statix', label: 'Testei', sort: 1 },
  { id: 's2', companyId: 'statix', label: 'SQL', sort: 2 },
  { id: 'l1', companyId: 'livelo', label: 'HML', sort: 1 },
]

let seq = 0
function mk(p: Partial<WorkItem> = {}): WorkItem {
  seq++
  return {
    id: `i${seq}`, companyId: 'statix', title: `Item ${seq}`, ticket: null, url: null, kind: 'chamado', system: null, priority: 'normal',
    dueDate: null, notes: '', requester: null, stage: 'todo', stageAt: at(TODAY), deliveredAt: null, testedAt: null, validatedAt: null,
    doneAt: null, waitingOn: null, waitingSince: null, returns: 0, returnedAt: null, returnOpen: false, followupAt: null, snoozedUntil: null,
    focusedAt: null, sort: seq, createdAt: at(TODAY), updatedAt: at(TODAY), checks: [], ...p,
  }
}
function ev(itemId: string, kind: WorkEvent['kind'], when: string, p: Partial<WorkEvent> = {}): WorkEvent {
  seq++
  return { id: `e${seq}`, itemId, kind, fromStage: null, toStage: null, note: '', pending: null, at: when, ...p }
}
const st = (itemId: string, from: WorkItem['stage'], to: WorkItem['stage'], when: string, pending: number | null = null) =>
  ev(itemId, 'stage', when, { fromStage: from, toStage: to, pending })
function td(p: Partial<Todo> = {}): Todo {
  seq++
  return {
    id: `t${seq}`, companyId: 'pessoal', title: `To-do ${seq}`, note: '', priority: 'normal', mode: 'fixed', weekdaysOnly: false, dueDate: null,
    remindTime: null, mustNotForget: false, doneAt: null, itemId: null, sort: seq, createdAt: at(TODAY, 8), updatedAt: at(TODAY, 8), ...p,
  }
}
const base = (items: WorkItem[], events: WorkEvent[] = [], todos: Todo[] = [], todoChecks: TodoCheck[] = []) => ({
  items, events, todos, todoChecks, checklist: CHECKLIST, settings: DEFAULT_SETTINGS, companies: COMPANIES,
})

test('captura entende empresa, código, prioridade, tipo, sistema e prazo', () => {
  const c = parseCapture('Corrigir conciliação Cielo #9488 @livelo !! /bug +conciliador sexta', TODAY, COMPANIES, 'statix', ['Conciliador'])
  assert.equal(c.title, 'Corrigir conciliação Cielo')
  assert.equal(c.companyId, 'livelo')
  assert.ok(c.companyExplicit)
  assert.equal(c.ticket, '#9488')
  assert.equal(c.priority, 'urgente')
  assert.equal(c.kind, 'bug')
  assert.equal(c.system, 'Conciliador')
  assert.equal(c.dueDate, '2026-11-13')
})

test('captura: atalhos menores e o que não é atalho', () => {
  const c = parseCapture('Ajustar endpoint LIV-321 ! até amanhã', TODAY, COMPANIES, 'statix')
  assert.equal(c.title, 'Ajustar endpoint')
  assert.equal(c.ticket, 'LIV-321')
  assert.equal(c.priority, 'alta')
  assert.equal(c.dueDate, '2026-11-07')
  assert.equal(c.companyId, 'statix')
  assert.ok(!c.companyExplicit)
  const d = parseCapture('Revisar relatório de hoje para o time', TODAY, COMPANIES, 'livelo')
  assert.equal(d.dueDate, null)
  assert.equal(d.title, 'Revisar relatório de hoje para o time')
  const e = parseCapture('Falar com @fulano sobre #tag', TODAY, COMPANIES, 'statix')
  assert.equal(e.title, 'Falar com @fulano sobre #tag')
  assert.equal(e.ticket, null)
  const f = parseCapture('hoje', TODAY, COMPANIES, 'statix')
  assert.equal(f.title, 'hoje')
  const g = parseCapture('Fechar mês @stat 15/01', TODAY, COMPANIES, 'livelo')
  assert.equal(g.companyId, 'statix')
  assert.equal(g.dueDate, '2027-01-15')
})

test('datas por extenso', () => {
  assert.equal(parseDateWord('sexta', TODAY), '2026-11-13')
  assert.equal(parseDateWord('segunda-feira', TODAY), '2026-11-09')
  assert.equal(parseDateWord('sábado', TODAY), '2026-11-07')
  assert.equal(parseDateWord('31/02', TODAY), null)
  assert.equal(parseDateWord('10/11', TODAY), '2026-11-10')
  assert.equal(parseDateWord('banana', TODAY), null)
})

test('duplicado só entre itens abertos da mesma empresa', () => {
  const a = mk({ ticket: '#9488' })
  const b = mk({ ticket: '#77', stage: 'done', doneAt: at(TODAY) })
  assert.equal(findDuplicate([a, b], 'statix', '9488')?.id, a.id)
  assert.equal(findDuplicate([a, b], 'livelo', '#9488'), null)
  assert.equal(findDuplicate([a, b], 'statix', '#77'), null)
})

test('checklist pendente e pendência sem checklist', () => {
  assert.equal(pendingChecks(mk({ checks: ['s1'] }), CHECKLIST).length, 1)
  assert.equal(pendingChecks(mk({ kind: 'pendencia' }), CHECKLIST).length, 0)
  assert.equal(pendingChecks(mk({ companyId: 'livelo', checks: ['l1'] }), CHECKLIST).length, 0)
})

test('estado do prazo', () => {
  assert.equal(dueState({ dueDate: '2026-11-05', stage: 'doing' }, TODAY), 'late')
  assert.equal(dueState({ dueDate: '2026-11-05', stage: 'delivered' }, TODAY), null)
  assert.equal(dueState({ dueDate: TODAY, stage: 'todo' }, TODAY), 'today')
  assert.equal(dueState({ dueDate: '2026-11-08', stage: 'todo' }, TODAY), 'soon')
  assert.equal(dueState({ dueDate: '2026-11-20', stage: 'todo' }, TODAY), 'later')
  assert.equal(dueState({ dueDate: '2026-11-01', stage: 'done' }, TODAY), null)
})

test('alertas: validação, aguardando, retorno, prazo, parado, WIP e cobrança adia', () => {
  const val = mk({ stage: 'delivered', deliveredAt: at('2026-11-03'), requester: 'Marcos', ticket: '#1' })
  const cobrado = mk({ stage: 'tested', deliveredAt: at('2026-11-01'), followupAt: at(TODAY) })
  const wait = mk({ stage: 'doing', waitingOn: 'infra', waitingSince: at('2026-11-02') })
  const ret = mk({ stage: 'doing', returnOpen: true, returnedAt: at(TODAY), returns: 1 })
  const late = mk({ stage: 'todo', dueDate: '2026-11-04' })
  const due = mk({ stage: 'doing', dueDate: TODAY })
  const stale = mk({ stage: 'doing', stageAt: at('2026-10-30') })
  const snoozed = mk({ stage: 'doing', stageAt: at('2026-10-20'), snoozedUntil: '2026-11-09' })
  const closeIt = mk({ stage: 'validated', deliveredAt: at('2026-11-01'), validatedAt: at('2026-11-03') })
  const items = [val, cobrado, wait, ret, late, due, stale, snoozed, closeIt]
  const events = [ev(ret.id, 'returned', at(TODAY), { fromStage: 'delivered', toStage: 'doing', note: 'faltou filtro' })]
  const alerts = computeAlerts(base(items, events), TODAY)
  const kinds = (id: string) => alerts.filter((a) => a.itemId === id).map((a) => a.kind)
  assert.deepEqual(kinds(val.id), ['validation'])
  assert.ok(alerts.find((a) => a.itemId === val.id)!.detail.includes('cobrar Marcos'))
  assert.deepEqual(kinds(cobrado.id), [])
  assert.deepEqual(kinds(wait.id), ['waiting'])
  assert.deepEqual(kinds(ret.id), ['returned'])
  assert.ok(alerts.find((a) => a.kind === 'returned')!.detail.includes('faltou filtro'))
  assert.deepEqual(kinds(late.id), ['overdue'])
  assert.deepEqual(kinds(due.id), ['due_today'])
  assert.deepEqual(kinds(stale.id), ['stale'])
  assert.deepEqual(kinds(snoozed.id), [])
  assert.deepEqual(kinds(closeIt.id), ['close'])
  assert.ok(alerts.some((a) => a.kind === 'wip'))
  assert.equal(alerts[0].severity, 3)
  assert.equal(computeAlerts(base(items, events), TODAY, 'livelo').length, 0)
})

test('alerta de entrega com checklist em aberto', () => {
  const i = mk({ stage: 'delivered', deliveredAt: at(TODAY), checks: ['s1'] })
  const events = [st(i.id, 'doing', 'delivered', at(TODAY), 2)]
  assert.ok(computeAlerts(base([i], events), TODAY).some((a) => a.kind === 'unchecked'))
  const ok = { ...i, checks: ['s1', 's2'] }
  assert.ok(!computeAlerts(base([ok], events), TODAY).some((a) => a.kind === 'unchecked'))
})

test('ciclos de entrega: retorno, validação separada e correção', () => {
  const a = mk()
  const b = mk()
  const c = mk()
  const events = [
    st(a.id, 'doing', 'delivered', at('2026-11-02', 10)),
    st(a.id, 'delivered', 'tested', at('2026-11-02', 15)),
    ev(a.id, 'returned', at('2026-11-03'), { fromStage: 'tested', toStage: 'doing', note: 'bug' }),
    st(a.id, 'doing', 'delivered', at('2026-11-04', 10)),
    st(a.id, 'delivered', 'validated', at('2026-11-05', 10)),
    st(b.id, 'doing', 'validated', at('2026-11-05')),
    st(c.id, 'doing', 'delivered', at('2026-11-05')),
    st(c.id, 'delivered', 'doing', at('2026-11-05', 13)),
  ]
  const cy = deliveryCycles(events)
  assert.equal(cy.length, 3)
  assert.ok(cy[0].returned && cy[0].testedAt)
  assert.ok(cy[1].validatedSeparately)
  assert.ok(!cy[2].validatedSeparately && cy[2].validatedAt)
  const m = computeMetrics(base([a, b, c], events), TODAY)
  assert.equal(m.thisWeek, 3)
  assert.equal(m.returnRate.delivered, 3)
  assert.equal(m.returnRate.returned, 1)
  assert.equal(m.returnRate.pct, 33)
  assert.equal(m.validation.n, 1)
  assert.equal(m.validation.avgDays, 1)
  assert.equal(m.weeks.length, 8)
  assert.equal(m.weeks[7].start, '2026-11-02')
  const w = deliveryWeeks(base([a, b, c], events))
  assert.equal(w[0].start, '2026-11-02')
  assert.equal(w[0].cycles.length, 3)
})

test('semana começa na segunda', () => {
  assert.equal(weekStart('2026-11-08'), '2026-11-02')
  assert.equal(weekStart('2026-11-09'), '2026-11-09')
  assert.equal(previousWorkday('2026-11-09'), '2026-11-06')
  assert.equal(previousWorkday('2026-11-06'), '2026-11-05')
})

test('daily com ontem, hoje e bloqueios por empresa', () => {
  const done = mk({ ticket: '#9488', title: 'Conciliação', stage: 'delivered', deliveredAt: at('2026-11-05'), requester: 'Marcos' })
  const doing = mk({ title: 'Relatório', stage: 'doing' })
  const wait = mk({ companyId: 'livelo', title: 'API', stage: 'doing', waitingOn: 'infra', waitingSince: at('2026-11-04') })
  const events = [
    st(done.id, 'todo', 'doing', at('2026-11-05', 9)),
    st(done.id, 'doing', 'delivered', at('2026-11-05', 16)),
    ev(doing.id, 'note', at('2026-11-05')),
  ]
  const txt = standup(base([done, doing, wait], events), TODAY)
  assert.ok(txt.includes('Statix\nOntem:\n• #9488 Conciliação — comecei, entreguei'))
  assert.ok(txt.includes('Hoje:\n• Relatório'))
  assert.ok(txt.includes('#9488 Conciliação — aguardando validação de Marcos (entregue ontem)'))
  assert.ok(txt.includes('Livelo'))
  assert.ok(txt.includes('• API — aguardando infra há 2 dias'))
  assert.ok(!standup(base([done, doing, wait], events), TODAY, 'statix').includes('Livelo'))
  const monday = standup(base([done], events), '2026-11-09')
  assert.ok(monday.includes('Quinta') === false && monday.includes('Sexta:') === true)
})

test('sugestão de foco prioriza retorno, urgência e prazo', () => {
  const a = mk({ priority: 'urgente' })
  const b = mk({ returnOpen: true, returnedAt: at(TODAY), stage: 'doing' })
  const c = mk()
  const d = mk({ dueDate: '2026-11-05' })
  const s = suggestFocus([a, b, c, d], TODAY)
  assert.deepEqual(s.map((x) => x.id), [b.id, a.id, d.id])
})

test('captura de to-do: recorrência, horário e não pode esquecer', () => {
  const a = parseCapture('Ver fila do Zendesk todo dia às 9h @statix', TODAY, COMPANIES, 'pessoal')
  assert.equal(a.title, 'Ver fila do Zendesk')
  assert.equal(a.mode, 'daily')
  assert.equal(a.remindTime, '09:00')
  assert.equal(a.companyId, 'statix')
  assert.equal(a.target, 'todo')
  const b = parseCapture('não esquecer de mandar as horas sexta 17h30', TODAY, COMPANIES, 'livelo')
  assert.equal(b.title, 'mandar as horas')
  assert.ok(b.mustNotForget)
  assert.equal(b.remindTime, '17:30')
  assert.equal(b.mode, 'dated')
  assert.equal(b.dueDate, '2026-11-13')
  const c = parseCapture('Renovar CNH fixo !', TODAY, COMPANIES, 'pessoal')
  assert.equal(c.mode, 'fixed')
  assert.equal(c.priority, 'alta')
  const d = parseCapture('Revisar as 3 tabelas dias úteis', TODAY, COMPANIES, 'statix')
  assert.equal(d.title, 'Revisar as 3 tabelas')
  assert.ok(d.weekdaysOnly)
  assert.equal(d.remindTime, null)
  assert.equal(parseCapture('Corrigir #12', TODAY, COMPANIES, 'statix').target, 'work')
  assert.equal(parseCapture('Comprar pão', TODAY, COMPANIES, 'pessoal').target, null)
})

test('to-dos de hoje, fixos, próximos e diários por dia', () => {
  const daily = td({ mode: 'daily', title: 'Fila' })
  const util = td({ mode: 'daily', weekdaysOnly: true })
  const late = td({ mode: 'dated', dueDate: '2026-11-04' })
  const today = td({ mode: 'dated', dueDate: TODAY })
  const later = td({ mode: 'dated', dueDate: '2026-11-20' })
  const fixed = td()
  const fixedUrg = td({ priority: 'urgente' })
  const doneToday = td({ mode: 'dated', dueDate: '2026-11-01', doneAt: at(TODAY) })
  const all = [daily, util, late, today, later, fixed, fixedUrg, doneToday]
  const checks = [{ todoId: daily.id, date: TODAY }]
  const list = todayTodos(all, checks, TODAY)
  assert.deepEqual(new Set(list.map((x) => x.todo.id)), new Set([daily.id, util.id, late.id, today.id, fixedUrg.id, doneToday.id]))
  assert.equal(list[0].todo.id, late.id)
  assert.ok(list.find((x) => x.todo.id === daily.id)!.done)
  assert.ok(!todayTodos([util], [], '2026-11-07').length)
  assert.deepEqual(fixedTodos(all).map((t) => t.id), [fixedUrg.id, fixed.id])
  assert.deepEqual(upcomingTodos(all, TODAY).map((t) => t.id), [later.id])
})

test('não pode esquecer: devidos no topo, com horário futuro depois', () => {
  const now = `${TODAY}T10:00`
  const a = td({ mustNotForget: true, title: 'Sem hora' })
  const b = td({ mustNotForget: true, mode: 'daily', remindTime: '15:00' })
  const c = td({ mustNotForget: true, mode: 'dated', dueDate: '2026-11-05' })
  const d = td({ mustNotForget: true, mode: 'dated', dueDate: '2026-11-10' })
  const e = td({ mustNotForget: true, mode: 'daily' })
  const f = td({ mustNotForget: true, companyId: 'livelo' })
  const list = forgetList([a, b, c, d, e, f], [{ todoId: e.id, date: TODAY }], TODAY, now, 'pessoal')
  assert.deepEqual(list.map((x) => [x.todo.id, x.state]), [[a.id, 'due'], [c.id, 'due'], [b.id, 'later']])
  assert.equal(list[1].when, 'venceu ontem')
})

test('saúde: verde, amarelo, vermelho e progresso do dia', () => {
  const now = `${TODAY}T10:00`
  assert.equal(computeHealth(base([]), TODAY, now).level, 'green')
  assert.equal(computeHealth(base([]), TODAY, now).progress, 1)
  assert.equal(healthLabel(computeHealth(base([]), TODAY, now)), 'Tudo em dia por aqui')
  const val = mk({ stage: 'delivered', deliveredAt: at('2026-11-02') })
  const h1 = computeHealth(base([val]), TODAY, now)
  assert.equal(h1.level, 'amber')
  assert.equal(h1.blockers.length, 1)
  assert.equal(healthLabel(h1), 'Falta 1 coisa para ficar tudo verde')
  const f = td({ title: 'Rodar fechamento', mustNotForget: true })
  const h2 = computeHealth(base([val], [], [f]), TODAY, now)
  assert.equal(h2.level, 'red')
  assert.equal(h2.blockers[0].todoId, f.id)
  const daily = td({ mode: 'daily' })
  const won = mk({ stage: 'validated' })
  const events = [st(won.id, 'tested', 'validated', at(TODAY, 9)), ev(val.id, 'note', at(TODAY, 9))]
  const doneTodo = td({ doneAt: at(TODAY, 9), priority: 'urgente' })
  const s = base([val, won], events, [daily, doneTodo], [{ todoId: daily.id, date: TODAY }])
  assert.equal(handledToday(s, TODAY), 3)
  const pending = td({ mode: 'dated', dueDate: TODAY })
  const h3 = computeHealth({ ...s, todos: [...s.todos, pending] }, TODAY, now)
  assert.equal(h3.blockers.length, 2)
  assert.equal(h3.total, 5)
  assert.equal(Math.round(h3.progress * 100), 60)
  const stale = mk({ stage: 'doing', stageAt: at('2026-10-01') })
  assert.equal(computeHealth(base([stale], [], [td()]), TODAY, now).level, 'green')
  const later = td({ mustNotForget: true, mode: 'daily', remindTime: '18:00' })
  assert.equal(computeHealth(base([], [], [later]), TODAY, now).level, 'green')
})

test('sequência e mapa de dias sem punir dias sem registro', () => {
  const days = [
    { date: '2026-11-02', green: true, openCount: 0, handledCount: 2 },
    { date: '2026-11-03', green: false, openCount: 1, handledCount: 0 },
    { date: '2026-11-04', green: true, openCount: 0, handledCount: 1 },
    { date: '2026-11-05', green: true, openCount: 0, handledCount: 4 },
  ]
  assert.equal(streak(days, TODAY, true), 3)
  assert.equal(streak(days, TODAY, false), 2)
  assert.equal(streak(days, '2026-11-09', false), 2)
  assert.equal(streak([], TODAY, false), 0)
  const g = dayGrid(days, TODAY, true, 2)
  assert.equal(g.length, 2)
  const thisWeek = g[1]
  assert.deepEqual(thisWeek.map((c) => c.state), ['green', 'miss', 'green', 'green', 'green', 'future', 'future'])
})

test('notificações: lembrete na hora, prazo e validação de manhã, sem repetir', () => {
  const morning = new Date(`${TODAY}T09:30:00`)
  const early = new Date(`${TODAY}T07:00:00`)
  const r = td({ remindTime: '09:00', title: 'Subir o patch', companyId: 'statix', mustNotForget: true })
  const later = td({ remindTime: '18:00' })
  const doneDaily = td({ mode: 'daily', remindTime: '08:00' })
  const due = mk({ dueDate: TODAY, ticket: '#5' })
  const val = mk({ stage: 'delivered', deliveredAt: at('2026-11-02') })
  const s = base([due, val], [], [r, later, doneDaily], [{ todoId: doneDaily.id, date: TODAY }])
  const n = planNotifications(s, morning, {})
  assert.deepEqual(n.map((x) => x.key), [`todo:${r.id}:${TODAY}`, `due:${TODAY}`, `val:${TODAY}`])
  assert.equal(n[0].title, 'Não pode esquecer · Statix')
  assert.equal(n[0].body, 'Subir o patch')
  assert.ok(n[1].title.includes('1 com prazo hoje'))
  assert.equal(planNotifications(s, early, {}).length, 0)
  const sent = Object.fromEntries(n.map((x) => [x.key, TODAY]))
  assert.equal(planNotifications(s, morning, sent).length, 0)
  const off = { ...s, settings: { ...DEFAULT_SETTINGS, notifyReminders: false, notifyDue: false, notifyValidation: false } }
  assert.equal(planNotifications(off, morning, {}).length, 0)
  assert.deepEqual(Object.keys(pruneSent({ a: '2026-10-01', b: TODAY }, TODAY)), ['b'])
})

test('quadro: colunas, concluídos recentes e seleção por teclado', () => {
  const a = mk({ stage: 'todo', sort: 2 })
  const b = mk({ stage: 'todo', sort: 1 })
  const f = mk({ stage: 'todo', sort: 9, focusedAt: at(TODAY) })
  const d = mk({ stage: 'doing' })
  const old = mk({ stage: 'done', doneAt: at('2026-10-01') })
  const fresh = mk({ stage: 'done', doneAt: at(TODAY) })
  const other = mk({ stage: 'doing', companyId: 'livelo' })
  const cols = boardColumns([a, b, f, d, old, fresh, other], 'statix', TODAY)
  assert.deepEqual(cols[0].items.map((i) => i.id), [f.id, b.id, a.id])
  assert.deepEqual(cols[1].items.map((i) => i.id), [d.id])
  assert.deepEqual(cols[5].items.map((i) => i.id), [fresh.id])
  assert.equal(moveSelection(cols, null, 'down'), f.id)
  assert.equal(moveSelection(cols, f.id, 'down'), b.id)
  assert.equal(moveSelection(cols, f.id, 'up'), f.id)
  assert.equal(moveSelection(cols, a.id, 'right'), d.id)
  assert.equal(moveSelection(cols, d.id, 'right'), fresh.id)
  assert.equal(moveSelection(cols, fresh.id, 'right'), fresh.id)
  assert.equal(moveSelection([], null, 'down'), null)
})

test('tempo: sessões, por item, por empresa e formatos', () => {
  const a = mk({ companyId: 'statix' })
  const b = mk({ companyId: 'livelo' })
  const now = Date.parse(at(TODAY, 15))
  const ss: Session[] = [
    { id: 's1', itemId: a.id, startedAt: at(TODAY, 9), endedAt: at(TODAY, 10) },
    { id: 's2', itemId: b.id, startedAt: at('2026-11-05', 23), endedAt: at(TODAY, 1) },
    { id: 's3', itemId: a.id, startedAt: at(TODAY, 14), endedAt: null },
  ]
  assert.equal(runningSession(ss)?.id, 's3')
  assert.equal(itemTimeMs(ss, a.id, now), 2 * 36e5)
  const r = rangeTimeMs(ss, [a, b], TODAY, TODAY, now)
  assert.equal(r.statix, 2 * 36e5)
  assert.equal(r.livelo, 36e5)
  assert.equal(sumTime(r), 3 * 36e5)
  assert.equal(rangeTimeMs(ss, [a, b], TODAY, TODAY, now, 'livelo').statix, undefined)
  assert.equal(fmtDur(0), '0 min')
  assert.equal(fmtDur(25 * 6e4), '25 min')
  assert.equal(fmtDur(65 * 6e4), '1h05')
  assert.equal(fmtDur(120 * 6e4), '2h')
  assert.equal(fmtClock(65 * 1000), '1:05')
  assert.equal(fmtClock(3723 * 1000), '1:02:03')
})

test('régua do dia: pinos, prazos sem horário, sessões e faixa', () => {
  const now = new Date(`${TODAY}T10:30:00`)
  const t1 = td({ remindTime: '17:00', title: 'Mandar horas', mustNotForget: true })
  const t2 = td({ mode: 'daily', remindTime: '09:00' })
  const t3 = td({ mode: 'dated', dueDate: TODAY })
  const t4 = td({ mode: 'dated', dueDate: '2026-11-20', remindTime: '08:00' })
  const due = mk({ dueDate: TODAY, stage: 'doing' })
  const delivered = mk({ dueDate: TODAY, stage: 'delivered' })
  const s: Session[] = [{ id: 's', itemId: due.id, startedAt: at(TODAY, 7), endedAt: null }]
  const m = rulerModel({ items: [due, delivered], todos: [t1, t2, t3, t4], todoChecks: [{ todoId: t2.id, date: TODAY }], sessions: s }, TODAY, now)
  assert.deepEqual(m.pins.map((p) => [p.todoId, p.minute, p.kind, p.done]), [[t2.id, 540, 'todo', true], [t1.id, 1020, 'forget', false]])
  assert.deepEqual(m.allDay.map((p) => p.todoId ?? p.itemId), [t3.id, due.id])
  assert.equal(m.segments.length, 1)
  assert.equal(m.segments[0].start, 420)
  assert.equal(m.segments[0].end, 630)
  assert.ok(m.segments[0].running)
  assert.equal(m.startMin, 360)
  assert.equal(m.endMin, 1140)
  assert.equal(m.nowMin, 630)
})

test('cutucadas agrupam alertas em ações de um clique', () => {
  const v1 = mk({ stage: 'delivered', deliveredAt: at('2026-11-02') })
  const v2 = mk({ stage: 'tested', deliveredAt: at('2026-11-03') })
  const ret = mk({ stage: 'doing', returnOpen: true, returnedAt: at(TODAY) })
  const late = mk({ dueDate: '2026-11-01' })
  const n = nudges(computeAlerts(base([v1, v2, ret, late], [ev(ret.id, 'returned', at(TODAY), { note: 'bug' })]), TODAY))
  assert.equal(n[0].kind, 'returned')
  const val = n.find((x) => x.kind === 'validation')!
  assert.equal(val.text, '2 entregas sem validação há 3+ dias')
  assert.deepEqual(new Set(val.itemIds), new Set([v1.id, v2.id]))
  assert.deepEqual(val.action, { kind: 'followup', label: 'Cobrei todas' })
  const od = n.find((x) => x.kind === 'overdue')!
  assert.equal(od.action?.kind, 'due_tomorrow')
  assert.equal(od.itemIds.length, 1)
  assert.equal(nudges([]).length, 0)
})

test('placar da semana: entregas, validações e conclusões', () => {
  const a = mk()
  const b = mk({ companyId: 'livelo' })
  const events = [
    st(a.id, 'doing', 'delivered', at('2026-11-02')),
    st(a.id, 'delivered', 'validated', at('2026-11-03')),
    st(a.id, 'validated', 'done', at('2026-11-04')),
    st(b.id, 'doing', 'done', at('2026-11-05')),
    st(b.id, 'done', 'doing', at('2026-11-05', 13)),
    st(a.id, 'doing', 'delivered', at('2026-10-30')),
  ]
  const w = weekScore(base([a, b], events), TODAY)
  assert.equal(w.delivered, 2)
  assert.equal(w.validated, 1)
  assert.equal(w.done, 2)
  assert.deepEqual(w.byCompany, { statix: 1, livelo: 1 })
  assert.deepEqual(w.split.livelo, { delivered: 1, validated: 0, done: 1 })
  assert.equal(w.last, 'done')
  assert.equal(weekScore(base([a, b], events), TODAY, 'livelo').delivered, 1)
})

test('links de chamado: monta, reconhece URL colada e captura', () => {
  const i = mk({ ticket: '#9488' })
  assert.equal(ticketUrl(i, COMPANIES[0]), 'https://statix.zendesk.com/agent/tickets/9488')
  assert.equal(ticketUrl({ ...i, url: 'https://github.com/x/pull/1' }, COMPANIES[0]), 'https://github.com/x/pull/1')
  assert.equal(ticketUrl(i, COMPANIES[2]), null)
  assert.deepEqual(matchTicketUrl('https://statix.zendesk.com/agent/tickets/9501?tab=1', COMPANIES), { companyId: 'statix', ticket: '#9501' })
  assert.deepEqual(matchTicketUrl('https://jira.livelo.com.br/browse/LIV-77', COMPANIES), { companyId: 'livelo', ticket: 'LIV-77' })
  assert.equal(matchTicketUrl('https://example.com/a', COMPANIES), null)
  const c = parseCapture('Erro no fechamento https://statix.zendesk.com/agent/tickets/9600 !', TODAY, COMPANIES, 'livelo')
  assert.equal(c.ticket, '#9600')
  assert.equal(c.companyId, 'statix')
  assert.equal(c.title, 'Erro no fechamento')
  assert.equal(c.target, 'work')
  const d = parseCapture('Revisar PR https://github.com/acme/repo/pull/12', TODAY, COMPANIES, 'statix')
  assert.equal(d.url, 'https://github.com/acme/repo/pull/12')
  assert.equal(d.ticket, null)
})

test('SLA: resposta, resolução, pausa aguardando e alerta', () => {
  const co = COMPANIES[0]
  const created = at(TODAY, 8)
  const now = Date.parse(at(TODAY, 11)) + 30 * 6e4
  const fresh = mk({ ticket: '#1', createdAt: created })
  const s1 = slaFor(fresh, [], co, now)!
  assert.equal(s1.phase, 'response')
  assert.equal(s1.status, 'risk')
  assert.equal(Math.round(s1.remainingMs / 6e4), 30)
  const late = mk({ ticket: '#2', createdAt: at(TODAY, 6) })
  assert.equal(slaFor(late, [], co, now)!.status, 'breach')
  const answered = mk({ ticket: '#3', createdAt: created, stage: 'doing' })
  const s3 = slaFor(answered, [st(answered.id, 'todo', 'doing', at(TODAY, 9))], co, now)!
  assert.equal(s3.phase, 'resolution')
  assert.equal(s3.status, 'ok')
  const waiting = mk({ ticket: '#4', createdAt: created, waitingOn: 'Ana', waitingSince: at(TODAY, 9) })
  const s4 = slaFor(waiting, [ev(waiting.id, 'waiting', at(TODAY, 9))], co, now)!
  assert.equal(s4.status, 'paused')
  assert.equal(slaFor(mk({ createdAt: created }), [], co, now), null)
  assert.equal(slaFor(mk({ ticket: '#5', stage: 'delivered' }), [st('x', 'a' as never, 'b' as never, created)], { slaResponseMin: null, slaResolutionMin: 60 }, now), null)
  const alerts = computeAlerts({ ...base([fresh, late]), companies: COMPANIES }, TODAY, 'all', now)
  const sla = alerts.filter((a) => a.kind === 'sla')
  assert.equal(sla.length, 2)
  assert.equal(sla.find((a) => a.itemId === late.id)!.severity, 3)
  assert.deepEqual(sla.find((a) => a.itemId === fresh.id)!.action, { kind: 'respond', label: 'Respondi' })
})

test('relatório de horas: por dia, empresa, arredondamento, texto e CSV', () => {
  const a = mk({ ticket: '#9488', title: 'Divergência' })
  const b = mk({ companyId: 'livelo', ticket: 'LIV-1', title: 'Extrato; paginação' })
  const now = Date.parse(at(TODAY, 18))
  const sessions = [
    { id: 's1', itemId: a.id, startedAt: at(TODAY, 9), endedAt: new Date(Date.parse(at(TODAY, 10)) + 7 * 6e4).toISOString() },
    { id: 's2', itemId: b.id, startedAt: at(TODAY, 14), endedAt: new Date(Date.parse(at(TODAY, 14)) + 20 * 6e4).toISOString() },
    { id: 's3', itemId: a.id, startedAt: at('2026-11-05', 15), endedAt: at('2026-11-05', 16) },
  ]
  const st0 = { items: [a, b], sessions, companies: COMPANIES }
  const r = hoursReport(st0, TODAY, TODAY, 15, 'all', now)
  assert.equal(r.days.length, 1)
  assert.deepEqual(r.days[0].companies.map((c) => [c.companyId, c.minutes]), [['statix', 75], ['livelo', 30]])
  assert.equal(r.minutes, 105)
  assert.equal(roundMinutes(67, 0), 67)
  assert.equal(roundMinutes(0, 30), 0)
  assert.equal(fmtHours(105), '1h45')
  const txt = hoursText(r, COMPANIES)
  assert.ok(txt.includes('Statix — 1h15'))
  assert.ok(txt.includes('• #9488 Divergência — 1h15'))
  assert.ok(txt.endsWith('Total — 1h45'))
  const csv = hoursCsv(r, COMPANIES)
  assert.ok(csv.includes('Livelo;LIV-1;"Extrato; paginação";30;0,50'))
  const w = hoursReport(st0, '2026-11-02', '2026-11-08', 30, 'statix', now)
  assert.equal(w.days.length, 7)
  assert.equal(w.byCompany.statix, 60 + 90)
  assert.equal(w.byCompany.livelo, undefined)
  assert.equal(hoursText(hoursReport(st0, '2026-11-09', '2026-11-09', 0, 'all', now), COMPANIES), 'Nenhum tempo registrado no período.')
})

test('respostas rápidas, commit e busca', () => {
  const i = mk({ ticket: '#9488', title: 'Divergência no relatório', dueDate: TODAY, requester: 'Marcos', kind: 'bug' })
  const txt = renderSnippet('Oi {solicitante}, recebi o {chamado} ({titulo}). Retorno até {prazo}. {link} {nada}', i, COMPANIES[0], TODAY)
  assert.equal(txt, 'Oi Marcos, recebi o #9488 (Divergência no relatório). Retorno até hoje. https://statix.zendesk.com/agent/tickets/9488 {nada}')
  assert.equal(renderSnippet('{prazo}', { ...i, dueDate: '2026-11-13' }, COMPANIES[0], TODAY), '13/11')
  assert.equal(commitMessage(i), 'fix: divergência no relatório (#9488)')
  assert.equal(commitMessage({ kind: 'feature', title: 'Extrato', ticket: null }), 'feat: extrato')
  const other = mk({ title: 'Paginação do extrato', companyId: 'livelo' })
  const done = mk({ title: 'Relatório antigo', stage: 'done', doneAt: at(TODAY) })
  const t = td({ title: 'Mandar relatório de horas' })
  const events = [ev(other.id, 'note', at(TODAY), { note: 'falar com o time do relatório' })]
  const hits = searchWork({ items: [i, other, done], events, todos: [t], companies: COMPANIES }, 'relatório')
  assert.deepEqual(hits.map((h) => h.kind), ['item', 'item', 'todo', 'note'])
  assert.equal(hits[0].itemId, done.id)
  assert.equal(hits[1].itemId, i.id)
  assert.equal(searchWork({ items: [i, other], events: [], todos: [], companies: COMPANIES }, '9488')[0].score >= 100, true)
  assert.equal(searchWork({ items: [i], events: [], todos: [], companies: COMPANIES }, '  ').length, 0)
})

test('segmentos do medidor: feitos, pendentes e atrasados em ordem', () => {
  const now = `${TODAY}T10:00`
  const won = mk({ stage: 'validated', ticket: '#7' })
  const val = mk({ stage: 'delivered', deliveredAt: at('2026-11-02') })
  const late = td({ mode: 'dated', dueDate: '2026-11-01', title: 'Boleto' })
  const daily = td({ mode: 'daily', title: 'Fila' })
  const s = base([won, val], [st(won.id, 'tested', 'validated', at(TODAY, 9))], [late, daily], [{ todoId: daily.id, date: TODAY }])
  const entries = handledEntries(s, TODAY)
  assert.deepEqual(entries.map((e) => e.detail), ['foi para Validado', 'feito hoje'])
  const h = computeHealth(s, TODAY, now)
  assert.equal(h.done.length, 2)
  const segs = gaugeSegments(h)
  assert.deepEqual(segs.map((x) => x.state), ['done', 'done', 'pending', 'late'])
  assert.equal(segs[3].todoId, late.id)
  assert.equal(gaugeSegments(h, 3).length, 3)
})

test('resumo do medidor diz o que falta', () => {
  const now = `${TODAY}T10:00`
  assert.equal(healthSummary(computeHealth(base([]), TODAY, now)), 'Nada para resolver hoje')
  const r = td({ title: 'Mandar as horas', mustNotForget: true, remindTime: '09:00' })
  const won = mk({ stage: 'validated' })
  const s = base([won], [st(won.id, 'tested', 'validated', at(TODAY, 9))], [r])
  assert.equal(healthSummary(computeHealth(s, TODAY, now), s.todos), '1 de 2 resolvidas hoje · Mandar as horas (09:00) pendente')
})

test('abandono: sem olhar hoje, itens parados, atrasados e validação por empresa', () => {
  const old = at('2026-11-01')
  const stale = mk({ stage: 'doing', updatedAt: old, ticket: '#1' })
  const late = mk({ companyId: 'livelo', dueDate: '2026-11-04', updatedAt: at(TODAY) })
  const val = mk({ companyId: 'livelo', stage: 'delivered', deliveredAt: at('2026-11-03'), updatedAt: at(TODAY) })
  const events = [ev(stale.id, 'created', old), ev(late.id, 'created', at(TODAY, 9)), ev(val.id, 'created', at(TODAY, 9))]
  const morning = new Date(`${TODAY}T09:30:00`)
  const noon = new Date(`${TODAY}T12:00:00`)
  const st0 = { ...base([stale, late, val], events), seen: [{ companyId: 'livelo', seenAt: at(TODAY, 8) }] }
  const early = neglectFor(st0, morning)
  assert.equal(early.find((n) => n.companyId === 'statix')!.unseen, false)
  const list = neglectFor(st0, noon)
  const sx = list.find((n) => n.companyId === 'statix')!
  assert.ok(sx.unseen)
  assert.deepEqual(sx.signals.map((x) => x.kind), ['unseen', 'stale'])
  assert.equal(sx.signals[1].text, '1 item sem atualização há 3+ dias')
  const lv = list.find((n) => n.companyId === 'livelo')!
  assert.equal(lv.unseen, false)
  assert.deepEqual(lv.signals.map((x) => x.kind), ['overdue', 'validation'])
  assert.equal(list.find((n) => n.companyId === 'pessoal'), undefined)
  const saturday = neglectFor(st0, new Date('2026-11-07T12:00:00'))
  assert.equal(saturday.find((n) => n.companyId === 'statix')!.unseen, false)
  const nudges = neglectNudges(list, COMPANIES)
  assert.equal(nudges.length, 1)
  assert.equal(nudges[0].text, 'Statix: sem olhar hoje · 1 item sem atualização há 3+ dias')
  assert.deepEqual(nudges[0].action, { kind: 'open_company', label: 'Abrir Statix' })
  assert.equal(nudges[0].companyId, 'statix')
})

test('notificações de abandono, sem repetir e respeitando o silêncio', () => {
  const stale = mk({ stage: 'doing', updatedAt: at('2026-11-01') })
  const st0 = { ...base([stale], [ev(stale.id, 'created', at('2026-11-01'))]), seen: [] as { companyId: string; seenAt: string }[] }
  const noon = new Date(`${TODAY}T12:00:00`)
  const n = planNotifications(st0, noon, {})
  const keys = n.map((x) => x.key)
  assert.ok(keys.includes(`neglect:statix:${TODAY}`))
  assert.ok(keys.includes(`stale:statix:${TODAY}`))
  const digest = n.find((x) => x.key.startsWith('neglect:'))!
  assert.equal(digest.title, 'Statix: sem olhar hoje')
  assert.equal(digest.body, '1 item sem atualização há 3+ dias')
  assert.equal(digest.companyId, 'statix')
  const sent = Object.fromEntries(n.map((x) => [x.key, TODAY]))
  assert.equal(planNotifications(st0, noon, sent).filter((x) => x.key.includes('statix')).length, 0)
  assert.equal(planNotifications(st0, new Date(`${TODAY}T21:00:00`), {}).length, 0)
  assert.equal(planNotifications({ ...st0, settings: { ...DEFAULT_SETTINGS, notifyNeglect: false } }, noon, {}).some((x) => x.key.startsWith('neglect')), false)
  assert.equal(inQuiet(21, 20, 8), true)
  assert.equal(inQuiet(7, 20, 8), true)
  assert.equal(inQuiet(12, 20, 8), false)
  assert.equal(inQuiet(13, 12, 14), true)
  assert.equal(inQuiet(10, 9, 9), false)
})
