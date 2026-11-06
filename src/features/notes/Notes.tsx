import '@fontsource/eb-garamond/500.css'
import '@fontsource/eb-garamond/600.css'
import '@fontsource/eb-garamond/600-italic.css'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { onIntent } from '../../app/router'
import { isTauri } from '../../shared/db/api'
import { notesApi, type Note, type NoteMeta, type SearchHit } from './api'
import { clearAssetCache } from './assets'
import { NoteEditor, type BodyFont } from './Editor'
import { Icon, type IconName } from './icons'
import { docToMarkdown, type JSONNode } from './markdown'
import {
  archiveNote,
  createNote,
  dismissNotice,
  duplicateNote,
  emptyTrash,
  flushNow,
  flushPending,
  loadNotes,
  moveNote,
  notify,
  notifyError,
  openNote,
  peekNote,
  purgeNote,
  renameNote,
  restoreNote,
  retryFailedSaves,
  trashNote,
  useEditing,
  useNotesState,
  useNotice,
  useNow,
  useSaveState,
} from './store'
import { relativeTime, splitHits } from './text'
import {
  ancestors,
  archivedRoots,
  canAddChild,
  canMove,
  countDescendants,
  indexNotes,
  isHiddenByArchive,
  isLive,
  moveTargets,
  nextSibling,
  recentNotes,
  subtreeIds,
  trashRoots,
  visibleChildren,
  type SortMode,
  type TreeIndex,
} from './tree'
import './notes.css'

type Idx = TreeIndex<NoteMeta>
type View = 'pages' | 'archive' | 'trash'
type MenuItem = { label: string; icon: IconName; run: () => void; danger?: boolean; disabled?: boolean; checked?: boolean } | 'sep'
type MenuSpec = { anchor: DOMRect; items: MenuItem[]; label: string }
type ConfirmSpec = { title: string; text: string; action: string; run: () => void }

const LS = { last: 'ps.notes.last', expanded: 'ps.notes.expanded', sort: 'ps.notes.sort', font: 'ps.notes.font' }
const titleOf = (n: { title: string } | undefined) => n?.title.trim() || 'Sem título'
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

