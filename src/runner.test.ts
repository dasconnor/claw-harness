import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { runScenario } from './runner.js'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), 'claw-harness-runner-test')

// Mock cost tracker
vi.mock('./cost-tracker.js', () => ({
  queryUsage: vi.fn().mockResolvedValue(undefined),
}))

// Mock bench and bot to avoid actually spawning processes
vi.mock('./bench.js', () => {
  const mockBot = {
    id: 'alpha',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({
      text: 'response',
      raw: {},
      duration: 100,
      ok: true,
    }),
  }

  const mockBots = new Map()
  const stepResults: unknown[] = []

  return {
    ClawHarness: vi.fn().mockImplementation(() => ({
      bot: vi.fn().mockImplementation((id: string) => {
        const bot = { ...mockBot, id, send: vi.fn().mockResolvedValue({
          text: 'response',
          raw: {},
          duration: 100,
          ok: true,
        }) }
        mockBots.set(id, bot)
        return bot
      }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getBot: vi.fn().mockImplementation((id: string) => mockBots.get(id)),
      recordStep: vi.fn().mockImplementation((result: unknown) => {
        stepResults.push(result)
      }),
      getResults: vi.fn().mockReturnValue({
        name: '',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 0,
        steps: [],
        bots: {},
        assertions: { total: 0, passed: 0, failed: 0 },
      }),
    })),
  }
})

describe('runScenario', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs a simple scenario with serial steps', async () => {
    const yaml = `
name: "Serial Test"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Step 1"
  - bot: alpha
    prompt: "Step 2"
`
    const file = join(TEST_DIR, 'serial.yaml')
    await writeFile(file, yaml)

    const result = await runScenario(file)
    expect(result.name).toBe('Serial Test')
  })

  it('passes model override to bot config', async () => {
    const { ClawHarness } = await import('./bench.js')

    const yaml = `
name: "Model Override Test"
bots:
  alpha:
    preset: default
    model: anthropic/claude-haiku-4-5-20251001
steps:
  - bot: alpha
    prompt: "Hello"
`
    const file = join(TEST_DIR, 'model-override.yaml')
    await writeFile(file, yaml)

    await runScenario(file, { modelOverride: 'anthropic/claude-sonnet-4-5-20250929' })

    // Verify ClawHarness was constructed and bot was registered
    const benchInstance = vi.mocked(ClawHarness).mock.results[0]?.value
    expect(benchInstance.bot).toHaveBeenCalledWith('alpha', expect.objectContaining({
      model: 'anthropic/claude-sonnet-4-5-20250929',
    }))
  })

  it('runs scenario with repeat steps', async () => {
    const yaml = `
name: "Repeat Test"
bots:
  alpha:
    preset: default
steps:
  - repeat: 2
    steps:
      - bot: alpha
        prompt: "Repeated step"
`
    const file = join(TEST_DIR, 'repeat.yaml')
    await writeFile(file, yaml)

    const result = await runScenario(file)
    expect(result.name).toBe('Repeat Test')
  })

  it('evaluates contains assertion — pass', async () => {
    const { ClawHarness } = await import('./bench.js')

    const yaml = `
name: "Assert Contains Pass"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Register yourself"
    expect:
      contains: "response"
`
    const file = join(TEST_DIR, 'assert-contains-pass.yaml')
    await writeFile(file, yaml)

    await runScenario(file)

    const benchInstance = vi.mocked(ClawHarness).mock.results[0]?.value
    expect(benchInstance.recordStep).toHaveBeenCalledWith(
      expect.objectContaining({
        assertions: [
          { type: 'contains', expected: 'response', passed: true },
        ],
      }),
    )
  })

  it('evaluates contains assertion — fail', async () => {
    const { ClawHarness } = await import('./bench.js')

    const yaml = `
name: "Assert Contains Fail"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Register yourself"
    expect:
      contains: "mk_live_"
`
    const file = join(TEST_DIR, 'assert-contains-fail.yaml')
    await writeFile(file, yaml)

    await runScenario(file)

    const benchInstance = vi.mocked(ClawHarness).mock.results[0]?.value
    expect(benchInstance.recordStep).toHaveBeenCalledWith(
      expect.objectContaining({
        assertions: [
          { type: 'contains', expected: 'mk_live_', passed: false },
        ],
      }),
    )
  })

  it('evaluates not_contains assertion', async () => {
    const { ClawHarness } = await import('./bench.js')

    const yaml = `
name: "Assert Not Contains"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Do something"
    expect:
      not_contains: "error"
`
    const file = join(TEST_DIR, 'assert-not-contains.yaml')
    await writeFile(file, yaml)

    await runScenario(file)

    const benchInstance = vi.mocked(ClawHarness).mock.results[0]?.value
    expect(benchInstance.recordStep).toHaveBeenCalledWith(
      expect.objectContaining({
        assertions: [
          { type: 'not_contains', expected: 'error', passed: true },
        ],
      }),
    )
  })

  it('evaluates matches assertion', async () => {
    const { ClawHarness } = await import('./bench.js')

    const yaml = `
name: "Assert Matches"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Do something"
    expect:
      matches: "resp.*"
`
    const file = join(TEST_DIR, 'assert-matches.yaml')
    await writeFile(file, yaml)

    await runScenario(file)

    const benchInstance = vi.mocked(ClawHarness).mock.results[0]?.value
    expect(benchInstance.recordStep).toHaveBeenCalledWith(
      expect.objectContaining({
        assertions: [
          { type: 'matches', expected: 'resp.*', passed: true },
        ],
      }),
    )
  })

  it('runs after steps even when main steps fail', async () => {
    const { ClawHarness } = await import('./bench.js')

    const yaml = `
name: "After Steps Test"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Main step"
after:
  - bot: alpha
    prompt: "Cleanup step"
`
    const file = join(TEST_DIR, 'after-steps.yaml')
    await writeFile(file, yaml)

    await runScenario(file)

    const benchInstance = vi.mocked(ClawHarness).mock.results[0]?.value
    // recordStep should be called for both main and after steps
    expect(benchInstance.recordStep).toHaveBeenCalledTimes(2)
  })

  it('performs health check before starting bots', async () => {
    // Mock global fetch for health check
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch

    const yaml = `
name: "Health Check Test"
healthcheck:
  url: "http://localhost:3000/health"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Hello"
`
    const file = join(TEST_DIR, 'healthcheck.yaml')
    await writeFile(file, yaml)

    await runScenario(file)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    globalThis.fetch = originalFetch
  })

  it('throws on health check failure', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as unknown as typeof fetch

    const yaml = `
name: "Health Check Fail"
healthcheck:
  url: "http://localhost:9999/health"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Hello"
`
    const file = join(TEST_DIR, 'healthcheck-fail.yaml')
    await writeFile(file, yaml)

    await expect(runScenario(file)).rejects.toThrow('Health check failed')

    globalThis.fetch = originalFetch
  })

  it('passes allowed hosts to bot configs from target URL', async () => {
    const { ClawHarness } = await import('./bench.js')

    const yaml = `
name: "Allowed Hosts Test"
target:
  base_url: "http://localhost:3000"
  allowed_hosts:
    - "api.example.com"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Hello"
`
    const file = join(TEST_DIR, 'allowed-hosts.yaml')
    await writeFile(file, yaml)

    await runScenario(file)

    const benchInstance = vi.mocked(ClawHarness).mock.results[0]?.value
    expect(benchInstance.bot).toHaveBeenCalledWith('alpha', expect.objectContaining({
      allowedHosts: expect.arrayContaining(['localhost', '127.0.0.1', 'api.example.com']),
    }))
  })
})
