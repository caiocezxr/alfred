import { api, isTauri } from './db/api'

type Rec = { s: string; h: string; i: number }

const KEY = 'profile.locks'
const LS = 'ps.locks.v1'
const SESSION = 'ps.unlocked.v1'
const ITER = 210000
const DEFAULT: Rec = { s: 'FF6HmTohzQkgA9F2RKCIkQ==', h: '5n4hBU2Gnr78y18BvSDhKZFjcJbQmyjRzgj6W2Qf5Eo=', i: ITER }

let cache: Record<string, Rec> | null = null

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function load(): Promise<Record<string, Rec>> {
  if (cache) return cache
  let raw: string | null = null
  try {
    raw = isTauri ? await api.settingGet(KEY) : localStorage.getItem(LS)
  } catch {
    raw = null
  }
  try {
    cache = raw ? (JSON.parse(raw) as Record<string, Rec>) : {}
  } catch {
    cache = {}
  }
  return cache
}

async function save(m: Record<string, Rec>) {
  cache = m
  const raw = JSON.stringify(m)
  if (isTauri) await api.settingSet(KEY, raw)
  else localStorage.setItem(LS, raw)
}

async function derive(pw: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256)
  return b64(bits)
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export function warmLocks() {
  void load()
}

export async function verifyPassword(profile: string, pw: string) {
  const r = (await load())[profile] ?? DEFAULT
  const ok = same(await derive(pw, unb64(r.s), r.i), r.h)
  if (ok) markUnlocked(profile)
  return ok
}

export async function setPassword(profile: string, pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const m = { ...(await load()), [profile]: { s: b64(salt), h: await derive(pw, salt, ITER), i: ITER } }
  await save(m)
}

export async function usesDefault(profile: string) {
  return !(await load())[profile]
}

function unlockedSet(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function isUnlocked(profile: string) {
  return unlockedSet().includes(profile)
}

export function markUnlocked(profile: string) {
  const s = unlockedSet()
  if (s.includes(profile)) return
  try {
    sessionStorage.setItem(SESSION, JSON.stringify([...s, profile]))
  } catch {}
}

export function lockAll() {
  try {
    sessionStorage.removeItem(SESSION)
  } catch {}
}
