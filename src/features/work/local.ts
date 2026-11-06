import type {
  Attachment, ChecklistEntry, Company, CompanyPatch, DayMark, ImportTask, ItemChange, ItemPatch, NewItem, NewTodo, SecretMeta, Settings,
  Stage, Todo, TodoCheck, TodoMode, TodoPatch, WorkEvent, WorkItem, WorkState,
} from './types.ts'
import { DEFAULT_SETTINGS, KINDS, PRIORITIES, STAGES } from './types.ts'

export type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void }

type Db = {
  companies: Company[]
  checklist: (ChecklistEntry & { archivedAt: string | null })[]
  items: WorkItem[]
  events: WorkEvent[]
  settings: Settings
  todos: Todo[]
  todoChecks: TodoCheck[]
  tasksImported: boolean
  attachments: Attachment[]
  days: DayMark[]
}

export const LOCAL_KEY = 'ps.work.v1'
const MODES: TodoMode[] = ['daily', 'fixed', 'dated']

function seed(): Db {
  const ck = (id: string, companyId: string, label: string, sort: number) => ({ id, companyId, label, sort, archivedAt: null })
  return {
    companies: [
      { id: 'statix', name: 'Statix', color: '#2D62DB', logo: null, sort: 1 },
      { id: 'livelo', name: 'Livelo', color: '#E5008C', logo: null, sort: 2 },
      { id: 'pessoal', name: 'Pessoal', color: '#8C8F96', logo: null, sort: 3 },
    ],
    checklist: [
      ck('statix-local', 'statix', 'Testei localmente', 1),
      ck('statix-testes', 'statix', 'Rodei os testes', 2),
      ck('statix-sql', 'statix', 'Revisei o SQL e os índices', 3),
      ck('statix-chamado', 'statix', 'Atualizei o chamado', 4),
      ck('statix-avisei', 'statix', 'Avisei quem pediu', 5),
      ck('livelo-hml', 'livelo', 'Testei em homologação', 1),
      ck('livelo-pr', 'livelo', 'PR revisado', 2),
      ck('livelo-evidencias', 'livelo', 'Evidências anexadas no ticket', 3),
      ck('livelo-time', 'livelo', 'Avisei o time', 4),
    ],
    items: [],
    events: [],
    settings: { ...DEFAULT_SETTINGS },
    todos: [],
    todoChecks: [],
    tasksImported: false,
    attachments: [],
    days: [],
  }
}

const clip = (s: string, n: number) => [...s.trim()].slice(0, n).join('')
const opt = (s: string | null | undefined, n: number) => {
  if (s == null) return null
  const v = clip(s, n)
  return v || null
}
const req = (s: string, n: number, what: string) => {
  const v = clip(s ?? '', n)
  if (!v) throw new Error(`${what} não pode ficar vazio`)
  return v
}
const isDate = (d: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d)
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
const optDate = (d: string | null | undefined) => {
  const v = d?.trim()
  if (!v) return null
  if (!isDate(v)) throw new Error('data inválida')
  return v
}
const optTime = (d: string | null | undefined) => {
  const v = d?.trim()
  if (!v) return null
  if (!isTime(v)) throw new Error('horário inválido')
  return v
}
const optUrl = (u: string | null | undefined) => {
  const v = opt(u, 2048)
  if (!v) return null
  if (!/^https?:\/\/\S+$/i.test(v)) throw new Error('o link precisa começar com http:// ou https://')
  return v
}
function oneOf<T extends string>(v: string, list: readonly T[], what: string): T {
  if (!(list as readonly string[]).includes(v)) throw new Error(`${what} inválido: ${v}`)
  return v as T
}
const idx = (s: Stage) => STAGES.indexOf(s)

export function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')
}

