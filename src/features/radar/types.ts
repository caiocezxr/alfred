
export type SourceCategory = 'ai_dev' | 'ai_content' | 'stack' | 'auto'
export type ItemCategory = 'ai_dev' | 'ai_content' | 'stack' | 'other'
export type KeywordCategory = 'ai_dev' | 'ai_content' | 'stack'
export type KeywordKind = 'boost' | 'mute'

export type FeedSource = {
  id: string
  name: string
  url: string
  category: SourceCategory
  enabled: boolean
  weight: number
  builtin: boolean
  lastStatus: 'ok' | 'error' | null
  lastError: string | null
  lastFetchedAt: string | null
  lastOkAt: string | null
  createdAt: string
}

export type FeedItem = {
  id: string
  sourceId: string | null
  sourceName: string
  guid: string | null
  url: string
  canonicalUrl: string
  title: string
  titleKey: string
  excerpt: string
  category: ItemCategory
  relevance: number
  publishedAt: string | null
  fetchedAt: string
  readAt: string | null
  savedAt: string | null
  dismissedAt: string | null
}

export type NewFeedItem = {
  guid: string | null
  url: string
  canonicalUrl: string
  title: string
  titleKey: string
  excerpt: string
  category: ItemCategory
  relevance: number
  publishedAt: string | null
}

export type UpsertResult = { inserted: number; updated: number; unchanged: number; duplicates: number; skipped: number }
export type ItemPatch = { read?: boolean; saved?: boolean; dismissed?: boolean }
export type NewSource = { name: string; url: string; category: SourceCategory; weight?: number }
export type SourcePatch = { name?: string; category?: SourceCategory; enabled?: boolean; weight?: number }

export type Keyword = {
  id: string
  term: string
  kind: KeywordKind
  category: KeywordCategory | null
  weight: number
  builtin: boolean
}
export type KeywordInput = { id?: string; term: string; kind: KeywordKind; category?: KeywordCategory | null; weight: number }

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  ai_dev: 'IA para desenvolvimento',
  ai_content: 'IA para conteúdo',
  stack: 'Stacks e ferramentas',
  other: 'Geral',
}

export const CATEGORY_SHORT: Record<ItemCategory, string> = {
  ai_dev: 'IA dev',
  ai_content: 'IA conteúdo',
  stack: 'Stacks',
  other: 'Geral',
}

export const SOURCE_CATEGORY_LABEL: Record<SourceCategory, string> = {
  ai_dev: 'IA dev',
  ai_content: 'IA conteúdo',
  stack: 'Stacks',
  auto: 'Automática',
}
