import type { ICatalogItem } from '@/types/herdr.ts'

/**
 * Pure filter for interaction catalog items based on target mode ('agent' | 'shell')
 * and optional search query.
 */
export const filterCatalogItems = (
  items: ICatalogItem[],
  mode: 'agent' | 'shell',
  query?: string
): ICatalogItem[] => {
  const filteredByMode = items.filter((item) => {
    if (!item.mode || item.mode === 'both') return true
    return item.mode === mode
  })

  const trimmedQuery = query?.trim().toLowerCase()
  if (!trimmedQuery) {
    return filteredByMode
  }

  return filteredByMode.filter((item) => {
    return (
      item.label.toLowerCase().includes(trimmedQuery) ||
      item.fillValue.toLowerCase().includes(trimmedQuery) ||
      (item.description && item.description.toLowerCase().includes(trimmedQuery)) ||
      (item.category && item.category.toLowerCase().includes(trimmedQuery))
    )
  })
}

/**
 * Pure grouping for catalog items by their category name.
 * Items without a category default to 'Commands'.
 */
export const groupCatalogItemsByCategory = (
  items: ICatalogItem[]
): Map<string, ICatalogItem[]> => {
  const map = new Map<string, ICatalogItem[]>()
  for (const item of items) {
    const cat = item.category?.trim() || 'Commands'
    if (!map.has(cat)) {
      map.set(cat, [])
    }
    map.get(cat)!.push(item)
  }
  return map
}

export type IDraftApplyAction = 'fill' | 'replace' | 'append'

/**
 * Pure draft transformer for interaction picker selection.
 * Modifies strictly client-side composer text; does NOT dispatch or send mutations.
 */
export const applyDraftAction = (
  existingDraft: string,
  fillValue: string,
  action: IDraftApplyAction
): string => {
  switch (action) {
    case 'fill':
    case 'replace':
      return fillValue
    case 'append': {
      const trimmed = existingDraft.trim()
      return trimmed ? `${trimmed}\n\n${fillValue}` : fillValue
    }
  }
}
