import { useCallback, useEffect, useMemo, useState } from 'react'
import { civil } from '../../shared/dates'
import { Capture } from './Capture'
import { nextStep, type Focus, type NextStep, type Stage } from './flow'
import { IdeaDetail, type OpenRequest } from './IdeaDetail'
import { IdeaList } from './IdeaList'
import { ArrowIcon, BookIcon } from './icons'
import { Library } from './Library'
import { Pulse } from './Pulse'
import type { PrincipleId } from './questions'
import { assessIdea, loadIdeas, useIdeas } from './store'
import type { Idea } from './types'
import './ideas.css'

let lastSelected: string | null = null

export type OpenIdea = (id: string, stage?: Stage, focus?: Focus) => void

export default function Ideas() {
  const { ideas, loaded } = useIdeas()
  const today = civil()
  const [selected, setSelected] = useState<string | null>(lastSelected)
  const [request, setRequest] = useState<OpenRequest | null>(null)
  const [lib, setLib] = useState<{ open: boolean; focus: PrincipleId | null }>({ open: false, focus: null })

  useEffect(() => {
    void loadIdeas()
  }, [])

  const steps = useMemo(() => {
    const m = new Map<string, NextStep>()
    for (const i of ideas) m.set(i.id, nextStep(i, assessIdea(i, today), today))
    return m
  }, [ideas, today])

  const open = useCallback<OpenIdea>((id, stage, focus = null) => {
    lastSelected = id
    setSelected(id)
    setRequest((r) => (stage ? { id, stage, focus, n: (r?.n ?? 0) + 1 } : null))
  }, [])
  const openLib = useCallback((focus: PrincipleId | null = null) => setLib({ open: true, focus }), [])
  const closeLib = useCallback(() => setLib((l) => ({ ...l, open: false })), [])
  const onCaptured = useCallback((i: Idea) => open(i.id, 'diagnosis', 'question'), [open])

  const current = ideas.find((i) => i.id === selected) ?? ideas.find((i) => i.status !== 'archived') ?? ideas[0] ?? null

  return (
    <section className={`page lab ${loaded && !current ? 'is-empty' : ''}`}>
      <header className="lab-head reveal" style={{ ['--i' as string]: 0 }}>
        <div>
          <div className="kicker">Laboratório de ideias</div>
          <h1 className="display">Laboratório</h1>
          {current ? (
            <Pulse ideas={ideas} steps={steps} selectedId={current.id} onOpen={open} />
          ) : (
            <p className="lab-sub">Vale testar? Quem paga? Por onde começo? O que não construir agora?</p>
          )}
        </div>
        <button className="btn lab-lib-btn" onClick={() => openLib()}>
          <BookIcon size={15} />
          Princípios
        </button>
      </header>

      {!loaded ? (
        <div className="lab-loading" aria-busy="true" />
      ) : !current ? (
        <Hero onCaptured={onCaptured} onLib={() => openLib()} />
      ) : (
        <div className="lab-grid">
          <aside className="panel lab-side reveal" style={{ ['--i' as string]: 1 }} aria-label="Ideias">
            <Capture variant="compact" onCaptured={onCaptured} />
            <IdeaList ideas={ideas} steps={steps} selectedId={current.id} today={today} onOpen={open} />
          </aside>
          <div className="lab-main reveal" style={{ ['--i' as string]: 2 }}>
            <IdeaDetail key={current.id} idea={current} ideas={ideas} today={today} request={request} onPrinciple={openLib} />
          </div>
        </div>
      )}

      <Library open={lib.open} focus={lib.focus} onClose={closeLib} />
    </section>
  )
}

function Hero({ onCaptured, onLib }: { onCaptured: (i: Idea) => void; onLib: () => void }) {
  const steps = ['Capturar', 'Diagnosticar', 'Testar barato', 'Decidir']
  return (
    <div className="lab-hero reveal" style={{ ['--i' as string]: 1 }}>
      <h2 className="display lab-hero-title">Toda ideia começa barata.</h2>
      <p className="lab-hero-text">Escreva em uma frase e aperte Enter. O diagnóstico vem em seguida, com perguntas curtas — e “não sei” é uma resposta válida.</p>
      <Capture variant="hero" onCaptured={onCaptured} />
      <ol className="lab-hero-flow" aria-label="Como funciona">
        {steps.map((s, i) => (
          <li key={s} style={{ ['--i' as string]: i }}>
            <span className="lab-hero-n" aria-hidden="true">{i + 1}</span>
            {s}
            {i < steps.length - 1 && <ArrowIcon size={12} />}
          </li>
        ))}
      </ol>
      <button className="lab-principle-link" onClick={onLib}>
        <BookIcon size={14} />
        Ler os princípios
      </button>
    </div>
  )
}
