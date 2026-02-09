import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { deepMerge, parseDuration, getPackageRoot, loadEnvFiles } from './utils.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

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

  it('replaces object with null', () => {
    expect(deepMerge({ a: { nested: true } }, { a: null } as any)).toEqual({ a: null })
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

describe('loadEnvFiles', () => {
  const TEST_DIR = join(tmpdir(), 'claw-harness-env-test')

  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CH_TEST_')) delete process.env[key]
    }
  })

  it('parses KEY=value pairs, skipping comments and blank lines', async () => {
    await writeFile(join(TEST_DIR, '.env'), [
      '# this is a comment',
      '',
      'CH_TEST_FOO=bar',
      '',
      'CH_TEST_BAZ=qux=extra',
    ].join('\n'))

    await loadEnvFiles(TEST_DIR)

    expect(process.env.CH_TEST_FOO).toBe('bar')
    expect(process.env.CH_TEST_BAZ).toBe('qux=extra')
  })

  it('strips quotes from values', async () => {
    await writeFile(join(TEST_DIR, '.env'), [
      'CH_TEST_SINGLE=\'single-val\'',
      'CH_TEST_DOUBLE="double-val"',
    ].join('\n'))

    await loadEnvFiles(TEST_DIR)

    expect(process.env.CH_TEST_SINGLE).toBe('single-val')
    expect(process.env.CH_TEST_DOUBLE).toBe('double-val')
  })

  it('does not override existing env vars and skips missing files', async () => {
    vi.stubEnv('CH_TEST_EXISTING', 'original')

    await writeFile(join(TEST_DIR, '.env'), [
      'CH_TEST_EXISTING=overridden',
      'CH_TEST_NEW=fresh',
    ].join('\n'))

    // Pass both a real dir and a nonexistent dir — should not throw
    await loadEnvFiles(TEST_DIR, '/nonexistent/path')

    expect(process.env.CH_TEST_EXISTING).toBe('original')
    expect(process.env.CH_TEST_NEW).toBe('fresh')
  })
})
