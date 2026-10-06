export const CANONICAL_TERMINAL_KEYS = [
  'esc',
  'tab',
  'shift+tab',
  'enter',
  'space',
  'backspace',
  'ctrl+c',
  'ctrl+d',
  'ctrl+l',
  'ctrl+z',
  'ctrl+r',
  'ctrl+a',
  'ctrl+e',
  'ctrl+w',
  'ctrl+u',
  'up',
  'down',
  'left',
  'right',
] as const

export type CanonicalTerminalKey = (typeof CANONICAL_TERMINAL_KEYS)[number]
export type ICanonicalTerminalKey = CanonicalTerminalKey

export const CANONICAL_TERMINAL_KEYS_SET: ReadonlySet<string> = new Set(
  CANONICAL_TERMINAL_KEYS,
)

export interface ITerminalKeyMeta {
  key: CanonicalTerminalKey
  label: string
  ariaLabel: string
}

export const TERMINAL_KEY_META_MAP: Record<
  ICanonicalTerminalKey,
  { label: string; ariaLabel: string }
> = {
  esc: { label: 'ESC', ariaLabel: 'Send key Escape' },
  tab: { label: 'TAB', ariaLabel: 'Send key Tab' },
  'shift+tab': { label: 'SHIFT+TAB', ariaLabel: 'Send key Shift+Tab Backtab' },
  enter: { label: 'ENTER', ariaLabel: 'Send terminal Enter key' },
  space: { label: 'SPACE', ariaLabel: 'Send key Space' },
  backspace: { label: 'BKSP', ariaLabel: 'Send key Backspace' },
  'ctrl+c': { label: 'CTRL+C', ariaLabel: 'Send key Ctrl+C' },
  'ctrl+d': { label: 'CTRL+D', ariaLabel: 'Send key Ctrl+D' },
  'ctrl+l': { label: 'CTRL+L', ariaLabel: 'Send key Ctrl+L' },
  'ctrl+z': { label: 'CTRL+Z', ariaLabel: 'Send key Ctrl+Z' },
  'ctrl+r': { label: 'CTRL+R', ariaLabel: 'Send key Ctrl+R' },
  'ctrl+a': { label: 'CTRL+A', ariaLabel: 'Send key Ctrl+A' },
  'ctrl+e': { label: 'CTRL+E', ariaLabel: 'Send key Ctrl+E' },
  'ctrl+w': { label: 'CTRL+W', ariaLabel: 'Send key Ctrl+W' },
  'ctrl+u': { label: 'CTRL+U', ariaLabel: 'Send key Ctrl+U' },
  up: { label: '↑', ariaLabel: 'Send key Arrow Up' },
  down: { label: '↓', ariaLabel: 'Send key Arrow Down' },
  left: { label: '←', ariaLabel: 'Send key Arrow Left' },
  right: { label: '→', ariaLabel: 'Send key Arrow Right' },
}

export const DEFAULT_PRIMARY_KEYS: readonly CanonicalTerminalKey[] = [
  'esc',
  'tab',
  'ctrl+c',
  'up',
  'down',
  'enter',
]

export const EDITING_PRESET_KEYS: readonly CanonicalTerminalKey[] = [
  'esc',
  'tab',
  'shift+tab',
  'ctrl+c',
  'ctrl+d',
  'ctrl+z',
  'space',
  'backspace',
  'enter',
  'up',
  'down',
]

export const FULL_PRESET_KEYS: readonly CanonicalTerminalKey[] = [
  ...CANONICAL_TERMINAL_KEYS,
]

export const KEY_PRESETS: {
  id: string
  label: string
  keys: readonly CanonicalTerminalKey[]
}[] = [
  { id: 'default', label: 'Default (6 keys)', keys: DEFAULT_PRIMARY_KEYS },
  {
    id: 'editing',
    label: 'Navigation & Editing (11 keys)',
    keys: EDITING_PRESET_KEYS,
  },
  { id: 'full', label: 'Full Terminal (19 keys)', keys: FULL_PRESET_KEYS },
]

export const isValidTerminalKey = (
  key: unknown,
): key is CanonicalTerminalKey => {
  if (typeof key !== 'string') return false
  return CANONICAL_TERMINAL_KEYS_SET.has(key.toLowerCase().trim())
}

export const isCanonicalTerminalKey = isValidTerminalKey

/**
 * Control frame mapping for terminal control mode (mapping canonical keys to their ANSI/control byte sequence).
 * Excludes raw arbitrary shell authority; handles only validated canonical keys.
 */
export const terminalKeyToControlInput = (key: string): string | null => {
  const normalized = key.toLowerCase().trim()
  switch (normalized) {
    case 'esc':
      return '\x1b'
    case 'tab':
      return '\t'
    case 'shift+tab':
      return '\x1b[Z'
    case 'enter':
      return '\r'
    case 'space':
      return ' '
    case 'backspace':
      return '\x7f'
    case 'ctrl+c':
      return '\x03'
    case 'ctrl+d':
      return '\x04'
    case 'ctrl+l':
      return '\x0c'
    case 'ctrl+z':
      return '\x1a'
    case 'ctrl+r':
      return '\x12'
    case 'ctrl+a':
      return '\x01'
    case 'ctrl+e':
      return '\x05'
    case 'ctrl+w':
      return '\x17'
    case 'ctrl+u':
      return '\x15'
    case 'up':
      return '\x1b[A'
    case 'down':
      return '\x1b[B'
    case 'right':
      return '\x1b[C'
    case 'left':
      return '\x1b[D'
    default:
      return null
  }
}
