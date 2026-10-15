import { createHash } from 'node:crypto'
import { getHerdrSnapshot, getTransportMode } from './herdr-adapter.ts'
import { sendRawSocketRequest } from './herdr-socket.ts'
import type { IWorktreeAction, ISnapshotResult } from './types.ts'
import type { IActionResponse, IWorktreeEntry } from '../src/types/herdr.ts'

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const safeBranch = (value: unknown): string | null =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$/.test(value) &&
  !value.includes('..')
    ? value
    : null
const boundedString = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 4096 &&
  !/[\x00-\x1f\x7f]/.test(value)

// Native Herdr owns Git discovery, canonicalization, symlink/trust policy and checkout paths.
// Browser identities are hashes of native facts, never user-supplied filesystem authority.
export const executeWorktreeAction = async (
  action: IWorktreeAction,
  options: {
    deps?: {
      fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
      sendSocketRequest?: typeof sendRawSocketRequest
    }
  } = {}
): Promise<IActionResponse & { status: number }> => {
  const reject = (
    error: string,
    status = 409
  ): IActionResponse & { status: number } => ({
    ok: false,
    outcome: 'rejected',
    status,
    error
  })
  const unknown = (): IActionResponse & { status: number } => ({
    ok: false,
    outcome: 'unknown',
    status: 504,
    error:
      'Worktree outcome unknown. Inspect native Spaces and checkouts before another explicit action; no automatic retry.'
  })
  if (getTransportMode() !== 'socket')
    return reject('Native worktrees require socket transport')
  const fetchSnapshot = options.deps?.fetchSnapshot ?? getHerdrSnapshot
  const send = options.deps?.sendSocketRequest ?? sendRawSocketRequest
  const verify = async (): Promise<boolean> => {
    const snapshot = await fetchSnapshot(3000)
    const workspaces = snapshot.workspaces.filter(
      (workspace) => workspace.workspace_id === action.source.workspaceId
    )
    const panes = snapshot.panes.filter(
      (pane) => pane.pane_id === action.source.paneId
    )
    return (
      workspaces.length === 1 &&
      panes.length === 1 &&
      panes[0].workspace_id === action.source.workspaceId &&
      panes[0].terminal_id === action.source.terminalId
    )
  }
  let listing: any
  try {
    if (!(await verify()))
      return reject('Worktree source Space/pane/terminal changed')
    listing = await send(
      'worktree.list',
      { workspace_id: action.source.workspaceId, trust_repository: false },
      { timeoutMs: 5000 }
    )
  } catch {
    return reject(
      'Native worktree listing unavailable or repository trust refused',
      502
    )
  }
  const source = listing?.source
  if (
    listing?.type !== 'worktree_list' ||
    !source ||
    ![source.repo_key, source.repo_root, source.source_checkout_path].every(
      boundedString
    ) ||
    (source.source_workspace_id != null &&
      source.source_workspace_id !== action.source.workspaceId) ||
    !Array.isArray(listing.worktrees) ||
    listing.worktrees.length > 128
  )
    return reject(
      'Native worktree listing malformed or exceeds 128 checkouts',
      502
    )
  const repositoryIdentity = digest([
    action.source,
    source.repo_key,
    source.repo_root,
    source.source_checkout_path
  ])
  const entries: IWorktreeEntry[] = []
  for (const entry of listing.worktrees) {
    if (
      !entry ||
      !boundedString(entry.path) ||
      !['is_bare', 'is_detached', 'is_prunable', 'is_linked_worktree'].every(
        (key) => typeof entry[key] === 'boolean'
      )
    )
      return reject('Native checkout metadata malformed', 502)
    if (
      entry.open_workspace_id != null &&
      (typeof entry.open_workspace_id !== 'string' ||
        !/^[a-zA-Z0-9_.:-]{1,128}$/.test(entry.open_workspace_id))
    )
      return reject('Native checkout Space identity malformed', 502)
    entries.push({
      checkoutKey: digest([
        repositoryIdentity,
        entry.path,
        entry.branch ?? null,
        entry.is_linked_worktree,
        entry.is_bare,
        entry.is_prunable
      ]),
      branch: safeBranch(entry.branch),
      linked: entry.is_linked_worktree,
      openWorkspaceId: entry.open_workspace_id ?? null,
      available: !entry.is_bare && !entry.is_prunable
    })
  }
  if (action.type === 'worktree-list')
    return {
      ok: true,
      status: 200,
      outcome: 'acknowledged',
      result: { worktreeListing: { repositoryIdentity, entries } }
    }
  if (repositoryIdentity !== action.repositoryIdentity)
    return reject(
      'Repository/source identity changed; refresh the native checkout list'
    )
  let selected: any
  if (action.type === 'worktree-open') {
    const indexes = entries.flatMap((entry, index) =>
      entry.checkoutKey === action.checkoutKey ? [index] : []
    )
    if (indexes.length !== 1 || !entries[indexes[0]].available)
      return reject(
        'Selected native checkout changed, is ambiguous, bare or prunable'
      )
    selected = listing.worktrees[indexes[0]]
  }
  try {
    if (!(await verify()))
      return reject('Worktree source changed before dispatch')
  } catch {
    return reject('Worktree source preflight unavailable', 502)
  }
  let response: any
  try {
    response = await send(
      action.type === 'worktree-open' ? 'worktree.open' : 'worktree.create',
      {
        workspace_id: action.source.workspaceId,
        ...(selected
          ? { path: selected.path }
          : {
              branch:
                action.type === 'worktree-create' ? action.branch : undefined
            }),
        focus: false,
        trust_repository: false
      },
      { timeoutMs: action.type === 'worktree-create' ? 120000 : 10000 }
    )
  } catch {
    return unknown()
  }
  const workspaceId = response?.workspace?.workspace_id
  const tabId = response?.tab?.tab_id
  const paneId = response?.root_pane?.pane_id
  if (
    response?.type !==
      (action.type === 'worktree-open'
        ? 'worktree_opened'
        : 'worktree_created') ||
    ![workspaceId, tabId, paneId].every(boundedString) ||
    response.tab.workspace_id !== workspaceId ||
    response.root_pane.workspace_id !== workspaceId ||
    response.root_pane.tab_id !== tabId ||
    !boundedString(response.worktree?.path) ||
    (selected &&
      (response.worktree.path !== selected.path ||
        response.worktree.branch !== selected.branch)) ||
    (action.type === 'worktree-create' &&
      response.worktree.branch !== action.branch) ||
    (action.type === 'worktree-open' &&
      typeof response.already_open !== 'boolean')
  )
    return unknown()
  try {
    const after = await fetchSnapshot(3000)
    const pane = after.panes.filter((item) => item.pane_id === paneId)
    if (
      after.workspaces.filter((item) => item.workspace_id === workspaceId)
        .length !== 1 ||
      after.tabs.filter(
        (item) => item.tab_id === tabId && item.workspace_id === workspaceId
      ).length !== 1 ||
      pane.length !== 1 ||
      pane[0].workspace_id !== workspaceId ||
      pane[0].tab_id !== tabId ||
      pane[0].terminal_id !== response.root_pane.terminal_id ||
      (pane[0].foreground_cwd || pane[0].cwd) !== response.worktree.path
    )
      return unknown()
  } catch {
    return unknown()
  }
  return {
    ok: true,
    status: 200,
    outcome: 'observed',
    result: {
      workspaceId,
      tabId,
      paneId,
      ...(action.type === 'worktree-open'
        ? { alreadyOpen: response.already_open }
        : {})
    }
  }
}
