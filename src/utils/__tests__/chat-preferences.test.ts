import { expect, test } from 'bun:test'
import {
  DEFAULT_CHAT_PREFERENCES,
  sanitizeChatFontFamily,
  sanitizeChatPreferences
} from '../chat-preferences.ts'
import { chatPreferenceStyle } from '@/components/chat-preferences.tsx'
test('reference preferences reject bad values and keep safe complete font names', () => {
  expect(sanitizeChatPreferences(null)).toEqual(DEFAULT_CHAT_PREFERENCES)
  expect(
    sanitizeChatPreferences({
      fontSize: 100,
      fontFamily: 'A;<>',
      width: 'invalid',
      showThinking: 'yes'
    })
  ).toEqual({
    fontSize: 24,
    fontFamily: 'A',
    width: 'default',
    showThinking: false
  })
  expect(sanitizeChatPreferences({ fontSize: -100 })).toHaveProperty(
    'fontSize',
    11
  )
  expect(sanitizeChatFontFamily('JetBrains Mono, monospace')).toBe(
    '"JetBrains Mono", monospace'
  )
  expect(sanitizeChatFontFamily('"inherit", A')).toBe('"inherit", A')
})
test('consumer recipes reset A→B→A without stale width/family/size variables', () => {
  const a = chatPreferenceStyle(DEFAULT_CHAT_PREFERENCES)
  const b = chatPreferenceStyle({
    fontSize: 24,
    fontFamily: 'monospace',
    width: 'full',
    showThinking: true
  })
  expect(b).toHaveProperty('--chat-fs-body', '24px')
  expect(b).toHaveProperty('--chat-w', '100%')
  expect(b).toHaveProperty('--font-chat', 'monospace, var(--font-sans)')
  expect(chatPreferenceStyle(DEFAULT_CHAT_PREFERENCES)).toEqual(a)
  expect(a).not.toHaveProperty('--chat-fs-body')
})
