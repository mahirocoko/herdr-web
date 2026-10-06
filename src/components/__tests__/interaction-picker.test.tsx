import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import InteractionPickerSheet from '../interaction-picker-sheet.tsx'
import {
  filterCatalogItems,
  groupCatalogItemsByCategory,
  groupMergedItemsByCategory,
  applyDraftAction,
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
      />,
    )
    expect(html).toBe('')
  })

  it('truthfully defers portal popup markup in static SSR when isOpen is true (Base UI Dialog portal contract)', () => {
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
      />,
    )
    // Base UI Dialog.Portal truthfully defers portaled popups during static SSR
    expect(html).toBe('')
  })
})

describe('InteractionPickerSheet: structural and behavior contracts', () => {
  it('owns multiline row sizing without changing the shared Button recipe', () => {
    const css = fs.readFileSync(
      path.resolve(import.meta.dir, '../../app.css'),
      'utf8',
    )
    const rowRule = css.match(
      /\.ui-button\.interaction-picker__item-btn\s*\{([^}]+)\}/,
    )?.[1]
    expect(rowRule).toContain('height: auto')
    expect(rowRule).toContain('min-height: 48px')
    expect(rowRule).toContain('white-space: normal')
    expect(rowRule).toContain('line-height: 1.4')
  })

  const sheetPath = path.resolve(
    import.meta.dir,
    '../interaction-picker-sheet.tsx',
  )
  const sheetContent = fs.readFileSync(sheetPath, 'utf8')

  it('declares modal sheet structure with Base UI Sheet and accessible close button', () => {
    expect(sheetContent).toContain('<Sheet')
    expect(sheetContent).toContain('<SheetContent')
    expect(sheetContent).toContain(
      'className="drawer-sheet interaction-picker-sheet"',
    )
    expect(sheetContent).toContain('aria-label="Close command picker"')
    expect(sheetContent).toContain('Commands &amp; Keys')
  })
})

describe('filterCatalogItems pure helper', () => {
  const sampleItems: ICatalogItem[] = [
    {
      id: '1',
      label: 'Agent Check',
      fillValue: 'check agent',
      mode: 'agent',
      category: 'Review',
    },
    {
      id: '2',
      label: 'Shell Status',
      fillValue: 'git status',
      mode: 'shell',
      category: 'Git',
    },
    {
      id: '3',
      label: 'Both Common',
      fillValue: 'echo hello',
      mode: 'both',
      category: 'Common',
    },
    {
      id: '4',
      label: 'Unspecified Mode',
      fillValue: 'uptime',
      category: 'System',
    },
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
    const noMatch = filterCatalogItems(
      sampleItems,
      'agent',
      'nonexistent-string',
    )
    expect(noMatch).toEqual([])
  })
})

describe('groupCatalogItemsByCategory pure helper', () => {
  it('groups items by category and defaults missing categories to Commands', () => {
    const items: ICatalogItem[] = [
      { id: '1', label: 'A', fillValue: 'a', category: 'Dev' },
      { id: '2', label: 'B', fillValue: 'b', category: 'Dev' },
      { id: '3', label: 'C', fillValue: 'c', category: 'Ops' },
      { id: '4', label: 'D', fillValue: 'd' },
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
    expect(applyDraftAction('old draft', 'new text', 'replace')).toBe(
      'new text',
    )
    expect(applyDraftAction('', 'new text', 'fill')).toBe('new text')
  })

  it('appends text with double newline when existing draft is non-empty', () => {
    expect(applyDraftAction('first line', 'second line', 'append')).toBe(
      'first line\n\nsecond line',
    )
  })

  it('sets text directly on append when existing draft is empty or whitespace', () => {
    expect(applyDraftAction('', 'first line', 'append')).toBe('first line')
    expect(applyDraftAction('   ', 'first line', 'append')).toBe('first line')
  })
})

describe('InteractionPickerSheet tabs and structural contracts', () => {
  const sheetPath = path.resolve(
    import.meta.dir,
    '../interaction-picker-sheet.tsx',
  )
  const sheetContent = fs.readFileSync(sheetPath, 'utf8')

  it('declares all three view tabs without modal stacking', () => {
    // Three view tabs inside single sheet
    expect(sheetContent).toContain('interaction-picker__tab')
    expect(sheetContent).toContain('Commands')
    expect(sheetContent).toContain('New Action')
    expect(sheetContent).toContain('Key Rail')

    // Action management surface
    expect(sheetContent).toContain('Create Custom Action')
    expect(sheetContent).toContain('Persisted in this browser only')
    expect(sheetContent).toContain('Action Name')
    expect(sheetContent).toContain('Prompt Draft Text *')
  })

  it('declares Key Rail configuration surface', () => {
    expect(sheetContent).toContain('Terminal Key Rail')
    expect(sheetContent).toContain('Active Rail Keys')
    expect(sheetContent).toContain('Rail Presets')
    expect(sheetContent).toContain('Reset to Default')
    expect(sheetContent).toContain('Configuration Scope')
    expect(sheetContent).toContain('Global (All Spaces)')
    expect(sheetContent).toContain('This Space only')
  })
})

describe('groupMergedItemsByCategory pure helper', () => {
  it('groups merged items by category and defaults missing categories to Commands', () => {
    const items = [
      { id: '1', label: 'Item 1', category: 'Dev' },
      { id: '2', label: 'Item 2', category: 'Dev' },
      { id: '3', label: 'Item 3', category: 'Ops' },
      { id: '4', label: 'Item 4' },
    ]
    const grouped = groupMergedItemsByCategory(items)
    expect(Array.from(grouped.keys())).toEqual(['Dev', 'Ops', 'Commands'])
    expect(grouped.get('Dev')?.map((i) => i.id)).toEqual(['1', '2'])
    expect(grouped.get('Ops')?.map((i) => i.id)).toEqual(['3'])
    expect(grouped.get('Commands')?.map((i) => i.id)).toEqual(['4'])
  })
})
