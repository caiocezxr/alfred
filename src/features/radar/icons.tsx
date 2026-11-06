type P = { size?: number; className?: string }

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className,
})

export const RefreshIcon = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M13.2 7.2A5.3 5.3 0 0 0 3.6 4.6M2.8 8.8a5.3 5.3 0 0 0 9.6 2.6" />
    <path d="M3.3 2.2v2.7H6M12.7 13.8v-2.7H10" />
  </svg>
)

export const SlidersIcon = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </svg>
)

export const ArrowUpRight = ({ size = 13, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M5 11l6-6M6.2 5H11v4.8" />
  </svg>
)

export const BookmarkIcon = ({ size = 15, className, filled }: P & { filled?: boolean }) => (
  <svg {...base(size, className)}>
    <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" fill={filled ? 'currentColor' : 'none'} />
  </svg>
)

export const DismissIcon = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M4.1 11.9l7.8-7.8" />
  </svg>
)

export const WhyIcon = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M3 12.5V9M6.3 12.5V5.5M9.7 12.5V7.5M13 12.5V3.5" />
  </svg>
)

export const CheckIcon = ({ size = 13, className }: P) => (
  <svg {...base(size, className)} strokeWidth={1.6}>
    <path d="M3.5 8.4l2.9 2.9 6-6.3" />
  </svg>
)

export const CloseIcon = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

export const TrashIcon = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M4.8 4.5l.6 8.5h5.2l.6-8.5" />
  </svg>
)

export const ChevronIcon = ({ size = 12, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4.5 6.2L8 9.8l3.5-3.6" />
  </svg>
)

export const WifiOffIcon = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M2 6.3a9 9 0 0 1 3.5-2M8 3.8a9 9 0 0 1 6 2.5M4.2 8.7a5.6 5.6 0 0 1 2.4-1.4M10 7.6a5.6 5.6 0 0 1 1.8 1.1M6.4 11a2.4 2.4 0 0 1 3.2 0" />
    <path d="M2.5 2.5l11 11" />
  </svg>
)

export const AlertIcon = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M8 2.6l5.8 10.2H2.2z" />
    <path d="M8 6.6v2.8M8 11.1v.1" />
  </svg>
)

export const MinusIcon = ({ size = 12, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4 8h8" />
  </svg>
)

export const PlusIcon = ({ size = 12, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4 8h8M8 4v8" />
  </svg>
)
