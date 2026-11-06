import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { EditorContent, posToDOMRect, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { openExternal } from '../../shared/openExternal'
import { notesApi, plainTextOf, type Note } from './api'
import { primeAsset } from './assets'
import { buildExtensions } from './extensions'
import { Icon } from './icons'
import { countWords, docToPlainText, type JSONNode } from './markdown'
import { createSlashStore, type SlashItem, type SlashStore } from './slash'
import { getMeta, notifyError, registerFlusher, saveNote, setEditing, setTitleLocal, useNotesState, useNow } from './store'
import { MAX_IMAGE_BYTES, relativeTime, sniffImage } from './text'

const AUTOSAVE_MS = 650
const MAX_WAIT_MS = 4000

export type BodyFont = 'serif' | 'sans'

type Props = {
  note: Note
  readOnly: boolean
  font: BodyFont
  focusTitle: boolean
  onFocusConsumed: () => void
  banner?: ReactNode
  footer?: ReactNode
}

function parseDoc(doc: string): { content: JSONNode | null; ok: boolean } {
  try {
    const v = JSON.parse(doc) as JSONNode
    return v && v.type === 'doc' ? { content: v, ok: true } : { content: null, ok: false }
  } catch {
    return { content: null, ok: false }
  }
}

const imageFiles = (dt: DataTransfer | null | undefined) => Array.from(dt?.files ?? []).filter((f) => f.type.startsWith('image/'))

export function NoteEditor({ note, readOnly, font, focusTitle, onFocusConsumed, banner, footer }: Props) {
  const id = note.id
  const { notes } = useNotesState()
  const meta = notes.find((n) => n.id === id)
  const title = meta?.title ?? note.title
  const now = useNow()

  const parsed = useMemo(() => parseDoc(note.doc), [note.doc])
  const [contentError, setContentError] = useState(!parsed.ok)
  const locked = readOnly || contentError
  const lockedRef = useRef(locked)
  lockedRef.current = locked

  const titleRef = useRef<HTMLTextAreaElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const slash = useMemo(() => createSlashStore(), [])
  const [linkEdit, setLinkEdit] = useState(false)
  const [words, setWords] = useState(() => countWords(plainTextOf(note.doc)))

  const docRef = useRef<PMNode | null>(null)
  const dirty = useRef(false)
  const firstDirty = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const wordsTimer = useRef<number | undefined>(undefined)

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    if (!dirty.current || lockedRef.current || !docRef.current) return
    dirty.current = false
    setEditing(false)
    firstDirty.current = 0
    const json = docRef.current.toJSON() as JSONNode
    void saveNote(id, { title: getMeta(id)?.title ?? '', doc: JSON.stringify(json), plainText: docToPlainText(json) })
  }, [id])

  const schedule = useCallback(() => {
    if (lockedRef.current) return
    dirty.current = true
    setEditing(true)
    const t = Date.now()
    if (!firstDirty.current) firstDirty.current = t
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, Math.max(0, Math.min(AUTOSAVE_MS, MAX_WAIT_MS - (t - firstDirty.current))))
  }, [flush])

  useEffect(() => registerFlusher(flush), [flush])
  useEffect(() => () => flush(), [flush])

  const upload = useCallback(
    async (files: File[], at?: number) => {
      const ed = editorRef.current
      if (!ed || lockedRef.current) return
      if (at !== undefined) ed.chain().focus().setTextSelection(at).run()
      for (const file of files) {
        try {
          if (file.size > MAX_IMAGE_BYTES) throw new Error('a imagem passa de 10 MB')
          const bytes = new Uint8Array(await file.arrayBuffer())
          if (!sniffImage(bytes)) throw new Error('formato não suportado: use PNG, JPEG, GIF ou WebP')
          const asset = await notesApi.assetSave(id, bytes)
          primeAsset(asset.id, URL.createObjectURL(file))
          if (ed.isDestroyed) return
          const alt = /^image\.\w+$/i.test(file.name) ? '' : file.name.replace(/\.[^.]+$/, '')
          ed.chain().focus().insertContent({ type: 'image', attrs: { assetId: asset.id, alt } }).run()
        } catch (e) {
          notifyError(e)
        }
      }
    },
    [id],
  )
  const uploadRef = useRef(upload)
  uploadRef.current = upload

  const exitTop = useCallback(() => {
    const el = titleRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const extensions = useMemo(
    () =>
      buildExtensions({
        slash,
        onPickImage: () => fileRef.current?.click(),
        onLink: () => setLinkEdit(true),
        onExitTop: exitTop,
      }),
    [slash, exitTop],
  )

  const editor = useEditor(
    {
      extensions,
      content: parsed.content ?? undefined,
      editable: !locked,
      enableContentCheck: true,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      onContentError: () => setContentError(true),
      onCreate: ({ editor: e }) => {
        editorRef.current = e
        docRef.current = e.state.doc
      },
      onUpdate: ({ editor: e }) => {
        docRef.current = e.state.doc
        schedule()
        window.clearTimeout(wordsTimer.current)
        wordsTimer.current = window.setTimeout(() => {
          const d = e.state.doc
          setWords(countWords(d.textBetween(0, d.content.size, '\n', '\n')))
        }, 300)
      },
      onBlur: () => flush(),
      editorProps: {
        attributes: { class: 'notes-prose', spellcheck: 'true', 'aria-label': 'Conteúdo da nota', 'aria-multiline': 'true' },
        handlePaste: (_view, event) => {
          const files = imageFiles(event.clipboardData)
          if (!files.length) return false
          event.preventDefault()
          void uploadRef.current(files)
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false
          const files = imageFiles(event.dataTransfer)
          if (!files.length) return false
          event.preventDefault()
          void uploadRef.current(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
          return true
        },
        handleClick: (view, _pos, event) => {
          const a = (event.target as HTMLElement | null)?.closest?.('a[href]')
          if (!a) return false
          if (event.metaKey || !view.editable) {
            event.preventDefault()
            void openExternal(a.getAttribute('href') ?? '')
            return true
          }
          return false
        },
      },
    },
    [id],
  )
  editorRef.current = editor

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable === locked) editor.setEditable(!locked, false)
  }, [editor, locked])

  useEffect(
    () => () => {
      window.clearTimeout(wordsTimer.current)
    },
    [],
  )

  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [title, font])

  useEffect(() => {
    const onResize = () => {
      const el = titleRef.current
      if (!el) return
      el.style.height = '0px'
      el.style.height = `${el.scrollHeight}px`
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!focusTitle) return
    const el = titleRef.current
    if (el) {
      el.focus()
      el.select()
    }
    onFocusConsumed()
  }, [focusTitle, onFocusConsumed])

  const focusBody = () => {
    if (!editor || editor.isDestroyed) return
    editor.view.focus()
    editor.commands.setTextSelection(1)
    editor.commands.focus('start')
  }

  const readMins = Math.max(1, Math.round(words / 230))
  const edited = meta ? relativeTime(meta.updatedAt, now) : ''

  return (
    <article
      className="notes-doc"
      lang="pt-BR"
      data-font={font}
      onKeyDown={(e) => {
        if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'k') e.stopPropagation()
      }}
    >
      {banner}
      {contentError && !readOnly && (
        <div className="notes-banner is-warn" role="alert">
          <Icon name="alert" />
          <span>Este documento tem um formato que o editor não reconhece. Abri só para leitura e nada será salvo por cima.</span>
        </div>
      )}
      <textarea
        ref={titleRef}
        className="notes-title"
        rows={1}
        maxLength={500}
        placeholder="Sem título"
        aria-label="Título da nota"
        value={title}
        readOnly={locked}
        onChange={(e) => {
          setTitleLocal(id, e.target.value.replace(/[\r\n]+/g, ' '))
          schedule()
        }}
        onKeyDown={(e) => {
          const el = e.currentTarget
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            focusBody()
          } else if (e.key === 'ArrowDown' && el.selectionStart === el.value.length) {
            e.preventDefault()
            focusBody()
          }
        }}
        onBlur={flush}
      />
      <div className="notes-meta" aria-live="off">
        {edited && <span>Editada {edited}</span>}
        <span>
          {words.toLocaleString('pt-BR')} {words === 1 ? 'palavra' : 'palavras'}
        </span>
        {words >= 150 && <span>{readMins} min de leitura</span>}
      </div>

      <div
        ref={wrapRef}
        className="notes-editor"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget && editor && !locked) {
            e.preventDefault()
            editor.chain().focus('end').run()
          }
        }}
      >
        <EditorContent editor={editor} />
        {editor && !locked && <BubbleBar editor={editor} wrap={wrapRef} linkEdit={linkEdit} setLinkEdit={setLinkEdit} />}
        {editor && <LinkPopover editor={editor} wrap={wrapRef} hidden={linkEdit} editable={!locked} onEdit={() => setLinkEdit(true)} />}
        {editor && !locked && <SlashMenu store={slash} wrap={wrapRef} />}
      </div>

      {footer}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) void upload(files)
        }}
      />
    </article>
  )
}

