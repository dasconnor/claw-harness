import { describe, it, expect } from 'vitest'
import { deepMerge, parseDuration, getPackageRoot } from './utils.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

describe('deepMerge', () => {
  it('merges flat objects', () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it('merges nested objects', () => {
    const target = { gateway: { port: 8080, auth: { token: 'old' } } }
    const source = { gateway: { auth: { token: 'new' } } }
    expect(deepMerge(target, source)).toEqual({
      gateway: { port: 8080, auth: { token: 'new' } },
    })
  })

  it('replaces arrays instead of concatenating', () => {
    const target = { list: [1, 2, 3] }
    const source = { list: [4, 5] }
    expect(deepMerge(target, source)).toEqual({ list: [4, 5] })
  })

  it('skips undefined values in source', () => {
    const target = { a: 1, b: 2 }
    const source = { a: undefined, b: 3 }
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 3 })
  })

  it('does not mutate the target', () => {
    const target = { a: 1, nested: { b: 2 } }
    const original = { a: 1, nested: { b: 2 } }
    deepMerge(target, { a: 99 })
    expect(target).toEqual(original)
  })
})

describe('parseDuration', () => {
  it('parses milliseconds', () => {
    expect(parseDuration('500ms')).toBe(500)
  })

  it('parses seconds', () => {
    expect(parseDuration('30s')).toBe(30_000)
  })

  it('parses minutes', () => {
    expect(parseDuration('2m')).toBe(120_000)
  })

  it('returns 60000 for invalid input', () => {
    expect(parseDuration('invalid')).toBe(60_000)
    expect(parseDuration('')).toBe(60_000)
    expect(parseDuration('10x')).toBe(60_000)
  })
})

describe('getPackageRoot', () => {
  it('returns a path containing package.json', async () => {
    const root = await getPackageRoot()
    expect(existsSync(join(root, 'package.json'))).toBe(true)
  })
})
