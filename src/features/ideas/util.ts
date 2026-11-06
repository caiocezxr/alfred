import { useLayoutEffect, useRef, type RefObject } from 'react'
import { civil, daysBetween } from '../../shared/dates'

export const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
export const numberFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })

export const civilOf = (iso: string) => civil(new Date(iso))

export function shortDate(isoOrCivil: string): string {
  const d = isoOrCivil.length === 10 ? new Date(`${isoOrCivil}T12:00:00`) : new Date(isoOrCivil)
  return dayMonth.format(d).replace('.', '')
}

export function ago(iso: string, today = civil()): string {
  const diff = daysBetween(civilOf(iso), today)
  if (diff <= 0) return 'hoje'
  if (diff === 1) return 'ontem'
  if (diff < 7) return `há ${diff} dias`
  return `em ${shortDate(iso)}`
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const isHttpUrl = (s: string) => /^https?:\/\/[^\s/][^\s]*$/i.test(s.trim())

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

export function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(close)
  useLayoutEffect(() => {
    closeRef.current = close
  })
  useLayoutEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRef.current()
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  return { box, trigger }
}
