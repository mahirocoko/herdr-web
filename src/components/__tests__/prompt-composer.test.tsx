import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import PromptComposer from '../prompt-composer.tsx'

describe('PromptComposer: static rendering and controls', () => {
  it('blocks unread prompt input without falsely claiming terminal identity is missing', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId="term-1"
        isBusy={false}
        hasValidTarget
        isPromptEvidenceReady={false}
        draftText="preserved"
        onSubmitText={async () => {}}
      />
    )
    expect(html).toContain(
      'Inspect or re-read the current prompt before sending'
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('preserved')
    expect(html).not.toContain('Terminal identity missing')
  })
  it('renders textarea, quick commands trigger, and send button when active and valid', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId="term-1"
        isBusy={false}
        hasValidTarget={true}
        draftText="hello"
        onSubmitText={async () => {}}
      />
    )
    expect(html).toContain('prompt-composer__quick-btn')
    expect(html).toContain('Quick Commands')
    expect(html).toContain('prompt-composer__input')
    expect(html).toContain('prompt-composer__submit-btn')
    expect(html).not.toContain('disabled=""')
  })

  it('disables quick commands trigger and send button when isBusy is true', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId="term-1"
        isBusy={true}
        hasValidTarget={true}
        onSubmitText={async () => {}}
      />
    )
    expect(html).toContain('disabled=""')
  })

  it('disables input and triggers when hasValidTarget is false', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId={null}
        isBusy={false}
        hasValidTarget={false}
        onSubmitText={async () => {}}
      />
    )
    expect(html).toContain('disabled=""')
  })

  it('disables controls when terminal control mode is active', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId="term-1"
        isBusy={false}
        hasValidTarget={true}
        isControlActive={true}
        onSubmitText={async () => {}}
      />
    )
    expect(html).toContain('disabled=""')
  })

  it('renders custom draftText when provided in controlled mode', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId="term-1"
        isBusy={false}
        hasValidTarget={true}
        draftText="git status --short"
        onSubmitText={async () => {}}
      />
    )
    expect(html).toContain('git status --short')
  })

  it('preserves desktop card markup order while responsive CSS owns mobile row placement', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId="term-1"
        isBusy={false}
        hasValidTarget={true}
        onSubmitText={async () => {}}
      />
    )
    expect(html).toContain('prompt-composer__toolbar')
    expect(html).toContain('prompt-composer__controls-left')
    expect(html).toContain('prompt-composer__controls-right')

    // Verify textarea wrapper is above the bottom toolbar in markup order
    const inputWrapperIndex = html.indexOf('prompt-composer__input-wrapper')
    const toolbarIndex = html.indexOf('prompt-composer__toolbar')
    expect(inputWrapperIndex).toBeGreaterThan(-1)
    expect(toolbarIndex).toBeGreaterThan(inputWrapperIndex)

    // Verify left control holds quick-btn and right control holds submit-btn
    const leftControlsIndex = html.indexOf('prompt-composer__controls-left')
    const quickBtnIndex = html.indexOf('prompt-composer__quick-btn')
    const rightControlsIndex = html.indexOf('prompt-composer__controls-right')
    const submitBtnIndex = html.indexOf('prompt-composer__submit-btn')

    expect(quickBtnIndex).toBeGreaterThan(leftControlsIndex)
    expect(rightControlsIndex).toBeGreaterThan(quickBtnIndex)
    expect(submitBtnIndex).toBeGreaterThan(rightControlsIndex)
  })
})