type Pos = { x: number; y: number; below: boolean }

function anchorOf(editor: Editor, wrap: HTMLElement, from: number, to: number, el: HTMLElement | null): Pos | null {
  if (editor.isDestroyed) return null
  const r = posToDOMRect(editor.view, from, to)
  const w = wrap.getBoundingClientRect()
  const scroller = wrap.closest('.notes-scroll')?.getBoundingClientRect()
  const half = (el?.offsetWidth ?? 0) / 2
  const cx = r.left + r.width / 2 - w.left
  const x = Math.min(Math.max(cx, half - 12), w.width - half + 12)
  const below = !!scroller && r.top - scroller.top < 64
  return { x, y: below ? r.bottom - w.top : r.top - w.top, below }
}

function normalizeUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || /\s/.test(s)) return null
  return `https://${s.replace(/^\/+/, '')}`
}

function BubbleBar({ editor, wrap, linkEdit, setLinkEdit }: {
  editor: Editor
  wrap: RefObject<HTMLDivElement | null>
  linkEdit: boolean
  setLinkEdit: (v: boolean) => void
}) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { selection } = e.state
      return {
        from: selection.from,
        to: selection.to,
        empty: selection.empty,
        node: selection instanceof NodeSelection,
        focused: e.isFocused,
        inCode: e.isActive('codeBlock'),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        href: String(e.getAttributes('link').href ?? ''),
      }
    },
  })
  const [selecting, setSelecting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const [url, setUrl] = useState('')

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.notes-bubble, .notes-linkpop, .notes-slash')) return
      setSelecting(true)
    }
    const up = () => setSelecting(false)
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [wrap])

  const show = linkEdit || (!st.empty && !st.node && !st.inCode && st.focused && !selecting)

  useLayoutEffect(() => {
    if (!show || !wrap.current) return setPos(null)
    setPos(anchorOf(editor, wrap.current, st.from, st.to, ref.current))
  }, [show, st.from, st.to, linkEdit, editor, wrap])

  useEffect(() => {
    if (linkEdit) setUrl(st.href)
  }, [linkEdit, st.href])

  if (!show) return null

  const apply = () => {
    const href = normalizeUrl(url)
    const chain = editor.chain().focus()
    if (!url.trim()) chain.extendMarkRange('link').unsetLink().run()
    else if (!href) notifyError(new Error('use um endereço http(s), como exemplo.com'))
    else if (editor.state.selection.empty && !editor.isActive('link'))
      chain.insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href } }] }).run()
    else chain.extendMarkRange('link').setLink({ href }).run()
    setLinkEdit(false)
  }

  const btn = (name: 'bold' | 'italic' | 'strike' | 'code', label: string, kbd: string, run: () => void) => (
    <button
      type="button"
      className={`notes-bubble-btn ${st[name] ? 'is-on' : ''}`}
      aria-pressed={st[name]}
      aria-label={label}
      title={`${label} (${kbd})`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon name={name} />
    </button>
  )

  return (
    <div
      ref={ref}
      className={`notes-bubble ${pos ? 'is-in' : ''} ${pos?.below ? 'is-below' : ''}`}
      style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
      role="toolbar"
      aria-label="Formatação"
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      {linkEdit ? (
        <div className="notes-link-edit">
          <Icon name="link" />
          <input
            autoFocus
            value={url}
            placeholder="Cole ou digite um link…"
            aria-label="Endereço do link"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                apply()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setLinkEdit(false)
                editor.commands.focus()
              }
            }}
            onBlur={() => setLinkEdit(false)}
          />
          <button type="button" className="notes-bubble-btn" aria-label="Aplicar link" onMouseDown={(e) => e.preventDefault()} onClick={apply}>
            <Icon name="check" />
          </button>
        </div>
      ) : (
        <>
          {btn('bold', 'Negrito', '⌘B', () => editor.chain().focus().toggleBold().run())}
          {btn('italic', 'Itálico', '⌘I', () => editor.chain().focus().toggleItalic().run())}
          {btn('strike', 'Tachado', '⌘⇧S', () => editor.chain().focus().toggleStrike().run())}
          {btn('code', 'Código', '⌘E', () => editor.chain().focus().toggleCode().run())}
          <span className="notes-bubble-sep" aria-hidden="true" />
          <button
            type="button"
            className={`notes-bubble-btn ${st.link ? 'is-on' : ''}`}
            aria-label="Link"
            title="Link (⌘⇧K)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setLinkEdit(true)}
          >
            <Icon name="link" />
          </button>
        </>
      )}
    </div>
  )
}

