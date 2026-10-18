import { afterEach, describe, expect, it } from 'bun:test'
import { ActionError, fetchSnapshot, sendAction } from '../api-client.ts'
import type { IActionRequest } from '@/types/herdr.ts'

const request: IActionRequest = {
  type: 'workspace-close',
  operationId: 'op-test',
  target: {
    workspaceId: 'ws-1',
    expected: { tabIds: ['tab-1'], paneIds: ['pane-1'] }
  }
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe.each(['letta', 'pi'] as const)(
  '%s launch response contract',
  (kind) => {
    const launch: IActionRequest = {
      type: 'agent-start',
      operationId: 'launch',
      kind,
      name: 'agent',
      target: { paneId: 'pane:test', terminalId: 'term' }
    }
    it('accepts ACK without readiness but rejects replaced, malformed and unsupported success', async () => {
      const result = { paneId: 'pane:test', terminalId: 'term', ready: false }
      globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
        expect(JSON.parse(options.body as string)).toEqual(launch)
        return Response.json({ ok: true, outcome: 'acknowledged', result })
      }) as unknown as typeof fetch
      expect((await sendAction(launch)).result?.ready).toBe(false)
      for (const response of [
        { ok: true, outcome: 'observed', result },
        {
          ok: true,
          outcome: 'acknowledged',
          result: { ...result, terminalId: 'replaced' }
        },
        {
          ok: true,
          outcome: 'acknowledged',
          result: { ...result, ready: true }
        },
        {
          ok: true,
          outcome: 'acknowledged',
          result: {
            ...result,
            ready: true,
            agentSessionId: 'same',
            agentStatus: 'blocked'
          }
        }
      ]) {
        globalThis.fetch = (async () =>
          Response.json(response)) as unknown as typeof fetch
        await expect(sendAction(launch)).rejects.toMatchObject({
          outcome: 'unknown'
        })
      }
    })
  }
)

describe('snapshot read deadlines', () => {
  it('aborts and settles a hanging fetch within its deadline', async () => {
    let signal: AbortSignal | undefined
    globalThis.fetch = ((_url: unknown, options: RequestInit) => {
      signal = options.signal as AbortSignal
      expect(options.cache).toBe('no-store')
      return new Promise(() => {})
    }) as unknown as typeof fetch
    await expect(fetchSnapshot(undefined, 5)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(signal?.aborted).toBe(true)
  })

  it('bounds response-body stalls and external cancellation', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: () => new Promise(() => {})
    })) as unknown as typeof fetch
    await expect(fetchSnapshot(undefined, 5)).rejects.toMatchObject({
      name: 'AbortError'
    })
    const controller = new AbortController()
    const pending = fetchSnapshot(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('preserves the snapshot success contract', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        snapshot: { version: 'test' }
      })) as unknown as typeof fetch
    expect((await fetchSnapshot()).version).toBe('test')
  })
})

describe('api-client: sendAction ambiguity normalization', () => {
  it('normalizes network and aborted fetch failures to unknown ActionError', async () => {
    for (const error of [
      new TypeError('offline'),
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    ]) {
      globalThis.fetch = (async () => {
        throw error
      }) as unknown as typeof fetch
      try {
        await sendAction(request)
        expect.unreachable()
      } catch (caught) {
        expect(caught).toBeInstanceOf(ActionError)
        expect((caught as ActionError).outcome).toBe('unknown')
        expect((caught as ActionError).status).toBe(0)
      }
    }
  })

  it('normalizes malformed JSON and malformed success bodies to unknown', async () => {
    const responses = [
      new Response('not-json', { status: 200 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      new Response(JSON.stringify({ ok: true, outcome: 'invented' }), {
        status: 200
      }),
      new Response(
        JSON.stringify({ ok: true, outcome: 'observed', result: null }),
        { status: 200 }
      )
    ]
    for (const response of responses) {
      globalThis.fetch = (async () => response) as unknown as typeof fetch
      await expect(sendAction(request)).rejects.toMatchObject({
        name: 'ActionError',
        outcome: 'unknown'
      })
    }
  })

  it('preserves a rejected HTTP response outcome from the server', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          outcome: 'rejected',
          error: 'Last Tab cannot close'
        }),
        { status: 409 }
      )) as unknown as typeof fetch

    await expect(sendAction(request)).rejects.toMatchObject({
      name: 'ActionError',
      status: 409,
      outcome: 'rejected',
      message: 'Last Tab cannot close'
    })
  })

  it('accepts a well-formed observed lifecycle response', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          outcome: 'observed',
          result: { workspaceId: 'ws-1' }
        }),
        { status: 200 }
      )) as unknown as typeof fetch

    expect(await sendAction(request)).toEqual({
      ok: true,
      outcome: 'observed',
      result: { workspaceId: 'ws-1' }
    })
  })
})
