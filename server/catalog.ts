import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ICatalogItem, IInteractionCatalog } from './types.ts'

export const MAX_TRAVERSAL_DEPTH = 25
export const MAX_CATALOG_FILE_BYTES = 65536 // 64 KiB limit
export const MAX_CATALOG_ITEMS = 50

const COMMAND_ID_REGEX = /^[a-zA-Z0-9_-]+$/
const ALLOWED_ITEM_MODES = new Set(['agent', 'shell', 'both'])

export interface ICatalogValidationResult {
  valid: boolean
  error?: string
  items?: ICatalogItem[]
}

export const validateCatalogSchema = (data: unknown): ICatalogValidationResult => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Catalog content must be a JSON object' }
  }

  const obj = data as Record<string, unknown>
  if (obj.version !== 1) {
    return { valid: false, error: `Unsupported catalog version: expected 1, got ${JSON.stringify(obj.version)}` }
  }

  if (!Array.isArray(obj.items)) {
    return { valid: false, error: 'Catalog "items" must be an array' }
  }

  if (obj.items.length > MAX_CATALOG_ITEMS) {
    return { valid: false, error: `Catalog exceeds maximum allowed items (${MAX_CATALOG_ITEMS})` }
  }

  const validatedItems: ICatalogItem[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < obj.items.length; i++) {
    const rawItem = obj.items[i]
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      return { valid: false, error: `Catalog item at index ${i} must be an object` }
    }

    const item = rawItem as Record<string, unknown>

    if (typeof item.id !== 'string' || !COMMAND_ID_REGEX.test(item.id.trim()) || item.id.length > 64) {
      return { valid: false, error: `Catalog item at index ${i} has invalid "id"` }
    }
    const id = item.id.trim()
    if (seenIds.has(id)) {
      return { valid: false, error: `Duplicate command ID "${id}" in catalog` }
    }
    seenIds.add(id)

    if (typeof item.label !== 'string' || item.label.trim().length === 0 || item.label.length > 100) {
      return { valid: false, error: `Catalog item at index ${i} has invalid "label"` }
    }
    const label = item.label.trim()

    if (typeof item.fillValue !== 'string' || item.fillValue.trim().length === 0 || item.fillValue.length > 1000) {
      return { valid: false, error: `Catalog item at index ${i} has invalid "fillValue"` }
    }
    const fillValue = item.fillValue

    let description: string | undefined
    if (item.description !== undefined) {
      if (typeof item.description !== 'string' || item.description.length > 250) {
        return { valid: false, error: `Catalog item at index ${i} has invalid "description"` }
      }
      description = item.description.trim()
    }

    let category: string | undefined
    if (item.category !== undefined) {
      if (typeof item.category !== 'string' || item.category.length > 50) {
        return { valid: false, error: `Catalog item at index ${i} has invalid "category"` }
      }
      category = item.category.trim()
    }

    let mode: 'agent' | 'shell' | 'both' | undefined
    if (item.mode !== undefined) {
      if (typeof item.mode !== 'string' || !ALLOWED_ITEM_MODES.has(item.mode)) {
        return { valid: false, error: `Catalog item at index ${i} has invalid "mode"` }
      }
      mode = item.mode as 'agent' | 'shell' | 'both'
    }

    validatedItems.push({
      id,
      label,
      fillValue,
      ...(description !== undefined ? { description } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(mode !== undefined ? { mode } : {})
    })
  }

  return {
    valid: true,
    items: validatedItems
  }
}

export type CatalogResolutionResult =
  | { kind: 'found'; catalog: IInteractionCatalog }
  | { kind: 'missing'; catalog: IInteractionCatalog }
  | { kind: 'invalid'; error: string }

