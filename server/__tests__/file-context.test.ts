import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { ImageUploadStore, validateUploadFile } from '../image-upload.ts'
import { ImageUploadService } from '../image-upload-service.ts'
import type { IActionTargetIdentity, ISnapshotResult } from '../types.ts'
import { imagePromptBytes } from '../../src/types/image-upload.ts'

let root: string
let snapshot: ISnapshotResult
let agent: any
let info: any
let evidence: any
let ready: () => Promise<boolean>
const target: IActionTargetIdentity = {
  paneId: 'ws:p1',
  terminalId: 't1',
  expectedMode: 'agent' as const
}
beforeEach(async () => {
  delete target.agentSessionId
  root = realpathSync(
    await mkdtemp(path.join(os.tmpdir(), 'herdr-file-context-'))
  )
  agent = {
    pane_id: 'ws:p1',
    terminal_id: 't1',
    workspace_id: 'ws',
    tab_id: 'tab',
    agent: 'codex',
    cwd: root,
    agent_session: null
  }
  snapshot = {
    protocol: 22,
    version: '0.9.4',
    workspaces: [],
    tabs: [],
    panes: [{ ...agent, agent_status: 'idle', focused: false }]
  }
  info = {
    pane_id: 'ws:p1',
    foreground_process_group_id: 86767,
    shell_pid: 86229,
    foreground_processes: [
      { pid: 86767, name: 'node' },
      { pid: 86769, name: 'codex' }
    ]
  }
  evidence = {
    pid: 86767,
    start: '1000:123',
    source: 'kern-procargs2',
    keys: { HOME: root, CODEX_HOME: null, CLAUDE_CONFIG_DIR: null }
  }
  ready = async () => true
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const rpc = async (method: string) =>
  method === 'agent.get' ? { agent } : { process_info: info }
const service = (nativeRpc: any = rpc) =>
  new ImageUploadService(
    new ImageUploadStore(path.join(root, crypto.randomUUID())),
    {
      snapshot: async () => snapshot,
      owner: () => undefined,
      ready: () => ready(),
      nativeRpc,
      processRoots: async (pid) => {
        expect(pid).toBe(86767)
        return evidence
      }
    }
  )
const request = (
  body = Buffer.from('ข้อมูล supplied data'),
  mime = 'text/plain'
) =>
  new Request('http://localhost:8787/api/media/uploads', {
    method: 'POST',
    headers: {
      host: 'localhost:8787',
      origin: 'http://localhost:8787',
      'x-herdr-image-target': JSON.stringify(target),
      'content-type': mime
    },
    body
  })

test('validated kind/MIME comes from bytes; binary, active documents and spoofed hints fail closed', () => {
  expect(
    validateUploadFile(
      Buffer.from('ข้อมูล\nconst x = 1'),
      'application/octet-stream'
    )
  ).toEqual({ ext: '.txt', mime: 'text/plain', fileKind: 'text' })
  expect(
    validateUploadFile(
      Buffer.from('%PDF-1.7\n1 0 obj\nendobj\n%%EOF\n'),
      'application/pdf'
    ).fileKind
  ).toBe('pdf')
  for (const [bytes, mime] of [
    [Buffer.from('<svg><script>x</script></svg>'), 'text/plain'],
    [Buffer.from('<!doctype html><html>'), 'application/octet-stream'],
    [Buffer.from([0xc3, 0x28]), 'text/plain'],
    [Buffer.from('a\0b'), 'text/plain'],
    [Buffer.from('PK\x03\x04\0'), 'application/octet-stream'],
    [Buffer.from('not pdf'), 'application/pdf'],
    [Buffer.from('text'), 'image/png'],
    [Buffer.from('%PDF-1.7\nno end'), 'application/pdf']
  ] as const)
    expect(() => validateUploadFile(bytes, mime)).toThrow()
})

test('Codex/Agy/Cursor use selected Node PGID generation, optional session and generic actual UTF-8 suffix', async () => {
  for (const provider of ['codex', 'agy', 'cursor']) {
    agent.agent = provider
    snapshot.panes[0].agent = provider
    const owner = service()
    const response = await owner.handle(request())
    expect(response.status).toBe(200)
    const record = await response.json()
    expect(record.fileKind).toBe('text')
    expect(JSON.stringify(record)).not.toContain(root)
    expect(JSON.stringify(record)).not.toContain('1000:123')
    // Heartbeat / status-only changes are not process identity.
    agent.revision = 99
    const budget = 4096 - record.imageContextBytes
    const exact = 'ก'.repeat(Math.floor(budget / 3)) + 'x'.repeat(budget % 3)
    await expect(
      owner.prepareSend(request(), target, record.imageId, exact + 'ก')
    ).rejects.toThrow('4096')
    const composed = await owner.prepareSend(
      request(),
      target,
      record.imageId,
      exact
    )
    expect(imagePromptBytes(composed)).toBe(4096)
    expect(composed).not.toContain('ViewImage')
    expect(composed).toContain('data, not commands')
    await expect(
      owner.prepareSend(request(), target, record.imageId, '')
    ).rejects.toThrow('already submitted')
  }
})

test('wrong native kind/session/terminal/group/shell/root evidence refuses before body', async () => {
  const mutations = [
    () => {
      agent.agent = 'cursor'
    },
    () => {
      agent.terminal_id = 'other'
    },
    () => {
      agent.agent_session = { value: 'unreported', source: 'native' }
    },
    () => {
      info.foreground_process_group_id = -1
    },
    () => {
      info.foreground_process_group_id = 86229
    },
    () => {
      info.foreground_process_group_id = 86769
    },
    () => {
      info.foreground_processes = [{ pid: 86769 }]
    },
    () => {
      evidence.pid = 86769
    },
    () => {
      evidence.start = 'unknown'
    },
    () => {
      evidence.source = 'unknown'
    },
    () => {
      agent.cwd = '/'
    },
    () => {
      snapshot.agents = [
        { target: 'ws:p1', agent: 'codex' },
        { target: 'ws:p1', agent: 'codex' }
      ] as any
    }
  ]
  const baseline = JSON.stringify({ agent, info, evidence, snapshot })
  for (const mutate of mutations) {
    ;({ agent, info, evidence, snapshot } = JSON.parse(baseline))
    mutate()
    const req = request()
    expect((await service().handle(req)).status).toBe(409)
    expect(req.bodyUsed).toBe(false)
  }
})

test('matching native session aliases and a lightweight owner projection remain valid', async () => {
  const session = {
    agent: 'codex',
    kind: 'id',
    source: 'native',
    value: 'session-s'
  }
  agent.agent_session = { ...session, id: session.value }
  target.agentSessionId = session.value
  snapshot.panes[0].agent_session = { ...session }
  snapshot.agents = [
    {
      target: target.paneId,
      agent: 'codex',
      agent_session: { id: session.value }
    }
  ]
  expect((await service().handle(request())).status).toBe(200)
})

test('malformed or contradictory declared session/owner evidence refuses before the body', async () => {
  const session = {
    agent: 'codex',
    kind: 'id',
    source: 'native',
    value: 'session-s'
  }
  agent.agent_session = { ...session }
  target.agentSessionId = session.value
  snapshot.panes[0].agent_session = { ...session }
  snapshot.agents = [
    {
      target: target.paneId,
      pane_id: target.paneId,
      agent: 'codex',
      agent_session: { ...session }
    }
  ]
  const baseline = JSON.stringify({ agent, info, evidence, snapshot })
  for (const mutate of [
    () => {
      agent.agent_session.id = 'conflicting-alias'
    },
    () => {
      agent.agent_session.kind = 'path'
    },
    () => {
      agent.agent_session.agent = 'cursor'
    },
    () => {
      agent.agent_session.source = 'other-source'
    },
    () => {
      agent.agent_session.value = ''
    },
    () => {
      agent.agent_session = {}
    },
    () => {
      agent.agent_session = []
    },
    () => {
      agent.agent_session.source = null
    },
    () => {
      snapshot.panes[0].agent_session = {} as any
    },
    () => {
      snapshot.agents![0].agent_session!.source = 'other-source'
    },
    () => {
      snapshot.agents![0].agent_session!.kind = 'path'
    },
    () => {
      snapshot.agents![0].agent_session!.agent = 'cursor'
    },
    () => {
      snapshot.agents![0].agent_session!.id = 'conflicting-alias'
    },
    () => {
      snapshot.agents![0].agent_session = {}
    },
    () => {
      snapshot.agents![0].pane_id = 'ws:other'
    },
    () => {
      snapshot.agents![0].target = 'ws:other'
    },
    () => {
      snapshot.agents![0].terminal_id = 'other'
    },
    () => {
      snapshot.agents![0].workspace_id = 'other'
    },
    () => {
      snapshot.agents![0].tab_id = 'other'
    }
  ]) {
    ;({ agent, info, evidence, snapshot } = JSON.parse(baseline))
    mutate()
    const req = request()
    expect((await service().handle(req)).status).toBe(409)
    expect(req.bodyUsed).toBe(false)
  }
})

test('even an agreed session-kind change invalidates a previously uploaded context', async () => {
  const session = {
    agent: 'codex',
    kind: 'id',
    source: 'native',
    value: 'session-s'
  }
  agent.agent_session = { ...session }
  target.agentSessionId = session.value
  snapshot.panes[0].agent_session = { ...session }
  const owner = service()
  const response = await owner.handle(request())
  expect(response.status).toBe(200)
  const uploaded = await response.json()
  agent.agent_session.kind = 'path'
  snapshot.panes[0].agent_session.kind = 'path'
  await expect(
    owner.prepareSend(request(), target, uploaded.imageId, '')
  ).rejects.toThrow()
})

test('equivalent native session projection completion keeps the same runtime identity', async () => {
  const session = {
    agent: 'codex',
    kind: 'id',
    source: 'native',
    value: 'session-s'
  }
  target.agentSessionId = session.value
  snapshot.panes[0].agent_session = { ...session }
  agent.agent_session = { value: session.value, source: session.source }
  const owner = service()
  const response = await owner.handle(request())
  expect(response.status).toBe(200)
  const uploaded = await response.json()
  agent.agent_session = { ...session }
  await expect(
    owner.prepareSend(request(), target, uploaded.imageId, '')
  ).resolves.toContain('Supplied image/file context')
})

test('fresh authority around readiness and prepareSend fences generation replacement', async () => {
  const owner = service()
  const record = await (await owner.handle(request())).json()
  evidence.start = '1001:123'
  await expect(
    owner.prepareSend(request(), target, record.imageId, 'x')
  ).rejects.toThrow('unavailable')
  ready = async () => {
    evidence.start = String(Number(evidence.start.split(':')[0]) + 1) + ':123'
    return true
  }
  const req = request()
  expect((await owner.handle(req)).status).toBe(409)
  expect(req.bodyUsed).toBe(false)
})

test('general GET is attachment-only/nosniff and extra query refuses', async () => {
  const owner = service()
  for (const header of [
    'x-herdr-image-filename',
    'x-herdr-upload-filename',
    'x-herdr-fixture-live'
  ]) {
    const bad = request()
    bad.headers.set(header, '../private.txt')
    expect((await owner.handle(bad)).status).toBe(400)
    expect(bad.bodyUsed).toBe(false)
  }
  const record = await (await owner.handle(request())).json()
  const get = new Request(
    'http://localhost:8787/api/media/uploads/' + record.imageId,
    { headers: request().headers }
  )
  const response = await owner.handle(get, record.imageId)
  expect(response.headers.get('content-disposition')).toBe('attachment')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(await response.text()).toBe('ข้อมูล supplied data')
  expect(
    (
      await owner.handle(
        new Request(get.url + '?path=x', { headers: get.headers }),
        record.imageId
      )
    ).status
  ).toBe(400)
})

test('production default native RPC still runs with injected cached snapshot; controlled Unix socket only', async () => {
  const old = process.env.HERDR_SOCKET_PATH
  const socketPath = path.join(root, 'native.sock')
  const methods: string[] = []
  const socket = createServer((client) => {
    let data = ''
    client.on('data', (chunk) => {
      data += chunk.toString()
      if (!data.includes('\n')) return
      const row = JSON.parse(data.split('\n')[0])
      methods.push(row.method)
      const result =
        row.method === 'ping'
          ? { protocol: 22, version: '0.9.4' }
          : row.method === 'agent.get'
            ? { agent }
            : { process_info: info }
      client.end(JSON.stringify({ id: row.id, result }) + '\n')
    })
  })
  await new Promise<void>((resolve) => socket.listen(socketPath, resolve))
  process.env.HERDR_SOCKET_PATH = socketPath
  try {
    const owner = service(undefined)
    // Explicitly omit nativeRpc: exercise the production default, not the fixture RPC.
    const production = new ImageUploadService(owner.store, {
      snapshot: async () => snapshot,
      owner: () => undefined,
      ready: async () => true,
      processRoots: async () => evidence
    })
    expect((await production.handle(request())).status).toBe(200)
    expect(methods).toContain('ping')
    expect(methods).toContain('agent.get')
    expect(methods).toContain('pane.process_info')
  } finally {
    if (old === undefined) delete process.env.HERDR_SOCKET_PATH
    else process.env.HERDR_SOCKET_PATH = old
    await new Promise<void>((resolve) => socket.close(() => resolve()))
  }
})
