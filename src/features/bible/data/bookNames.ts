export const BOOK_NAMES = [
  'Gênesis', 'Êxodo', 'Levítico', 'Números', 'Deuteronômio', 'Josué', 'Juízes', 'Rute', '1 Samuel', '2 Samuel',
  '1 Reis', '2 Reis', '1 Crônicas', '2 Crônicas', 'Esdras', 'Neemias', 'Ester', 'Jó', 'Salmos', 'Provérbios',
  'Eclesiastes', 'Cânticos', 'Isaías', 'Jeremias', 'Lamentações', 'Ezequiel', 'Daniel', 'Oseias', 'Joel', 'Amós',
  'Obadias', 'Jonas', 'Miqueias', 'Naum', 'Habacuque', 'Sofonias', 'Ageu', 'Zacarias', 'Malaquias',
  'Mateus', 'Marcos', 'Lucas', 'João', 'Atos', 'Romanos', '1 Coríntios', '2 Coríntios', 'Gálatas', 'Efésios',
  'Filipenses', 'Colossenses', '1 Tessalonicenses', '2 Tessalonicenses', '1 Timóteo', '2 Timóteo', 'Tito', 'Filemom',
  'Hebreus', 'Tiago', '1 Pedro', '2 Pedro', '1 João', '2 João', '3 João', 'Judas', 'Apocalipse',
]

export function readingStatus(): { label: string; goal: string; doneToday: boolean } | null {
  try {
    const pos = JSON.parse(localStorage.getItem('ps.bible.v2') ?? 'null')
    const daily = JSON.parse(localStorage.getItem('ps.bible.daily.v1') ?? 'null')
    const ref = pos?.ref
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const goal = daily?.goal ?? { unit: 'chapters', amount: 1 }
    const unit = goal.unit === 'verses' ? (goal.amount === 1 ? 'versículo' : 'versículos') : goal.amount === 1 ? 'capítulo' : 'capítulos'
    const doneToday = !!daily?.log?.some((l: { date: string; extra?: boolean }) => l.date === today && !l.extra)
    const cursor = daily?.cursor ?? ref
    const at = cursor ?? { book: 0, chapter: 0, verse: 0 }
    return {
      label: `${BOOK_NAMES[at.book] ?? 'Gênesis'} ${at.chapter + 1}${at.verse ? `:${at.verse + 1}` : ''}`,
      goal: `Meta: ${goal.amount} ${unit} por dia`,
      doneToday,
    }
  } catch {
    return null
  }
}
