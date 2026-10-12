import { expect, test, spyOn } from 'bun:test'
import { HeldQueue } from '../held-queue.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import { validateActionRequest } from '../security.ts'
import { InteractivePromptService } from '../interactive-prompt.ts'
import type { ISnapshotResult } from '../types.ts'
const target = {
  paneId: 'ws:p1',
  terminalId: 't1',
  expectedMode: 'agent' as const,
  agentSessionId: 's1'
}
const capability = 'a'.repeat(64)
const fixture = () => {
  const queue = new HeldQueue()
  let writes: string[] = []
  let snapshot = {
    panes: [
      {
        pane_id: 'ws:p1',
        terminal_id: 't1',
        agent: 'codex',
        agent_status: 'working',
        agent_session: { value: 's1' }
      }
    ],
    workspaces: [],
    tabs: [],
    agents: []
  } as unknown as ISnapshotResult
  const deps = {
    coordinator: new OperationCoordinator({ maxEntries: 1 }),
    snapshot: async () => snapshot,
    ready: async () => true,
    prompt: async (_pane: string, text: string) => {
      writes.push(text)
    }
  }
  const act = (
    action: Parameters<HeldQueue['action']>[0],
    cap = capability,
    owner = 'owner',
    origin = 'http://localhost:8787'
  ) => queue.action(action, cap, owner, origin, deps)
  const enqueue = async () =>
    (
      await (
        await act({
          type: 'held-enqueue',
          operationId: crypto.randomUUID(),
          target,
          text: 'stored text'
        })
      ).json()
    ).result.heldId as string
  return {
    act,
    enqueue,
    deps,
    writes,
    replace: () => {
      snapshot = {
        ...snapshot,
        panes: snapshot.panes.map((pane) => ({
          ...pane,
          terminal_id: 'replaced'
        }))
      }
    }
  }
}
test('enqueue inert, public IDs do not authorize another document/owner/origin, stored text dispatches only once beyond cache eviction', async () => {
  const f = fixture(),
    heldId = await f.enqueue()
  expect(f.writes).toEqual([])
  const send = () => ({
    type: 'held-send' as const,
    operationId: crypto.randomUUID(),
    heldId
  })
  expect((await f.act(send(), 'b'.repeat(64))).status).toBe(404)
  expect((await f.act(send(), capability, 'other')).status).toBe(404)
  expect(
    (await f.act(send(), capability, 'owner', 'https://other')).status
  ).toBe(404)
  expect((await f.act(send())).status).toBe(200)
  await f.enqueue() // evicts prior coordinator receipt
  expect((await f.act(send())).status).toBe(409)
  expect(f.writes).toEqual(['stored text'])
})
test('send/discard race claims synchronously before snapshot await; one winner', async () => {
  const f = fixture(),
    heldId = await f.enqueue()
  let release!: (snapshot: ISnapshotResult) => void
  const prior = await f.deps.snapshot()
  f.deps.snapshot = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const send = f.act({ type: 'held-send', operationId: 'send', heldId })
  expect(
    (await f.act({ type: 'held-discard', operationId: 'discard', heldId }))
      .status
  ).toBe(409)
  f.deps.snapshot = async () => prior
  release(prior)
  expect((await send).status).toBe(200)
  expect(f.writes.length).toBe(1)
})
test('zero-write readiness can explicitly retry; possible-write unknown never retries; replacement invalidates', async () => {
  const f = fixture(),
    heldId = await f.enqueue()
  f.deps.ready = async () => false
  expect(
    (await f.act({ type: 'held-send', operationId: 'not-ready', heldId }))
      .status
  ).toBe(409)
  expect(f.writes.length).toBe(0)
  f.deps.ready = async () => true
  f.deps.prompt = async () => {
    f.writes.push('possible write')
    throw new Error('timeout')
  }
  expect(
    (await f.act({ type: 'held-send', operationId: 'unknown', heldId })).status
  ).toBe(502)
  expect(
    (await f.act({ type: 'held-send', operationId: 'retry', heldId })).status
  ).toBe(409)
  expect(f.writes.length).toBe(1)
  const nextId = await f.enqueue()
  f.replace()
  expect(
    (
      await f.act({
        type: 'held-send',
        operationId: 'replacement',
        heldId: nextId
      })
    ).status
  ).toBe(409)
  expect(f.writes.length).toBe(1)
})
test('discard is inert; restart old IDs fail closed; strict payload uses UTF8 bound', async () => {
  const f = fixture(),
    heldId = await f.enqueue()
  expect(
    (await f.act({ type: 'held-discard', operationId: 'discard', heldId }))
      .status
  ).toBe(200)
  expect(
    (await f.act({ type: 'held-send', operationId: 'after-discard', heldId }))
      .status
  ).toBe(409)
  expect(
    (
      await new HeldQueue().action(
        { type: 'held-send', operationId: 'restart', heldId },
        capability,
        'owner',
        'http://localhost:8787',
        f.deps
      )
    ).status
  ).toBe(404)
  expect(f.writes.length).toBe(0)
  expect(
    validateActionRequest({
      type: 'held-send',
      operationId: 'x',
      heldId,
      text: 'replacement'
    }).valid
  ).toBe(false)
  expect(
    validateActionRequest({
      type: 'held-enqueue',
      operationId: 'x',
      target,
      text: 'ก'.repeat(1400)
    }).valid
  ).toBe(false)
})
test('existing prompt service refuses unread, unknown, unsupported and interactive input without writes', async () => {
  const f = fixture()
  const snapshot = await f.deps.snapshot()
  let screen = 'Working on the requested task'
  const service = new InteractivePromptService({
    fetchSnapshot: async () => snapshot,
    readScreen: async () => screen
  })
  expect(await service.heldReadiness(target)).toBe(true)
  screen = ''
  expect(await service.heldReadiness(target)).toBe(false)
  screen =
    'Would you like to run the following command?\necho test\n› 1. Yes, proceed\n  2. No, cancel\nPress enter to confirm or esc to cancel\n'
  expect(await service.heldReadiness(target)).toBe(false)
  screen = 'Working'
  snapshot.panes[0].agent_status = 'unknown'
  expect(await service.heldReadiness(target)).toBe(false)
  snapshot.panes[0].agent_status = 'working'
  snapshot.panes[0].agent = 'unrecognized-provider'
  expect(await service.heldReadiness(target)).toBe(false)
  expect(f.writes.length).toBe(0)
})

