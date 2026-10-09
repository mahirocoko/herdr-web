import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  readPaneConversation,
  readPaneToolOutput,
  MAX_TOOL_OUTPUT_LENGTH,
  MAX_NATIVE_ROW_BYTES
} from '../conversation-reader.ts'
import { handleConversationOutputRequest } from '../output-route.ts'
import type { ISnapshotResult } from '../../types.ts'
import type { IConversationRead } from '../../../src/types/conversation.ts'

const message = (id: string, role: string, content: unknown, extra = {}) =>
  JSON.stringify({ type: 'message', message: { id, role, content, ...extra } })
const text = (value: string) => [{ type: 'text', text: value }]
const outputIdentity = (page: IConversationRead) => {
  const result = page.contributions?.find(
    (row) => row.result?.outputRef
  )?.result
  if (!result?.outputRef) throw new Error('missing recorded-output ref')
  return { history: page.sessionKey, ref: result.outputRef, result }
}

describe('owner-bound whole recorded output', () => {
  let root: string
  let file: string
  let snapshot: ISnapshotResult
  let header: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-output-'))
    const id = 'fixture-conversation'
    const dir = path.join(
      root,
      Buffer.from(`conversation:${id}`).toString('base64url')
    )
    fs.mkdirSync(dir)
    fs.writeFileSync(
      path.join(dir, 'conversation.json'),
      JSON.stringify({ id })
    )
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        schema_version: 2,
        message_format: 'pi-session-entry-jsonl',
        provider_stack: 'pi-ai'
      })
    )
    header = JSON.stringify({ type: 'session', version: 3, id })
    file = path.join(dir, 'messages.jsonl')
    snapshot = {
      protocol: 22,
      version: '0.9.3',
      workspaces: [
        {
          workspace_id: 'w',
          label: '',
          number: 1,
          agent_status: 'working',
          tab_count: 1,
          pane_count: 1,
          focused: true
        }
      ],
      tabs: [
        {
          tab_id: 't',
          workspace_id: 'w',
          label: '',
          number: 1,
          pane_count: 1,
          focused: true,
          agent_status: 'working'
        }
      ],
      panes: [
        {
          pane_id: 'w:p',
          workspace_id: 'w',
          tab_id: 't',
          terminal_id: 'term',
          agent: 'letta',
          agent_status: 'working',
          cwd: null,
          focused: true,
          tokens: {
            letta_scope: crypto
              .createHash('sha256')
              .update(id)
              .digest('hex')
              .slice(0, 16)
          }
        }
      ]
    }
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  const deps = () => ({
    lettaRoot: root,
    brainRoot: root,
    fetchSnapshot: async () => snapshot
  })
  const writeOutput = (output: string) =>
    fs.writeFileSync(
      file,
      [
        header,
        message('call-message', 'assistant', [
          {
            type: 'toolCall',
            id: 'native-call',
            name: 'Read',
            arguments: { path: 'fixture.ts' }
          }
        ]),
        message('native-result', 'toolResult', text(output), {
          toolCallId: 'native-call',
          isError: true
        })
      ].join('\n')
    )
  const read = () => readPaneConversation('w:p', { deps: deps() })

  test('recovers >256KiB native result, exposes clipped page but retrieves exact whitespace/Thai/emoji with true units', async () => {
    const output = '  ภาษาไทย🙂\n'.repeat(28_000) + '\n  end  '
    writeOutput(output)
    expect(Buffer.byteLength(output)).toBeGreaterThan(256 * 1024)
    const page = await read()
    const { history, ref, result } = outputIdentity(page)
    expect(result.output.length).toBe(16_000)
    expect(result.outputLength).toBe(output.length)
    expect(result.outputLengthUnit).toBe('utf16-code-units')
    const whole = await readPaneToolOutput('w:p', history, ref, {
      deps: deps()
    })
    expect(whole.output).toBe(output)
    expect(whole.length).toBe(output.length)
    expect(whole.lengthUnit).toBe('utf16-code-units')
    expect(ref).not.toContain(root)
    expect(page.before).not.toBeNull()
    const older = await readPaneConversation('w:p', {
      before: page.before,
      deps: deps()
    })
    expect(older.contributions?.some((row) => row.id === 'call-message')).toBe(
      true
    )
  })

  test('Agy recorded GENERIC output preserves real whitespace and native sequential identity', async () => {
    const uuid = '00000000-0000-4000-8000-000000000001'
    const logs = path.join(root, uuid, '.system_generated', 'logs')
    fs.mkdirSync(logs, { recursive: true })
    file = path.join(logs, 'transcript.jsonl')
    const output = '  real recorded Agy\n'.repeat(20_000) + '  '
    fs.writeFileSync(
      file,
      [
        JSON.stringify({
          step_index: 1,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          tool_calls: [{ name: 'Read', args: {} }]
        }),
        JSON.stringify({
          step_index: 2,
          source: 'MODEL',
          type: 'GENERIC',
          content: output,
          status: 'ERROR'
        })
      ].join('\n')
    )
    snapshot.panes[0].agent = 'agy'
    snapshot.panes[0].agent_session = {
      source: 'herdr:antigravity_cli',
      agent: 'agy',
      kind: 'id',
      value: uuid
    }
    const page = await read()
    const { history, ref } = outputIdentity(page)
    expect(
      (await readPaneToolOutput('w:p', history, ref, { deps: deps() })).output
    ).toBe(output)
  })

  test('finite output limit is explicit, never a clipped string masquerading as whole', async () => {
    writeOutput('x'.repeat(MAX_TOOL_OUTPUT_LENGTH + 1))
    const page = await read()
    const result = page.contributions?.find((row) => row.result)?.result
    expect(result?.outputUnavailable).toBe('limit-exceeded')
    expect(result?.outputRef).toBeUndefined()
    expect(result?.outputLength).toBe(MAX_TOOL_OUTPUT_LENGTH + 1)
  })

  test('native rows beyond the projection cap retain honest notice and decreasing pagination', async () => {
    writeOutput('x'.repeat(MAX_NATIVE_ROW_BYTES + 10))
    const page = await read()
    expect(page.truncated).toBe(true)
    expect(JSON.stringify(page.turns)).toContain('Bounded transcript window')
    expect(page.before).not.toBeNull()
    expect(page.contributions?.some((row) => row.result?.outputRef)).toBe(false)
  })

  test('history/pane/terminal/provider/ref ownership and snapshot recheck reject stale identity', async () => {
    writeOutput('real-output'.repeat(3000))
    const { history, ref } = outputIdentity(await read())
    await expect(
      readPaneToolOutput('w:p', '0'.repeat(64), ref, { deps: deps() })
    ).rejects.toThrow('Session replaced')
    snapshot.panes.push({ ...snapshot.panes[0], pane_id: 'w:q' })
    await expect(
      readPaneToolOutput('w:q', history, ref, { deps: deps() })
    ).rejects.toThrow('Session replaced')
    snapshot.panes[0].terminal_id = 'changed'
    await expect(
      readPaneToolOutput('w:p', history, ref, { deps: deps() })
    ).rejects.toThrow('Session replaced')
    snapshot.panes[0].terminal_id = 'term'
    snapshot.panes[0].agent = 'unsupported'
    await expect(
      readPaneToolOutput('w:p', history, ref, { deps: deps() })
    ).rejects.toThrow()
    snapshot.panes[0].agent = 'letta'
    let snapshots = 0
    await expect(
      readPaneToolOutput('w:p', history, ref, {
        deps: {
          ...deps(),
          fetchSnapshot: async () => {
            snapshots++
            return snapshots === 1
              ? snapshot
              : {
                  ...snapshot,
                  panes: [
                    { ...snapshot.panes[0], terminal_id: 'post-replacement' }
                  ]
                }
          }
        }
      })
    ).rejects.toThrow('Session replaced')
  })

  test('append/superseded snapshot, inode replacement, and same-size middle rewrite retire refs', async () => {
    writeOutput('recorded output'.repeat(3000))
    let identity = outputIdentity(await read())
    fs.appendFileSync(
      file,
      '\n' +
        message('native-result', 'toolResult', text('superseded'), {
          toolCallId: 'native-call'
        })
    )
    await expect(
      readPaneToolOutput('w:p', identity.history, identity.ref, {
        deps: deps()
      })
    ).rejects.toThrow('Session replaced')
    writeOutput('replacement output'.repeat(3000))
    await expect(read()).rejects.toThrow('Session replaced')
    identity = outputIdentity(await read())
    const copy = fs.readFileSync(file)
    fs.unlinkSync(file)
    fs.writeFileSync(file, copy)
    await expect(
      readPaneToolOutput('w:p', identity.history, identity.ref, {
        deps: deps()
      })
    ).rejects.toThrow('Session replaced')
    identity = outputIdentity(await read())
    const fd = fs.openSync(file, 'r+')
    try {
      fs.writeSync(fd, Buffer.from('Z'), 0, 1, 10_000)
    } finally {
      fs.closeSync(fd)
    }
    await expect(
      readPaneToolOutput('w:p', identity.history, identity.ref, {
        deps: deps()
      })
    ).rejects.toThrow('Session replaced')
  })

  test('ref tampering/cursor substitution reject before snapshot access', async () => {
    writeOutput('x'.repeat(30_000))
    const page = await read()
    const { history, ref } = outputIdentity(page)
    let reads = 0
    const noRead = {
      ...deps(),
      fetchSnapshot: async () => {
        reads++
        return snapshot
      }
    }
    await expect(
      readPaneToolOutput('w:p', history, ref.slice(0, -2) + 'AA', {
        deps: noRead
      })
    ).rejects.toThrow('Session replaced')
    await expect(
      readPaneToolOutput('w:p', history, page.before!, { deps: noRead })
    ).rejects.toThrow('Session replaced')
    await expect(
      readPaneConversation('w:p', { before: ref, deps: noRead })
    ).rejects.toThrow('Session replaced')
    expect(reads).toBe(0)
  })

  test('directory/symlink/FIFO transcript replacement fails without hanging or path escape', async () => {
    writeOutput('x'.repeat(30_000))
    const { history, ref } = outputIdentity(await read())
    fs.unlinkSync(file)
    fs.mkdirSync(file)
    await expect(
      readPaneToolOutput('w:p', history, ref, { deps: deps() })
    ).rejects.toThrow()
    fs.rmdirSync(file)
    const elsewhere = path.join(root, 'outside.jsonl')
    fs.writeFileSync(elsewhere, header)
    fs.symlinkSync(elsewhere, file)
    await expect(
      readPaneToolOutput('w:p', history, ref, { deps: deps() })
    ).rejects.toThrow()
    fs.unlinkSync(file)
    execFileSync('mkfifo', [file])
    await expect(
      readPaneToolOutput('w:p', history, ref, { deps: deps() })
    ).rejects.toThrow()
  })

  test('authenticated endpoint returns exact recorded output with no-store/nosniff and rejects caller paths', async () => {
    const output = 'real-output'.repeat(3000)
    writeOutput(output)
    const { history, ref } = outputIdentity(await read())
    const params = new URLSearchParams({
      pane_id: 'w:p',
      history_id: history,
      ref
    })
    const request = () =>
      new Request(`http://localhost:8787/api/conversation/output?${params}`, {
        headers: { host: 'localhost:8787' }
      })
    const response = await handleConversationOutputRequest(request(), {
      deps: deps()
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await response.json()).output).toBe(output)
    params.set('path', '/etc/passwd')
    expect(
      (await handleConversationOutputRequest(request(), { deps: deps() }))
        .status
    ).toBe(400)
  })
})

describe('output route auth-before-read', () => {
  test('bad Host, any hostile Origin, missing/mismatched owner invoke zero snapshot/native reads', async () => {
    let reads = 0
    const readOutput = async () => {
      reads++
      throw new Error('must not read')
    }
    const deniedHeaders: Record<string, string>[] = [
      { host: 'evil.example' },
      { host: 'localhost:8787', origin: 'https://evil.example' },
      { host: 'owner.ts.net', 'tailscale-user-login': 'attacker@example.test' },
      { host: 'owner.ts.net' }
    ]
    for (const headers of deniedHeaders) {
      const response = await handleConversationOutputRequest(
        new Request('http://localhost:8787/api/conversation/output', {
          headers
        }),
        { ownerLogin: 'owner@example.test', readOutput }
      )
      expect(response.status).toBe(403)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(reads).toBe(0)
  })
})
