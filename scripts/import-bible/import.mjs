
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const CANON = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH',
  'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS',
  'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH',
  '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
]
const EXPECTED = { books: 66, chapters: 1189, verses: 31102 }

const [srcDir, outFile, ...rest] = process.argv.slice(2)
if (!srcDir || !outFile) {
  console.error('uso: import.mjs <dir-usfm-s> <saida.json> [--variant tr|n4]')
  process.exit(2)
}
const variant = rest.includes('--variant') ? rest[rest.indexOf('--variant') + 1] : 'tr'

const errors = []
const warnings = []
const books = new Map()

for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.txt')).sort()) {
  const raw = readFileSync(join(srcDir, file), 'utf8').replace(/^﻿/, '')
  const book = { id: '', name: '', title: '', abbr: '', chapters: [], superscriptions: {}, footnotes: [] }
  let chapter = null
  let expectVerse = 1

  const lines = []
  for (const l of raw.split(/\r?\n/)) {
    const structural = /^\\(v|c|p|d|id|ide|h|toc\d|mt)\b/.test(l)
    if (l.trim() && !structural && lines.length) lines[lines.length - 1] += ' ' + l.trim()
    else lines.push(l)
  }
  for (const line of lines) {
    const m = line.match(/^\\(\w+)\s?(.*)$/)
    if (!m) {
      if (line.trim()) warnings.push(`${file}: linha sem marcador ignorada: ${line.slice(0, 40)}`)
      continue
    }
    const [, tag, value] = m
    switch (tag) {
      case 'id': book.id = value.split(' ')[0]; break
      case 'h': book.name = value.trim(); break
      case 'toc1': book.title = value.trim(); break
      case 'toc3': book.abbr = value.trim(); break
      case 'd': {
        if (book.chapters.length) book.superscriptions[book.chapters.length - 1] = value.replace(/\\p\s*$/, '').trim()
        break
      }
      case 'c': {
        const n = Number(value)
        if (n !== book.chapters.length + 1) errors.push(`${file}: capítulo ${n} fora de sequência`)
        chapter = []
        book.chapters.push(chapter)
        expectVerse = 1
        break
      }
      case 'v': {
        const vm = value.match(/^(\d+)\s?(.*)$/)
        if (!vm || !chapter) { errors.push(`${file}: versículo inválido: ${value.slice(0, 30)}`); break }
        const n = Number(vm[1])
        let body = vm[2]
        body = body.replace(/\\f \+(.*?)\\f\*/g, (_, inner) => {
          const t = inner.replace(/\\fq\s*/g, '').replace(/\\ft\s*/g, ' — ').replace(/^\s*—\s*/, '').replace(/\s+/g, ' ').trim()
          book.footnotes.push([book.chapters.length - 1, Number(vm[1]) - 1, t])
          return ' '
        })
        body = body.replace(/\\rq .*?\\rq\*/g, ' ')
        body = body.replace(/\\add\s*(.*?)\\add\*/g, (_, t) => `\u0001${t.trim()}\u0002`)
        if (/\\[a-z]/.test(body)) warnings.push(`${book.id} ${book.chapters.length}:${vm[1]} marcador não tratado: ${body.match(/\\[a-z]+/)[0]}`)
        const text = body.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
        if (n !== expectVerse) errors.push(`${file} ${book.chapters.length}:${n}: esperado versículo ${expectVerse}`)
        if (!text) warnings.push(`${book.id} ${book.chapters.length}:${n} sem texto`)
        chapter.push(text)
        expectVerse = n + 1
        break
      }
      case 'p': break
      default: break
    }
  }
  if (!CANON.includes(book.id)) errors.push(`${file}: livro desconhecido ${book.id}`)
  books.set(book.id, book)
}

const ordered = CANON.map((id) => books.get(id)).filter(Boolean)
const counts = {
  books: ordered.length,
  chapters: ordered.reduce((a, b) => a + b.chapters.length, 0),
  verses: ordered.reduce((a, b) => a + b.chapters.reduce((x, c) => x + c.length, 0), 0),
}
for (const k of Object.keys(EXPECTED)) {
  if (counts[k] !== EXPECTED[k]) errors.push(`contagem de ${k}: ${counts[k]} (esperado ${EXPECTED[k]})`)
}

for (const w of warnings) console.warn('aviso:', w)
if (errors.length) {
  for (const e of errors) console.error('erro:', e)
  process.exit(1)
}

const out = {
  edition: {
    id: `blivre-${variant}`,
    name: 'Bíblia Livre',
    abbr: 'BLIVRE',
    variant: variant === 'tr' ? 'Novo Testamento: Textus Receptus' : 'Novo Testamento: Nestle 1904',
    release: '2018.2.0',
    license: 'Creative Commons Atribuição 3.0 Brasil',
    credit:
      'Bíblia Livre (BLIVRE), Copyright © Diego Santos, Mario Sérgio e Marco Teles, ' +
      'http://sites.google.com/site/biblialivre/ - fevereiro de 2018. ' +
      'Licença Creative Commons Atribuição 3.0 Brasil (http://creativecommons.org/licenses/by/3.0/br/).',
  },
  counts,
  books: ordered,
}
const json = JSON.stringify(out)
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, json)
const sha = createHash('sha256').update(json).digest('hex').slice(0, 16)
console.log(`ok: ${counts.books} livros, ${counts.chapters} capítulos, ${counts.verses} versículos → ${outFile} (sha256 ${sha}, ${(json.length / 1e6).toFixed(2)} MB, ${warnings.length} avisos)`)
