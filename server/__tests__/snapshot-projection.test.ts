import { describe, expect, it } from 'bun:test'
import {
  isAbsolutePath,
  projectBrowserAgents,
  projectBrowserPane,
  projectBrowserSnapshot,
  projectBrowserTab,
  projectBrowserWorkspace,
  sanitizeBoundedText
} from '../snapshot-projection.ts'
import { verifyTargetAgainstSnapshot } from '../security.ts'
import { deriveActionTarget } from '../../src/utils/action-target.ts'

describe('server/snapshot-projection', () => {
  describe('sanitizeBoundedText and isAbsolutePath', () => {
    it('strips ASCII control characters and trims whitespace', () => {
      expect(sanitizeBoundedText('  hello\x00\x1b\r\n\tworld\x7f  ')).toBe('helloworld')
      expect(sanitizeBoundedText(' \x00 ')).toBeUndefined()
      expect(sanitizeBoundedText(123 as any)).toBeUndefined()
      expect(sanitizeBoundedText(null)).toBeUndefined()
    })

    it('bounds text to specified maximum length', () => {
      const longText = 'a'.repeat(200)
      const sanitized = sanitizeBoundedText(longText, 50)
      expect(sanitized).toBe('a'.repeat(50))
      expect(sanitized?.length).toBe(50)
    })

    it('identifies absolute paths for POSIX, Windows, UNC, and home tildes', () => {
      expect(isAbsolutePath('/Users/mahiro/project')).toBe(true)
      expect(isAbsolutePath('/tmp/foo')).toBe(true)
      expect(isAbsolutePath('~/ghq/repo')).toBe(true)
      expect(isAbsolutePath('C:\\Users\\admin')).toBe(true)
      expect(isAbsolutePath('d:/workspace')).toBe(true)
      expect(isAbsolutePath('\\\\server\\share')).toBe(true)
      expect(isAbsolutePath('\\private\\repo')).toBe(true)
      expect(isAbsolutePath('relative/path')).toBe(false)
      expect(isAbsolutePath('feature-branch-123')).toBe(false)
      expect(isAbsolutePath('linked-worktree')).toBe(false)
    })
  })

  describe('projectBrowserWorkspace', () => {
    it('constructs a fresh object and strips unknown fields, layouts, and arbitrary tokens', () => {
      const rawWs = {
        workspace_id: 'ws-1',
        label: 'My Project',
        number: 1,
        agent_status: 'working',
        tab_count: 3,
        pane_count: 5,
        active_tab_id: 'tab-1',
        focused: true,
        layouts: [{ id: 'layout-1', config: 'malicious' }],
        unknown_metadata: 'secret_leak',
        letta_scope: 'private-agent-memory',
        tokens: {
          mahiro_workspace_branch: 'feature/login',
          mahiro_workspace_git_status: 'dirty',
          mahiro_workspace_worktree: 'wt-feature',
          arbitrary_token: 'should_be_stripped',
          letta_pid: '12345',
          letta_started_at: '2026-09-23T00:00:00Z',
          letta_scope: 'global-scope'
        },
        worktree: {
          repo_name: 'herdr-web',
          is_linked_worktree: true,
          repo_root: '/Users/mahiro/ghq/github.com/mahirocoko/herdr-web',
          checkout_path: '/Users/mahiro/ghq/github.com/mahirocoko/herdr-web-wt',
          repo_key: 'git@github.com:mahirocoko/herdr-web.git'
        }
      }

      const projected = projectBrowserWorkspace(rawWs)
      expect(projected).not.toBeNull()
      expect(projected).not.toBe(rawWs as any) // Must be a fresh object!

      // Allowlisted workspace fields
      expect(projected?.workspace_id).toBe('ws-1')
      expect(projected?.label).toBe('My Project')
      expect(projected?.number).toBe(1)
      expect(projected?.agent_status).toBe('working')
      expect(projected?.tab_count).toBe(3)
      expect(projected?.pane_count).toBe(5)
      expect(projected?.active_tab_id).toBe('tab-1')
      expect(projected?.focused).toBe(true)

      // Layouts and unknown fields must be completely stripped
      expect((projected as any).layouts).toBeUndefined()
      expect((projected as any).unknown_metadata).toBeUndefined()
      expect((projected as any).letta_scope).toBeUndefined()

      // Workspace tokens allowlist: only mahiro_workspace_branch, mahiro_workspace_git_status, mahiro_workspace_worktree
      expect(projected?.tokens).toEqual({
        mahiro_workspace_branch: 'feature/login',
        mahiro_workspace_git_status: 'dirty',
        mahiro_workspace_worktree: 'wt-feature'
      })
      expect((projected?.tokens as any)?.arbitrary_token).toBeUndefined()
      expect((projected?.tokens as any)?.letta_pid).toBeUndefined()
      expect((projected?.tokens as any)?.letta_started_at).toBeUndefined()

      // Worktree provenance: only bounded repo_name and is_linked_worktree, NEVER absolute paths
      expect(projected?.worktree).toEqual({
        repo_name: 'herdr-web',
        is_linked_worktree: true
      })
      expect((projected?.worktree as any)?.repo_root).toBeUndefined()
      expect((projected?.worktree as any)?.checkout_path).toBeUndefined()
      expect((projected?.worktree as any)?.repo_key).toBeUndefined()
    })

    it('strips absolute paths from mahiro_workspace_worktree', () => {
      const rawWs = {
        workspace_id: 'ws-2',
        label: 'Security Check',
        tokens: {
          mahiro_workspace_branch: 'main',
          mahiro_workspace_git_status: 'clean',
          mahiro_workspace_worktree: '/Users/mahiro/secret/worktree' // Malicious absolute path
        }
      }

      const projected = projectBrowserWorkspace(rawWs)
      expect(projected?.tokens?.mahiro_workspace_branch).toBe('main')
      expect(projected?.tokens?.mahiro_workspace_git_status).toBe('clean')
      expect(projected?.tokens?.mahiro_workspace_worktree).toBeUndefined()
    })

    it('accepts worktree basenames but strips path-like worktree labels', () => {
      const safe = projectBrowserWorkspace({
        workspace_id: 'ws-safe-label',
        tokens: { mahiro_workspace_worktree: 'feature-checkout' }
      })
      expect(safe?.tokens?.mahiro_workspace_worktree).toBe('feature-checkout')

      for (const label of ['relative/path', '..\\private\\repo', 'C:relative', '.', '..']) {
        const projected = projectBrowserWorkspace({
          workspace_id: 'ws-path-label',
          tokens: { mahiro_workspace_worktree: label }
        })
        expect(projected?.tokens?.mahiro_workspace_worktree).toBeUndefined()
      }
    })

    it('strips an absolute path disguised as worktree repo_name', () => {
      for (const repoName of [
        '/Users/private/repository',
        '\\private\\repository',
        'relative/path',
        '..\\private\\repository',
        'C:relative',
        '.',
        '..'
      ]) {
        const projected = projectBrowserWorkspace({
          workspace_id: 'ws-path',
          worktree: {
            repo_name: repoName,
            is_linked_worktree: true
          }
        })

        expect(projected?.worktree).toBeUndefined()
      }
    })

    it('rejects invalid git_status values', () => {
      const rawWs = {
        workspace_id: 'ws-3',
        tokens: {
          mahiro_workspace_branch: 'main',
          mahiro_workspace_git_status: 'modified_malicious_status'
        }
      }

      const projected = projectBrowserWorkspace(rawWs)
      expect(projected?.tokens?.mahiro_workspace_branch).toBe('main')
      expect(projected?.tokens?.mahiro_workspace_git_status).toBeUndefined()
    })
  })

  describe('projectBrowserTab', () => {
    it('constructs fresh tab object and strips unknown fields', () => {
      const rawTab = {
        tab_id: 't-1',
        workspace_id: 'ws-1',
        label: 'Editor',
        number: 1,
        pane_count: 2,
        focused: true,
        agent_status: 'idle',
        unknown_tab_extra: 'drop_me',
        layouts: [{ id: 'layout' }]
      }

      const projected = projectBrowserTab(rawTab)
      expect(projected).toEqual({
        tab_id: 't-1',
        workspace_id: 'ws-1',
        label: 'Editor',
        number: 1,
        pane_count: 2,
        focused: true,
        agent_status: 'idle'
      })
      expect((projected as any).unknown_tab_extra).toBeUndefined()
      expect((projected as any).layouts).toBeUndefined()
    })
  })

  describe('projectBrowserPane', () => {
    it('preserves required action identities while stripping state_labels, unknown fields, and internal tokens', () => {
      const rawPane = {
        pane_id: 'p-1',
        workspace_id: 'ws-1',
        tab_id: 't-1',
        terminal_id: 'term-100',
        agent: 'gemini',
        display_agent: 'Gemini CLI',
        agent_status: 'blocked',
        title: 'Task Editor\x00\x1b',
        terminal_title: 'Terminal 1',
        terminal_title_stripped: 'Terminal 1',
        cwd: '/Users/mahiro/ghq/project',
        foreground_cwd: '/Users/mahiro/ghq/project/sub',
        focused: true,
        revision: 42,
        state_labels: { status: 'waiting_for_user_input', internal: 'secret' },
        unknown_pane_prop: 'drop_this',
        scroll: {
          offset_from_bottom: 10,
          max_offset_from_bottom: 100,
          viewport_rows: 24,
          unknown_scroll_field: 'drop'
        },
        agent_session: {
          source: 'herdr',
          agent: 'gemini',
          kind: 'id',
          value: 'session-xyz-123',
          id: 'session-xyz-123',
          raw_internal_token: 'secret_leak',
          system_prompt_dump: 'do not disclose'
        },
        tokens: {
          summary: 'Working on feature',
          subagents: '2',
          subagents_running: '1',
          mahiro_sidebar_context: 'repo',
          mahiro_sidebar_model: 'gemini-3.8-flash',
          mahiro_sidebar_provider: 'google',
          mahiro_sidebar_q1_critical: 'high',
          arbitrary_token: 'stripped',
          letta_pid: '9999',
          letta_scope: 'session-memory'
        }
      }

      const projected = projectBrowserPane(rawPane)
      expect(projected).not.toBeNull()

      // Required action identities preserved
      expect(projected?.pane_id).toBe('p-1')
      expect(projected?.workspace_id).toBe('ws-1')
      expect(projected?.tab_id).toBe('t-1')
      expect(projected?.terminal_id).toBe('term-100')
      expect(projected?.agent).toBe('gemini')
      expect(projected?.display_agent).toBe('Gemini CLI')
      expect(projected?.agent_status).toBe('blocked')
      expect(projected?.cwd).toBe('/Users/mahiro/ghq/project')
      expect(projected?.foreground_cwd).toBe('/Users/mahiro/ghq/project/sub')
      expect(projected?.focused).toBe(true)
      expect(projected?.revision).toBe(42)

      // Control characters stripped from title
      expect(projected?.title).toBe('Task Editor')

      // state_labels and unknown fields strictly stripped
      expect((projected as any).state_labels).toBeUndefined()
      expect((projected as any).unknown_pane_prop).toBeUndefined()

      // Scroll preserved with fresh allowlisted structure
      expect(projected?.scroll).toEqual({
        offset_from_bottom: 10,
        max_offset_from_bottom: 100,
        viewport_rows: 24
      })
      expect((projected?.scroll as any).unknown_scroll_field).toBeUndefined()

      // Strict agent_session: preserves source, agent, kind, value, id; drops unknown fields
      expect(projected?.agent_session).toEqual({
        source: 'herdr',
        agent: 'gemini',
        kind: 'id',
        value: 'session-xyz-123',
        id: 'session-xyz-123'
      })
      expect((projected?.agent_session as any).raw_internal_token).toBeUndefined()
      expect((projected?.agent_session as any).system_prompt_dump).toBeUndefined()

      // Allowlisted pane tokens only
      expect(projected?.tokens).toEqual({
        summary: 'Working on feature',
        subagents: '2',
        subagents_running: '1',
        mahiro_sidebar_context: 'repo',
        mahiro_sidebar_model: 'gemini-3.8-flash',
        mahiro_sidebar_provider: 'google',
        mahiro_sidebar_q1_critical: 'high'
      })
      expect((projected?.tokens as any).arbitrary_token).toBeUndefined()
      expect((projected?.tokens as any).letta_pid).toBeUndefined()
      expect((projected?.tokens as any).letta_scope).toBeUndefined()
    })

    it('handles null agent_session correctly for shell panes', () => {
      const rawPane = {
        pane_id: 'p-shell',
        workspace_id: 'ws-1',
        tab_id: 't-1',
        agent_status: 'idle',
        agent_session: null
      }

      const projected = projectBrowserPane(rawPane)
      expect(projected?.agent_session).toBeNull()
    })

    describe('agent_session strictness and adversarial inputs', () => {
      it('preserves valid agent_session without id if optional id is absent', () => {
        const rawPane = {
          pane_id: 'p-agent',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            source: 'herdr',
            agent: 'gemini',
            kind: 'id',
            value: 'session-valid-123'
          }
        }
        const projected = projectBrowserPane(rawPane)
        expect(projected?.agent_session).toEqual({
          source: 'herdr',
          agent: 'gemini',
          kind: 'id',
          value: 'session-valid-123'
        })
      })

      it('omits agent_session when source is missing or empty or whitespace', () => {
        const paneNoSource = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            agent: 'gemini',
            kind: 'id',
            value: '123'
          }
        }
        expect(projectBrowserPane(paneNoSource)?.agent_session).toBeUndefined()

        const paneEmptySource = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            source: '   \t  ',
            agent: 'gemini',
            kind: 'id',
            value: '123'
          }
        }
        expect(projectBrowserPane(paneEmptySource)?.agent_session).toBeUndefined()
      })

      it('omits agent_session when agent is missing, empty, or non-string', () => {
        const paneNoAgent = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            source: 'herdr',
            kind: 'id',
            value: '123'
          }
        }
        expect(projectBrowserPane(paneNoAgent)?.agent_session).toBeUndefined()

        const paneNumericAgent = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            source: 'herdr',
            agent: 99999,
            kind: 'id',
            value: '123'
          }
        }
        expect(projectBrowserPane(paneNumericAgent)?.agent_session).toBeUndefined()
      })

      it('omits agent_session when kind is missing or outside the schema enum', () => {
        const paneNoKind = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            source: 'herdr',
            agent: 'gemini',
            value: '123'
          }
        }
        expect(projectBrowserPane(paneNoKind)?.agent_session).toBeUndefined()

        const paneInvalidKind = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            source: 'herdr',
            agent: 'gemini',
            kind: 'bogus',
            value: '123'
          }
        }
        expect(projectBrowserPane(paneInvalidKind)?.agent_session).toBeUndefined()
      })

      it('omits agent_session when value is missing, empty, or whitespace', () => {
        const paneNoValue = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            source: 'herdr',
            agent: 'gemini',
            kind: 'id'
          }
        }
        expect(projectBrowserPane(paneNoValue)?.agent_session).toBeUndefined()

        const paneWhitespaceValue = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            source: 'herdr',
            agent: 'gemini',
            kind: 'id',
            value: '    '
          }
        }
        expect(projectBrowserPane(paneWhitespaceValue)?.agent_session).toBeUndefined()
      })

      it('omits agent_session when session object contains only malicious or unknown properties', () => {
        const paneMalicious = {
          pane_id: 'p-1',
          workspace_id: 'ws-1',
          tab_id: 't-1',
          agent_status: 'working',
          agent_session: {
            malicious_prop: 'injected_payload',
            secret: true,
            raw_token: 'leak'
          }
        }
        expect(projectBrowserPane(paneMalicious)?.agent_session).toBeUndefined()
      })
    })
  })

  describe('projectBrowserAgents', () => {
    it('projects snapshot agents to only target and pane_id strings', () => {
      const rawAgents = [
        {
          target: 'p-1',
          pane_id: 'p-1',
          system_prompt: 'You are an AI assistant',
          config: { model: 'gemini' },
          secret_key: 'top_secret'
        },
        {
          target: 'p-2',
          extra_stuff: 123
        },
        null,
        'invalid' as any
      ]

      const projected = projectBrowserAgents(rawAgents)
      expect(projected).toEqual([
        { target: 'p-1', pane_id: 'p-1' },
        { target: 'p-2' },
        {},
        {}
      ])
      expect((projected?.[0] as any).system_prompt).toBeUndefined()
      expect((projected?.[0] as any).secret_key).toBeUndefined()
    })

    it('preserves only bounded fallback session value and id', () => {
      const projected = projectBrowserAgents([
        {
          target: 'p-1',
          agent_session: {
            source: 'internal-source',
            agent: 'letta',
            kind: 'id',
            value: 'session-value',
            id: 'session-id',
            secret: 'drop-me'
          }
        }
      ])

      expect(projected).toEqual([
        {
          target: 'p-1',
          agent_session: { value: 'session-value', id: 'session-id' }
        }
      ])
    })

    it('preserves fallback mutation identity from projection through server verification', () => {
      const rawSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [],
        tabs: [],
        panes: [
          {
            pane_id: 'p-fallback',
            workspace_id: 'w-1',
            tab_id: 't-1',
            terminal_id: 'term-1',
            agent_status: 'working',
            cwd: '/tmp',
            focused: true
          }
        ],
        agents: [
          {
            target: 'p-fallback',
            agent_session: { value: 'session-only-on-agent' }
          }
        ]
      }

      const browserSnapshot = projectBrowserSnapshot(rawSnapshot)
      const derived = deriveActionTarget(browserSnapshot.panes[0], browserSnapshot.agents)
      expect(derived.target?.agentSessionId).toBe('session-only-on-agent')
      expect(
        verifyTargetAgainstSnapshot(rawSnapshot, derived.target!, { actionType: 'prompt' }).ok
      ).toBe(true)
    })
  })

  describe('projectBrowserSnapshot', () => {
    it('creates a fresh allowlisted snapshot object and strips all unknown top-level fields and layouts', () => {
      const rawSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        focused_workspace_id: 'ws-1',
        focused_tab_id: 't-1',
        focused_pane_id: 'p-1',
        active_workspace_id: 'ws-1',
        unknown_root_key: 'malicious',
        debug_trace: { steps: [1, 2, 3] },
        layouts: [{ id: 'layout-grid', cols: 2 }],
        workspaces: [
          {
            workspace_id: 'ws-1',
            label: 'Main Space',
            number: 1,
            agent_status: 'idle',
            tab_count: 1,
            pane_count: 1,
            focused: true
          }
        ],
        tabs: [
          {
            tab_id: 't-1',
            workspace_id: 'ws-1',
            label: 'Tab 1',
            number: 1,
            pane_count: 1,
            focused: true,
            agent_status: 'idle'
          }
        ],
        panes: [
          {
            pane_id: 'p-1',
            workspace_id: 'ws-1',
            tab_id: 't-1',
            terminal_id: 'term-1',
            agent_status: 'idle',
            focused: true
          }
        ],
        agents: [
          {
            target: 'p-1',
            pane_id: 'p-1',
            internal_detail: 'do_not_leak'
          }
        ]
      }

      const projected = projectBrowserSnapshot(rawSnapshot)
      expect(projected).not.toBe(rawSnapshot)

      expect(projected.protocol).toBe(22)
      expect(projected.version).toBe('0.9.1')
      expect(projected.focused_workspace_id).toBe('ws-1')
      expect(projected.focused_tab_id).toBe('t-1')
      expect(projected.focused_pane_id).toBe('p-1')
      expect(projected.active_workspace_id).toBe('ws-1')

      // Unknown fields and layouts stripped
      expect((projected as any).unknown_root_key).toBeUndefined()
      expect((projected as any).debug_trace).toBeUndefined()
      expect(projected.layouts).toBeUndefined()

      // Child entities are projected
      expect(projected.workspaces.length).toBe(1)
      expect(projected.tabs.length).toBe(1)
      expect(projected.panes.length).toBe(1)
      expect(projected.agents).toEqual([{ target: 'p-1', pane_id: 'p-1' }])
    })

    it('gracefully handles empty or malformed snapshot input', () => {
      const projectedNull = projectBrowserSnapshot(null)
      expect(projectedNull.protocol).toBe(22)
      expect(projectedNull.workspaces).toEqual([])
      expect(projectedNull.tabs).toEqual([])
      expect(projectedNull.panes).toEqual([])

      const projectedEmpty = projectBrowserSnapshot({})
      expect(projectedEmpty.protocol).toBe(22)
      expect(projectedEmpty.version).toBe('0.0.0')
      expect(projectedEmpty.workspaces).toEqual([])
      expect(projectedEmpty.tabs).toEqual([])
      expect(projectedEmpty.panes).toEqual([])
    })
  })
})
