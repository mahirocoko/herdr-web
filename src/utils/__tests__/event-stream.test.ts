import { describe, expect, it } from 'bun:test'
import { parseServerEventMessage } from '../event-stream.ts'

describe('event-stream helper', () => {
  it('parses valid snapshot event messages', () => {
    const raw = JSON.stringify({
      type: 'snapshot',
      data: {
        protocol: 22,
        version: '0.9.1',
        workspaces: [],
        tabs: [],
        panes: []
      }
    })

    const parsed = parseServerEventMessage(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.type).toBe('snapshot')
    if (parsed?.type === 'snapshot') {
      expect(parsed.data.protocol).toBe(22)
      expect(parsed.data.version).toBe('0.9.1')
    }
  })

  it('parses valid status event messages', () => {
    const raw = JSON.stringify({
      type: 'status',
      status: 'connected'
    })

    const parsed = parseServerEventMessage(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.type).toBe('status')
    if (parsed?.type === 'status') {
      expect(parsed.status).toBe('connected')
    }
  })

  it('rejects invalid or malformed event messages', () => {
    expect(parseServerEventMessage('')).toBeNull()
    expect(parseServerEventMessage('{invalid-json')).toBeNull()
    expect(parseServerEventMessage(JSON.stringify({ type: 'unknown_type' }))).toBeNull()
    expect(parseServerEventMessage(JSON.stringify({ type: 'snapshot', data: null }))).toBeNull()
    expect(parseServerEventMessage(JSON.stringify({ type: 'status', status: 'invalid_status' }))).toBeNull()
  })
})
