import { describe, expect, test } from 'bun:test'
import {
  answerKeys,
  modelListWaits,
  parseInteractivePrompt,
  promptMetadata,
  sourcePromptBlocksFallback
} from '../prompt-parser.ts'
import { InteractivePromptService } from '../interactive-prompt.ts'
import type { ISnapshotResult } from '../types.ts'
import { pairContributions } from '../conversation/pair-parser.ts'

const approval = (footer: string) => `
Bash command

echo safe
This command requires approval
Do you want to proceed?
❯ 1. Yes
  2. No

${footer}
`

const question = (cursor = 0, multi = true, draft = 'Type something.') => `
☐ Checks
Which checks?
${cursor === 0 ? '❯' : ' '} 1. ${multi ? '[✔] ' : ''}Lint
${cursor === 1 ? '❯' : ' '} 2. ${multi ? '[ ] ' : ''}Tests
${cursor === 2 ? '❯' : ' '} 3. ${draft}
${multi ? `${cursor === 3 ? '❯' : ' '} Submit` : ''}
────────────────────────────
${cursor === (multi ? 4 : 3) ? '❯' : ' '} 4. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel
`
const modelHint =
  'Enter to set as default · s to use this session only · Esc to cancel'
const model = (hint: string) => `
Select model
❯ 1. Default (recommended) ✔
  2. Sonnet
${hint}
`
const claudeSnapshot = (): ISnapshotResult => ({
  protocol: 22,
  version: '0.9.3',
  workspaces: [],
  tabs: [],
  panes: [
    {
      pane_id: 'w1:p1',
      terminal_id: 't1',
      workspace_id: 'w1',
      tab_id: 'tab1',
      agent: 'claude',
      agent_status: 'blocked',
      agent_session: {
        value: 's1',
        source: 'native',
        agent: 'claude',
        kind: 'id'
      },
      cwd: '/synthetic',
      focused: false
    }
  ]
})

