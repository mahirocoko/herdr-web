import { beforeEach, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ThumbDeck from '../thumb-deck.tsx'
import { DEFAULT_PRIMARY_KEYS } from '@/utils/terminal-keys.ts'
import {
  CUSTOM_ACTIONS_CHANGE_EVENT,
  getRailKeys,
  setRailKeys,
} from '@/utils/custom-actions-storage.ts'

class LocalStorageMock {
  private store: Record<string, string> = {}

  getItem(key: string): string | null {
    return this.store[key] ?? null
  }

  setItem(key: string, value: string): void {
    this.store[key] = value
  }

  removeItem(key: string): void {
    delete this.store[key]
  }

  clear(): void {
    this.store = {}
  }
}

describe('ThumbDeck: horizontal key rail and customization trigger', () => {
  beforeEach(() => {
    const mock = new LocalStorageMock()
    Object.defineProperty(globalThis, 'localStorage', {
      value: mock as unknown as Storage,
      writable: true,
      configurable: true,
    })
  })

  it('renders terminal keys and customization trigger button', () => {
    let manageClicked = false
    const html = renderToStaticMarkup(
      <ThumbDeck
        paneId="ws1:p1"
        isBusy={false}
        onSendKeys={() => {}}
        onOpenManage={() => {
          manageClicked = true
        }}
      />,
    )

    // Contains the thumb deck container, scroll container, and keys row
    expect(html).toContain('thumb-deck')
    expect(html).toContain('thumb-deck__scroll-container')
    expect(html).toContain('thumb-deck__keys-row')

    // Contains default primary keys
    for (const key of DEFAULT_PRIMARY_KEYS) {
      expect(html).toContain(`data-key="${key}"`)
    }

    // Contains the customize button with accessible label
    expect(html).toContain('aria-label="Manage key rail and custom actions"')
    expect(html).toContain('thumb-key-btn--manage')
    expect(manageClicked).toBe(false)
  })

  it('disables key buttons when isBusy is true or paneId is missing', () => {
    const disabledHtml = renderToStaticMarkup(
      <ThumbDeck paneId={null} isBusy={false} onSendKeys={() => {}} />,
    )
    expect(disabledHtml).toContain('disabled=""')

    const busyHtml = renderToStaticMarkup(
      <ThumbDeck paneId="ws1:p1" isBusy={true} onSendKeys={() => {}} />,
    )
    expect(busyHtml).toContain('disabled=""')
  })

  it('renders scoped persisted keys from storage for a workspace', () => {
    const customKeys = ['esc', 'ctrl+c', 'tab', 'shift+tab']
    setRailKeys(customKeys, 'sp-alpha', 'space')

    const html = renderToStaticMarkup(
      <ThumbDeck
        paneId="ws1:p1"
        isBusy={false}
        workspaceId="sp-alpha"
        onSendKeys={() => {}}
      />,
    )

    for (const key of customKeys) {
      expect(html).toContain(`data-key="${key}"`)
    }
  })

  it('subscribes to CUSTOM_ACTIONS_CHANGE_EVENT for same-scope rail updates without workspaceId changing', () => {
    const workspaceId = 'sp-live-editor'
    // Initial state: default primary keys
    expect(getRailKeys(workspaceId)).toEqual([...DEFAULT_PRIMARY_KEYS])

    let activeKeys = getRailKeys(workspaceId)
    // Simulate ThumbDeck same-scope subscriber
    const handleStorageChange = () => {
      activeKeys = getRailKeys(workspaceId)
    }

    globalThis.addEventListener(
      CUSTOM_ACTIONS_CHANGE_EVENT,
      handleStorageChange,
    )

    // User updates rail keys in editor for the SAME workspaceId (same scope)
    const newKeys = ['ctrl+d', 'ctrl+z', 'space', 'backspace']
    const setRes = setRailKeys(newKeys, workspaceId, 'space')
    expect(setRes.ok).toBe(true)

    // Subscriber must have received the event and updated activeKeys immediately
    expect(activeKeys).toEqual(newKeys)

    // Verify cleanup: when listener is removed, no further updates occur
    globalThis.removeEventListener(
      CUSTOM_ACTIONS_CHANGE_EVENT,
      handleStorageChange,
    )
    setRailKeys(['esc', 'enter'], workspaceId, 'space')
    expect(activeKeys).toEqual(newKeys)
  })
})
