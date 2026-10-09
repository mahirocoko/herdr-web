import { expect, test } from 'bun:test'
import { renderMathMarkup } from '../math-markup.ts'
test('real formula markup with untrusted commands and bounded expansion', () => {
  expect(renderMathMarkup('\\frac{1}{2}', false)).toContain('class="katex"')
  expect(renderMathMarkup('x^2', true)).toContain('katex-display')
  expect(
    renderMathMarkup('\\href{javascript:alert(1)}{x}', false)
  ).not.toContain('href="javascript:')
  expect(renderMathMarkup('\\htmlClass{injected}{x}', false)).not.toContain(
    'class="injected"'
  )
  expect(() => renderMathMarkup('x'.repeat(20001), false)).toThrow()
  expect(renderMathMarkup('\\unknowncommand', false)).toContain(
    '\\unknowncommand'
  )
  expect(() => renderMathMarkup('\\frac{', false)).not.toThrow()
})