export function createLocal(storage: Storage, clock: () => Date = () => new Date(), uid: () => string = () => crypto.randomUUID()) {
  const read = (): Db => {
    try {
      const raw = storage.getItem(LOCAL_KEY)
      if (raw) return { ...seed(), ...(JSON.parse(raw) as Partial<Db>) } as Db
    } catch {
      return seed()
    }
    return seed()
  }
  const now = () => clock().toISOString()

  function exec(cmd: string, a: Record<string, unknown>): unknown {
    const db = read()
    const save = <T>(v: T): T => {
      storage.setItem(LOCAL_KEY, JSON.stringify(db))
      return v
    }
    const item = (id: string) => {
      const it = db.items.find((x) => x.id === id)
      if (!it) throw new Error('item não encontrado')
      return it
    }
    const activeChecklist = () => db.checklist.filter((c) => !c.archivedAt)
    const view = (it: WorkItem): WorkItem => {
      const order = activeChecklist()
      return { ...it, checks: order.filter((c) => it.checks.includes(c.id)).sort((x, y) => x.sort - y.sort).map((c) => c.id) }
    }
    const change = (id: string): ItemChange => ({ item: view(item(id)), events: db.events.filter((e) => e.itemId === id) })
    const log = (itemId: string, kind: WorkEvent['kind'], from: Stage | null, to: Stage | null, note = '', pending: number | null = null) =>
      db.events.push({ id: uid(), itemId, kind, fromStage: from, toStage: to, note: clip(note, 1000), pending, at: now() })
    const touch = (it: WorkItem) => (it.updatedAt = now())
    const companyExists = (id: string) => db.companies.some((c) => c.id === id)
    const pendingCount = (it: WorkItem) =>
      it.kind === 'pendencia' ? 0 : activeChecklist().filter((c) => c.companyId === it.companyId && !it.checks.includes(c.id)).length
    const checklistOut = (): ChecklistEntry[] =>
      activeChecklist()
        .sort((x, y) => x.companyId.localeCompare(y.companyId) || x.sort - y.sort)
        .map(({ id, companyId, label, sort }) => ({ id, companyId, label, sort }))
    const todo = (id: string) => {
      const t = db.todos.find((x) => x.id === id)
      if (!t) throw new Error('to-do não encontrado')
      return t
    }
    const todoShape = (mode: string, weekdaysOnly: boolean, due: string | null) => {
      const m = oneOf(mode, MODES, 'recorrência')
      const dueDate = m === 'dated' ? due : null
      if (m === 'dated' && !dueDate) throw new Error('to-do com prazo precisa de uma data')
      return { mode: m, weekdaysOnly: m === 'daily' && weekdaysOnly, dueDate }
    }
    const secretsUnavailable = () => {
      throw new Error('segredos ficam no Keychain: disponível no app instalado')
    }

    switch (cmd) {
      case 'work_load': {
        const cut = new Date(clock().getTime() - 30 * 864e5).toISOString()
        const state: WorkState = {
          companies: [...db.companies].sort((x, y) => x.sort - y.sort),
          checklist: checklistOut(),
          items: [...db.items].sort((x, y) => x.sort - y.sort).map(view),
          events: db.events,
          settings: db.settings,
          todos: [...db.todos].filter((t) => !t.doneAt || t.doneAt >= cut).sort((x, y) => x.sort - y.sort),
          todoChecks: [...db.todoChecks].sort((x, y) => x.date.localeCompare(y.date)),
          attachments: db.attachments,
          secrets: [] as SecretMeta[],
          days: [...db.days].sort((x, y) => x.date.localeCompare(y.date)),
        }
        return state
      }
      case 'work_item_create': {
        const i = a.input as NewItem
        if (!companyExists(clip(i.companyId ?? '', 40))) throw new Error('empresa desconhecida')
        const stage = i.stage ?? 'todo'
        if (stage !== 'todo' && stage !== 'doing') throw new Error('um item novo começa em A fazer ou Fazendo')
        const t = now()
        const it: WorkItem = {
          id: uid(),
          companyId: clip(i.companyId, 40),
          title: req(i.title, 300, 'o título'),
          ticket: opt(i.ticket, 40),
          url: optUrl(i.url),
          kind: oneOf(i.kind ?? 'chamado', KINDS, 'tipo'),
          system: opt(i.system, 80),
          priority: oneOf(i.priority ?? 'normal', PRIORITIES, 'prioridade'),
          dueDate: optDate(i.dueDate),
          notes: clip(i.notes ?? '', 4000),
          requester: opt(i.requester, 80),
          stage,
          stageAt: t,
          deliveredAt: null,
          testedAt: null,
          validatedAt: null,
          doneAt: null,
          waitingOn: null,
          waitingSince: null,
          returns: 0,
          returnedAt: null,
          returnOpen: false,
          followupAt: null,
          snoozedUntil: null,
          focusedAt: null,
          sort: Math.min(1, ...db.items.map((x) => x.sort)) - 1,
          createdAt: t,
          updatedAt: t,
          checks: [],
        }
        db.items.push(it)
        log(it.id, 'created', null, stage)
        return save(change(it.id))
      }
      case 'work_item_update': {
        const it = item(a.id as string)
        const p = a.patch as ItemPatch
        const next = { ...it }
        if (p.companyId !== undefined && clip(p.companyId, 40) !== it.companyId) {
          if (!companyExists(clip(p.companyId, 40))) throw new Error('empresa desconhecida')
          next.companyId = clip(p.companyId, 40)
          next.checks = []
        }
        if (p.title !== undefined) next.title = req(p.title, 300, 'o título')
        if (p.ticket !== undefined) next.ticket = opt(p.ticket, 40)
        if (p.url !== undefined) next.url = optUrl(p.url)
        if (p.kind !== undefined) next.kind = oneOf(p.kind, KINDS, 'tipo')
        if (p.system !== undefined) next.system = opt(p.system, 80)
        if (p.priority !== undefined) next.priority = oneOf(p.priority, PRIORITIES, 'prioridade')
        let dueChanged = false
        if (p.dueDate !== undefined) {
          const d = optDate(p.dueDate)
          if (d !== it.dueDate) {
            next.dueDate = d
            dueChanged = true
          }
        }
        if (p.notes !== undefined) next.notes = clip(p.notes, 4000)
        if (p.requester !== undefined) next.requester = opt(p.requester, 80)
        Object.assign(it, next)
        if (dueChanged) log(it.id, 'due', null, null, it.dueDate ?? '')
        touch(it)
        return save(change(it.id))
      }
      case 'work_item_delete': {
        const id = a.id as string
        item(id)
        db.items = db.items.filter((x) => x.id !== id)
        db.events = db.events.filter((e) => e.itemId !== id)
        db.attachments = db.attachments.filter((x) => x.itemId !== id)
        for (const t of db.todos) if (t.itemId === id) t.itemId = null
        return save(undefined)
      }
      case 'work_item_move': {
        const to = a.stage as Stage
        if (!STAGES.includes(to)) throw new Error(`estágio inválido: ${to}`)
        const it = item(a.id as string)
        if (it.stage === to) return change(it.id)
        const fi = idx(it.stage)
        const ti = idx(to)
        const crossing = fi < 2 && ti >= 2
        const pending = crossing ? pendingCount(it) : null
        if (pending && !a.force) throw new Error(`checklist pendente: ${pending} ${pending === 1 ? 'item' : 'itens'} antes de entregar`)
        const t = now()
        const from = it.stage
        it.stage = to
        it.stageAt = t
        it.deliveredAt = ti < 2 ? null : crossing ? t : (it.deliveredAt ?? t)
        it.testedAt = ti < 3 ? null : to === 'tested' ? t : it.testedAt
        it.validatedAt = ti < 4 ? null : to === 'validated' ? t : it.validatedAt
        it.doneAt = ti < 5 ? null : t
        if (crossing || ti === 5) it.returnOpen = false
        if (ti === 5) {
          it.waitingOn = null
          it.waitingSince = null
          it.focusedAt = null
        }
        it.followupAt = null
        it.snoozedUntil = null
        touch(it)
        log(it.id, 'stage', from, to, (a.note as string | null) ?? '', pending)
        return save(change(it.id))
      }
      case 'work_item_return': {
        const it = item(a.id as string)
        if (idx(it.stage) < 2) throw new Error('só volta o que já foi entregue')
        const reason = clip((a.reason as string) ?? '', 1000)
        if (!reason) throw new Error('diga por que voltou')
        const t = now()
        const from = it.stage
        Object.assign(it, {
          stage: 'doing', stageAt: t, returns: it.returns + 1, returnedAt: t, returnOpen: true, deliveredAt: null, testedAt: null,
          validatedAt: null, doneAt: null, waitingOn: null, waitingSince: null, followupAt: null, snoozedUntil: null, checks: [],
        })
        touch(it)
        log(it.id, 'returned', from, 'doing', reason)
        return save(change(it.id))
      }
      case 'work_item_resume': {
        const it = item(a.id as string)
        if (!it.returnOpen) return change(it.id)
        it.returnOpen = false
        it.snoozedUntil = null
        if (it.stage === 'todo') {
          it.stage = 'doing'
          it.stageAt = now()
        }
        touch(it)
        log(it.id, 'resumed', null, null)
        return save(change(it.id))
      }
      case 'work_item_wait': {
        const it = item(a.id as string)
        const on = opt(a.on as string | null, 120)
        if (on && it.stage === 'done') throw new Error('item concluído não fica aguardando')
        if (on === it.waitingOn) return change(it.id)
        if (on) {
          it.waitingOn = on
          it.waitingSince = now()
          it.followupAt = null
          log(it.id, 'waiting', null, null, on)
        } else {
          const prev = it.waitingOn ?? ''
          it.waitingOn = null
          it.waitingSince = null
          it.followupAt = null
          log(it.id, 'unblocked', null, null, prev)
        }
        touch(it)
        return save(change(it.id))
      }
      case 'work_item_followup': {
        const it = item(a.id as string)
        if (it.stage === 'done') throw new Error('item já concluído')
        it.followupAt = now()
        touch(it)
        log(it.id, 'followup', null, null, (a.note as string | null) ?? '')
        return save(change(it.id))
      }
      case 'work_item_note': {
        const it = item(a.id as string)
        const t = clip((a.text as string) ?? '', 1000)
        if (!t) throw new Error('a anotação está vazia')
        log(it.id, 'note', null, null, t)
        touch(it)
        return save(change(it.id))
      }
      case 'work_note_delete': {
        const e = db.events.find((x) => x.id === a.eventId && x.kind === 'note')
        if (!e) throw new Error('anotação não encontrada')
        db.events = db.events.filter((x) => x.id !== e.id)
        return save(change(e.itemId))
      }
      case 'work_item_snooze': {
        const it = item(a.id as string)
        it.snoozedUntil = optDate(a.until as string | null)
        return save(change(it.id))
      }
      case 'work_item_focus': {
        const it = item(a.id as string)
        if (a.on) {
          if (it.focusedAt) return change(it.id)
          if (it.stage === 'done') throw new Error('item concluído não entra no foco')
          if (db.items.filter((x) => x.focusedAt).length >= 3) throw new Error('o foco tem no máximo 3 itens; tire um antes')
          it.focusedAt = now()
        } else it.focusedAt = null
        return save(change(it.id))
      }
      case 'work_item_check': {
        const it = item(a.id as string)
        const ck = activeChecklist().find((c) => c.id === a.checkId)
        if (!ck) throw new Error('item de checklist não encontrado')
        if (ck.companyId !== it.companyId) throw new Error('esse item de checklist é de outra empresa')
        it.checks = a.on ? [...new Set([...it.checks, ck.id])] : it.checks.filter((c) => c !== ck.id)
        return save(change(it.id))
      }
      case 'work_items_reorder':
        ;(a.ids as string[]).forEach((id, i) => {
          const it = db.items.find((x) => x.id === id)
          if (it) it.sort = i
        })
        return save(undefined)
      case 'work_checklist_add': {
        const co = a.companyId as string
        if (!companyExists(co)) throw new Error('empresa desconhecida')
        const label = req(a.label as string, 120, 'o item')
        const sort = Math.max(0, ...db.checklist.filter((c) => c.companyId === co).map((c) => c.sort)) + 1
        db.checklist.push({ id: uid(), companyId: co, label, sort, archivedAt: null })
        return save(checklistOut())
      }
      case 'work_checklist_rename': {
        const c = db.checklist.find((x) => x.id === a.id && !x.archivedAt)
        if (!c) throw new Error('item de checklist não encontrado')
        c.label = req(a.label as string, 120, 'o item')
        return save(checklistOut())
      }
      case 'work_checklist_remove': {
        const c = db.checklist.find((x) => x.id === a.id && !x.archivedAt)
        if (c) c.archivedAt = now()
        return save(checklistOut())
      }
      case 'work_checklist_reorder':
        ;(a.ids as string[]).forEach((id, i) => {
          const c = db.checklist.find((x) => x.id === id && x.companyId === a.companyId)
          if (c) c.sort = i + 1
        })
        return save(checklistOut())
      case 'work_company_create': {
        const name = req(a.name as string, 60, 'o nome')
        const color = a.color as string
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('cor inválida')
        const base = slugify(name)
        if (!base) throw new Error('use letras ou números no nome')
        let id = base
        for (let n = 2; companyExists(id); n++) id = `${base}-${n}`
        const co: Company = { id, name, color: color.toUpperCase(), logo: null, sort: Math.max(0, ...db.companies.map((c) => c.sort)) + 1 }
        db.companies.push(co)
        return save(co)
      }
      case 'work_company_update': {
        const co = db.companies.find((c) => c.id === a.id)
        if (!co) throw new Error('empresa não encontrada')
        const p = a.patch as CompanyPatch
        if (p.name !== undefined) co.name = req(p.name, 60, 'o nome')
        if (p.color !== undefined) {
          if (!/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error('cor inválida')
          co.color = p.color.toUpperCase()
        }
        if (p.logo !== undefined) {
          if (p.logo && (!p.logo.startsWith('data:image/') || p.logo.length > 600000)) throw new Error('logo inválido ou grande demais (até ~400 KB)')
          co.logo = p.logo || null
        }
        return save({ ...co })
      }
      case 'work_company_delete': {
        const n = db.items.filter((i) => i.companyId === a.id).length + db.todos.filter((t) => t.companyId === a.id).length
        if (n) throw new Error(`o espaço tem ${n} ${n === 1 ? 'item' : 'itens'}; mova ou exclua antes`)
        if (db.companies.filter((c) => c.id !== a.id).length === 0) throw new Error('mantenha pelo menos um espaço')
        db.companies = db.companies.filter((c) => c.id !== a.id)
        db.checklist = db.checklist.filter((c) => c.companyId !== a.id)
        return save(undefined)
      }
      case 'work_settings_set': {
        const s = a.settings as Settings
        if (!(s.wipLimit >= 1 && s.wipLimit <= 20)) throw new Error('o limite de itens em andamento vai de 1 a 20')
        for (const d of [s.validationDays, s.waitingDays, s.returnDays, s.closeDays]) if (!(d >= 0 && d <= 60)) throw new Error('os dias dos alertas vão de 0 a 60')
        if (!(s.staleDays >= 1 && s.staleDays <= 60)) throw new Error('os dias parado vão de 1 a 60')
        if (!(s.notifyHour >= 0 && s.notifyHour <= 23)) throw new Error('a hora do aviso vai de 0 a 23')
        db.settings = { ...s }
        return save(db.settings)
      }
      case 'work_todo_create': {
        const n = a.input as NewTodo
        const companyId = clip(n.companyId ?? '', 40)
        if (!companyExists(companyId)) throw new Error('espaço desconhecido')
        const title = req(n.title, 300, 'o título')
        const due = optDate(n.dueDate)
        const sh = todoShape(n.mode ?? (due ? 'dated' : 'fixed'), !!n.weekdaysOnly, due)
        const t = now()
        const todo: Todo = {
          id: uid(), companyId, title, note: clip(n.note ?? '', 2000), priority: oneOf(n.priority ?? 'normal', PRIORITIES, 'prioridade'), ...sh,
          remindTime: optTime(n.remindTime), mustNotForget: !!n.mustNotForget, doneAt: null, itemId: null,
          sort: Math.min(1, ...db.todos.map((x) => x.sort)) - 1, createdAt: t, updatedAt: t,
        }
        db.todos.push(todo)
        return save({ ...todo })
      }
      case 'work_todo_update': {
        const td = todo(a.id as string)
        const p = a.patch as TodoPatch
        const companyId = p.companyId !== undefined ? clip(p.companyId, 40) : td.companyId
        if (!companyExists(companyId)) throw new Error('espaço desconhecido')
        const due = p.dueDate !== undefined ? optDate(p.dueDate) : td.dueDate
        const sh = todoShape(p.mode ?? td.mode, p.weekdaysOnly ?? td.weekdaysOnly, due)
        Object.assign(td, {
          companyId,
          title: p.title !== undefined ? req(p.title, 300, 'o título') : td.title,
          note: p.note !== undefined ? clip(p.note, 2000) : td.note,
          priority: p.priority !== undefined ? oneOf(p.priority, PRIORITIES, 'prioridade') : td.priority,
          ...sh,
          remindTime: p.remindTime !== undefined ? optTime(p.remindTime) : td.remindTime,
          mustNotForget: p.mustNotForget ?? td.mustNotForget,
          doneAt: sh.mode === 'daily' ? null : td.doneAt,
          updatedAt: now(),
        })
        return save({ ...td })
      }
      case 'work_todo_done': {
        const td = todo(a.id as string)
        if (td.mode === 'daily') throw new Error('to-do diário se marca por dia')
        td.doneAt = a.on ? (td.doneAt ?? now()) : null
        td.updatedAt = now()
        return save({ ...td })
      }
      case 'work_todo_check': {
        const td = todo(a.id as string)
        if (td.mode !== 'daily') throw new Error('só to-do diário se marca por dia')
        const date = a.date as string
        if (!isDate(date)) throw new Error('data inválida')
        db.todoChecks = db.todoChecks.filter((c) => !(c.todoId === td.id && c.date === date))
        if (a.on) db.todoChecks.push({ todoId: td.id, date })
        return save(db.todoChecks.filter((c) => c.todoId === td.id).sort((x, y) => x.date.localeCompare(y.date)))
      }
      case 'work_todo_delete': {
        const n = db.todos.length
        db.todos = db.todos.filter((t) => t.id !== a.id)
        if (n === db.todos.length) throw new Error('to-do não encontrado')
        db.todoChecks = db.todoChecks.filter((c) => c.todoId !== a.id)
        return save(undefined)
      }
      case 'work_todo_convert': {
        const td = todo(a.id as string)
        if (td.mode === 'daily') throw new Error('to-do diário não vira item de trabalho')
        if (td.itemId) throw new Error('esse to-do já virou item de trabalho')
        const change = exec('work_item_create', {
          input: { companyId: td.companyId, title: td.title, priority: td.priority, dueDate: td.dueDate, notes: td.note },
        }) as ItemChange
        const fresh = read()
        const t2 = fresh.todos.find((x) => x.id === td.id)!
        t2.itemId = change.item.id
        t2.doneAt = t2.doneAt ?? now()
        t2.updatedAt = now()
        storage.setItem(LOCAL_KEY, JSON.stringify(fresh))
        return { todo: { ...t2 }, change }
      }
      case 'work_todos_import': {
        if (db.tasksImported) return 0
        const space = companyExists('pessoal') ? 'pessoal' : db.companies[0].id
        let n = 0
        ;(a.tasks as ImportTask[]).forEach((t, i) => {
          const title = clip(t.title ?? '', 300)
          if (!title) return
          const due = t.dueDate && isDate(t.dueDate) ? t.dueDate : null
          const ts = now()
          db.todos.push({
            id: uid(), companyId: space, title, note: clip(t.note ?? '', 2000), priority: t.priority > 0 ? 'alta' : 'normal',
            mode: due ? 'dated' : 'fixed', weekdaysOnly: false, dueDate: due, remindTime: null, mustNotForget: false,
            doneAt: t.doneAt ?? null, itemId: null, sort: i, createdAt: ts, updatedAt: ts,
          })
          n++
        })
        db.tasksImported = true
        return save(n)
      }
      case 'work_attachment_register': {
        const it = item(a.itemId as string)
        const att: Attachment = { id: a.id as string, itemId: it.id, mime: a.mime as string, size: a.size as number, createdAt: now() }
        db.attachments.push(att)
        touch(it)
        return save(att)
      }
      case 'work_attachment_delete': {
        const n = db.attachments.length
        db.attachments = db.attachments.filter((x) => x.id !== a.id)
        if (n === db.attachments.length) throw new Error('imagem não encontrada')
        return save(undefined)
      }
      case 'work_secret_add':
      case 'work_secret_reveal':
      case 'work_secret_delete':
        return secretsUnavailable()
      case 'work_day_set': {
        const date = a.date as string
        if (!isDate(date)) throw new Error('data inválida')
        const d: DayMark = { date, green: !!a.green, openCount: Number(a.openCount) || 0, handledCount: Number(a.handledCount) || 0 }
        db.days = [...db.days.filter((x) => x.date !== date), d]
        return save(d)
      }
    }
    throw new Error(`comando desconhecido: ${cmd}`)
  }

  return { exec }
}
