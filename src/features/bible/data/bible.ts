export type BibleBook = {
  id: string
  name: string
  title: string
  abbr: string
  chapters: string[][]
  superscriptions: Record<string, string>
  footnotes: [number, number, string][]
}

export type BibleEdition = {
  id: string
  name: string
  abbr: string
  variant: string
  release: string
  license: string
  credit: string
}

export type Bible = {
  edition: BibleEdition
  counts: { books: number; chapters: number; verses: number }
  books: BibleBook[]
  bookVerseOffset: number[]
}

export type VerseRef = { book: number; chapter: number; verse: number }

export async function loadBible(url = '/bible/blivre-tr.json'): Promise<Bible> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Não foi possível carregar o texto bíblico (${res.status})`)
  const data = (await res.json()) as Omit<Bible, 'bookVerseOffset'>
  const bookVerseOffset: number[] = []
  let acc = 0
  for (const b of data.books) {
    bookVerseOffset.push(acc)
    acc += b.chapters.reduce((n, c) => n + c.length, 0)
  }
  return { ...data, bookVerseOffset }
}

export function globalFraction(bible: Bible, ref: VerseRef): number {
  const book = bible.books[ref.book]
  let idx = bible.bookVerseOffset[ref.book]
  for (let c = 0; c < ref.chapter; c++) idx += book.chapters[c].length
  idx += ref.verse
  return idx / bible.counts.verses
}

export function compareRef(a: VerseRef, b: VerseRef): number {
  return a.book - b.book || a.chapter - b.chapter || a.verse - b.verse
}

export function formatRef(bible: Bible, ref: VerseRef): string {
  return `${bible.books[ref.book].name} ${ref.chapter + 1}:${ref.verse + 1}`
}

export function verseText(bible: Bible, ref: VerseRef): string {
  return (bible.books[ref.book]?.chapters[ref.chapter]?.[ref.verse] ?? '').replace(/[\u0001\u0002]/g, '')
}
