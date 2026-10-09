import { describe, expect, it } from 'bun:test'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { executePromptTextOnly } from '../herdr-adapter.ts'

const withSocket = async (
  result: { type: string },
  run: (requests: { method: string; params: any }[]) => Promise<void>,
  protocol = 22
) => {
  const previous = {
    transport: process.env.HERDR_TRANSPORT,
    socket: process.env.HERDR_SOCKET_PATH
  }
  const socketPath = path.join(
    os.tmpdir(),
    `p-${crypto.randomUUID().slice(0, 12)}.sock`
  )
  const requests: { method: string; params: any }[] = []
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data.toString('utf8')
      for (;;) {
        const at = buffer.indexOf('\n')
        if (at < 0) break
        const request = JSON.parse(buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
        if (request.method !== 'ping') requests.push(request)
        const response =
          request.method === 'ping'
            ? { type: 'pong', protocol, version: '0.9.3' }
            : request.method === 'pane.get'
              ? { type: 'pane_info', pane: { pane_id: request.params.pane_id } }
              : result
        socket.end(`${JSON.stringify({ id: request.id, result: response })}\n`)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  process.env.HERDR_TRANSPORT = 'socket'
  process.env.HERDR_SOCKET_PATH = socketPath
  try {
    await run(requests)
  } finally {
    if (previous.transport === undefined) delete process.env.HERDR_TRANSPORT
    else process.env.HERDR_TRANSPORT = previous.transport
    if (previous.socket === undefined) delete process.env.HERDR_SOCKET_PATH
    else process.env.HERDR_SOCKET_PATH = previous.socket
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('internal native prompt text-only adapter', () => {
  it('sends text without Enter or any browser keys after protocol/existence preflight', async () => {
    await withSocket({ type: 'pane_input_sent' }, async (requests) => {
      expect(await executePromptTextOnly('w1:p1', 'ไทย', 1000)).toEqual({
        ok: true,
        output: ''
      })
      expect(requests.map((request) => request.method)).toEqual([
        'pane.get',
        'pane.send_input'
      ])
      expect(requests[1]?.params).toEqual({ pane_id: 'w1:p1', text: 'ไทย' })
    })
  })
  it('malformed acknowledgement is unknown and never dispatches a second time', async () => {
    await withSocket({ type: 'ok' }, async (requests) => {
      await expect(
        executePromptTextOnly('w1:p1', 'hello', 1000)
      ).rejects.toThrow('acknowledgement is unknown')
      expect(
        requests.filter((request) => request.method === 'pane.send_input')
      ).toHaveLength(1)
    })
  })
  it('protocol mismatch cannot reach pane reads or writes', async () => {
    await withSocket(
      { type: 'pane_input_sent' },
      async (requests) => {
        await expect(
          executePromptTextOnly('w1:p1', 'hello', 1000)
        ).rejects.toThrow()
        expect(requests).toEqual([])
      },
      999
    )
  })
  it('control sequences and multibyte overflow fail before native IO', async () => {
    await withSocket({ type: 'pane_input_sent' }, async (requests) => {
      for (const text of ['', 'hello\n', '\u001b', 'ก'.repeat(1366)])
        await expect(
          executePromptTextOnly('w1:p1', text, 1000)
        ).rejects.toThrow('Invalid interactive answer text')
      expect(requests).toEqual([])
    })
  })
})
