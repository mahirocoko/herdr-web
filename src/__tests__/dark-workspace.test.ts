import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/app.css', 'utf8')
const recipes = readFileSync('src/components/ui/recipes.css', 'utf8')
const chat = readFileSync('src/components/chat-view.css', 'utf8')

it('shares dark shell tokens without overriding native terminal sizing or chat radii', () => {
  expect(css).toContain('color-scheme: dark;')
  expect(css).toContain('--term-bg: var(--color-bg-base);')
  expect(css).toContain('--terminal-font-size: var(--fs-sm);')
  expect(css).toContain('--fs-input: 16px;')
  expect(css).toContain('@media (min-width: 769px) and (min-height: 501px)')
  expect(css).toContain('@media (max-width: 768px), (max-height: 500px)')
  expect(chat).toContain('--bg: var(--color-bg-surface);')
  expect(chat).not.toMatch(/--radius-(?:sm|md|lg|pill):/)
  expect(css).not.toContain('rgba(229, 169, 59,')
  expect(css).toContain('border-color: var(--color-border-active) !important;')
  expect(css).toMatch(
    /\.ui-button\.pane-card__explain-trigger\s*\{\s*min-width: 44px;\s*min-height: 44px;\s*height: 44px;/
  )
})

it('owns primary and secondary pressed/focus/disabled states in shared recipes', () => {
  expect(recipes).toContain(
    '.ui-button--default:active:not(:disabled):not([data-disabled])'
  )
  expect(recipes).toContain(
    '.ui-button--ghost:active:not(:disabled):not([data-disabled])'
  )
  expect(recipes).toContain('background-color: var(--color-accent-pressed);')
  expect(recipes).toContain('outline: 2px solid var(--color-focus);')
  expect(recipes).toContain('.ui-button[data-disabled]')
  expect(recipes).toContain('border-color: var(--color-control-border-hover);')
  expect(recipes).toContain(
    'background-image: var(--color-action-primary-gradient);'
  )
  expect(css).toContain('--color-status-working: #00d2ef;')
  expect(css).toContain('--color-status-done: #05df72;')
  expect(css).toContain('--color-activity-skill: #c07eff;')
  expect(chat).toContain('background: var(--color-bg-base);')
  expect(css).toContain('width: min(640px, calc(100vw - 48px));')
  expect(css).toContain('.ui-sheet--bottom.navigation-search-sheet')
  expect(css).not.toContain('.ui-sheet.navigation-search-sheet')
  expect(chat).toContain(
    ".work-row[data-tool-name='Skill']:not(.is-error) .work-row-name"
  )
  expect(css).toMatch(/\.prompt-composer__context-controls\s*\{\s*grid-row: 2;/)
})
