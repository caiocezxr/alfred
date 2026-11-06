import { addDays, civil, daysBetween, parseCivil, weekday } from '../../shared/dates.ts'
import type { ChecklistEntry, Company, DayMark, Kind, Priority, Session, Settings, Stage, Todo, TodoCheck, TodoMode, WorkEvent, WorkItem, WorkState } from './types.ts'
import { STAGES } from './types.ts'

export type Scope = 'all' | string

export const stageIndex = (s: Stage) => STAGES.indexOf(s)
export const isPost = (s: Stage) => stageIndex(s) >= 2
export const civilOf = (iso: string) => civil(new Date(iso))
export const daysSince = (iso: string, today: string) => Math.max(0, daysBetween(civilOf(iso), today))
export const inScope = (scope: Scope, companyId: string) => scope === 'all' || scope === companyId
export const label = (i: Pick<WorkItem, 'ticket' | 'title'>) => (i.ticket ? `${i.ticket} ${i.title}` : i.title)

const latest = (...xs: (string | null | undefined)[]) =>
  xs.filter((x): x is string => !!x).sort().at(-1) ?? null

export function pendingChecks(item: WorkItem, checklist: ChecklistEntry[]): ChecklistEntry[] {
  if (item.kind === 'pendencia') return []
  return checklist.filter((c) => c.companyId === item.companyId && !item.checks.includes(c.id))
}

export function checklistFor(companyId: string, checklist: ChecklistEntry[]) {
  return checklist.filter((c) => c.companyId === companyId).sort((a, b) => a.sort - b.sort)
}

export const crossesDelivery = (from: Stage, to: Stage) => !isPost(from) && isPost(to)

