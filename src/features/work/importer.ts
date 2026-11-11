import { parseDateWord, matchCompany } from './logic.ts'
import type { Company, Kind, Priority, WorkItem } from './types.ts'

/** Uma linha da planilha virando chamado, ainda em revisão. */
export type Draft = {
  key: string
  on: boolean
  title: string
  ticket: string | null
  companyId: string
  companyRaw: string | null
  priority: Priority
  dueDate: string | null
  kind: Kind
  notes: string
  dupe: string | null
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const EMPTY = new Set(['', '-', '—', '–', 'n/a', 'na', 'null', 'none'])
const cell = (s: string | undefined) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return EMPTY.has(t.toLowerCase()) ? '' : t
}

/* ───── texto: TSV (colado do Excel/Sheets), CSV ou ponto e vírgula ───── */

export function parseDelimited(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const sample = lines.slice(0, 6).join('\n')
  const count = (ch: string) => sample.split(ch).length - 1
  const sep = count('\t') >= Math.max(1, lines.slice(0, 6).filter(Boolean).length - 1) ? '\t' : count(';') > count(',') ? ';' : count(',') ? ',' : count('|') >= 2 ? '|' : '\t'
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  const src = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"' && cur === '') quoted = true
    else if (c === sep) {
      row.push(cur)
      cur = ''
    } else if (c === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += c
  }
  row.push(cur)
  rows.push(row)
  return rows
    .map((r) => (sep === '|' ? r.map((x) => x.trim()).filter((x, i, a) => !(x === '' && (i === 0 || i === a.length - 1))) : r))
    .filter((r) => r.some((x) => cell(x)) && !r.every((x) => /^[\s:|-]*$/.test(x)))
}

/* ───── xlsx sem dependência: zip + XML ───── */

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf)
  const u8 = new Uint8Array(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('arquivo não parece um .xlsx')
  const n = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out = new Map<string, Uint8Array>()
  const dec = new TextDecoder()
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extra = v.getUint16(p + 30, true)
    const comment = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extra + comment
    if (!/^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) continue
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = u8.subarray(start, start + size)
    if (method === 0) out.set(name, raw)
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()))
    }
  }
  return out
}

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+/g, '')
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const excelDate = (serial: number) => {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000))
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

export async function readXlsx(file: File): Promise<string[][]> {
  const files = await unzip(await file.arrayBuffer())
  const dec = new TextDecoder()
  const xml = (name: string) => {
    const b = files.get(name)
    return b ? new DOMParser().parseFromString(dec.decode(b), 'application/xml') : null
  }
  const shared = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? [])].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''))
  const sheets = [...files.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  if (!sheets.length) throw new Error('a planilha está vazia')
  const doc = xml(sheets[0])!
  const rows: string[][] = []
  for (const r of doc.getElementsByTagName('row')) {
    const row: string[] = []
    for (const c of r.getElementsByTagName('c')) {
      const t = c.getAttribute('t')
      const val = c.getElementsByTagName('v')[0]?.textContent ?? ''
      let text = t === 's' ? (shared[Number(val)] ?? '') : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : val
      // números de 5 dígitos entre 1990 e 2100 em série do Excel são datas
      const s = c.getAttribute('s')
      if (!t && s && /^\d{5}(\.\d+)?$/.test(val) && Number(val) > 32874 && Number(val) < 73051) text = excelDate(Number(val))
      row[colIndex(c.getAttribute('r') ?? 'A1')] = text
    }
    rows.push(Array.from(row, (x) => x ?? ''))
  }
  return rows.filter((r) => r.some((x) => cell(x)))
}

/* ───── colunas ───── */

type Field = 'ticket' | 'title' | 'company' | 'due' | 'priority' | 'kind' | 'notes' | 'status'

const HEAD: [Field, RegExp][] = [
  ['ticket', /^(n[ºo°.]*\s*)?(chamado|ticket|ocorrencia|protocolo|codigo|cod|id|numero|n[ºo°]|#|os|demanda|card)\b|^(n[ºo°.]?|num)(?=\s|$)/],
  ['title', /(assunto|titulo|descricao|tarefa|atividade|resumo|problema|demanda|solicitacao|o que|item|pendencia)/],
  ['company', /(cliente|empresa|loja|conta|parceiro|base|org)/],
  ['due', /(prazo|data|vencimento|entrega|deadline|ate quando|previsao)/],
  ['priority', /(prioridade|urgencia|criticidade|severidade|prio)/],
  ['kind', /^(tipo|categoria|natureza)/],
  ['status', /(status|situacao|etapa|andamento)/],
  ['notes', /(obs|observacao|comentario|detalhe|nota|anotacao)/],
]

function mapHeader(head: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {}
  head.forEach((h, i) => {
    const f = fold(h)
    if (!f) return
    for (const [field, re] of HEAD) {
      if (map[field] === undefined && re.test(f)) {
        // "nº chamado" é código, "descrição do chamado" é título
        if (field === 'ticket' && /(descricao|assunto|titulo)/.test(f)) continue
        map[field] = i
        break
      }
    }
  })
  return map
}

const looksTicket = (s: string) => /^#?[A-Z]{0,4}-?\d{2,9}$/i.test(s.trim())

function guessHeaderless(rows: string[][]): Partial<Record<Field, number>> {
  const width = Math.max(...rows.map((r) => r.length))
  const map: Partial<Record<Field, number>> = {}
  let best = -1
  let bestLen = 0
  for (let i = 0; i < width; i++) {
    const vals = rows.map((r) => cell(r[i])).filter(Boolean)
    if (!vals.length) continue
    if (map.ticket === undefined && vals.every(looksTicket)) {
      map.ticket = i
      continue
    }
    const avg = vals.reduce((a, v) => a + v.length, 0) / vals.length
    if (avg > bestLen) {
      bestLen = avg
      best = i
    }
  }
  if (best >= 0) map.title = best
  return map
}

const PRIO: [RegExp, Priority][] = [
  [/(urgente|critic|bloque|p0|altissim|imediat)/, 'urgente'],
  [/(alta|alto|high|p1|importante)/, 'alta'],
]

const KIND: [RegExp, Kind][] = [
  [/(bug|erro|falha|defeito|incidente|nao funciona|quebr)/, 'bug'],
  [/(feature|nova funcionalidade|novo|criar|implementar)/, 'feature'],
  [/(melhoria|ajust|otimiz|refator)/, 'melhoria'],
  [/(pendencia|pendente|validar|conferir|cobrar)/, 'pendencia'],
]

function similar(a: string, b: string) {
  const x = fold(a).replace(/[^a-z0-9]/g, '')
  const y = fold(b).replace(/[^a-z0-9]/g, '')
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.includes(y) || y.includes(x)) return 0.9
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)] as number[])
  for (let j = 1; j <= y.length; j++) dp[0][j] = j
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
  return 1 - dp[x.length][y.length] / Math.max(x.length, y.length)
}

