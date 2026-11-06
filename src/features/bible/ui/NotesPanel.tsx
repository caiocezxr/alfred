import { useMemo, useState, useSyncExternalStore } from 'react'
import { verseText, type Bible } from '../data/bible'
import { HIGHLIGHT_SWATCH, notesStore, type Annotation } from '../data/stores'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })

export function NotesPanel({ bible, onClose, onOpen }: {
  bible: Bible
  onClose: () => void
  onOpen: (n: Annotation) => void
}) {
  const { items } = useSyncExternalStore(notesStore.subscribe, notesStore.get)
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<'recent' | 'canon'>('recent')

  const list = useMemo(() => {
    const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    const nq = norm(q.trim())
    const rows = items.map((n) => {
      const book = bible.books[n.book]
      const ref = n.verse === null ? `${book.name} ${n.chapter + 1}` : `${book.name} ${n.chapter + 1}:${n.verse + 1}`
      const quote = n.verse === null ? '' : verseText(bible, { book: n.book, chapter: n.chapter, verse: n.verse })
      return { n, ref, quote, hay: norm(`${ref} ${n.text} ${quote}`) }
    })
    const filtered = nq ? rows.filter((r) => r.hay.includes(nq)) : rows
    return filtered.sort((a, b) =>
      order === 'recent'
        ? b.n.updatedAt - a.n.updatedAt
        : a.n.book - b.n.book || a.n.chapter - b.n.chapter || (a.n.verse ?? -1) - (b.n.verse ?? -1),
    )
  }, [items, q, order, bible])

  return (
    <aside className="side-panel" aria-label="Anotações">
      <div className="panel-head">
        <h2>Anotações</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <div className="panel-search">
        <input
          autoFocus
          type="search"
          placeholder="Buscar nas anotações e versículos"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (q ? setQ('') : onClose())}
        />
      </div>
      <div className="segmented small" role="tablist">
        <button role="tab" aria-selected={order === 'recent'} onClick={() => setOrder('recent')}>Recentes</button>
        <button role="tab" aria-selected={order === 'canon'} onClick={() => setOrder('canon')}>Ordem bíblica</button>
      </div>

      {items.length === 0 ? (
        <p className="panel-empty">
          Clique em qualquer versículo para destacar ou escrever o que ele te disse. Tudo aparece aqui depois.
        </p>
      ) : list.length === 0 ? (
        <p className="panel-empty">Nada encontrado para “{q}”.</p>
      ) : (
        <ul className="notes-list">
          {list.map(({ n, ref, quote }) => (
            <li key={n.id}>
              <button className="note-item" onClick={() => onOpen(n)}>
                <div className="note-item-head">
                  {n.color && <span className="dot" style={{ background: HIGHLIGHT_SWATCH[n.color] }} />}
                  <span className="note-item-ref">{ref}</span>
                  <span className="note-item-date">{dateFmt.format(n.updatedAt)}</span>
                </div>
                {quote && <p className="note-item-quote">{quote}</p>}
                {n.text.trim() && <p className="note-item-text">{n.text}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
