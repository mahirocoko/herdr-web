import { expect, test } from 'bun:test'
import {
  heldProjection,
  restoreHeldMessages,
  saveHeldMessages
} from '../held-messages.ts'
import { sameSubmissionTarget } from '../chat-submissions.ts'
import { readFileSync } from 'node:fs'
const record = {
  operationId: 'enqueue-original',
  heldId: 'a'.repeat(64),
  text: 'Unsent original text',
  target: {
    paneId: 'ws:p1',
    terminalId: 't1',
    agentSessionId: 's1',
    expectedMode: 'agent' as const
  },
  state: 'held'
}
test('held projection roundtrip preserves text/opid but never document authority or injected fields', () => {
  const raw = saveHeldMessages([
    { ...record, capability: 'secret', restored: false } as typeof record
  ])
  expect(raw).not.toContain('secret')
  expect(raw).not.toContain('capability')
  const rows = restoreHeldMessages(raw)
  expect(rows[0]).toEqual({ ...record, restored: true })
  expect(
    restoreHeldMessages(
      JSON.stringify([{ ...record, restored: false, capability: 'secret' }])
    )[0].restored
  ).toBe(true)
  expect(
    restoreHeldMessages(saveHeldMessages([{ ...record, state: 'sending' }]))[0]
      .state
  ).toBe('uncertain')
})
test('projection recovery validates UTF8 bytes, count, target and corrupt storage', () => {
  expect(restoreHeldMessages('{')).toEqual([])
  expect(restoreHeldMessages(JSON.stringify(Array(129).fill(record)))).toEqual(
    []
  )
  expect(
    restoreHeldMessages(JSON.stringify([{ ...record, text: 'ก'.repeat(1400) }]))
  ).toEqual([])
  expect(
    restoreHeldMessages(
      JSON.stringify([
        { ...record, target: { ...record.target, expectedMode: 'shell' } }
      ])
    )
  ).toEqual([])
  expect(JSON.parse(saveHeldMessages(Array(140).fill(record))).length).toBe(128)
})
test('production hook refresh recovers original enqueue projection without write; restored act refuses', async () => {
  const source = readFileSync(
    new URL('../../hooks/use-held-messages.ts', import.meta.url),
    'utf8'
  )
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.slice(
      source.indexOf('  const refresh ='),
      source.indexOf('  const dismiss =')
    )
  )
  let reads = 0,
    writes = 0
  const patches: unknown[] = []
  const functions = new Function(
    'active',
    'patch',
    'readHeldMessages',
    'heldProjection',
    'sameSubmissionTarget',
    'secret',
    'sendAction',
    'ActionError',
    `${compiled}; return {refresh, act}`
  )(
    { current: new Set() },
    (_id: string, fields: unknown) => patches.push(fields),
    async () => {
      reads++
      return [record]
    },
    heldProjection,
    sameSubmissionTarget,
    () => 'memory-only-secret',
    async () => {
      writes++
    },
    class extends Error {}
  )
  await functions.refresh({
    ...record,
    heldId: undefined,
    state: 'enqueue-unknown'
  })
  expect(reads).toBe(1)
  expect(patches).toEqual([
    { heldId: record.heldId, state: 'held', error: undefined }
  ])
  await functions.act({ ...record, restored: true }, 'held-send')
  await functions.act({ ...record, restored: true }, 'held-discard')
  await functions.refresh({ ...record, restored: true })
  expect(reads).toBe(1)
  expect(writes).toBe(0)
})

test('production UI guards restored/stale Send and labels informational dismissal scope; hook never sends on refresh', () => {
  const chat = readFileSync(
    new URL('../../components/chat-view.tsx', import.meta.url),
    'utf8'
  )
  expect(chat).toContain('!record.restored')
  expect(chat).toContain('sameSubmissionTarget(record.target, actionTarget)')
  expect(chat).toContain('Restored informational copy')
  expect(chat).toContain('Clear saved receipts (all panes)')
  expect(chat).toContain(
    'Removes Web evidence only; does not cancel native input.'
  )
  expect(chat).toContain('Dismiss saved copy')
  const hook = readFileSync(
    new URL('../../hooks/use-held-messages.ts', import.meta.url),
    'utf8'
  )
  const refresh = hook.slice(
    hook.indexOf('  const refresh ='),
    hook.indexOf('  const act =')
  )
  expect(refresh).toContain('readHeldMessages')
  expect(refresh).not.toContain('sendAction')
  expect(hook).toContain("'enqueue-unknown'")
})