export function companyFor(raw: string, companies: Company[], fallback: string): string {
  if (!raw) return fallback
  const exact = matchCompany(raw, companies)
  if (exact) return exact.id
  let best: Company | null = null
  let score = 0
  for (const c of companies) {
    const s = Math.max(similar(raw, c.name), similar(raw, c.id))
    if (s > score) {
      score = s
      best = c
    }
  }
  return best && score >= 0.72 ? best.id : fallback
}

function dueOf(raw: string, today: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const first = t.split(/\s+/)[0].replace(/[.-]/g, '/')
  return parseDateWord(first, today) ?? parseDateWord(fold(t).replace(/\s+/g, '-'), today)
}

/** Linhas cruas viram rascunhos. A primeira linha é cabeçalho quando reconhecemos colunas nela. */
export function toDrafts(rows: string[][], ctx: { companies: Company[]; fallback: string; today: string; items: WorkItem[] }): { drafts: Draft[]; columns: string[] } {
  const clean = rows.map((r) => r.map((x) => x ?? '')).filter((r) => r.some((x) => cell(x)))
  if (!clean.length) return { drafts: [], columns: [] }
  let head = clean[0]
  let body = clean.slice(1)
  // leitor de imagem às vezes quebra "Nº Chamado" em duas colunas
  const width = Math.max(...body.map((r) => r.length), 0)
  const split = head.findIndex((h, i) => i < head.length - 1 && /^n[ºo°.]?$/.test(fold(h)))
  if (head.length === width + 1 && split >= 0) head = [...head.slice(0, split), `${head[split]} ${head[split + 1]}`, ...head.slice(split + 2)]
  let map = mapHeader(head)
  if (map.title === undefined && map.ticket === undefined) {
    map = guessHeaderless(clean)
    body = clean
    head = []
  }
  if (map.title === undefined) {
    const free = head.map((_, i) => i).filter((i) => !Object.values(map).includes(i))
    const longest = free.sort((a, b) => avgLen(body, b) - avgLen(body, a))[0]
    if (longest !== undefined) map.title = longest
  }
  const open = new Map(ctx.items.filter((i) => i.ticket).map((i) => [fold(i.ticket!).replace(/^#/, ''), i]))
  const seen = new Set<string>()
  const drafts: Draft[] = []
  body.forEach((r0, n) => {
    let r = r0
    // linha curta com código vazio: o leitor engoliu a primeira célula
    if (head.length && r.length === head.length - 1 && map.ticket === 0 && !looksTicket(cell(r[0]))) r = ['', ...r]
    const get = (f: Field) => (map[f] === undefined ? '' : cell(r[map[f]!]))
    const ticket = get('ticket').replace(/^#/, '') || null
    let title = get('title')
    if (!title && !ticket) return
    if (!title) title = `Chamado ${ticket}`
    const companyRaw = get('company') || null
    const prioText = fold(get('priority'))
    const kindText = fold(`${get('kind')} ${title}`)
    const status = get('status')
    const extra = head
      .map((h, i) => [h, cell(r[i])] as const)
      .filter(([, v], i) => v && !Object.values(map).includes(i))
      .map(([h, v]) => (h ? `${h}: ${v}` : v))
    const notes = [get('notes'), status && `Status na planilha: ${status}`, ...extra].filter(Boolean).join('\n')
    const tk = ticket ? fold(ticket) : null
    const dupe = tk ? (open.get(tk) ? `já está no quadro (${open.get(tk)!.title.slice(0, 40)})` : seen.has(tk) ? 'repetido na planilha' : null) : null
    if (tk) seen.add(tk)
    drafts.push({
      key: `${n}-${ticket ?? title}`,
      on: !dupe,
      title: title.slice(0, 200),
      ticket,
      companyId: companyFor(companyRaw ?? '', ctx.companies, ctx.fallback),
      companyRaw,
      priority: PRIO.find(([re]) => re.test(prioText))?.[1] ?? 'normal',
      dueDate: dueOf(get('due'), ctx.today),
      kind: KIND.find(([re]) => re.test(kindText))?.[1] ?? 'chamado',
      notes,
      dupe,
    })
  })
  return { drafts, columns: head }
}

const avgLen = (rows: string[][], i: number) => rows.reduce((a, r) => a + cell(r[i]).length, 0) / Math.max(1, rows.length)
