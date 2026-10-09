// MIT License - Copyright (c) 2026 devswha
// Scoped fields from pinned5979118 settings.ts/fontFamily.ts; no terminal changes.
export interface IChatPreferences {
  fontSize: number | null
  fontFamily: string
  width: 'narrow' | 'default' | 'wide' | 'full'
  showThinking: boolean
}
export const DEFAULT_CHAT_PREFERENCES: IChatPreferences = {
  fontSize: null,
  fontFamily: '',
  width: 'default',
  showThinking: false
}
export const CHAT_PREFERENCES_KEY = 'herdr-web-chat-preferences-v1'
const UNSAFE_CHARS = /[;{}<>\\\u0000-\u001f\u007f]/g
const IDENTIFIER = /^-?[A-Za-z_\u0080-\uffff][\w\u0080-\uffff-]*$/
const RESERVED = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'default'
])
export const sanitizeChatFontFamily = (value: unknown) => {
  if (typeof value !== 'string') return ''
  let result = ''
  for (const part of value
    .normalize('NFC')
    .replace(UNSAFE_CHARS, '')
    .split(',')) {
    const raw = part.trim(),
      quoted =
        raw.length >= 2 &&
        (raw[0] === '"' || raw[0] === "'") &&
        raw.at(-1) === raw[0]
    const name = (quoted ? raw.slice(1, -1) : raw)
      .replace(/["']/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name) continue
    const safe =
      quoted || !IDENTIFIER.test(name) || RESERVED.has(name.toLowerCase())
        ? `"${name}"`
        : name
    const next = result ? `${result}, ${safe}` : safe
    if (next.length > 256) break
    result = next
  }
  return result
}
export const sanitizeChatPreferences = (value: unknown): IChatPreferences => {
  const record =
    value && typeof value === 'object'
      ? (value as Partial<IChatPreferences>)
      : {}
  return {
    fontSize:
      typeof record.fontSize === 'number' && Number.isFinite(record.fontSize)
        ? Math.min(24, Math.max(11, Math.round(record.fontSize)))
        : null,
    fontFamily: sanitizeChatFontFamily(record.fontFamily),
    width: ['narrow', 'default', 'wide', 'full'].includes(record.width ?? '')
      ? record.width!
      : 'default',
    showThinking: record.showThinking === true
  }
}
