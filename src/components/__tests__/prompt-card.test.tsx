import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PromptCard } from '../prompt-card.tsx'
import type { IInteractivePrompt } from '../../types/interactive-prompt.ts'

const prompt: IInteractivePrompt = {
  id: 'asking',
  agent: 'omo',
  kind: 'question',
  title: 'Question 1 of 2',
  question: 'Which route?',
  body: 'reference command\nsecond line',
  options: [
    {
      label: 'Route A (Recommended)',
      description: 'Native option description'
    },
    { label: 'Route B', description: null },
    { label: 'Type your own answer...', description: null }
  ],
  multi_select: false,
  custom_option_index: 2,
  steps: [
    { label: 'Route', current: true, answered: false },
    { label: 'Author', current: false, answered: true }
  ]
}
const render = (next: IInteractivePrompt, confirm = false) =>
  renderToStaticMarkup(
    createElement(PromptCard, {
      paneId: 'p1',
      prompt: next,
      answerPrompt: async () => ({
        ok: true,
        outcome: 'acknowledged' as const
      }),
      onPromptChanged: () => {},
      onAnswered: () => {},
      typedAnswer: confirm ? { option_index: 0 } : null
    })
  )
describe('source prompt card anatomy', () => {
  it('renders question/form/body/descriptions/recommendation/custom answer with canonical primitives', () => {
    const html = render(prompt)
    for (const text of [
      'Agent is asking',
      'Question 1 of 2',
      'Which route?',
      'prompt-card-steps',
      'aria-current="step"',
      '(answered)',
      'reference command',
      'Native option description',
      'Recommended',
      'ui-button',
      'ui-input',
      'Or type your own answer'
    ])
      expect(html).toContain(text)
    expect(html).not.toContain(
      '<button type="button" class="prompt-card-option'
    )
  })
  it('shows multi controls and explicit submit, not generic text sends', () => {
    const html = render({
      ...prompt,
      multi_select: true,
      custom_option_index: null
    })
    expect(html).toContain('ui-checkbox')
    expect(html).toContain('Submit')
    expect(html).toContain('role="group"')
  })
  it('retains confirmation fold and truthful queue ownership copy', () => {
    const html = render({ ...prompt, kind: 'approval', queued: 'open' }, true)
    expect(html).toContain('prompt-card-confirm')
    expect(html).toContain('Confirm')
    expect(html).toContain('Cancel')
    expect(html).toContain('holds the terminal')
    expect(render({ ...prompt, queued: 'collapsed' })).toContain(
      'message box still talks to Codex'
    )
  })
  it('does not duplicate an approval heading/question or interpret reference HTML', () => {
    const html = render({
      ...prompt,
      question: prompt.title,
      body: '<script>unsafe</script>'
    })
    expect(html).not.toContain('prompt-card-question')
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;')
  })
})
