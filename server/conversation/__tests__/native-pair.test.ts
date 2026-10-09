import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import {
  readPaneConversation,
  readPaneToolOutput,
  readPaneNativeImage
} from '../conversation-reader.ts'
import { handleConversationImageRequest } from '../image-route.ts'
import { handleConversationOutputRequest } from '../output-route.ts'
import { pairContributions } from '../pair-parser.ts'
import { pairMetadata } from '../pair-metadata.ts'
import { groupContributions } from '../../../src/types/conversation.ts'
import { isProviderProcess } from '../provider-process.ts'
import type { ISnapshotResult } from '../../types.ts'
import type { IConversationRead } from '../../../src/types/conversation.ts'
import type { IReadConversationOptions } from '../conversation-reader.ts'
const ID = 'a1111111-1111-4111-8111-111111111111'
const OTHER = 'b2222222-2222-4222-8222-222222222222'
const TS = '2026-10-08T07:00:00.000Z'
const jsonl = (rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
const crc = (bytes: Buffer) => {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
const png = () => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, checksum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(512, 0)
  ihdr.writeUInt32BE(512, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const pixels = Buffer.alloc(512 * (1 + 512 * 3))
  for (let row = 0; row < 512; row++)
    crypto.randomFillSync(pixels, row * (1 + 512 * 3) + 1, 512 * 3)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
const result = (page: IConversationRead) => {
  const row = page.contributions?.find((row) => row.result?.outputRef)
  if (!row?.result?.outputRef) throw new Error('missing output')
  return {
    ref: row.result.outputRef,
    revision: row.result.outputRevision,
    history: page.sessionKey,
    row
  }
}
const image = (page: IConversationRead) => {
  const part = page.contributions
    ?.flatMap((row) => row.parts)
    .find((part) => part.kind === 'image')
  if (!part || part.kind !== 'image') throw new Error('missing image')
  return { ref: part.ref, history: page.sessionKey }
}

describe('source-native conditional records', () => {
  const parse = (source:'claude-transcript'|'codex-transcript', rows:unknown[]) => rows.flatMap((row,index) => pairContributions(JSON.stringify(row),index*100,source))
  test('Claude distinct record UUIDs sharing API message ID retain thinking and text; duplicate record UUID keeps final snapshot', () => {
    const rows = parse('claude-transcript',[
      {type:'assistant',uuid:'a1111111-1111-4111-8111-111111111111',message:{id:'msg_shared',role:'assistant',content:[{type:'thinking',thinking:'thought'}]}},
      {type:'assistant',uuid:'b2222222-2222-4222-8222-222222222222',message:{id:'msg_shared',role:'assistant',content:[{type:'text',text:'partial'}]}},
      {type:'assistant',uuid:'b2222222-2222-4222-8222-222222222222',message:{id:'msg_shared',role:'assistant',content:[{type:'text',text:'complete'}]}}
    ])
    expect(groupContributions(rows).flatMap(turn=>turn.parts)).toEqual([expect.objectContaining({kind:'thinking',text:'thought'}),expect.objectContaining({kind:'text',text:'complete'})])
  })
  test('Claude human queued prompt, paste wrapper, local runtime output, and failed Skill are literal source variants', () => {
    const rows=parse('claude-transcript',[
      {type:'attachment',uuid:'queue',attachment:{type:'queued_command',commandMode:'prompt',origin:{kind:'human'},prompt:'<pasted_content id="p1">\npasted human\n</pasted_content id="p1">'}},
      {type:'system',uuid:'notice',subtype:'local_command',content:'<local-command-stderr>\u001b[31mruntime refusal\u001b[0m</local-command-stderr>'},
      {type:'assistant',uuid:'skill-call',message:{role:'assistant',content:[{type:'tool_use',id:'toolu_skill',name:'Skill',input:{skill:'review'}}]}},
      {type:'user',uuid:'skill-result',message:{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_skill',is_error:true,content:'failed'}]}}
    ])
    const turns=groupContributions(rows)
    expect(turns[0]).toMatchObject({role:'user',parts:[expect.objectContaining({kind:'text',text:'pasted human'})]})
    expect(turns[1]).toMatchObject({role:'user',parts:[expect.objectContaining({kind:'notice',source:'local-command',text:'runtime refusal'})]})
    expect(turns.flatMap(turn=>turn.parts).find(part=>part.kind==='tool')).toMatchObject({pending:false,error:true,skill:{name:'review',evidence:'invocation',status:'failed'}})
  })
  test('Codex selected skill/read lifecycle, queued question reply and memory-citation suppression retain quoted code', () => {
    const reply='<send_user_message_question_reply>[{"answer":"  chosen  "}]</send_user_message_question_reply>'
    const rows=parse('codex-transcript',[
      {type:'event_msg',timestamp:TS,payload:{type:'user_message',message:reply}},
      {type:'response_item',timestamp:TS,payload:{type:'message',role:'user',content:[{type:'input_text',text:reply}]}},
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'<skill><name>review</name><path>/fixture/review/SKILL.md</path></skill>'}]}},
      {type:'response_item',payload:{type:'function_call',call_id:'skill-read',name:'exec_command',arguments:'{"cmd":"cat /fixture/review/SKILL.md"}'}},
      {type:'response_item',payload:{type:'function_call_output',call_id:'skill-read',output:'Process exited with code 1\nmissing'}},
      {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'answer<oai-mem-citation>private citation</oai-mem-citation>\n`<oai-mem-citation>quoted</oai-mem-citation>`'}]}}
    ])
    const turns=groupContributions(rows),parts=turns.flatMap(turn=>turn.parts)
    expect(parts.filter(part=>part.kind==='text'&&part.text==='chosen')).toHaveLength(1)
    expect(parts).toContainEqual(expect.objectContaining({kind:'skill',skill:{name:'review',path:'/fixture/review/SKILL.md',evidence:'instructions',status:'loaded'}}))
    expect(parts.find(part=>part.kind==='tool')).toMatchObject({error:true,pending:false,skill:{status:'failed'}})
    expect(parts).toContainEqual(expect.objectContaining({kind:'text',text:'answer\n`<oai-mem-citation>quoted</oai-mem-citation>`'}))
  })
  test('recorded context/effort are folded; thinking alone does not invent model/effort/window', () => {
    expect(pairMetadata(jsonl([{type:'turn_context',payload:{collaboration_mode:{settings:{model:'codex-native',reasoning_effort:'high'}}}},{type:'event_msg',payload:{type:'token_count',info:{model_context_window:200000,last_token_usage:{total_tokens:123}}}}]),'codex-transcript')).toEqual({model:'codex-native',reasoning_effort:'high',context:{used:123,window:200000}})
    expect(pairMetadata(jsonl([{type:'assistant',message:{role:'assistant',content:[{type:'thinking',thinking:'x'}]}}]),'claude-transcript')).toEqual({model:null,reasoning_effort:null})
  })
  test('source process classifier admits literal wrapper scripts, never eval/import argument lookalikes', () => {
    expect(isProviderProcess({argv:['node','--no-warnings','/fixture/codex.js']},'codex')).toBe(true)
    expect(isProviderProcess({argv:['node','--eval','/fixture/codex.js']},'codex')).toBe(false)
    expect(isProviderProcess({argv:['node','--import=/fixture/code','/fixture/codex.js']},'codex')).toBe(false)
  })
})

