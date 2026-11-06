export type Stage = 'todo' | 'doing' | 'delivered' | 'tested' | 'validated' | 'done'
export type Kind = 'chamado' | 'feature' | 'bug' | 'melhoria' | 'pendencia'
export type Priority = 'normal' | 'alta' | 'urgente'
export type EventKind = 'created' | 'stage' | 'returned' | 'resumed' | 'waiting' | 'unblocked' | 'followup' | 'note' | 'due'

export type Company = { id: string; name: string; color: string; logo: string | null; sort: number }
export type ChecklistEntry = { id: string; companyId: string; label: string; sort: number }
export type Settings = {
  wipLimit: number
  validationDays: number
  waitingDays: number
  staleDays: number
  returnDays: number
  closeDays: number
  notifyReminders: boolean
  notifyDue: boolean
  notifyValidation: boolean
  notifyHour: number
}

export type TodoMode = 'daily' | 'fixed' | 'dated'
export type Todo = {
  id: string
  companyId: string
  title: string
  note: string
  priority: Priority
  mode: TodoMode
  weekdaysOnly: boolean
  dueDate: string | null
  remindTime: string | null
  mustNotForget: boolean
  doneAt: string | null
  itemId: string | null
  sort: number
  createdAt: string
  updatedAt: string
}
export type TodoCheck = { todoId: string; date: string }
export type NewTodo = {
  companyId: string
  title: string
  note?: string
  priority?: Priority
  mode?: TodoMode
  weekdaysOnly?: boolean
  dueDate?: string | null
  remindTime?: string | null
  mustNotForget?: boolean
}
export type TodoPatch = Partial<Omit<NewTodo, 'companyId' | 'title'>> & { companyId?: string; title?: string }
export type ImportTask = { title: string; note: string; dueDate: string | null; priority: number; doneAt: string | null }

export type Attachment = { id: string; itemId: string; mime: string; size: number; createdAt: string }
export type SecretMeta = { id: string; itemId: string | null; companyId: string | null; label: string; createdAt: string }
export type DayMark = { date: string; green: boolean; openCount: number; handledCount: number }
export type Session = { id: string; itemId: string; startedAt: string; endedAt: string | null }
export type TimerChange = { itemIds: string[]; sessions: Session[] }

export type WorkItem = {
  id: string
  companyId: string
  title: string
  ticket: string | null
  url: string | null
  kind: Kind
  system: string | null
  priority: Priority
  dueDate: string | null
  notes: string
  requester: string | null
  stage: Stage
  stageAt: string
  deliveredAt: string | null
  testedAt: string | null
  validatedAt: string | null
  doneAt: string | null
  waitingOn: string | null
  waitingSince: string | null
  returns: number
  returnedAt: string | null
  returnOpen: boolean
  followupAt: string | null
  snoozedUntil: string | null
  focusedAt: string | null
  sort: number
  createdAt: string
  updatedAt: string
  checks: string[]
}

export type WorkEvent = {
  id: string
  itemId: string
  kind: EventKind
  fromStage: Stage | null
  toStage: Stage | null
  note: string
  pending: number | null
  at: string
}

export type WorkState = {
  companies: Company[]
  checklist: ChecklistEntry[]
  items: WorkItem[]
  events: WorkEvent[]
  settings: Settings
  todos: Todo[]
  todoChecks: TodoCheck[]
  attachments: Attachment[]
  secrets: SecretMeta[]
  days: DayMark[]
  sessions: Session[]
}

export type ItemChange = { item: WorkItem; events: WorkEvent[]; sessions: Session[] }

export type NewItem = {
  companyId: string
  title: string
  ticket?: string | null
  url?: string | null
  kind?: Kind
  system?: string | null
  priority?: Priority
  dueDate?: string | null
  notes?: string
  requester?: string | null
  stage?: 'todo' | 'doing'
}

export type ItemPatch = {
  companyId?: string
  title?: string
  ticket?: string | null
  url?: string | null
  kind?: Kind
  system?: string | null
  priority?: Priority
  dueDate?: string | null
  notes?: string
  requester?: string | null
}

export type CompanyPatch = { name?: string; color?: string; logo?: string | null }

export const STAGES: Stage[] = ['todo', 'doing', 'delivered', 'tested', 'validated', 'done']

export const STAGE_LABEL: Record<Stage, string> = {
  todo: 'A fazer',
  doing: 'Fazendo',
  delivered: 'Entregue',
  tested: 'Testado',
  validated: 'Validado',
  done: 'Concluído',
}

export const STAGE_VERB: Record<Stage, string> = {
  todo: 'voltou para A fazer',
  doing: 'começou',
  delivered: 'entregou',
  tested: 'testou',
  validated: 'validado',
  done: 'concluiu',
}

export const NEXT_ACTION: Record<Stage, { to: Stage; label: string } | null> = {
  todo: { to: 'doing', label: 'Comecei' },
  doing: { to: 'delivered', label: 'Entreguei' },
  delivered: { to: 'tested', label: 'Testei' },
  tested: { to: 'validated', label: 'Foi validado' },
  validated: { to: 'done', label: 'Concluir' },
  done: null,
}

export const KINDS: Kind[] = ['chamado', 'feature', 'bug', 'melhoria', 'pendencia']
export const KIND_LABEL: Record<Kind, string> = {
  chamado: 'Chamado',
  feature: 'Feature',
  bug: 'Bug',
  melhoria: 'Melhoria',
  pendencia: 'Pendência',
}

export const PRIORITIES: Priority[] = ['normal', 'alta', 'urgente']
export const PRIORITY_LABEL: Record<Priority, string> = { normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }

export const DEFAULT_SETTINGS: Settings = {
  wipLimit: 3,
  validationDays: 2,
  waitingDays: 2,
  staleDays: 4,
  returnDays: 0,
  closeDays: 2,
  notifyReminders: true,
  notifyDue: true,
  notifyValidation: true,
  notifyHour: 9,
}

export const MODE_LABEL: Record<TodoMode, string> = { daily: 'Diário', fixed: 'Fixo', dated: 'Com prazo' }

export const PERSONAL_ID = 'pessoal'

export const FOCUS_MAX = 3
