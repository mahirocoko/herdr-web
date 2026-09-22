import { describe, expect, test } from 'bun:test'
import {
  isHostAllowed,
  isOriginAllowed,
  validateActionRequest,
  validateAgentExplainParams,
  validatePaneReadParams,
  validateTerminalParams
} from '../security.ts'

describe('security: host & origin validation', () => {
  test('allows localhost and loopback hosts', () => {
    expect(isHostAllowed('127.0.0.1:8787')).toBe(true)
    expect(isHostAllowed('localhost:8787')).toBe(true)
    expect(isHostAllowed('127.0.0.1:5173')).toBe(true)
    expect(isHostAllowed('localhost:5173')).toBe(true)
    expect(isHostAllowed('127.0.0.1')).toBe(true)
    expect(isHostAllowed('localhost')).toBe(true)
  })

  test('allows Tailscale *.ts.net hosts', () => {
    expect(isHostAllowed('my-macbook.tailnet-xyz.ts.net')).toBe(true)
    expect(isHostAllowed('my-macbook.tailnet-xyz.ts.net:8787')).toBe(true)
    expect(isHostAllowed('iphone.ts.net:443')).toBe(true)
  })

  test('rejects unauthorized or arbitrary hosts', () => {
    expect(isHostAllowed('malicious.com')).toBe(false)
    expect(isHostAllowed('192.168.1.50:8787')).toBe(false)
    expect(isHostAllowed('evil-ts.net.fake.com')).toBe(false)
    expect(isHostAllowed('')).toBe(false)
    expect(isHostAllowed(null)).toBe(false)
  })

  test('validates origin header against allowed hosts', () => {
    // Exact same-host match
    expect(isOriginAllowed('http://127.0.0.1:8787', '127.0.0.1:8787')).toBe(true)
    expect(isOriginAllowed('https://my-node.ts.net', 'my-node.ts.net')).toBe(true)
    expect(isOriginAllowed('https://my-node.ts.net:8787', 'my-node.ts.net:8787')).toBe(true)

    // Localhost dev exception (both loopback and approved dev/app ports 8787, 5173)
    expect(isOriginAllowed('http://localhost:5173', '127.0.0.1:8787')).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:5173', 'localhost:8787')).toBe(true)
    expect(isOriginAllowed('http://localhost:8787', '127.0.0.1:8787')).toBe(true)

    // Rejection of unrelated Tailnet node origins (no wildcard ts.net cross-origin)
    expect(isOriginAllowed('https://evil-node.ts.net', 'my-node.ts.net')).toBe(false)
    expect(isOriginAllowed('https://evil-node.ts.net:8787', 'my-node.ts.net:8787')).toBe(false)
    expect(isOriginAllowed('https://evil-node.ts.net:5173', 'my-node.ts.net:8787')).toBe(false)

    // Rejection of unapproved ports on localhost
    expect(isOriginAllowed('http://localhost:3000', '127.0.0.1:8787')).toBe(false)
    expect(isOriginAllowed('http://127.0.0.1:8080', '127.0.0.1:8787')).toBe(false)

    // Rejection of arbitrary external origins
    expect(isOriginAllowed('https://attacker.site', '127.0.0.1:8787')).toBe(false)
    expect(isOriginAllowed('https://attacker.site', 'my-node.ts.net')).toBe(false)

    // Rejection of missing, null, or malformed origin
    expect(isOriginAllowed('', '127.0.0.1:8787')).toBe(false)
    expect(isOriginAllowed(null, '127.0.0.1:8787')).toBe(false)
    expect(isOriginAllowed(undefined, '127.0.0.1:8787')).toBe(false)
    expect(isOriginAllowed('not-a-url', '127.0.0.1:8787')).toBe(false)
    expect(isOriginAllowed('javascript:void(0)', '127.0.0.1:8787')).toBe(false)

    // Rejection of missing host header
    expect(isOriginAllowed('http://127.0.0.1:8787', '')).toBe(false)
    expect(isOriginAllowed('http://127.0.0.1:8787', null)).toBe(false)
    expect(isOriginAllowed('http://127.0.0.1:8787', undefined)).toBe(false)
  })
})

