import { describe, expect, it } from 'bun:test'
import { Children, createElement, isValidElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import HeldQueueStack, {
  HeldQueueCard,
  heldQueueOrder,
  isLiveHeldMessage
} from '../held-queue-stack.tsx'
import type { IHeldMessage } from '../../utils/held-messages.ts'
import type { useHeldMessages } from '../../hooks/use-held-messages.ts'
import type { IActionTargetIdentity } from '../../types/herdr.ts'

const target = {
  paneId: 'pane',
  terminalId: 'terminal',
  expectedMode: 'agent' as const,
  agentSessionId: 'original'
}
const record: IHeldMessage = {
  operationId: 'first',
  heldId: 'a'.repeat(64),
  text: 'ภาษาไทย original text',
  target,
  state: 'held'
}
const owner = (
  records: IHeldMessage[]
): ReturnType<typeof useHeldMessages> => ({
  records,
  storageError: null,
  enqueue: async () => {},
  send: async () => {},
  discard: async () => {},
  refresh: async () => {},
  dismiss: () => {}
})
const stack = (records: IHeldMessage[]) =>
  renderToStaticMarkup(
    createElement(HeldQueueStack, {
      paneId: 'pane',
      actionTarget: target,
      held: owner(records),
      onInspectTerminal: () => {}
    })
  )
const card = (
  item: IHeldMessage,
  actionTarget: IActionTargetIdentity = target,
  disabled = false
) =>
  renderToStaticMarkup(
    createElement(HeldQueueCard, {
      record: item,
      actionTarget,
      held: owner([item]),
      disabled,
      expanded: false,
      onInspectTerminal: () => {}
    })
  )
const controls = (
  node: ReactNode
): Array<{
  children?: ReactNode
  onClick?: () => void
  disabled?: boolean
}> => {
  const result: Array<{
    children?: ReactNode
    onClick?: () => void
    disabled?: boolean
  }> = []
  Children.forEach(node, (child) => {
    if (
      !isValidElement<{
        children?: ReactNode
        onClick?: () => void
        disabled?: boolean
      }>(child)
    )
      return
    if (child.props.onClick) result.push(child.props)
    result.push(...controls(child.props.children))
  })
  return result
}

describe('Web-held queue stack', () => {
  it('preserves FIFO display when uncertain evidence moves in the hook collection', () => {
    const second = { ...record, operationId: 'second', state: 'uncertain' }
    expect(heldQueueOrder([second, record], ['first', 'second'])).toEqual([
      record,
      second
    ])
    expect(heldQueueOrder([second], ['first', 'second'])).toEqual([second])
    expect(heldQueueOrder([], ['first', 'second'])).toEqual([])
  })
  it('reserves no markup for empty, other panes or authority-free/history copies', () => {
    expect(stack([])).toBe('')
    expect(
      stack([
        { ...record, restored: true },
        ...['consumed', 'discarded', 'rejected', 'invalidated'].map(
          (state) => ({ ...record, state })
        ),
        { ...record, target: { ...target, paneId: 'other' } }
      ])
    ).toBe('')
  })
  it('shows one oldest front and up to two decorative backs plus a native disclosure for many', () => {
    const one = stack([record])
    expect(one).toContain(record.text)
    expect(one).toContain('Send now')
    expect(one).not.toContain('aria-expanded')
    expect(one).not.toContain('held-queue-stack__back')
    const many = stack([
      record,
      { ...record, operationId: 'second', text: 'second text' },
      { ...record, operationId: 'third', text: 'third text' }
    ])
    expect(many).toContain('Show all 3')
    expect(many).toContain('aria-expanded="false"')
    expect(many).toContain('aria-controls=')
    expect(many.match(/aria-hidden="true"/g)?.length).toBe(2)
    expect(many).not.toContain('second text')
    expect(many).not.toContain('third text')
    expect(many.match(/Send now/g)?.length).toBe(1)
    expect(many).toContain('<button')
  })
  it('passes the exact original record to send/discard/refresh/dismiss, never a selected replacement', () => {
    const seen: IHeldMessage[] = []
    const held = owner([record])
    held.send = async (item) => {
      seen.push(item)
    }
    held.discard = async (item) => {
      seen.push(item)
    }
    held.refresh = async (item) => {
      seen.push(item)
    }
    held.dismiss = (item) => {
      seen.push(item)
    }
    for (const item of [record, { ...record, state: 'uncertain' }]) {
      const tree = HeldQueueCard({
        record: item,
        actionTarget: target,
        held,
        disabled: false,
        expanded: true,
        onInspectTerminal: () => {}
      })
      for (const control of controls(tree)) control.onClick?.()
      expect(
        seen.slice(item === record ? 0 : 2).every((value) => value === item)
      ).toBe(true)
    }
    expect(seen.length).toBe(4)
    expect(
      card(record, { ...target, agentSessionId: 'replacement' })
    ).not.toContain('Send now')
    expect(
      card(record, { ...target, agentSessionId: 'replacement' })
    ).toContain('Discard')
    expect(card({ ...record, heldId: undefined })).not.toContain('Send now')
    expect(card({ ...record, restored: true })).not.toContain('Send now')
    expect(card({ ...record, restored: true })).not.toContain('>Discard<')
    const blocked = card(record, { ...target, expectedMode: 'blocked-agent' })
    expect(blocked).not.toContain('Send now')
    expect(blocked).toContain('Discard')
  })
  it('disables mutations while pending and retains explicit unknown/uncertain recovery without a resend', () => {
    for (const state of ['enqueueing', 'claimed', 'sending', 'discarding']) {
      const html = stack([record, { ...record, operationId: 'pending', state }])
      expect(html.match(/\sdisabled=""/g)?.length).toBe(2)
    }
    for (const state of ['enqueue-unknown', 'uncertain']) {
      const html = stack([{ ...record, state }])
      expect(html).toContain('Web-held problems')
      expect(html).toContain('Refresh held evidence (read only)')
      expect(html).not.toContain('Send now')
      expect(html).not.toContain('>Discard<')
      expect(html).not.toContain('disabled=""')
    }
    expect(stack([{ ...record, state: 'uncertain' }])).toContain(
      'Inspect Terminal'
    )
    expect(card(record, target, true).match(/\sdisabled=""/g)?.length).toBe(2)
    expect(stack([{ ...record, error: 'visible error' }])).toContain(
      'role="alert"'
    )
    expect(
      isLiveHeldMessage({ ...record, restored: true, state: 'uncertain' })
    ).toBe(false)
  })
  it('keeps footer placement directly before the unkeyed composer and bounds the list in owned CSS', () => {
    const app = readFileSync(new URL('../../app.tsx', import.meta.url), 'utf8')
    expect(app).toMatch(
      /\{canonicalHasAgent && \(\s*<HeldQueueStack[\s\S]*?\/\>\s*\)\}\s*<PromptComposer/
    )
    expect(app).not.toMatch(/<PromptComposer\s+key=/)
    const css = readFileSync(
      new URL('../held-queue-stack.css', import.meta.url),
      'utf8'
    )
    expect(css).toContain('max-height: min(30dvh, 260px)')
    expect(css).toContain('overflow-y: auto')
    expect(css).toContain('pointer-events: none')
    expect(css).toContain('overflow-wrap: anywhere')
  })
  it('retains focus tracking through disabled settlement and gives held history its own wrapping owner', () => {
    const source = readFileSync(
      new URL('../held-queue-stack.tsx', import.meta.url),
      'utf8'
    )
    const recovery = source.slice(
      source.indexOf('const previous = focusedRef.current')
    )
    expect(recovery).toContain(
      'previous instanceof HTMLButtonElement && previous.disabled'
    )
    expect(recovery).toContain('document.activeElement === document.body')
    expect(recovery.indexOf('focusedRef.current = null')).toBeLessThan(
      recovery.indexOf('next?.focus()')
    )
    const css = readFileSync(
      new URL('../chat-view.css', import.meta.url),
      'utf8'
    )
    expect(css).toMatch(
      /\.held-message-history\s*\{[^}]*overflow-wrap: anywhere/
    )
    expect(css).toMatch(
      /\.held-message-history \.chat-compact-text\s*\{[^}]*white-space: pre-wrap/
    )
  })
})