export const resolveNearestRepoCatalog = (startDir: string): CatalogResolutionResult => {
  if (!startDir || typeof startDir !== 'string') {
    return {
      kind: 'missing',
      catalog: { source: 'repo-config', version: 1, items: [] }
    }
  }

  // Canonicalize start directory with realpath before discovering Git boundary; never read through a lexical symlink path
  let resolvedStart: string
  try {
    resolvedStart = fs.realpathSync(startDir)
  } catch {
    return {
      kind: 'missing',
      catalog: { source: 'repo-config', version: 1, items: [] }
    }
  }

  try {
    const startStat = fs.statSync(resolvedStart)
    if (!startStat.isDirectory()) {
      resolvedStart = path.dirname(resolvedStart)
    }
  } catch {
    return {
      kind: 'missing',
      catalog: { source: 'repo-config', version: 1, items: [] }
    }
  }

  // 1. Find nearest ancestor containing .git (file or directory) to establish repo boundary
  let currentGitCheck = resolvedStart
  let gitRoot: string | null = null
  let gitDepth = 0

  while (gitDepth < MAX_TRAVERSAL_DEPTH) {
    const gitPath = path.join(currentGitCheck, '.git')
    try {
      if (fs.existsSync(gitPath)) {
        gitRoot = currentGitCheck
        break
      }
    } catch {
      break
    }

    const parent = path.dirname(currentGitCheck)
    if (parent === currentGitCheck) {
      break
    }
    currentGitCheck = parent
    gitDepth++
  }

  // If no .git boundary exists, check only the exact start cwd; never drift into a parent/global config
  const boundaryDir = gitRoot ?? resolvedStart

  // 2. Search from startDir upward through and including boundaryDir
  let currentDir = resolvedStart
  let depth = 0

  while (depth < MAX_TRAVERSAL_DEPTH) {
    const candidateDotHerdr = path.join(currentDir, '.herdr')
    const candidateFile = path.join(candidateDotHerdr, 'commands.json')

    let dotHerdrExists = false
    try {
      dotHerdrExists = fs.existsSync(candidateDotHerdr)
    } catch {
      return { kind: 'invalid', error: 'Directory .herdr is inaccessible or unreadable' }
    }

    if (dotHerdrExists) {
      try {
        const dirStat = fs.lstatSync(candidateDotHerdr)
        if (dirStat.isSymbolicLink()) {
          return { kind: 'invalid', error: 'Directory .herdr is a symbolic link' }
        }
        if (!dirStat.isDirectory()) {
          return { kind: 'invalid', error: '.herdr is not a directory' }
        }
      } catch {
        return { kind: 'invalid', error: 'Failed to inspect .herdr directory' }
      }

      let fileExists = false
      try {
        fileExists = fs.existsSync(candidateFile)
      } catch {
        return { kind: 'invalid', error: 'Catalog file commands.json is inaccessible or unreadable' }
      }

      if (fileExists) {
        let fileStat: fs.Stats
        try {
          fileStat = fs.lstatSync(candidateFile)
        } catch {
          return { kind: 'invalid', error: 'Failed to inspect commands.json' }
        }

        if (fileStat.isSymbolicLink()) {
          return { kind: 'invalid', error: 'Catalog file commands.json is a symbolic link' }
        }
        if (!fileStat.isFile()) {
          return { kind: 'invalid', error: 'Catalog file commands.json is not a regular file' }
        }

        if (fileStat.size > MAX_CATALOG_FILE_BYTES) {
          return { kind: 'invalid', error: `Catalog file exceeds maximum size (${MAX_CATALOG_FILE_BYTES / 1024} KiB)` }
        }

        let raw: string
        try {
          raw = fs.readFileSync(candidateFile, 'utf8')
        } catch {
          return { kind: 'invalid', error: 'Catalog file commands.json could not be read' }
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          return { kind: 'invalid', error: 'Catalog file commands.json contains invalid JSON' }
        }

        const validation = validateCatalogSchema(parsed)
        if (!validation.valid || !validation.items) {
          return { kind: 'invalid', error: `Catalog schema validation failed: ${validation.error ?? 'unknown error'}` }
        }

        return {
          kind: 'found',
          catalog: {
            source: 'repo-config',
            version: 1,
            items: validation.items
          }
        }
      }
    }

    if (currentDir === boundaryDir) {
      break
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      break
    }
    currentDir = parentDir
    depth++
  }

  // Missing config within boundary is a valid empty catalog
  return {
    kind: 'missing',
    catalog: {
      source: 'repo-config',
      version: 1,
      items: []
    }
  }
}
