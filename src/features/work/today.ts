import { useEffect, useMemo, useState } from 'react'
import { civil } from '../../shared/dates'
import { computeHealth, dueState, forgetList, healthLabel, label, localNow, todayTodos } from './logic'
import { startNotifier } from './notify'
import { loadWork, openItem, toggleTodo, useWork } from './store'

export type TodayEntry = {
  id: string
  kind: 'forget' | 'todo' | 'late' | 'focus'
  title: string
  detail: string
  companyId: string
  color: string
  done: boolean
  late: boolean
  todoId: string | null
  itemId: string | null
}

export type WorkToday = {
  loaded: boolean
  items: TodayEntry[]
  health: { progress: number; level: 'green' | 'amber' | 'red'; label: string; handled: number; total: number }
  counts: { todosLeft: number; todosDone: number; forget: number; late: number; focus: number; doing: number }
}

function useMinute() {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return t
}

export function useWorkToday(scope: string = 'all'): WorkToday {
  const { state } = useWork()
  const tick = useMinute()
  useEffect(() => {
    void loadWork()
    startNotifier()
  }, [])
  return useMemo(() => {
    const now = new Date(tick)
    const today = civil(now)
    const nowLocal = localNow(now)
    if (!state)
      return {
        loaded: false,
        items: [],
        health: { progress: 0, level: 'green' as const, label: '', handled: 0, total: 0 },
        counts: { todosLeft: 0, todosDone: 0, forget: 0, late: 0, focus: 0, doing: 0 },
      }
    const color = (id: string) => state.companies.find((c) => c.id === id)?.color ?? '#8C8F96'
    const h = computeHealth(state, today, nowLocal, scope)
    const items: TodayEntry[] = []
    const seen = new Set<string>()
    for (const f of forgetList(state.todos, state.todoChecks, today, nowLocal, scope)) {
      seen.add(f.todo.id)
      items.push({ id: `todo:${f.todo.id}`, kind: 'forget', title: f.todo.title, detail: `Não pode esquecer · ${f.when}`, companyId: f.todo.companyId, color: color(f.todo.companyId), done: false, late: f.state === 'due', todoId: f.todo.id, itemId: null })
    }
    const tt = todayTodos(state.todos, state.todoChecks, today, scope)
    for (const t of tt) {
      if (seen.has(t.todo.id)) continue
      items.push({ id: `todo:${t.todo.id}`, kind: 'todo', title: t.todo.title, detail: t.late ? 'Atrasado' : t.todo.mode === 'daily' ? 'Diário' : 'Hoje', companyId: t.todo.companyId, color: color(t.todo.companyId), done: t.done, late: t.late, todoId: t.todo.id, itemId: null })
    }
    const open = state.items.filter((i) => i.stage !== 'done' && (scope === 'all' || i.companyId === scope))
    for (const i of open.filter((i) => dueState(i, today) === 'late')) {
      items.push({ id: `item:${i.id}`, kind: 'late', title: label(i), detail: 'Prazo vencido', companyId: i.companyId, color: color(i.companyId), done: false, late: true, todoId: null, itemId: i.id })
    }
    for (const i of open.filter((i) => i.focusedAt && dueState(i, today) !== 'late').sort((a, b) => a.focusedAt!.localeCompare(b.focusedAt!))) {
      items.push({ id: `item:${i.id}`, kind: 'focus', title: label(i), detail: 'Foco', companyId: i.companyId, color: color(i.companyId), done: false, late: false, todoId: null, itemId: i.id })
    }
    items.sort((a, b) => Number(a.done) - Number(b.done))
    return {
      loaded: true,
      items,
      health: { progress: h.progress, level: h.level, label: healthLabel(h), handled: h.handled, total: h.total },
      counts: {
        todosLeft: tt.filter((t) => !t.done).length,
        todosDone: tt.filter((t) => t.done).length,
        forget: items.filter((x) => x.kind === 'forget').length,
        late: items.filter((x) => x.late).length,
        focus: open.filter((i) => i.focusedAt).length,
        doing: open.filter((i) => i.stage === 'doing').length,
      },
    }
  }, [state, tick, scope])
}

export { toggleTodo }

export function openWorkItem(id: string) {
  openItem(id)
}