describe('security: validateActionRequest', () => {
  test('accepts valid prompt action', () => {
    const res = validateActionRequest({
      type: 'prompt',
      operationId: 'op-1',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'agent'
      },
      text: 'git status'
    })
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      type: 'prompt',
      operationId: 'op-1',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'agent'
      },
      text: 'git status'
    })
  })

  test('rejects oversized prompt text (> 4096 chars)', () => {
    const res = validateActionRequest({
      type: 'prompt',
      operationId: 'op-2',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'agent'
      },
      text: 'a'.repeat(4097)
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('4096')
  })

  test('rejects empty prompt text', () => {
    const res = validateActionRequest({
      type: 'prompt',
      operationId: 'op-3',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'agent'
      },
      text: '   '
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('non-empty')
  })

  test('accepts valid terminal-input action', () => {
    const res = validateActionRequest({
      type: 'terminal-input',
      operationId: 'op-4',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'shell'
      },
      text: 'ls -la'
    })
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      type: 'terminal-input',
      operationId: 'op-4',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'shell'
      },
      text: 'ls -la'
    })
  })

  test('rejects oversized terminal-input text (> 4096 chars)', () => {
    const res = validateActionRequest({
      type: 'terminal-input',
      operationId: 'op-5',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'shell'
      },
      text: 'x'.repeat(4097)
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('4096')
  })

  test('rejects empty terminal-input text', () => {
    const res = validateActionRequest({
      type: 'terminal-input',
      operationId: 'op-6',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'shell'
      },
      text: '   '
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('non-empty')
  })

  test('accepts valid keys action with authorized key whitelist', () => {
    const res = validateActionRequest({
      type: 'keys',
      operationId: 'op-7',
      target: {
        paneId: 'w5N:p2',
        terminalId: 'term-2',
        expectedMode: 'agent'
      },
      keys: ['esc', 'tab', 'enter', 'ctrl+c', 'up', 'down', 'left', 'right']
    })
    expect(res.valid).toBe(true)
    expect(res.data?.type).toBe('keys')
  })

  test('rejects unauthorized key names', () => {
    const res = validateActionRequest({
      type: 'keys',
      operationId: 'op-8',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'agent'
      },
      keys: ['enter', 'backspace']
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Unauthorized key: "backspace"')
  })

  test('rejects keys array exceeding 16 keys', () => {
    const keys = Array(17).fill('enter')
    const res = validateActionRequest({
      type: 'keys',
      operationId: 'op-9',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'agent'
      },
      keys
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('maximum size of 16 keys')
  })

  test('rejects invalid pane ID formats', () => {
    const res = validateActionRequest({
      type: 'prompt',
      operationId: 'op-10',
      target: {
        paneId: 'w5N; rm -rf /',
        terminalId: 'term-1',
        expectedMode: 'agent'
      },
      text: 'hi'
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Invalid target paneId')
  })

  test('rejects missing or empty operationId', () => {
    const res = validateActionRequest({
      type: 'prompt',
      target: {
        paneId: 'w5N:p1',
        terminalId: 'term-1',
        expectedMode: 'agent'
      },
      text: 'hi'
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('operationId')
  })

  test('accepts valid tab-create action', () => {
    const res = validateActionRequest({
      type: 'tab-create',
      operationId: 'op-tab-1',
      workspaceId: 'ws-main',
      target: {
        paneId: 'ws-main:p1',
        terminalId: 'term-root'
      },
      label: 'Build Tab'
    })
    expect(res.valid).toBe(true)
    expect(res.data?.type).toBe('tab-create')
  })

  test('rejects unsupported tab-create root and target fields', () => {
    const rootExtra = validateActionRequest({
      type: 'tab-create',
      operationId: 'op-tab-extra-root',
      workspaceId: 'ws-main',
      target: { paneId: 'ws-main:p1', terminalId: 'term-root' },
      close_group: true
    })
    expect(rootExtra.valid).toBe(false)
    expect(rootExtra.error).toContain('Unsupported field "close_group"')

    const targetExtra = validateActionRequest({
      type: 'tab-create',
      operationId: 'op-tab-extra-target',
      workspaceId: 'ws-main',
      target: {
        paneId: 'ws-main:p1',
        terminalId: 'term-root',
        expectedMode: 'shell'
      }
    })
    expect(targetExtra.valid).toBe(false)
    expect(targetExtra.error).toContain('Unsupported field "expectedMode"')
  })

  test('accepts valid workspace-create action without source', () => {
    const res = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-1',
      label: 'New Space'
    })
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      type: 'workspace-create',
      operationId: 'op-ws-1',
      label: 'New Space'
    })
  })

  test('rejects workspace-create with explicit null source', () => {
    const res = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-null-source',
      source: null
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('non-null object')
  })

  test('accepts valid workspace-create action with source', () => {
    const res = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-2',
      source: {
        workspaceId: 'ws-orig',
        paneId: 'ws-orig:p1',
        terminalId: 'term-orig'
      }
    })
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      type: 'workspace-create',
      operationId: 'op-ws-2',
      source: {
        workspaceId: 'ws-orig',
        paneId: 'ws-orig:p1',
        terminalId: 'term-orig'
      }
    })
  })

  test('rejects workspace-create with unsupported fields', () => {
    const res = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-bad',
      label: 'Space',
      unsupportedExtra: 'evil'
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Unsupported field "unsupportedExtra"')
  })

  test('rejects workspace-create with unsupported fields on source', () => {
    const res = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-bad-src',
      source: {
        workspaceId: 'ws-1',
        paneId: 'ws-1:p1',
        terminalId: 'term-1',
        unexpectedKey: 123
      }
    })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Unsupported field "unexpectedKey"')
  })

  test('rejects workspace-create with invalid or oversized label or control characters', () => {
    const resNull = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-label-null',
      label: null
    })
    expect(resNull.valid).toBe(false)
    expect(resNull.error).toContain('must be a string')

    const resOversized = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-label-len',
      label: 'a'.repeat(101)
    })
    expect(resOversized.valid).toBe(false)
    expect(resOversized.error).toContain('maximum length of 100 characters')

    const resControl = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-label-ctrl',
      label: 'Bad\x00Label'
    })
    expect(resControl.valid).toBe(false)
    expect(resControl.error).toContain('control characters')
  })

  test('rejects workspace-create with numeric alias or invalid source tokens', () => {
    const resNumericWs = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-num',
      source: {
        workspaceId: 1, // numeric alias
        paneId: 'ws-1:p1',
        terminalId: 'term-1'
      }
    })
    expect(resNumericWs.valid).toBe(false)

    const resBadPane = validateActionRequest({
      type: 'workspace-create',
      operationId: 'op-ws-badpane',
      source: {
        workspaceId: 'ws-1',
        paneId: 'not-a-pane',
        terminalId: 'term-1'
      }
    })
    expect(resBadPane.valid).toBe(false)
  })

  test('accepts valid workspace-close action', () => {
    const res = validateActionRequest({
      type: 'workspace-close',
      operationId: 'op-close-ws',
      target: {
        workspaceId: 'ws-target',
        expected: {
          tabIds: ['tab-b', 'tab-a'],
          paneIds: ['pane-b', 'pane-a']
        }
      }
    })
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      type: 'workspace-close',
      operationId: 'op-close-ws',
      target: {
        workspaceId: 'ws-target',
        expected: {
          tabIds: ['tab-a', 'tab-b'],
          paneIds: ['pane-a', 'pane-b']
        }
      }
    })
  })

  test('rejects malformed, duplicate, oversized, null, and extra close manifests', () => {
    const workspaceBase = {
      type: 'workspace-close',
      operationId: 'op-close-manifest',
      target: { workspaceId: 'ws-1', expected: { tabIds: ['tab-1'], paneIds: ['pane-1'] } }
    }
    const invalidWorkspaceExpected = [
      null,
      { tabIds: null, paneIds: [] },
      { tabIds: ['tab-1', 'tab-1'], paneIds: [] },
      { tabIds: [1], paneIds: [] },
      { tabIds: [], paneIds: [], extra: true },
      { tabIds: Array.from({ length: 65 }, (_, index) => `tab-${index}`), paneIds: [] }
    ]
    for (const expected of invalidWorkspaceExpected) {
      const result = validateActionRequest({
        ...workspaceBase,
        target: { ...workspaceBase.target, expected }
      })
      expect(result.valid).toBe(false)
    }

    const invalidTabExpected = [
      null,
      { paneIds: null },
      { paneIds: ['pane-1', 'pane-1'] },
      { paneIds: [1] },
      { paneIds: [], extra: true }
    ]
    for (const expected of invalidTabExpected) {
      const result = validateActionRequest({
        type: 'tab-close',
        operationId: 'op-tab-manifest',
        target: { workspaceId: 'ws-1', tabId: 'tab-1', expected }
      })
      expect(result.valid).toBe(false)
    }
  })

  test('rejects workspace-close with unsupported fields on root or target', () => {
    const resRoot = validateActionRequest({
      type: 'workspace-close',
      operationId: 'op-close-ws',
      target: { workspaceId: 'ws-1' },
      extraRoot: true
    })
    expect(resRoot.valid).toBe(false)
    expect(resRoot.error).toContain('Unsupported field "extraRoot"')

    const resTarget = validateActionRequest({
      type: 'workspace-close',
      operationId: 'op-close-ws',
      target: {
        workspaceId: 'ws-1',
        extraTarget: 'bad'
      }
    })
    expect(resTarget.valid).toBe(false)
    expect(resTarget.error).toContain('Unsupported field "extraTarget"')
  })

  test('rejects workspace-close with numeric alias or missing target', () => {
    const resNumeric = validateActionRequest({
      type: 'workspace-close',
      operationId: 'op-close-ws',
      target: {
        workspaceId: 123
      }
    })
    expect(resNumeric.valid).toBe(false)

    const resMissing = validateActionRequest({
      type: 'workspace-close',
      operationId: 'op-close-ws'
    })
    expect(resMissing.valid).toBe(false)
  })

  test('accepts valid tab-close action', () => {
    const res = validateActionRequest({
      type: 'tab-close',
      operationId: 'op-close-tab',
      target: {
        workspaceId: 'ws-1',
        tabId: 'tab-2',
        expected: { paneIds: ['pane-b', 'pane-a'] }
      }
    })
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      type: 'tab-close',
      operationId: 'op-close-tab',
      target: {
        workspaceId: 'ws-1',
        tabId: 'tab-2',
        expected: { paneIds: ['pane-a', 'pane-b'] }
      }
    })
  })

  test('rejects tab-close with unsupported fields or numeric alias', () => {
    const resExtra = validateActionRequest({
      type: 'tab-close',
      operationId: 'op-close-tab',
      target: {
        workspaceId: 'ws-1',
        tabId: 'tab-2',
        extra: 'bad'
      }
    })
    expect(resExtra.valid).toBe(false)
    expect(resExtra.error).toContain('Unsupported field "extra"')

    const resNumeric = validateActionRequest({
      type: 'tab-close',
      operationId: 'op-close-tab',
      target: {
        workspaceId: 'ws-1',
        tabId: 99
      }
    })
    expect(resNumeric.valid).toBe(false)
  })
})

