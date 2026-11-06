import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { addDays, civil } from '../../shared/dates'
import { CompanyMark } from './brand'
import { Icon } from './icons'
import { checklistFor, isPost, label, standup, type Scope } from './logic'
import {
  convertTodo, createTodo, deleteItem, deleteTodo, doMove, giveBack, openDialog, setCheck, setWaiting, toast, todoById, updateTodo, useWork,
  type Dialog,
} from './store'
import { MODE_LABEL, PRIORITIES, PRIORITY_LABEL, STAGE_LABEL, type NewTodo, type Priority, type TodoMode, type WorkState } from './types'
import { WorkSettings } from './WorkSettings'

export function Modal({ label: aria, onClose, children, className = '' }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('textarea, input, select, button')
    first?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      prev?.focus?.()
    }
  }, [onClose])
  return createPortal(
    <div className="wk-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`wk-dialog ${className}`} role="dialog" aria-modal="true" aria-label={aria}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

const close = () => openDialog(null)

export function DialogHost({ state, scope }: { state: WorkState; scope: Scope }) {
  const { dialog } = useWork()
  if (!dialog) return null
  return <DialogSwitch dialog={dialog} state={state} scope={scope} />
}

function DialogSwitch({ dialog, state, scope }: { dialog: Dialog; state: WorkState; scope: Scope }) {
  switch (dialog.kind) {
    case 'deliver':
      return <DeliverDialog itemId={dialog.itemId} to={dialog.to} state={state} />
    case 'backward':
      return <BackwardDialog itemId={dialog.itemId} to={dialog.to} state={state} />
    case 'return':
      return <ReturnDialog itemId={dialog.itemId} state={state} />
    case 'wait':
      return <WaitDialog itemId={dialog.itemId} state={state} />
    case 'standup':
      return <StandupDialog state={state} scope={scope} />
    case 'todo':
      return <TodoDialog todoId={dialog.todoId} draft={dialog.draft} state={state} scope={scope} />
    case 'delete':
      return <DeleteDialog itemId={dialog.itemId} state={state} />
    case 'settings':
      return <WorkSettings state={state} tab={dialog.tab} onClose={close} />
  }
}

function DeliverDialog({ itemId, to, state }: { itemId: string; to: WorkState['items'][number]['stage']; state: WorkState }) {
  const item = state.items.find((i) => i.id === itemId)
  if (!item) return null
  const list = checklistFor(item.companyId, state.checklist)
  const pending = list.filter((c) => !item.checks.includes(c.id))
  const go = (force: boolean) => {
    close()
    void doMove(itemId, to, force)
  }
  return (
    <Modal label="Checklist antes de entregar" onClose={close} className="is-deliver">
      <span className="wk-dialog-icon is-warn" aria-hidden="true">
        <Icon name="shield" size={18} />
      </span>
      <h2 className="display">{pending.length ? 'Antes de entregar' : 'Tudo conferido'}</h2>
      <p>
        {pending.length
          ? `${label(item)} vai para ${STAGE_LABEL[to]}. ${pending.length === 1 ? 'Falta 1 item' : `Faltam ${pending.length} itens`} do checklist — confira agora:`
          : 'Checklist completo. Pode entregar com tranquilidade.'}
      </p>
      <ul className="wk-checklist is-dialog">
        {list.map((c) => {
          const on = item.checks.includes(c.id)
          return (
            <li key={c.id}>
              <label className={`wk-checkrow ${on ? 'is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={(e) => void setCheck(item.id, c.id, e.target.checked)} />
                <span className="wk-box" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="11" height="11">
                    <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
                  </svg>
                </span>
                {c.label}
              </label>
            </li>
          )
        })}
      </ul>
      <div className="wk-dialog-actions">
        <button className="btn quiet" onClick={close}>
          Voltar e conferir depois
        </button>
        {pending.length ? (
          <button className="btn wk-btn-warn" onClick={() => go(true)}>
            Entregar mesmo assim ({pending.length} pendente{pending.length > 1 ? 's' : ''})
          </button>
        ) : (
          <button className="btn primary" data-autofocus onClick={() => go(false)}>
            Entregar
          </button>
        )}
      </div>
    </Modal>
  )
}

const REASONS = ['Bug encontrado na validação', 'Faltou requisito', 'Dados divergentes', 'Ajuste de layout/texto', 'Erro em homologação']

function ReasonPicker({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <>
      <textarea
        className="field"
        rows={3}
        value={value}
        placeholder="O que voltou? Ex.: valor divergente no relatório de vendas"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
        }}
      />
      <div className="wk-chips-pick">
        {REASONS.map((r) => (
          <button key={r} className="wk-chip-btn" onClick={() => onChange(r)}>
            {r}
          </button>
        ))}
      </div>
    </>
  )
}

function ReturnDialog({ itemId, state }: { itemId: string; state: WorkState }) {
  const item = state.items.find((i) => i.id === itemId)
  const [reason, setReason] = useState('')
  if (!item) return null
  const submit = () => {
    if (!reason.trim()) return
    close()
    void giveBack(itemId, reason.trim())
  }
  return (
    <Modal label="Registrar retorno" onClose={close}>
      <span className="wk-dialog-icon is-warn" aria-hidden="true">
        <Icon name="back" size={18} />
      </span>
      <h2 className="display">Voltou</h2>
      <p>
        {label(item)} volta para Fazendo{item.returns ? ` (seria o ${item.returns + 1}º retorno)` : ''}. O checklist é zerado para você conferir de novo antes da próxima entrega.
      </p>
      <ReasonPicker value={reason} onChange={setReason} onSubmit={submit} />
      <div className="wk-dialog-actions">
        <button className="btn quiet" onClick={close}>
          Cancelar
        </button>
        <button className="btn primary" onClick={submit} disabled={!reason.trim()}>
          Registrar retorno
        </button>
      </div>
    </Modal>
  )
}

function BackwardDialog({ itemId, to, state }: { itemId: string; to: WorkState['items'][number]['stage']; state: WorkState }) {
  const item = state.items.find((i) => i.id === itemId)
  const [reason, setReason] = useState('')
  if (!item) return null
  const asReturn = () => {
    if (!reason.trim()) return
    close()
    void giveBack(itemId, reason.trim())
  }
  return (
    <Modal label="Voltar o item" onClose={close}>
      <span className="wk-dialog-icon is-warn" aria-hidden="true">
        <Icon name="back" size={18} />
      </span>
      <h2 className="display">Isso foi um retorno?</h2>
      <p>
        {label(item)} já tinha sido entregue. Se quem validou devolveu, registre o motivo: conta como retorno e o checklist recomeça. Se só arrastou errado, corrija o estágio.
      </p>
      <ReasonPicker value={reason} onChange={setReason} onSubmit={asReturn} />
      <div className="wk-dialog-actions">
        <button
          className="btn quiet"
          onClick={() => {
            close()
            void doMove(itemId, to, true, 'correção de estágio')
          }}
        >
          Só corrigir para {STAGE_LABEL[to]}
        </button>
        <button className="btn primary" onClick={asReturn} disabled={!reason.trim()}>
          Registrar retorno
        </button>
      </div>
    </Modal>
  )
}

function WaitDialog({ itemId, state }: { itemId: string; state: WorkState }) {
  const item = state.items.find((i) => i.id === itemId)
  const [who, setWho] = useState(item?.requester ?? '')
  const sugg = useMemo(() => {
    const s = new Set<string>()
    for (const e of state.events) if (e.kind === 'waiting' && e.note) s.add(e.note)
    for (const i of state.items) if (i.requester) s.add(i.requester)
    return [...s].slice(-8).reverse()
  }, [state])
  if (!item) return null
  const submit = () => {
    if (!who.trim()) return
    close()
    void setWaiting(itemId, who.trim())
  }
  return (
    <Modal label="Aguardando" onClose={close}>
      <span className="wk-dialog-icon" aria-hidden="true">
        <Icon name="pause" size={18} />
      </span>
      <h2 className="display">Aguardando quem?</h2>
      <p>O relógio começa agora. Se passar do limite, eu te lembro de cobrar.</p>
      <input className="field" value={who} placeholder="Ex.: acesso da infra, resposta do Marcos, deploy do time" onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      {sugg.length > 0 && (
        <div className="wk-chips-pick">
          {sugg.map((s) => (
            <button key={s} className="wk-chip-btn" onClick={() => setWho(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="wk-dialog-actions">
        <button className="btn quiet" onClick={close}>
          Cancelar
        </button>
        <button className="btn primary" onClick={submit} disabled={!who.trim()}>
          Marcar como aguardando
        </button>
      </div>
    </Modal>
  )
}

function StandupDialog({ state, scope }: { state: WorkState; scope: Scope }) {
  const [sc, setSc] = useState<Scope>(scope)
  const text = useMemo(() => standup(state, civil(), sc), [state, sc])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Daily copiado', { tone: 'ok' })
    } catch {
      toast('Não consegui copiar; selecione o texto e use ⌘C', { tone: 'error' })
    }
  }
  return (
    <Modal label="Daily" onClose={close} className="is-wide">
      <h2 className="display">Daily</h2>
      <p>Gerado a partir do que você registrou. Revise e copie.</p>
      <div className="wk-chips-pick">
        {[{ id: 'all', name: 'Todos' }, ...state.companies].map((c) => (
          <button key={c.id} className={`wk-chip-btn ${sc === c.id ? 'is-on' : ''}`} onClick={() => setSc(c.id)} aria-pressed={sc === c.id}>
            {c.name}
          </button>
        ))}
      </div>
      <textarea className="field wk-standup" readOnly value={text} rows={14} />
      <div className="wk-dialog-actions">
        <button className="btn quiet" onClick={close}>
          Fechar
        </button>
        <button className="btn primary" data-autofocus onClick={() => void copy()}>
          <Icon name="copy" size={14} />
          Copiar
        </button>
      </div>
    </Modal>
  )
}

function TodoDialog({ todoId, draft, state, scope }: { todoId?: string; draft?: Partial<NewTodo>; state: WorkState; scope: Scope }) {
  const cur = todoId ? todoById(todoId) : null
  const today = civil()
  const defCompany = cur?.companyId ?? draft?.companyId ?? (scope !== 'all' ? scope : 'pessoal')
  const [title, setTitle] = useState(cur?.title ?? draft?.title ?? '')
  const [companyId, setCompany] = useState(state.companies.some((c) => c.id === defCompany) ? defCompany : state.companies[0].id)
  const [mode, setMode] = useState<TodoMode>(cur?.mode ?? draft?.mode ?? (draft?.dueDate ? 'dated' : 'fixed'))
  const [weekdaysOnly, setWeekdays] = useState(cur?.weekdaysOnly ?? draft?.weekdaysOnly ?? false)
  const [dueDate, setDue] = useState(cur?.dueDate ?? draft?.dueDate ?? today)
  const [remindTime, setTime] = useState(cur?.remindTime ?? draft?.remindTime ?? '')
  const [forget, setForget] = useState(cur?.mustNotForget ?? draft?.mustNotForget ?? false)
  const [priority, setPriority] = useState<Priority>(cur?.priority ?? draft?.priority ?? 'normal')
  const [note, setNote] = useState(cur?.note ?? draft?.note ?? '')
  const save = async () => {
    if (!title.trim()) return
    const body = { title: title.trim(), companyId, mode, weekdaysOnly: mode === 'daily' && weekdaysOnly, dueDate: mode === 'dated' ? dueDate : null, remindTime: remindTime || null, mustNotForget: forget, priority, note }
    const ok = cur ? await updateTodo(cur.id, body) : await createTodo(body)
    if (ok) close()
  }
  return (
    <Modal label={cur ? 'Editar to-do' : 'Novo to-do'} onClose={close} className="is-todo">
      <h2 className="display">{cur ? 'To-do' : forget ? 'Não pode esquecer' : 'Novo to-do'}</h2>
      <input className="field wk-todo-title-in" value={title} placeholder="O quê?" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} data-autofocus />
      <div className="wk-form">
        <label>
          <span>Espaço</span>
          <span className="wk-space-pick">
            {state.companies.map((c) => (
              <button key={c.id} className={`wk-chip-btn ${companyId === c.id ? 'is-on' : ''}`} onClick={() => setCompany(c.id)} aria-pressed={companyId === c.id}>
                <CompanyMark company={c} size={13} />
                {c.name}
              </button>
            ))}
          </span>
        </label>
        <label>
          <span>Recorrência</span>
          <span className="wk-space-pick" role="radiogroup">
            {(['daily', 'fixed', 'dated'] as TodoMode[]).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} className={`wk-chip-btn ${mode === m ? 'is-on' : ''}`} onClick={() => setMode(m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </span>
        </label>
        {mode === 'daily' && (
          <label className="wk-inline-check">
            <input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdays(e.target.checked)} />
            Só em dias úteis
          </label>
        )}
        {mode === 'dated' && (
          <label>
            <span>Data</span>
            <span className="wk-row">
              <input className="field" type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
              <button className="wk-chip-btn" onClick={() => setDue(today)}>
                hoje
              </button>
              <button className="wk-chip-btn" onClick={() => setDue(addDays(today, 1))}>
                amanhã
              </button>
            </span>
          </label>
        )}
        <label>
          <span>Notificar às</span>
          <span className="wk-row">
            <input className="field" type="time" value={remindTime} onChange={(e) => setTime(e.target.value)} />
            {remindTime && (
              <button className="wk-chip-btn" onClick={() => setTime('')}>
                sem horário
              </button>
            )}
          </span>
        </label>
        <label>
          <span>Importância</span>
          <span className="wk-prio-pick" role="radiogroup">
            {PRIORITIES.map((p) => (
              <button key={p} role="radio" aria-checked={priority === p} className={`wk-pp is-${p} ${priority === p ? 'is-on' : ''}`} onClick={() => setPriority(p)}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </span>
        </label>
        <label className={`wk-forget-toggle ${forget ? 'is-on' : ''}`}>
          <input type="checkbox" checked={forget} onChange={(e) => setForget(e.target.checked)} />
          <Icon name="alarm" size={15} />
          <span>
            <b>Não pode esquecer</b>
            <em>fica no topo, em vermelho, até você resolver</em>
          </span>
        </label>
        <label className="is-wide">
          <span>Nota</span>
          <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="wk-dialog-actions">
        {cur && (
          <button
            className="btn quiet wk-danger"
            onClick={() => {
              close()
              void deleteTodo(cur.id)
            }}
          >
            Remover
          </button>
        )}
        {cur && cur.mode !== 'daily' && !cur.itemId && (
          <button
            className="btn quiet"
            onClick={() => {
              close()
              void convertTodo(cur.id)
            }}
          >
            <Icon name="board" size={13} />
            Virar item de trabalho
          </button>
        )}
        <span className="wk-grow" />
        <button className="btn quiet" onClick={close}>
          Cancelar
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={!title.trim() || (mode === 'dated' && !dueDate)}>
          Salvar
        </button>
      </div>
    </Modal>
  )
}

function DeleteDialog({ itemId, state }: { itemId: string; state: WorkState }) {
  const item = state.items.find((i) => i.id === itemId)
  if (!item) return null
  const secrets = state.secrets.filter((s) => s.itemId === itemId).length
  const images = state.attachments.filter((a) => a.itemId === itemId).length
  const extra = [images ? `${images} ${images === 1 ? 'imagem' : 'imagens'}` : '', secrets ? `${secrets} ${secrets === 1 ? 'segredo do Keychain' : 'segredos do Keychain'}` : ''].filter(Boolean)
  return (
    <Modal label="Excluir item" onClose={close}>
      <span className="wk-dialog-icon is-warn" aria-hidden="true">
        <Icon name="trash" size={18} />
      </span>
      <h2 className="display">Excluir de vez?</h2>
      <p>
        {label(item)} e todo o histórico{extra.length ? `, junto com ${extra.join(' e ')},` : ''} serão apagados. {isPost(item.stage) ? 'Se já foi entregue, prefira concluir para manter o registro.' : ''}
      </p>
      <div className="wk-dialog-actions">
        <button className="btn quiet" onClick={close} data-autofocus>
          Cancelar
        </button>
        <button
          className="btn wk-btn-warn"
          onClick={() => {
            close()
            void deleteItem(itemId)
          }}
        >
          Excluir
        </button>
      </div>
    </Modal>
  )
}
