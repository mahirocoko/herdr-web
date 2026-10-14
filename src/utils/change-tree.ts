// MIT License - Copyright (c) 2026 devswha
// Adapted from dc2f11de src/lib/changeTree.ts; preserve list ordering and compact folders.
export interface IChangeTreeFolder {
  kind: 'folder'
  path: string
  name: string
  depth: number
  entries: ChangeTreeEntry[]
  files: number
}
export interface IChangeTreeFile {
  kind: 'file'
  path: string
  name: string
  depth: number
  index: number
}
export type ChangeTreeEntry = IChangeTreeFolder | IChangeTreeFile
interface INode {
  path: string
  name: string
  entries: Array<INode | number>
  folders: Map<string, INode>
}
export const changeTree = (paths: readonly string[]): ChangeTreeEntry[] => {
  const root: INode = { path: '', name: '', entries: [], folders: new Map() }
  paths.forEach((path, index) => {
    const segments = path.split('/')
    let folder = root
    for (const segment of segments.slice(0, -1)) {
      let next = folder.folders.get(segment)
      if (next === undefined) {
        next = {
          path: folder.path === '' ? segment : `${folder.path}/${segment}`,
          name: segment,
          entries: [],
          folders: new Map()
        }
        folder.folders.set(segment, next)
        folder.entries.push(next)
      }
      folder = next
    }
    folder.entries.push(index)
  })
  return finish(root.entries, 0, paths)
}
const finish = (
  entries: readonly (INode | number)[],
  depth: number,
  paths: readonly string[]
): ChangeTreeEntry[] =>
  entries.map((entry) => {
    if (typeof entry === 'number') {
      const path = paths[entry]!
      return {
        kind: 'file',
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        depth,
        index: entry
      }
    }
    let folder = entry,
      name = folder.name
    while (
      folder.entries.length === 1 &&
      typeof folder.entries[0] !== 'number'
    ) {
      folder = folder.entries[0]!
      name = `${name}/${folder.name}`
    }
    const children = finish(folder.entries, depth + 1, paths)
    return {
      kind: 'folder',
      path: folder.path,
      name,
      depth,
      entries: children,
      files: children.reduce(
        (sum, child) => sum + (child.kind === 'file' ? 1 : child.files),
        0
      )
    }
  })
