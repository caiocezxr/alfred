import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { openExternal } from '../../shared/openExternal'
import { secretsAvailable, workApi } from './api'
import { CompanyMark, coStyle } from './brand'
import { Icon, type IconName } from './icons'
import { checklistFor, dueLabel, dueState, isPost, pendingChecks, when } from './logic'
import {
  addNote, attach, deleteNote, detach, openDialog, openItem, requestMove, resume, secretAdd, secretDelete, setCheck, setFocus, setWaiting,
  followup, toast, updateItem, useWork,
} from './store'
import {
  KINDS, KIND_LABEL, NEXT_ACTION, PRIORITIES, PRIORITY_LABEL, STAGES, STAGE_LABEL, type Attachment, type SecretMeta, type Stage, type WorkEvent,
  type WorkItem, type WorkState,
} from './types'

export function Drawer({ state, today }: { state: WorkState; today: string }) {
  const { openId, celebrate } = useWork()
  const item = state.items.find((i) => i.id === openId) ?? null
  const panel = useRef<HTMLDivElement>(null)
  const [leaving, setLeaving] = useState(false)
  const close = () => {
    setLeaving(true)
    setTimeout(() => {
      setLeaving(false)
      openItem(null)
    }, 180)
  }

  useEffect(() => {
    if (!openId) return
    const prev = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.wk-scrim')) {
        e.preventDefault()
        close()
      }
    }
    const paste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      void attach(openId, files)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('paste', paste)
      prev?.focus?.()
    }
  }, [openId])

  if (!item) return null
  const company = state.companies.find((c) => c.id === item.companyId)
  const events = state.events.filter((e) => e.itemId === item.id)
  const next = NEXT_ACTION[item.stage]
  const post = isPost(item.stage)

  return createPortal(
    <div className={`wk-drawer-wrap ${leaving ? 'is-leaving' : ''}`}>
      <div className="wk-drawer-scrim" onPointerDown={close} />
      <aside
        ref={panel}
        tabIndex={-1}
        className={`wk-drawer ${celebrate?.itemId === item.id ? 'is-celebrating' : ''}`}
        style={coStyle(company)}
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((x) => x.kind === 'file')) e.preventDefault()
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return
          e.preventDefault()
          void attach(item.id, files)
        }}
      >
        <header className="wk-dr-head">
          <label className="wk-dr-space">
            <CompanyMark company={company} size={18} />
            <select value={item.companyId} onChange={(e) => void updateItem(item.id, { companyId: e.target.value })} aria-label="Espaço">
              {state.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <InlineField className="wk-dr-ticket" value={item.ticket ?? ''} placeholder="#chamado" label="Código do chamado" onSave={(v) => updateItem(item.id, { ticket: v || null })} />
          <span className="wk-grow" />
          {item.url && (
            <button className="btn quiet" onClick={() => void openExternal(item.url!)} title={item.url}>
              <Icon name="link" size={14} />
              Abrir chamado
            </button>
          )}
          <button className={`btn quiet ${item.focusedAt ? 'is-on' : ''}`} onClick={() => void setFocus(item.id, !item.focusedAt)} aria-pressed={!!item.focusedAt} disabled={item.stage === 'done'}>
            <Icon name="pin" size={14} />
            {item.focusedAt ? 'No foco' : 'Foco'}
          </button>
          <button className="btn quiet wk-dr-close" onClick={close} aria-label="Fechar">
            <Icon name="x" size={15} />
          </button>
        </header>

        <div className="wk-dr-scroll">
          <TitleField item={item} />
          <div className="wk-dr-status">
            <span className={`wk-stage-pill is-${item.stage}`}>{STAGE_LABEL[item.stage]}</span>
            {item.returns > 0 && <span className={`wk-chip ${item.returnOpen ? 'is-warn' : 'is-quiet'}`}>voltou {item.returns}×</span>}
            {item.waitingOn && <span className="wk-chip is-wait">aguardando {item.waitingOn} · {when(item.waitingSince!, today)}</span>}
            {item.dueDate && (
              <span className={`wk-chip is-due-${dueState(item, today) ?? 'later'}`}>
                <Icon name="cal" size={10} />
                prazo {dueLabel(item.dueDate, today)}
              </span>
            )}
            {item.requester && <span className="wk-chip is-quiet">pedido por {item.requester}</span>}
          </div>

          <Stepper item={item} events={events} today={today} />

          <div className="wk-dr-actions">
            {item.returnOpen && (
              <button className="btn primary wk-big" onClick={() => void resume(item.id)}>
                <Icon name="play" size={14} />
                Retomei o ajuste
              </button>
            )}
            {next && !item.returnOpen && (
              <button className="btn primary wk-big" onClick={() => requestMove(item.id, next.to)}>
                <Icon name="check" size={15} />
                {next.label}
              </button>
            )}
            {post && (
              <button className="btn wk-big is-warnish" onClick={() => openDialog({ kind: 'return', itemId: item.id })}>
                <Icon name="back" size={14} />
                Voltou
              </button>
            )}
            {item.stage !== 'done' &&
              (item.waitingOn ? (
                <button className="btn wk-big" onClick={() => void setWaiting(item.id, null)}>
                  <Icon name="play" size={14} />
                  Desbloqueou
                </button>
              ) : (
                <button className="btn wk-big" onClick={() => openDialog({ kind: 'wait', itemId: item.id })}>
                  <Icon name="pause" size={14} />
                  Aguardando…
                </button>
              ))}
            {(item.waitingOn || item.stage === 'delivered' || item.stage === 'tested') && (
              <button className="btn wk-big" onClick={() => void followup(item.id)}>
                <Icon name="user" size={14} />
                Cobrei hoje
              </button>
            )}
            <button className="btn quiet wk-big" onClick={() => openDialog({ kind: 'todo', draft: { title: item.ticket ? `${item.ticket} ${item.title}` : item.title, companyId: item.companyId, mustNotForget: true } })}>
              <Icon name="alarm" size={14} />
              Não posso esquecer
            </button>
          </div>

          <ChecklistBlock item={item} state={state} />
          <NotesBlock item={item} events={events} today={today} />
          <AttachmentsBlock item={item} attachments={state.attachments.filter((a) => a.itemId === item.id)} />
          <SecretsBlock owner={{ itemId: item.id }} secrets={state.secrets.filter((x) => x.itemId === item.id)} />
          <DetailsBlock item={item} state={state} />
          <Timeline events={events} today={today} />

          <footer className="wk-dr-foot">
            <span>Criado {when(item.createdAt, today)}</span>
            <button className="btn quiet wk-danger" onClick={() => openDialog({ kind: 'delete', itemId: item.id })}>
              <Icon name="trash" size={13} />
              Excluir item
            </button>
          </footer>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function Block({ title, icon, aside, children }: { title: string; icon: IconName; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="wk-dr-block">
      <header className="wk-dr-block-head">
        <Icon name={icon} size={14} />
        <h3>{title}</h3>
        {aside && <span className="wk-dr-aside">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

function InlineField({ value, onSave, placeholder, label, className = '', type = 'text', list }: {
  value: string
  onSave: (v: string) => unknown
  placeholder?: string
  label: string
  className?: string
  type?: string
  list?: string
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    if (v.trim() !== value) void onSave(v.trim())
  }
  return (
    <input
      className={`wk-inline ${className}`}
      value={v}
      type={type}
      list={list}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setV(value)
          e.stopPropagation()
        }
      }}
    />
  )
}

function TitleField({ item }: { item: WorkItem }) {
  const [v, setV] = useState(item.title)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setV(item.title), [item.title])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [v])
  return (
    <textarea
      ref={ref}
      className="wk-dr-title display"
      value={v}
      rows={1}
      aria-label="Título"
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onBlur={() => (v.trim() && v.trim() !== item.title ? void updateItem(item.id, { title: v.trim() }) : setV(item.title))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
    />
  )
}

