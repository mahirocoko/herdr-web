import { describe, expect, it } from 'bun:test'
import { bridgeStatusIsHealthy } from '../bridge-status.ts'

describe('bridgeStatusIsHealthy', () => {
  it('is healthy only after the backend reports connected', () => {
    expect(bridgeStatusIsHealthy('connected')).toBe(true)
    for (const status of ['open', 'connecting', 'reconnecting', 'disconnected', 'error', 'close', undefined]) {
      expect(bridgeStatusIsHealthy(status)).toBe(false)
    }
  })
})
