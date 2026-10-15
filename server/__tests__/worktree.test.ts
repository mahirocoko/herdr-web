import { describe, expect, it } from 'bun:test'
import { createServer } from '../index.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import { executeWorktreeAction } from '../worktree.ts'
import { validateActionRequest } from '../security.ts'
import type { IWorktreeAction, ISnapshotResult } from '../types.ts'

const source = { workspaceId: 'ws', paneId: 'ws:p', terminalId: 'term' }
const snapshot = {
  protocol: 22,
  version: '0.9.4',
  workspaces: [{ workspace_id: 'ws' }],
  tabs: [],
  panes: [{ pane_id: 'ws:p', workspace_id: 'ws', terminal_id: 'term' }]
} as unknown as ISnapshotResult
const checkout = {
  path: '/private/checkouts/feature',
  branch: 'feature',
  label: '/private/secret',
  is_bare: false,
  is_detached: false,
  is_prunable: false,
  is_linked_worktree: true,
  open_workspace_id: null
}
const listing = {
  type: 'worktree_list',
  source: {
    repo_key: 'repo',
    repo_name: '/private/repo',
    repo_root: '/private/repo',
    source_checkout_path: '/private/repo',
    source_workspace_id: 'ws'
  },
  worktrees: [checkout]
}
const response = {
  type: 'worktree_opened',
  workspace: { workspace_id: 'new' },
  tab: { tab_id: 'tab', workspace_id: 'new' },
  root_pane: {
    pane_id: 'new:p',
    workspace_id: 'new',
    tab_id: 'tab',
    terminal_id: 'new-term'
  },
  worktree: checkout,
  already_open: false
}
const after = {
  ...snapshot,
  workspaces: [...snapshot.workspaces, { workspace_id: 'new' }],
  tabs: [{ tab_id: 'tab', workspace_id: 'new' }],
  panes: [...snapshot.panes, { ...response.root_pane, cwd: checkout.path }]
} as unknown as ISnapshotResult
const fixture = () => {
  const calls: any[] = []
  let mutated = false
  const deps = {
    fetchSnapshot: async () => (mutated ? after : snapshot),
    sendSocketRequest: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (method === 'worktree.list') return listing
      mutated = true
      return {
        ...response,
        type:
          method === 'worktree.create' ? 'worktree_created' : 'worktree_opened'
      }
    }
  }
  return { calls, deps: deps as any }
}
const listAction: IWorktreeAction = {
  type: 'worktree-list',
  operationId: 'list',
  source
}

