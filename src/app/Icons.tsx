import type { Route } from './router'

const S = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function RouteIcon({ id }: { id: Route }) {
  switch (id) {
    case 'home':
      return (
        <svg {...S} aria-hidden="true">
          <circle cx="9" cy="9" r="6.2" />
          <path d="M2.8 9h12.4M9 2.8c2 2 2 10.4 0 12.4M9 2.8c-2 2-2 10.4 0 12.4" />
        </svg>
      )
    case 'oficina':
      return (
        <svg {...S} aria-hidden="true">
          <path d="M3.2 5.4h11.6v8.4H3.2z" />
          <path d="M5.8 8.2l1.8 1.6-1.8 1.6M9.6 11.4h2.6" />
          <path d="M6.2 5.4V3.6h5.6v1.8" />
        </svg>
      )
    case 'ideas':
      return (
        <svg {...S} aria-hidden="true">
          <path d="M6.8 13.5h4.4M7.4 15.6h3.2M9 2.6a4.6 4.6 0 0 0-2.7 8.3c.5.4.8 1 .8 1.6v.2h3.8v-.2c0-.6.3-1.2.8-1.6A4.6 4.6 0 0 0 9 2.6z" />
        </svg>
      )
    case 'radar':
      return (
        <svg {...S} aria-hidden="true">
          <circle cx="9" cy="9" r="6.2" />
          <circle cx="9" cy="9" r="3.4" />
          <path d="M9 9l4.4-4.4" />
        </svg>
      )
    case 'bible':
      return (
        <svg {...S} aria-hidden="true">
          <path d="M4 3.2h8.6a1.4 1.4 0 0 1 1.4 1.4v10.2H5.4A1.4 1.4 0 0 1 4 13.4z" />
          <path d="M4 13.4a1.4 1.4 0 0 1 1.4-1.4H14M9 5.5v4M7.4 7h3.2" />
        </svg>
      )
    case 'habits':
      return (
        <svg {...S} aria-hidden="true">
          <path d="M3 14.5V9.8M7 14.5V6.5M11 14.5v-5M15 14.5V3.5" />
        </svg>
      )
    case 'work':
      return (
        <svg {...S} aria-hidden="true">
          <rect x="2.6" y="5.2" width="12.8" height="9.6" rx="2.2" />
          <path d="M6.6 5.2V3.9a1.1 1.1 0 0 1 1.1-1.1h2.6a1.1 1.1 0 0 1 1.1 1.1v1.3M2.6 9.4h12.8" />
        </svg>
      )
    case 'notes':
      return (
        <svg {...S} aria-hidden="true">
          <path d="M4.5 2.8h6.2l2.8 2.8v9.6H4.5z" />
          <path d="M10.6 2.8v2.9h2.9M6.8 9h4.4M6.8 11.6h3" />
        </svg>
      )
  }
}

export const PaletteIcon = () => (
  <svg {...S} aria-hidden="true">
    <path d="M9 2.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.3-.6 1.3-1.2 0-.8-.6-1.1-.6-1.8 0-.7.6-1.2 1.3-1.2h1.6a2.7 2.7 0 0 0 2.6-2.8A5.6 5.6 0 0 0 9 2.8z" />
    <circle cx="5.9" cy="8.3" r=".8" fill="currentColor" />
    <circle cx="8.3" cy="5.7" r=".8" fill="currentColor" />
    <circle cx="11.6" cy="6.3" r=".8" fill="currentColor" />
  </svg>
)

export const SidebarIcon = () => (
  <svg {...S} aria-hidden="true">
    <rect x="2.6" y="3.4" width="12.8" height="11.2" rx="2.4" />
    <path d="M7 3.4v11.2" />
  </svg>
)

export const SearchIcon = () => (
  <svg {...S} aria-hidden="true">
    <circle cx="8" cy="8" r="4.6" />
    <path d="M11.4 11.4L15 15" />
  </svg>
)