describe('security: validatePaneReadParams', () => {
  test('accepts valid query parameters with defaults', () => {
    const url = new URL('http://127.0.0.1:8787/api/pane/read?pane=w5N:p1')
    const res = validatePaneReadParams(url)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      pane: 'w5N:p1',
      source: 'detection',
      lines: undefined
    })
  })

  test('accepts valid custom source and lines', () => {
    const url = new URL('http://127.0.0.1:8787/api/pane/read?pane=w5N:p1&source=visible&lines=50')
    const res = validatePaneReadParams(url)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      pane: 'w5N:p1',
      source: 'visible',
      lines: 50
    })
  })

  test('accepts recent-unwrapped source', () => {
    const url = new URL('http://127.0.0.1:8787/api/pane/read?pane=w5N:p1&source=recent-unwrapped')
    const res = validatePaneReadParams(url)
    expect(res.valid).toBe(true)
    expect(res.data?.source).toBe('recent-unwrapped')
  })

  test('rejects missing or invalid pane param', () => {
    const url1 = new URL('http://127.0.0.1:8787/api/pane/read')
    expect(validatePaneReadParams(url1).valid).toBe(false)

    const url2 = new URL('http://127.0.0.1:8787/api/pane/read?pane=bad-pane')
    expect(validatePaneReadParams(url2).valid).toBe(false)
  })

  test('rejects unauthorized sources', () => {
    const url = new URL('http://127.0.0.1:8787/api/pane/read?pane=w5N:p1&source=arbitrary-file')
    const res = validatePaneReadParams(url)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Invalid source')
  })

  test('rejects out-of-bounds lines count', () => {
    const url0 = new URL('http://127.0.0.1:8787/api/pane/read?pane=w5N:p1&lines=0')
    expect(validatePaneReadParams(url0).valid).toBe(false)

    const urlHigh = new URL('http://127.0.0.1:8787/api/pane/read?pane=w5N:p1&lines=1001')
    expect(validatePaneReadParams(urlHigh).valid).toBe(false)
  })
})

