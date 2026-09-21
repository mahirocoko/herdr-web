import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  HerdrSocketError,
  executePing,
  resolveHerdrSocketPath,
  sendRawSocketRequest
} from '../herdr-socket.ts'

const createTempSocketServer = (
  handler: (socket: net.Socket, line: string, raw: string) => void
): { server: net.Server; socketPath: string; close: () => Promise<void> } => {
  const tmpDir = os.tmpdir()
  const socketPath = path.join(tmpDir, `herdr-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sock`)

  // Ensure socket file does not exist
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath)
  }

  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data.toString('utf8')
      while (buffer.includes('\n')) {
        const newlineIdx = buffer.indexOf('\n')
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (line.length > 0) {
          handler(socket, line, data.toString('utf8'))
        }
      }
    })
  })

  server.listen(socketPath)

  const close = async () => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        if (fs.existsSync(socketPath)) {
          try {
            fs.unlinkSync(socketPath)
          } catch {}
        }
        resolve()
      })
    })
  }

  return { server, socketPath, close }
}

describe('herdr-socket: socket path resolution', () => {
  const originalEnv = { ...process.env }

  it('prioritizes explicit path parameter', () => {
    process.env.HERDR_SOCKET_PATH = '/env/override.sock'
    process.env.HERDR_SESSION = 'mysession'
    const resolved = resolveHerdrSocketPath('/explicit/custom.sock')
    expect(resolved).toBe('/explicit/custom.sock')
    process.env = { ...originalEnv }
  })

  it('uses HERDR_SOCKET_PATH when explicit path is omitted', () => {
    process.env.HERDR_SOCKET_PATH = '/custom/env/herdr.sock'
    process.env.HERDR_SESSION = 'mysession'
    const resolved = resolveHerdrSocketPath()
    expect(resolved).toBe('/custom/env/herdr.sock')
    process.env = { ...originalEnv }
  })

  it('uses HERDR_SESSION named session socket when HERDR_SOCKET_PATH is not set', () => {
    delete process.env.HERDR_SOCKET_PATH
    process.env.HERDR_SESSION = 'worktree-1'
    const home = process.env.HOME || os.homedir()
    const resolved = resolveHerdrSocketPath()
    expect(resolved).toBe(`${home}/.config/herdr/sessions/worktree-1/herdr.sock`)
    process.env = { ...originalEnv }
  })

  it('falls back to default socket path when no env or param is provided', () => {
    delete process.env.HERDR_SOCKET_PATH
    delete process.env.HERDR_SESSION
    const home = process.env.HOME || os.homedir()
    const resolved = resolveHerdrSocketPath()
    expect(resolved).toBe(`${home}/.config/herdr/herdr.sock`)
    process.env = { ...originalEnv }
  })
})

