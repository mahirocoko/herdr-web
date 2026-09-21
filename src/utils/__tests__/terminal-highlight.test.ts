import { describe, expect, it } from 'bun:test'
import {
  classifyTerminalLine,
  parseTerminalContent
} from '../terminal-highlight.ts'
import type { ITerminalLine } from '../terminal-highlight.ts'

const reconstructRaw = (lines: ITerminalLine[]): string => {
  return lines
    .map(line => line.segments.map(seg => seg.text).join('') + line.newline)
    .join('')
}

describe('terminal-highlight: exact reconstruction', () => {
  it('handles empty string', () => {
    const raw = ''
    const lines = parseTerminalContent(raw)
    expect(lines).toEqual([])
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('handles single line without newline', () => {
    const raw = 'Hello world'
    const lines = parseTerminalContent(raw)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Hello world')
    expect(lines[0].newline).toBe('')
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('handles single line with LF', () => {
    const raw = 'Hello world\n'
    const lines = parseTerminalContent(raw)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Hello world')
    expect(lines[0].newline).toBe('\n')
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('handles multiple lines with LF', () => {
    const raw = 'line 1\nline 2\nline 3\n'
    const lines = parseTerminalContent(raw)
    expect(lines).toHaveLength(3)
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('handles multiple lines with CRLF', () => {
    const raw = 'line 1\r\nline 2\r\nline 3\r\n'
    const lines = parseTerminalContent(raw)
    expect(lines).toHaveLength(3)
    expect(lines[0].newline).toBe('\r\n')
    expect(lines[1].newline).toBe('\r\n')
    expect(lines[2].newline).toBe('\r\n')
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('handles multiple lines with lone CR', () => {
    const raw = 'line 1\rline 2\rline 3\r'
    const lines = parseTerminalContent(raw)
    expect(lines).toHaveLength(3)
    expect(lines[0].newline).toBe('\r')
    expect(lines[1].newline).toBe('\r')
    expect(lines[2].newline).toBe('\r')
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('handles mixed newlines and trailing content without newline', () => {
    const raw = 'line 1\r\nline 2\nline 3'
    const lines = parseTerminalContent(raw)
    expect(lines).toHaveLength(3)
    expect(lines[0].newline).toBe('\r\n')
    expect(lines[1].newline).toBe('\n')
    expect(lines[2].newline).toBe('')
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('handles complex mixed line breaks (CRLF, LF, lone CR, unterminated final)', () => {
    const raw = 'first\r\nsecond\nthird\rfourth'
    const lines = parseTerminalContent(raw)
    expect(lines).toHaveLength(4)
    expect(lines[0].newline).toBe('\r\n')
    expect(lines[1].newline).toBe('\n')
    expect(lines[2].newline).toBe('\r')
    expect(lines[3].newline).toBe('')
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('preserves blank lines and leading/trailing whitespace exactly', () => {
    const raw = '\n  indented line  \n\n\t\ttab line\n\n'
    const lines = parseTerminalContent(raw)
    expect(lines).toHaveLength(5)
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('preserves Thai and Unicode graphemes exactly', () => {
    const raw = '› ว้าว ออกมาดูดีเลย แต่ว่า ต้องปรับเพิ่มเติมอีกหน่อยนะ\n'
    const lines = parseTerminalContent(raw)
    expect(reconstructRaw(lines)).toBe(raw)
  })

  it('preserves hostile markup as inert text without alteration', () => {
    const raw = '<script>alert("xss")</script>\n<img src=x onerror=alert(1)>\n'
    const lines = parseTerminalContent(raw)
    expect(reconstructRaw(lines)).toBe(raw)
  })
})

describe('terminal-highlight: line classification & precedence', () => {
  it('classifies divider lines', () => {
    expect(classifyTerminalLine('──────────────────────────────────────────────────')).toBe('divider')
    expect(classifyTerminalLine('----------------------------------------')).toBe('divider')
    expect(classifyTerminalLine('========================================')).toBe('divider')
    expect(classifyTerminalLine('****************************************')).toBe('divider')
    expect(classifyTerminalLine('--------')).toBe('divider')
  })

  it('classifies statuslines with folder and branch metadata', () => {
    expect(
      classifyTerminalLine('📁 frontend-app · 🌿 main +7 ~4  Agent Console · [GPT-5.6]')
    ).toBe('statusline')
    expect(
      classifyTerminalLine('📁 herdr-web · 🌿 main · 💬 3')
    ).toBe('statusline')
    expect(
      classifyTerminalLine('Statusline · ctx 14.2k / 128k')
    ).toBe('statusline')
    expect(
      classifyTerminalLine('Model active: [Claude-3.7-Sonnet]')
    ).toBe('statusline')
  })

  it('classifies prompts and commands', () => {
    expect(
      classifyTerminalLine('› ว้าว ออกมาดูดีเลย แต่ว่า ต้องปรับเพิ่มเติมอีกหน่อยนะ')
    ).toBe('prompt')
    expect(classifyTerminalLine('❯ bun test')).toBe('prompt')
    expect(classifyTerminalLine('$ bun run build')).toBe('prompt')
    expect(classifyTerminalLine('> npm run dev')).toBe('prompt')
    expect(classifyTerminalLine('echo DIRECT_CLI_PROGRESS')).toBe('prompt')
  })

  it('classifies error and failure lines', () => {
    expect(classifyTerminalLine('FAIL tests/taste-proof.test.tsx:56')).toBe('error')
    expect(classifyTerminalLine('error: cannot find module \'foo\'')).toBe('error')
    expect(classifyTerminalLine('TypeError: Cannot read properties of undefined')).toBe('error')
    expect(classifyTerminalLine('❌ Build failed with 2 errors')).toBe('error')
    expect(classifyTerminalLine('[ERROR] connection refused')).toBe('error')
    expect(classifyTerminalLine('Process exited with code 1')).toBe('error')
    expect(classifyTerminalLine('  ● scroll-position > isNearBottom (failed)')).toBe('error')
  })

  it('classifies warning and blocker lines', () => {
    expect(classifyTerminalLine('• Blocked: Waiting for terminal input...')).toBe('warning')
    expect(classifyTerminalLine('⚠️ Found 1 high severity vulnerability')).toBe('warning')
    expect(classifyTerminalLine('warning: unused variable \'x\'')).toBe('warning')
    expect(classifyTerminalLine('[WARN] Redis cache miss rate high')).toBe('warning')
    expect(classifyTerminalLine('Blocked: Waiting for user action')).toBe('warning')
  })

  it('classifies success and completion lines', () => {
    expect(classifyTerminalLine('✓ 38/38 tests passed in 1.42s')).toBe('success')
    expect(classifyTerminalLine('PASS src/utils/__tests__/terminal-highlight.test.ts')).toBe('success')
    expect(classifyTerminalLine('Build succeeded')).toBe('success')
    expect(classifyTerminalLine('stream ended')).toBe('success')
    expect(classifyTerminalLine('[PASS] smoke check')).toBe('success')
    expect(classifyTerminalLine('38 passed, 0 failed')).toBe('success')
  })

  it('classifies thinking and reasoning lines', () => {
    expect(classifyTerminalLine('✻ Thinking…')).toBe('thinking')
    expect(classifyTerminalLine('⠋ Thinking about architecture')).toBe('thinking')
    expect(classifyTerminalLine('✦ Learned new pattern')).toBe('thinking')
    expect(classifyTerminalLine('  Planning extended monitoring interval')).toBe('thinking')
    expect(classifyTerminalLine('▸ Thought for 20s, 500 tokens')).toBe('thinking')
    expect(classifyTerminalLine('• Thought about architecture')).toBe('thinking')
    expect(classifyTerminalLine('⣷ spinner 1')).toBe('thinking')
    expect(classifyTerminalLine('⣯ spinner 2')).toBe('thinking')
    expect(classifyTerminalLine('⣟ spinner 3')).toBe('thinking')
    expect(classifyTerminalLine('⡿ spinner 4')).toBe('thinking')
    expect(classifyTerminalLine('⢿ spinner 5')).toBe('thinking')
    expect(classifyTerminalLine('⣻ spinner 6')).toBe('thinking')
    expect(classifyTerminalLine('⣽ spinner 7')).toBe('thinking')
    expect(classifyTerminalLine('⣾ spinner 8')).toBe('thinking')
  })

  it('classifies tool invocations and tree connectors', () => {
    expect(classifyTerminalLine('• Run Launch fresh browser QA')).toBe('tool')
    expect(classifyTerminalLine('▸ Read src/app.css')).toBe('tool')
    expect(classifyTerminalLine('  └ {"id":"cli:agent:prompt"...}')).toBe('tool')
    expect(classifyTerminalLine('  ⎿ status: ok')).toBe('tool')
    expect(classifyTerminalLine('  │ nested detail')).toBe('tool')
    expect(classifyTerminalLine('  ├ branch item')).toBe('tool')
    expect(classifyTerminalLine('● Bash(...)')).toBe('tool')
    expect(classifyTerminalLine('● chrome-devtools/click(...)')).toBe('tool')
    expect(classifyTerminalLine('● McpChrome-devtoolsListPages(...)')).toBe('tool')
  })

  it('classifies tree activity with error and warning precedence', () => {
    expect(classifyTerminalLine('⎿ Interrupted · ...')).toBe('warning')
    expect(classifyTerminalLine('  ⎿ Interrupted · 15s')).toBe('warning')
    expect(classifyTerminalLine('⎿ Failed to run command')).toBe('error')
    expect(classifyTerminalLine('⎿ Error: file not found')).toBe('error')
    expect(classifyTerminalLine('  ⎿ status: ok')).toBe('tool')
  })

  it('preserves error/warning/success/thinking precedence over generic tool lines', () => {
    expect(classifyTerminalLine('  ● scroll-position > isNearBottom (failed)')).toBe('error')
    expect(classifyTerminalLine('● Warning: high resource usage')).toBe('warning')
    expect(classifyTerminalLine('● Done: build finished')).toBe('success')
    expect(classifyTerminalLine('● Thinking: evaluating tree')).toBe('thinking')
  })

  it('defaults ordinary prose to plain', () => {
    expect(
      classifyTerminalLine('ผมเปิด production preview แยกที่ 127.0.0.1:4173 เรียบร้อยครับ')
    ).toBe('plain')
    expect(classifyTerminalLine('This is normal output text.')).toBe('plain')
    expect(classifyTerminalLine('Starting local development server...')).toBe('plain')
  })
})

describe('terminal-highlight: anti-false-positive cases', () => {
  it('keeps markdown ordinary prose plain unless matching known verb rule', () => {
    expect(classifyTerminalLine('* ordinary prose')).toBe('plain')
    expect(classifyTerminalLine('* another ordinary bullet')).toBe('plain')
    expect(classifyTerminalLine('* Run the test suite')).toBe('tool')
    expect(classifyTerminalLine('* Read the config')).toBe('tool')
  })
  it('does not classify prose containing error as error', () => {
    expect(classifyTerminalLine('There was an error in calculation yesterday.')).toBe('plain')
    expect(classifyTerminalLine('We need to handle unexpected error states.')).toBe('plain')
    expect(classifyTerminalLine('Don\'t worry about syntaxerror discussion.')).toBe('plain')
  })

  it('does not classify exit code 0 as error', () => {
    expect(classifyTerminalLine('Process exited with code 0')).toBe('plain')
  })

  it('does not classify prose containing warn or blocked as warning', () => {
    expect(classifyTerminalLine('I warn you that this might take a while.')).toBe('plain')
    expect(classifyTerminalLine('The pedestrian was blocked by a fence.')).toBe('plain')
  })

  it('does not classify prose containing done or passed as success', () => {
    expect(classifyTerminalLine('When you are done with the task, let me know.')).toBe('plain')
    expect(classifyTerminalLine('She passed by the office on Friday.')).toBe('plain')
  })

  it('does not classify unindented unglyphed thinking words as thinking', () => {
    expect(classifyTerminalLine('Thinking is an essential cognitive skill.')).toBe('plain')
  })

  it('does not classify tool verbs without bullets as tools', () => {
    expect(classifyTerminalLine('Run the marathon this weekend.')).toBe('plain')
    expect(classifyTerminalLine('Read the documentation carefully.')).toBe('plain')
  })
})

describe('terminal-highlight: tokenization & structural anchors', () => {
  it('tokenizes prompt glyph', () => {
    const lines = parseTerminalContent('› ว้าว ออกมาดูดีเลย\n')
    expect(lines).toHaveLength(1)
    expect(lines[0].lineType).toBe('prompt')
    expect(lines[0].segments[0]).toEqual({ text: '›', tokenType: 'glyph' })
    expect(reconstructRaw(lines)).toBe('› ว้าว ออกมาดูดีเลย\n')
  })

  it('tokenizes tool glyph and tool verb', () => {
    const lines = parseTerminalContent('• Run Launch fresh browser QA\n')
    expect(lines).toHaveLength(1)
    expect(lines[0].lineType).toBe('tool')
    expect(lines[0].segments[0]).toEqual({ text: '•', tokenType: 'glyph' })
    expect(lines[0].segments[1]).toEqual({ text: ' ' })
    expect(lines[0].segments[2]).toEqual({ text: 'Run', tokenType: 'tool-verb' })
    expect(reconstructRaw(lines)).toBe('• Run Launch fresh browser QA\n')
  })

  it('tokenizes tree connector', () => {
    const lines = parseTerminalContent('  └ {"id":"ok"}\n')
    expect(lines).toHaveLength(1)
    expect(lines[0].lineType).toBe('tool')
    expect(lines[0].segments[0]).toEqual({ text: '  ' })
    expect(lines[0].segments[1]).toEqual({ text: '└', tokenType: 'tree' })
    expect(reconstructRaw(lines)).toBe('  └ {"id":"ok"}\n')
  })

  it('tokenizes Thought lines and braille spinner glyphs', () => {
    const thoughtLines = parseTerminalContent('▸ Thought for 20s, 500 tokens\n')
    expect(thoughtLines).toHaveLength(1)
    expect(thoughtLines[0].lineType).toBe('thinking')
    expect(thoughtLines[0].segments[0]).toEqual({ text: '▸', tokenType: 'glyph' })
    expect(reconstructRaw(thoughtLines)).toBe('▸ Thought for 20s, 500 tokens\n')

    const spinnerLines = parseTerminalContent('⣾ Thinking about graph\n')
    expect(spinnerLines).toHaveLength(1)
    expect(spinnerLines[0].lineType).toBe('thinking')
    expect(spinnerLines[0].segments[0]).toEqual({ text: '⣾', tokenType: 'glyph' })
    expect(reconstructRaw(spinnerLines)).toBe('⣾ Thinking about graph\n')
  })

  it('tokenizes generic tool lines with complete tool labels', () => {
    const bashLines = parseTerminalContent('● Bash(...)\n')
    expect(bashLines).toHaveLength(1)
    expect(bashLines[0].lineType).toBe('tool')
    expect(bashLines[0].segments[0]).toEqual({ text: '●', tokenType: 'glyph' })
    expect(bashLines[0].segments[1]).toEqual({ text: ' ' })
    expect(bashLines[0].segments[2]).toEqual({ text: 'Bash(...)', tokenType: 'tool-verb' })
    expect(reconstructRaw(bashLines)).toBe('● Bash(...)\n')

    const chromeLines = parseTerminalContent('● chrome-devtools/click(...)\n')
    expect(chromeLines).toHaveLength(1)
    expect(chromeLines[0].lineType).toBe('tool')
    expect(chromeLines[0].segments[0]).toEqual({ text: '●', tokenType: 'glyph' })
    expect(chromeLines[0].segments[1]).toEqual({ text: ' ' })
    expect(chromeLines[0].segments[2]).toEqual({
      text: 'chrome-devtools/click(...)',
      tokenType: 'tool-verb'
    })
    expect(reconstructRaw(chromeLines)).toBe('● chrome-devtools/click(...)\n')

    const mcpLines = parseTerminalContent('● McpChrome-devtoolsListPages(...)\n')
    expect(mcpLines).toHaveLength(1)
    expect(mcpLines[0].lineType).toBe('tool')
    expect(mcpLines[0].segments[0]).toEqual({ text: '●', tokenType: 'glyph' })
    expect(mcpLines[0].segments[1]).toEqual({ text: ' ' })
    expect(mcpLines[0].segments[2]).toEqual({
      text: 'McpChrome-devtoolsListPages(...)',
      tokenType: 'tool-verb'
    })
    expect(reconstructRaw(mcpLines)).toBe('● McpChrome-devtoolsListPages(...)\n')
  })

  it('tokenizes tree markers in warning and error lines', () => {
    const warnLines = parseTerminalContent('  ⎿ Interrupted · 15s\n')
    expect(warnLines).toHaveLength(1)
    expect(warnLines[0].lineType).toBe('warning')
    expect(warnLines[0].segments[0]).toEqual({ text: '  ' })
    expect(warnLines[0].segments[1]).toEqual({ text: '⎿', tokenType: 'tree' })
    expect(reconstructRaw(warnLines)).toBe('  ⎿ Interrupted · 15s\n')

    const errLines = parseTerminalContent('⎿ Failed to run command\n')
    expect(errLines).toHaveLength(1)
    expect(errLines[0].lineType).toBe('error')
    expect(errLines[0].segments[0]).toEqual({ text: '⎿', tokenType: 'tree' })
    expect(reconstructRaw(errLines)).toBe('⎿ Failed to run command\n')
  })

  it('prioritizes URL over path to prevent URL slashes becoming path tokens', () => {
    const lines = parseTerminalContent('Check https://github.com/mahirocoko/herdr-web/pull/1 today.\n')
    expect(lines).toHaveLength(1)
    const urlSegment = lines[0].segments.find(s => s.tokenType === 'url')
    expect(urlSegment).toBeDefined()
    expect(urlSegment?.text).toBe('https://github.com/mahirocoko/herdr-web/pull/1')

    // Ensure no path token swallowed the URL slashes
    const pathSegment = lines[0].segments.find(s => s.tokenType === 'path')
    expect(pathSegment).toBeUndefined()

    // Trailing period is not swallowed
    const lastSeg = lines[0].segments[lines[0].segments.length - 1]
    expect(lastSeg.text).toContain('today.')
    expect(reconstructRaw(lines)).toBe('Check https://github.com/mahirocoko/herdr-web/pull/1 today.\n')
  })

  it('tokenizes paths without swallowing trailing punctuation', () => {
    const lines = parseTerminalContent('Read src/utils/scroll-position.ts, then tests/taste.test.ts.\n')
    expect(lines).toHaveLength(1)
    const pathSegments = lines[0].segments.filter(s => s.tokenType === 'path')
    expect(pathSegments).toHaveLength(2)
    expect(pathSegments[0].text).toBe('src/utils/scroll-position.ts')
    expect(pathSegments[1].text).toBe('tests/taste.test.ts')
    expect(reconstructRaw(lines)).toBe('Read src/utils/scroll-position.ts, then tests/taste.test.ts.\n')
  })

  it('tokenizes pane and task IDs', () => {
    const lines = parseTerminalContent('Active on w5H:p1 under task-build-2026.\n')
    expect(lines).toHaveLength(1)
    const idSegments = lines[0].segments.filter(s => s.tokenType === 'id')
    expect(idSegments).toHaveLength(2)
    expect(idSegments[0].text).toBe('w5H:p1')
    expect(idSegments[1].text).toBe('task-build-2026')
    expect(reconstructRaw(lines)).toBe('Active on w5H:p1 under task-build-2026.\n')
  })
})

describe('terminal-highlight: bounded performance', () => {
  it('parses 1000 lines within a generous threshold', () => {
    const sampleLines = [
      '──────────────────────────────────────────────────',
      '📁 herdr-web · 🌿 main +2 ~1 · [GPT-5.6]',
      '› bun run test:live',
      '• Run Execute live integration checks',
      '  └ {"status":"pending","pane":"w5H:p1"}',
      '✻ Thinking… inspecting connection at https://127.0.0.1:8787/api/events',
      'FAIL tests/taste-proof.test.tsx:56',
      'error: failed to connect to socket /tmp/herdr.sock',
      '• Blocked: Waiting for terminal input...',
      '✓ 38/38 tests passed in 1.42s',
      'ผมเปิด production preview แยกที่ 127.0.0.1:4173 เรียบร้อยครับ',
      'Line with path src/components/text-surface-view.tsx and task-1234.'
    ]

    const full1000: string[] = []
    for (let i = 0; i < 1000; i++) {
      full1000.push(sampleLines[i % sampleLines.length])
    }
    const rawContent = full1000.join('\n') + '\n'

    const t0 = performance.now()
    const parsed = parseTerminalContent(rawContent)
    const durationMs = performance.now() - t0

    expect(parsed).toHaveLength(1000)
    expect(reconstructRaw(parsed)).toBe(rawContent)
    // Generous non-flaky threshold (expect < 25ms, allow up to 250ms on slow CI)
    expect(durationMs).toBeLessThan(250)
  })
})
