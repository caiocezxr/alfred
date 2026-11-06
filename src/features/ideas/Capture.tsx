import { useEffect, useRef, useState } from 'react'
import { onIntent } from '../../app/router'
import { ContentIcon, PlusIcon, ProductIcon } from './icons'
import { captureIdea } from './store'
import type { Idea, IdeaKind } from './types'
import { useAutosize } from './util'

let lastKind: IdeaKind = 'product'

export function Capture({ variant, onCaptured }: { variant: 'hero' | 'compact'; onCaptured: (idea: Idea) => void }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [kind, setKind] = useState<IdeaKind>(lastKind)
  const [focused, setFocused] = useState(false)
  const [pulse, setPulse] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  useAutosize(input, title)
  useAutosize(descRef, desc)

  useEffect(() => onIntent((i) => i === 'new-idea' && input.current?.focus()), [])
  useEffect(() => {
    if (variant === 'hero') input.current?.focus({ preventScroll: true })
  }, [variant])

  const hero = variant === 'hero'
  const draft = !!(title.trim() || desc.trim())
  const expanded = hero || focused || draft

  const save = async () => {
    const t = title.trim()
    if (!t) return
    const d = desc.trim()
    setTitle('')
    setDesc('')
    const idea = await captureIdea({ kind, title: t, description: d })
    if (!idea) {
      setTitle(t)
      setDesc(d)
      return
    }
    lastKind = kind
    setPulse((n) => n + 1)
    const active = document.activeElement as HTMLElement | null
    if (active && box.current?.contains(active) && !input.current?.value.trim()) active.blur()
    onCaptured(idea)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void save()
    }
    if (e.key === 'Escape') {
      ;(e.target as HTMLElement).blur()
    }
  }

  const pick = (k: IdeaKind) => {
    setKind(k)
    lastKind = k
  }

  return (
    <div
      ref={box}
      className={`lab-capture is-${variant} ${hero ? 'panel' : ''} ${expanded ? 'is-open' : ''} ${focused ? 'is-focused' : ''}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) setFocused(false)
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
    >
      <div className="lab-capture-row">
        <span className="lab-capture-plus" aria-hidden="true">
          <PlusIcon size={hero ? 20 : 16} />
          {pulse > 0 && <span key={pulse} className="lab-capture-ping" />}
        </span>
        <textarea
          ref={input}
          rows={1}
          className="lab-capture-input"
          placeholder={hero ? 'Uma ideia em uma frase…' : 'Nova ideia…'}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={onKey}
          aria-label="Título da nova ideia"
          aria-describedby={`lab-capture-hint-${variant}`}
        />
        {!expanded && (
          <kbd className="lab-capture-kbd" aria-hidden="true">
            ⌘N
          </kbd>
        )}
      </div>

      {expanded && (
        <div className="lab-capture-more">
          {(hero ? !!title.trim() || !!desc : true) && (
            <textarea
              ref={descRef}
              className="lab-capture-desc"
              rows={1}
              placeholder="Descrição, se quiser — o problema, para quem, o estalo que deu…"
              value={desc}
              maxLength={5000}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={onKey}
              aria-label="Descrição da ideia (opcional)"
            />
          )}
          <div className="lab-capture-foot">
            <div className="lab-kind" role="radiogroup" aria-label="Tipo da ideia" data-kind={kind}>
              <span className="lab-kind-pill" aria-hidden="true" />
              <button type="button" role="radio" aria-checked={kind === 'product'} className="lab-kind-btn" onClick={() => pick('product')} title="Produto digital / micro-SaaS">
                <ProductIcon size={14} />
                Produto
              </button>
              <button type="button" role="radio" aria-checked={kind === 'content'} className="lab-kind-btn" onClick={() => pick('content')} title="Conteúdo / canal / perfil">
                <ContentIcon size={14} />
                Conteúdo
              </button>
            </div>
            <button type="button" className={`btn primary ${hero ? '' : 'lab-sm'}`} disabled={!title.trim()} onClick={() => void save()}>
              Guardar
            </button>
          </div>
          <p id={`lab-capture-hint-${variant}`} className="lab-hint lab-capture-hint">
            <kbd>Enter</kbd> guarda e abre o diagnóstico
            {hero && (
              <>
                {' '}
                · <kbd>⇧</kbd>
                <kbd>Enter</kbd> quebra linha na descrição
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
