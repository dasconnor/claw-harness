import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Workspace } from './workspace.js'
import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), 'claw-harness-workspace-test')
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'

describe('Workspace', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
    // Clean up any test profile directories
    await rm(join(HOME, '.openclaw-claw-harness-test-ws'), { recursive: true, force: true }).catch(() => {})
    // Clean up default-location workspace dir
    await rm(join(HOME, '.openclaw', 'workspace-claw-harness-test-ws'), { recursive: true, force: true }).catch(() => {})
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

  it('writes AGENTS.md with auto-generated content when no agentsMd provided', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({}, runtime)

    const agentsMd = await readFile(join(ws.profileDir, 'workspace', 'AGENTS.md'), 'utf-8')
    expect(agentsMd).toContain('Claw Harness: Network Access')
    expect(agentsMd).toContain('Do not use `web_fetch` for localhost')
    expect(agentsMd).toContain('curl')
  })

  it('writes AGENTS.md with user content + auto-generated content when agentsMd provided', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({ agentsMd: 'Use API token abc123 for authentication.' }, runtime)

    const agentsMd = await readFile(join(ws.profileDir, 'workspace', 'AGENTS.md'), 'utf-8')
    expect(agentsMd).toContain('Use API token abc123 for authentication.')
    expect(agentsMd).toContain('Claw Harness: Network Access')
    // User content should come before auto-generated content
    const userIdx = agentsMd.indexOf('abc123')
    const autoIdx = agentsMd.indexOf('Claw Harness: Network Access')
    expect(userIdx).toBeLessThan(autoIdx)
  })

  it('local mode does not include browser config in openclaw.json', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({}, runtime)

    const configPath = join(ws.profileDir, 'openclaw.json')
    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config.browser).toBeUndefined()
  })

  it('openclaw.json includes agents.defaults.workspace pointing to workspace subdir', async () => {
    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({}, runtime)

    const configPath = join(ws.profileDir, 'openclaw.json')
    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config.agents.defaults.workspace).toBe(join(ws.profileDir, 'workspace'))
  })

  it('setup removes stale default-location workspace dir', async () => {
    const staleDir = join(HOME, '.openclaw', 'workspace-claw-harness-test-ws')
    await mkdir(staleDir, { recursive: true })
    await writeFile(join(staleDir, 'AGENTS.md'), 'stale data')

    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({}, runtime)

    await expect(access(staleDir)).rejects.toThrow()
  })

  it('installSkill fetches from URL and writes SKILL.md', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# My Remote Skill\nDo things.'),
    }))

    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({ skills: [{ url: 'https://example.com/skill.md', name: 'remote-skill' }] }, runtime)

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/skill.md',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    const skillContent = await readFile(join(ws.profileDir, 'workspace', 'skills', 'remote-skill', 'SKILL.md'), 'utf-8')
    expect(skillContent).toBe('# My Remote Skill\nDo things.')
  })

  it('cleanup removes the default-location workspace dir', async () => {
    const defaultDir = join(HOME, '.openclaw', 'workspace-claw-harness-test-ws')
    await mkdir(defaultDir, { recursive: true })
    await writeFile(join(defaultDir, 'AGENTS.md'), 'leftover data')

    const ws = new Workspace('test-ws', TEST_DIR)
    const runtime = { mode: 'local' as const, port: 18800, workspaceDir: TEST_DIR, anthropicApiKey: 'test', openaiApiKey: '' }
    await ws.setup({}, runtime)
    // Re-create to simulate OpenClaw writing to default location during a run
    await mkdir(defaultDir, { recursive: true })
    await writeFile(join(defaultDir, 'AGENTS.md'), 'runtime leftover')

    await ws.cleanup()

    await expect(access(defaultDir)).rejects.toThrow()
  })
})
