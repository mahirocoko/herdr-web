import { describe, expect, test } from 'bun:test'
import {
  CANONICAL_TERMINAL_KEYS,
  CANONICAL_TERMINAL_KEYS_SET,
  DEFAULT_PRIMARY_KEYS,
  EDITING_PRESET_KEYS,
  FULL_PRESET_KEYS,
  isCanonicalTerminalKey,
  KEY_PRESETS,
  TERMINAL_KEY_META_MAP,
  terminalKeyToControlInput,
} from '../terminal-keys.ts'

describe('terminal-keys: canonical contract and upstream Herdr 0.9.3 evidence', () => {
  test('CANONICAL_TERMINAL_KEYS defines all supported keys', () => {
    expect(CANONICAL_TERMINAL_KEYS.length).toBeGreaterThan(0)
    for (const key of CANONICAL_TERMINAL_KEYS) {
      expect(CANONICAL_TERMINAL_KEYS_SET.has(key)).toBe(true)
      expect(isCanonicalTerminalKey(key)).toBe(true)
      expect(TERMINAL_KEY_META_MAP[key]).toBeDefined()
      expect(TERMINAL_KEY_META_MAP[key].label.length).toBeGreaterThan(0)
    }
  })

  test('strictly denies "delete" and "del" as unsupported by upstream Herdr 0.9.3 parser', () => {
    // Upstream Herdr parse_key_combo (src/config/keybinds.rs) does not recognize delete/del.
    expect(CANONICAL_TERMINAL_KEYS_SET.has('delete' as any)).toBe(false)
    expect(CANONICAL_TERMINAL_KEYS_SET.has('del' as any)).toBe(false)
    expect(isCanonicalTerminalKey('delete')).toBe(false)
    expect(isCanonicalTerminalKey('del')).toBe(false)
    expect(terminalKeyToControlInput('delete')).toBeNull()
  })

  test('includes extended screenshot and navigation keys', () => {
    const requiredKeys = [
      'shift+tab',
      'ctrl+d',
      'ctrl+l',
      'ctrl+z',
      'ctrl+r',
      'ctrl+a',
      'ctrl+e',
      'ctrl+w',
      'ctrl+u',
      'space',
      'backspace',
      'esc',
      'tab',
      'enter',
      'ctrl+c',
      'up',
      'down',
      'left',
      'right',
    ]
    for (const key of requiredKeys) {
      expect(CANONICAL_TERMINAL_KEYS_SET.has(key as any)).toBe(true)
      expect(isCanonicalTerminalKey(key)).toBe(true)
    }
  })

  test('maps canonical keys correctly to terminal control input strings', () => {
    expect(terminalKeyToControlInput('shift+tab')).toBe('\x1b[Z')
    expect(terminalKeyToControlInput('ctrl+c')).toBe('\x03')
    expect(terminalKeyToControlInput('ctrl+d')).toBe('\x04')
    expect(terminalKeyToControlInput('ctrl+l')).toBe('\x0c')
    expect(terminalKeyToControlInput('ctrl+z')).toBe('\x1a')
    expect(terminalKeyToControlInput('ctrl+r')).toBe('\x12')
    expect(terminalKeyToControlInput('ctrl+a')).toBe('\x01')
    expect(terminalKeyToControlInput('ctrl+e')).toBe('\x05')
    expect(terminalKeyToControlInput('ctrl+w')).toBe('\x17')
    expect(terminalKeyToControlInput('ctrl+u')).toBe('\x15')
    expect(terminalKeyToControlInput('esc')).toBe('\x1b')
    expect(terminalKeyToControlInput('tab')).toBe('\t')
    expect(terminalKeyToControlInput('enter')).toBe('\r')
    expect(terminalKeyToControlInput('space')).toBe(' ')
    expect(terminalKeyToControlInput('backspace')).toBe('\x7f')
    expect(terminalKeyToControlInput('up')).toBe('\x1b[A')
    expect(terminalKeyToControlInput('down')).toBe('\x1b[B')
    expect(terminalKeyToControlInput('left')).toBe('\x1b[D')
    expect(terminalKeyToControlInput('right')).toBe('\x1b[C')
  })

  test('presets contain only canonical keys', () => {
    for (const key of DEFAULT_PRIMARY_KEYS) {
      expect(isCanonicalTerminalKey(key)).toBe(true)
    }
    for (const key of EDITING_PRESET_KEYS) {
      expect(isCanonicalTerminalKey(key)).toBe(true)
    }
    for (const key of FULL_PRESET_KEYS) {
      expect(isCanonicalTerminalKey(key)).toBe(true)
    }
    for (const preset of KEY_PRESETS) {
      expect(preset.keys.length).toBeGreaterThan(0)
      for (const k of preset.keys) {
        expect(isCanonicalTerminalKey(k)).toBe(true)
      }
    }
  })
})
