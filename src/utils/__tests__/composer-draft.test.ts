// Memory/storage fixture and lifecycle cases adapted from upstream composerDraft.test.ts (MIT).
import { expect, test } from 'bun:test'
import {
  ComposerDraftStore,
  composerDraftScope,
  DRAFT_STORAGE_KEY,
  MAX_DRAFT_BYTES
} from '../composer-draft.ts'
const a = composerDraftScope('a', 'terminal', 'session')!
const b = composerDraftScope('b', 'terminal', 'session')!
const fixture = () => {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    }
  }
  return { data, storage, store: new ComposerDraftStore(() => storage) }
}
test('A to B to A and reload preserve only exact pane/terminal/session drafts', () => {
  const { store, storage } = fixture()
  store.set(a, 'first')
  store.set(b, 'second')
  expect(store.read(a).text).toBe('first')
  const restored = new ComposerDraftStore(() => storage)
  expect(restored.read(a).text).toBe('first')
  expect(restored.read(b).text).toBe('second')
  expect(
    restored.read(composerDraftScope('a', 'replacement', 'session')).text
  ).toBe('')
  restored.set(a, '')
  expect(new ComposerDraftStore(() => storage).read(a).text).toBe('')
})
test('clear and retype advance revision even for identical text; subscribers see edits', () => {
  const { store } = fixture()
  let updates = 0
  const off = store.subscribe(() => {
    updates++
  })
  store.set(a, 'same')
  const revision = store.read(a).revision
  store.set(a, '')
  store.set(a, 'same')
  expect(store.read(a).revision).toBeGreaterThan(revision)
  expect(updates).toBe(3)
  off()
})
test('storage failure retains memory and truthfully reports memory-only', () => {
  const store = new ComposerDraftStore(() => {
    throw new Error('blocked')
  })
  store.set(a, 'newer')
  expect(store.read(a).text).toBe('newer')
  expect(store.read(a).memoryOnly).toBe(true)
})
test('rejects corrupt, foreign, oversize storage atomically', () => {
  for (const raw of [
    'not json',
    JSON.stringify({ version: 2, drafts: [] }),
    JSON.stringify({ version: 1, drafts: [['foreign', 'secret']] }),
    JSON.stringify({
      version: 1,
      drafts: [[a, 'a'.repeat(MAX_DRAFT_BYTES + 1)]]
    })
  ]) {
    const { data, store } = fixture()
    data.set(DRAFT_STORAGE_KEY, raw)
    expect(store.read(a).text).toBe('')
    expect(store.read(a).memoryOnly).toBe(true)
  }
})
test('UTF-8 limit rejects Thai oversize without destroying prior edits', () => {
  const { store } = fixture()
  expect(store.set(a, 'ก'.repeat(1365))).toBe(true)
  expect(store.set(a, 'ก'.repeat(1366))).toBe(false)
  expect(store.read(a).text).toBe('ก'.repeat(1365))
  expect(store.set(null, 'text')).toBe(false)
})