function readSet(key: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export default function Notes() {
  const { notes, loaded, error } = useNotesState()
  const idx = useMemo(() => indexNotes(notes), [notes])
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(LS.last))
  const [view, setView] = useState<View>('pages')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => readSet(LS.expanded))
  const [sortMode, setSortMode] = useState<SortMode>(() => (localStorage.getItem(LS.sort) === 'recent' ? 'recent' : 'manual'))
  const [font, setFont] = useState<BodyFont>(() => (localStorage.getItem(LS.font) === 'sans' ? 'sans' : 'serif'))
  const [focusTitleFor, setFocusTitleFor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null)
  const [menu, setMenu] = useState<MenuSpec | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selected) localStorage.setItem(LS.last, selected)
  }, [selected])
  useEffect(() => localStorage.setItem(LS.expanded, JSON.stringify([...expanded])), [expanded])
  useEffect(() => localStorage.setItem(LS.sort, sortMode), [sortMode])
  useEffect(() => localStorage.setItem(LS.font, font), [font])

  const firstPick = useRef(true)
  useEffect(() => {
    if (!loaded) return
    const entering = firstPick.current
    firstPick.current = false
    if (selected && idx.byId.has(selected) && (!entering || isLive(selected, idx))) return
    setSelected(recentNotes(idx)[0]?.id ?? null)
  }, [loaded, idx, selected])

  useEffect(() => {
    if (!selected) return
    const anc = ancestors(selected, idx).map((a) => a.id)
    setExpanded((prev) => (anc.every((a) => prev.has(a)) ? prev : new Set([...prev, ...anc])))
  }, [selected, idx])

  useEffect(
    () => () => {
      flushNow()
      clearAssetCache()
    },
    [],
  )

  const open = useCallback((id: string) => {
    setSelected(id)
    setMenu(null)
  }, [])

  const newNote = useCallback(async (parentId: string | null = null) => {
    const n = await createNote(parentId)
    if (!n) return
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId))
    setView('pages')
    setQuery('')
    setSelected(n.id)
    setFocusTitleFor(n.id)
  }, [])

  useEffect(() => onIntent((i) => i === 'new-note' && void newNote(null)), [newNote])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'f') {
        e.preventDefault()
        setView('pages')
        requestAnimationFrame(() => {
          searchRef.current?.focus()
          searchRef.current?.select()
        })
      } else if (k === 's') {
        e.preventDefault()
        flushNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const trash = async (id: string) => {
    const sub = new Set(subtreeIds(id, idx))
    const parent = idx.byId.get(id)?.parentId ?? null
    const name = titleOf(idx.byId.get(id))
    const ok = await trashNote(id)
    if (!ok) return
    if (selected && sub.has(selected)) {
      const next = parent && !sub.has(parent) && isLive(parent, idx) ? parent : recentNotes(idx).find((n) => !sub.has(n.id))?.id
      setSelected(next ?? null)
    }
    notify(`“${name}” foi para a lixeira.`, {
      action: {
        label: 'Desfazer',
        run: () =>
          void restoreNote(id).then((back) => {
            if (back) setSelected(id)
          }),
      },
    })
  }

  const archive = async (id: string, archived: boolean) => {
    const name = titleOf(idx.byId.get(id))
    if (!(await archiveNote(id, archived))) return
    notify(archived ? `“${name}” foi arquivada.` : `“${name}” voltou para as páginas.`, {
      action: archived ? { label: 'Desfazer', run: () => void archiveNote(id, false) } : undefined,
    })
  }

  const duplicate = async (id: string) => {
    const n = await duplicateNote(id)
    if (n) {
      setView('pages')
      setSelected(n.id)
    }
  }

  const exportMd = async (id: string) => {
    try {
      await flushPending()
      const n = peekNote(id) ?? (await openNote(id))
      const title = titleOf(idx.byId.get(id) ?? n)
      const md = docToMarkdown(JSON.parse(n.doc) as JSONNode, { title })
      const out = await notesApi.exportMarkdown(title, md)
      notify(isTauri ? `Exportada para ${out.replace(/^\/Users\/[^/]+/, '~')}` : `Baixando ${out}`)
    } catch (e) {
      notifyError(e)
    }
  }

  const purge = (id: string) => {
    const n = countDescendants(id, idx)
    const name = titleOf(idx.byId.get(id))
    setConfirm({
      title: 'Excluir para sempre?',
      text: `“${name}”${n ? ` e ${plural(n, 'subpágina', 'subpáginas')}` : ''} ${n ? 'serão apagadas' : 'será apagada'} definitivamente, com as imagens. Isso não pode ser desfeito.`,
      action: 'Excluir definitivamente',
      run: async () => {
        const sub = new Set(subtreeIds(id, idx))
        if (await purgeNote(id)) {
          if (selected && sub.has(selected)) setSelected(null)
          notify(`“${name}” foi excluída.`)
        }
      },
    })
  }

  const askEmptyTrash = () => {
    const roots = trashRoots(idx)
    const total = roots.reduce((s, r) => s + 1 + countDescendants(r.id, idx), 0)
    setConfirm({
      title: 'Esvaziar a lixeira?',
      text: `${plural(total, 'página será apagada', 'páginas serão apagadas')} definitivamente, com as imagens. Isso não pode ser desfeito.`,
      action: 'Esvaziar lixeira',
      run: async () => {
        await emptyTrash()
        notify('A lixeira foi esvaziada.')
      },
    })
  }

  const restore = async (id: string) => {
    if (!(await restoreNote(id))) return
    notify(`“${titleOf(idx.byId.get(id))}” foi restaurada.`, {
      action: {
        label: 'Abrir',
        run: () => {
          setView('pages')
          setSelected(id)
        },
      },
    })
  }

  const noteMenu = (id: string, where: 'tree' | 'pane'): MenuItem[] => {
    const n = idx.byId.get(id)
    if (!n) return []
    if (!isLive(id, idx)) {
      return n.trashedAt
        ? [
            { label: 'Restaurar', icon: 'restore', run: () => void restore(id) },
            { label: 'Excluir definitivamente', icon: 'trash', danger: true, run: () => purge(id) },
          ]
        : []
    }
    const items: MenuItem[] = [
      { label: 'Nova subpágina', icon: 'subpage', run: () => void newNote(id), disabled: !canAddChild(id, idx) },
      where === 'tree'
        ? { label: 'Renomear', icon: 'edit', run: () => setRenaming(id) }
        : { label: 'Renomear', icon: 'edit', run: () => setFocusTitleFor(id) },
      { label: 'Duplicar', icon: 'copy', run: () => void duplicate(id) },
      { label: 'Mover para…', icon: 'move', run: () => setMoveFor(id) },
      { label: 'Exportar Markdown', icon: 'export', run: () => void exportMd(id) },
    ]
    if (where === 'pane') {
      items.push('sep', { label: 'Texto serifado', icon: 'type', checked: font === 'serif', run: () => setFont('serif') })
      items.push({ label: 'Texto sem serifa', icon: 'type', checked: font === 'sans', run: () => setFont('sans') })
    }
    items.push(
      'sep',
      n.archivedAt
        ? { label: 'Desarquivar', icon: 'archive', run: () => void archive(id, false) }
        : { label: 'Arquivar', icon: 'archive', run: () => void archive(id, true) },
      { label: 'Mover para a lixeira', icon: 'trash', danger: true, run: () => void trash(id) },
    )
    return items
  }

  const openMenu = (id: string, anchor: DOMRect, where: 'tree' | 'pane') =>
    setMenu({ anchor, items: noteMenu(id, where), label: `Ações de ${titleOf(idx.byId.get(id))}` })

  const trashCount = trashRoots(idx).length
  const archiveCount = archivedRoots(idx).length
  const pageCount = notes.filter((n) => isLive(n.id, idx) && !isHiddenByArchive(n.id, idx)).length

  return (
    <section className="page notes">
      <aside className="notes-side">
        <header className="notes-head reveal" style={{ ['--i' as string]: 0 }}>
          <div>
            <div className="kicker">{loaded ? plural(pageCount, 'página', 'páginas') : 'Carregando'}</div>
            <h1 className="display">Notas</h1>
          </div>
          <button className="notes-new" onClick={() => void newNote(null)} aria-label="Nova página" title="Nova página (⌘N)">
            <Icon name="plus" />
          </button>
        </header>

        <div className="panel notes-nav reveal" style={{ ['--i' as string]: 1 }}>
          {view === 'pages' ? (
            <>
              <SearchBox ref={searchRef} value={query} onChange={setQuery} />
              {query.trim() ? (
                <SearchResults query={query} idx={idx} notes={notes} selected={selected} onOpen={open} onClear={() => setQuery('')} />
              ) : (
                <TreeView
                  idx={idx}
                  loaded={loaded}
                  error={error}
                  selected={selected}
                  expanded={expanded}
                  sortMode={sortMode}
                  renaming={renaming}
                  onSort={() => setSortMode((m) => (m === 'manual' ? 'recent' : 'manual'))}
                  onOpen={open}
                  onToggle={toggle}
                  onExpand={(id) => setExpanded((p) => new Set(p).add(id))}
                  onNew={(parent) => void newNote(parent)}
                  onMenu={(id, r) => openMenu(id, r, 'tree')}
                  onRenamed={() => setRenaming(null)}
                />
              )}
            </>
          ) : view === 'trash' ? (
            <BinView
              kind="trash"
              items={trashRoots(idx)}
              idx={idx}
              selected={selected}
              onBack={() => setView('pages')}
              onOpen={open}
              onRestore={(id) => void restore(id)}
              onPurge={purge}
              onEmpty={askEmptyTrash}
            />
          ) : (
            <BinView
              kind="archive"
              items={archivedRoots(idx)}
              idx={idx}
              selected={selected}
              onBack={() => setView('pages')}
              onOpen={open}
              onRestore={(id) => void archive(id, false)}
            />
          )}

          <footer className="notes-foot">
            <button className={`notes-foot-btn ${view === 'archive' ? 'is-on' : ''}`} onClick={() => setView((v) => (v === 'archive' ? 'pages' : 'archive'))} aria-pressed={view === 'archive'}>
              <Icon name="archive" />
              <span>Arquivadas</span>
              {archiveCount > 0 && <span className="notes-count">{archiveCount}</span>}
            </button>
            <button className={`notes-foot-btn ${view === 'trash' ? 'is-on' : ''}`} onClick={() => setView((v) => (v === 'trash' ? 'pages' : 'trash'))} aria-pressed={view === 'trash'}>
              <Icon name="trash" />
              <span>Lixeira</span>
              {trashCount > 0 && <span className="notes-count">{trashCount}</span>}
            </button>
          </footer>
        </div>
      </aside>

      <NotePane
        id={selected}
        idx={idx}
        loaded={loaded}
        font={font}
        focusTitleFor={focusTitleFor}
        onFocusConsumed={() => setFocusTitleFor(null)}
        onOpen={open}
        onNew={(parent) => void newNote(parent)}
        onMenu={(id, r) => openMenu(id, r, 'pane')}
        onRestore={(id) => void restore(id)}
        onPurge={purge}
        onUnarchive={(id) => void archive(id, false)}
      />

      {menu && <PopMenu spec={menu} onClose={() => setMenu(null)} />}
      {moveFor && idx.byId.has(moveFor) && (
        <MoveDialog
          id={moveFor}
          idx={idx}
          onClose={() => setMoveFor(null)}
          onMove={async (target) => {
            const id = moveFor
            setMoveFor(null)
            if (await moveNote(id, target, null)) {
              if (target) setExpanded((p) => new Set(p).add(target))
              notify(`Movida para ${target ? `“${titleOf(idx.byId.get(target))}”` : 'o topo'}.`)
            }
          }}
        />
      )}
      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
    </section>
  )
}

