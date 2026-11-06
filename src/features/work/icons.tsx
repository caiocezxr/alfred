import type { ReactNode } from 'react'

const P = {
  check: <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />,
  plus: <path d="M8 3v10M3 8h10" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  pin: <path d="M9.8 2.5l3.7 3.7-2.1.7-2.2 2.2.3 2.7-1 1-2.4-2.4L3 13.5l-.5-.5 3-3.1L3.1 7.5l1-1 2.7.3 2.2-2.2z" />,
  bell: <path d="M4.2 10.8V7.4a3.8 3.8 0 017.6 0v3.4l1.2 1.4H3zM6.6 13.6a1.5 1.5 0 002.8 0" />,
  alarm: <><circle cx="8" cy="8.8" r="4.7" /><path d="M8 6.4v2.6l1.7 1.1M2.6 3.6L4.4 2M13.4 3.6L11.6 2" /></>,
  clock: <><circle cx="8" cy="8" r="5.6" /><path d="M8 4.8V8l2.2 1.4" /></>,
  cal: <><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.8h11M5.5 2v2.6M10.5 2v2.6" /></>,
  link: <path d="M6.8 9.2a2.6 2.6 0 003.7 0l2.1-2.1a2.6 2.6 0 00-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 00-3.7 0L3.4 8.9a2.6 2.6 0 003.7 3.7l.8-.8" />,
  back: <path d="M6 4.5L2.8 7.7 6 10.9M3 7.7h6.3a3.7 3.7 0 010 7.4H8" />,
  pause: <path d="M5.8 3.8v8.4M10.2 3.8v8.4" />,
  play: <path d="M5 3.5l7.5 4.5L5 12.5z" />,
  note: <path d="M3.5 3h9v6.5L9.5 12.5h-6zM9.5 12.5V9.5h3" />,
  image: <><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.6" r="1.2" /><path d="M13.5 10.5l-3.2-3-5.8 5.5" /></>,
  key: <><circle cx="5.4" cy="10.6" r="2.6" /><path d="M7.3 8.7l5.2-5.2M10.6 5.4l1.6 1.6M9.3 6.7l1.3 1.3" /></>,
  eye: <><path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.9" /></>,
  copy: <><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.6" /><path d="M10.5 5.5V4.2A1.2 1.2 0 009.3 3H4.2A1.2 1.2 0 003 4.2v5.1a1.2 1.2 0 001.2 1.2h1.3" /></>,
  trash: <path d="M3.5 4.5h9M6.4 4.5V3h3.2v1.5M4.7 4.5l.6 8.5h5.4l.6-8.5" />,
  gear: <><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" /></>,
  text: <path d="M3 4h10M3 7h10M3 10h6.5" />,
  flag: <path d="M4 14V2.8M4 3h7.5l-1.6 2.6L11.5 8.2H4" />,
  arrow: <path d="M3 8h9.5M9 4.5L12.5 8 9 11.5" />,
  up: <path d="M8 13V3.5M4.5 7L8 3.5 11.5 7" />,
  down: <path d="M8 3v9.5M4.5 9L8 12.5 11.5 9" />,
  hash: <path d="M6.2 2.5L5 13.5M11 2.5L9.8 13.5M3 6h10.5M2.5 10H13" />,
  chevron: <path d="M4.5 6.5L8 10l3.5-3.5" />,
  repeat: <path d="M3 7.2V6a2 2 0 012-2h7.5M10.5 2l2 2-2 2M13 8.8V10a2 2 0 01-2 2H3.5M5.5 14l-2-2 2-2" />,
  spark: <path d="M8 2.2l1.4 4.4L13.8 8l-4.4 1.4L8 13.8l-1.4-4.4L2.2 8l4.4-1.4z" />,
  user: <><circle cx="8" cy="5.6" r="2.6" /><path d="M3 13.5a5 5 0 0110 0" /></>,
  grip: <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" />,
  board: <><rect x="2.5" y="3" width="3.2" height="10" rx="1" /><rect x="6.4" y="3" width="3.2" height="7" rx="1" /><rect x="10.3" y="3" width="3.2" height="5" rx="1" /></>,
  list: <path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01" />,
  sound: <path d="M3 6.2h2.2L8.5 3.5v9L5.2 9.8H3zM11 5.8a3 3 0 010 4.4M12.6 4.3a5.2 5.2 0 010 7.4" />,
  mute: <path d="M3 6.2h2.2L8.5 3.5v9L5.2 9.8H3zM11 6.2l3 3.6M14 6.2l-3 3.6" />,
  refresh: <path d="M12.8 6.4A5 5 0 003.6 5.2M3.2 9.6a5 5 0 009.2 1.2M3.4 2.8v2.6H6M12.6 13.2v-2.6H10" />,
  search: <><circle cx="7" cy="7" r="4.3" /><path d="M10.2 10.2l3.3 3.3" /></>,
  hours: <><circle cx="8" cy="8.4" r="5.4" /><path d="M8 5.4v3l2 1.2M6.3 1.8h3.4" /></>,
  shield: <path d="M8 2l5 1.8v3.9c0 3.2-2.2 5.4-5 6.3-2.8-.9-5-3.1-5-6.3V3.8z" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof P

export function Icon({ name, size = 16, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {P[name]}
    </svg>
  )
}
