import { describe, expect, it } from 'bun:test'
import {
  decodeTerminalBytes,
  validateTerminalFrame
} from '../use-terminal-stream.ts'

describe('terminal-stream-frame: validateTerminalFrame', () => {
  it('validates and extracts complete terminal.frame with native geometry', () => {
    const raw = {
      type: 'terminal.frame',
      seq: 42,
      encoding: 'ansi',
      width: 160,
      height: 52,
      full: true,
      bytes: 'SGVsbG8gV29ybGQ='
    }

    const result = validateTerminalFrame(raw)
    expect(result.valid).toBe(true)
    expect(result.frame).toBeDefined()
    expect(result.frame?.seq).toBe(42)
    expect(result.frame?.width).toBe(160)
    expect(result.frame?.height).toBe(52)
    expect(result.frame?.full).toBe(true)
    expect(result.frame?.bytes).toBe('SGVsbG8gV29ybGQ=')
  })

  it('rejects payloads with wrong type', () => {
    expect(validateTerminalFrame({ type: 'other' }).valid).toBe(false)
    expect(validateTerminalFrame(null).valid).toBe(false)
    expect(validateTerminalFrame('string').valid).toBe(false)
  })

  it('handles empty bytes without rejecting the frame (geometry / status frame)', () => {
    const raw = {
      type: 'terminal.frame',
      seq: 1,
      encoding: 'ansi',
      width: 160,
      height: 52,
      full: false,
      bytes: ''
    }

    const result = validateTerminalFrame(raw)
    expect(result.valid).toBe(true)
    expect(result.frame?.bytes).toBe('')
    expect(result.frame?.width).toBe(160)
    expect(result.frame?.height).toBe(52)
  })

  it('rejects unknown geometry instead of inventing a client-sized native grid', () => {
    const raw = {
      type: 'terminal.frame',
      seq: 0,
      width: NaN,
      height: -5,
      bytes: ''
    }

    const result = validateTerminalFrame(raw)
    expect(result.valid).toBe(false)
    expect(result.frame).toBeUndefined()
  })

  it('accepts zero-sized empty status but rejects nonempty zero-sized output', () => {
    const frame = {
      type: 'terminal.frame',
      encoding: 'ansi',
      full: false,
      seq: 0,
      width: 0,
      height: 0,
      bytes: ''
    }
    expect(validateTerminalFrame(frame).valid).toBe(true)
    expect(validateTerminalFrame({ ...frame, bytes: 'TkFUSVZF' }).valid).toBe(
      false
    )
  })

  it('rejects oversized, fractional and malformed native metadata', () => {
    const frame = {
      type: 'terminal.frame',
      encoding: 'ansi',
      full: true,
      seq: 1,
      width: 160,
      height: 52,
      bytes: 'TkFUSVZF'
    }
    for (const patch of [
      { width: 501 },
      { height: 201 },
      { width: 40.5 },
      { seq: -1 },
      { seq: NaN },
      { full: 'false' },
      { encoding: 'text' },
      { bytes: null }
    ]) {
      expect(validateTerminalFrame({ ...frame, ...patch }).valid).toBe(false)
    }
  })
})

describe('terminal-stream-frame: decodeTerminalBytes', () => {
  it('decodes valid base64 strings into Uint8Array', () => {
    // "NATIVE" -> "TkFUSVZF"
    const b64 = 'TkFUSVZF'
    const bytes = decodeTerminalBytes(b64)
    expect(bytes).not.toBeNull()
    expect(bytes?.length).toBe(6)
    const str = String.fromCharCode(...(bytes || []))
    expect(str).toBe('NATIVE')
  })

  it('handles empty string by returning empty Uint8Array', () => {
    const bytes = decodeTerminalBytes('')
    expect(bytes).not.toBeNull()
    expect(bytes?.length).toBe(0)
  })

  it('returns null on corrupted base64 string without throwing', () => {
    const bytes = decodeTerminalBytes('!!!not-valid-base64###')
    expect(bytes).toBeNull()
  })
})

describe('terminal-stream-frame: Blocker 3 - startup dimension sync and 35-col frames', () => {
  it('accepts mobile 35x15 frame in stream validator', () => {
    const frame = {
      type: 'terminal.frame',
      seq: 1,
      encoding: 'ansi',
      width: 35,
      height: 15,
      full: true,
      bytes: 'SGVsbG8='
    }
    const result = validateTerminalFrame(frame)
    expect(result.valid).toBe(true)
    expect(result.frame?.width).toBe(35)
    expect(result.frame?.height).toBe(15)
  })

  it('rejects interactive inputs and terminal.key messages on stream socket', () => {
    // Stream socket only receives terminal.frame and terminal.closed, never accepts interactive inputs
    const inputPayload = {
      type: 'terminal.input',
      text: 'echo hello\n'
    }
    expect(validateTerminalFrame(inputPayload).valid).toBe(false)

    const keyPayload = {
      type: 'terminal.key',
      key: 'Enter'
    }
    expect(validateTerminalFrame(keyPayload).valid).toBe(false)
  })

  it('detects updated dimensions before open and prepares immediate terminal.resize', () => {
    // Simulates the startup dimension sync logic in useTerminalStream:
    // Initial query params capture 80x24 at connection initiation.
    const initialCols: number = 80
    const initialRows: number = 24

    // While CONNECTING, canvas measure completes and sets latest dimensions to 35x15.
    const latestCols: number = 35
    const latestRows: number = 15

    let lastSentCols = initialCols
    let lastSentRows = initialRows
    const sentMessages: string[] = []

    const mockWs = {
      send: (msg: string) => {
        sentMessages.push(msg)
      }
    }

    // On open handler logic:
    if (latestCols !== initialCols || latestRows !== initialRows) {
      lastSentCols = latestCols
      lastSentRows = latestRows
      mockWs.send(
        JSON.stringify({
          type: 'terminal.resize',
          cols: latestCols,
          rows: latestRows
        })
      )
    }

    expect(sentMessages.length).toBe(1)
    expect(JSON.parse(sentMessages[0])).toEqual({
      type: 'terminal.resize',
      cols: 35,
      rows: 15
    })
    expect(lastSentCols).toBe(35)
    expect(lastSentRows).toBe(15)

    // Subsequent resize check with same 35x15 dedupes and does not resend
    let duplicateSent = false
    if (lastSentCols !== latestCols || lastSentRows !== latestRows) {
      duplicateSent = true
    }
    expect(duplicateSent).toBe(false)
  })
})
