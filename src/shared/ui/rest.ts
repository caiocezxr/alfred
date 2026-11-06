const IDLE_MS = 20_000

let held: Animation[] = []
let resting = false
let timer = 0
const wakers = new Set<() => void>()

export const isResting = () => resting

export function onWake(fn: () => void) {
  wakers.add(fn)
  return () => {
    wakers.delete(fn)
  }
}

function pause() {
  if (resting) return
  resting = true
  held = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
  for (const a of held) a.pause()
}

function wake() {
  if (!resting) return
  resting = false
  for (const a of held) if (a.playState === 'paused') a.play()
  held = []
  for (const f of wakers) f()
}

function away() {
  return document.visibilityState === 'hidden' || !document.hasFocus()
}

function sync() {
  window.clearTimeout(timer)
  if (away()) return pause()
  wake()
  timer = window.setTimeout(() => !away() && pause(), IDLE_MS)
}

let last = 0
function touch() {
  const now = performance.now()
  if (!resting && now - last < 1000) return
  last = now
  sync()
}

export function startRest() {
  window.addEventListener('blur', sync)
  window.addEventListener('focus', sync)
  document.addEventListener('visibilitychange', sync)
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, touch, { passive: true, capture: true })
  sync()
}
