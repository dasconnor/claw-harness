import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { runScenario } from './runner.js'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), 'clawbench-runner-test')

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

  return {
    ClawBench: vi.fn().mockImplementation(() => ({
      bot: vi.fn().mockImplementation((id: string) => {
        const bot = { ...mockBot, id }
        mockBots.set(id, bot)
        return bot
      }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getBot: vi.fn().mockImplementation((id: string) => mockBots.get(id)),
      recordStep: vi.fn(),
      getResults: vi.fn().mockReturnValue({
        name: '',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 0,
        steps: [],
        bots: {},
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
    const { ClawBench } = await import('./bench.js')

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

    // Verify ClawBench was constructed and bot was registered
    const benchInstance = vi.mocked(ClawBench).mock.results[0]?.value
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
})
