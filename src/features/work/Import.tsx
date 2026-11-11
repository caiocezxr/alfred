import { useEffect, useMemo, useRef, useState, type ClipboardEvent as RClipboardEvent, type DragEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../shared/db/api'
import { CompanyMark } from './brand'
import { Modal } from './Dialogs'
import { Icon } from './icons'
import { parseDelimited, readXlsx, toDrafts, type Draft } from './importer'
import { createItem, openDialog, readUi, toast } from './store'
import { PRIORITY_LABEL, type Priority, type WorkState } from './types'
import type { Scope } from './logic'

type Phase = { kind: 'pick'; error?: string } | { kind: 'reading'; what: string } | { kind: 'review'; source: string; warn?: string }

const PRIOS: Priority[] = ['normal', 'alta', 'urgente']
const close = () => openDialog(null)

const asDataUrl = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('não deu para ler o arquivo'))
    r.readAsDataURL(f)
  })

export function ImportDialog({ state, scope, today, file }: { state: WorkState; scope: Scope; today: string; file?: File }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const companies = useMemo(() => [...state.companies].sort((a, b) => a.sort - b.sort), [state.companies])
  const last = readUi().lastCompany
  const fallback = scope !== 'all' ? scope : last && companies.some((c) => c.id === last) ? last : (companies[0]?.id ?? '')
  const ctx = { companies, fallback, today, items: state.items }

  const fromRows = (rows: string[][], source: string, warn?: string) => {
    const { drafts } = toDrafts(rows, ctx)
    if (!drafts.length) return setPhase({ kind: 'pick', error: 'Não achei nenhuma tarefa aí. Confira se o arquivo tem uma linha por chamado.' })
    setDrafts(drafts)
    setPhase({ kind: 'review', source, warn })
  }

  const readImage = async (blob: Blob, name: string) => {
    if (!isTauri) return setPhase({ kind: 'pick', error: 'Ler print precisa do app instalado (no navegador não roda IA).' })
    if (blob.size > 10_000_000) return setPhase({ kind: 'pick', error: 'Imagem grande demais (máx. 10 MB).' })
    setPhase({ kind: 'reading', what: name })
    try {
      const data = await asDataUrl(blob)
      const out = await invoke<{ engine: 'claude' | 'local'; model?: string; text: string; fallback?: string | null }>('work_read_table', { image: data, mime: blob.type || 'image/png', account: null, local: null, engine: null })
      const warn = out.engine === 'local' ? `Lido pelo modelo local (${out.model})${out.fallback ? ` porque ${out.fallback}` : ''}. Ele erra mais: confira linha por linha.` : undefined
      fromRows(parseDelimited(out.text), out.engine === 'claude' ? 'print lido pelo Claude' : 'print lido pelo modelo local', warn)
    } catch (e) {
      setPhase({ kind: 'pick', error: `Não consegui ler o print: ${String(e).replace(/^Error: /, '')}` })
    }
  }

  const take = async (f: File) => {
    const n = f.name.toLowerCase()
    try {
      if (f.type.startsWith('image/')) return void (await readImage(f, f.name))
      if (n.endsWith('.xlsx')) {
        setPhase({ kind: 'reading', what: f.name })
        return fromRows(await readXlsx(f), `planilha ${f.name}`)
      }
      if (n.endsWith('.xls')) return setPhase({ kind: 'pick', error: 'Arquivo .xls antigo: salve como .xlsx ou .csv, ou copie as células e cole aqui.' })
      if (/\.(csv|tsv|txt)$/.test(n) || f.type.startsWith('text/')) return fromRows(parseDelimited(await f.text()), `arquivo ${f.name}`)
      setPhase({ kind: 'pick', error: 'Formato não suportado. Use print (PNG/JPG), .xlsx, .csv ou cole as células.' })
    } catch (e) {
      setPhase({ kind: 'pick', error: String(e).replace(/^Error: /, '') })
    }
  }

  useEffect(() => {
    if (file) void take(file)
  }, [file])

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (phase.kind !== 'pick') return
      onPaste(e)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })

  const onPaste = (e: ClipboardEvent | RClipboardEvent) => {
    const cd = e.clipboardData
    if (!cd) return
    const img = [...cd.files].find((f) => f.type.startsWith('image/'))
    if (img) {
      e.preventDefault()
      return void readImage(img, 'print colado')
    }
    const text = cd.getData('text/plain')
    if (text.trim()) {
      e.preventDefault()
      fromRows(parseDelimited(text), 'células coladas')
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) void take(f)
  }

  const set = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  const chosen = drafts.filter((d) => d.on && d.title.trim())

  const create = async () => {
    if (!chosen.length || busy) return
    setBusy(true)
    let ok = 0
    for (const d of chosen) {
      const it = await createItem({ companyId: d.companyId, title: d.title.trim(), ticket: d.ticket?.trim() || null, priority: d.priority, dueDate: d.dueDate, kind: d.kind, notes: d.notes || undefined, stage: 'todo' })
      if (it) ok++
    }
    setBusy(false)
    close()
    toast(ok === chosen.length ? `${ok} ${ok === 1 ? 'chamado importado' : 'chamados importados'} em A fazer` : `${ok} de ${chosen.length} importados; os outros deram erro`, { tone: ok ? 'ok' : 'error' })
  }

  return (
    <Modal label="Importar chamados" onClose={close} className={`is-import is-${phase.kind}`}>
      <header className="wk-imp-head">
        <h2 className="display">Importar chamados</h2>
        {phase.kind === 'review' && (
          <p>
            {drafts.length} {drafts.length === 1 ? 'linha' : 'linhas'} · {phase.source}
          </p>
        )}
      </header>

      {phase.kind !== 'review' ? (
        <div
          className={`wk-imp-drop ${over ? 'is-over' : ''} ${phase.kind === 'reading' ? 'is-reading' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          onClick={() => phase.kind === 'pick' && input.current?.click()}
          role="button"
          tabIndex={0}
          data-autofocus
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && phase.kind === 'pick' && input.current?.click()}
        >
          <div className="wk-imp-sheet" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} style={{ ['--k' as string]: i }} />
            ))}
          </div>
          {phase.kind === 'reading' ? (
            <>
              <b>Lendo {phase.what}…</b>
              <span>A IA transcreve a tabela; você revisa antes de entrar no quadro.</span>
            </>
          ) : (
            <>
              <b>Solte aqui a planilha ou o print</b>
              <span>
                .xlsx, .csv ou imagem · ou cole com <kbd>⌘</kbd>
                <kbd>V</kbd> as células ou o print
              </span>
            </>
          )}
          <input
            ref={input}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp,.xlsx,.csv,.tsv,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void take(f)
            }}
          />
        </div>
      ) : (
        <>
          {phase.warn && <p className="wk-imp-warn">{phase.warn}</p>}
          <div className="wk-imp-list" role="list">
            {drafts.map((d) => (
              <div key={d.key} role="listitem" className={`wk-imp-row ${d.on ? '' : 'is-off'}`}>
                <button className={`wk-imp-check ${d.on ? 'is-on' : ''}`} onClick={() => set(d.key, { on: !d.on })} aria-pressed={d.on} aria-label={d.on ? 'Não importar esta linha' : 'Importar esta linha'}>
                  {d.on && <Icon name="check" size={10} />}
                </button>
                <input className="wk-imp-ticket" value={d.ticket ?? ''} placeholder="—" onChange={(e) => set(d.key, { ticket: e.target.value || null })} aria-label="Código" />
                <div className="wk-imp-main">
                  <input className="wk-imp-title" value={d.title} onChange={(e) => set(d.key, { title: e.target.value })} aria-label="Título" />
                  {(d.dupe || d.notes) && <small title={d.notes}>{d.dupe ? <em>{d.dupe}</em> : d.notes.split('\n')[0]}</small>}
                </div>
                <label className="wk-imp-co" title={d.companyRaw ? `Na planilha: ${d.companyRaw}` : 'Sem empresa na planilha'}>
                  <CompanyMark company={companies.find((c) => c.id === d.companyId)} size={13} />
                  <select value={d.companyId} onChange={(e) => set(d.key, { companyId: e.target.value })} aria-label="Empresa">
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className={`wk-imp-prio is-${d.priority}`} onClick={() => set(d.key, { priority: PRIOS[(PRIOS.indexOf(d.priority) + 1) % PRIOS.length] })} title="Prioridade (clique para trocar)">
                  {PRIORITY_LABEL[d.priority]}
                </button>
                <input className="wk-imp-due" type="date" value={d.dueDate ?? ''} onChange={(e) => set(d.key, { dueDate: e.target.value || null })} aria-label="Prazo" />
              </div>
            ))}
          </div>
          <div className="wk-dialog-actions">
            <button className="btn quiet" onClick={() => (setDrafts([]), setPhase({ kind: 'pick' }))}>
              Outro arquivo
            </button>
            <span className="wk-grow" />
            <button className="btn primary" disabled={!chosen.length || busy} onClick={() => void create()} data-autofocus>
              {busy ? 'Criando…' : `Criar ${chosen.length} ${chosen.length === 1 ? 'chamado' : 'chamados'}`}
            </button>
          </div>
        </>
      )}
      {phase.kind === 'pick' && phase.error && <p className="wk-imp-err">{phase.error}</p>}
    </Modal>
  )
}
