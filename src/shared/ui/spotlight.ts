let current: HTMLElement | null = null
let frame = 0
let lastEvent: PointerEvent | null = null

const SELECTOR = '.panel, .bx-story, .bx-cover'

function apply() {
  frame = 0
  const e = lastEvent
  if (!e) return
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
  })
}
