import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../shared/db/api'
import type { Answer, Evidence, Idea, IdeaPatch, NewEvidence, NewIdea, NextTest } from './types'

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args)
  return local(cmd, args) as Promise<T>
}

export const ideasApi = {
  list: () => call<Idea[]>('ideas_list'),
  create: (input: NewIdea) => call<Idea>('idea_create', { input }),
  update: (id: string, patch: IdeaPatch) => call<Idea>('idea_update', { id, patch }),
  setAnswer: (id: string, questionId: string, answer: Answer | null) => call<Idea>('idea_set_answer', { id, questionId, answer }),
  setNextTest: (id: string, nextTest: NextTest | null) => call<Idea>('idea_set_next_test', { id, nextTest }),
  remove: (id: string) => call<void>('idea_delete', { id }),
  addEvidence: (input: NewEvidence) => call<Evidence>('idea_evidence_add', { input }),
  removeEvidence: (id: string) => call<void>('idea_evidence_delete', { id }),
}

type StoredIdea = Omit<Idea, 'evidence'>
type LocalDb = { ideas: StoredIdea[]; evidence: Evidence[] }

const KEY = 'ps.ideas.v1'
const KINDS = ['product', 'content']
const STATUSES = ['captured', 'evaluating', 'testing', 'paused', 'archived']
const DECISIONS = ['continue', 'adjust', 'archive']
const SIGNALS = ['supports', 'contradicts', 'neutral']
const CRITERIA = ['pain', 'distribution', 'monetization', 'test', 'execution', 'evidence', 'audience', 'discovery', 'format', 'cost', 'future', 'signal']
const SLUG = /^[a-z][a-z0-9_]{0,39}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function read(): LocalDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (Array.isArray(d.ideas) && Array.isArray(d.evidence)) return d
    }
  } catch {
  }
  return { ideas: [], evidence: [] }
}

const write = (db: LocalDb) => localStorage.setItem(KEY, JSON.stringify(db))
let lastTs = 0
const now = () => {
  lastTs = Math.max(Date.now(), lastTs + 1)
  return new Date(lastTs).toISOString()
}
const fail = (msg: string): never => {
  throw new Error(msg)
}
const len = (s: string) => [...s].length
const limit = (s: string, max: number, what: string) => len(s) > max && fail(`${what} passa do limite de ${max} caracteres`)
const oneOf = (v: string, allowed: string[], what: string) => !allowed.includes(v) && fail(`${what} inválido: ${v}`)

function cleanTitle(t: string): string {
  const s = (t ?? '').trim()
  if (!s) fail('a ideia precisa de um título')
  limit(s, 200, 'o título')
  return s
}

function cleanUrl(u: string | null | undefined): string | null {
  const s = (u ?? '').trim()
  if (!s) return null
  const m = /^https?:\/\/(.*)$/i.exec(s)
  if (!m || !m[1] || m[1].startsWith('/')) fail('o link precisa começar com http:// ou https://')
  if (/[\s\p{Cc}]/u.test(s)) fail('o link não pode ter espaços')
  if (s.length > 2048) fail('o link é longo demais')
  return s
}

function money(v: number, what: string) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e12) fail(`${what} inválido`)
}