describe('bounded upstream prompt delta', () => {
  test('refuted stale legacy/model tails cannot authorize any service write', async () => {
    const wrapped =
      'Enter to set\nas def\nault · s to\nuse this\nsession only ·\nEsc to\ncancel'
    for (const [valid, stale] of [
      [
        approval('Esc to cancel · Tab to amend · ctrl+e to explain'),
        approval(
          'Esc to cancel · Tab to amend · ctrl+e to explain\n● Finished\nExample: ctrl+e to explain'
        )
      ],
      [model(wrapped), model(`${wrapped} unrelated later output`)],
      [model(wrapped), `${model(wrapped)}\n● Finished\nExample: ${modelHint}`]
    ]) {
      expect(parseInteractivePrompt('claude', stale)).toBeNull()
      expect(modelListWaits('claude', stale)).toBe(false)
      let screen = valid
      const sends: unknown[] = []
      const service = new InteractivePromptService({
        fetchSnapshot: async () => claudeSnapshot(),
        readScreen: async () => screen,
        keys: async (_pane, keys) => {
          sends.push(keys)
        },
        text: async (_pane, text) => {
          sends.push(text)
        }
      })
      const read = await service.read('w1:p1')
      expect(read.prompt).not.toBeNull()
      screen = stale
      const outcome = await service.answer(read.target, read.prompt!.id, {
        option_index: 0
      })
      expect(outcome.outcome).toBe('rejected')
      expect(sends).toEqual([])
      expect((await service.read('w1:p1')).prompt).toBeNull()
    }
  })

  test('native approval evidence blocks fallback even when parsing fails', async () => {
    for (const footer of [
      'Esc to cancel\nPassword:\nEsc to cancel',
      'Esc to cancel · Tab to amend · ctrl+e to explain\nPassword:\nEsc to cancel',
      'Esc to cancel\n● Finished\nEsc to cancel · Tab to amend\n· ctrl+e to explain'
    ]) {
      let screen = approval('Esc to cancel')
      const sends: unknown[] = []
      const service = new InteractivePromptService({
        fetchSnapshot: async () => claudeSnapshot(),
        readScreen: async () => screen,
        keys: async (_pane, keys) => {
          sends.push(keys)
        },
        text: async (_pane, text) => {
          sends.push(text)
        }
      })
      const valid = await service.read('w1:p1')
      expect(valid.prompt?.kind).toBe('approval')
      screen = approval(footer)
      expect(parseInteractivePrompt('claude', screen)).toBeNull()
      expect(sourcePromptBlocksFallback('claude', screen)).toBe(true)
      expect(
        (
          await service.answer(valid.target, valid.prompt!.id, {
            option_index: 0
          })
        ).outcome
      ).toBe('rejected')
      expect((await service.read('w1:p1')).prompt).toBeNull()
      expect(sends).toEqual([])
    }
  })

  test('complete contiguous approval footer owns server answer keys', async () => {
    let cursor = 0
    const sends: string[][] = []
    const service = new InteractivePromptService({
      fetchSnapshot: async () => claudeSnapshot(),
      readScreen: async () =>
        approval('Esc to cancel · Tab to amend\n· ctrl+e to explain')
          .replace('❯ 1.', `${cursor === 0 ? '❯' : ' '} 1.`)
          .replace('  2.', `${cursor === 1 ? '❯' : ' '} 2.`),
      keys: async (_pane, keys) => {
        sends.push(keys)
        if (keys[0] === 'down') cursor++
      }
    })
    const read = await service.read('w1:p1')
    expect(read.prompt?.kind).toBe('approval')
    expect(read.prompt?.fallback).not.toBe(true)
    expect(
      (await service.answer(read.target, read.prompt!.id, { option_index: 1 }))
        .outcome
    ).toBe('acknowledged')
    expect(sends).toEqual([['down'], ['enter']])
  })

  test('unknown blocked input retains generic fallback without native evidence', async () => {
    expect(
      sourcePromptBlocksFallback('claude', 'Password:\nEsc to cancel')
    ).toBe(false)
    const service = new InteractivePromptService({
      fetchSnapshot: async () => claudeSnapshot(),
      readScreen: async () => 'Password:\nEsc to cancel'
    })
    expect((await service.read('w1:p1')).prompt?.fallback).toBe(true)
  })

  test('instruction closing tags in appended human prose cannot consume the native envelope', () => {
    const envelope =
      '# AGENTS.md instructions for /fixture\n<INSTRUCTIONS>rules</INSTRUCTIONS>'
    for (const text of [
      `${envelope}\nPlease explain <INSTRUCTIONS>this example</INSTRUCTIONS>`,
      `${envelope}\n<environment_context>cwd</environment_context>\nPlease explain <environment_context>this example</environment_context>`,
      '<environment_context>cwd</environment_context>\nPlease explain <environment_context>this example</environment_context>'
    ]) {
      for (const event of [true, false]) {
        const rows = pairContributions(
          JSON.stringify({
            type: event ? 'event_msg' : 'response_item',
            payload: event
              ? { type: 'user_message', message: text }
              : {
                  type: 'message',
                  role: 'user',
                  content: [{ type: 'input_text', text }]
                }
          }),
          0,
          'codex-transcript'
        )
        expect(rows[0]?.parts).toContainEqual(
          expect.objectContaining({ kind: 'text', text })
        )
      }
    }
  })
  test('Claude checked glyph and unnumbered Submit are real cursor positions', () => {
    for (const cursor of [0, 3, 4]) {
      const prompt = parseInteractivePrompt('claude', question(cursor))
      expect(prompt?.multi_select).toBe(true)
      expect(prompt?.options.map((row) => row.label)).toEqual(['Lint', 'Tests'])
      expect(promptMetadata(prompt!)?.selectedIndex).toBe(cursor)
      expect(promptMetadata(prompt!)?.checkedOptionIndices).toEqual([0])
      expect(answerKeys(prompt!, { option_indices: [0] })).toEqual([
        { keys: ['right'] }
      ])
    }
    expect(
      answerKeys(parseInteractivePrompt('claude', question(4))!, {
        option_indices: [1]
      })
    ).toEqual([
      ...Array.from({ length: 4 }, () => ({ keys: ['up'] })),
      { keys: ['enter'] },
      { keys: ['down'] },
      { keys: ['enter'] },
      { keys: ['right'] }
    ])
  })

  test('Claude drafted custom answer clears both sides before replacement', () => {
    const prompt = parseInteractivePrompt(
      'claude',
      question(0, false, 'old draft')
    )
    expect(prompt?.custom_option_index).toBe(2)
    expect(answerKeys(prompt!, { custom_text: 'replacement' })).toEqual([
      { keys: ['down'] },
      { keys: ['down'] },
      { keys: ['ctrl+k'] },
      { keys: ['ctrl+u'] },
      { text: 'replacement' },
      { keys: ['enter'] }
    ])
    expect(
      parseInteractivePrompt(
        'claude',
        question(0, false, 'old draft').replace('☐ Checks', '● Example')
      )
    ).toBeNull()
  })

  test('wrapped model hints are read and guarded consistently, never quoted or stale output', () => {
    const wrapped =
      'Enter to set\nas def\nault · s to\nuse this\nsession only ·\nEsc to\ncancel'
    const prompt = parseInteractivePrompt('claude', model(wrapped))
    expect(prompt?.options.map((row) => row.label)).toEqual([
      'Default (recommended)',
      'Sonnet'
    ])
    expect(answerKeys(prompt!, { option_index: 1 })).toEqual([
      { keys: ['down'] },
      { text: 's' }
    ])
    expect(modelListWaits('claude', model(wrapped))).toBe(true)
    for (const screen of [
      model(`● Example: ${modelHint}`),
      `${model(wrapped)}\n● Finished`
    ]) {
      expect(modelListWaits('claude', screen)).toBe(false)
      expect(parseInteractivePrompt('claude', screen)).toBeNull()
    }
  })

  test('custom draft clearing is revalidated per write and stops on question replacement', async () => {
    for (const replaceAfterClear of [false, true]) {
      let cursor = 0,
        draft = 'old draft',
        replaced = false
      const sends: unknown[] = []
      const service = new InteractivePromptService({
        fetchSnapshot: async () => claudeSnapshot(),
        readScreen: async () =>
          replaced
            ? question(cursor, false, draft).replace(
                'Which checks?',
                'Another question?'
              )
            : question(cursor, false, draft),
        keys: async (_pane, keys) => {
          sends.push(keys)
          if (keys[0] === 'down') cursor++
          if (keys[0] === 'ctrl+k') draft = 'old'
          if (keys[0] === 'ctrl+u') {
            draft = 'Type something.'
            replaced = replaceAfterClear
          }
        },
        text: async (_pane, text) => {
          sends.push(text)
          draft = text
        }
      })
      const read = await service.read('w1:p1')
      expect(read.prompt).not.toBeNull()
      const result = await service.answer(read.target, read.prompt!.id, {
        custom_text: 'replacement'
      })
      expect(result.outcome).toBe(
        replaceAfterClear ? 'unknown' : 'acknowledged'
      )
      expect(sends).toEqual([
        ['down'],
        ['down'],
        ['ctrl+k'],
        ['ctrl+u'],
        ...(!replaceAfterClear ? ['replacement', ['enter']] : [])
      ])
    }
  })
  test('multi-select walks through Submit and Chat with exact checked-state revalidation', async () => {
    for (const drift of ['none', 'question', 'submit'] as const) {
      let cursor = 4,
        checks = new Set([0]),
        replaced = false
      const sends: string[][] = []
      const service = new InteractivePromptService({
        fetchSnapshot: async () => claudeSnapshot(),
        readScreen: async () =>
          question(cursor)
            .replace('[✔] Lint', `${checks.has(0) ? '[✔]' : '[ ]'} Lint`)
            .replace('[ ] Tests', `${checks.has(1) ? '[✔]' : '[ ]'} Tests`)
            .replace(
              'Which checks?',
              replaced && drift === 'question'
                ? 'Other checks?'
                : 'Which checks?'
            )
            .replace(
              '  Submit',
              replaced && drift === 'submit' ? '' : '  Submit'
            ),
        keys: async (_pane, keys) => {
          sends.push(keys)
          if (keys[0] === 'up') cursor--
          if (keys[0] === 'down') cursor++
          if (keys[0] === 'enter') {
            if (checks.has(cursor)) checks.delete(cursor)
            else checks.add(cursor)
            replaced = drift !== 'none'
          }
        }
      })
      const read = await service.read('w1:p1')
      const result = await service.answer(read.target, read.prompt!.id, {
        option_indices: [1]
      })
      expect(result.outcome).toBe(drift !== 'none' ? 'unknown' : 'acknowledged')
      expect(sends).toEqual([
        ['up'],
        ['up'],
        ['up'],
        ['up'],
        ['enter'],
        ...(drift === 'none' ? [['down'], ['enter'], ['right']] : [])
      ])
    }
  })

  test('wrapped Claude model session pick checks the moved cursor before writing s', async () => {
    let cursor = 0
    const sends: unknown[] = []
    const service = new InteractivePromptService({
      fetchSnapshot: async () => claudeSnapshot(),
      readScreen: async () =>
        model(modelHint.replace('default', 'def\nault'))
          .replace('❯ 1.', `${cursor === 0 ? '❯' : ' '} 1.`)
          .replace('  2.', `${cursor === 1 ? '❯' : ' '} 2.`),
      keys: async (_pane, keys) => {
        sends.push(keys)
        if (keys[0] === 'down') cursor++
      },
      text: async (_pane, text) => {
        sends.push(text)
      }
    })
    const read = await service.read('w1:p1')
    expect(
      (await service.answer(read.target, read.prompt!.id, { option_index: 1 }))
        .outcome
    ).toBe('acknowledged')
    expect(sends).toEqual([['down'], 's'])
  })

  test('new Claude cancel footers preserve server-owned answer steps', () => {
    for (const footer of [
      'Esc to cancel',
      'Esc to cancel · Ctrl+X Ctrl+K twice to stop background agents'
    ]) {
      const prompt = parseInteractivePrompt('claude', approval(footer))
      expect(prompt?.kind).toBe('approval')
      expect(answerKeys(prompt!, { option_index: 1 })).toEqual([
        { keys: ['down'] },
        { keys: ['enter'] }
      ])
    }
  })

  test('later output or another cancel input cannot revive an old approval', () => {
    for (const tail of [
      'Esc to cancel arbitrary later output',
      'Esc to cancel\nPassword:\nEsc to cancel',
      'Esc to cancel · Tab to amend · ctrl+e to explain\nPassword:\nEsc to cancel',
      'Esc to cancel\n● Command finished'
    ])
      expect(parseInteractivePrompt('claude', approval(tail))).toBeNull()
  })

  test('Claude local command stream sequences retain text without wrapper leakage', () => {
    const parse = (content: string) =>
      pairContributions(
        JSON.stringify({
          type: 'system',
          subtype: 'local_command',
          content
        }),
        0,
        'claude-transcript'
      )
    for (const content of [
      '<local-command-stdout>first</local-command-stdout>\n<local-command-stderr>\u001b[31msecond\u001b[0m</local-command-stderr>',
      '<local-command-stdout>first</local-command-stdout><local-command-stdout>second</local-command-stdout>'
    ])
      expect(parse(content)[0]?.parts).toEqual([
        expect.objectContaining({
          kind: 'notice',
          text: 'first\nsecond',
          truncated: false
        })
      ])
    expect(
      parse(
        '<local-command-stdout>literal </local-command-stdout> tag</local-command-stdout>'
      )[0]?.parts
    ).toEqual([
      expect.objectContaining({
        kind: 'notice',
        text: 'literal </local-command-stdout> tag'
      })
    ])
    for (const content of [
      'quoted <local-command-stdout>x</local-command-stdout>',
      '<local-command-stdout>x</local-command-stdout> unrelated trailing output',
      '<local-command-stdout>x</local-command-stdout><local-command-stderr>torn'
    ])
      expect(parse(content)).toEqual([])
    expect(
      parse(
        `<local-command-stdout>${'x'.repeat(4001)}</local-command-stdout>`
      )[0]?.parts
    ).toEqual([
      expect.objectContaining({
        kind: 'notice',
        text: `${'x'.repeat(4000)}…`,
        truncated: true
      })
    ])
  })

  test('Codex hides only complete native instruction envelopes, never appended user requests', () => {
    const context =
      '# AGENTS.md instructions for /fixture\n<INSTRUCTIONS>rules</INSTRUCTIONS>'
    const generic =
      '# AGENTS.md instructions\n<INSTRUCTIONS>rules</INSTRUCTIONS>'
    const parse = (text: string, event: boolean) =>
      pairContributions(
        JSON.stringify({
          type: event ? 'event_msg' : 'response_item',
          payload: event
            ? { type: 'user_message', message: text }
            : {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text }]
              }
        }),
        0,
        'codex-transcript'
      )
    for (const event of [true, false]) {
      for (const text of [
        context,
        generic,
        `${context}\n<environment_context>cwd</environment_context>`
      ])
        expect(parse(text, event)).toEqual([])
      for (const text of [
        `${context}\nPlease fix the bug.`,
        '# AGENTS.md instructions for /fixture\nquoted </INSTRUCTIONS> without an opening tag'
      ])
        expect(parse(text, event)[0]?.parts).toContainEqual(
          expect.objectContaining({ kind: 'text', text })
        )
    }
  })
})