function Stepper({ item, events, today }: { item: WorkItem; events: WorkEvent[]; today: string }) {
  const cur = STAGES.indexOf(item.stage)
  const enteredAt = (s: Stage) => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.kind === 'returned') break
      if ((e.kind === 'stage' || e.kind === 'created') && e.toStage === s) return e.at
    }
    return null
  }
  return (
    <ol className="wk-stepper" aria-label="Ciclo do item">
      {STAGES.map((s, i) => {
        const at = i <= cur ? enteredAt(s) : null
        const state = i < cur ? 'is-past' : i === cur ? 'is-now' : ''
        return (
          <li key={s} className={`wk-step ${state}`}>
            <button className="wk-step-btn" onClick={() => requestMove(item.id, s)} disabled={i === cur} aria-current={i === cur ? 'step' : undefined} title={`Mover para ${STAGE_LABEL[s]}`}>
              <span className="wk-step-dot" aria-hidden="true">
                {i < cur && (
                  <svg viewBox="0 0 16 16" width="10" height="10">
                    <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
                  </svg>
                )}
              </span>
              <span className="wk-step-label">{STAGE_LABEL[s]}</span>
              <span className="wk-step-at">{at ? when(at, today) : ''}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function ChecklistBlock({ item, state }: { item: WorkItem; state: WorkState }) {
  if (item.kind === 'pendencia') return null
  const list = checklistFor(item.companyId, state.checklist)
  if (!list.length) return null
  const pending = pendingChecks(item, state.checklist).length
  return (
    <Block
      title="Antes de entregar"
      icon="shield"
      aside={
        <span className={pending ? '' : 'is-ok'}>
          {list.length - pending}/{list.length}
          <button className="wk-link" onClick={() => openDialog({ kind: 'settings', tab: 'checklist' })}>
            editar
          </button>
        </span>
      }
    >
      <ul className="wk-checklist">
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
    </Block>
  )
}

function NotesBlock({ item, events, today }: { item: WorkItem; events: WorkEvent[]; today: string }) {
  const [draft, setDraft] = useState('')
  const notes = events.filter((e) => e.kind === 'note').reverse()
  const save = async () => {
    const t = draft.trim()
    if (!t) return
    setDraft('')
    await addNote(item.id, t)
  }
  return (
    <Block title="Anotações" icon="note" aside={notes.length ? String(notes.length) : undefined}>
      <div className="wk-note-new">
        <textarea
          className="field"
          rows={2}
          value={draft}
          placeholder="Anote o que aconteceu, o que falta, com quem falou… (Enter salva, Shift+Enter quebra linha)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void save()
            }
          }}
        />
      </div>
      {notes.length > 0 && (
        <ul className="wk-notes">
          {notes.map((n) => (
            <li key={n.id} className="wk-note">
              <p>{n.note}</p>
              <span className="wk-note-at">{when(n.at, today)}</span>
              <button className="wk-icon-btn" onClick={() => void deleteNote(n.id)} aria-label="Apagar anotação" title="Apagar">
                <Icon name="trash" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}

function Thumb({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    workApi
      .attachmentUrl(a.id)
      .then((u) => alive && setUrl(u))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [a.id])
  return (
    <div className="wk-thumb">
      <button className="wk-thumb-btn" onClick={onOpen} aria-label="Ampliar imagem">
        {url ? <img src={url} alt="" draggable={false} /> : <span className="wk-thumb-wait" />}
      </button>
      <button className="wk-thumb-del" onClick={() => void detach(a.id)} aria-label="Remover imagem" title="Remover">
        <Icon name="x" size={11} />
      </button>
    </div>
  )
}

function AttachmentsBlock({ item, attachments }: { item: WorkItem; attachments: Attachment[] }) {
  const [view, setView] = useState<number | null>(null)
  const file = useRef<HTMLInputElement>(null)
  return (
    <Block
      title="Capturas e imagens"
      icon="image"
      aside={
        <button className="wk-link" onClick={() => file.current?.click()}>
          adicionar
        </button>
      }
    >
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void attach(item.id, [...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      {attachments.length === 0 ? (
        <button className="wk-dropzone" onClick={() => file.current?.click()}>
          <Icon name="image" size={18} />
          <span>
            Cole com <kbd>⌘V</kbd> ou arraste uma captura para cá
          </span>
        </button>
      ) : (
        <div className="wk-thumbs">
          {attachments.map((a, i) => (
            <Thumb key={a.id} a={a} onOpen={() => setView(i)} />
          ))}
        </div>
      )}
      {view !== null && attachments[view] && <Lightbox list={attachments} index={view} onIndex={setView} onClose={() => setView(null)} />}
    </Block>
  )
}

function Lightbox({ list, index, onIndex, onClose }: { list: Attachment[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const a = list[index]
  useEffect(() => {
    let alive = true
    setUrl(null)
    workApi.attachmentUrl(a.id).then((u) => alive && setUrl(u)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [a.id])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
      if (e.key === 'ArrowRight') onIndex((index + 1) % list.length)
      if (e.key === 'ArrowLeft') onIndex((index - 1 + list.length) % list.length)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [index, list.length, onClose, onIndex])
  return createPortal(
    <div className="wk-scrim wk-lightbox" onPointerDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Imagem ampliada">
      {url && <img src={url} alt="" />}
      <div className="wk-lightbox-bar">
        <span>
          {index + 1} de {list.length} · {Math.max(1, Math.round(a.size / 1024))} KB
        </span>
        <button className="btn quiet" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>,
    document.body,
  )
}

export function SecretsBlock({ owner, secrets }: { owner: { itemId?: string; companyId?: string }; secrets: SecretMeta[] }) {
  const [adding, setAdding] = useState(false)
  const [labelV, setLabel] = useState('')
  const [value, setValue] = useState('')
  const save = async () => {
    if (!labelV.trim() || !value) return
    if (await secretAdd(owner, labelV.trim(), value)) {
      setLabel('')
      setValue('')
      setAdding(false)
    }
  }
  return (
    <Block
      title="Dados sensíveis"
      icon="key"
      aside={
        secretsAvailable && !adding ? (
          <button className="wk-link" onClick={() => setAdding(true)}>
            adicionar
          </button>
        ) : undefined
      }
    >
      {!secretsAvailable ? (
        <p className="wk-muted">Senhas, tokens e strings de conexão ficam no Keychain do Mac: disponível no app instalado.</p>
      ) : (
        <>
          {secrets.length === 0 && !adding && <p className="wk-muted">Guarde senhas e tokens no Keychain do Mac. O banco só guarda o rótulo.</p>}
          <ul className="wk-secrets">
            {secrets.map((s) => (
              <SecretRow key={s.id} s={s} />
            ))}
          </ul>
          {adding && (
            <div className="wk-secret-new">
              <input className="field" placeholder="Rótulo (ex.: senha do banco HML)" value={labelV} onChange={(e) => setLabel(e.target.value)} autoFocus aria-label="Rótulo" />
              <input
                className="field"
                type="password"
                autoComplete="off"
                placeholder="Valor"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void save()}
                aria-label="Valor do segredo"
              />
              <div className="wk-row-end">
                <button className="btn quiet" onClick={() => setAdding(false)}>
                  Cancelar
                </button>
                <button className="btn primary" onClick={() => void save()} disabled={!labelV.trim() || !value}>
                  Guardar no Keychain
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Block>
  )
}

function SecretRow({ s }: { s: SecretMeta }) {
  const [shown, setShown] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!shown) return
    const id = setTimeout(() => setShown(null), 10_000)
    return () => clearTimeout(id)
  }, [shown])
  useEffect(() => {
    if (!confirm) return
    const id = setTimeout(() => setConfirm(false), 2500)
    return () => clearTimeout(id)
  }, [confirm])
  const reveal = async () => {
    if (shown) return setShown(null)
    try {
      setShown(await workApi.secretReveal(s.id))
    } catch (e) {
      toast(String(e), { tone: 'error' })
    }
  }
  const copy = async () => {
    try {
      const v = await workApi.secretReveal(s.id)
      await navigator.clipboard.writeText(v)
      toast('Copiado · a área de transferência é limpa em 30 s', { tone: 'ok' })
      setTimeout(async () => {
        try {
          if ((await navigator.clipboard.readText()) === v) await navigator.clipboard.writeText('')
        } catch {
          return
        }
      }, 30_000)
    } catch (e) {
      toast(String(e), { tone: 'error' })
    }
  }
  return (
    <li className="wk-secret">
      <span className="wk-secret-label">{s.label}</span>
      <code className={`wk-secret-val ${shown ? 'is-shown' : ''}`}>{shown ?? '••••••••••'}</code>
      <button className="wk-icon-btn" onClick={() => void reveal()} aria-label={shown ? 'Esconder' : 'Revelar por 10 segundos'} title={shown ? 'Esconder' : 'Revelar por 10 s'}>
        <Icon name="eye" size={13} />
      </button>
      <button className="wk-icon-btn" onClick={() => void copy()} aria-label="Copiar" title="Copiar">
        <Icon name="copy" size={13} />
      </button>
      <button className={`wk-icon-btn ${confirm ? 'is-confirm' : ''}`} onClick={() => (confirm ? void secretDelete(s.id) : setConfirm(true))} aria-label={confirm ? 'Confirmar exclusão' : 'Excluir segredo'} title={confirm ? 'Clique de novo para apagar do Keychain' : 'Excluir'}>
        {confirm ? 'Apagar?' : <Icon name="trash" size={13} />}
      </button>
    </li>
  )
}

function DetailsBlock({ item, state }: { item: WorkItem; state: WorkState }) {
  const systems = useMemo(() => [...new Set(state.items.map((i) => i.system).filter((s): s is string => !!s))].sort(), [state.items])
  const people = useMemo(() => [...new Set(state.items.map((i) => i.requester).filter((s): s is string => !!s))].sort(), [state.items])
  const [notes, setNotes] = useState(item.notes)
  useEffect(() => setNotes(item.notes), [item.notes])
  return (
    <Block title="Detalhes" icon="text">
      <div className="wk-details">
        <label>
          <span>Tipo</span>
          <select className="field" value={item.kind} onChange={(e) => void updateItem(item.id, { kind: e.target.value as WorkItem['kind'] })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Prioridade</span>
          <span className="wk-prio-pick" role="radiogroup" aria-label="Prioridade">
            {PRIORITIES.map((p) => (
              <button key={p} role="radio" aria-checked={item.priority === p} className={`wk-pp is-${p} ${item.priority === p ? 'is-on' : ''}`} onClick={() => void updateItem(item.id, { priority: p })}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </span>
        </label>
        <label>
          <span>Prazo</span>
          <input className="field" type="date" value={item.dueDate ?? ''} onChange={(e) => void updateItem(item.id, { dueDate: e.target.value || null })} />
        </label>
        <label>
          <span>Sistema / projeto</span>
          <InlineField className="field" value={item.system ?? ''} placeholder="ex.: Conciliador" label="Sistema" list="wk-systems" onSave={(v) => updateItem(item.id, { system: v || null })} />
          <datalist id="wk-systems">
            {systems.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Quem pediu / valida</span>
          <InlineField className="field" value={item.requester ?? ''} placeholder="ex.: Marcos (financeiro)" label="Quem pediu" list="wk-people" onSave={(v) => updateItem(item.id, { requester: v || null })} />
          <datalist id="wk-people">
            {people.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Link do chamado / PR</span>
          <InlineField className="field" value={item.url ?? ''} placeholder="https://…" label="Link" type="url" onSave={(v) => updateItem(item.id, { url: v || null })} />
        </label>
        <label className="is-wide">
          <span>Descrição</span>
          <textarea className="field" rows={3} value={notes} placeholder="Contexto, critérios de aceite, o que foi combinado" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== item.notes && void updateItem(item.id, { notes })} />
        </label>
      </div>
    </Block>
  )
}

const EVENT_ICON: Record<WorkEvent['kind'], IconName> = {
  created: 'plus',
  stage: 'arrow',
  returned: 'back',
  resumed: 'play',
  waiting: 'pause',
  unblocked: 'play',
  followup: 'user',
  note: 'note',
  due: 'cal',
}

function describe(e: WorkEvent, today: string): string {
  switch (e.kind) {
    case 'created':
      return `Criado em ${STAGE_LABEL[e.toStage ?? 'todo']}`
    case 'stage': {
      const back = e.fromStage && e.toStage && STAGES.indexOf(e.toStage) < STAGES.indexOf(e.fromStage)
      const base = back ? `Voltou para ${STAGE_LABEL[e.toStage!]} (correção)` : `${STAGE_LABEL[e.toStage!]}`
      return e.pending ? `${base} · com ${e.pending} ${e.pending === 1 ? 'item' : 'itens'} do checklist pendente${e.pending === 1 ? '' : 's'}` : base
    }
    case 'returned':
      return `Voltou de ${STAGE_LABEL[e.fromStage ?? 'delivered']}: ${e.note}`
    case 'resumed':
      return 'Retomado após retorno'
    case 'waiting':
      return `Aguardando ${e.note}`
    case 'unblocked':
      return `Desbloqueado${e.note ? ` (${e.note})` : ''}`
    case 'followup':
      return `Cobrado${e.note ? `: ${e.note}` : ''}`
    case 'note':
      return e.note
    case 'due':
      return e.note ? `Prazo para ${dueLabel(e.note, today)}` : 'Prazo removido'
  }
}

function Timeline({ events, today }: { events: WorkEvent[]; today: string }) {
  const list = events.filter((e) => e.kind !== 'note').reverse()
  return (
    <Block title="Linha do tempo" icon="clock">
      <ol className="wk-timeline">
        {list.map((e) => (
          <li key={e.id} className={`wk-tl is-${e.kind} ${e.toStage ? `to-${e.toStage}` : ''}`}>
            <span className="wk-tl-icon" aria-hidden="true">
              <Icon name={EVENT_ICON[e.kind]} size={11} />
            </span>
            <span className="wk-tl-text">{describe(e, today)}</span>
            <time className="wk-tl-at" dateTime={e.at}>
              {when(e.at, today)}
            </time>
          </li>
        ))}
      </ol>
    </Block>
  )
}
