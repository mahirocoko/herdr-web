import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import PromptComposer from '../prompt-composer.tsx'

describe('PromptComposer: static rendering and controls', () => {
  it('groups only supplied recorded facts, before actions, without a live context percentage', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        isBusy={false}
        onSubmitText={async () => {}}
        recordedMetadata={{
          model: 'native/model-id',
          reasoning_effort: 'high',
          context: { used: 1200, window: 8000 }
        }}
      />
    )
    expect(html).toContain('Recorded conversation metadata')
    expect(html).toContain('Recorded model: native/model-id')
    expect(html).toContain('Recorded reasoning effort: high')
    expect(html).toContain('1,200 / 8,000 tokens')
    expect(html).not.toContain('%')
    expect(html.indexOf('prompt-composer__metadata')).toBeLessThan(
      html.indexOf('prompt-composer__quick-btn')
    )
    const empty = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        agentName="codex"
        isBusy={false}
        onSubmitText={async () => {}}
      />
    )
    expect(empty).not.toContain('prompt-composer__metadata')
  })
  it('keeps a single Conversation reader and retires target-scoped metadata on cleanup', async () => {
    const chat = await Bun.file(
      new URL('../chat-view.tsx', import.meta.url)
    ).text()
    const app = await Bun.file(new URL('../../app.tsx', import.meta.url)).text()
    expect(chat.match(/= useConversation\(/g)).toHaveLength(1)
    expect(chat).toContain('return () => onRecordedMetadata(null)')
    expect(chat).toContain('actionTarget?.paneId === paneId')
    expect(chat).toContain('!onRecordedMetadata &&')
    expect(app).toContain('onRecordedMetadata={setRecordedMetadata}')
    expect(app).toContain('recordedMetadata?.target.terminalId ===')
    expect(app).toContain('recordedMetadata?.target.agentSessionId ===')
  })
  it('shows UTF-8 bytes and blocks both actions for an oversized controlled draft', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId="term-1"
        hasValidTarget
        isBusy={false}
        draftText={'ก'.repeat(1366)}
        onSubmitText={async () => {}}
        onQueueText={async () => {}}
      />
    )
    expect(html).toContain('4098 / 4096 UTF-8 bytes')
    expect(html).toContain('aria-describedby="herdr-prompt-byte-limit"')
    expect(html).not.toContain('maxLength=')
    expect(html.match(/<button[^>]*disabled=""/g)?.length).toBe(2)
  })
  it('renders a read-only pane-folder and distinct Space checkout with source glyphs/badge', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        isBusy={false}
        onSubmitText={async () => {}}
        contextStrip={{
          path: '/different/pane',
          folder: 'pane',
          source: 'Space checkout: main * · linked',
          branch: 'main',
          dirty: true,
          worktree: 'linked'
        }}
      />
    )
    expect(html).toContain('Pane working folder: /different/pane')
    expect(html).toContain('Space checkout: main *')
    expect(html).toContain('lucide-folder')
    expect(html).toContain('lucide-git-branch')
    expect(html).toContain('prompt-composer__strip-kind')
    expect(html).not.toContain('Pane branch')
    expect(html.indexOf('prompt-composer__strip')).toBeGreaterThan(
      html.indexOf('</form>')
    )
  })
  it('keeps contextual controls inside the trailing form owner without a second form or submit trigger', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        paneId="ws1:p1"
        terminalId="term-1"
        isBusy={false}
        onSubmitText={async () => {}}
        contextControls={<button type="button">More controls</button>}
      />
    )
    expect(html.indexOf('More controls')).toBeGreaterThan(
      html.indexOf('prompt-composer__controls-right')
    )
    expect(html.indexOf('More controls')).toBeLessThan(html.indexOf('</form>'))
    expect(html.match(/<form/g)).toHaveLength(1)
    expect(html).toContain('type="button">More controls')
  })
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
