import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Workspace } from './workspace.js'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), 'claw-harness-workspace-test')

describe('Workspace', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
    // Clean up any test profile directories
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'
    await rm(join(home, '.openclaw-claw-harness-test-ws'), { recursive: true, force: true }).catch(() => {})
  })

  it('resolveContent returns inline content for strings with newlines', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const result = await ws.resolveContent('line one\nline two')
    expect(result).toBe('line one\nline two')
  })

  it('resolveContent returns inline content for strings without file extension', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const result = await ws.resolveContent('You are a friendly bot')
    expect(result).toBe('You are a friendly bot')
  })

  it('resolveContent reads file content for valid paths', async () => {
    const testFile = join(TEST_DIR, 'test-persona.md')
    await writeFile(testFile, 'I am a test persona')

    const ws = new Workspace('test-ws', TEST_DIR)
    const result = await ws.resolveContent(testFile)
    expect(result).toBe('I am a test persona')
  })

  it('resolveContent falls back to inline for missing file paths', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const result = await ws.resolveContent('/nonexistent/file.md')
    expect(result).toBe('/nonexistent/file.md')
  })

  it('installSkill throws for skill with no url or path', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({ skills: [{}] }, runtime).catch(err => {
      expect(err.message).toBe('Skill must have either url or path')
    })
  })

  it('profileDir getter returns the profile directory path', () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'
    expect(ws.profileDir).toBe(join(home, '.openclaw-claw-harness-test-ws'))
  })

  it('docker mode includes browser config in openclaw.json', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'docker' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({}, runtime)

    const configPath = join(ws.profileDir, 'openclaw.json')
    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config.browser).toEqual({ enabled: true, headless: true, noSandbox: true })
  })

  it('local mode does not include browser config in openclaw.json', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({}, runtime)

    const configPath = join(ws.profileDir, 'openclaw.json')
    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config.browser).toBeUndefined()
  })
})