const SearchBox = ({ ref, value, onChange }: { ref: React.Ref<HTMLInputElement>; value: string; onChange: (v: string) => void }) => (
  <label className="notes-search">
    <Icon name="search" />
    <input
      ref={ref}
      type="search"
      value={value}
      placeholder="Buscar nas notas"
      aria-label="Buscar nas notas"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (value) onChange('')
          else e.currentTarget.blur()
        }
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          const first = e.currentTarget.closest('.notes-nav')?.querySelector<HTMLButtonElement>('.notes-hit')
          if (first) {
            e.preventDefault()
            if (e.key === 'Enter') first.click()
            else first.focus()
          }
        }
      }}
    />
    {value ? (
      <button className="notes-search-clear" onClick={() => onChange('')} aria-label="Limpar busca">
        <Icon name="close" size={12} />
      </button>
    ) : (
      <kbd>⌘F</kbd>
    )}
  </label>
)

function Marked({ text }: { text: string }) {
  return (
    <>
      {splitHits(text).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  )
}

function SearchResults({ query, idx, notes, selected, onOpen, onClear }: {
  query: string
  idx: Idx
  notes: NoteMeta[]
  selected: string | null
  onOpen: (id: string) => void
  onClear: () => void
}) {
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const now = useNow()
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      notesApi.search(query.trim()).then(
        (h) => alive && setHits(h),
        () => alive && setHits([]),
      )
    }, 110)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, notes])

  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.notes-hit')]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    e.preventDefault()
    if (e.key === 'ArrowUp' && i <= 0) e.currentTarget.closest('.notes-nav')?.querySelector<HTMLInputElement>('.notes-search input')?.focus()
    else items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  if (hits === null) return <div className="notes-scrollarea"><SkeletonRows /></div>
  if (!hits.length)
    return (
      <div className="notes-scrollarea">
        <div className="notes-side-empty">
          <p>Nada encontrado para “{query.trim()}”.</p>
          <button className="link" onClick={onClear}>Limpar busca</button>
        </div>
      </div>
    )
  return (
    <div className="notes-scrollarea" onKeyDown={move}>
      <div className="notes-section-title">
        {plural(hits.length, 'resultado', 'resultados')}
      </div>
      {hits.map((h, i) => {
        const path = ancestors(h.id, idx).map((a) => titleOf(a)).join(' / ')
        return (
          <button key={h.id} className={`notes-hit ${selected === h.id ? 'is-active' : ''}`} style={{ ['--i' as string]: i }} onClick={() => onOpen(h.id)}>
            <span className="notes-hit-title">{h.title.trim() ? <Marked text={h.title} /> : 'Sem título'}</span>
            {h.snippet && (
              <span className="notes-hit-snippet">
                <Marked text={h.snippet} />
              </span>
            )}
            <span className="notes-hit-meta">
              {path && <span className="notes-hit-path">{path}</span>}
              <span>{h.archivedAt ? 'arquivada · ' : ''}{relativeTime(h.updatedAt, now)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="notes-skeleton" aria-hidden="true">
      {[72, 54, 64, 40].map((w, i) => (
        <span key={i} style={{ width: `${w}%`, ['--i' as string]: i }} />
      ))}
    </div>
  )
}

type DropHint = { id: string; zone: 'before' | 'inside' | 'after' } | null

function TreeView(p: {
  idx: Idx
  loaded: boolean
  error: string | null
  selected: string | null
  expanded: Set<string>
  sortMode: SortMode
  renaming: string | null
  onSort: () => void
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onExpand: (id: string) => void
  onNew: (parent: string | null) => void
  onMenu: (id: string, r: DOMRect) => void
  onRenamed: () => void
}) {
  const { idx, expanded, sortMode } = p
  const [drag, setDrag] = useState<string | null>(null)
  const [hint, setHint] = useState<DropHint>(null)
  const roots = visibleChildren(null, idx, sortMode)

  const zoneFor = (target: NoteMeta, e: React.DragEvent<HTMLElement>): DropHint => {
    if (!drag || drag === target.id) return null
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    let zone: 'before' | 'inside' | 'after' = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
    if (sortMode === 'recent') zone = 'inside'
    const parent = target.parentId && idx.byId.has(target.parentId) ? target.parentId : null
    const ok = zone === 'inside' ? canMove(drag, target.id, idx) : canMove(drag, parent, idx)
    return ok ? { id: target.id, zone } : null
  }

  const drop = (target: NoteMeta, h: NonNullable<DropHint>) => {
    if (!drag) return
    const parent = target.parentId && idx.byId.has(target.parentId) ? target.parentId : null
    if (h.zone === 'inside') {
      void moveNote(drag, target.id, null)
      p.onExpand(target.id)
    } else if (h.zone === 'before') void moveNote(drag, parent, target.id)
    else void moveNote(drag, parent, nextSibling(target.id, idx)?.id ?? null)
  }

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-row]')]
    const cur = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-row]')
    if (!cur) return
    const i = rows.indexOf(cur)
    const id = cur.dataset.row!
    const n = idx.byId.get(id)
    const kids = visibleChildren(id, idx).length
    if (e.key === 'ArrowDown') rows[i + 1]?.focus()
    else if (e.key === 'ArrowUp') rows[i - 1]?.focus()
    else if (e.key === 'ArrowRight') {
      if (kids && !expanded.has(id)) p.onToggle(id)
      else if (kids) rows[i + 1]?.focus()
    } else if (e.key === 'ArrowLeft') {
      if (kids && expanded.has(id)) p.onToggle(id)
      else if (n?.parentId) rows.find((r) => r.dataset.row === n.parentId)?.focus()
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) p.onMenu(id, cur.getBoundingClientRect())
    else return
    e.preventDefault()
  }

  const renderLevel = (parentId: string | null, depth: number): ReactNode =>
    visibleChildren(parentId, idx, sortMode).map((n) => {
      const kids = visibleChildren(n.id, idx).length
      const isOpen = kids > 0 && expanded.has(n.id)
      return (
        <div key={n.id} role="none">
          <TreeRow
            note={n}
            depth={depth}
            hasKids={kids > 0}
            open={isOpen}
            active={p.selected === n.id}
            canAdd={canAddChild(n.id, idx)}
            renaming={p.renaming === n.id}
            dragging={drag === n.id}
            drop={hint?.id === n.id ? hint.zone : null}
            onOpen={p.onOpen}
            onToggle={p.onToggle}
            onNew={p.onNew}
            onMenu={p.onMenu}
            onRenamed={p.onRenamed}
            onDragStart={(id) => setDrag(id)}
            onDragEnd={() => {
              setDrag(null)
              setHint(null)
            }}
            onDragOver={(e) => {
              const h = zoneFor(n, e)
              if (!h) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (h.id !== hint?.id || h.zone !== hint?.zone) setHint(h)
            }}
            onDrop={(e) => {
              const h = zoneFor(n, e)
              e.preventDefault()
              if (h) drop(n, h)
              setDrag(null)
              setHint(null)
            }}
          />
          {isOpen && (
            <div className="notes-children" role="group">
              {renderLevel(n.id, depth + 1)}
            </div>
          )}
        </div>
      )
    })

  return (
    <div
      className={`notes-scrollarea ${drag ? 'is-dragging' : ''}`}
      onDragOver={(e) => {
        if (e.target !== e.currentTarget || !drag || !canMove(drag, null, idx)) return
        e.preventDefault()
        setHint(null)
      }}
      onDrop={(e) => {
        if (e.target !== e.currentTarget || !drag) return
        e.preventDefault()
        void moveNote(drag, null, null)
        setDrag(null)
      }}
    >
      <div className="notes-section-title">
        <span>Páginas</span>
        <button
          className={`notes-mini ${sortMode === 'recent' ? 'is-on' : ''}`}
          onClick={p.onSort}
          aria-pressed={sortMode === 'recent'}
          title={sortMode === 'recent' ? 'Ordenadas por edição recente · clique para a ordem manual' : 'Ordem manual · clique para ordenar por edição recente'}
        >
          <Icon name="sort" size={14} />
          <span>{sortMode === 'recent' ? 'Recentes' : 'Manual'}</span>
        </button>
      </div>

      {!p.loaded ? (
        <SkeletonRows />
      ) : p.error ? (
        <div className="notes-side-empty">
          <p>{p.error}</p>
          <button className="link" onClick={() => void loadNotes()}>Tentar de novo</button>
        </div>
      ) : roots.length === 0 ? (
        <div className="notes-side-empty">
          <p>Nenhuma página ainda.</p>
        </div>
      ) : (
        <div role="tree" aria-label="Páginas" onKeyDown={onKey}>
          {renderLevel(null, 0)}
        </div>
      )}

      {p.loaded && !p.error && (
        <button className="notes-add-row" onClick={() => p.onNew(null)}>
          <Icon name="plus" size={14} />
          <span>Nova página</span>
        </button>
      )}
    </div>
  )
}

type RowProps = {
  note: NoteMeta
  depth: number
  hasKids: boolean
  open: boolean
  active: boolean
  canAdd: boolean
  renaming: boolean
  dragging: boolean
  drop: 'before' | 'inside' | 'after' | null
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onNew: (parent: string) => void
  onMenu: (id: string, r: DOMRect) => void
  onRenamed: () => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent<HTMLElement>) => void
  onDrop: (e: React.DragEvent<HTMLElement>) => void
}

