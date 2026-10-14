import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatPreferences } from '../chat-preferences.tsx'
import { DEFAULT_CHAT_PREFERENCES } from '@/utils/chat-preferences.ts'
import { Turn } from '../chat-view.tsx'
import { ChatMatchSource } from '../chat-find.tsx'

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

test('Settings Chat uses source group/row anatomy with canonical controls and truthful document-memory warning', () => {
  const html = renderToStaticMarkup(
    createElement(ChatPreferences, {
      preferences: {
        ...DEFAULT_CHAT_PREFERENCES,
        fontFamily: 'Unavailable Font',
        showThinking: true
      },
      onChange: () => {},
      storageError: true
    })
  )
  expect(html).toContain('>Chat</h2>')
  expect(html).toContain('chat-settings-card')
  expect(html.match(/class="chat-settings-row(?: is-wide)?"/g)?.length).toBe(4)
  expect(html).toContain('ui-select')
  expect(html).toContain('ui-input')
  expect(html).toContain('ui-checkbox')
  expect(html).toContain('Reset Chat appearance')
  expect(html).toContain(
    'Preference changed for this document; browser storage is unavailable.'
  )
  expect(html).not.toContain('<details')
  const owner = source('../chat-preferences.tsx')
  expect(owner).toContain('length: 14')
  expect(owner).toContain('i + 11')
  expect(owner).toContain("['narrow', 'default', 'wide', 'full']")
  expect(owner).toContain('event.nativeEvent.isComposing')
  expect(owner).toContain('event.nativeEvent.keyCode === 229')
})

test('one Root preference instance is handed through existing outlet context to Settings and Chat without a route reread', () => {
  const root = source('../../../app/root.tsx')
  const chat = source('../chat-view.tsx')
  const app = source('../../app.tsx')
  const settings = source('../../../app/routes/settings.tsx')
  expect(root.match(/= useChatPreferences\(\)/g)?.length).toBe(1)
  expect(root).toContain(
    'chatPreferences: ReturnType<typeof useChatPreferences>'
  )
  expect(settings).toContain('chatPreferences={chatPreferences}')
  expect(app).toContain('preferences={chatPreferences.preferences}')
  expect(chat).not.toContain('useChatPreferences(')
  expect(chat).not.toContain('<ChatPreferences')
  expect(chat).toContain('onRecordedMetadata(')
  expect(chat).toContain('onRecordedMetadata(null)')
  expect(app).toContain('onRecordedMetadata={setRecordedMetadata}')
})

test('selected row remains identified and folded while the sole source passage belongs to Find', () => {
  const text = 'first line\n'.repeat(20) + 'ข้อความไทย'
  const match = {
    rowKey: 'long-user',
    start: text.indexOf('ข้อความไทย'),
    end: text.length
  }
  const row = renderToStaticMarkup(
    createElement(Turn, {
      live: false,
      waiting: false,
      sourcePreview: false,
      turn: {
        id: 'long-user',
        role: 'user',
        ts: null,
        parts: [{ kind: 'text', text }]
      },
      match
    })
  )
  const preview = renderToStaticMarkup(
    createElement(ChatMatchSource, { text, match })
  )
  expect(row).toContain('data-chat-match=""')
  expect(row).toContain('chat-bubble is-capped')
  expect(row).not.toContain('chat-match-source')
  expect(preview).toContain('<mark>ข้อความไทย</mark>')
  const find = source('../chat-find.tsx')
  expect(find.indexOf('{match &&')).toBeGreaterThan(find.indexOf('{error &&'))
  const chat = source('../chat-view.tsx')
  expect(chat).toContain('sourcePreview={false}')
  expect(chat).toContain("'.chat-find .chat-match-source mark'")
  expect(chat).toContain('if (!disclosureChanged.current) return')
})
