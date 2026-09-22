import { afterEach, describe, expect, it } from 'bun:test'
import { ActionError, sendAction } from '../api-client.ts'
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

describe('api-client: sendAction ambiguity normalization', () => {
  it('normalizes network and aborted fetch failures to unknown ActionError', async () => {
    for (const error of [new TypeError('offline'), Object.assign(new Error('aborted'), { name: 'AbortError' })]) {
      globalThis.fetch = (async () => { throw error }) as unknown as typeof fetch
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
      new Response(JSON.stringify({ ok: true, outcome: 'invented' }), { status: 200 }),
      new Response(JSON.stringify({ ok: true, outcome: 'observed', result: null }), { status: 200 })
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
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: false,
      outcome: 'rejected',
      error: 'Last Tab cannot close'
    }), { status: 409 })) as unknown as typeof fetch

    await expect(sendAction(request)).rejects.toMatchObject({
      name: 'ActionError',
      status: 409,
      outcome: 'rejected',
      message: 'Last Tab cannot close'
    })
  })

  it('accepts a well-formed observed lifecycle response', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: true,
      outcome: 'observed',
      result: { workspaceId: 'ws-1' }
    }), { status: 200 })) as unknown as typeof fetch

    expect(await sendAction(request)).toEqual({
      ok: true,
      outcome: 'observed',
      result: { workspaceId: 'ws-1' }
    })
  })
})
