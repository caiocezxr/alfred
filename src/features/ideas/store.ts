import { useSyncExternalStore } from 'react'
import { errorStore } from '../../shared/db/stores'
import { ideasApi } from './api'
import { assess, type Assessment } from './engine'
import type { Answer, Idea, IdeaPatch, NewEvidence, NewIdea, NextTest } from './types'

type State = { ideas: Idea[]; loaded: boolean }

let state: State = { ideas: [], loaded: false }
const listeners = new Set<() => void>()

function emit(next: State) {
  state = next
  for (const l of listeners) l()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useIdeas(): State {
  return useSyncExternalStore(subscribe, () => state)
}

function fail(e: unknown) {
  errorStore.set(e instanceof Error ? e.message : String(e))
}

let loading: Promise<void> | null = null
export function loadIdeas(): Promise<void> {
  loading ??= ideasApi
    .list()
    .then((ideas) => emit({ ideas, loaded: true }))
    .catch((e) => {
      fail(e)
      emit({ ...state, loaded: true })
    })
    .finally(() => {
      loading = null
    })
  return loading
}

function replace(id: string, fn: (i: Idea) => Idea) {
  emit({ ...state, ideas: state.ideas.map((i) => (i.id === id ? fn(i) : i)) })
}

const seq = new Map<string, number>()
const bump = (id: string) => {
  const n = (seq.get(id) ?? 0) + 1
  seq.set(id, n)
  return n
}

async function mutate(id: string, optimistic: (i: Idea) => Idea, run: () => Promise<Idea>): Promise<Idea | undefined> {
  const n = bump(id)
  replace(id, optimistic)
  try {
    const fresh = await run()
    if (seq.get(id) === n) replace(id, () => fresh)
    return fresh
  } catch (e) {
    fail(e)
    await reload()
  }
}

async function reload() {
  try {
    emit({ ideas: await ideasApi.list(), loaded: true })
  } catch (e) {
    fail(e)
  }
}

export async function captureIdea(input: NewIdea): Promise<Idea | undefined> {
  try {
    const idea = await ideasApi.create(input)
    emit({ ...state, ideas: [idea, ...state.ideas] })
    return idea
  } catch (e) {
    fail(e)
  }
}

export function patchIdea(id: string, patch: IdeaPatch) {
  return mutate(
    id,
    (i) => {
      const o: Idea = { ...i }
      if (patch.title !== undefined) o.title = patch.title.trim() || i.title
      if (patch.description !== undefined) o.description = patch.description.trim()
      if (patch.kind) o.kind = patch.kind
      if (patch.status) o.status = patch.status
      if (patch.decisionNote !== undefined) o.decisionNote = patch.decisionNote.trim()
      if (patch.decision === '') {
        o.decision = null
        o.decidedAt = null
      } else if (patch.decision) {
        o.decision = patch.decision
        o.decidedAt = new Date().toISOString()
      }
      return o
    },
    () => ideasApi.update(id, patch),
  )
}

export function setAnswer(id: string, questionId: string, answer: Answer | null) {
  const clean = answer ? { choice: answer.choice, note: answer.note.trim() } : null
  return mutate(
    id,
    (i) => {
      const answers = { ...i.answers }
      if (clean) answers[questionId] = clean
      else delete answers[questionId]
      const status = i.status === 'captured' && Object.keys(answers).length ? 'evaluating' : i.status
      return { ...i, answers, status }
    },
    () => ideasApi.setAnswer(id, questionId, clean),
  )
}

export function setNextTest(id: string, nextTest: NextTest | null) {
  return mutate(id, (i) => ({ ...i, nextTest }), () => ideasApi.setNextTest(id, nextTest))
}

export async function removeIdea(id: string) {
  const prev = state.ideas
  bump(id)
  emit({ ...state, ideas: prev.filter((i) => i.id !== id) })
  try {
    await ideasApi.remove(id)
  } catch (e) {
    fail(e)
    await reload()
  }
}

export async function addEvidence(input: NewEvidence) {
  try {
    const e = await ideasApi.addEvidence(input)
    bump(input.ideaId)
    replace(input.ideaId, (i) => ({ ...i, evidence: [...i.evidence, e], updatedAt: e.createdAt }))
    return e
  } catch (err) {
    fail(err)
  }
}

export async function removeEvidence(ideaId: string, evidenceId: string) {
  bump(ideaId)
  replace(ideaId, (i) => ({ ...i, evidence: i.evidence.filter((e) => e.id !== evidenceId) }))
  try {
    await ideasApi.removeEvidence(evidenceId)
  } catch (e) {
    fail(e)
    await reload()
  }
}

const cache = new WeakMap<Idea, { today: string; a: Assessment }>()

export function assessIdea(idea: Idea, today: string): Assessment {
  const hit = cache.get(idea)
  if (hit && hit.today === today) return hit.a
  const a = assess(idea, { today })
  cache.set(idea, { today, a })
  return a
}
