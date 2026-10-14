// MIT License - Copyright (c) 2026 devswha
// Browser-safe contracts adapted from dc2f11de shared/protocol.ts.
export type RepoDiffScope = 'workspace' | 'staged' | 'commit'
export type RepoDiffStatus =
  | 'added'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'type_changed'
  | 'unmerged'
  | 'untracked'
export interface IRepoComparison {
  scope: RepoDiffScope
  base: string | null
  head: string | null
}
export interface IRepoDiffTarget extends IRepoComparison {
  repositoryIdentity: string
  paneId: string
  path: string
  oldPath: string | null
}
export interface IRepoDiffRepository {
  root: string
  branch: string | null
  head: string | null
  detached: boolean
  unborn: boolean
}
export interface IRepoDiffFile {
  path: string
  old_path: string | null
  status: RepoDiffStatus
  additions: number | null
  deletions: number | null
  binary: boolean | null
}
export interface IRepoDiffFileList extends IRepoComparison {
  repository_identity: string
  repository: IRepoDiffRepository
  files: IRepoDiffFile[]
  total: number | null
  truncated: boolean
  limits: { max_files: number; max_list_bytes: number }
}
export interface IRepoDiffFilePatch extends IRepoComparison {
  repository_identity: string
  repository: IRepoDiffRepository
  file: IRepoDiffFile
  patch: string | null
  unavailable: 'binary' | 'too_large' | 'unmerged' | 'unsupported' | null
  truncated: boolean
  limits: { max_patch_bytes: number; context_lines: number }
}
