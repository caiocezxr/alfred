import {
  ancestors,
  archivedRoots,
  canAddChild,
  canMove,
  countDescendants,
  depthOf,
  indexNotes,
  isHiddenByArchive,
  isLive,
  moveTargets,
  nextSibling,
  recentNotes,
  trashRoots,
  visibleChildren,
  type TreeNote,
} from './tree.ts'
type Assert = {
  equal(actual: unknown, expected: unknown, message?: string): void
  deepEqual(actual: unknown, expected: unknown, message?: string): void
  ok(value: unknown, message?: string): void
  match(value: string, re: RegExp, message?: string): void
}
const nodeAssert = 'node:assert/strict'
const assert = ((await import(nodeAssert)) as { default: Assert }).default

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

let seq = 0
const n = (id: string, parentId: string | null, extra: Partial<TreeNote> = {}): TreeNote => ({
  id,
  parentId,
  title: id.toUpperCase(),
  sort: ++seq,
  archivedAt: null,
  trashedAt: null,
  createdAt: `2026-11-0${(seq % 9) + 1}T00:00:00Z`,
  updatedAt: `2026-11-05T00:00:${String(seq).padStart(2, '0')}Z`,
  ...extra,
})

const base = () => [
  n('a', null),
  n('b', 'a'),
  n('c', 'b'),
  n('x', null),
  n('y', 'x'),
  n('t', null, { trashedAt: '2026-11-04T00:00:00Z' }),
  n('u', 't'),
  n('z', null, { archivedAt: '2026-11-03T00:00:00Z' }),
  n('w', 'z'),
]

test('profundidade e ancestrais', () => {
  const idx = indexNotes(base())
  assert.equal(depthOf('a', idx), 1)
  assert.equal(depthOf('c', idx), 3)
  assert.deepEqual(ancestors('c', idx).map((x) => x.id), ['a', 'b'])
  assert.equal(depthOf('nada', idx), 0)
})

test('lixeira implícita', () => {
  const idx = indexNotes(base())
  assert.ok(isLive('a', idx))
  assert.ok(!isLive('t', idx))
  assert.ok(!isLive('u', idx), 'filho de página na lixeira')
  assert.deepEqual(trashRoots(idx).map((x) => x.id), ['t'])
  assert.equal(countDescendants('t', idx), 1)
})

test('arquivo esconde a subárvore', () => {
  const idx = indexNotes(base())
  assert.ok(isHiddenByArchive('w', idx))
  assert.deepEqual(archivedRoots(idx).map((x) => x.id), ['z'])
  assert.deepEqual(visibleChildren(null, idx).map((x) => x.id), ['a', 'x'])
  assert.ok(!recentNotes(idx).some((x) => x.id === 'w' || x.id === 'u'))
})

test('limite de 3 níveis e ciclos', () => {
  const idx = indexNotes(base())
  assert.ok(!canAddChild('c', idx))
  assert.ok(canAddChild('b', idx))
  assert.ok(!canMove('a', 'c', idx), 'ciclo')
  assert.ok(!canMove('a', 'a', idx))
  assert.ok(!canMove('x', 'b', idx), 'x tem filho: ficaria com 4 níveis')
  assert.ok(canMove('x', 'a', idx))
  assert.ok(canMove('y', 'b', idx))
  assert.ok(!canMove('y', 't', idx), 'destino na lixeira')
  assert.ok(!canMove('u', null, idx), 'origem na lixeira')
  assert.ok(canMove('c', null, idx))
})

test('alvos de "Mover para…"', () => {
  const idx = indexNotes(base())
  const targets = moveTargets('y', idx)
  assert.equal(targets[0].id, null)
  assert.ok(targets[0].allowed)
  const ids = targets.map((t) => t.id)
  assert.ok(!ids.includes('y'), 'não lista a si mesma')
  assert.ok(!ids.includes('t') && !ids.includes('z'), 'sem lixeira nem arquivadas')
  assert.equal(targets.find((t) => t.id === 'x')?.current, true)
  assert.equal(targets.find((t) => t.id === 'c')?.allowed, false, 'c já está no 3º nível')
})

test('ordem manual, recentes e próximo irmão', () => {
  const notes = base()
  notes.find((x) => x.id === 'a')!.updatedAt = '2026-11-01T00:00:00Z'
  const idx = indexNotes(notes)
  assert.deepEqual(visibleChildren(null, idx, 'recent').map((x) => x.id), ['x', 'a'])
  assert.equal(nextSibling('a', idx)?.id, 'x')
  assert.equal(nextSibling('x', idx), null)
})

console.log(`✓ ${passed} testes da árvore passaram`)
