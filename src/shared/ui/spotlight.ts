let current: HTMLElement | null = null
let tilted: HTMLElement | null = null
let frame = 0
const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
let lastEvent: PointerEvent | null = null

const SELECTOR = '.panel, .bx-story, .bx-cover'

function tilt(e: PointerEvent) {
  const t = e.target instanceof Element ? (e.target.closest('[data-tilt], .bx-story, .bx-cover, .wx, .hc, .dc') as HTMLElement | null) : null
  if (t !== tilted) {
    if (tilted) {
      tilted.style.setProperty('--rx', '0deg')
      tilted.style.setProperty('--ry', '0deg')
      tilted.style.setProperty('--tx', '0')
      tilted.style.setProperty('--ty', '0')
      tilted.classList.remove('is-tilting')
    }
    tilted = t
  }
  if (!t || reduce) return
  const r = t.getBoundingClientRect()
  const max = Number(t.dataset.tilt) || 6
  const x = (e.clientX - r.left) / r.width - 0.5
  const y = (e.clientY - r.top) / r.height - 0.5
  t.style.setProperty('--rx', `${(-y * max).toFixed(2)}deg`)
  t.style.setProperty('--ry', `${(x * max).toFixed(2)}deg`)
  t.style.setProperty('--tx', x.toFixed(3))
  t.style.setProperty('--ty', y.toFixed(3))
  t.classList.add('is-tilting')
}

function apply() {
  frame = 0
  const e = lastEvent
  if (!e) return
  tilt(e)
  const target = e.target instanceof Element ? (e.target.closest(SELECTOR) as HTMLElement | null) : null
  if (target !== current) {
    current?.style.setProperty('--lit', '0')
    current = target
  }
  if (!target) return
  const r = target.getBoundingClientRect()
  target.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`)
  target.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`)
  target.style.setProperty('--lit', '1')
}

export function startSpotlight() {
  if (window.matchMedia('(hover: none)').matches) return
  window.addEventListener(
    'pointermove',
    (e) => {
      lastEvent = e
      if (!frame) frame = requestAnimationFrame(apply)
    },
    { passive: true },
  )
  document.addEventListener('pointerleave', () => {
    current?.style.setProperty('--lit', '0')
    current = null
    if (tilted) {
      tilted.style.setProperty('--rx', '0deg')
      tilted.style.setProperty('--ry', '0deg')
      tilted.classList.remove('is-tilting')
      tilted = null
    }
  })
}
