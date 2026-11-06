import { forwardRef, useEffect, useMemo, useState } from 'react'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import { dueLabel, findDuplicate, parseCapture, type Scope } from './logic'
import { createItem, createTodo, openDialog, openItem, readUi, writeUi } from './store'
import { KIND_LABEL, MODE_LABEL, PERSONAL_ID, PRIORITY_LABEL, type WorkState } from './types'

const TOKENS: { label: string; insert: string; hint?: string }[] = [
  { label: '#chamado', insert: '#', hint: 'código' },
  { label: '@empresa', insert: '@', hint: 'espaço' },
  { label: '!', insert: '!', hint: 'prioridade' },
  { label: 'sexta', insert: 'sexta', hint: 'prazo' },
  { label: 'às 15h', insert: 'às 15h', hint: 'lembrete' },
  { label: 'todo dia', insert: 'todo dia', hint: 'recorrente' },
]

export const Capture = forwardRef<HTMLInputElement, { state: WorkState; today: string; scope: Scope }>(function Capture({ state, today, scope }, ref) {
  const [draft, setDraft] = useState('')
  const [pref, setPref] = useState<'todo' | 'work'>(() => readUi().captureTarget ?? 'work')
  const [space, setSpace] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => {
      const add = (e as CustomEvent<string>).detail
      setDraft((d) => `${d.replace(/\s+(?:às\s+)?\d{1,2}(?:h\d{0,2}|:\d{2})\s*$/i, '').trimEnd()}${d.trim() ? ' ' : ''}${add}`)
      const el = typeof ref === 'object' && ref ? ref.current : null
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(0, 0)
      })
    }
    window.addEventListener('wk:prefill', on)
    return () => window.removeEventListener('wk:prefill', on)
  }, [ref])
  const ids = state.companies.map((c) => c.id)
  const fallback = space ?? (scope !== 'all' ? scope : (readUi().lastCompany && ids.includes(readUi().lastCompany!) ? readUi().lastCompany! : ids[0]))
  const systems = useMemo(() => [...new Set(state.items.map((i) => i.system).filter((s): s is string => !!s))], [state.items])
  const q = parseCapture(draft, today, state.companies, fallback, systems)
  const target = q.target ?? (q.companyId === PERSONAL_ID ? 'todo' : pref)
  const company = state.companies.find((c) => c.id === q.companyId)
  const dup = target === 'work' ? findDuplicate(state.items, q.companyId, q.ticket) : null

  const insert = (token: string) => {
    const el = typeof ref === 'object' && ref ? ref.current : null
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    const before = draft.slice(0, start)
    const after = draft.slice(end)
    const glue = (token === '#' || token === '@') ? '' : ' '
    const pre = before && !/\s$/.test(before) ? ' ' : ''
    const piece = `${pre}${token}${glue}`
    const next = `${before}${piece}${after.replace(/^\s+/, glue ? '' : '')}`
    setDraft(next)
    requestAnimationFrame(() => {
      el?.focus()
      const pos = before.length + piece.length
      el?.setSelectionRange(pos, pos)
    })
  }
  const cycleSpace = () => {
    const i = ids.indexOf(q.companyId)
    setSpace(ids[(i + 1) % ids.length])
  }
  const flip = () => {
    const next = target === 'todo' ? 'work' : 'todo'
    setPref(next)
    writeUi({ captureTarget: next })
  }
  const submit = async (force: boolean) => {
    if (!q.title && !q.ticket) return
    if (dup && !force) {
      setDraft('')
      openItem(dup.id)
      return
    }
    setDraft('')
    setSpace(null)
    if (target === 'todo') {
      await createTodo({
        companyId: q.companyId,
        title: q.title,
        priority: q.priority,
        mode: q.mode ?? (q.dueDate ? 'dated' : 'fixed'),
        weekdaysOnly: q.weekdaysOnly,
        dueDate: q.dueDate,
        remindTime: q.remindTime,
        mustNotForget: q.mustNotForget,
      })
    } else {
      await createItem({ companyId: q.companyId, title: q.title || q.ticket || 'Chamado', ticket: q.ticket, priority: q.priority, dueDate: q.dueDate, kind: q.kind ?? undefined, system: q.system, url: q.url })
    }
  }

  return (
    <div className="wk-capture" style={coStyle(company)}>
      <span className="wk-cap-plus" aria-hidden="true">
        <Icon name="plus" size={14} />
      </span>
      <button className="wk-cap-space" onClick={cycleSpace} title="Trocar espaço (ou escreva @statix, @livelo, @pessoal)" aria-label={`Espaço: ${company?.name}. Trocar`}>
        <CompanyMark company={company} size={20} />
      </button>
      <input
        ref={ref}
        className="wk-cap-input"
        value={draft}
        placeholder={target === 'todo' ? 'Novo to-do…' : 'Capturar chamado, entrega ou ideia…'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit(e.shiftKey)
          }
          if (e.key === 'Escape') {
            setDraft('')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        aria-describedby="wk-cap-hint"
        aria-label="Captura rápida"
      />
      <div className="wk-cap-chips">
        <button className={`wk-cap-kind is-${target}`} onClick={flip} title="Alternar entre to-do e item de trabalho" aria-label={`Tipo: ${target === 'todo' ? 'to-do' : 'item de trabalho'}. Alternar`}>
          <Icon name={target === 'todo' ? 'check' : 'board'} size={12} />
          {target === 'todo' ? 'To-do' : 'Trabalho'}
        </button>
        {draft && (
          <>
            {q.ticket && <span className="wk-chip">{q.ticket}</span>}
            {q.priority !== 'normal' && <span className={`wk-chip is-prio-${q.priority}`}>{PRIORITY_LABEL[q.priority]}</span>}
            {q.dueDate && <span className="wk-chip">{dueLabel(q.dueDate, today)}</span>}
            {target === 'todo' && q.mode && q.mode !== 'dated' && <span className="wk-chip">{q.weekdaysOnly ? 'Dias úteis' : MODE_LABEL[q.mode]}</span>}
            {q.remindTime && (
              <span className="wk-chip">
                <Icon name="bell" size={10} />
                {q.remindTime}
              </span>
            )}
            {q.mustNotForget && <span className="wk-chip is-forget">não pode esquecer</span>}
            {q.kind && <span className="wk-chip">{KIND_LABEL[q.kind]}</span>}
            {q.system && <span className="wk-chip">{q.system}</span>}
            {q.url && (
              <span className="wk-chip">
                <Icon name="link" size={10} />
                link
              </span>
            )}
          </>
        )}
        {!draft && <kbd className="wk-cap-kbd" title="Focar a captura">⌘/</kbd>}
        <button className="wk-icon-btn wk-cap-forget" onClick={() => openDialog({ kind: 'todo', draft: { title: q.title, companyId: q.companyId, mustNotForget: true, remindTime: q.remindTime, dueDate: q.dueDate, mode: q.mode ?? undefined } })} title="Não pode esquecer" aria-label="Criar um não pode esquecer">
          <Icon name="alarm" size={15} />
        </button>
      </div>
      <span id="wk-cap-hint" className="wk-cap-hint">
        {dup ? (
          <span className="wk-cap-dup">
            <Icon name="flag" size={11} /> {dup.ticket} já existe: “{dup.title}”. <kbd>Enter</kbd> abre · <kbd>⇧ Enter</kbd> cria outro
          </span>
        ) : (
          <>
            {TOKENS.map((t) => (
              <button key={t.label} type="button" className="wk-cap-token" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t.insert)} title={t.hint}>
                <kbd>{t.label}</kbd>
                {t.hint && <span>{t.hint}</span>}
              </button>
            ))}
            <span className="wk-cap-paste">ou cole o link do chamado</span>
            <span className="wk-grow" />
            <kbd>Enter</kbd>
            <span>salva</span>
            <kbd>Esc</kbd>
            <span>limpa</span>
          </>
        )}
      </span>
    </div>
  )
})
