// MIT License - Copyright (c) 2026 devswha
// Adapted dc2f11de FileGlyph.tsx, fileIcons.ts, pathParts and repoDiff status vocabulary.
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileDiff,
  FileDigit,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  type LucideIcon
} from 'lucide-react'
import type { RepoDiffStatus } from '@/types/repo-diff.ts'

export const STATUS_MARK: Record<RepoDiffStatus, string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  type_changed: 'T',
  unmerged: 'U',
  untracked: '?'
}
export const STATUS_WORD: Record<RepoDiffStatus, string> = {
  added: 'Added',
  deleted: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
  copied: 'Copied',
  type_changed: 'Type changed',
  unmerged: 'Conflict',
  untracked: 'Untracked'
}
export const pathParts = (path: string) => {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = path.slice(cut + 1)
  const head = cut < 0 ? '' : path.slice(0, cut)
  const folder =
    cut >= 0 && (head === '' || /^[A-Za-z]:$/.test(head))
      ? path.slice(0, cut + 1)
      : head
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1
    ? { folder, stem: name.slice(0, dot), extension: name.slice(dot) }
    : { folder, stem: name, extension: '' }
}
type FileIconKind =
  | 'file'
  | 'code'
  | 'json'
  | 'config'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'shell'
  | 'lock'
  | 'diff'
  | 'font'
  | 'key'
  | 'binary'
  | 'spreadsheet'
