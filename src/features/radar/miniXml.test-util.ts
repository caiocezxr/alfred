import type { XEl } from './feed.ts'

const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]
  })

class El implements XEl {
  readonly localName: string
  readonly children: El[] = []
  readonly parts: (string | El)[] = []
  private attrs: Record<string, string>
  constructor(name: string, attrs: Record<string, string>) {
    const i = name.indexOf(':')
    this.localName = i >= 0 ? name.slice(i + 1) : name
    this.attrs = attrs
  }
  get textContent(): string {
    return this.parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join('')
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null
  }
}

function tagEnd(src: string, from: number): number {
  let q: string | null = null
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '>') return i
  }
  throw new Error('XML: tag sem fim')
}

export function parseXml(src: string): XEl {
  const root = new El('#root', {})
  const stack: El[] = [root]
  let i = 0
  while (i < src.length) {
    const top = stack[stack.length - 1]
    if (src.startsWith('<?', i)) i = src.indexOf('?>', i) + 2
    else if (src.startsWith('<!--', i)) i = src.indexOf('-->', i) + 3
    else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i)
      top.parts.push(src.slice(i + 9, end))
      i = end + 3
    } else if (src.startsWith('<!', i)) i = tagEnd(src, i) + 1
    else if (src[i] === '<') {
      const end = tagEnd(src, i)
      const tag = src.slice(i + 1, end).trim()
      i = end + 1
      if (tag.startsWith('/')) {
        stack.pop()
        continue
      }
      const self = tag.endsWith('/')
      const body = self ? tag.slice(0, -1) : tag
      const name = body.match(/^[^\s/]+/)![0]
      const attrs: Record<string, string> = {}
      for (const m of body.slice(name.length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decodeXml(m[2] ?? m[3] ?? '')
      const el = new El(name, attrs)
      top.children.push(el)
      top.parts.push(el)
      if (!self) stack.push(el)
    } else {
      const next = src.indexOf('<', i)
      top.parts.push(decodeXml(src.slice(i, next === -1 ? undefined : next)))
      i = next === -1 ? src.length : next
    }
  }
  const doc = root.children[0]
  if (!doc) throw new Error('XML vazio')
  return doc
}
