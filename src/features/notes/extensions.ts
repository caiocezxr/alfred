import { Extension, ReactNodeViewRenderer, type AnyExtension } from '@tiptap/react'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { ImageView } from './ImageView'
import { SlashCommand, type SlashStore } from './slash'

export const AssetImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-asset-id'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.assetId ? { 'data-asset-id': attrs.assetId } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'img[data-asset-id]' }]
  },
  addInputRules() {
    return []
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
}).configure({ inline: false, allowBase64: false })

const CodeLanguage = Extension.create({
  name: 'notesCodeLanguage',
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const decos: Decoration[] = []
      doc.descendants((node, pos) => {
        if (node.type.name === 'codeBlock') {
          const lang = typeof node.attrs.language === 'string' ? node.attrs.language : ''
          if (lang) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-language': lang }))
          return false
        }
        return !node.isTextblock
      })
      return DecorationSet.create(doc, decos)
    }
    return [
      new Plugin<DecorationSet>({
        key: new PluginKey('notesCodeLanguage'),
        state: {
          init: (_, s) => build(s.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})

const NotesKeys = Extension.create<{ onLink: () => void; onExitTop: () => void }>({
  name: 'notesKeys',
  addOptions() {
    return { onLink: () => {}, onExitTop: () => {} }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-k': () => {
        this.options.onLink()
        return true
      },
      ArrowUp: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty || selection.$from.index(0) !== 0) return false
        if (!editor.view.endOfTextblock('up')) return false
        this.options.onExitTop()
        return true
      },
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        if (!editor.isEmpty || !selection.empty || selection.from > 1) return false
        this.options.onExitTop()
        return true
      },
    }
  },
})

export type EditorHooks = {
  slash: SlashStore
  onPickImage: () => void
  onLink: () => void
  onExitTop: () => void
}

export function buildExtensions(h: EditorHooks): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      underline: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
      dropcursor: { color: 'var(--accent)', width: 2 },
      codeBlock: { enableTabIndentation: true, tabSize: 2, HTMLAttributes: { spellcheck: 'false' } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: true,
      placeholder: ({ editor, node, pos }) => {
        if (node.type.name === 'heading') return `Título ${node.attrs.level}`
        if (node.type.name !== 'paragraph') return ''
        const parent = editor.state.doc.resolve(pos).parent.type.name
        if (parent === 'listItem' || parent === 'taskItem') return 'Item'
        if (parent === 'blockquote') return 'Citação'
        return editor.isEmpty ? 'Comece a escrever, ou digite / para inserir um bloco…' : 'Digite / para inserir um bloco'
      },
    }),
    AssetImage,
    CodeLanguage,
    SlashCommand.configure({ store: h.slash, onPickImage: h.onPickImage }),
    NotesKeys.configure({ onLink: h.onLink, onExitTop: h.onExitTop }),
  ]
}