const TreeRow = memo(function TreeRow(p: RowProps) {
  const { note: n } = p
  const [draft, setDraft] = useState(n.title)
  useEffect(() => {
    if (p.renaming) setDraft(n.title)
  }, [p.renaming, n.title])

  const commit = () => {
    if (draft !== n.title) renameNote(n.id, draft)
    p.onRenamed()
  }

  return (
    <div
      className={`notes-row ${p.active ? 'is-active' : ''} ${p.dragging ? 'is-dragging' : ''} ${p.drop ? `drop-${p.drop}` : ''}`}
      style={{ ['--depth' as string]: p.depth }}
      draggable={!p.renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', titleOf(n))
        p.onDragStart(n.id)
      }}
      onDragEnd={p.onDragEnd}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(n.id, new DOMRect(e.clientX, e.clientY, 0, 0))
      }}
    >
      {p.hasKids ? (
        <button
          className={`notes-chev ${p.open ? 'is-open' : ''}`}
          tabIndex={-1}
          onClick={() => p.onToggle(n.id)}
          aria-label={p.open ? 'Recolher' : 'Expandir'}
        >
          <Icon name="chevron" size={12} />
        </button>
      ) : (
        <span className="notes-chev is-leaf" aria-hidden="true">
          <Icon name="page" size={14} />
        </span>
      )}

      {p.renaming ? (
        <input
          className="notes-rename"
          autoFocus
          value={draft}
          aria-label="Novo nome"
          placeholder="Sem título"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(n.title)
              p.onRenamed()
            }
          }}
        />
      ) : (
        <button
          className="notes-row-main"
          data-row={n.id}
          role="treeitem"
          aria-level={p.depth + 1}
          aria-selected={p.active}
          aria-expanded={p.hasKids ? p.open : undefined}
          tabIndex={p.active ? 0 : -1}
          onClick={() => p.onOpen(n.id)}
          onDoubleClick={() => p.onToggle(n.id)}
          title={titleOf(n)}
        >
          <span className={`notes-row-title ${n.title.trim() ? '' : 'is-untitled'}`}>{titleOf(n)}</span>
        </button>
      )}

      {!p.renaming && (
        <span className="notes-row-acts">
          {p.canAdd && (
            <button className="notes-icon-btn" tabIndex={-1} onClick={() => p.onNew(n.id)} aria-label="Nova subpágina" title="Nova subpágina">
              <Icon name="plus" size={14} />
            </button>
          )}
          <button
            className="notes-icon-btn"
            tabIndex={-1}
            onClick={(e) => p.onMenu(n.id, e.currentTarget.getBoundingClientRect())}
            aria-label="Mais ações"
            title="Mais ações"
          >
            <Icon name="more" size={14} />
          </button>
        </span>
      )}
    </div>
  )
})