describe('security: validateTerminalParams', () => {
  test('accepts valid query parameters with defaults', () => {
    const url = new URL('http://127.0.0.1:8787/api/terminal?pane=w5N:p1')
    const res = validateTerminalParams(url)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      pane: 'w5N:p1',
      cols: 80,
      rows: 24
    })
  })

  test('accepts valid custom cols and rows', () => {
    const url = new URL('http://127.0.0.1:8787/api/terminal?pane=w5N:p1&cols=120&rows=40')
    const res = validateTerminalParams(url)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      pane: 'w5N:p1',
      cols: 120,
      rows: 40
    })
  })

  test('rejects missing or invalid pane param', () => {
    const url1 = new URL('http://127.0.0.1:8787/api/terminal')
    expect(validateTerminalParams(url1).valid).toBe(false)

    const url2 = new URL('http://127.0.0.1:8787/api/terminal?pane=bad_pane')
    expect(validateTerminalParams(url2).valid).toBe(false)
  })

  test('rejects out of bounds cols or rows', () => {
    const urlCols = new URL('http://127.0.0.1:8787/api/terminal?pane=w5N:p1&cols=10')
    expect(validateTerminalParams(urlCols).valid).toBe(false)

    const urlRows = new URL('http://127.0.0.1:8787/api/terminal?pane=w5N:p1&rows=300')
    expect(validateTerminalParams(urlRows).valid).toBe(false)
  })
})

