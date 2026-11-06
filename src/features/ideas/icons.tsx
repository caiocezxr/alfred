import type { IdeaKind } from './types'
import type { Verdict } from './engine'

const base = (size: number) =>
  ({
    width: size,
    height: size,
    viewBox: '0 0 18 18',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }) as const

type P = { size?: number }

export const PlusIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M9 3.5v11M3.5 9h11" />
  </svg>
)

export const ProductIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <rect x="2.6" y="3.4" width="12.8" height="11.2" rx="2.6" />
    <path d="M2.6 6.9h12.8" />
    <path d="M5 5.15h.01M6.8 5.15h.01" strokeWidth="1.8" />
    <path d="M6 10.6l1.6-1.4L9.4 11l2.6-2.4" />
  </svg>
)

export const ContentIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M3 9h.8M5.6 6.2v5.6M8.2 3.6v10.8M10.8 6.8v4.4M13.4 5v8M15.6 8.4v1.2" />
  </svg>
)

export const KindIcon = ({ kind, size }: { kind: IdeaKind; size?: number }) =>
  kind === 'product' ? <ProductIcon size={size} /> : <ContentIcon size={size} />

export const BookIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M9 4.6C7.6 3.6 5.6 3.2 3 3.4v10.4c2.6-.2 4.6.2 6 1.2 1.4-1 3.4-1.4 6-1.2V3.4c-2.6-.2-4.6.2-6 1.2z" />
    <path d="M9 4.6V15" />
  </svg>
)

export const ChevronIcon = ({ size = 14, dir = 'down' }: P & { dir?: 'down' | 'left' | 'right' | 'up' }) => {
  const r = { down: 0, left: 90, up: 180, right: 270 }[dir]
  return (
    <svg {...base(size)} style={{ transform: `rotate(${r}deg)` }}>
      <path d="M5 7.2l4 4 4-4" />
    </svg>
  )
}

export const ArrowIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M3.5 9h11M10.5 5l4 4-4 4" />
  </svg>
)

export const CheckIcon = ({ size = 12 }: P) => (
  <svg {...base(size)} strokeWidth={1.8}>
    <path d="M3.8 9.4l3.3 3.2 7.1-7.4" />
  </svg>
)

export const CloseIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
  </svg>
)

export const MoreIcon = ({ size = 16 }: P) => (
  <svg {...base(size)} strokeWidth={2}>
    <path d="M4.2 9h.01M9 9h.01M13.8 9h.01" />
  </svg>
)

export const TrashIcon = ({ size = 14 }: P) => (
  <svg {...base(size)} strokeWidth={1.3}>
    <path d="M3.8 5h10.4M7.2 5V3.6h3.6V5M5.2 5l.6 9.4h6.4l.6-9.4" />
  </svg>
)

export const PauseIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M6.6 4.4v9.2M11.4 4.4v9.2" />
  </svg>
)

export const PlayIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M5.6 4.2v9.6a.6.6 0 0 0 .9.5l7.4-4.8a.6.6 0 0 0 0-1L6.5 3.7a.6.6 0 0 0-.9.5z" />
  </svg>
)

export const LinkIcon = ({ size = 13 }: P) => (
  <svg {...base(size)}>
    <path d="M7.6 10.4a3 3 0 0 0 4.3 0l2.2-2.2a3 3 0 0 0-4.3-4.3l-.9.9" />
    <path d="M10.4 7.6a3 3 0 0 0-4.3 0L3.9 9.8a3 3 0 0 0 4.3 4.3l.9-.9" />
  </svg>
)

export const BanIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <circle cx="9" cy="9" r="6" />
    <path d="M4.8 13.2l8.4-8.4" />
  </svg>
)

export const FlagIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M9 3.2L15.6 14.6H2.4z" />
    <path d="M9 7.6v3.2M9 12.8h.01" />
  </svg>
)

export const TargetIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <circle cx="9" cy="9" r="6" />
    <circle cx="9" cy="9" r="2.6" />
  </svg>
)

export const QuoteIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M3.5 13.5h11M3.5 9.5h11M3.5 5.5h7" />
  </svg>
)

export const ChartIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M3 14.5h12M5 11.8V9M8.3 11.8V5.6M11.6 11.8V7.8M14.4 4.2l-2.8 2.6" />
  </svg>
)

export const VerdictIcon = ({ verdict, size = 22 }: { verdict: Verdict; size?: number }) => {
  switch (verdict) {
    case 'test':
      return (
        <svg {...base(size)}>
          <path d="M7 2.8h4M7.6 2.8v4.4L3.8 13.6A1.2 1.2 0 0 0 4.8 15.4h8.4a1.2 1.2 0 0 0 1-1.8L10.4 7.2V2.8" />
          <path d="M5.6 11h6.8" />
        </svg>
      )
    case 'investigate':
      return (
        <svg {...base(size)}>
          <circle cx="8" cy="8" r="4.6" />
          <path d="M11.4 11.4l3.6 3.6" />
        </svg>
      )
    case 'discard':
      return (
        <svg {...base(size)}>
          <circle cx="9" cy="9" r="6.2" />
          <path d="M7.4 6.6v4.8M10.6 6.6v4.8" />
        </svg>
      )
    case 'insufficient':
      return (
        <svg {...base(size)} strokeDasharray="1.6 2.4">
          <circle cx="9" cy="9" r="6.2" />
        </svg>
      )
  }
}

export const DecisionIcon = ({ d, size = 18 }: { d: 'continue' | 'adjust' | 'archive'; size?: number }) => {
  switch (d) {
    case 'continue':
      return (
        <svg {...base(size)}>
          <path d="M3.5 9h11M10.5 5l4 4-4 4" />
        </svg>
      )
    case 'adjust':
      return (
        <svg {...base(size)}>
          <path d="M3.5 5.5h6M12.5 5.5h2M3.5 12.5h2M8.5 12.5h6" />
          <circle cx="11" cy="5.5" r="1.5" />
          <circle cx="7" cy="12.5" r="1.5" />
        </svg>
      )
    case 'archive':
      return (
        <svg {...base(size)}>
          <rect x="2.8" y="3.6" width="12.4" height="3.2" rx="1" />
          <path d="M4 6.8v6.6a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V6.8M7.4 9.6h3.2" />
        </svg>
      )
  }
}