describe('herdr-socket: fake Unix socket server request handling', () => {
  it('sends framed NDJSON and parses matching successful result', async () => {
    let receivedPayload: any = null
    const { socketPath, close } = createTempSocketServer((socket, line) => {
      receivedPayload = JSON.parse(line)
      const response = {
        id: receivedPayload.id,
        result: {
          type: 'test_success',
          greeting: 'hello socket'
        }
      }
      socket.write(JSON.stringify(response) + '\n')
    })

    try {
      const res = await sendRawSocketRequest<{ type: string; greeting: string }>(
        'test.method',
        { foo: 'bar' },
        { socketPath, timeoutMs: 1000 }
      )
      expect(receivedPayload).toBeTruthy()
      expect(receivedPayload.method).toBe('test.method')
      expect(receivedPayload.params).toEqual({ foo: 'bar' })
      expect(res.type).toBe('test_success')
      expect(res.greeting).toBe('hello socket')
    } finally {
      await close()
    }
  })

  it('preserves Herdr error code and message in HerdrSocketError', async () => {
    const { socketPath, close } = createTempSocketServer((socket, line) => {
      const req = JSON.parse(line)
      const response = {
        id: req.id,
        error: {
          code: 'pane_not_found',
          message: 'pane w1:p99 not found'
        }
      }
      socket.write(JSON.stringify(response) + '\n')
    })

    try {
      await sendRawSocketRequest('pane.get', { pane_id: 'w1:p99' }, { socketPath, timeoutMs: 1000 })
      expect(true).toBe(false) // Should have thrown
    } catch (err) {
      expect(err instanceof HerdrSocketError).toBe(true)
      const socketErr = err as HerdrSocketError
      expect(socketErr.code).toBe('pane_not_found')
      expect(socketErr.message).toBe('pane w1:p99 not found')
    } finally {
      await close()
    }
  })

  it('preserves an official invalid_request decode error whose response id is empty', async () => {
    const { socketPath, close } = createTempSocketServer((socket) => {
      socket.write(JSON.stringify({
        id: '',
        error: {
          code: 'invalid_request',
          message: 'unknown variant in request payload'
        }
      }) + '\n')
    })

    try {
      await sendRawSocketRequest('pane.read', {}, { socketPath, timeoutMs: 1000 })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(HerdrSocketError)
      expect((err as HerdrSocketError).code).toBe('invalid_request')
      expect((err as HerdrSocketError).message).toContain('unknown variant')
    } finally {
      await close()
    }
  })

  it('decodes a Thai multibyte code point split across socket writes', async () => {
    const { socketPath, close } = createTempSocketServer((socket, line) => {
      const req = JSON.parse(line)
      const response = Buffer.from(JSON.stringify({ id: req.id, result: { greeting: 'สวัสดี' } }) + '\n')
      const thaiByte = response.indexOf(Buffer.from('ส'))
      socket.write(response.subarray(0, thaiByte + 1))
      socket.write(response.subarray(thaiByte + 1))
    })

    try {
      const result = await sendRawSocketRequest<{ greeting: string }>('test.utf8', {}, { socketPath, timeoutMs: 1000 })
      expect(result.greeting).toBe('สวัสดี')
    } finally {
      await close()
    }
  })

  it('bounds Herdr error messages while preserving the error code', async () => {
    const { socketPath, close } = createTempSocketServer((socket, line) => {
      const req = JSON.parse(line)
      socket.write(JSON.stringify({ id: req.id, error: { code: 'pane_not_found', message: 'x'.repeat(5000) } }) + '\n')
    })

    try {
      await sendRawSocketRequest('pane.get', {}, { socketPath, timeoutMs: 1000 })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(HerdrSocketError)
      expect((err as HerdrSocketError).code).toBe('pane_not_found')
      expect((err as HerdrSocketError).message.length).toBe(1024)
    } finally {
      await close()
    }
  })

  it('rejects on mismatched request id', async () => {
    const { socketPath, close } = createTempSocketServer((socket) => {
      const response = {
        id: 'wrong_id_123',
        result: { ok: true }
      }
      socket.write(JSON.stringify(response) + '\n')
    })

    try {
      await sendRawSocketRequest('ping', {}, { socketPath, timeoutMs: 1000 })
      expect(true).toBe(false)
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).message).toContain('Mismatched request id')
    } finally {
      await close()
    }
  })

  it('rejects on malformed JSON response', async () => {
    const { socketPath, close } = createTempSocketServer((socket) => {
      socket.write('{not-valid-json\n')
    })

    try {
      await sendRawSocketRequest('ping', {}, { socketPath, timeoutMs: 1000 })
      expect(true).toBe(false)
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).message).toContain('Malformed JSON response')
    } finally {
      await close()
    }
  })

  it('rejects on premature EOF without newline', async () => {
    const { socketPath, close } = createTempSocketServer((socket) => {
      socket.write('{"id": "incomplete"')
      socket.end()
    })

    try {
      await sendRawSocketRequest('ping', {}, { socketPath, timeoutMs: 1000 })
      expect(true).toBe(false)
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).message).toContain('Premature EOF')
    } finally {
      await close()
    }
  })

  it('rejects when response exceeds maximum allowed bytes', async () => {
    const { socketPath, close } = createTempSocketServer((socket) => {
      const hugeString = 'x'.repeat(2048)
      socket.write(hugeString)
    })

    try {
      await sendRawSocketRequest('ping', {}, { socketPath, timeoutMs: 1000, maxBytes: 1024 })
      expect(true).toBe(false)
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).message).toContain('exceeded maximum allowed size')
    } finally {
      await close()
    }
  })

  it('times out when server does not reply', async () => {
    const { socketPath, close } = createTempSocketServer(() => {
      // Do nothing, hang
    })

    try {
      await sendRawSocketRequest('ping', {}, { socketPath, timeoutMs: 100 })
      expect(true).toBe(false)
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).message).toContain('timed out after 100ms')
    } finally {
      await close()
    }
  })
})

describe('herdr-socket: executePing protocol validation', () => {
  it('succeeds when protocol matches tracked protocol 22', async () => {
    const { socketPath, close } = createTempSocketServer((socket, line) => {
      const req = JSON.parse(line)
      socket.write(
        JSON.stringify({
          id: req.id,
          result: {
            type: 'pong',
            version: '0.9.1',
            protocol: 22
          }
        }) + '\n'
      )
    })

    try {
      const pong = await executePing({ socketPath, timeoutMs: 1000 })
      expect(pong.protocol).toBe(22)
      expect(pong.version).toBe('0.9.1')
    } finally {
      await close()
    }
  })

  it('fails closed when protocol mismatches tracked protocol 22', async () => {
    const { socketPath, close } = createTempSocketServer((socket, line) => {
      const req = JSON.parse(line)
      socket.write(
        JSON.stringify({
          id: req.id,
          result: {
            type: 'pong',
            version: '0.8.0',
            protocol: 21 // Mismatch!
          }
        }) + '\n'
      )
    })

    try {
      await executePing({ socketPath, timeoutMs: 1000 })
      expect(true).toBe(false)
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).message).toContain('Protocol mismatch')
    } finally {
      await close()
    }
  })
})
