import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { addDays, weekday } from '../../shared/dates'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import { dueLabel, findDuplicate, parseCapture, type Scope } from './logic'
import { createItem, createTodo, openItem, readUi, writeUi } from './store'
import { PERSONAL_ID, PRIORITY_LABEL, type Priority, type WorkState } from './types'

type Repeat = 'none' | 'daily' | 'weekdays'
type Over = { dueDate?: string | null; remindTime?: string | null; priority?: Priority; repeat?: Repeat; forget?: boolean; ticket?: string | null }
type Menu = 'space' | 'due' | 'remind' | 'repeat' | 'ticket' | null

const PRIOS: Priority[] = ['normal', 'alta', 'urgente']
const pad = (n: number) => String(n).padStart(2, '0')

function nextWeekday(today: string, wd: number) {
  const d = (wd - weekday(today) + 7) % 7 || 7
  return addDays(today, d)
}

function inAnHour() {
  const d = new Date(Date.now() + 60 * 60000)
  const m = Math.ceil(d.getMinutes() / 15) * 15
  d.setMinutes(m, 0, 0)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const Capture = forwardRef<HTMLInputElement, { state: WorkState; today: string; scope: Scope }>(function Capture({ state, today, scope }, ref) {
  const [draft, setDraft] = useState('')
  const [pref, setPref] = useState<'todo' | 'work'>(() => readUi().captureTarget ?? 'work')
  const [space, setSpace] = useState<string | null>(null)
  const [ov, setOv] = useState<Over>({})
  const [menu, setMenu] = useState<Menu>(null)
  const [forced, setForced] = useState<'todo' | 'work' | null>(null)
  const [focused, setFocused] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = () => (typeof ref === 'object' && ref ? ref.current : null)

  useEffect(() => {
    const on = (e: Event) => {
      const add = (e as CustomEvent<string>).detail
      setDraft((d) => `${d.replace(/\s+(?:às\s+)?\d{1,2}(?:h\d{0,2}|:\d{2})\s*$/i, '').trimEnd()}${d.trim() ? ' ' : ''}${add}`)
      requestAnimationFrame(() => {
        input()?.focus()
        input()?.setSelectionRange(0, 0)
      })
    }
    window.addEventListener('wk:prefill', on)
    return () => window.removeEventListener('wk:prefill', on)
  }, [ref])

  useEffect(() => {
    if (!menu) return
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [menu])

  const ids = state.companies.map((c) => c.id)
  const fallback = space ?? (scope !== 'all' ? scope : (readUi().lastCompany && ids.includes(readUi().lastCompany!) ? readUi().lastCompany! : ids[0]))
  const systems = useMemo(() => [...new Set(state.items.map((i) => i.system).filter((s): s is string => !!s))], [state.items])
  const q = parseCapture(draft, today, state.companies, fallback, systems)
  const target = forced ?? q.target ?? (q.companyId === PERSONAL_ID ? 'todo' : pref)
  const company = state.companies.find((c) => c.id === q.companyId)

  const dueDate = ov.dueDate !== undefined ? ov.dueDate : q.dueDate
  const remindTime = ov.remindTime !== undefined ? ov.remindTime : q.remindTime
  const priority = ov.priority ?? q.priority
  const repeat: Repeat = ov.repeat ?? (q.mode === 'daily' ? (q.weekdaysOnly ? 'weekdays' : 'daily') : 'none')
  const forget = ov.forget ?? q.mustNotForget
  const ticket = ov.ticket !== undefined ? ov.ticket : q.ticket
  const dup = target === 'work' ? findDuplicate(state.items, q.companyId, ticket) : null
  const open = focused || !!draft || !!menu
  const title = q.title || ticket || ''

  const keep = (e: { preventDefault: () => void }) => e.preventDefault()
  const set = (patch: Over) => {
    setOv((o) => ({ ...o, ...patch }))
    setMenu(null)
    requestAnimationFrame(() => input()?.focus())
  }

  const flip = (next: 'todo' | 'work') => {
    setPref(next)
    setForced(next)
    writeUi({ captureTarget: next })
    requestAnimationFrame(() => input()?.focus())
  }

  const reset = () => {
    setDraft('')
    setSpace(null)
    setOv({})
    setMenu(null)
    setForced(null)
  }

  const submit = async (force: boolean) => {
    if (!title) return
    if (dup && !force) {
      reset()
      openItem(dup.id)
      return
    }
    reset()
    if (target === 'todo') {
      const mode = repeat !== 'none' ? 'daily' : dueDate ? 'dated' : (q.mode ?? 'fixed')
      await createTodo({
        companyId: q.companyId,
        title: q.title || title,
        priority,
        mode,
        weekdaysOnly: repeat === 'weekdays',
        dueDate: repeat !== 'none' ? null : dueDate,
        remindTime,
        mustNotForget: forget,
      })
    } else {
      await createItem({ companyId: q.companyId, title: q.title || ticket || 'Chamado', ticket, priority, dueDate, kind: q.kind ?? undefined, system: q.system, url: q.url })
    }
  }

  const dueText = repeat !== 'none' ? null : dueDate ? dueLabel(dueDate, today) : null
  const preview = [
    target === 'todo' ? 'To-do' : 'Trabalho',
    company?.name,
    ticket,
    dueText && `prazo ${dueText.toLowerCase()}`,
    repeat === 'daily' ? 'todo dia' : repeat === 'weekdays' ? 'dias úteis' : null,
    remindTime && `lembrete ${remindTime}`,
    priority !== 'normal' && `prioridade ${PRIORITY_LABEL[priority].toLowerCase()}`,
    forget && 'não pode esquecer',
  ].filter(Boolean)

  const chip = (id: Exclude<Menu, null>, icon: Parameters<typeof Icon>[0]['name'], label: string, value: string | null, extra?: ReactNode) => (
    <div className={`wk-qc-wrap ${menu === id ? 'is-open' : ''}`}>
      <button type="button" className={`wk-qc ${value ? 'is-set' : ''}`} onMouseDown={keep} onClick={() => setMenu(menu === id ? null : id)} aria-expanded={menu === id}>
        <Icon name={icon} size={12} />
        <span>{value ?? label}</span>
      </button>
      {menu === id && <div className="wk-qmenu" role="menu">{extra}</div>}
    </div>
  )

  const opt = (label: string, on: boolean, act: () => void, hint?: string) => (
    <button type="button" role="menuitemradio" aria-checked={on} className={`wk-qopt ${on ? 'is-on' : ''}`} onMouseDown={keep} onClick={act}>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  )

  return (
    <div ref={box} className={`wk-capture is-v2 ${open ? 'is-open' : ''}`} style={coStyle(company)}>
      <div className="wk-cap-row">
        <div className="wk-cap-seg" role="radiogroup" aria-label="Tipo">
          <button type="button" role="radio" aria-checked={target === 'todo'} className={target === 'todo' ? 'is-on' : ''} onMouseDown={keep} onClick={() => flip('todo')}>
            <Icon name="check" size={12} /> To-do
          </button>
          <button type="button" role="radio" aria-checked={target === 'work'} className={target === 'work' ? 'is-on' : ''} onMouseDown={keep} onClick={() => flip('work')}>
            <Icon name="board" size={12} /> Trabalho
          </button>
          <i className={`wk-cap-seg-pill is-${target}`} aria-hidden="true" />
        </div>
        <div className={`wk-qc-wrap ${menu === 'space' ? 'is-open' : ''}`}>
          <button type="button" className="wk-cap-space" onMouseDown={keep} onClick={() => setMenu(menu === 'space' ? null : 'space')} aria-label={`Espaço: ${company?.name}. Trocar`} title="Espaço">
            <CompanyMark company={company} size={20} />
            <span className="wk-cap-space-n">{company?.name}</span>
            <Icon name="chevron" size={10} />
          </button>
          {menu === 'space' && (
            <div className="wk-qmenu" role="menu">
              {state.companies.map((c) =>
                opt(c.name, c.id === q.companyId, () => {
                  setSpace(c.id)
                  setMenu(null)
                  requestAnimationFrame(() => input()?.focus())
                }),
              )}
            </div>
          )}
        </div>
        <input
          ref={ref}
          className="wk-cap-input"
          value={draft}
          placeholder={target === 'todo' ? 'O que você precisa fazer?' : 'Qual chamado, entrega ou ideia?'}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit(e.shiftKey)
            }
            if (e.key === 'Escape') {
              if (menu) return setMenu(null)
              reset()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          aria-label="Captura rápida"
        />
        {title ? (
          <button type="button" className="wk-cap-go" onMouseDown={keep} onClick={() => void submit(false)}>
            Criar <kbd>↵</kbd>
          </button>
        ) : (
          <kbd className="wk-cap-kbd" title="Focar a captura">
            ⌘/
          </kbd>
        )}
      </div>

      <div className="wk-cap-tray" aria-hidden={!open}>
        <div className="wk-cap-chips2">
          {chip(
            'due',
            'cal',
            'Prazo',
            dueText,
            <>
              {opt('Hoje', dueDate === today, () => set({ dueDate: today, repeat: 'none' }))}
              {opt('Amanhã', dueDate === addDays(today, 1), () => set({ dueDate: addDays(today, 1), repeat: 'none' }))}
              {opt('Sexta', dueDate === nextWeekday(today, 5), () => set({ dueDate: nextWeekday(today, 5), repeat: 'none' }))}
              {opt('Próxima segunda', dueDate === nextWeekday(today, 1), () => set({ dueDate: nextWeekday(today, 1), repeat: 'none' }))}
              <label className="wk-qopt is-field" onMouseDown={(e) => e.stopPropagation()}>
                <span>Escolher</span>
                <input type="date" value={dueDate ?? ''} onChange={(e) => e.target.value && set({ dueDate: e.target.value, repeat: 'none' })} />
              </label>
              {dueDate && opt('Sem prazo', false, () => set({ dueDate: null }))}
            </>,
          )}
          {chip(
            'remind',
            'bell',
            'Lembrete',
            remindTime,
            <>
              {opt('Daqui a 1 hora', false, () => set({ remindTime: inAnHour() }), inAnHour())}
              {['09:00', '14:00', '18:00'].map((t) => opt(t, remindTime === t, () => set({ remindTime: t })))}
              <label className="wk-qopt is-field" onMouseDown={(e) => e.stopPropagation()}>
                <span>Outro horário</span>
                <input type="time" value={remindTime ?? ''} onChange={(e) => e.target.value && setOv((o) => ({ ...o, remindTime: e.target.value }))} />
              </label>
              {remindTime && opt('Sem lembrete', false, () => set({ remindTime: null }))}
            </>,
          )}
          <button
            type="button"
            className={`wk-qc is-prio-${priority} ${priority !== 'normal' ? 'is-set' : ''}`}
            onMouseDown={keep}
            onClick={() => setOv((o) => ({ ...o, priority: PRIOS[(PRIOS.indexOf(priority) + 1) % PRIOS.length] }))}
            title="Clique para mudar a prioridade"
          >
            <Icon name="flag" size={12} />
            <span>{priority === 'normal' ? 'Prioridade' : PRIORITY_LABEL[priority]}</span>
          </button>
          {target === 'todo' ? (
            <>
              {chip(
                'repeat',
                'repeat',
                'Repetir',
                repeat === 'daily' ? 'Todo dia' : repeat === 'weekdays' ? 'Dias úteis' : null,
                <>
                  {opt('Não repete', repeat === 'none', () => set({ repeat: 'none' }))}
                  {opt('Todo dia', repeat === 'daily', () => set({ repeat: 'daily', dueDate: null }))}
                  {opt('Dias úteis', repeat === 'weekdays', () => set({ repeat: 'weekdays', dueDate: null }))}
                </>,
              )}
              <button type="button" className={`wk-qc is-forget ${forget ? 'is-set' : ''}`} onMouseDown={keep} onClick={() => setOv((o) => ({ ...o, forget: !forget }))} title="Fica em destaque até você resolver">
                <Icon name="alarm" size={12} />
                <span>Não esquecer</span>
              </button>
            </>
          ) : (
            chip(
              'ticket',
              'hash',
              'Nº do chamado',
              ticket,
              <label className="wk-qopt is-field" onMouseDown={(e) => e.stopPropagation()}>
                <span>Chamado</span>
                <input
                  autoFocus
                  placeholder="#1234"
                  defaultValue={ticket ?? ''}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const v = (e.target as HTMLInputElement).value.trim()
                      set({ ticket: v ? (v.startsWith('#') || /^[A-Z]+-\d+$/.test(v) ? v : `#${v}`) : null })
                    }
                  }}
                />
              </label>,
            )
          )}
        </div>
        <div className="wk-cap-say">
          {dup ? (
            <span className="wk-cap-dup">
              <Icon name="flag" size={11} /> {dup.ticket} já existe: “{dup.title}”. <kbd>Enter</kbd> abre · <kbd>⇧ Enter</kbd> cria outro
            </span>
          ) : title ? (
            <span>
              Vai criar: <b>{preview.join(' · ')}</b>
            </span>
          ) : (
            <span>
              Dica: escreva do seu jeito, tipo <em>“ligar pro João amanhã às 10h !”</em>, que eu entendo o prazo, a hora e a prioridade. <em>@statix</em> troca a empresa e <em>#1234</em> marca o chamado.
            </span>
          )}
        </div>
      </div>
    </div>
  )
})
