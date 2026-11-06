import { Extension, type Editor, type Range } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { exitSuggestion } from '@tiptap/suggestion'
import type { IconName } from './icons'
import { normalize } from './text'

export type SlashItem = {
  id: string
  label: string
  hint: string
  icon: IconName
  keywords: string
  run: (editor: Editor, range: Range) => void
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: 'Texto', hint: '', icon: 'text', keywords: 'paragrafo texto normal p', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: 'h1', label: 'Título 1', hint: '#', icon: 'h1', keywords: 'titulo heading h1 grande', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Título 2', hint: '##', icon: 'h2', keywords: 'titulo heading h2 subtitulo', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Título 3', hint: '###', icon: 'h3', keywords: 'titulo heading h3 secao', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { id: 'bullet', label: 'Lista', hint: '-', icon: 'bullet', keywords: 'lista marcadores bullet ul topicos', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: 'ordered', label: 'Lista numerada', hint: '1.', icon: 'ordered', keywords: 'lista numerada ordenada ol numeros', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: 'task', label: 'Checklist', hint: '[ ]', icon: 'task', keywords: 'checklist tarefa todo afazer caixa check', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: 'quote', label: 'Citação', hint: '>', icon: 'quote', keywords: 'citacao quote destaque', run: (e, r) => e.chain().focus().deleteRange(r).setBlockquote().run() },
  { id: 'code', label: 'Bloco de código', hint: '```', icon: 'codeblock', keywords: 'codigo code bloco programacao', run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock().run() },
  { id: 'divider', label: 'Separador', hint: '---', icon: 'divider', keywords: 'separador divisor linha hr', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { id: 'image', label: 'Imagem', hint: 'colar ou arrastar', icon: 'image', keywords: 'imagem foto figura png jpg', run: () => {} },
]

export function filterSlash(query: string): SlashItem[] {
  const q = normalize(query.trim())
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.map((it) => {
    const label = normalize(it.label)
    const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : it.keywords.split(' ').some((k) => k.startsWith(q)) ? 2 : -1
    return { it, score }
  })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.it)
}

export type SlashState = {
  open: boolean
  items: SlashItem[]
  index: number
  rect: DOMRect | null
  pick: ((item: SlashItem) => void) | null
}

export function createSlashStore() {
  let state: SlashState = { open: false, items: [], index: 0, rect: null, pick: null }
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch: Partial<SlashState>) {
      state = { ...state, ...patch }
      for (const l of listeners) l()
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}
export type SlashStore = ReturnType<typeof createSlashStore>

const slashKey = new PluginKey('notesSlash')

export const SlashCommand = Extension.create<{ store: SlashStore | null; onPickImage: () => void }>({
  name: 'notesSlash',
  addOptions() {
    return { store: null, onPickImage: () => {} }
  },
  addProseMirrorPlugins() {
    const store = this.options.store
    const onPickImage = () => this.options.onPickImage()
    if (!store) return []
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        allowSpaces: false,
        items: ({ query }) => filterSlash(query),
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          return $from.parent.type.name !== 'codeBlock' && !$from.parent.type.spec.code
        },
        command: ({ editor, range, props }) => {
          if (props.id === 'image') {
            editor.chain().focus().deleteRange(range).run()
            onPickImage()
          } else props.run(editor, range)
        },
        render: () => ({
          onStart: (p) => store.set({ open: p.items.length > 0, items: p.items, index: 0, rect: p.clientRect?.() ?? null, pick: (it) => p.command(it) }),
          onUpdate: (p) =>
            store.set({
              open: p.items.length > 0,
              items: p.items,
              index: Math.min(store.get().index, Math.max(0, p.items.length - 1)),
              rect: p.clientRect?.() ?? null,
              pick: (it) => p.command(it),
            }),
          onKeyDown: ({ event, view }) => {
            const s = store.get()
            if (!s.open) return false
            const n = s.items.length
            if (event.key === 'ArrowDown') {
              store.set({ index: (s.index + 1) % n })
              return true
            }
            if (event.key === 'ArrowUp') {
              store.set({ index: (s.index - 1 + n) % n })
              return true
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const it = s.items[s.index]
              if (it && s.pick) s.pick(it)
              return true
            }
            if (event.key === 'Escape') {
              store.set({ open: false })
              exitSuggestion(view, slashKey)
              return true
            }
            return false
          },
          onExit: () => store.set({ open: false, pick: null }),
        }),
      }),
    ]
  },
})
