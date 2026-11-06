import { forwardRef, useMemo, useState } from 'react'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import { dueLabel, findDuplicate, parseCapture, type Scope } from './logic'
import { createItem, createTodo, openDialog, openItem, readUi, writeUi } from './store'
import { KIND_LABEL, MODE_LABEL, PERSONAL_ID, PRIORITY_LABEL, type WorkState } from './types'

export const Capture = forwardRef<HTMLInputElement, { state: WorkState; today: string; scope: Scope }>(function Capture({ state, today, scope }, ref) {
  const [draft, setDraft] = useState('')
  const [pref, setPref] = useState<'todo' | 'work'>(() => readUi().captureTarget ?? 'work')
  const [space, setSpace] = useState<string | null>(null)
  const ids = state.companies.map((c) => c.id)
  const fallback = space ?? (scope !== 'all' ? scope : (readUi().lastCompany && ids.includes(readUi().lastCompany!) ? readUi().lastCompany! : ids[0]))
  const systems = useMemo(() => [...new Set(state.items.map((i) => i.system).filter((s): s is string => !!s))], [state.items])
  const q = parseCapture(draft, today, state.companies, fallback, systems)
  const target = q.target ?? (q.companyId === PERSONAL_ID ? 'todo' : pref)
  const company = state.companies.find((c) => c.id === q.companyId)
  const dup = target === 'work' ? findDuplicate(state.items, q.companyId, q.ticket) : null

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
    if (!q.title) return
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
      await createItem({ companyId: q.companyId, title: q.title, ticket: q.ticket, priority: q.priority, dueDate: q.dueDate, kind: q.kind ?? undefined, system: q.system })
    }
  }

  return (
    <div className="panel wk-capture reveal" style={{ ['--i' as string]: 1, ...coStyle(company) }}>
      <button className="wk-cap-space" onClick={cycleSpace} title="Trocar espaço (ou escreva @statix, @livelo, @pessoal)" aria-label={`Espaço: ${company?.name}. Trocar`}>
        <CompanyMark company={company} size={20} />
      </button>
      <input
        ref={ref}
        className="wk-cap-input"
        value={draft}
        placeholder={target === 'todo' ? 'Novo to-do… (“todo dia”, “fixo”, “sexta”, “às 15h”)' : 'Novo chamado ou entrega… (#9488, @livelo, !, sexta)'}
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
          </>
        )}
        <button className="wk-icon-btn wk-cap-forget" onClick={() => openDialog({ kind: 'todo', draft: { title: q.title, companyId: q.companyId, mustNotForget: true, remindTime: q.remindTime, dueDate: q.dueDate, mode: q.mode ?? undefined } })} title="Não pode esquecer" aria-label="Criar um não pode esquecer">
          <Icon name="alarm" size={15} />
        </button>
      </div>
      <span id="wk-cap-hint" className="wk-cap-hint">
        {dup ? (
          <span className="wk-cap-dup">
            <Icon name="flag" size={11} /> {dup.ticket} já existe: “{dup.title}”. <b>Enter</b> abre o existente · <b>Shift+Enter</b> cria outro
          </span>
        ) : (
          <>
            <b>@espaço</b> · <b>#código</b> · <b>!</b> alta · <b>!!</b> urgente · <b>sexta</b>, <b>amanhã</b>, <b>15/11</b> · <b>todo dia</b>, <b>fixo</b>, <b>às 15h</b> · <b>não esquecer</b> · <b>/bug</b> <b>+sistema</b> · Enter salva
          </>
        )}
      </span>
    </div>
  )
})