function BinView(p: {
  kind: 'trash' | 'archive'
  items: NoteMeta[]
  idx: Idx
  selected: string | null
  onBack: () => void
  onOpen: (id: string) => void
  onRestore: (id: string) => void
  onPurge?: (id: string) => void
  onEmpty?: () => void
}) {
  const now = useNow()
  const trash = p.kind === 'trash'
  return (
    <div className="notes-scrollarea">
      <div className="notes-bin-head">
        <button className="notes-mini" onClick={p.onBack}>
          <Icon name="back" size={14} />
          <span>Páginas</span>
        </button>
        {trash && p.items.length > 0 && (
          <button className="notes-mini is-danger" onClick={p.onEmpty}>
            Esvaziar
          </button>
        )}
      </div>
      <h2 className="notes-bin-title display">{trash ? 'Lixeira' : 'Arquivadas'}</h2>
      <p className="notes-bin-sub">
        {trash ? 'Restaure o que quiser de volta. Subpáginas voltam junto.' : 'Fora da árvore, mas inteiras e pesquisáveis.'}
      </p>
      {p.items.length === 0 ? (
        <div className="notes-side-empty">
          <p>{trash ? 'A lixeira está vazia.' : 'Nada arquivado.'}</p>
        </div>
      ) : (
        p.items.map((n, i) => {
          const kids = countDescendants(n.id, p.idx)
          const when = trash ? n.trashedAt : n.archivedAt
          return (
            <div key={n.id} className={`notes-bin-row ${p.selected === n.id ? 'is-active' : ''}`} style={{ ['--i' as string]: i }}>
              <button className="notes-bin-main" onClick={() => p.onOpen(n.id)}>
                <span className="notes-row-title">{titleOf(n)}</span>
                <span className="notes-bin-meta">
                  {trash ? 'Excluída' : 'Arquivada'} {when ? relativeTime(when, now) : ''}
                  {kids > 0 && ` · ${plural(kids, 'subpágina', 'subpáginas')}`}
                </span>
              </button>
              <button className="notes-icon-btn" onClick={() => p.onRestore(n.id)} aria-label={trash ? 'Restaurar' : 'Desarquivar'} title={trash ? 'Restaurar' : 'Desarquivar'}>
                <Icon name="restore" size={14} />
              </button>
              {trash && p.onPurge && (
                <button className="notes-icon-btn is-danger" onClick={() => p.onPurge!(n.id)} aria-label="Excluir definitivamente" title="Excluir definitivamente">
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function NotePane(p: {
  id: string | null
  idx: Idx
  loaded: boolean
  font: BodyFont
  focusTitleFor: string | null
  onFocusConsumed: () => void
  onOpen: (id: string) => void
  onNew: (parent: string | null) => void
  onMenu: (id: string, r: DOMRect) => void
  onRestore: (id: string) => void
  onPurge: (id: string) => void
  onUnarchive: (id: string) => void
}) {
  const { id, idx } = p
  const [note, setNote] = useState<Note | null>(() => (id ? (peekNote(id) ?? null) : null))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const now = useNow()

  useEffect(() => {
    setLoadError(null)
    if (!id) return setNote(null)
    const hit = peekNote(id)
    if (hit) return setNote(hit)
    let alive = true
    openNote(id).then(
      (n) => alive && setNote(n),
      (e) => alive && setLoadError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      alive = false
    }
  }, [id])

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
    setScrolled(false)
  }, [note?.id])

  const meta = note ? idx.byId.get(note.id) : undefined
  const showing = note && meta ? note : null

  if (!p.loaded) return <div className="notes-sheet is-loading reveal" style={{ ['--i' as string]: 2 }} />

  if (!id || !showing || !meta) {
    const hasAny = idx.byId.size > 0
    return (
      <div className="notes-sheet notes-welcome reveal" style={{ ['--i' as string]: 2 }}>
        {loadError ? (
          <div className="notes-welcome-inner">
            <h2 className="display">Não consegui abrir esta nota.</h2>
            <p>{loadError}</p>
          </div>
        ) : id && hasAny ? null : (
          <div className="notes-welcome-inner">
            <span className="notes-welcome-mark" aria-hidden="true" />
            <h2 className="display">Um lugar para pensar.</h2>
            <p>Páginas e subpáginas, títulos, listas, checklists, código e imagens. Tudo salvo enquanto você escreve.</p>
            <button className="btn primary" onClick={() => p.onNew(null)}>
              <Icon name="plus" size={14} /> Nova página
            </button>
            <ul className="notes-tips">
              <li><kbd>/</kbd> insere blocos</li>
              <li><kbd>#</kbd> <kbd>-</kbd> <kbd>[ ]</kbd> <kbd>&gt;</kbd> <kbd>```</kbd> viram blocos</li>
              <li><kbd>⌘N</kbd> nova página · <kbd>⌘F</kbd> buscar</li>
            </ul>
          </div>
        )}
        <Toast />
      </div>
    )
  }

  const live = isLive(showing.id, idx)
  const crumbs = ancestors(showing.id, idx)
  const trashedAncestor = !meta.trashedAt ? crumbs.find((a) => a.trashedAt) : undefined
  const archivedHere = live && isHiddenByArchive(showing.id, idx)
  const kids = live ? visibleChildren(showing.id, idx) : []
  const banner = !live ? (
          <div className="notes-banner is-warn">
            <Icon name="trash" />
            <span>
              {trashedAncestor
                ? `Está dentro de “${titleOf(trashedAncestor)}”, que foi para a lixeira.`
                : `Foi para a lixeira ${relativeTime(meta.trashedAt ?? '', now)}.`}{' '}
              Só leitura.
            </span>
            <button className="btn quiet" onClick={() => p.onRestore(trashedAncestor?.id ?? showing.id)}>
              <Icon name="restore" size={14} /> Restaurar
            </button>
            {!trashedAncestor && (
              <button className="btn quiet is-danger" onClick={() => p.onPurge(showing.id)}>
                Excluir definitivamente
              </button>
            )}
          </div>
        ) : archivedHere ? (
          <div className="notes-banner">
            <Icon name="archive" />
            <span>{meta.archivedAt ? 'Arquivada. Não aparece na árvore, mas continua na busca.' : 'Dentro de uma página arquivada.'}</span>
            {meta.archivedAt && (
              <button className="btn quiet" onClick={() => p.onUnarchive(showing.id)}>
                Desarquivar
              </button>
            )}
          </div>
        ) : null

  return (
    <div className={`notes-sheet reveal ${scrolled ? 'is-scrolled' : ''}`} style={{ ['--i' as string]: 2 }}>
      <header className="notes-bar">
        <nav className="notes-crumbs" aria-label="Caminho">
          {crumbs.map((c) => (
            <span key={c.id} className="notes-crumb">
              <button onClick={() => p.onOpen(c.id)} title={titleOf(c)}>{titleOf(c)}</button>
              <Icon name="chevron" size={10} />
            </span>
          ))}
          {crumbs.length > 0 && <span className="notes-crumb is-current">{titleOf(meta)}</span>}
        </nav>
        <SaveStatus />
        <button
          className="notes-icon-btn notes-bar-more"
          onClick={(e) => p.onMenu(showing.id, e.currentTarget.getBoundingClientRect())}
          aria-label="Ações da nota"
          title="Ações da nota"
        >
          <Icon name="more" />
        </button>
      </header>

      <div
        ref={scroller}
        className="notes-scroll"
        onScroll={(e) => {
          const s = e.currentTarget.scrollTop > 6
          if (s !== scrolled) setScrolled(s)
        }}
      >
        <NoteEditor
          key={showing.id}
          note={showing}
          readOnly={!live}
          font={p.font}
          focusTitle={p.focusTitleFor === showing.id}
          onFocusConsumed={p.onFocusConsumed}
          banner={banner}
          footer={
            live && (kids.length > 0 || canAddChild(showing.id, idx)) ? (
              <section className="notes-subpages" aria-label="Subpáginas">
                {kids.length > 0 && <h2 className="notes-section-title">Subpáginas</h2>}
                <div className="notes-subgrid">
                  {kids.map((k) => (
                    <button key={k.id} className="notes-subcard" onClick={() => p.onOpen(k.id)}>
                      <Icon name="page" />
                      <span className="notes-subcard-title">{titleOf(k)}</span>
                      {k.excerpt && <span className="notes-subcard-excerpt">{k.excerpt}</span>}
                    </button>
                  ))}
                  {canAddChild(showing.id, idx) && (
                    <button className="notes-subcard is-new" onClick={() => p.onNew(showing.id)}>
                      <Icon name="plus" />
                      <span className="notes-subcard-title">Nova subpágina</span>
                    </button>
                  )}
                </div>
              </section>
            ) : null
          }
        />
      </div>

      <Toast />
    </div>
  )
}

function SaveStatus() {
  const s = useSaveState()
  const editing = useEditing()
  const busy = editing || s.saving > 0
  const [slow, setSlow] = useState(false)
  const [tick, setTick] = useState(0)
  const wasBusy = useRef(false)

  useEffect(() => {
    if (!busy) {
      setSlow(false)
      if (wasBusy.current) setTick((t) => t + 1)
      wasBusy.current = false
      return
    }
    wasBusy.current = true
    const t = setTimeout(() => setSlow(true), 450)
    return () => clearTimeout(t)
  }, [busy])

  if (s.failed.length)
    return (
      <button className="notes-status is-error" onClick={retryFailedSaves} title={s.error ?? undefined}>
        <Icon name="alert" size={13} />
        <span>Erro ao salvar</span>
        <span className="notes-status-retry">Tentar de novo</span>
      </button>
    )
  return (
    <span className={`notes-status ${slow ? 'is-saving' : ''}`} role="status" aria-live="polite">
      {slow ? <i className="notes-status-dot" aria-hidden="true" /> : <span key={tick} className="notes-status-check"><Icon name="check" size={13} /></span>}
      <span>{slow ? 'Salvando…' : 'Salvo'}</span>
    </span>
  )
}

function Toast() {
  const n = useNotice()
  useEffect(() => {
    if (!n) return
    const t = setTimeout(() => dismissNotice(n.id), n.action ? 6500 : 4200)
    return () => clearTimeout(t)
  }, [n])
  if (!n) return null
  return (
    <div key={n.id} className={`notes-toast ${n.tone === 'error' ? 'is-error' : ''}`} role={n.tone === 'error' ? 'alert' : 'status'}>
      {n.tone === 'error' && <Icon name="alert" size={14} />}
      <span>{n.text}</span>
      {n.action && (
        <button
          className="notes-toast-action"
          onClick={() => {
            n.action!.run()
            dismissNotice(n.id)
          }}
        >
          {n.action.label}
        </button>
      )}
      <button className="notes-toast-close" onClick={() => dismissNotice(n.id)} aria-label="Fechar aviso">
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

function PopMenu({ spec, onClose }: { spec: MenuSpec; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const a = spec.anchor
    let left = a.right - w
    if (a.width === 0) left = a.left
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = a.bottom + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6)
    setPos({ left, top })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [spec])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className={`notes-menu ${pos ? 'is-in' : ''}`}
      style={pos ?? { left: -9999, top: -9999 }}
      role="menu"
      aria-label={spec.label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Tab') return
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const i = items.indexOf(document.activeElement as HTMLButtonElement)
        e.preventDefault()
        const d = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1
        items[(i + d + items.length) % items.length]?.focus()
      }}
    >
      {spec.items.map((it, i) =>
        it === 'sep' ? (
          <span key={i} className="notes-menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'}
            aria-checked={it.checked}
            className={`notes-menu-item ${it.danger ? 'is-danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.run()
            }}
          >
            <Icon name={it.icon} size={15} />
            <span>{it.label}</span>
            {it.checked && <span className="notes-menu-check"><Icon name="check" size={13} /></span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

function Modal({ label, onClose, children, className = '' }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return createPortal(
    <div className="notes-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`notes-dialog ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  return (
    <Modal label={spec.title} onClose={onClose} className="is-confirm">
      <span className="notes-dialog-icon" aria-hidden="true">
        <Icon name="trash" size={18} />
      </span>
      <h2 className="display">{spec.title}</h2>
      <p>{spec.text}</p>
      <div className="notes-dialog-actions">
        <button ref={cancel} className="btn quiet" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn notes-btn-danger"
          onClick={() => {
            onClose()
            spec.run()
          }}
        >
          {spec.action}
        </button>
      </div>
    </Modal>
  )
}

function MoveDialog({ id, idx, onClose, onMove }: { id: string; idx: Idx; onClose: () => void; onMove: (target: string | null) => void }) {
  const [q, setQ] = useState('')
  const all = useMemo(() => moveTargets(id, idx), [id, idx])
  const list = q.trim() ? all.filter((t) => t.id === null || t.title.toLowerCase().includes(q.trim().toLowerCase())) : all
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setActive(0), [q])
  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (i: number) => {
    const t = list[i]
    if (t && t.allowed && !t.current) onMove(t.id)
  }

  return (
    <Modal label="Mover para" onClose={onClose} className="is-move">
      <div className="notes-dialog-head">
        <div className="kicker">Mover</div>
        <h2 className="display">{titleOf(idx.byId.get(id))}</h2>
      </div>
      <label className="notes-search is-dialog">
        <Icon name="search" />
        <input
          autoFocus
          value={q}
          placeholder="Para qual página?"
          aria-label="Filtrar páginas"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(list.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(active)
            }
          }}
        />
      </label>
      <div className="notes-move-list" ref={listRef} role="listbox" aria-label="Destinos">
        {list.map((t, i) => (
          <button
            key={t.id ?? 'top'}
            role="option"
            aria-selected={i === active}
            data-active={i === active}
            aria-disabled={!t.allowed || t.current}
            className={`notes-move-item ${!t.allowed || t.current ? 'is-off' : ''}`}
            style={{ ['--depth' as string]: q.trim() ? 0 : t.depth }}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(i)}
            title={t.current ? 'Já está aqui' : !t.allowed ? 'Não cabe: as subpáginas vão até 3 níveis' : undefined}
          >
            <Icon name={t.id === null ? 'pages' : 'page'} size={14} />
            <span className="notes-row-title">{t.id === null ? 'Topo (sem página-mãe)' : t.title.trim() || 'Sem título'}</span>
            {t.current && <span className="notes-move-tag">atual</span>}
          </button>
        ))}
      </div>
    </Modal>
  )
}
