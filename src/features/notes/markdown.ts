
export type JSONMark = { type: string; attrs?: Record<string, unknown> }
export type JSONNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: JSONNode[]
  text?: string
  marks?: JSONMark[]
}

export type MarkdownOptions = {
  title?: string
  imageSrc?: (attrs: Record<string, unknown>) => string | null
}

export function docToMarkdown(doc: JSONNode, opts: MarkdownOptions = {}): string {
  const body = blocks(doc.content ?? [], opts)
  const title = opts.title?.trim()
  const out = title ? `# ${escapeText(title)}\n\n${body}` : body
  return out.trim() ? out.replace(/\s+$/, '') + '\n' : ''
}

function blocks(nodes: JSONNode[], opts: MarkdownOptions): string {
  const out: string[] = []
  for (const n of nodes) {
    const s = block(n, opts)
    if (s !== '') out.push(s)
  }
  return out.join('\n\n')
}

function block(n: JSONNode, opts: MarkdownOptions): string {
  switch (n.type) {
    case 'paragraph':
      return escapeLineStart(inline(n.content))
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level) || 1))
      const text = inline(n.content)
      return text ? `${'#'.repeat(level)} ${text}` : ''
    }
    case 'blockquote': {
      const inner = blocks(n.content ?? [], opts)
      return inner ? inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') : ''
    }
    case 'codeBlock': {
      const text = (n.content ?? []).map((t) => t.text ?? '').join('')
      let fence = '```'
      while (text.includes(fence)) fence += '`'
      const lang = typeof n.attrs?.language === 'string' ? n.attrs.language.replace(/[^\w+#.-]/g, '') : ''
      return `${fence}${lang}\n${text}\n${fence}`
    }
    case 'horizontalRule':
      return '---'
    case 'bulletList':
      return (n.content ?? []).map((li) => listItem(li, '- ', 2, opts)).join('\n')
    case 'orderedList': {
      const start = Number(n.attrs?.start) || 1
      return (n.content ?? [])
        .map((li, i) => {
          const marker = `${start + i}. `
          return listItem(li, marker, marker.length, opts)
        })
        .join('\n')
    }
    case 'taskList':
      return (n.content ?? []).map((li) => listItem(li, `- [${li.attrs?.checked ? 'x' : ' '}] `, 2, opts)).join('\n')
    case 'image': {
      const attrs = n.attrs ?? {}
      const src = opts.imageSrc ? opts.imageSrc(attrs) : defaultImageSrc(attrs)
      if (!src) return ''
      const alt = typeof attrs.alt === 'string' ? attrs.alt.replace(/[[\]\n]/g, ' ').trim() : ''
      return `![${alt}](${encodeDest(src)})`
    }
    default:
      if (n.content?.length) return n.content.some(isBlock) ? blocks(n.content, opts) : inline(n.content)
      return n.text ? escapeText(n.text) : ''
  }
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'horizontalRule', 'bulletList', 'orderedList', 'taskList', 'image'])
const isBlock = (n: JSONNode) => BLOCK_TYPES.has(n.type)

