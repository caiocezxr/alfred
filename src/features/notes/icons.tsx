import type { ReactNode } from 'react'

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

const I = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg {...base} width={size} height={size}>
    {children}
  </svg>
)

export type IconName =
  | 'page' | 'pages' | 'chevron' | 'plus' | 'more' | 'search' | 'trash' | 'archive' | 'restore' | 'move' | 'copy'
  | 'export' | 'link' | 'bold' | 'italic' | 'strike' | 'code' | 'external' | 'edit' | 'close' | 'text' | 'h1' | 'h2'
  | 'h3' | 'bullet' | 'ordered' | 'task' | 'quote' | 'codeblock' | 'divider' | 'image' | 'sort' | 'back' | 'type'
  | 'check' | 'alert' | 'subpage'

export function Icon({ name, size }: { name: IconName; size?: number }) {
  switch (name) {
    case 'page':
      return <I size={size}><path d="M4.5 2.5h4.6L12 5.4v7.6a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" /><path d="M9 2.6V5.5h2.9M6 8.5h4M6 10.8h2.6" /></I>
    case 'pages':
      return <I size={size}><path d="M5.5 2.5h4.2L12.5 5.3v7.2a.5.5 0 0 1-.5.5H5.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" /><path d="M3 5v8.2c0 .5.3.8.8.8H10" /></I>
    case 'subpage':
      return <I size={size}><path d="M3.5 3v5.5c0 .8.7 1.5 1.5 1.5h7.5" /><path d="M10 7.5l2.5 2.5-2.5 2.5" /></I>
    case 'chevron':
      return <I size={size ?? 12}><path d="M6 4l4 4-4 4" /></I>
    case 'plus':
      return <I size={size}><path d="M8 3.5v9M3.5 8h9" /></I>
    case 'more':
      return (
        <svg {...base} width={size ?? 16} height={size ?? 16} fill="currentColor" stroke="none">
          <circle cx="3.6" cy="8" r="1.15" />
          <circle cx="8" cy="8" r="1.15" />
          <circle cx="12.4" cy="8" r="1.15" />
        </svg>
      )
    case 'search':
      return <I size={size}><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2l3.3 3.3" /></I>
    case 'trash':
      return <I size={size}><path d="M3 4.5h10M6.4 4.5V3h3.2v1.5M4.4 4.5l.6 8.4c0 .3.3.6.6.6h4.8c.3 0 .6-.3.6-.6l.6-8.4M6.8 7v4M9.2 7v4" /></I>
    case 'archive':
      return <I size={size}><rect x="2.5" y="3" width="11" height="3" rx=".6" /><path d="M3.5 6v6.5c0 .3.2.5.5.5h8c.3 0 .5-.2.5-.5V6M6.5 8.5h3" /></I>
    case 'restore':
      return <I size={size}><path d="M3 8a5 5 0 1 0 1.5-3.6" /><path d="M3.2 2.6v2.2h2.2" /></I>
    case 'move':
      return <I size={size}><path d="M2.5 5V3.6c0-.3.3-.6.6-.6h3l1.4 1.5h5.4c.3 0 .6.3.6.6V12c0 .3-.3.6-.6.6H3.1a.6.6 0 0 1-.6-.6V9" /><path d="M2 7.5h5.5M5.5 5.5l2 2-2 2" /></I>
    case 'copy':
      return <I size={size}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></I>
    case 'export':
      return <I size={size}><path d="M8 2.5v7.5M5 5.3l3-2.8 3 2.8M3 9.5v3c0 .3.2.5.5.5h9c.3 0 .5-.2.5-.5v-3" /></I>
    case 'link':
      return <I size={size}><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7" /></I>
    case 'bold':
      return <I size={size}><path d="M4.8 3h3.9a2.5 2.5 0 0 1 0 5H4.8zM4.8 8h4.5a2.5 2.5 0 0 1 0 5H4.8z" strokeWidth="1.7" /></I>
    case 'italic':
      return <I size={size}><path d="M10.5 3H7M9 13H5.5M9 3L7 13" strokeWidth="1.5" /></I>
    case 'strike':
      return <I size={size}><path d="M2.5 8h11M11 4.8C10.5 3.7 9.4 3 7.9 3 6.2 3 5 3.9 5 5.2c0 .6.2 1.1.7 1.5M5 11c.4 1.2 1.5 2 3 2 1.9 0 3.1-.9 3.1-2.3 0-.6-.2-1.1-.6-1.5" /></I>
    case 'code':
      return <I size={size}><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" /></I>
    case 'external':
      return <I size={size}><path d="M9.5 2.5h4v4M13.5 2.5L8 8M11.5 9.5v3.3c0 .4-.3.7-.7.7H3.2a.7.7 0 0 1-.7-.7V5.2c0-.4.3-.7.7-.7h3.3" /></I>
    case 'edit':
      return <I size={size}><path d="M10.6 2.9l2.5 2.5-7.3 7.3-3.1.6.6-3.1z" /></I>
    case 'close':
      return <I size={size}><path d="M4 4l8 8M12 4l-8 8" /></I>
    case 'text':
      return <I size={size}><path d="M3.5 3.5h9M8 3.5v9.5" /></I>
    case 'h1':
    case 'h2':
    case 'h3':
      return (
        <I size={size}>
          <path d="M2.5 3.5v9M8 3.5v9M2.5 8H8" />
          <text x="11.6" y="13" fontSize="6.5" fill="currentColor" stroke="none" fontFamily="var(--font-ui)" fontWeight="600" textAnchor="middle">
            {name.slice(1)}
          </text>
        </I>
      )
    case 'bullet':
      return <I size={size}><circle cx="3.5" cy="4.5" r=".9" fill="currentColor" /><circle cx="3.5" cy="11.5" r=".9" fill="currentColor" /><path d="M6.5 4.5h7M6.5 11.5h7" /></I>
    case 'ordered':
      return <I size={size}><path d="M2.6 3.2l1-.7V6M2.4 9.8c.2-.5.6-.8 1.1-.8.6 0 1 .4 1 .9 0 .9-2.1 1.6-2.1 3h2.2M7 4.5h6.5M7 11.5h6.5" /></I>
    case 'task':
      return <I size={size}><rect x="2.5" y="2.5" width="5" height="5" rx="1.3" /><path d="M3.8 5l.9.9 1.6-1.8M10 5h3.5M2.5 11.5h0M4.8 11.5h8.7" /></I>
    case 'quote':
      return <I size={size}><path d="M3 4v8M6.5 5.5h6.5M6.5 8h6.5M6.5 10.5h4" /></I>
    case 'codeblock':
      return <I size={size}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6.2 6.3L4.6 8l1.6 1.7M9.8 6.3L11.4 8l-1.6 1.7" /></I>
    case 'divider':
      return <I size={size}><path d="M2.5 8h11" /><path d="M5 4.5h6M5 11.5h6" opacity=".45" /></I>
    case 'image':
      return <I size={size}><rect x="2" y="3" width="12" height="10" rx="1.8" /><circle cx="5.8" cy="6.4" r="1.1" /><path d="M2.5 11.5l3.4-3 2.4 2 2.2-2.1 3 2.8" /></I>
    case 'sort':
      return <I size={size}><path d="M4.5 3v10M2.5 11l2 2 2-2M9 4.5h4.5M9 8h3.2M9 11.5h2" /></I>
    case 'back':
      return <I size={size}><path d="M10 3.5L5.5 8l4.5 4.5" /></I>
    case 'type':
      return <I size={size}><path d="M2.5 12.5L5.8 3.5h.4l3.3 9M3.7 9.5h4.6M11.5 7.5c.4-.6 1-.9 1.6-.9.9 0 1.4.6 1.4 1.5v4.4M14.5 10c-2.4 0-3.5.5-3.5 1.5 0 .7.5 1.1 1.2 1.1 1.2 0 2.3-.9 2.3-2.6" strokeWidth="1.25" /></I>
    case 'check':
      return <I size={size}><path d="M3.5 8.3l2.8 2.8 6.2-6.4" /></I>
    case 'alert':
      return <I size={size}><path d="M8 2.8l5.6 9.9H2.4z" /><path d="M8 6.6v2.8M8 11.1v.1" /></I>
  }
}
