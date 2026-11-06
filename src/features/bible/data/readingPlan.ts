import type { Bible, VerseRef } from './bible'
import type { GoalUnit } from './stores'

export function readingRange(bible: Bible, start: VerseRef, unit: GoalUnit, amount: number): { from: VerseRef; to: VerseRef; next: VerseRef | null } {
  const from = { ...start }
  let b = start.book
  let c = start.chapter
  let v = start.verse
  const lastVerse = (bb: number, cc: number) => bible.books[bb].chapters[cc].length - 1
  const advanceChapter = () => {
    if (c + 1 < bible.books[b].chapters.length) c++
    else if (b + 1 < bible.books.length) {
      b++
      c = 0
    } else return false
    v = 0
    return true
  }
  if (unit === 'chapters') {
    for (let i = 1; i < amount; i++) if (!advanceChapter()) break
    v = lastVerse(b, c)
  } else {
    for (let i = 1; i < amount; i++) {
      if (v + 1 <= lastVerse(b, c)) v++
      else if (!advanceChapter()) break
    }
  }
  const to = { book: b, chapter: c, verse: v }
  let next: VerseRef | null = null
  if (v + 1 <= lastVerse(b, c)) next = { book: b, chapter: c, verse: v + 1 }
  else if (c + 1 < bible.books[b].chapters.length) next = { book: b, chapter: c + 1, verse: 0 }
  else if (b + 1 < bible.books.length) next = { book: b + 1, chapter: 0, verse: 0 }
  return { from, to, next }
}

export function formatRange(bible: Bible, from: VerseRef, to: VerseRef): string {
  const bf = bible.books[from.book]
  const fullFrom = from.verse === 0
  const fullTo = to.verse === bible.books[to.book].chapters[to.chapter].length - 1
  if (from.book === to.book) {
    if (from.chapter === to.chapter) {
      if (fullFrom && fullTo) return `${bf.name} ${from.chapter + 1}`
      return `${bf.name} ${from.chapter + 1}:${from.verse + 1}–${to.verse + 1}`
    }
    if (fullFrom && fullTo) return `${bf.name} ${from.chapter + 1}–${to.chapter + 1}`
    return `${bf.name} ${from.chapter + 1}:${from.verse + 1} – ${to.chapter + 1}:${to.verse + 1}`
  }
  return `${bf.name} ${from.chapter + 1}:${from.verse + 1} – ${bible.books[to.book].name} ${to.chapter + 1}:${to.verse + 1}`
}