for (const provider of ['codex', 'claude'] as const)
  describe(`${provider} native adapter`, () => {
    let root: string,
      file: string,
      snapshot: ISnapshotResult,
      processStart: string,
      rpcCalls: number,
      processes: any[],
      reported: any
    let deps: NonNullable<IReadConversationOptions['deps']>
    const native = (rows: any[]) =>
      provider === 'codex'
        ? [{ type: 'session_meta', payload: { id: ID, cwd: root } }, ...rows]
        : rows.map((row) => ({ ...row, sessionId: ID }))
    const user = (text: string, id = 'u') =>
      provider === 'codex'
        ? {
            type: 'response_item',
            timestamp: TS,
            payload: {
              type: 'message',
              id,
              role: 'user',
              content: [{ type: 'input_text', text }]
            }
          }
        : {
            type: 'user',
            uuid: id,
            timestamp: TS,
            message: { role: 'user', content: text }
          }
    const assistant = (text: string, id = 'a') =>
      provider === 'codex'
        ? {
            type: 'response_item',
            timestamp: TS,
            payload: {
              type: 'message',
              id,
              role: 'assistant',
              content: [{ type: 'output_text', text }],
              phase: 'final_answer'
            }
          }
        : {
            type: 'assistant',
            uuid: `uuid-${id}`,
            timestamp: TS,
            message: {
              id,
              role: 'assistant',
              model: 'claude-fixture',
              content: [{ type: 'text', text }]
            }
          }
    const call = () =>
      provider === 'codex'
        ? {
            type: 'response_item',
            timestamp: TS,
            payload: {
              type: 'function_call',
              call_id: 'call-1',
              name: 'Read',
              arguments: '{"file_path":"fixture.ts"}'
            }
          }
        : {
            type: 'assistant',
            uuid: 'call-row',
            timestamp: TS,
            message: {
              id: 'call-row',
              role: 'assistant',
              model: 'claude-fixture',
              content: [
                {
                  type: 'tool_use',
                  id: 'call-1',
                  name: 'Read',
                  input: { file_path: 'fixture.ts' }
                }
              ]
            }
          }
    const output = (text: string) =>
      provider === 'codex'
        ? {
            type: 'response_item',
            timestamp: TS,
            payload: {
              type: 'function_call_output',
              call_id: 'call-1',
              output: text
            }
          }
        : {
            type: 'user',
            uuid: 'result-row',
            timestamp: TS,
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call-1',
                  content: [{ type: 'text', text }]
                }
              ]
            }
          }
    const write = (rows: any[]) => fs.writeFileSync(file, jsonl(native(rows)))
    const read = (before?: string | null) =>
      readPaneConversation('pane-fixture', { deps, before })
    beforeEach(() => {
      const parent = path.resolve('.agent-state/tmp')
      root = fs.mkdtempSync(path.join(parent, 'pair-fixture-'))
      processStart = '100:1'
      rpcCalls = 0
      const dir =
        provider === 'codex'
          ? path.join(root, 'sessions', '2026', '10', '08')
          : path.join(root, 'projects', '-not-current-cwd')
      fs.mkdirSync(dir, { recursive: true })
      file = path.join(
        dir,
        provider === 'codex'
          ? `rollout-2026-10-08T07-00-00-${ID}.jsonl`
          : `${ID}.jsonl`
      )
      processes = [
        {
          pid: 123,
          name: provider,
          argv0: provider,
          argv: [provider],
          cwd: '/different-cwd'
        }
      ]
      reported = {
        source: `herdr:${provider}`,
        agent: provider,
        kind: 'id',
        value: ID,
        id: OTHER
      }
      snapshot = {
        protocol: 22,
        version: '0.9.3',
        workspaces: [
          {
            workspace_id: 'w',
            label: 'fixture',
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
            label: 'fixture',
            number: 1,
            pane_count: 1,
            focused: true,
            agent_status: 'working'
          }
        ],
        panes: [
          {
            pane_id: 'pane-fixture',
            workspace_id: 'w',
            tab_id: 't',
            terminal_id: 'terminal-fixture',
            agent: provider,
            agent_status: 'working',
            agent_session: reported,
            cwd: '/wrong-cwd',
            focused: true
          }
        ]
      }
      deps = {
        rolloutFiles: async () => [],
        fetchSnapshot: async () => snapshot,
        nativeRpc: async (method, params) => {
          rpcCalls++
          if (method === 'agent.get') {
            expect(params.target).toBe('pane-fixture')
            return {
              agent: {
                pane_id: 'pane-fixture',
                agent: provider,
                agent_session: reported
              }
            }
          }
          expect(params.pane_id).toBe('pane-fixture')
          return {
            process_info: {
              pane_id: 'pane-fixture',
              foreground_processes: processes
            }
          }
        },
        processRoots: async (pid) => ({
          pid,
          start: processStart,
          source: 'kern-procargs2',
          keys: {
            HOME: root,
            CODEX_HOME: provider === 'codex' ? root : null,
            CLAUDE_CONFIG_DIR: provider === 'claude' ? root : null
          }
        })
      }
    })
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
    test('explicit UUID/value precedence, exact custom process root, native user/assistant/call/full result/thinking/model', async () => {
      const body = '  ไทย🙂\n'.repeat(3000) + '  exact end  '
      const thinking =
        provider === 'codex'
          ? {
              type: 'response_item',
              timestamp: TS,
              payload: {
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: 'native thought' }]
              }
            }
          : {
              type: 'assistant',
              uuid: 'thinking',
              timestamp: TS,
              message: {
                id: 'thinking',
                role: 'assistant',
                model: 'claude-fixture',
                content: [{ type: 'thinking', thinking: 'native thought' }]
              }
            }
      const context =
        provider === 'codex'
          ? {
              type: 'turn_context',
              payload: { model: 'codex-fixture', effort: 'high' }
            }
          : {
              type: 'assistant',
              uuid: 'metadata',
              effort: 'high',
              message: {
                id: 'metadata',
                role: 'assistant',
                model: 'claude-fixture',
                content: []
              }
            }
      write([
        user('real prompt'),
        context,
        thinking,
        call(),
        output(body),
        assistant('real answer')
      ])
      const page = await read()
      expect(page.source).toBe(`${provider}-transcript`)
      expect(page.turns[0].role).toBe('user')
      expect(page.turns[0].parts).toContainEqual(
        expect.objectContaining({ kind: 'text', text: 'real prompt' })
      )
      expect(page.turns.flatMap((turn) => turn.parts)).toContainEqual(
        expect.objectContaining({ kind: 'thinking', text: 'native thought' })
      )
      expect(page.metadata).toMatchObject({
        model: `${provider}-fixture`,
        reasoning_effort: 'high'
      })
      const tool = page.turns
        .flatMap((turn) => turn.parts)
        .find((part) => part.kind === 'tool')
      expect(tool).toMatchObject({
        pending: false,
        output: body.slice(0, 16000),
        outputLength: body.length
      })
      const ref = result(page)
      expect(ref.ref).not.toContain(root)
      expect(
        await readPaneToolOutput('pane-fixture', ref.history, ref.ref, { deps })
      ).toMatchObject({
        output: body,
        length: body.length,
        lengthUnit: 'utf16-code-units'
      })
      expect(rpcCalls).toBeGreaterThan(0)
    })
    if (provider === 'codex') test('native FD overrides stale reported UUID; FD session switch retires ref and bare resume argv is not current proof', async () => {
      write([user('current'), call(), output('current result '.repeat(3000))])
      reported = { ...reported, value: OTHER }
      let currentFile = file
      deps.rolloutFiles = async () => [currentFile]
      const old = result(await read())
      const otherFile = path.join(path.dirname(file), `rollout-2026-10-08T08-00-00-${OTHER}.jsonl`)
      fs.writeFileSync(otherFile, jsonl([{ type:'session_meta', payload:{ id:OTHER,cwd:root } }, user('next history')]))
      currentFile = otherFile
      await expect(readPaneToolOutput('pane-fixture', old.history, old.ref, { deps })).rejects.toThrow('Session replaced')
      reported = { source:'herdr:codex',agent:'codex',kind:'id' }
      snapshot.panes[0].agent_session = reported
      processes[0].argv = ['codex','resume',ID]
      deps.rolloutFiles = async () => []
      await expect(read()).rejects.toThrow('Transcript unavailable')
    })
    test('unrelated append keeps ref and logical output revision; supersession changes revision and refuses old ref', async () => {
      const body = 'large🙂ไทย '.repeat(5000)
      write([user('prompt'), call(), output(body)])
      const old = result(await read())
      fs.appendFileSync(
        file,
        jsonl(
          native([assistant('unrelated appended answer')]).slice(
            provider === 'codex' ? 1 : 0
          )
        )
      )
      expect(
        (
          await readPaneToolOutput('pane-fixture', old.history, old.ref, {
            deps
          })
        ).output
      ).toBe(body)
      const current = result(await read())
      expect(current.revision).toBe(old.revision)
      expect(current.ref).not.toBe(old.ref)
      fs.appendFileSync(
        file,
        jsonl(
          native([output('superseded '.repeat(3000))]).slice(
            provider === 'codex' ? 1 : 0
          )
        )
      )
      await expect(
        readPaneToolOutput('pane-fixture', old.history, old.ref, { deps })
      ).rejects.toThrow('Session replaced')
      expect(result(await read()).revision).not.toBe(old.revision)
    })
    test('actual >256KiB raster row projects opaque ref and retrieves exact bytes/MIME/dimensions', async () => {
      const bytes = png()
      expect(bytes.length).toBeGreaterThan(256 * 1024)
      const attachment =
        provider === 'codex'
          ? {
              type: 'response_item',
              timestamp: TS,
              payload: {
                type: 'message',
                id: 'image-user',
                role: 'user',
                content: [
                  {
                    type: 'input_image',
                    image_url: `data:image/png;base64,${bytes.toString('base64')}`
                  }
                ]
              }
            }
          : {
              type: 'user',
              uuid: 'c3333333-3333-4333-8333-333333333333',
              timestamp: TS,
              message: {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: bytes.toString('base64')
                    }
                  }
                ]
              }
            }
      write([user('earlier'), attachment, assistant('later')])
      const page = await read(),
        ref = image(page)
      expect(ref.ref).not.toContain(root)
      expect(ref.ref).not.toContain('image-user')
      expect(ref.ref).not.toContain('base64')
      const fetched = await readPaneNativeImage(
        'pane-fixture',
        ref.history,
        ref.ref,
        { deps }
      )
      expect(fetched.bytes.equals(bytes)).toBe(true)
      expect(fetched).toMatchObject({
        mediaType: 'image/png',
        width: 512,
        height: 512
      })
      await expect(
        readPaneNativeImage('pane-other', ref.history, ref.ref, { deps })
      ).rejects.toThrow()
      await expect(
        readPaneNativeImage('pane-fixture', '0'.repeat(64), ref.ref, { deps })
      ).rejects.toThrow('Session replaced')
      await expect(
        readPaneNativeImage(
          'pane-fixture',
          ref.history,
          ref.ref.slice(0, -2) + 'AA',
          { deps }
        )
      ).rejects.toThrow('Session replaced')
      await expect(
        readPaneToolOutput('pane-fixture', ref.history, ref.ref, { deps })
      ).rejects.toThrow('Session replaced')
      snapshot.panes[0].terminal_id = 'replacement'
      await expect(
        readPaneNativeImage('pane-fixture', ref.history, ref.ref, { deps })
      ).rejects.toThrow('Session replaced')
    })
    test('ambiguity, missing/unreadable process roots and process/session/provider replacement fail closed', async () => {
      write([user('one'), call(), output('output '.repeat(4000))])
      const ref = result(await read())
      processStart = '101:1'
      await expect(
        readPaneToolOutput('pane-fixture', ref.history, ref.ref, { deps })
      ).rejects.toThrow('Session replaced')
      processStart = '100:1'
      processes.push({ ...processes[0], pid: 124 })
      await expect(read()).rejects.toThrow()
      processes.pop()
      const originalRoots = deps.processRoots
      deps.processRoots = async () => {
        throw new Error('private unavailable')
      }
      await expect(read()).rejects.toThrow('Transcript unavailable')
      deps.processRoots = originalRoots
      reported = { ...reported, value: OTHER }
      await expect(
        readPaneToolOutput('pane-fixture', ref.history, ref.ref, { deps })
      ).rejects.toThrow()
      reported = { ...reported, value: ID }
      snapshot.panes[0].agent = 'unsupported'
      await expect(
        readPaneToolOutput('pane-fixture', ref.history, ref.ref, { deps })
      ).rejects.toThrow()
    })
    test('directory/FIFO/symlink native transcript and path escape refuse without hanging', async () => {
      write([user('one')])
      await read()
      fs.unlinkSync(file)
      fs.mkdirSync(file)
      await expect(read()).rejects.toThrow()
      fs.rmdirSync(file)
      execFileSync('/usr/bin/mkfifo', [file])
      await expect(read()).rejects.toThrow()
      fs.unlinkSync(file)
      const external = path.join(root, 'outside.jsonl')
      fs.writeFileSync(external, jsonl(native([user('external')])))
      fs.symlinkSync(external, file)
      await expect(read()).rejects.toThrow()
      fs.unlinkSync(file)
      reported = {
        ...reported,
        kind: 'path',
        value: path.join(root, '..', 'escape.jsonl')
      }
      await expect(read()).rejects.toThrow()
    })
    test('inode replacement, in-place row rewrite and topology post-read changes retire refs', async () => {
      write([user('one'), call(), output('output '.repeat(4000))])
      let ref = result(await read())
      const bytes = fs.readFileSync(file)
      fs.unlinkSync(file)
      fs.writeFileSync(file, bytes)
      await expect(
        readPaneToolOutput('pane-fixture', ref.history, ref.ref, { deps })
      ).rejects.toThrow('Session replaced')
      ref = result(await read())
      const fd = fs.openSync(file, 'r+')
      try {
        fs.writeSync(fd, Buffer.from('Z'), 0, 1, 10000)
      } finally {
        fs.closeSync(fd)
      }
      await expect(
        readPaneToolOutput('pane-fixture', ref.history, ref.ref, { deps })
      ).rejects.toThrow('Session replaced')
    })
    test('full native output above 256KiB remains UTF8 exact and older pages reconcile a tool call', async () => {
      const body = 'ไทย🙂 full\n'.repeat(30000)
      write([user('prompt'), call(), output(body), assistant('after')])
      const page = await read(),
        ref = result(page)
      expect(
        (
          await readPaneToolOutput('pane-fixture', ref.history, ref.ref, {
            deps
          })
        ).output
      ).toBe(body)
      expect(page.before).not.toBeNull()
      const older = await read(page.before)
      const { groupContributions } =
        await import('../../../src/types/conversation.ts')
      expect(
        groupContributions([
          ...(older.contributions ?? []),
          ...(page.contributions ?? [])
        ])
          .flatMap((turn) => turn.parts)
          .find((part) => part.kind === 'tool')
      ).toMatchObject({ pending: false, output: body.slice(0, 16000) })
    })
    test('foreign Host/Origin/owner invoke neither snapshots nor native/process/file reader', async () => {
      let calls = 0
      const imageReader: typeof readPaneNativeImage = async () => {
        calls++
        throw new Error('must not execute')
      }
      const outputReader: typeof readPaneToolOutput = async () => {
        calls++
        throw new Error('must not execute')
      }
      const deniedHeaders: HeadersInit[] = [
        { host: 'foreign.example', origin: 'http://127.0.0.1:8787' },
        { host: '127.0.0.1:8787', origin: 'https://foreign.example' },
        { host: 'fixture.ts.net', 'tailscale-user-login': 'other@example.com' }
      ]
      for (const headers of deniedHeaders) {
        const request = new Request(
          'http://127.0.0.1:8787/api/conversation/image?pane_id=bad',
          { headers: headers as HeadersInit }
        )
        expect(
          (
            await handleConversationImageRequest(request, {
              ownerLogin: 'owner@example.com',
              readImage: imageReader
            })
          ).status
        ).toBeGreaterThanOrEqual(400)
        expect(
          (
            await handleConversationOutputRequest(request, {
              ownerLogin: 'owner@example.com',
              readOutput: outputReader
            })
          ).status
        ).toBeGreaterThanOrEqual(400)
      }
      expect(calls).toBe(0)
    })
    if (provider === 'claude')
      test('stream snapshot replacement, compact, runtime suppression and native clear fence old cursor/output/image', async () => {
        write([
          user('<command-name>/model</command-name>', 'echo'),
          user('real', 'u'),
          assistant('stream partial', 'same'),
          assistant('stream whole', 'same'),
          {
            type: 'user',
            uuid: 'compact',
            isCompactSummary: true,
            message: { role: 'user', content: 'native compact summary' }
          },
          call(),
          output('old output '.repeat(4000))
        ])
        const page = await read()
        expect(
          page.turns
            .flatMap((turn) => turn.parts)
            .filter(
              (part) => part.kind === 'text' && part.text === 'stream partial'
            )
        ).toHaveLength(0)
        expect(page.turns.flatMap((turn) => turn.parts)).toContainEqual(
          expect.objectContaining({
            kind: 'compact',
            text: 'native compact summary'
          })
        )
        expect(
          page.turns
            .flatMap((turn) => turn.parts)
            .some(
              (part) => part.kind === 'text' && part.text.includes('/model')
            )
        ).toBe(false)
        const old = result(page)
        fs.appendFileSync(
          file,
          jsonl(
            native([
              user('<command-name>/clear</command-name>', 'clear'),
              user('after clear', 'new')
            ])
          )
        )
        const reset = await read()
        expect(reset.sessionKey).not.toBe(old.history)
        expect(reset.turns.flatMap((turn) => turn.parts)).toEqual([
          expect.objectContaining({ kind: 'text', text: 'after clear' })
        ])
        await expect(
          readPaneToolOutput('pane-fixture', old.history, old.ref, { deps })
        ).rejects.toThrow('Session replaced')
        const mismatch = { ...user('bad'), sessionId: OTHER }
        fs.writeFileSync(file, jsonl([mismatch]))
        await expect(read()).rejects.toThrow('Native session metadata mismatch')
      })
    if (provider === 'codex')
      test('event/response mirror semantics, context suppression, recorded model/effort clearing and native local attachment', async () => {
        const bytes = png()
        fs.writeFileSync(path.join(root, 'attachment.png'), bytes)
        write([
          {
            type: 'event_msg',
            timestamp: TS,
            payload: {
              type: 'user_message',
              message: 'real prompt',
              local_images: ['attachment.png']
            }
          },
          {
            ...user('real prompt'),
            payload: {
              ...user('real prompt').payload,
              content: [
                { type: 'input_text', text: 'real prompt' },
                {
                  type: 'input_image',
                  image_url: `data:image/png;base64,${bytes.toString('base64')}`
                }
              ]
            }
          },
          user('<environment_context>runtime</environment_context>'),
          {
            type: 'turn_context',
            payload: { model: 'codex-fixture', effort: 'high' }
          },
          { type: 'turn_context', payload: { model: 'codex-fixture' } },
          {
            type: 'event_msg',
            timestamp: TS,
            payload: {
              type: 'agent_message',
              message: 'answer',
              phase: 'commentary'
            }
          },
          assistant('answer')
        ])
        const page = await read()
        expect(page.turns.filter((turn) => turn.role === 'user')).toHaveLength(
          1
        )
        expect(
          page.turns
            .flatMap((turn) => turn.parts)
            .filter((part) => part.kind === 'text' && part.text === 'answer')
        ).toHaveLength(1)
        expect(page.metadata.reasoning_effort).toBeNull()
        const ref = image(page)
        expect(
          (
            await readPaneNativeImage('pane-fixture', ref.history, ref.ref, {
              deps
            })
          ).bytes.equals(bytes)
        ).toBe(true)
        expect(
          page.turns
            .flatMap((turn) => turn.parts)
            .filter((part) => part.kind === 'text')
        ).toContainEqual(
          expect.objectContaining({ phase: 'final_answer', text: 'answer' })
        )
      })
    if (provider === 'codex')
      test('resumed native history_base cut excludes discarded bytes without opening SQLite or writing sidecars', async () => {
        const parentFile = path.join(
          path.dirname(file),
          `rollout-2026-10-08T06-00-00-${OTHER}.jsonl`
        )
        const parentRows = [
          { type: 'session_meta', payload: { id: OTHER, cwd: root } },
          user('inherited', 'inherited')
        ]
        const prefix = jsonl(parentRows)
        fs.writeFileSync(
          parentFile,
          prefix + jsonl([user('discarded', 'discarded')])
        )
        fs.writeFileSync(
          file,
          jsonl([
            {
              type: 'session_meta',
              payload: {
                id: ID,
                cwd: root,
                history_base: {
                  thread_id: OTHER,
                  end_ordinal_exclusive: 2,
                  end_byte_offset: Buffer.byteLength(prefix)
                }
              }
            },
            user('resumed', 'resumed'),
            call(),
            output('resumed result '.repeat(3000))
          ])
        )
        reported = { ...reported, kind: 'path', value: file }
        snapshot.panes[0].agent_session = { ...reported, value: ID }
        const db = path.join(root, 'state_5.sqlite')
        fs.writeFileSync(
          db,
          'not a DB; exact rollout evidence must avoid opening this'
        )
        const before = fs.readdirSync(root).sort()
        const bytes = fs.readFileSync(db)
        const page = await read()
        expect(
          page.turns
            .flatMap((turn) => turn.parts)
            .some((part) => part.kind === 'text' && part.text === 'inherited')
        ).toBe(true)
        expect(
          page.turns
            .flatMap((turn) => turn.parts)
            .some((part) => part.kind === 'text' && part.text === 'discarded')
        ).toBe(false)
        const ref = result(page)
        fs.appendFileSync(file, jsonl([assistant('ordinary append')]))
        expect(
          (
            await readPaneToolOutput('pane-fixture', ref.history, ref.ref, {
              deps
            })
          ).output
        ).toBe('resumed result '.repeat(3000))
        expect(fs.readFileSync(db).equals(bytes)).toBe(true)
        expect(fs.readdirSync(root).sort()).toEqual(before)
      })
  })