function LinkPopover({ editor, wrap, hidden, editable, onEdit }: {
  editor: Editor
  wrap: RefObject<HTMLDivElement | null>
  hidden: boolean
  editable: boolean
  onEdit: () => void
}) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      from: e.state.selection.from,
      empty: e.state.selection.empty,
      focused: e.isFocused,
      href: e.isActive('link') ? String(e.getAttributes('link').href ?? '') : '',
    }),
  })
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const show = !hidden && st.empty && st.focused && !!st.href

  useLayoutEffect(() => {
    if (!show || !wrap.current) return setPos(null)
    const p = anchorOf(editor, wrap.current, st.from, st.from, ref.current)
    if (!p || editor.isDestroyed) return setPos(null)
    const r = posToDOMRect(editor.view, st.from, st.from)
    const w = wrap.current.getBoundingClientRect()
    setPos({ x: Math.max(p.x, (ref.current?.offsetWidth ?? 0) / 2), y: r.bottom - w.top, below: true })
  }, [show, st.from, st.href, editor, wrap])

  if (!show) return null
  let label = st.href
  try {
    const u = new URL(st.href)
    label = u.protocol === 'mailto:' ? u.pathname : u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
  }

  return (
    <div
      ref={ref}
      className={`notes-linkpop ${pos ? 'is-in' : ''}`}
      style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className="notes-linkpop-url" title={`${st.href} — abrir no navegador (⌘-clique)`} onClick={() => void openExternal(st.href)}>
        <span>{label}</span>
        <Icon name="external" size={13} />
      </button>
      {editable && (
        <>
          <button
            type="button"
            className="notes-bubble-btn"
            aria-label="Editar link"
            title="Editar link"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').run()
              onEdit()
            }}
          >
            <Icon name="edit" size={14} />
          </button>
          <button
            type="button"
            className="notes-bubble-btn"
            aria-label="Remover link"
            title="Remover link"
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
          >
            <Icon name="close" size={14} />
          </button>
        </>
      )}
    </div>
  )
}