export function fold(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function normTicket(t: string) {
  return fold(t.trim().replace(/^#/, ''))
}

export function findDuplicate(items: WorkItem[], companyId: string, ticket: string | null): WorkItem | null {
  if (!ticket) return null
  const t = normTicket(ticket)
  return items.find((i) => i.companyId === companyId && i.stage !== 'done' && i.ticket && normTicket(i.ticket) === t) ?? null
}

export type DueState = 'late' | 'today' | 'soon' | 'later'

export function dueState(item: Pick<WorkItem, 'dueDate' | 'stage'>, today: string): DueState | null {
  if (!item.dueDate || item.stage === 'done') return null
  const d = daysBetween(today, item.dueDate)
  if (isPost(item.stage)) return d < 0 ? null : d === 0 ? 'today' : d <= 2 ? 'soon' : 'later'
  if (d < 0) return 'late'
  if (d === 0) return 'today'
  if (d <= 2) return 'soon'
  return 'later'
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  dom: 0,
  seg: 1,
  ter: 2,
  qua: 3,
  qui: 4,
  sex: 5,
  sab: 6,
}

export function parseDateWord(word: string, today: string): string | null {
  const w = fold(word).replace(/-feira$/, '')
  if (w === 'hoje') return today
  if (w === 'amanha') return addDays(today, 1)
  if (w === 'depois-de-amanha') return addDays(today, 2)
  if (w in WEEKDAYS) {
    const diff = (WEEKDAYS[w] - weekday(today) + 7) % 7 || 7
    return addDays(today, diff)
  }
  const m = w.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(today.slice(0, 4))
    const make = (y: number) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const check = (s: string) => civil(parseCivil(s)) === s
    let out = make(year)
    if (!check(out)) return null
    if (!m[3] && out < today) {
      year += 1
      out = make(year)
      if (!check(out)) return null
    }
    return out
  }
  return null
}

const KIND_WORDS: Record<string, Kind> = {
  bug: 'bug',
  feature: 'feature',
  feat: 'feature',
  melhoria: 'melhoria',
  pendencia: 'pendencia',
  chamado: 'chamado',
}

export type Capture = {
  title: string
  companyId: string
  companyExplicit: boolean
  ticket: string | null
  priority: Priority
  dueDate: string | null
  kind: Kind | null
  system: string | null
  mode: TodoMode | null
  weekdaysOnly: boolean
  remindTime: string | null
  mustNotForget: boolean
  target: 'todo' | 'work' | null
}

export function matchCompany(token: string, companies: Company[]): Company | null {
  const t = fold(token)
  if (!t) return null
  return (
    companies.find((c) => c.id === t || fold(c.name) === t) ??
    companies.find((c) => c.id.startsWith(t) || fold(c.name).startsWith(t)) ??
    null
  )
}

export function parseCapture(raw: string, today: string, companies: Company[], fallbackCompany: string, systems: string[] = []): Capture {
  let companyId = fallbackCompany
  let companyExplicit = false
  let ticket: string | null = null
  let priority: Priority = 'normal'
  let kind: Kind | null = null
  let system: string | null = null
  let mode: TodoMode | null = null
  let weekdaysOnly = false
  let remindTime: string | null = null
  let mustNotForget = false
  let text = ` ${raw.trim()} `
  const take = (re: RegExp) => {
    const m = text.match(re)
    if (m) text = text.replace(re, ' ')
    return m
  }
  if (take(/\s(dias [uú]teis|todo dia [uú]til)(?=\s)/i)) {
    mode = 'daily'
    weekdaysOnly = true
  } else if (take(/\s(todo dia|todos os dias|diariamente|di[aá]rio)(?=\s)/i)) mode = 'daily'
  else if (take(/\sfixo(?=\s)/i)) mode = 'fixed'
  if (take(/^\s+n[aã]o (pode )?esquecer:?\s+(de\s+)?/i) || take(/\s+n[aã]o (pode )?esquecer\s*$/i)) {
    mustNotForget = true
    text = ` ${text.trim()} `
  }
  const time =
    take(/\sàs\s+(\d{1,2})(?:h(\d{2})?|:(\d{2}))?(?=\s)/i) ??
    take(/\sas\s+(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?=\s)/i) ??
    take(/\s(\d{1,2})(?:h(\d{2})?|:(\d{2}))\s*$/i)
  if (time) {
    const h = Number(time[1])
    const m = Number(time[2] ?? time[3] ?? 0)
    if (h < 24 && m < 60) remindTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    else text = text + time[0]
  }
  const rest: string[] = []
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    const at = tok.match(/^@([\p{L}\d-]+)$/u)
    if (at) {
      const c = matchCompany(at[1], companies)
      if (c) {
        companyId = c.id
        companyExplicit = true
        continue
      }
    }
    if (!ticket && (/^#\d[\w.-]*$/.test(tok) || /^#[A-Za-z][A-Za-z0-9]*-\d+$/.test(tok))) {
      ticket = tok
      continue
    }
    if (!ticket && /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(tok)) {
      ticket = tok
      continue
    }
    if (tok === '!!' || tok === '!!!') {
      priority = 'urgente'
      continue
    }
    if (tok === '!') {
      if (priority !== 'urgente') priority = 'alta'
      continue
    }
    const sl = tok.match(/^\/([\p{L}]+)$/u)
    if (sl && fold(sl[1]) in KIND_WORDS) {
      kind = KIND_WORDS[fold(sl[1])]
      continue
    }
    const plus = tok.match(/^\+([\p{L}\d][\p{L}\d._-]*)$/u)
    if (plus) {
      system = systems.find((s) => fold(s) === fold(plus[1])) ?? plus[1]
      continue
    }
    rest.push(tok)
  }
  let dueDate: string | null = null
  if (rest.length > 1) {
    const last = rest[rest.length - 1]
    const twoWords = rest.length > 2 ? `${rest[rest.length - 3]}-${rest[rest.length - 2]}-${last}` : ''
    const d3 = twoWords && fold(twoWords) === 'depois-de-amanha' ? addDays(today, 2) : null
    if (d3) {
      dueDate = d3
      rest.splice(rest.length - 3, 3)
    } else {
      const d = parseDateWord(last, today)
      if (d) {
        dueDate = d
        rest.pop()
      }
    }
    if (dueDate && rest.length > 1 && /^(ate|pra|para|p\/)$/.test(fold(rest[rest.length - 1]))) rest.pop()
  }
  if (mode === 'daily') dueDate = null
  if (!mode && dueDate) mode = 'dated'
  const target = ticket || kind || system ? 'work' : mode || remindTime || mustNotForget ? 'todo' : null
  return { title: rest.join(' ').trim(), companyId, companyExplicit, ticket, priority, dueDate, kind, system, mode, weekdaysOnly, remindTime, mustNotForget, target }
}

export type AlertKind = 'returned' | 'overdue' | 'due_today' | 'validation' | 'waiting' | 'unchecked' | 'close' | 'stale' | 'wip'
export type AlertAction = 'followup' | 'resume' | 'snooze' | 'due_tomorrow' | 'focus' | 'close' | 'open' | 'show_doing'

export type Alert = {
  id: string
  kind: AlertKind
  severity: 1 | 2 | 3
  itemId: string | null
  companyId: string | null
  title: string
  detail: string
  action: { kind: AlertAction; label: string } | null
  days: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const ago = (n: number) => (n === 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`)

function lastDeliveryEvent(events: WorkEvent[], itemId: string): WorkEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.itemId !== itemId) continue
    if (e.kind === 'returned') return null
    if (e.kind === 'stage' && e.fromStage && e.toStage && crossesDelivery(e.fromStage, e.toStage)) return e
  }
  return null
}

export function computeAlerts(state: Pick<WorkState, 'items' | 'events' | 'checklist' | 'settings'>, today: string, scope: Scope = 'all'): Alert[] {
  const s: Settings = state.settings
  const out: Alert[] = []
  const items = state.items.filter((i) => inScope(scope, i.companyId) && i.stage !== 'done')
  for (const i of items) {
    const snoozed = !!i.snoozedUntil && i.snoozedUntil > today
    const base = { itemId: i.id, companyId: i.companyId, title: label(i) }
    if (i.returnOpen && i.returnedAt) {
      const d = daysSince(i.returnedAt, today)
      if (d >= s.returnDays && !snoozed) {
        const reason = [...state.events].reverse().find((e) => e.itemId === i.id && e.kind === 'returned')?.note
        out.push({
          ...base,
          id: `returned:${i.id}`,
          kind: 'returned',
          severity: 3,
          detail: `Voltou ${ago(d)} e ainda não foi retomado${reason ? ` · ${reason}` : ''}`,
          action: { kind: 'resume', label: 'Retomei' },
          days: d,
        })
      }
    }
    const due = dueState(i, today)
    if (due === 'late' && i.dueDate) {
      const d = daysBetween(i.dueDate, today)
      out.push({
        ...base,
        id: `overdue:${i.id}`,
        kind: 'overdue',
        severity: 3,
        detail: `Prazo venceu ${ago(d)}${i.requester ? ` · avise ${i.requester}` : ''}`,
        action: { kind: 'due_tomorrow', label: 'Prazo p/ amanhã' },
        days: d,
      })
    } else if (due === 'today' && !isPost(i.stage)) {
      out.push({
        ...base,
        id: `due_today:${i.id}`,
        kind: 'due_today',
        severity: 2,
        detail: i.stage === 'todo' ? 'Prazo é hoje e ainda nem começou' : 'Prazo é hoje',
        action: i.focusedAt ? { kind: 'open', label: 'Abrir' } : { kind: 'focus', label: 'Pôr no foco' },
        days: 0,
      })
    }
    if (snoozed) continue
    if (i.waitingOn && i.waitingSince) {
      const d = daysSince(latest(i.waitingSince, i.followupAt)!, today)
      if (d >= s.waitingDays) {
        const since = daysSince(i.waitingSince, today)
        out.push({
          ...base,
          id: `waiting:${i.id}`,
          kind: 'waiting',
          severity: 2,
          detail: `Aguardando ${i.waitingOn} ${ago(since)}${i.followupAt ? ` · última cobrança ${ago(d)}` : ''}`,
          action: { kind: 'followup', label: 'Cobrei hoje' },
          days: since,
        })
      }
    }
    if ((i.stage === 'delivered' || i.stage === 'tested') && i.deliveredAt) {
      const d = daysSince(latest(i.deliveredAt, i.followupAt)!, today)
      if (d >= s.validationDays) {
        const since = daysSince(i.deliveredAt, today)
        out.push({
          ...base,
          id: `validation:${i.id}`,
          kind: 'validation',
          severity: 2,
          detail: `Entregue ${ago(since)}, sem validação${i.requester ? ` · cobrar ${i.requester}` : ''}${i.followupAt ? ` · cobrado ${ago(d)}` : ''}`,
          action: { kind: 'followup', label: 'Cobrei hoje' },
          days: since,
        })
      }
      const ev = lastDeliveryEvent(state.events, i.id)
      const pend = pendingChecks(i, state.checklist).length
      if (ev && (ev.pending ?? 0) > 0 && pend > 0) {
        out.push({
          ...base,
          id: `unchecked:${i.id}`,
          kind: 'unchecked',
          severity: 2,
          detail: `Entregue com ${plural(pend, 'item', 'itens')} do checklist em aberto`,
          action: { kind: 'open', label: 'Conferir' },
          days: daysSince(ev.at, today),
        })
      }
    }
    if (i.stage === 'validated' && i.validatedAt) {
      const d = daysSince(i.validatedAt, today)
      if (d >= s.closeDays) {
        out.push({
          ...base,
          id: `close:${i.id}`,
          kind: 'close',
          severity: 1,
          detail: `Validado ${ago(d)} e ainda aberto · falta fechar o chamado?`,
          action: { kind: 'close', label: 'Concluir' },
          days: d,
        })
      }
    }
    if (i.stage === 'doing' && !i.waitingOn && !i.returnOpen) {
      const lastEv = [...state.events].reverse().find((e) => e.itemId === i.id && e.kind !== 'due')?.at
      const d = daysSince(latest(i.stageAt, lastEv, i.followupAt)!, today)
      if (d >= s.staleDays) {
        out.push({
          ...base,
          id: `stale:${i.id}`,
          kind: 'stale',
          severity: 1,
          detail: `Em Fazendo há ${d} dias sem nenhum movimento`,
          action: { kind: 'snooze', label: 'Adiar 3 dias' },
          days: d,
        })
      }
    }
  }
  const doing = items.filter((i) => i.stage === 'doing').length
  if (doing > s.wipLimit) {
    out.push({
      id: 'wip',
      kind: 'wip',
      severity: 2,
      itemId: null,
      companyId: scope === 'all' ? null : scope,
      title: `${doing} coisas em andamento ao mesmo tempo`,
      detail: `Seu limite é ${s.wipLimit}. Termine ou pause algo antes de puxar mais.`,
      action: { kind: 'show_doing', label: 'Ver Fazendo' },
      days: 0,
    })
  }
  return out.sort((a, b) => b.severity - a.severity || b.days - a.days)
}

const FOCUS_SCORE = (i: WorkItem, today: string) => {
  const due = dueState(i, today)
  return (
    (i.returnOpen ? 6 : 0) +
    (i.priority === 'urgente' ? 5 : i.priority === 'alta' ? 2 : 0) +
    (due === 'late' ? 5 : due === 'today' ? 4 : due === 'soon' ? 2 : 0) +
    (i.stage === 'doing' ? 1 : 0)
  )
}

export function suggestFocus(items: WorkItem[], today: string, scope: Scope = 'all', n = 3): WorkItem[] {
  return items
    .filter((i) => inScope(scope, i.companyId) && !i.focusedAt && !isPost(i.stage) && !i.waitingOn)
    .map((i) => ({ i, s: FOCUS_SCORE(i, today) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.i)
}

export type Cycle = {
  itemId: string
  deliveredAt: string
  testedAt: string | null
  validatedAt: string | null
  doneAt: string | null
  validatedSeparately: boolean
  returned: boolean
  returnReason: string | null
  pending: number
}

export function deliveryCycles(events: WorkEvent[]): Cycle[] {
  const open = new Map<string, Cycle>()
  const out: Cycle[] = []
  for (const e of events) {
    const cur = open.get(e.itemId)
    if (e.kind === 'returned') {
      if (cur) {
        cur.returned = true
        cur.returnReason = e.note
        open.delete(e.itemId)
      }
      continue
    }
    if (e.kind !== 'stage' || !e.fromStage || !e.toStage) continue
    if (crossesDelivery(e.fromStage, e.toStage)) {
      const c: Cycle = {
        itemId: e.itemId,
        deliveredAt: e.at,
        testedAt: e.toStage === 'tested' ? e.at : null,
        validatedAt: e.toStage === 'validated' || e.toStage === 'done' ? e.at : null,
        doneAt: e.toStage === 'done' ? e.at : null,
        validatedSeparately: false,
        returned: false,
        returnReason: null,
        pending: e.pending ?? 0,
      }
      open.set(e.itemId, c)
      out.push(c)
      continue
    }
    if (!cur) continue
    if (!isPost(e.toStage)) {
      out.splice(out.indexOf(cur), 1)
      open.delete(e.itemId)
      continue
    }
    if (e.toStage === 'tested') cur.testedAt = e.at
    if ((e.toStage === 'validated' || e.toStage === 'done') && !cur.validatedAt) {
      cur.validatedAt = e.at
      cur.validatedSeparately = true
    }
    if (e.toStage === 'done') cur.doneAt = e.at
  }
  return out
}

export function weekStart(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7))
}

export type WeekBucket = { start: string; total: number; byCompany: Record<string, number> }

export type Metrics = {
  weeks: WeekBucket[]
  thisWeek: number
  returnRate: { delivered: number; returned: number; pct: number | null }
  validation: { avgDays: number | null; n: number }
  systems: { name: string; count: number }[]
  doneLast7: number
}

export function computeMetrics(state: Pick<WorkState, 'items' | 'events'>, today: string, scope: Scope = 'all', weeks = 8): Metrics {
  const byId = new Map(state.items.map((i) => [i.id, i]))
  const cycles = deliveryCycles(state.events).filter((c) => {
    const it = byId.get(c.itemId)
    return it && inScope(scope, it.companyId)
  })
  const first = weekStart(today)
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, k) => ({ start: addDays(first, -7 * (weeks - 1 - k)), total: 0, byCompany: {} }))
  for (const c of cycles) {
    const ws = weekStart(civilOf(c.deliveredAt))
    const b = buckets.find((x) => x.start === ws)
    if (!b) continue
    const co = byId.get(c.itemId)!.companyId
    b.total += 1
    b.byCompany[co] = (b.byCompany[co] ?? 0) + 1
  }
  const since60 = addDays(today, -60)
  const recent = cycles.filter((c) => civilOf(c.deliveredAt) >= since60)
  const returned = recent.filter((c) => c.returned).length
  const lead = cycles.filter((c) => c.validatedSeparately && c.validatedAt && civilOf(c.validatedAt) >= since60)
  const avg = lead.length
    ? Math.round((lead.reduce((s, c) => s + (Date.parse(c.validatedAt!) - Date.parse(c.deliveredAt)), 0) / lead.length / 864e5) * 10) / 10
    : null
  const since30 = addDays(today, -30)
  const sys = new Map<string, number>()
  for (const c of cycles) {
    if (civilOf(c.deliveredAt) < since30) continue
    const name = byId.get(c.itemId)!.system ?? 'Sem sistema'
    sys.set(name, (sys.get(name) ?? 0) + 1)
  }
  const since7 = addDays(today, -6)
  const doneLast7 = state.items.filter((i) => inScope(scope, i.companyId) && i.doneAt && civilOf(i.doneAt) >= since7).length
  return {
    weeks: buckets,
    thisWeek: buckets[buckets.length - 1].total,
    returnRate: { delivered: recent.length, returned, pct: recent.length ? Math.round((returned / recent.length) * 100) : null },
    validation: { avgDays: avg, n: lead.length },
    systems: [...sys.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5),
    doneLast7,
  }
}

export type DeliveryWeek = { start: string; cycles: (Cycle & { item: WorkItem })[] }

export function deliveryWeeks(state: Pick<WorkState, 'items' | 'events'>, scope: Scope = 'all', limit = 12): DeliveryWeek[] {
  const byId = new Map(state.items.map((i) => [i.id, i]))
  const map = new Map<string, DeliveryWeek>()
  for (const c of deliveryCycles(state.events)) {
    const item = byId.get(c.itemId)
    if (!item || !inScope(scope, item.companyId)) continue
    const ws = weekStart(civilOf(c.deliveredAt))
    const w = map.get(ws) ?? { start: ws, cycles: [] }
    w.cycles.push({ ...c, item })
    map.set(ws, w)
  }
  return [...map.values()]
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, limit)
    .map((w) => ({ ...w, cycles: w.cycles.sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt)) }))
}

export type RecentEntry = { event: WorkEvent; item: WorkItem }

export function recentWins(state: Pick<WorkState, 'items' | 'events'>, scope: Scope = 'all', n = 12): RecentEntry[] {
  const byId = new Map(state.items.map((i) => [i.id, i]))
  const out: RecentEntry[] = []
  for (let k = state.events.length - 1; k >= 0 && out.length < n; k--) {
    const e = state.events[k]
    if (e.kind !== 'stage' || !e.toStage || !isPost(e.toStage)) continue
    if (e.fromStage && stageIndex(e.toStage) < stageIndex(e.fromStage)) continue
    const item = byId.get(e.itemId)
    if (item && inScope(scope, item.companyId)) out.push({ event: e, item })
  }
  return out
}

export function previousWorkday(today: string): string {
  const wd = weekday(today)
  if (wd === 1) return addDays(today, -3)
  if (wd === 0) return addDays(today, -2)
  return addDays(today, -1)
}

const WEEKDAY_NAME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function verbFor(e: WorkEvent): string | null {
  if (e.kind === 'returned') return `voltou (${e.note})`
  if (e.kind === 'resumed') return 'retomei'
  if (e.kind === 'unblocked') return 'desbloqueou'
  if (e.kind === 'followup') return 'cobrei retorno'
  if (e.kind !== 'stage' || !e.toStage) return null
  if (e.fromStage && stageIndex(e.toStage) < stageIndex(e.fromStage) && e.toStage !== 'doing') return null
  switch (e.toStage) {
    case 'doing':
      return e.fromStage === 'todo' ? 'comecei' : null
    case 'delivered':
      return 'entreguei'
    case 'tested':
      return 'testei'
    case 'validated':
      return 'validado'
    case 'done':
      return 'concluído'
    default:
      return null
  }
}

export function standup(state: Pick<WorkState, 'items' | 'events' | 'companies'>, today: string, scope: Scope = 'all'): string {
  const from = previousWorkday(today)
  const yesterdayLabel = from === addDays(today, -1) ? 'Ontem' : WEEKDAY_NAME[weekday(from)][0].toUpperCase() + WEEKDAY_NAME[weekday(from)].slice(1)
  const byId = new Map(state.items.map((i) => [i.id, i]))
  const blocks: string[] = []
  for (const co of state.companies) {
    if (!inScope(scope, co.id)) continue
    const items = state.items.filter((i) => i.companyId === co.id)
    if (!items.length) continue
    const did = new Map<string, string[]>()
    for (const e of state.events) {
      const day = civilOf(e.at)
      if (day < from || day >= today) continue
      const it = byId.get(e.itemId)
      if (!it || it.companyId !== co.id) continue
      const v = verbFor(e)
      if (!v) continue
      const list = did.get(it.id) ?? []
      if (!list.includes(v)) list.push(v)
      did.set(it.id, list)
    }
    const ontem = [...did.entries()].map(([id, vs]) => `• ${label(byId.get(id)!)} — ${vs.join(', ')}`)
    const hojeIds: string[] = []
    const push = (i: WorkItem) => !hojeIds.includes(i.id) && hojeIds.push(i.id)
    items.filter((i) => i.focusedAt && i.stage !== 'done').sort((a, b) => a.focusedAt!.localeCompare(b.focusedAt!)).forEach(push)
    items.filter((i) => i.returnOpen).forEach(push)
    items.filter((i) => i.stage === 'doing' && !i.waitingOn).forEach(push)
    items.filter((i) => i.stage === 'todo' && i.dueDate && i.dueDate <= today).forEach(push)
    const hoje = hojeIds.map((id) => {
      const i = byId.get(id)!
      const tags = [i.returnOpen ? 'ajuste do retorno' : '', i.dueDate && i.dueDate <= today && !isPost(i.stage) ? 'prazo hoje' : ''].filter(Boolean)
      return `• ${label(i)}${tags.length ? ` (${tags.join(', ')})` : ''}`
    })
    const bloq: string[] = []
    for (const i of items) {
      if (i.stage === 'done') continue
      if (i.waitingOn && i.waitingSince) bloq.push(`• ${label(i)} — aguardando ${i.waitingOn} ${ago(daysSince(i.waitingSince, today))}`)
      else if ((i.stage === 'delivered' || i.stage === 'tested') && i.deliveredAt) {
        const d = daysSince(i.deliveredAt, today)
        if (d >= 1) bloq.push(`• ${label(i)} — aguardando validação${i.requester ? ` de ${i.requester}` : ''} (entregue ${ago(d)})`)
      }
    }
    if (!ontem.length && !hoje.length && !bloq.length) continue
    blocks.push(
      [
        co.name,
        `${yesterdayLabel}:`,
        ...(ontem.length ? ontem : ['• nada registrado']),
        'Hoje:',
        ...(hoje.length ? hoje : ['• a definir']),
        'Bloqueios:',
        ...(bloq.length ? bloq : ['• nenhum']),
      ].join('\n'),
    )
  }
  return blocks.length ? blocks.join('\n\n') : 'Nada registrado ainda.'
}

export type Counts = { todo: number; doing: number; waiting: number; validation: number; returned: number; late: number }

export function countsFor(items: WorkItem[], companyId: string, today: string): Counts {
  const mine = items.filter((i) => i.companyId === companyId && i.stage !== 'done')
  return {
    todo: mine.filter((i) => i.stage === 'todo').length,
    doing: mine.filter((i) => i.stage === 'doing').length,
    waiting: mine.filter((i) => i.waitingOn).length,
    validation: mine.filter((i) => i.stage === 'delivered' || i.stage === 'tested').length,
    returned: mine.filter((i) => i.returnOpen).length,
    late: mine.filter((i) => dueState(i, today) === 'late').length,
  }
}

const dayTime = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dayOnly = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
const timeOnly = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const clean = (s: string) => s.replace(/\./g, '')

export function when(iso: string, today = civil()): string {
  const d = civilOf(iso)
  const diff = daysBetween(d, today)
  const t = timeOnly.format(new Date(iso))
  if (diff === 0) return `hoje, ${t}`
  if (diff === 1) return `ontem, ${t}`
  if (diff > 1 && diff < 7) return `${WEEKDAY_NAME[weekday(d)].slice(0, 3)}, ${t}`
  return clean(dayTime.format(new Date(iso)))
}

export function shortDay(iso: string, today = civil()): string {
  const d = civilOf(iso)
  const diff = daysBetween(d, today)
  if (diff === 0) return 'hoje'
  if (diff === 1) return 'ontem'
  if (diff > 1 && diff < 7) return WEEKDAY_NAME[weekday(d)].slice(0, 3)
  return clean(dayOnly.format(new Date(iso)))
}

export function dueLabel(due: string, today: string): string {
  const d = daysBetween(today, due)
  if (d === 0) return 'hoje'
  if (d === 1) return 'amanhã'
  if (d === -1) return 'ontem'
  if (d < 0) return `${-d} dias atrás`
  if (d < 7) return WEEKDAY_NAME[weekday(due)].slice(0, 3)
  return clean(dayOnly.format(parseCivil(due)))
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function localNow(d = new Date()): string {
  return `${civil(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export const isWorkday = (day: string) => weekday(day) >= 1 && weekday(day) <= 5

export function todoAppliesOn(t: Todo, day: string): boolean {
  if (t.mode === 'daily') return !t.weekdaysOnly || isWorkday(day)
  if (t.mode === 'dated') return !!t.dueDate && t.dueDate <= day
  return true
}

export function todoDoneOn(t: Todo, checks: TodoCheck[], day: string): boolean {
  if (t.mode === 'daily') return checks.some((c) => c.todoId === t.id && c.date === day)
  return !!t.doneAt
}

const inSpace = (scope: Scope, companyId: string | null) => scope === 'all' || companyId === scope

export type TodayTodo = { todo: Todo; done: boolean; late: boolean; forget: boolean }

export function todayTodos(todos: Todo[], checks: TodoCheck[], today: string, scope: Scope = 'all'): TodayTodo[] {
  const out: TodayTodo[] = []
  for (const t of todos) {
    if (!inSpace(scope, t.companyId)) continue
    if (t.mode === 'daily') {
      if (!todoAppliesOn(t, today)) continue
      out.push({ todo: t, done: todoDoneOn(t, checks, today), late: false, forget: t.mustNotForget })
    } else if (t.mode === 'dated') {
      if (t.doneAt) {
        if (civilOf(t.doneAt) === today) out.push({ todo: t, done: true, late: false, forget: t.mustNotForget })
      } else if (t.dueDate! <= today) out.push({ todo: t, done: false, late: t.dueDate! < today, forget: t.mustNotForget })
    } else if (!t.doneAt ? t.mustNotForget || t.priority === 'urgente' : civilOf(t.doneAt) === today && (t.mustNotForget || t.priority === 'urgente')) {
      out.push({ todo: t, done: !!t.doneAt, late: false, forget: t.mustNotForget })
    }
  }
  const rank = (x: TodayTodo) => (x.done ? 100 : 0) + (x.late ? 0 : 20) + (x.forget ? 0 : 10) + (x.todo.priority === 'urgente' ? 0 : x.todo.priority === 'alta' ? 1 : 2)
  return out.sort((a, b) => rank(a) - rank(b) || a.todo.sort - b.todo.sort)
}

export function fixedTodos(todos: Todo[], scope: Scope = 'all'): Todo[] {
  const p = (t: Todo) => (t.mustNotForget ? 0 : 1) + (t.priority === 'urgente' ? 0 : t.priority === 'alta' ? 1 : 2)
  return todos.filter((t) => inSpace(scope, t.companyId) && t.mode === 'fixed' && !t.doneAt).sort((a, b) => p(a) - p(b) || a.sort - b.sort)
}

export function upcomingTodos(todos: Todo[], today: string, scope: Scope = 'all'): Todo[] {
  return todos
    .filter((t) => inSpace(scope, t.companyId) && t.mode === 'dated' && !t.doneAt && t.dueDate! > today)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.sort - b.sort)
}

export type ForgetEntry = { todo: Todo; state: 'due' | 'later'; when: string }

export function forgetList(todos: Todo[], checks: TodoCheck[], today: string, nowLocal: string, scope: Scope = 'all'): ForgetEntry[] {
  const time = nowLocal.slice(11, 16)
  const out: ForgetEntry[] = []
  for (const t of todos) {
    if (!t.mustNotForget || !inSpace(scope, t.companyId)) continue
    if (!todoAppliesOn(t, today) || todoDoneOn(t, checks, today)) continue
    const lateDay = t.mode === 'dated' && t.dueDate! < today
    const later = !lateDay && !!t.remindTime && t.remindTime > time
    const when =
      t.mode === 'dated' && t.dueDate! < today
        ? `venceu ${daysBetween(t.dueDate!, today) === 1 ? 'ontem' : `há ${daysBetween(t.dueDate!, today)} dias`}`
        : t.remindTime
          ? `hoje, ${t.remindTime}`
          : t.mode === 'daily'
            ? 'hoje'
            : t.mode === 'fixed'
              ? 'até resolver'
              : 'hoje'
    out.push({ todo: t, state: later ? 'later' : 'due', when })
  }
  return out.sort((a, b) => (a.state === b.state ? (a.todo.remindTime ?? '').localeCompare(b.todo.remindTime ?? '') : a.state === 'due' ? -1 : 1))
}

export type Blocker = {
  id: string
  severity: 2 | 3
  title: string
  detail: string
  itemId: string | null
  todoId: string | null
  companyId: string | null
  alert: Alert | null
}

export type Health = {
  level: 'green' | 'amber' | 'red'
  blockers: Blocker[]
  handled: number
  total: number
  progress: number
}

const isForward = (e: WorkEvent) => e.kind === 'stage' && !!e.fromStage && !!e.toStage && stageIndex(e.toStage) > stageIndex(e.fromStage)

type HealthInput = Pick<WorkState, 'items' | 'events' | 'checklist' | 'settings' | 'todos' | 'todoChecks'>

export function handledToday(state: Pick<WorkState, 'items' | 'events' | 'todos' | 'todoChecks'>, today: string, scope: Scope = 'all'): number {
  const byId = new Map(state.items.map((i) => [i.id, i]))
  let n = 0
  for (const e of state.events) {
    if (civilOf(e.at) !== today) continue
    const it = byId.get(e.itemId)
    if (!it || !inScope(scope, it.companyId)) continue
    if (isForward(e) || e.kind === 'followup' || e.kind === 'resumed' || e.kind === 'unblocked') n++
  }
  const todoById = new Map(state.todos.map((t) => [t.id, t]))
  for (const c of state.todoChecks) {
    const t = todoById.get(c.todoId)
    if (c.date === today && t && inSpace(scope, t.companyId)) n++
  }
  for (const t of state.todos) {
    if (t.mode !== 'daily' && t.doneAt && civilOf(t.doneAt) === today && inSpace(scope, t.companyId)) n++
  }
  return n
}

export function computeHealth(state: HealthInput, today: string, nowLocal: string, scope: Scope = 'all', alerts?: Alert[]): Health {
  const list = alerts ?? computeAlerts(state, today, scope)
  const blockers: Blocker[] = []
  const forget = forgetList(state.todos, state.todoChecks, today, nowLocal, scope)
  const forgotten = new Set<string>()
  for (const f of forget) {
    if (f.state !== 'due') continue
    forgotten.add(f.todo.id)
    blockers.push({ id: `forget:${f.todo.id}`, severity: 3, title: f.todo.title, detail: `Não pode esquecer · ${f.when}`, itemId: null, todoId: f.todo.id, companyId: f.todo.companyId, alert: null })
  }
  for (const t of todayTodos(state.todos, state.todoChecks, today, scope)) {
    if (t.done || forgotten.has(t.todo.id)) continue
    if (t.forget && forget.some((f) => f.todo.id === t.todo.id && f.state === 'later')) continue
    blockers.push({
      id: `todo:${t.todo.id}`,
      severity: t.late ? 3 : 2,
      title: t.todo.title,
      detail: t.late ? `To-do atrasado · era para ${dueLabel(t.todo.dueDate!, today)}` : t.todo.mode === 'daily' ? 'To-do de hoje · diário' : 'To-do de hoje',
      itemId: null,
      todoId: t.todo.id,
      companyId: t.todo.companyId,
      alert: null,
    })
  }
  for (const a of list) {
    if (a.severity < 2) continue
    blockers.push({ id: a.id, severity: a.severity as 2 | 3, title: a.title, detail: a.detail, itemId: a.itemId, todoId: null, companyId: a.companyId, alert: a })
  }
  blockers.sort((a, b) => b.severity - a.severity)
  const handled = handledToday(state, today, scope)
  const total = handled + blockers.length
  const level = blockers.some((b) => b.severity === 3) ? 'red' : blockers.length ? 'amber' : 'green'
  return { level, blockers, handled, total, progress: total === 0 ? 1 : handled / total }
}

export function healthLabel(h: Health): string {
  if (h.level === 'green') return h.handled ? 'Tudo em dia' : 'Tudo em dia por aqui'
  const n = h.blockers.length
  return `${n === 1 ? 'Falta 1 coisa' : `Faltam ${n} coisas`} para ficar tudo verde`
}

export type DayCell = { date: string; state: 'green' | 'miss' | 'none' | 'future' }

export function streak(days: DayMark[], today: string, greenNow: boolean): number {
  const map = new Map(days.map((d) => [d.date, d.green]))
  map.set(today, greenNow)
  let n = 0
  let d = greenNow ? today : addDays(today, -1)
  for (let guard = 0; guard < 400; guard++) {
    const v = map.get(d)
    if (v === false) break
    if (v === true) n++
    d = addDays(d, -1)
    if (![...map.keys()].some((k) => k <= d)) break
  }
  return n
}

export function dayGrid(days: DayMark[], today: string, greenNow: boolean, weeks = 12): DayCell[][] {
  const map = new Map(days.map((d) => [d.date, d.green]))
  map.set(today, greenNow)
  const start = addDays(weekStart(today), -7 * (weeks - 1))
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, k) => {
      const date = addDays(start, w * 7 + k)
      if (date > today) return { date, state: 'future' as const }
      const v = map.get(date)
      return { date, state: v === undefined ? ('none' as const) : v ? ('green' as const) : ('miss' as const) }
    }),
  )
}

export type PlannedNotice = { key: string; title: string; body: string; itemId: string | null }

export function planNotifications(
  state: Pick<WorkState, 'items' | 'events' | 'checklist' | 'settings' | 'todos' | 'todoChecks' | 'companies'>,
  now: Date,
  sent: Record<string, string>,
): PlannedNotice[] {
  const s = state.settings
  const nowLocal = localNow(now)
  const time = nowLocal.slice(11, 16)
  const today = civil(now)
  const out: PlannedNotice[] = []
  const coName = (id: string | null) => state.companies.find((c) => c.id === id)?.name
  if (s.notifyReminders) {
    for (const t of state.todos) {
      if (!t.remindTime || t.remindTime > time) continue
      if (!todoAppliesOn(t, today) || todoDoneOn(t, state.todoChecks, today)) continue
      const key = `todo:${t.id}:${today}`
      if (sent[key]) continue
      const co = coName(t.companyId)
      out.push({ key, title: `${t.mustNotForget ? 'Não pode esquecer' : 'Lembrete'}${co ? ` · ${co}` : ''}`, body: t.title, itemId: null })
    }
  }
  if (now.getHours() < s.notifyHour) return out
  const alerts = computeAlerts(state, today)
  if (s.notifyDue) {
    const key = `due:${today}`
    const due = alerts.filter((a) => a.kind === 'due_today' || a.kind === 'overdue').map((a) => ({ title: a.title, late: a.kind === 'overdue' }))
    for (const t of todayTodos(state.todos, state.todoChecks, today)) {
      if (!t.done && t.todo.mode === 'dated') due.push({ title: t.todo.title, late: t.late })
    }
    if (due.length && !sent[key]) {
      const late = due.filter((a) => a.late).length
      const head = [due.length - late ? `${due.length - late} com prazo hoje` : '', late ? `${late} ${late === 1 ? 'atrasado' : 'atrasados'}` : ''].filter(Boolean).join(' · ')
      out.push({ key, title: `Prazos: ${head}`, body: due.slice(0, 3).map((a) => a.title).join('\n') + (due.length > 3 ? `\n+${due.length - 3}` : ''), itemId: null })
    }
  }
  if (s.notifyValidation) {
    const key = `val:${today}`
    const val = alerts.filter((a) => a.kind === 'validation')
    if (val.length && !sent[key]) {
      out.push({
        key,
        title: val.length === 1 ? 'Cobrar validação' : `Cobrar ${val.length} validações`,
        body: val.slice(0, 3).map((a) => `${a.title} · entregue ${ago(a.days)}`).join('\n') + (val.length > 3 ? `\n+${val.length - 3}` : ''),
        itemId: val[0].itemId,
      })
    }
  }
  return out
}

export function pruneSent(sent: Record<string, string>, today: string, keepDays = 4): Record<string, string> {
  const min = addDays(today, -keepDays)
  return Object.fromEntries(Object.entries(sent).filter(([, d]) => d >= min))
}

export function boardColumns(items: WorkItem[], scope: Scope, today: string): { stage: Stage; items: WorkItem[] }[] {
  const mine = items.filter((i) => inScope(scope, i.companyId))
  const since = addDays(today, -7)
  return STAGES.map((stage) => {
    let list = mine.filter((i) => i.stage === stage)
    if (stage === 'done') list = list.filter((i) => i.doneAt && civilOf(i.doneAt) >= since).sort((a, b) => b.doneAt!.localeCompare(a.doneAt!))
    else list = list.sort((a, b) => Number(!!b.focusedAt) - Number(!!a.focusedAt) || a.sort - b.sort)
    return { stage, items: list }
  })
}

export function moveSelection(cols: { items: WorkItem[] }[], current: string | null, key: 'up' | 'down' | 'left' | 'right'): string | null {
  const flat = cols.flatMap((c) => c.items)
  if (!flat.length) return null
  let ci = cols.findIndex((c) => c.items.some((i) => i.id === current))
  if (ci < 0) return flat[0].id
  let ri = cols[ci].items.findIndex((i) => i.id === current)
  if (key === 'down') ri = Math.min(cols[ci].items.length - 1, ri + 1)
  if (key === 'up') ri = Math.max(0, ri - 1)
  if (key === 'left' || key === 'right') {
    const step = key === 'left' ? -1 : 1
    let k = ci + step
    while (k >= 0 && k < cols.length && !cols[k].items.length) k += step
    if (k < 0 || k >= cols.length) return current
    ci = k
    ri = Math.min(ri, cols[ci].items.length - 1)
  }
  return cols[ci].items[ri].id
}

export const sessionMs = (s: Session, now: number) => Math.max(0, (s.endedAt ? Date.parse(s.endedAt) : now) - Date.parse(s.startedAt))
export const runningSession = (sessions: Session[]) => sessions.find((s) => !s.endedAt) ?? null

export function itemTimeMs(sessions: Session[], itemId: string, now: number): number {
  return sessions.filter((s) => s.itemId === itemId).reduce((t, s) => t + sessionMs(s, now), 0)
}

function overlap(s: Session, from: number, to: number, now: number) {
  const a = Math.max(Date.parse(s.startedAt), from)
  const b = Math.min(s.endedAt ? Date.parse(s.endedAt) : now, to)
  return Math.max(0, b - a)
}

export function rangeTimeMs(sessions: Session[], items: WorkItem[], fromDay: string, toDay: string, now: number, scope: Scope = 'all'): Record<string, number> {
  const from = parseCivil(fromDay).getTime()
  const to = parseCivil(addDays(toDay, 1)).getTime()
  const company = new Map(items.map((i) => [i.id, i.companyId]))
  const out: Record<string, number> = {}
  for (const s of sessions) {
    const co = company.get(s.itemId)
    if (!co || !inScope(scope, co)) continue
    const ms = overlap(s, from, to, now)
    if (ms) out[co] = (out[co] ?? 0) + ms
  }
  return out
}

export const sumTime = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

export function fmtDur(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return ms > 0 ? '<1 min' : '0 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}

export function fmtClock(ms: number): string {
  const t = Math.floor(ms / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export type RulerPin = {
  id: string
  kind: 'todo' | 'forget' | 'due'
  minute: number | null
  title: string
  companyId: string
  todoId: string | null
  itemId: string | null
  done: boolean
}
export type RulerSegment = { id: string; itemId: string; companyId: string; start: number; end: number; running: boolean }
export type RulerModel = { startMin: number; endMin: number; nowMin: number; pins: RulerPin[]; allDay: RulerPin[]; segments: RulerSegment[] }

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export function rulerModel(state: Pick<WorkState, 'items' | 'todos' | 'todoChecks' | 'sessions'>, today: string, now: Date, scope: Scope = 'all'): RulerModel {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const pins: RulerPin[] = []
  const allDay: RulerPin[] = []
  for (const t of state.todos) {
    if (!inSpace(scope, t.companyId)) continue
    const applies = t.mode === 'dated' ? t.dueDate === today : t.mode === 'daily' ? todoAppliesOn(t, today) : !t.doneAt
    if (!applies) continue
    const done = todoDoneOn(t, state.todoChecks, today)
    const pin: RulerPin = { id: `todo:${t.id}`, kind: t.mustNotForget ? 'forget' : 'todo', minute: t.remindTime ? toMin(t.remindTime) : null, title: t.title, companyId: t.companyId, todoId: t.id, itemId: null, done }
    if (pin.minute !== null) pins.push(pin)
    else if (t.mode === 'dated' && !done) allDay.push(pin)
  }
  for (const i of state.items) {
    if (!inScope(scope, i.companyId) || i.dueDate !== today || i.stage === 'done' || isPost(i.stage)) continue
    allDay.push({ id: `item:${i.id}`, kind: 'due', minute: null, title: label(i), companyId: i.companyId, todoId: null, itemId: i.id, done: false })
  }
  const company = new Map(state.items.map((i) => [i.id, i.companyId]))
  const dayStart = parseCivil(today).getTime()
  const dayEnd = dayStart + 864e5
  const segments: RulerSegment[] = []
  for (const s of state.sessions) {
    const co = company.get(s.itemId)
    if (!co || !inScope(scope, co)) continue
    const a = Math.max(Date.parse(s.startedAt), dayStart)
    const b = Math.min(s.endedAt ? Date.parse(s.endedAt) : now.getTime(), dayEnd)
    if (b <= a) continue
    segments.push({ id: s.id, itemId: s.itemId, companyId: co, start: Math.round((a - dayStart) / 6e4), end: Math.round((b - dayStart) / 6e4), running: !s.endedAt })
  }
  const marks = [nowMin, ...pins.map((p) => p.minute!), ...segments.flatMap((s) => [s.start, s.end])]
  const startMin = Math.max(0, Math.min(8 * 60, Math.floor((Math.min(...marks) - 30) / 60) * 60))
  const endMin = Math.min(24 * 60, Math.max(19 * 60, Math.ceil((Math.max(...marks) + 30) / 60) * 60))
  pins.sort((a, b) => a.minute! - b.minute!)
  return { startMin, endMin, nowMin, pins, allDay, segments }
}

export type Nudge = {
  id: string
  kind: AlertKind
  tone: 'red' | 'amber' | 'soft'
  text: string
  itemIds: string[]
  action: { kind: AlertAction; label: string } | null
}

export function nudges(alerts: Alert[]): Nudge[] {
  const by = new Map<AlertKind, Alert[]>()
  for (const a of alerts) by.set(a.kind, [...(by.get(a.kind) ?? []), a])
  const out: Nudge[] = []
  const tone = (a: Alert) => (a.severity === 3 ? 'red' : a.severity === 2 ? 'amber' : 'soft') as Nudge['tone']
  const single = (a: Alert): Nudge => ({ id: a.id, kind: a.kind, tone: tone(a), text: `${a.title} · ${a.detail}`, itemIds: a.itemId ? [a.itemId] : [], action: a.action })
  const group = (kind: AlertKind, text: (n: number, list: Alert[]) => string, label: string) => {
    const list = by.get(kind)
    if (!list?.length) return
    if (list.length === 1) return void out.push(single(list[0]))
    out.push({ id: `group:${kind}`, kind, tone: tone(list[0]), text: text(list.length, list), itemIds: list.map((a) => a.itemId!).filter(Boolean), action: list[0].action ? { kind: list[0].action.kind, label } : null })
  }
  for (const a of by.get('returned') ?? []) out.push(single(a))
  group('overdue', (n) => `${n} prazos vencidos`, 'Todos para amanhã')
  group('validation', (n, l) => `${n} entregas sem validação há ${Math.min(...l.map((a) => a.days))}+ dias`, 'Cobrei todas')
  group('waiting', (n) => `${n} itens aguardando alguém`, 'Cobrei todos')
  group('due_today', (n) => `${n} itens com prazo hoje`, 'Pôr no foco')
  for (const a of by.get('unchecked') ?? []) out.push(single(a))
  for (const a of by.get('wip') ?? []) out.push(single(a))
  group('close', (n) => `${n} validados esperando fechar`, 'Concluir todos')
  group('stale', (n) => `${n} parados em Fazendo`, 'Adiar 3 dias')
  return out
}

export type WeekScore = { delivered: number; validated: number; done: number; byCompany: Record<string, number> }

export function weekScore(state: Pick<WorkState, 'items' | 'events'>, today: string, scope: Scope = 'all'): WeekScore {
  const ws = weekStart(today)
  const company = new Map(state.items.map((i) => [i.id, i.companyId]))
  const out: WeekScore = { delivered: 0, validated: 0, done: 0, byCompany: {} }
  for (const e of state.events) {
    if (e.kind !== 'stage' || !e.fromStage || !e.toStage || civilOf(e.at) < ws) continue
    const co = company.get(e.itemId)
    if (!co || !inScope(scope, co)) continue
    if (stageIndex(e.toStage) <= stageIndex(e.fromStage)) continue
    if (crossesDelivery(e.fromStage, e.toStage)) {
      out.delivered++
      out.byCompany[co] = (out.byCompany[co] ?? 0) + 1
    }
    if (e.toStage === 'validated') out.validated++
    if (e.toStage === 'done') out.done++
  }
  return out
}