function defaultImageSrc(attrs: Record<string, unknown>): string | null {
  if (typeof attrs.assetId === 'string' && attrs.assetId) return `asset:${attrs.assetId}`
  if (typeof attrs.src === 'string' && /^https?:\/\//i.test(attrs.src)) return attrs.src
  return null
}

function listItem(li: JSONNode, marker: string, indentWidth: number, opts: MarkdownOptions): string {
  const parts: string[] = []
  const kids = li.content ?? []
  kids.forEach((child, i) => {
    const s = block(child, opts)
    if (s === '' && i > 0) return
    const isList = child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList'
    if (parts.length) parts.push(isList ? '\n' : '\n\n')
    parts.push(s)
  })
  const inner = parts.join('')
  const pad = ' '.repeat(indentWidth)
  return inner
    .split('\n')
    .map((line, i) => (i === 0 ? marker + line : line ? pad + line : ''))
    .join('\n')
    .replace(/\s+$/, '')
}

type Mark = { type: 'link' | 'bold' | 'italic' | 'strike'; href?: string }
const RANK: Record<Mark['type'], number> = { link: 0, bold: 1, italic: 2, strike: 3 }

function marksOf(n: JSONNode): Mark[] {
  const out: Mark[] = []
  for (const m of n.marks ?? []) {
    if (m.type === 'link') {
      const href = typeof m.attrs?.href === 'string' ? m.attrs.href : ''
      if (href) out.push({ type: 'link', href })
    } else if (m.type === 'bold' || m.type === 'italic' || m.type === 'strike') out.push({ type: m.type })
  }
  return out.sort((a, b) => RANK[a.type] - RANK[b.type])
}
const hasCode = (n: JSONNode) => !!n.marks?.some((m) => m.type === 'code')
const sameMark = (a: Mark, b: Mark) => a.type === b.type && a.href === b.href
const markKey = (n: JSONNode) => (hasCode(n) ? 'c|' : '') + marksOf(n).map((m) => m.type + (m.href ?? '')).join('|')

function coalesce(nodes: JSONNode[]): JSONNode[] {
  const out: JSONNode[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (n.type === 'text' && prev?.type === 'text' && markKey(prev) === markKey(n)) {
      out[out.length - 1] = { ...prev, text: (prev.text ?? '') + (n.text ?? '') }
    } else out.push(n)
  }
  return out
}

const OPEN: Record<Mark['type'], string> = { link: '[', bold: '**', italic: '*', strike: '~~' }
const closeDelim = (m: Mark) => (m.type === 'link' ? `](${encodeDest(m.href ?? '')})` : OPEN[m.type])

function encodeDest(href: string): string {
  return href.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function codeSpan(text: string): string {
  let ticks = '`'
  while (text.includes(ticks)) ticks += '`'
  const pad = text.startsWith('`') || text.endsWith('`') || ticks.length > 1 ? ' ' : ''
  return `${ticks}${pad}${text}${pad}${ticks}`
}

function inline(nodes: JSONNode[] = []): string {
  let out = ''
  const stack: Mark[] = []
  let trail = ''
  const close = (to: number) => {
    while (stack.length > to) out += closeDelim(stack.pop()!)
  }
  for (const n of coalesce(nodes)) {
    if (n.type === 'hardBreak') {
      close(0)
      out += '\\\n'
      trail = ''
      continue
    }
    if (n.type !== 'text' || !n.text) continue
    const code = hasCode(n)
    const marks = marksOf(n)
    let lead = ''
    let core = n.text
    let tail = ''
    if (!code) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(n.text)!
      ;[lead, core, tail] = [m[1], m[2], m[3]]
    }
    if (!core) {
      trail += n.text
      continue
    }
    let keep = 0
    while (keep < stack.length && keep < marks.length && sameMark(stack[keep], marks[keep])) keep++
    close(keep)
    out += trail + lead
    trail = ''
    for (const m of marks.slice(keep)) {
      out += OPEN[m.type]
      stack.push(m)
    }
    out += code ? codeSpan(core) : escapeText(core)
    trail = tail
  }
  close(0)
  return out + trail
}

export function escapeText(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if ('\\`*[]<~'.includes(ch)) out += '\\' + ch
    else if (ch === '_') {
      const word = /[\p{L}\p{N}]/u
      out += word.test(s[i - 1] ?? '') && word.test(s[i + 1] ?? '') ? '_' : '\\_'
    } else out += ch
  }
  return out
}

function escapeLineStart(s: string): string {
  if (/^(#{1,6}(\s|$)|>|[-+=](\s|$)|-{3,}|={3,})/.test(s)) return '\\' + s
  const m = /^(\d{1,9})([.)])(\s|$)/.exec(s)
  if (m) return m[1] + '\\' + s.slice(m[1].length)
  return s
}

export function docToPlainText(doc: JSONNode): string {
  const lines: string[] = []
  const walk = (n: JSONNode) => {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
        lines.push(inlineText(n.content))
        return
      case 'codeBlock':
        lines.push((n.content ?? []).map((t) => t.text ?? '').join(''))
        return
      case 'horizontalRule':
      case 'image':
        return
      default:
        if (n.text) lines.push(n.text)
        for (const c of n.content ?? []) walk(c)
    }
  }
  for (const c of doc.content ?? []) walk(c)
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function inlineText(nodes: JSONNode[] = []): string {
  return nodes.map((n) => (n.type === 'hardBreak' ? '\n' : (n.text ?? ''))).join('')
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length
}