const FILE_GLYPHS: Record<FileIconKind, LucideIcon> = {
  file: File,
  code: FileCode,
  json: FileJson,
  config: FileCog,
  text: FileText,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  shell: FileTerminal,
  lock: FileLock,
  diff: FileDiff,
  font: FileType,
  key: FileKey,
  binary: FileDigit,
  spreadsheet: FileSpreadsheet
}
const EXTENSIONS: Record<Exclude<FileIconKind, 'file'>, string[]> = {
  code: [
    'ts',
    'tsx',
    'mts',
    'cts',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'vue',
    'svelte',
    'astro',
    'py',
    'pyi',
    'rb',
    'rs',
    'go',
    'java',
    'kt',
    'kts',
    'swift',
    'c',
    'h',
    'cc',
    'cpp',
    'cxx',
    'hpp',
    'hh',
    'm',
    'mm',
    'cs',
    'php',
    'lua',
    'dart',
    'scala',
    'ex',
    'exs',
    'erl',
    'hs',
    'zig',
    'r',
    'pl',
    'pm',
    'clj',
    'cljs',
    'elm',
    'ml',
    'mli',
    'fs',
    'nim',
    'cr',
    'jl',
    'sol',
    'sql',
    'html',
    'htm',
    'xhtml',
    'xml',
    'css',
    'scss',
    'sass',
    'less',
    'styl',
    'graphql',
    'gql',
    'proto'
  ],
  json: ['json', 'jsonc', 'json5', 'geojson', 'webmanifest'],
  config: [
    'yaml',
    'yml',
    'toml',
    'ini',
    'cfg',
    'conf',
    'env',
    'properties',
    'plist',
    'editorconfig'
  ],
  text: [
    'md',
    'markdown',
    'mdx',
    'mkd',
    'txt',
    'text',
    'rst',
    'adoc',
    'asciidoc',
    'org',
    'log',
    'pdf',
    'doc',
    'docx',
    'rtf',
    'odt'
  ],
  image: [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'svg',
    'bmp',
    'ico',
    'icns',
    'avif',
    'heic',
    'heif',
    'tif',
    'tiff',
    'psd'
  ],
  video: [
    'mp4',
    'm4v',
    'mov',
    'webm',
    'mkv',
    'avi',
    'wmv',
    'flv',
    'mpg',
    'mpeg'
  ],
  audio: [
    'mp3',
    'wav',
    'ogg',
    'oga',
    'opus',
    'flac',
    'm4a',
    'aac',
    'wma',
    'aiff',
    'aif',
    'mid',
    'midi'
  ],
  archive: [
    'zip',
    'tar',
    'gz',
    'tgz',
    'bz2',
    'tbz',
    'xz',
    'txz',
    'zst',
    '7z',
    'rar',
    'jar',
    'war',
    'dmg',
    'pkg',
    'deb',
    'rpm',
    'iso',
    'apk'
  ],
  shell: [
    'sh',
    'bash',
    'zsh',
    'fish',
    'ksh',
    'bat',
    'cmd',
    'ps1',
    'psm1',
    'psd1',
    'nu'
  ],
  lock: ['lock', 'lockb'],
  diff: ['diff', 'patch'],
  font: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
  key: [
    'pem',
    'key',
    'crt',
    'cer',
    'der',
    'p12',
    'pfx',
    'pub',
    'asc',
    'gpg',
    'keystore',
    'jks'
  ],
  binary: [
    'exe',
    'dll',
    'so',
    'dylib',
    'o',
    'a',
    'lib',
    'obj',
    'class',
    'pyc',
    'pyo',
    'wasm',
    'bin',
    'node'
  ],
  spreadsheet: ['csv', 'tsv', 'xls', 'xlsx', 'ods', 'numbers']
}
const BY_EXTENSION = new Map<string, FileIconKind>(
  (Object.keys(EXTENSIONS) as Exclude<FileIconKind, 'file'>[]).flatMap((kind) =>
    EXTENSIONS[kind].map((extension) => [extension, kind] as const)
  )
)
const BY_NAME: Readonly<Record<string, FileIconKind>> = {
  'package-lock.json': 'lock',
  'npm-shrinkwrap.json': 'lock',
  'pnpm-lock.yaml': 'lock',
  'go.sum': 'lock',
  dockerfile: 'config',
  containerfile: 'config',
  makefile: 'config',
  gnumakefile: 'config',
  'cmakelists.txt': 'config',
  justfile: 'config',
  procfile: 'config',
  '.gitignore': 'config',
  '.gitattributes': 'config',
  '.gitmodules': 'config',
  '.dockerignore': 'config',
  '.npmignore': 'config',
  '.editorconfig': 'config',
  '.npmrc': 'config',
  '.nvmrc': 'config',
  '.prettierrc': 'config',
  '.eslintrc': 'config',
  '.babelrc': 'config',
  '.prettierignore': 'config',
  readme: 'text',
  license: 'text',
  licence: 'text',
  copying: 'text',
  changelog: 'text',
  notice: 'text',
  authors: 'text',
  contributing: 'text',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
  '.bash_profile': 'shell',
  '.zprofile': 'shell',
  '.bash_aliases': 'shell'
}
export const fileIconKind = (path: string): FileIconKind => {
  const { stem, extension } = pathParts(path.toLowerCase())
  const name = stem + extension
  const named = BY_NAME[name]
  if (named !== undefined) return named
  if (name === '.env' || name.startsWith('.env.')) return 'config'
  if (name.startsWith('dockerfile.') || name.endsWith('.dockerfile'))
    return 'config'
  return (
    (extension !== '' ? BY_EXTENSION.get(extension.slice(1)) : undefined) ??
    'file'
  )
}
export const FileGlyph = ({
  name,
  className
}: {
  name: string
  className?: string
}) => {
  const kind = fileIconKind(name)
  const Glyph = FILE_GLYPHS[kind]
  return <Glyph aria-hidden="true" className={className} data-kind={kind} />
}
export const Skeleton = ({
  className = '',
  width = 'medium'
}: {
  className?: string
  width?: string
}) => (
  <span className={`repo-source-skeleton ${className}`} data-width={width} />
)
export const skeletonRows = (listed: number | null) => {
  const widths = ['medium', 'long', 'short', 'medium', 'short', 'long']
  const count = listed === null ? 3 : Math.min(Math.max(listed, 1), 14)
  return Array.from(
    { length: count },
    (_, index) => widths[index % widths.length]!
  )
}
export const DiffSkeleton = () => (
  <div className="repo-diff-loading" role="status">
    <span className="repo-visually-hidden">Loading patch…</span>
    {skeletonRows(6).map((width, index) => (
      <div key={index} className="repo-diff-loading-row" aria-hidden="true">
        <Skeleton className="repo-diff-loading-number" />
        <Skeleton width={width} />
      </div>
    ))}
  </div>
)
