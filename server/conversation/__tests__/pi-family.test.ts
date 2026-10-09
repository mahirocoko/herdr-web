import { describe, test, expect } from 'bun:test'
import { selectedProcessRoots } from '../native-process-root.ts'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  readPaneConversation,
  readPaneToolOutput,
  readPaneNativeImage
} from '../conversation-reader.ts'
import type { ISnapshotResult } from '../../types.ts'
import { familyContributions, familyImages } from '../pi-family-parser.ts'
import { projectFamilyHistory } from '../pi-family-history.ts'
import { familyProcess, resolveFamily } from '../pi-family-resolver.ts'
import { groupContributions } from '../../../src/types/conversation.ts'
const json = (rows: any[]) =>
  Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
describe('pi-family source fixtures only', () => {
  test('actual fixed-key family extraction stays opt-in for existing pair roots', async () => {
    if (process.platform !== 'darwin') return
    const child = Bun.spawn(
      [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      {
        env: {
          HOME: '/fixture',
          PI_CODING_AGENT_DIR: '/fixture/pi',
          OMO_CODING_AGENT_DIR: '/fixture/omo',
          OPAQUE_SECRET: 'DO_NOT_EXPOSE'
        },
        stdout: 'ignore',
        stderr: 'ignore'
      }
    )
    try {
      expect((await selectedProcessRoots(child.pid)).keys).toEqual({
        HOME: '/fixture',
        CODEX_HOME: null,
        CLAUDE_CONFIG_DIR: null
      })
      const family = await selectedProcessRoots(child.pid, true)
      expect(family.keys.PI_CODING_AGENT_DIR).toBe('/fixture/pi')
      expect(family.keys.OMO_CODING_AGENT_DIR).toBe('/fixture/omo')
      expect(JSON.stringify(family)).not.toContain('DO_NOT_EXPOSE')
    } finally {
      child.kill()
      await child.exited
    }
  })
  test('modern chained skill invocation suppresses instruction bodies; settled replies split work blocks', () => {
    const prompt =
      'The user explicitly invoked the "review" skill. Follow the instructions in <skill-instruction> as binding for this request, while respecting higher-priority instructions.\n\n<skill-instruction name="review" location="/skills/review/SKILL.md">\nprivate instruction body\n</skill-instruction>\n\n<user-request>\ncheck this\n</user-request>'
    const rows = [
      { type: 'message', id: 'u', message: { role: 'user', content: prompt } },
      {
        type: 'message',
        id: 'a',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'first answer'
        }
      },
      {
        type: 'message',
        id: 'b',
        message: { role: 'assistant', content: 'background response' }
      }
    ].flatMap((row, index) => familyContributions(JSON.stringify(row), index))
    const turns = groupContributions(rows)
    expect(turns).toHaveLength(3)
    expect(JSON.stringify(turns)).not.toContain('private instruction body')
    expect(turns[0].parts).toContainEqual(
      expect.objectContaining({
        kind: 'skill',
        skill: expect.objectContaining({ name: 'review', status: 'loaded' })
      })
    )
  })
  test('OmO live holder outranks stale agent path and refuses reused-pid holder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-holder-'))
    try {
      const dir = path.join(root, '--cwd--'),
        holder = path.join(dir, 'session-holders', 'held', '10.json')
      fs.mkdirSync(path.dirname(holder), { recursive: true })
      fs.writeFileSync(
        holder,
        JSON.stringify({ pid: 10, processStartedAtMs: 1000 })
      )
      const file = path.join(dir, 'timestamp_held.jsonl')
      fs.writeFileSync(
        file,
        json([{ type: 'session', id: 'held', cwd: '/cwd' }])
      )
      const deps = {
        familyRoots: { omo: root },
        processRoots: async (pid: number) => ({
          pid,
          start: '1:0',
          source: 'kern-procargs2' as const,
          keys: { HOME: root, CODEX_HOME: null, CLAUDE_CONFIG_DIR: null }
        }),
        nativeRpc: async (method: string) =>
          method === 'agent.get'
            ? {
                agent: {
                  pane_id: 'p',
                  agent: 'claude',
                  agent_session: {
                    agent: 'omo',
                    kind: 'path',
                    value: path.join(dir, 'stale.jsonl')
                  }
                }
              }
            : {
                process_info: {
                  pane_id: 'p',
                  foreground_processes: [{ pid: 10, argv: ['omo'] }]
                }
              }
      }
      const resolve = () =>
        resolveFamily(
          'p',
          '/cwd',
          undefined,
          deps,
          (file) => JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]),
          (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
          () => ({ text: '', mtime: 0 })
        )
      expect((await resolve())?.file).toBe(file)
      fs.writeFileSync(
        holder,
        JSON.stringify({ pid: 10, processStartedAtMs: 9999999 })
      )
      await expect(resolve()).rejects.toThrow()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  for (const provider of ['omp', 'omo', 'gjc', 'pi'] as const)
    test(`${provider} fenced reader, whole output and session replacement`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-family-'))
      try {
        fs.mkdirSync(path.join(root, 'slug'))
        const file = path.join(root, 'slug', 'session.jsonl')
        const output = 'whole native output '.repeat(1000)
        fs.writeFileSync(
          file,
          json([
            { type: 'session', id: 'native-session', cwd: '/cwd' },
            {
              type: 'model_change',
              id: 'm',
              parentId: null,
              modelId: 'native-model'
            },
            {
              type: 'thinking_level_change',
              id: 'level',
              parentId: 'm',
              thinkingLevel: 'medium'
            },
            {
              type: 'message',
              id: 'u',
              parentId: 'level',
              message: { role: 'user', content: 'ask' }
            },
            {
              type: 'message',
              id: 'a',
              parentId: 'u',
              message: {
                role: 'assistant',
                content: [
                  {
                    type: 'toolCall',
                    id: 'call',
                    name: 'read',
                    arguments: { path: 'file' }
                  }
                ]
              }
            },
            {
              type: 'message',
              id: 'r',
              parentId: 'a',
              message: {
                role: 'toolResult',
                toolCallId: 'call',
                content: [
                  { type: 'text', text: output },
                  {
                    type: 'image',
                    mimeType: 'image/png',
                    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5v0AAAAASUVORK5CYII='
                  }
                ]
              }
            },
            {
              type: 'message',
              id: 'done',
              parentId: 'r',
              message: {
                role: 'assistant',
                model: 'native-model',
                usage: { input: 123, output: 5 },
                stopReason: 'stop',
                content: [{ type: 'text', text: 'done' }]
              }
            }
          ])
        )
        const session = { agent: provider, kind: 'path', value: file }
        const snapshot = {
          workspaces: [{ workspace_id: 'w' }],
          tabs: [{ tab_id: 't', workspace_id: 'w' }],
          panes: [
            {
              pane_id: 'p',
              workspace_id: 'w',
              tab_id: 't',
              terminal_id: 'terminal',
              agent: provider,
              agent_session: session,
              cwd: '/cwd'
            }
          ]
        } as unknown as ISnapshotResult
        const deps = {
          familyRoots: { [provider]: root },
          fetchSnapshot: async () => snapshot,
          processRoots: async (pid: number) => ({
            pid,
            start: '1:1',
            source: 'kern-procargs2' as const,
            keys: { HOME: root, CODEX_HOME: null, CLAUDE_CONFIG_DIR: null }
          }),
          nativeRpc: async (method: string) =>
            method === 'agent.get'
              ? {
                  agent: {
                    pane_id: 'p',
                    agent: provider,
                    agent_session: session
                  }
                }
              : {
                  process_info: {
                    pane_id: 'p',
                    foreground_processes: [{ pid: 10, argv: [provider] }]
                  }
                }
        }
        Object.assign(deps, {
          familyFiles: async () => (provider === 'gjc' ? [file] : [])
        })
        const page = await readPaneConversation('p', { deps })
        expect(page.source).toBe(`${provider}-transcript`)
        expect(page.metadata).toMatchObject({
          model: 'native-model',
          reasoning_effort: 'medium',
          context: { used: provider === 'pi' ? 128 : 123, window: null }
        })
        const ref = page.contributions?.find((row) => row.result?.outputRef)
          ?.result?.outputRef
        expect(ref).toBeString()
        expect(
          (await readPaneToolOutput('p', page.sessionKey, ref!, { deps }))
            .output
        ).toBe(output)
        const image = page.contributions
          ?.flatMap((row) => row.parts)
          .find((part) => part.kind === 'image')
        expect(image?.kind).toBe('image')
        if (image?.kind === 'image')
          expect(
            await readPaneNativeImage('p', page.sessionKey, image.ref, { deps })
          ).toMatchObject({ mediaType: 'image/png', width: 1, height: 1 })
        if (provider === 'pi') {
          fs.appendFileSync(
            file,
            json([
              {
                type: 'message',
                id: 'alternate',
                parentId: 'u',
                message: { role: 'assistant', content: 'new branch' }
              }
            ])
          )
          const branch = await readPaneConversation('p', { deps })
          expect(branch.sessionKey).not.toBe(page.sessionKey)
          expect(
            branch.turns
              .flatMap((turn) => turn.parts)
              .filter((part) => part.kind === 'tool')
          ).toEqual([])
          await expect(
            readPaneToolOutput('p', page.sessionKey, ref!, { deps })
          ).rejects.toThrow('Session replaced')
        }
        session.value = path.join(root, 'slug', 'replacement.jsonl')
        await expect(
          readPaneToolOutput('p', page.sessionKey, ref!, { deps })
        ).rejects.toThrow()
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  test('native alternate call/result spellings pair by ID and retain exact whole output', () => {
    const rows = [
      {
        type: 'message',
        id: 'u',
        message: { role: 'user', content: 'request' }
      },
      {
        type: 'message',
        id: 'a',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              toolName: 'read',
              toolCallId: 'call',
              toolInput: { path: 'file' }
            }
          ]
        }
      },
      {
        type: 'message',
        id: 'r',
        message: {
          role: 'toolResult',
          callId: 'call',
          content: [{ type: 'text', text: 'answer' }]
        }
      },
      {
        type: 'message',
        id: 'b',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: 'done' }]
        }
      }
    ].flatMap((row, index) => familyContributions(JSON.stringify(row), index))
    expect(groupContributions(rows)[1].parts).toContainEqual(
      expect.objectContaining({
        kind: 'tool',
        id: 'call',
        output: 'answer',
        pending: false
      })
    )
  })
  test('branch omits abandoned output; layout retains byte identity and rejects missing parents', () => {
    const bytes = json([
      { type: 'session', id: 'session' },
      { type: 'message', id: 'a', parentId: null },
      { type: 'message', id: 'old', parentId: 'a' },
      { type: 'message', id: 'new', parentId: 'a' }
    ])
    const result = projectFamilyHistory(
      bytes.length,
      (start, length) => bytes.subarray(start, start + length),
      true
    )
    const projected = result
      .segments!.map((segment) =>
        bytes.subarray(segment.start, segment.end).toString()
      )
      .join('')
    expect(projected).toContain('new')
    expect(projected).not.toContain('old')
    const broken = json([{ type: 'message', id: 'leaf', parentId: 'missing' }])
    expect(() =>
      projectFamilyHistory(
        broken.length,
        (start, length) => broken.subarray(start, start + length),
        true
      )
    ).toThrow('parent')
  })
  test('hidden message, skill envelope, reset and native inline tool image semantics', () => {
    expect(
      familyContributions(
        JSON.stringify({
          type: 'message',
          id: 'hidden',
          display: false,
          message: { role: 'user', content: 'hidden' }
        }),
        0
      )
    ).toEqual([])
    expect(
      familyContributions(
        JSON.stringify({
          type: 'custom',
          id: 'clear',
          customType: 'context_clear'
        }),
        0
      )[0].reset
    ).toBe(true)
    expect(
      familyImages({
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'c',
          content: [{ type: 'image', mimeType: 'image/png', data: 'native' }]
        }
      })
    ).toEqual([
      {
        key: 'image:0',
        mediaType: 'image/png',
        value: 'native',
        inline: true,
        callId: 'c'
      }
    ])
  })
  test('provider program ownership does not inspect arbitrary command arguments', () => {
    expect(familyProcess({ argv: ['grep', '/bin/omo'] })).toBeNull()
    expect(familyProcess({ argv: ['node', '--eval', 'pi'] })).toBeNull()
    expect(familyProcess({ argv: ['bun', '/x/omo-ai/cli.js'] })).toBe('omo')
  })
  for (const provider of ['omp', 'omo', 'gjc', 'pi'] as const)
    test(`${provider} exact native path and header identity, no cwd guessing`, async () => {
      const file = '/fixture/sessions/slug/session.jsonl'
      const deps = {
        familyRoots: { [provider]: '/fixture/sessions' },
        processRoots: async (pid: number) => ({
          pid,
          start: '1:1',
          source: 'kern-procargs2' as const,
          keys: { HOME: '/fixture', CODEX_HOME: null, CLAUDE_CONFIG_DIR: null }
        }),
        nativeRpc: async (method: string) =>
          method === 'agent.get'
            ? {
                agent: {
                  pane_id: 'p',
                  agent: provider,
                  agent_session: { agent: provider, kind: 'path', value: file }
                }
              }
            : {
                process_info: {
                  pane_id: 'p',
                  foreground_processes: [{ pid: 10, argv: [provider] }]
                }
              }
      }
      const result = await resolveFamily(
        'p',
        '/cwd',
        file,
        {
          ...deps,
          familyFiles: async () => (provider === 'gjc' ? [file] : [])
        },
        () => ({ type: 'session', id: 'id', cwd: '/cwd' }),
        () => ({}),
        () => ({ text: '', mtime: 0 })
      )
      expect(result?.source).toBe(`${provider}-transcript`)
      await result?.validate()
      await expect(
        resolveFamily(
          'p',
          '/wrong',
          file,
          {
            ...deps,
            familyFiles: async () => (provider === 'gjc' ? [file] : [])
          },
          () => ({ type: 'session', id: 'id', cwd: '/cwd' }),
          () => ({}),
          () => ({ text: '', mtime: 0 })
        )
      ).rejects.toThrow('authority')
    })
})
