import { afterEach, describe, expect, test } from 'bun:test'
import { fetchJsonWithTimeout } from '../push-client.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('push client whole-response deadline', () => {
  test('bounds a stalled JSON response body under the same request deadline', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => {})
    })) as unknown as typeof fetch

    const startedAt = Date.now()
    await expect(fetchJsonWithTimeout('/api/push/config', {}, 15)).rejects.toThrow(
      'Push request timed out'
    )
    expect(Date.now() - startedAt).toBeLessThan(250)
  })
})