describe('native worktree contract (no filesystem/native mutations)', () => {
  it('actual POST rejects auth/free fields/stale source, correlates native effects and caches unknown without implicit agent dispatch', async () => {
    const f = fixture()
    const server = createServer(0, '127.0.0.1', {
      startPushBridge: false,
      deps: {
        coordinator: new OperationCoordinator(),
        fetchSnapshot: f.deps.fetchSnapshot,
        executeWorktreeAction: async (action, options) => {
          expect(options?.deps?.fetchSnapshot).toBe(f.deps.fetchSnapshot)
          return executeWorktreeAction(action, f)
        }
      }
    })
    const post = (body: unknown, origin = true) =>
      fetch(`http://127.0.0.1:${server.port}/api/action`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(origin ? { origin: `http://127.0.0.1:${server.port}` } : {})
        },
        body: JSON.stringify(body)
      })
    try {
      expect((await post(listAction, false)).status).toBe(403)
      for (const extra of [
        { path: '/tmp' },
        { cwd: '/tmp' },
        { args: [] },
        { trust_repository: true }
      ])
        expect((await post({ ...listAction, ...extra })).status).toBe(400)
      expect(f.calls.length).toBe(0)
      expect(
        (
          await post({
            ...listAction,
            operationId: 'replacement',
            source: { ...source, terminalId: 'other' }
          })
        ).status
      ).toBe(409)
      expect(f.calls.length).toBe(0)
      const list = await post(listAction)
      const body = await list.json()
      expect(JSON.stringify(body)).not.toContain('/private')
      const native = body.result.worktreeListing
      const open = {
        type: 'worktree-open',
        operationId: 'http-open',
        source,
        repositoryIdentity: native.repositoryIdentity,
        checkoutKey: native.entries[0].checkoutKey
      }
      expect(
        (
          await post({
            ...open,
            operationId: 'stale',
            checkoutKey: 'a'.repeat(64)
          })
        ).status
      ).toBe(409)
      const opened = await post(open)
      expect(opened.status).toBe(200)
      expect((await opened.json()).outcome).toBe('observed')
      expect((await post(open)).status).toBe(200)
      expect(f.calls.filter((call) => call[0] === 'worktree.open').length).toBe(
        1
      )
      expect(f.calls.some((call) => call[0] === 'agent.start')).toBe(false)
      f.deps.sendSocketRequest = async (method: string) => {
        f.calls.push([method])
        if (method === 'worktree.list') return listing
        return {
          ...response,
          root_pane: { ...response.root_pane, tab_id: 'wrong' }
        }
      }
      const ambiguous = { ...open, operationId: 'http-ambiguous' }
      expect((await post(ambiguous)).status).toBe(504)
      expect((await post(ambiguous)).status).toBe(504)
      expect(f.calls.filter((call) => call[0] === 'worktree.open').length).toBe(
        2
      )
    } finally {
      server.stop(true)
    }
  })
  it('actual POST holds worktree mutation against pending duplicates and launch/control contention', async () => {
    const f = fixture()
    const native = (await executeWorktreeAction(listAction, f)).result!
      .worktreeListing!
    let resolve!: (value: unknown) => void
    let enter!: () => void
    const pendingResponse = new Promise((done) => {
      resolve = done
    })
    const entered = new Promise<void>((done) => {
      enter = done
    })
    f.deps.sendSocketRequest = async (method: string) => {
      if (method === 'worktree.list') return listing
      enter()
      return pendingResponse
    }
    const coordinator = new OperationCoordinator()
    const server = createServer(0, '127.0.0.1', {
      startPushBridge: false,
      deps: {
        coordinator,
        fetchSnapshot: async () => snapshot,
        executeWorktreeAction: async (action) =>
          executeWorktreeAction(action, f)
      }
    })
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${server.port}/api/action`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${server.port}`
        },
        body: JSON.stringify(body)
      })
    const open = {
      type: 'worktree-open',
      operationId: 'pending-open',
      source,
      repositoryIdentity: native.repositoryIdentity,
      checkoutKey: native.entries[0].checkoutKey
    }
    const active = post(open)
    try {
      await entered
      expect((await post(open)).status).toBe(409)
      expect(
        (
          await post({
            type: 'agent-start',
            operationId: 'launch',
            target: { paneId: source.paneId, terminalId: source.terminalId },
            kind: 'letta',
            name: 'blocked'
          })
        ).status
      ).toBe(409)
      expect(coordinator.claimPaneForControl(source.paneId, 'control').ok).toBe(
        false
      )
      resolve({ type: 'wrong-response' })
      expect((await active).status).toBe(504)
    } finally {
      resolve({})
      await active
      server.stop(true)
    }
  })
  it('never accepts paths, cwd, trust or free args, bounds create branch', () => {
    expect(validateActionRequest(listAction).valid).toBe(true)
    for (const field of [
      { path: '/tmp' },
      { cwd: '/tmp' },
      { trust_repository: true },
      { args: [] }
    ])
      expect(validateActionRequest({ ...listAction, ...field }).valid).toBe(
        false
      )
    expect(
      validateActionRequest({
        type: 'worktree-create',
        operationId: 'create',
        source,
        repositoryIdentity: 'a'.repeat(64),
        branch: '--exec'
      }).valid
    ).toBe(false)
  })
  it('projects bounded opaque native facts and opens only freshly relisted exact selection', async () => {
    const f = fixture()
    const list = await executeWorktreeAction(listAction, f)
    expect(JSON.stringify(list)).not.toContain('/private')
    const native = list.result!.worktreeListing!
    const opened = await executeWorktreeAction(
      {
        type: 'worktree-open',
        operationId: 'open',
        source,
        repositoryIdentity: native.repositoryIdentity,
        checkoutKey: native.entries[0].checkoutKey
      },
      f
    )
    expect(opened).toMatchObject({
      outcome: 'observed',
      result: { workspaceId: 'new', paneId: 'new:p', alreadyOpen: false }
    })
    expect(f.calls.at(-1)).toEqual([
      'worktree.open',
      {
        workspace_id: 'ws',
        path: checkout.path,
        focus: false,
        trust_repository: false
      }
    ])
  })
  it('creates native default checkout with branch only and never starts an agent', async () => {
    const f = fixture()
    const native = (await executeWorktreeAction(listAction, f)).result!
      .worktreeListing!
    const created = await executeWorktreeAction(
      {
        type: 'worktree-create',
        operationId: 'create',
        source,
        repositoryIdentity: native.repositoryIdentity,
        branch: 'feature'
      },
      f
    )
    expect(created.outcome).toBe('observed')
    expect(f.calls.at(-1)).toEqual([
      'worktree.create',
      {
        workspace_id: 'ws',
        branch: 'feature',
        focus: false,
        trust_repository: false
      }
    ])
    expect(f.calls.some((call) => call[0] === 'agent.start')).toBe(false)
  })
  it('rejects forged/stale keys and source replacement before mutation', async () => {
    const f = fixture()
    const result = await executeWorktreeAction(
      {
        type: 'worktree-open',
        operationId: 'open',
        source,
        repositoryIdentity: 'a'.repeat(64),
        checkoutKey: 'b'.repeat(64)
      },
      f
    )
    expect(result.outcome).toBe('rejected')
    expect(f.calls.every((call) => call[0] === 'worktree.list')).toBe(true)
    f.deps.fetchSnapshot = async () => ({ ...snapshot, panes: [] })
    const count = f.calls.length
    expect((await executeWorktreeAction(listAction, f)).outcome).toBe(
      'rejected'
    )
    expect(f.calls.length).toBe(count)
  })
  it('fails closed on oversized/native-malformed listing and never exposes path-like branch labels', async () => {
    const f = fixture()
    f.deps.sendSocketRequest = async () => ({
      ...listing,
      worktrees: Array(129).fill(checkout)
    })
    expect((await executeWorktreeAction(listAction, f)).outcome).toBe(
      'rejected'
    )
    f.deps.sendSocketRequest = async () => ({
      ...listing,
      worktrees: [{ ...checkout, branch: '/private/host/path' }]
    })
    const result = await executeWorktreeAction(listAction, f)
    expect(result.result?.worktreeListing?.entries[0].branch).toBeNull()
    expect(JSON.stringify(result)).not.toContain('/private')
  })

  it('lost mutation response stays unknown with no automatic retry', async () => {
    const f = fixture()
    const native = (await executeWorktreeAction(listAction, f)).result!
      .worktreeListing!
    f.deps.sendSocketRequest = async (method: string) => {
      f.calls.push([method])
      if (method === 'worktree.list') return listing
      throw new Error('timeout')
    }
    expect(
      (
        await executeWorktreeAction(
          {
            type: 'worktree-open',
            operationId: 'open',
            source,
            repositoryIdentity: native.repositoryIdentity,
            checkoutKey: native.entries[0].checkoutKey
          },
          f
        )
      ).outcome
    ).toBe('unknown')
    expect(f.calls.filter((call) => call[0] === 'worktree.open').length).toBe(1)
  })
})
