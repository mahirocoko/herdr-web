import type {
  IRepoComparison,
  IRepoDiffFileList,
  IRepoDiffFilePatch,
  IRepoDiffTarget
} from '@/types/repo-diff.ts'
export const repoDiffQuery = (
  paneId: string,
  comparison: IRepoComparison,
  target?: IRepoDiffTarget
) => {
  const q = new URLSearchParams({ pane_id: paneId, scope: comparison.scope })
  if (comparison.scope === 'commit') {
    q.set('base', comparison.base ?? '')
    q.set('head', comparison.head ?? '')
  }
  if (target) {
    q.set('repository_identity', target.repositoryIdentity)
    q.set('path', target.path)
    if (target.oldPath) q.set('old_path', target.oldPath)
  }
  return q
}
const read = async <T extends IRepoDiffFileList | IRepoDiffFilePatch>(
  kind: 'files' | 'file',
  q: URLSearchParams,
  signal: AbortSignal
): Promise<T> => {
  const response = await fetch(`/api/workspace/diff/${kind}?${q}`, {
    signal,
    cache: 'no-store'
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(body.error?.message ?? 'Changes unavailable')
  if (
    typeof body.repository_identity !== 'string' ||
    !/^[0-9a-f]{64}$/.test(body.repository_identity) ||
    !body.repository ||
    typeof body.repository.root !== 'string' ||
    !['workspace', 'staged', 'commit'].includes(body.scope) ||
    typeof body.truncated !== 'boolean' ||
    (kind === 'files'
      ? !Array.isArray(body.files) || body.files.length > 2000
      : !body.file ||
        (body.patch !== null &&
          (typeof body.patch !== 'string' ||
            new TextEncoder().encode(body.patch).length > 1024 * 1024)))
  )
    throw new Error('Invalid changes response')
  return body
}
export const fetchRepoDiffFiles = (
  paneId: string,
  comparison: IRepoComparison,
  signal: AbortSignal
) => read<IRepoDiffFileList>('files', repoDiffQuery(paneId, comparison), signal)
export const fetchRepoDiffFile = (
  target: IRepoDiffTarget,
  signal: AbortSignal
) =>
  read<IRepoDiffFilePatch>(
    'file',
    repoDiffQuery(target.paneId, target, target),
    signal
  )
