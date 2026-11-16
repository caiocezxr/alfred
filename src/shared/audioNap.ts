// Um AudioContext "running" mantém a thread de áudio do WebKit renderizando silêncio para sempre.
// Depois de tocar um som curto, suspende o contexto; o próximo som acorda de novo.
const timers = new WeakMap<AudioContext, number>()

export function wakeCtx(ctx: AudioContext, napMs = 4000) {
  if (ctx.state === 'suspended') void ctx.resume()
  window.clearTimeout(timers.get(ctx))
  timers.set(
    ctx,
    window.setTimeout(() => {
      if (ctx.state === 'running') void ctx.suspend()
    }, napMs),
  )
}
