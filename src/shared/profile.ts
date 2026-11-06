import { useSyncExternalStore } from 'react'

export type Profile = string

export const HYBRID = 'hibrido'

const KEY = 'ps.profile.v1'
const EVENT = 'ps:profile'

const read = (): Profile => {
  try {
    return localStorage.getItem(KEY) || HYBRID
  } catch {
    return HYBRID
  }
}

let current: Profile = read()
let color: string | null = null
const listeners = new Set<() => void>()

export function getProfile() {
  return current
}

export function setProfile(p: Profile, profileColor: string | null = null) {
  color = profileColor
  if (p === current) {
    applyProfile()
    return
  }
  current = p
  try {
    localStorage.setItem(KEY, p)
  } catch {}
  applyProfile()
  listeners.forEach((l) => l())
  window.dispatchEvent(new CustomEvent(EVENT, { detail: p }))
}

export function profileScope(p: Profile = current) {
  return p === HYBRID ? 'all' : p
}

export function profileFromScope(scope: string): Profile {
  return scope === 'all' ? HYBRID : scope
}

export function applyProfile() {
  const root = document.documentElement
  root.dataset.profile = current
  if (color && current !== HYBRID) root.style.setProperty('--profile', color)
  else root.style.removeProperty('--profile')
}

export function onProfile(fn: (p: Profile) => void) {
  const h = (e: Event) => fn((e as CustomEvent<Profile>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

export function useProfile() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => current,
  )
}