test('global 256 bound across documents and expiry fail closed without dispatch', async () => {
  const f = fixture()
  for (let i = 0; i < 256; i++) {
    const response = await f.act(
      {
        type: 'held-enqueue',
        operationId: `global-${i}`,
        target,
        text: 'held'
      },
      Math.floor(i / 32)
        .toString(16)
        .repeat(64)
    )
    expect(response.status).toBe(200)
  }
  expect(
    (
      await f.act(
        { type: 'held-enqueue', operationId: 'overflow', target, text: 'held' },
        'f'.repeat(64)
      )
    ).status
  ).toBe(409)
  const now = Date.now()
  const clock = spyOn(Date, 'now').mockReturnValue(now + 30 * 60 * 1000 + 1)
  try {
    expect(
      (
        await f.act({
          type: 'held-enqueue',
          operationId: 'after-expiry',
          target,
          text: 'held'
        })
      ).status
    ).toBe(200)
    expect(f.writes.length).toBe(0)
  } finally {
    clock.mockRestore()
  }
  const separate = fixture(),
    heldId = await separate.enqueue()
  const expiryClock = spyOn(Date, 'now').mockReturnValue(
    now + 30 * 60 * 1000 + 1000
  )
  try {
    expect(
      (
        await separate.act({
          type: 'held-send',
          operationId: 'expired',
          heldId
        })
      ).status
    ).toBe(404)
    expect(separate.writes.length).toBe(0)
  } finally {
    expiryClock.mockRestore()
  }
})

test('per-document 32 limit is bounded including terminal records', async () => {
  const f = fixture()
  for (let i = 0; i < 32; i++) await f.enqueue()
  const result = await f.act({
    type: 'held-enqueue',
    operationId: 'limit',
    target,
    text: 'extra'
  })
  expect(result.status).toBe(409)
  expect(f.writes.length).toBe(0)
})
