let held: Animation[] = []

function sync() {
  const away = document.visibilityState === 'hidden' || !document.hasFocus()
  if (away) {
    held = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
    for (const a of held) a.pause()
  } else {
    for (const a of held) if (a.playState === 'paused') a.play()
    held = []
  }
}

export function startRest() {
  window.addEventListener('blur', sync)
  window.addEventListener('focus', sync)
  document.addEventListener('visibilitychange', sync)
}
