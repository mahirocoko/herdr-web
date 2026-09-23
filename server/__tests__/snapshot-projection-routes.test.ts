import { describe, expect, it } from 'bun:test'
import { createServer } from '../index.ts'
import { getSharedSnapshotBridge, SnapshotBridge } from '../snapshot-bridge.ts'

describe('HTTP /api/snapshot and WebSocket /api/events snapshot projection guards', () => {
  const createMaliciousRawSnapshot = (): any => ({
    protocol: 22,
    version: '0.9.1',
    focused_workspace_id: 'ws-main',
    focused_tab_id: 't-1',
    focused_pane_id: 'p-1',
    active_workspace_id: 'ws-main',
    layouts: [{ id: 'layout-grid', raw: 'confidential' }],
    secret_daemon_key: 'leak_me_not',
    workspaces: [
      {
        workspace_id: 'ws-main',
        label: 'Workspace Alpha',
        number: 1,
        agent_status: 'working',
        tab_count: 1,
        pane_count: 1,
        focused: true,
        layouts: [{ id: 'ws-layout' }],
        tokens: {
          mahiro_workspace_branch: 'feat/secret-branch',
          mahiro_workspace_git_status: 'dirty',
          mahiro_workspace_worktree: 'wt-alpha',
          arbitrary_token: 'secret_leak',
          letta_pid: '4444'
        },
        worktree: {
          repo_name: 'herdr-web',
          is_linked_worktree: true,
          repo_root: '/Users/mahiro/ghq/github.com/mahirocoko/herdr-web',
          checkout_path: '/Users/mahiro/ghq/github.com/mahirocoko/herdr-web-wt'
        }
      }
    ],
    tabs: [
      {
        tab_id: 't-1',
        workspace_id: 'ws-main',
        label: 'Main Tab',
        number: 1,
        pane_count: 1,
        focused: true,
        agent_status: 'idle',
        unknown_tab_field: 'strip'
      }
    ],
    panes: [
      {
        pane_id: 'p-1',
        workspace_id: 'ws-main',
        tab_id: 't-1',
        terminal_id: 'term-1',
        agent_status: 'idle',
        focused: true,
        state_labels: { status: 'waiting' },
        tokens: {
          summary: 'Normal task',
          letta_scope: 'leak'
        }
      }
    ],
    agents: [
      {
        target: 'p-1',
        pane_id: 'p-1',
        system_prompt: 'Confidential system instructions'
      }
    ]
  })

  it('proves HTTP GET /api/snapshot calls browser projection and strips raw fields', async () => {
    let projectionCallCount = 0
    const rawSnap = createMaliciousRawSnapshot()

    const server = createServer(0, '127.0.0.1', {
      startPushBridge: false,
      deps: {
        fetchSnapshot: async () => rawSnap,
        projectBrowserSnapshot: (snap: any) => {
          projectionCallCount++
          const { projectBrowserSnapshot } = require('../snapshot-projection.ts')
          return projectBrowserSnapshot(snap)
        }
      }
    })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/snapshot`, {
        headers: {
          origin: `http://127.0.0.1:${server.port}`
        }
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ok).toBe(true)

      // Guard: projection was explicitly called
      expect(projectionCallCount).toBeGreaterThanOrEqual(1)

      const snapshot = body.snapshot
      // Guard: top-level layouts and secret fields are stripped
      expect(snapshot.layouts).toBeUndefined()
      expect(snapshot.secret_daemon_key).toBeUndefined()

      // Guard: workspace tokens allowlisted only
      const ws = snapshot.workspaces[0]
      expect(ws.layouts).toBeUndefined()
      expect(ws.tokens.mahiro_workspace_branch).toBe('feat/secret-branch')
      expect(ws.tokens.mahiro_workspace_git_status).toBe('dirty')
      expect(ws.tokens.mahiro_workspace_worktree).toBe('wt-alpha')
      expect(ws.tokens.arbitrary_token).toBeUndefined()
      expect(ws.tokens.letta_pid).toBeUndefined()

      // Guard: absolute worktree paths stripped
      expect(ws.worktree).toEqual({
        repo_name: 'herdr-web',
        is_linked_worktree: true
      })
      expect(ws.worktree.repo_root).toBeUndefined()
      expect(ws.worktree.checkout_path).toBeUndefined()

      // Guard: pane state_labels and internal tokens stripped
      const pane = snapshot.panes[0]
      expect(pane.state_labels).toBeUndefined()
      expect(pane.tokens.summary).toBe('Normal task')
      expect(pane.tokens.letta_scope).toBeUndefined()

      // Guard: snapshot agents projected to only target and pane_id
      expect(snapshot.agents).toEqual([{ target: 'p-1', pane_id: 'p-1' }])
      expect(snapshot.agents[0].system_prompt).toBeUndefined()
    } finally {
      server.stop(true)
    }
  })

  it('proves WebSocket /api/events calls browser projection for initial snapshot and real-time updates', async () => {
    let projectionCallCount = 0
    const rawSnap1 = createMaliciousRawSnapshot()
    const rawSnap2: any = {
      ...createMaliciousRawSnapshot(),
      secret_daemon_key: 'leak_realtime_2',
      workspaces: [
        {
          ...createMaliciousRawSnapshot().workspaces[0],
          label: 'Workspace Realtime'
        }
      ]
    }

    const isolatedBridge = new SnapshotBridge({
      snapshotFetcher: async () => rawSnap1
    })
    // Pre-populate latestSnapshot on the isolated bridge
    ;(isolatedBridge as any).latestSnapshot = rawSnap1

    const server = createServer(0, '127.0.0.1', {
      startPushBridge: false,
      deps: {
        snapshotBridge: isolatedBridge,
        projectBrowserSnapshot: (snap: any) => {
          projectionCallCount++
          const { projectBrowserSnapshot } = require('../snapshot-projection.ts')
          return projectBrowserSnapshot(snap)
        }
      }
    })

    try {
      const wsUrl = `ws://127.0.0.1:${server.port}/api/events`
      const messages: any[] = []

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl, {
          headers: {
            origin: `http://127.0.0.1:${server.port}`
          }
        } as any)

        const timer = setTimeout(() => {
          ws.close()
          reject(new Error('WebSocket connection timed out'))
        }, 4000)

        ws.onopen = () => {
          // Wait briefly for initial snapshot delivery, then emit real-time update
          setTimeout(() => {
            ;(isolatedBridge as any).emitSnapshot(rawSnap2)
          }, 50)
        }

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data.toString())
            messages.push(parsed)
            const snapshotMessages = messages.filter((m) => m.type === 'snapshot')
            if (snapshotMessages.length >= 2) {
              clearTimeout(timer)
              ws.close()
              resolve()
            }
          } catch (err) {
            clearTimeout(timer)
            ws.close()
            reject(err)
          }
        }

        ws.onerror = (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })

      // Guard: projection was explicitly invoked for both initial snapshot and real-time update
      expect(projectionCallCount).toBeGreaterThanOrEqual(2)

      const snapshotMessages = messages.filter((m) => m.type === 'snapshot')
      expect(snapshotMessages.length).toBe(2)

      const initialSnapshot = snapshotMessages[0].data
      expect(initialSnapshot.layouts).toBeUndefined()
      expect(initialSnapshot.secret_daemon_key).toBeUndefined()
      expect(initialSnapshot.workspaces[0].label).toBe('Workspace Alpha')
      expect(initialSnapshot.workspaces[0].tokens.arbitrary_token).toBeUndefined()
      expect(initialSnapshot.workspaces[0].worktree.repo_root).toBeUndefined()

      const realtimeSnapshot = snapshotMessages[1].data
      expect(realtimeSnapshot.layouts).toBeUndefined()
      expect(realtimeSnapshot.secret_daemon_key).toBeUndefined()
      expect(realtimeSnapshot.workspaces[0].label).toBe('Workspace Realtime')
      expect(realtimeSnapshot.workspaces[0].tokens.arbitrary_token).toBeUndefined()
      expect(realtimeSnapshot.workspaces[0].worktree.repo_root).toBeUndefined()
      expect(realtimeSnapshot.agents).toEqual([{ target: 'p-1', pane_id: 'p-1' }])

      // Guard: shared singleton was never mutated or touched
      const sharedBridge = getSharedSnapshotBridge()
      expect((sharedBridge as any).latestSnapshot).not.toBe(rawSnap1)
      expect((sharedBridge as any).latestSnapshot).not.toBe(rawSnap2)
    } finally {
      isolatedBridge.stop()
      server.stop(true)
    }
  })
})
