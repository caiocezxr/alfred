import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import { isTauri } from '../../shared/db/api'
import { Icon } from '../work/icons'

const known = new Map<string, boolean>()

export function useAlfredRepo(repos: string[]) {
  const [hit, setHit] = useState<string | null>(() => repos.find((r) => known.get(r)) ?? null)
  useEffect(() => {
    if (!isTauri) return
    let alive = true
    void (async () => {
      for (const r of repos) {
        if (!known.has(r)) known.set(r, await invoke<boolean>('sessao_alfred_repo', { path: r }).catch(() => false))
        if (known.get(r)) {
          if (alive) setHit(r)
          return
        }
      }
      if (alive) setHit(null)
    })()
    return () => {
      alive = false
    }
  }, [repos.join('|')])
  return hit
}

type Ev = { kind: 'step' | 'line' | 'done' | 'fail'; text: string }

export function ApplyAlfred({ repo }: { repo: string }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'building' | 'ready' | 'fail'>('idle')
  const [step, setStep] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [arm, setArm] = useState(false)
  const box = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!isTauri) return
    const un = listen<Ev>('sessao-build', (e) => {
      const ev = e.payload
      if (ev.kind === 'step') setStep(ev.text)
      if (ev.kind === 'line') setLines((l) => [...l.slice(-160), ev.text])
      if (ev.kind === 'done') setState('ready')
      if (ev.kind === 'fail') {
        setState('fail')
        setErr(ev.text)
      }
    })
    return () => {
      void un.then((f) => f())
    }
  }, [])

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines])

  const build = async () => {
    setOpen(true)
    setState('building')
    setLines([])
    setErr(null)
    setStep('Interface')
    try {
      await invoke('sessao_alfred_build', { path: repo })
    } catch (e) {
      setState('fail')
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const install = async () => {
    if (!arm) return setArm(true)
    try {
      await invoke('sessao_alfred_install', { path: repo })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setArm(false)
    }
  }

  return (
    <div className="apl">
      <button className={`apl-btn is-${state}`} onClick={() => (state === 'idle' ? void build() : setOpen((o) => !o))} title="Compila o Alfred com as mudanças desta desk e reinstala">
        <Icon name={state === 'ready' ? 'check' : 'spark'} size={12} />
        {state === 'building' ? `Compilando · ${step}` : state === 'ready' ? 'Pronto para aplicar' : state === 'fail' ? 'Falhou' : 'Aplicar no Alfred'}
      </button>
      {open && (
        <div className="apl-pop" role="dialog" aria-label="Aplicar no Alfred">
          <header>
            <b>Aplicar no Alfred</b>
            <button className="apl-x" onClick={() => setOpen(false)} aria-label="Fechar">
              <Icon name="x" size={10} />
            </button>
          </header>
          <ol className="apl-steps">
            {['Interface', 'App', 'Reinstalar'].map((s, i) => {
              const idx = ['Interface', 'App'].indexOf(step)
              const done = state === 'ready' ? i < 2 : i < idx
              const now = state === 'building' && s === step
              return (
                <li key={s} className={`${done ? 'is-done' : ''} ${now ? 'is-now' : ''} ${state === 'fail' && now ? 'is-fail' : ''}`}>
                  <i aria-hidden="true" />
                  {s === 'Interface' ? 'Compilar a interface' : s === 'App' ? 'Compilar o app' : 'Trocar o app e reabrir'}
                </li>
              )
            })}
          </ol>
          {lines.length > 0 && <pre ref={box}>{lines.slice(-60).join('\n')}</pre>}
          {err && <pre className="apl-err">{err}</pre>}
          <footer>
            {state === 'ready' && (
              <button className={`apl-go ${arm ? 'is-arm' : ''}`} onClick={() => void install()}>
                {arm ? 'Confirmar: fechar e reabrir o Alfred' : 'Reiniciar com a versão nova'}
              </button>
            )}
            {(state === 'fail' || state === 'ready') && (
              <button className="apl-ghost" onClick={() => void build()}>
                Compilar de novo
              </button>
            )}
            {state === 'building' && <span className="apl-note">Leva uns minutos. Pode continuar usando o Alfred enquanto isso.</span>}
          </footer>
        </div>
      )}
    </div>
  )
}
