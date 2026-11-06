import { narrationOf, screensOf, type Screen } from './assemble.ts'
import { hashText, splitSentences, toSpeech } from './speech.ts'
import type { Area, Edition } from './types.ts'

export type ChapterKind = Screen['kind']
export type Line = { id: string; chapter: number; text: string; speech: string; pause: number }
export type Chapter = { index: number; kind: ChapterKind; key: string | null; area: Area | null; label: string; first: number; count: number }
export type Program = { key: string; date: string; voice: string; chapters: Chapter[]; lines: Line[] }

export const PAUSE = { sentence: 260, chapter: 700, opening: 520 }

const LABEL: Record<ChapterKind, string> = { opening: 'Abertura', item: 'Notícia', market: 'Mercado', closing: 'Fechamento' }

export function buildProgram(e: Edition, weather: string, voice: string): Program {
  const screens = screensOf(e, weather)
  const chapters: Chapter[] = []
  const lines: Line[] = []
  screens.forEach((s, index) => {
    const text = narrationOf(s, e).trim()
    const parts = splitSentences(text)
    const first = lines.length
    parts.forEach((t, i) => {
      const speech = toSpeech(t)
      if (!/[\p{L}\d]/u.test(speech)) return
      const last = i === parts.length - 1
      lines.push({
        id: hashText(`${voice}|${speech}`),
        chapter: index,
        text: t,
        speech,
        pause: last ? (s.kind === 'opening' ? PAUSE.opening : PAUSE.chapter) : PAUSE.sentence,
      })
    })
    chapters.push({
      index,
      kind: s.kind,
      key: s.kind === 'item' ? s.item.key : null,
      area: s.kind === 'item' ? s.item.area : null,
      label: s.kind === 'item' ? s.item.title : LABEL[s.kind],
      first,
      count: lines.length - first,
    })
  })
  if (lines.length) lines[lines.length - 1].pause = 0
  return { key: hashText(`${e.date}|${e.createdAt}|${voice}|${lines.map((l) => l.id).join(',')}`), date: e.date, voice, chapters, lines }
}

export function chapterOfLine(p: Program, line: number): number {
  return p.lines[Math.max(0, Math.min(line, p.lines.length - 1))]?.chapter ?? 0
}

export function firstLineOf(p: Program, chapter: number): number {
  for (let c = Math.max(0, chapter); c < p.chapters.length; c++) if (p.chapters[c].count) return p.chapters[c].first
  return p.lines.length
}