describe('security: validateAgentExplainParams', () => {
  test('accepts valid query parameter with single pane id', () => {
    const url = new URL('http://127.0.0.1:8787/api/agent/explain?pane=w5N:p1')
    const res = validateAgentExplainParams(url)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({ pane: 'w5N:p1' })
  })

  test('rejects missing pane parameter', () => {
    const url = new URL('http://127.0.0.1:8787/api/agent/explain')
    const res = validateAgentExplainParams(url)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Missing required "pane"')
  })

  test('rejects malformed pane parameter', () => {
    const url = new URL('http://127.0.0.1:8787/api/agent/explain?pane=invalid-format')
    const res = validateAgentExplainParams(url)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Invalid "pane"')
  })

  test('rejects duplicate pane parameter', () => {
    const url = new URL('http://127.0.0.1:8787/api/agent/explain?pane=w5N:p1&pane=w5N:p2')
    const res = validateAgentExplainParams(url)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Unexpected or duplicate')
  })

  test('rejects extra query parameters', () => {
    const url = new URL('http://127.0.0.1:8787/api/agent/explain?pane=w5N:p1&source=detection')
    const res = validateAgentExplainParams(url)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('Unexpected or duplicate')
  })
})

describe('security: server endpoint origin enforcement', () => {
  test('rejects POST /api/action without origin header', async () => {
    const { createServer } = await import('../index.ts')
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })
    try {
      const res = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/action`, {
          method: 'POST',
          headers: {
            host: `127.0.0.1:${server.port}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ type: 'keys', paneId: 'ws:p1', keys: ['enter'] })
        })
      )
      expect(res.status).toBe(403)
      const data = (await res.json()) as { ok: boolean; error: string }
      expect(data.ok).toBe(false)
      expect(data.error).toContain('origin not authorized')
    } finally {
      server.stop()
    }
  })

  test('rejects POST /api/action with mismatched evil Tailnet origin', async () => {
    const { createServer } = await import('../index.ts')
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })
    try {
      const res = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/action`, {
          method: 'POST',
          headers: {
            host: `my-node.ts.net`,
            origin: 'https://evil-node.ts.net',
            'content-type': 'application/json'
          },
          body: JSON.stringify({ type: 'keys', paneId: 'ws:p1', keys: ['enter'] })
        })
      )
      expect(res.status).toBe(403)
    } finally {
      server.stop()
    }
  })

  test('rejects WebSocket /api/terminal upgrade without origin', async () => {
    const { createServer } = await import('../index.ts')
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })
    try {
      const res = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/terminal?pane=ws:p1`, {
          headers: {
            host: `127.0.0.1:${server.port}`
          }
        })
      )
      expect(res.status).toBe(403)
    } finally {
      server.stop()
    }
  })

  test('rejects WebSocket /api/events upgrade without origin', async () => {
    const { createServer } = await import('../index.ts')
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })
    try {
      const res = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/events`, {
          headers: {
            host: `127.0.0.1:${server.port}`
          }
        })
      )
      expect(res.status).toBe(403)
      const text = await res.text()
      expect(text).toContain('origin not authorized')
    } finally {
      server.stop()
    }
  })

  test('rejects WebSocket /api/events upgrade with mismatched evil origin', async () => {
    const { createServer } = await import('../index.ts')
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })
    try {
      const res = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/events`, {
          headers: {
            host: `127.0.0.1:${server.port}`,
            origin: 'http://malicious-site.com'
          }
        })
      )
      expect(res.status).toBe(403)
    } finally {
      server.stop()
    }
  })

  test('rejects GET /api/agent/explain with unauthorized host header', async () => {
    const { createServer } = await import('../index.ts')
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })
    try {
      const res = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/agent/explain?pane=w5N:p1`, {
          headers: {
            host: 'attacker.evil.com'
          }
        })
      )
      expect(res.status).toBe(403)
      const data = (await res.json()) as { ok: boolean; error: string }
      expect(data.ok).toBe(false)
      expect(data.error).toContain('Forbidden: host not authorized')
    } finally {
      server.stop()
    }
  })

  test('rejects GET /api/agent/explain with missing or malformed query params', async () => {
    const { createServer } = await import('../index.ts')
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })
    try {
      const resMissing = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/agent/explain`, {
          headers: {
            host: `127.0.0.1:${server.port}`
          }
        })
      )
      expect(resMissing.status).toBe(400)

      const resBad = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/agent/explain?pane=bad_pane`, {
          headers: {
            host: `127.0.0.1:${server.port}`
          }
        })
      )
      expect(resBad.status).toBe(400)
    } finally {
      server.stop()
    }
  })

  test('bounds Agent Explain transport failures without exposing local socket paths', async () => {
    const originalTransport = process.env.HERDR_TRANSPORT
    const originalSocketPath = process.env.HERDR_SOCKET_PATH
    process.env.HERDR_TRANSPORT = 'socket'
    process.env.HERDR_SOCKET_PATH = '/tmp/private-agent-explain-secret.sock'

    const { createServer } = await import('../index.ts')
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })
    try {
      const res = await server.fetch(
        new Request(`http://127.0.0.1:${server.port}/api/agent/explain?pane=w5N:p1`, {
          headers: {
            host: `127.0.0.1:${server.port}`
          }
        })
      )
      expect(res.status).toBe(502)
      const data = (await res.json()) as { ok: boolean; error: string }
      expect(data).toEqual({ ok: false, error: 'Failed to explain agent status' })
      expect(data.error).not.toContain('private-agent-explain-secret.sock')
    } finally {
      server.stop()
      if (originalTransport === undefined) delete process.env.HERDR_TRANSPORT
      else process.env.HERDR_TRANSPORT = originalTransport
      if (originalSocketPath === undefined) delete process.env.HERDR_SOCKET_PATH
      else process.env.HERDR_SOCKET_PATH = originalSocketPath
    }
  })
})
