
export const MAX_DEPTH = 3

export type TreeNote = {
  id: string
  parentId: string | null
  title: string
  sort: number
  archivedAt: string | null
  trashedAt: string | null
  createdAt: string
  updatedAt: string
}

export type TreeIndex<T extends TreeNote> = {
  byId: Map<string, T>
  children: Map<string | null, T[]>
}

export function indexNotes<T extends TreeNote>(notes: T[]): TreeIndex<T> {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const children = new Map<string | null, T[]>()
  for (const n of notes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null
    const list = children.get(key)
    if (list) list.push(n)
    else children.set(key, [n])
  }
  for (const list of children.values()) list.sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt))
  return { byId, children }
}

export function ancestors<T extends TreeNote>(id: string, idx: TreeIndex<T>): T[] {
  const out: T[] = []
  const seen = new Set<string>([id])
  let p = idx.byId.get(id)?.parentId ?? null
  while (p && !seen.has(p)) {
    const n = idx.byId.get(p)
    if (!n) break
    out.unshift(n)
    seen.add(p)
    p = n.parentId
  }
  return out
}

export function depthOf<T extends TreeNote>(id: string, idx: TreeIndex<T>): number {
  return idx.byId.has(id) ? ancestors(id, idx).length + 1 : 0
}

export function isLive<T extends TreeNote>(id: string, idx: TreeIndex<T>): boolean {
  const n = idx.byId.get(id)
  if (!n || n.trashedAt) return false
  return ancestors(id, idx).every((a) => !a.trashedAt)
}

export function isHiddenByArchive<T extends TreeNote>(id: string, idx: TreeIndex<T>): boolean {
  const n = idx.byId.get(id)
  if (!n) return true
  return !!n.archivedAt || ancestors(id, idx).some((a) => !!a.archivedAt)
}

export function subtreeIds<T extends TreeNote>(id: string, idx: TreeIndex<T>): string[] {
  const out: string[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    if (out.includes(cur)) continue
    out.push(cur)
    for (const c of idx.children.get(cur) ?? []) stack.push(c.id)
  }
  return out
}

export function heightOf<T extends TreeNote>(id: string, idx: TreeIndex<T>, guard = 0): number {
  if (guard > 64) return 1
  let h = 0
  for (const c of idx.children.get(id) ?? []) if (!c.trashedAt) h = Math.max(h, heightOf(c.id, idx, guard + 1))
  return 1 + h
}

export function canMove<T extends TreeNote>(id: string, parentId: string | null, idx: TreeIndex<T>): boolean {
  if (!isLive(id, idx)) return false
  if (parentId === null) return true
  if (parentId === id || subtreeIds(id, idx).includes(parentId)) return false
  if (!isLive(parentId, idx)) return false
  return depthOf(parentId, idx) + heightOf(id, idx) <= MAX_DEPTH
}

export function canAddChild<T extends TreeNote>(id: string, idx: TreeIndex<T>): boolean {
  return isLive(id, idx) && depthOf(id, idx) < MAX_DEPTH
}

export type SortMode = 'manual' | 'recent'

export function visibleChildren<T extends TreeNote>(parentId: string | null, idx: TreeIndex<T>, mode: SortMode = 'manual'): T[] {
  const list = (idx.children.get(parentId) ?? []).filter((n) => !n.trashedAt && !n.archivedAt)
  return mode === 'recent' ? [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : list
}

export type MoveTarget = { id: string | null; title: string; depth: number; allowed: boolean; current: boolean }

export function moveTargets<T extends TreeNote>(id: string, idx: TreeIndex<T>): MoveTarget[] {
  const me = idx.byId.get(id)
  const out: MoveTarget[] = [{ id: null, title: 'Topo', depth: 0, allowed: canMove(id, null, idx), current: !me?.parentId }]
  const walk = (parent: string | null, depth: number) => {
    for (const n of visibleChildren(parent, idx)) {
      if (n.id === id) continue
      out.push({ id: n.id, title: n.title, depth, allowed: canMove(id, n.id, idx), current: me?.parentId === n.id })
      if (depth < MAX_DEPTH) walk(n.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}

export function trashRoots<T extends TreeNote>(idx: TreeIndex<T>): T[] {
  return [...idx.byId.values()]
    .filter((n) => n.trashedAt && ancestors(n.id, idx).every((a) => !a.trashedAt))
    .sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''))
}

export function archivedRoots<T extends TreeNote>(idx: TreeIndex<T>): T[] {
  return [...idx.byId.values()]
    .filter((n) => n.archivedAt && isLive(n.id, idx) && ancestors(n.id, idx).every((a) => !a.archivedAt))
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
}

export function countDescendants<T extends TreeNote>(id: string, idx: TreeIndex<T>): number {
  return subtreeIds(id, idx).length - 1
}

export function recentNotes<T extends TreeNote>(idx: TreeIndex<T>): T[] {
  return [...idx.byId.values()]
    .filter((n) => isLive(n.id, idx) && !isHiddenByArchive(n.id, idx))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function nextSibling<T extends TreeNote>(id: string, idx: TreeIndex<T>): T | null {
  const n = idx.byId.get(id)
  if (!n) return null
  const sibs = visibleChildren(n.parentId && idx.byId.has(n.parentId) ? n.parentId : null, idx)
  const i = sibs.findIndex((s) => s.id === id)
  return i >= 0 ? (sibs[i + 1] ?? null) : null
}
