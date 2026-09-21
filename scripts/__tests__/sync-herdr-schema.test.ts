import { describe, expect, it } from 'bun:test'
import { schemasSemanticallyEqual } from '../sync-herdr-schema.ts'

describe('schemasSemanticallyEqual', () => {
  it('ignores object key order but compares the complete schema body', () => {
    const tracked = { protocol: 22, schema_version: 1, methods: { ping: { result: 'pong' } } }
    const reordered = { methods: { ping: { result: 'pong' } }, schema_version: 1, protocol: 22 }
    const changedBody = { protocol: 22, schema_version: 1, methods: { ping: { result: 'changed' } } }

    expect(schemasSemanticallyEqual(tracked, reordered)).toBe(true)
    expect(schemasSemanticallyEqual(tracked, changedBody)).toBe(false)
  })
})
