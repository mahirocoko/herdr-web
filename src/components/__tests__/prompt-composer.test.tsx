import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import PromptComposer from '../prompt-composer.tsx'

describe('PromptComposer: static rendering and controls', () => {
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
})
