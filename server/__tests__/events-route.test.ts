import { describe, expect, it } from 'bun:test'
import { createServer } from '../index.ts'

describe('/api/events transport availability', () => {
  it('rejects an unauthorized origin before disclosing CLI transport mode', async () => {
    const originalTransport = process.env.HERDR_TRANSPORT
    process.env.HERDR_TRANSPORT = 'cli'
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/events`, {
        headers: {
          origin: 'https://attacker.example'
        }
      })
      expect(response.status).toBe(403)
    } finally {
      server.stop(true)
      if (originalTransport === undefined) delete process.env.HERDR_TRANSPORT
      else process.env.HERDR_TRANSPORT = originalTransport
    }
  })

  it('returns a non-upgrade response in explicit CLI mode', async () => {
    const originalTransport = process.env.HERDR_TRANSPORT
    process.env.HERDR_TRANSPORT = 'cli'
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/events`, {
        headers: {
          origin: `http://127.0.0.1:${server.port}`
        }
      })
      expect(response.status).toBe(409)
      expect(await response.text()).toContain('HTTP snapshot polling')
    } finally {
      server.stop(true)
      if (originalTransport === undefined) delete process.env.HERDR_TRANSPORT
      else process.env.HERDR_TRANSPORT = originalTransport
    }
  })
})
