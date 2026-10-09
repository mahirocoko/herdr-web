import { expect, test } from 'bun:test'
import { dragDismisses, tapDismisses } from '../chat-keyboard.ts'
test('source reading gesture preserves selection and horizontal/control gestures', () => {
  expect(dragDismisses(1, 32)).toBe(true)
  expect(dragDismisses(33, 32)).toBe(false)
  expect(dragDismisses(0, 31)).toBe(false)
  expect(tapDismisses(null, 'selected')).toBe(false)
  expect(tapDismisses(null, '')).toBe(true)
  expect(
    tapDismisses({ closest: () => ({}) } as unknown as EventTarget, '')
  ).toBe(false)
})
