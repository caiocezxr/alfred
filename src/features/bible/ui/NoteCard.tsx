import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { verseText, type Bible } from '../data/bible'
import {
  HIGHLIGHT_SWATCH, deleteNote, findNote, notesStore, saveNote,
  type HighlightColor,
} from '../data/stores'
import type { Selection } from '../controller'

const COLORS: HighlightColor[] = ['gold', 'rose', 'sage', 'sky']
const COLOR_NAMES: Record<HighlightColor, string> = { gold: 'Dourado', rose: 'Rosa', sage: 'Verde', sky: 'Azul' }

export function NoteCard({ bible, sel, anchor, onClose, onSelect }: {
  bible: Bible
  sel: Selection
  anchor: { x: number; y: number }
  onClose: () => void
  onSelect: (s: Selection) => void
}) {
  useSyncExternalStore(notesStore.subscribe, notesStore.get)
  const note = findNote(sel)
  const [text, setText] = useState(note?.text ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const box = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<string | null>(null)
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y })

  const key = `${sel.book}:${sel.chapter}:${sel.verse}`
  useEffect(() => {
    setText(findNote(sel)?.text ?? '')
    setStatus('idle')
    pending.current = null
  }, [key])

  useEffect(() => {
    if (pending.current === null) return
    setStatus('saving')
    const id = setTimeout(() => {
      saveNote(sel, { text: pending.current ?? '' })
      pending.current = null
      setStatus('saved')
    }, 450)
    return () => clearTimeout(id)
  }, [text])
  useEffect(
    () => () => {
      if (pending.current !== null) saveNote(sel, { text: pending.current })
    },
    [key],
  )

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = anchor.x + 22
    if (left + w > window.innerWidth - 16) left = anchor.x - w - 22
    left = Math.max(16, left)
    const top = Math.min(Math.max(70, anchor.y - 60), window.innerHeight - h - 16)
    setPos({ left, top })
  }, [anchor.x, anchor.y, key])

  useEffect(() => {
    area.current?.focus({ preventScroll: true })
  }, [key])

  const book = bible.books[sel.book]
  const isChapter = sel.verse === null
  const title = isChapter ? `${book.name} ${sel.chapter + 1}` : `${book.name} ${sel.chapter + 1}:${(sel.verse ?? 0) + 1}`
  const quote = isChapter ? '' : verseText(bible, { book: sel.book, chapter: sel.chapter, verse: sel.verse ?? 0 })

  return (
    <div
      ref={box}
      className="note-card"
      role="dialog"
      aria-label={`Anotação — ${title}`}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="note-head">
        <div>
          <div className="note-kicker">{isChapter ? 'Anotação do capítulo' : 'Versículo'}</div>
          <div className="note-title">{title}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">×</button>
      </div>

      {quote && <blockquote className="note-quote">{quote}</blockquote>}

      {!isChapter && (
        <div className="note-colors" role="radiogroup" aria-label="Destaque">
          {COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={note?.color === c}
              aria-label={COLOR_NAMES[c]}
              title={COLOR_NAMES[c]}
              className={`swatch ${note?.color === c ? 'is-on' : ''}`}
              style={{ ['--sw' as string]: HIGHLIGHT_SWATCH[c] }}
              onClick={() => saveNote(sel, { color: note?.color === c ? null : c, text: pending.current ?? text })}
            />
          ))}
          <span className="note-colors-label">{note?.color ? COLOR_NAMES[note.color] : 'Destacar'}</span>
        </div>
      )}

      <textarea
        ref={area}
        className="note-text"
        placeholder={isChapter ? 'O que este capítulo te disse?' : 'O que você viu neste versículo?'}
        value={text}
        rows={4}
        onChange={(e) => {
          pending.current = e.target.value
          setText(e.target.value)
        }}
      />

      <div className="note-foot">
        <span className={`note-status ${status}`}>{status === 'saving' ? 'salvando…' : status === 'saved' ? 'salvo' : ''}</span>
        <div className="note-actions">
          {!isChapter ? (
            <button className="link-btn" onClick={() => onSelect({ book: sel.book, chapter: sel.chapter, verse: null })}>
              Anotar o capítulo
            </button>
          ) : null}
          {note && (
            <button
              className="link-btn danger"
              onClick={() => {
                pending.current = null
                deleteNote(note.id)
                setText('')
              }}
            >
              Remover
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