function withEvidence(db: LocalDb, i: StoredIdea): Idea {
  return {
    ...i,
    evidence: db.evidence.filter((e) => e.ideaId === i.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }
}

function find(db: LocalDb, id: unknown): StoredIdea {
  return db.ideas.find((x) => x.id === id) ?? fail('ideia não encontrada')
}

async function local(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  const db = read()
  const done = <T>(v: T) => {
    write(db)
    return v
  }

  switch (cmd) {
    case 'ideas_list':
      return [...db.ideas].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((i) => withEvidence(db, i))

    case 'idea_create': {
      const input = a.input as NewIdea
      oneOf(input.kind, KINDS, 'tipo')
      const title = cleanTitle(input.title)
      const description = (input.description ?? '').trim()
      limit(description, 5000, 'a descrição')
      const t = now()
      const idea: StoredIdea = {
        id: crypto.randomUUID(), kind: input.kind, title, description, answers: {}, status: 'captured', nextTest: null,
        decision: null, decisionNote: '', decidedAt: null, createdAt: t, updatedAt: t,
      }
      db.ideas.push(idea)
      return done(withEvidence(db, idea))
    }

    case 'idea_update': {
      const p = a.patch as IdeaPatch
      const title = p.title !== undefined ? cleanTitle(p.title) : undefined
      const description = p.description?.trim()
      if (description !== undefined) limit(description, 5000, 'a descrição')
      if (p.kind !== undefined) oneOf(p.kind, KINDS, 'tipo')
      if (p.status !== undefined) oneOf(p.status, STATUSES, 'estado')
      if (p.decision) oneOf(p.decision, DECISIONS, 'decisão')
      const note = p.decisionNote?.trim()
      if (note !== undefined) limit(note, 2000, 'a nota da decisão')
      const i = find(db, a.id)
      if (title !== undefined) i.title = title
      if (description !== undefined) i.description = description
      if (p.kind !== undefined) i.kind = p.kind
      if (p.status !== undefined) i.status = p.status
      if (note !== undefined) i.decisionNote = note
      if (p.decision === '') {
        i.decision = null
        i.decidedAt = null
      } else if (p.decision) {
        i.decision = p.decision
        i.decidedAt = now()
      }
      i.updatedAt = now()
      return done(withEvidence(db, i))
    }

    case 'idea_set_answer': {
      const qid = a.questionId as string
      if (!SLUG.test(qid ?? '')) fail('pergunta inválida')
      const ans = a.answer as Answer | null
      let clean: Answer | null = null
      if (ans) {
        if (!SLUG.test(ans.choice ?? '')) fail('opção de resposta inválida')
        const n = (ans.note ?? '').trim()
        limit(n, 2000, 'o detalhe da resposta')
        clean = { choice: ans.choice, note: n }
      }
      const i = find(db, a.id)
      const answers = { ...i.answers }
      if (clean) answers[qid] = clean
      else delete answers[qid]
      if (Object.keys(answers).length > 64) fail('respostas demais para uma ideia')
      i.answers = answers
      if (i.status === 'captured' && Object.keys(answers).length) i.status = 'evaluating'
      i.updatedAt = now()
      return done(withEvidence(db, i))
    }

    case 'idea_set_next_test': {
      const raw = a.nextTest as NextTest | null
      let nt: NextTest | null = null
      if (raw) {
        nt = {
          action: (raw.action ?? '').trim(),
          target: (raw.target ?? '').trim(),
          maxSpend: raw.maxSpend,
          goal: (raw.goal ?? '').trim(),
          deadline: (raw.deadline ?? '').trim(),
          criterion: raw.criterion || null,
          startedAt: raw.startedAt || null,
        }
        limit(nt.action, 2000, 'a ação')
        limit(nt.target, 500, 'quem abordar / onde publicar')
        limit(nt.goal, 500, 'a meta')
        money(nt.maxSpend, 'investimento máximo')
        if (nt.deadline && !DATE.test(nt.deadline)) fail('prazo inválido (use AAAA-MM-DD)')
        if (nt.criterion) oneOf(nt.criterion, CRITERIA, 'critério')
        if (nt.startedAt && nt.startedAt.length > 40) fail('início do teste inválido')
      }
      const i = find(db, a.id)
      i.nextTest = nt
      i.updatedAt = now()
      return done(withEvidence(db, i))
    }

    case 'idea_delete':
      db.ideas = db.ideas.filter((x) => x.id !== a.id)
      db.evidence = db.evidence.filter((e) => e.ideaId !== a.id)
      return done(undefined)

    case 'idea_evidence_add': {
      const i = a.input as NewEvidence
      oneOf(i.kind, ['note', 'result'], 'tipo de evidência')
      const signal = i.signal ?? 'neutral'
      oneOf(signal, SIGNALS, 'sinal')
      const criterion = i.criterion || null
      if (criterion) oneOf(criterion, CRITERIA, 'critério')
      const text = (i.text ?? '').trim()
      limit(text, 4000, 'o comentário')
      const url = cleanUrl(i.url)
      let metric: string | null = null
      let value: number | null = null
      let cost: number | null = null
      if (i.kind === 'result') {
        metric = (i.metric ?? '').trim() || null
        if (!metric || i.value === null || i.value === undefined) fail('o resultado precisa de uma métrica e de um valor')
        limit(metric!, 120, 'a métrica')
        if (!Number.isFinite(i.value) || Math.abs(i.value!) > 1e12) fail('valor do resultado inválido')
        value = i.value!
        if (i.cost !== null && i.cost !== undefined) {
          money(i.cost, 'custo')
          cost = i.cost
        }
      } else if (!text && !url) fail('escreva um comentário ou cole um link')
      const idea = find(db, i.ideaId)
      const t = now()
      const e: Evidence = { id: crypto.randomUUID(), ideaId: idea.id, kind: i.kind, criterion, signal, text, url, metric, value, cost, createdAt: t, updatedAt: t }
      db.evidence.push(e)
      idea.updatedAt = t
      return done(e)
    }

    case 'idea_evidence_delete': {
      const e = db.evidence.find((x) => x.id === a.id)
      if (e) {
        db.evidence = db.evidence.filter((x) => x.id !== a.id)
        const idea = db.ideas.find((x) => x.id === e.ideaId)
        if (idea) idea.updatedAt = now()
      }
      return done(undefined)
    }
  }
  throw new Error(`comando desconhecido: ${cmd}`)
}