function SlashMenu({ store, wrap }: { store: SlashStore; wrap: RefObject<HTMLDivElement | null> }) {
  const s = useSyncExternalStore(store.subscribe, store.get)
  const listRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [s.index, s.open])

  if (!s.open || !s.rect || !wrap.current || !s.items.length) return null
  const w = wrap.current.getBoundingClientRect()
  const up = s.rect.bottom + 340 > window.innerHeight
  const style = { left: Math.max(0, Math.min(s.rect.left - w.left - 10, w.width - 280)), top: up ? s.rect.top - w.top - 8 : s.rect.bottom - w.top + 8 }

  const choose = (it: SlashItem) => s.pick?.(it)
  return (
    <div className={`notes-slash ${up ? 'is-up' : ''}`} style={style} role="listbox" aria-label="Inserir bloco" ref={listRef}>
      <div className="notes-slash-head">Inserir bloco</div>
      {s.items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="option"
          aria-selected={i === s.index}
          className="notes-slash-item"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => store.set({ index: i })}
          onClick={() => choose(it)}
        >
          <span className="notes-slash-icon">
            <Icon name={it.icon} />
          </span>
          <span className="notes-slash-label">{it.label}</span>
          {it.hint && <kbd className="notes-slash-hint">{it.hint}</kbd>}
        </button>
      ))}
    </div>
  )
}
