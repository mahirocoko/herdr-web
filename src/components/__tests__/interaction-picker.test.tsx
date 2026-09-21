import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import InteractionPickerSheet from '../interaction-picker-sheet.tsx'
import {
  filterCatalogItems,
  groupCatalogItemsByCategory,
  applyDraftAction
} from '@/utils/interaction-picker.ts'
import type { ICatalogItem } from '@/types/herdr.ts'

describe('InteractionPickerSheet: static rendering and state contracts', () => {
  it('renders null when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <InteractionPickerSheet
        isOpen={false}
        paneId="ws1:p1"
        terminalId="term-1"
        mode="agent"
        existingDraft=""
        onFillDraft={() => {}}
        onReplaceDraft={() => {}}
        onAppendDraft={() => {}}
        onClose={() => {}}
      />
    )
    expect(html).toBe('')
  })

  it('renders modal sheet structure with close button when isOpen is true', () => {
    const html = renderToStaticMarkup(
      <InteractionPickerSheet
        isOpen={true}
        paneId="ws1:p1"
        terminalId="term-1"
        mode="agent"
        existingDraft=""
        onFillDraft={() => {}}
        onReplaceDraft={() => {}}
        onAppendDraft={() => {}}
        onClose={() => {}}
      />
    )
    expect(html).toContain('drawer-overlay')
    expect(html).toContain('interaction-picker-sheet')
    expect(html).toContain('Quick Commands')
    expect(html).toContain('aria-label="Close command picker"')
  })
})

describe('filterCatalogItems pure helper', () => {
  const sampleItems: ICatalogItem[] = [
    { id: '1', label: 'Agent Check', fillValue: 'check agent', mode: 'agent', category: 'Review' },
    { id: '2', label: 'Shell Status', fillValue: 'git status', mode: 'shell', category: 'Git' },
    { id: '3', label: 'Both Common', fillValue: 'echo hello', mode: 'both', category: 'Common' },
    { id: '4', label: 'Unspecified Mode', fillValue: 'uptime', category: 'System' }
  ]

  it('filters items strictly matching the active mode or both/unspecified', () => {
    const agentItems = filterCatalogItems(sampleItems, 'agent')
    expect(agentItems.map((i) => i.id)).toEqual(['1', '3', '4'])

    const shellItems = filterCatalogItems(sampleItems, 'shell')
    expect(shellItems.map((i) => i.id)).toEqual(['2', '3', '4'])
  })

  it('filters items matching query against label, fillValue, or category', () => {
    const matchLabel = filterCatalogItems(sampleItems, 'agent', 'check')
    expect(matchLabel.map((i) => i.id)).toEqual(['1'])

    const matchFill = filterCatalogItems(sampleItems, 'shell', 'status')
    expect(matchFill.map((i) => i.id)).toEqual(['2'])

    const matchCategory = filterCatalogItems(sampleItems, 'shell', 'common')
    expect(matchCategory.map((i) => i.id)).toEqual(['3'])
  })

  it('returns empty array when query does not match any filtered items', () => {
    const noMatch = filterCatalogItems(sampleItems, 'agent', 'nonexistent-string')
    expect(noMatch).toEqual([])
  })
})

describe('groupCatalogItemsByCategory pure helper', () => {
  it('groups items by category and defaults missing categories to Commands', () => {
    const items: ICatalogItem[] = [
      { id: '1', label: 'A', fillValue: 'a', category: 'Dev' },
      { id: '2', label: 'B', fillValue: 'b', category: 'Dev' },
      { id: '3', label: 'C', fillValue: 'c', category: 'Ops' },
      { id: '4', label: 'D', fillValue: 'd' }
    ]

    const grouped = groupCatalogItemsByCategory(items)
    expect(Array.from(grouped.keys())).toEqual(['Dev', 'Ops', 'Commands'])
    expect(grouped.get('Dev')?.map((i) => i.id)).toEqual(['1', '2'])
    expect(grouped.get('Ops')?.map((i) => i.id)).toEqual(['3'])
    expect(grouped.get('Commands')?.map((i) => i.id)).toEqual(['4'])
  })
})

describe('applyDraftAction pure helper', () => {
  it('replaces draft on fill or replace action', () => {
    expect(applyDraftAction('old draft', 'new text', 'fill')).toBe('new text')
    expect(applyDraftAction('old draft', 'new text', 'replace')).toBe('new text')
    expect(applyDraftAction('', 'new text', 'fill')).toBe('new text')
  })

  it('appends text with double newline when existing draft is non-empty', () => {
    expect(applyDraftAction('first line', 'second line', 'append')).toBe('first line\n\nsecond line')
  })

  it('sets text directly on append when existing draft is empty or whitespace', () => {
    expect(applyDraftAction('', 'first line', 'append')).toBe('first line')
    expect(applyDraftAction('   ', 'first line', 'append')).toBe('first line')
  })
})
