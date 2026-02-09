/**
 * Integration tests — exercise the real claw-harness framework end-to-end.
 *
 * Only two things are mocked:
 *   1. node:child_process.spawn  (avoids requiring the openclaw binary)
 *   2. globalThis.fetch          (avoids real HTTP traffic)
 *
 * Everything else runs for real: YAML loading, scenario validation,
 * workspace setup (real FS), config generation, assertion evaluation,
 * result aggregation, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { runScenario } from './runner.js'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMockChildProcess } from './test-helpers.js'

// Mock spawn so Gateway doesn't try to run the real openclaw binary
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const TEST_ROOT = join(tmpdir(), `claw-harness-integ-${process.pid}`)
const SCENARIOS_DIR = join(TEST_ROOT, 'scenarios')
const FAKE_HOME = join(TEST_ROOT, 'home')

describe('runScenario (integration)', () => {
  beforeAll(async () => {
    await mkdir(SCENARIOS_DIR, { recursive: true })
    await mkdir(FAKE_HOME, { recursive: true })
  })

  afterAll(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  beforeEach(async () => {
    // Redirect HOME so workspace files go to a temp dir, not the real home
    vi.stubEnv('HOME', FAKE_HOME)
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ANTHROPIC_ADMIN_API_KEY', '')

    // Each spawn() call returns a fresh mock process that exits cleanly on kill
    const { spawn } = await import('node:child_process')
    vi.mocked(spawn).mockImplementation((() => {
      const proc = createMockChildProcess()
      ;(proc as any).kill = vi.fn(() => {
        process.nextTick(() => proc.emit('exit', 0))
        ;(proc as any).killed = true
        return true
      })
      return proc
    }) as any)
  })

  /** Write a YAML scenario file and return its path. */
  async function writeScenario(name: string, lines: string[]): Promise<string> {
    const path = join(SCENARIOS_DIR, `${name}.yaml`)
    await writeFile(path, lines.join('\n'))
    return path
  }

  /** Stub fetch to return a fixed chat-completion response for every POST. */
  function stubFetch(responseText: string) {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      // OPTIONS = gateway health check
      if (init?.method === 'OPTIONS') return { ok: true }
      // POST = agent chat completion
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: responseText } }],
        }),
      }
    }))
  }

  // ─── Core Scenario Execution ──────────────────────────────────────────

  it('executes a single-bot scenario end-to-end', async () => {
    stubFetch('Hello from the bot!')

    const path = await writeScenario('simple', [
      'name: Simple Test',
      'bots:',
      '  alpha:',
      '    preset: default',
      'steps:',
      '  - bot: alpha',
      '    prompt: Say hello',
    ])

    const result = await runScenario(path, {
      configOverrides: { basePort: 29000 },
    })

    expect(result.name).toBe('Simple Test')
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].botId).toBe('alpha')
    expect(result.steps[0].prompt).toBe('Say hello')
    expect(result.steps[0].response.text).toBe('Hello from the bot!')
    expect(result.steps[0].response.ok).toBe(true)
    expect(result.bots.alpha).toEqual({
      messagesSent: 1,
      totalDuration: expect.any(Number),
      errors: 0,
    })

    // The gateway was spawned with the correct binary and port
    const { spawn } = await import('node:child_process')
    expect(spawn).toHaveBeenCalledWith(
      'openclaw',
      expect.arrayContaining(['gateway', '--port', '29000']),
      expect.objectContaining({
        env: expect.objectContaining({ ANTHROPIC_API_KEY: 'test-key' }),
      }),
    )
  })

  it('handles multi-step conversations', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'OPTIONS') return { ok: true }
      callCount++
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: `Reply ${callCount}` } }],
        }),
      }
    }))

    const path = await writeScenario('multi-step', [
      'name: Multi-Step',
      'bots:',
      '  alpha:',
      '    preset: default',
      'steps:',
      '  - bot: alpha',
      '    prompt: First',
      '  - bot: alpha',
      '    prompt: Second',
      '  - bot: alpha',
      '    prompt: Third',
    ])

    const result = await runScenario(path, {
      configOverrides: { basePort: 29020 },
    })

    expect(result.steps).toHaveLength(3)
    expect(result.steps.map(s => s.response.text)).toEqual([
      'Reply 1', 'Reply 2', 'Reply 3',
    ])
    expect(result.bots.alpha.messagesSent).toBe(3)
  })

  // ─── Assertion Evaluation ─────────────────────────────────────────────

  it('evaluates passing assertions through the full pipeline', async () => {
    stubFetch('The answer is 42')

    const path = await writeScenario('pass-assertions', [
      'name: Passing Assertions',
      'bots:',
      '  alpha:',
      '    preset: default',
      'steps:',
      '  - bot: alpha',
      '    prompt: What is the answer?',
      '    expect:',
      '      contains: "42"',
      '      not_contains: error',
      '      matches: "[0-9]+"',
    ])

    const result = await runScenario(path, {
      configOverrides: { basePort: 29040 },
    })

    expect(result.assertions).toEqual({ total: 3, passed: 3, failed: 0 })
    for (const a of result.steps[0].assertions!) {
      expect(a.passed).toBe(true)
    }
  })

  it('records failed assertions without crashing', async () => {
    stubFetch('Something unexpected')

    const path = await writeScenario('fail-assertions', [
      'name: Failing Assertions',
      'bots:',
      '  alpha:',
      '    preset: default',
      'steps:',
      '  - bot: alpha',
      '    prompt: Say hello',
      '    expect:',
      '      contains: hello',
    ])

    const result = await runScenario(path, {
      configOverrides: { basePort: 29060 },
    })

    expect(result.assertions).toEqual({ total: 1, passed: 0, failed: 1 })
    expect(result.steps[0].assertions![0]).toEqual({
      type: 'contains',
      expected: 'hello',
      passed: false,
    })
  })

  // ─── Multi-Bot & Port Allocation ─────────────────────────────────────

  it('assigns separate ports and workspaces per bot', async () => {
    stubFetch('response')

    const path = await writeScenario('multi-bot', [
      'name: Multi-Bot',
      'bots:',
      '  alpha:',
      '    preset: default',
      '  beta:',
      '    preset: default',
      'steps:',
      '  - bot: alpha',
      '    prompt: From alpha',
      '  - bot: beta',
      '    prompt: From beta',
    ])

    const result = await runScenario(path, {
      configOverrides: { basePort: 29080 },
    })

    expect(Object.keys(result.bots)).toEqual(['alpha', 'beta'])
    expect(result.bots.alpha.messagesSent).toBe(1)
    expect(result.bots.beta.messagesSent).toBe(1)

    // Each bot got its own gateway: basePort + index * 20
    const { spawn } = await import('node:child_process')
    expect(spawn).toHaveBeenCalledTimes(2)
    const portArgs = vi.mocked(spawn).mock.calls.map(
      c => c[1][c[1].indexOf('--port') + 1],
    )
    expect(portArgs).toContain('29080')
    expect(portArgs).toContain('29100')
  })

  // ─── Cleanup (after:) Steps ───────────────────────────────────────────

  it('runs after: cleanup steps', async () => {
    const sentPrompts: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'OPTIONS') return { ok: true }
      if (init?.method === 'POST' && init.body) {
        const body = JSON.parse(init.body as string)
        sentPrompts.push(body.messages?.[0]?.content ?? '')
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      }
    }))

    const path = await writeScenario('with-after', [
      'name: After Steps',
      'bots:',
      '  alpha:',
      '    preset: default',
      'steps:',
      '  - bot: alpha',
      '    prompt: Main task',
      'after:',
      '  - bot: alpha',
      '    prompt: Cleanup task',
    ])

    const result = await runScenario(path, {
      configOverrides: { basePort: 29120 },
    })

    // Both main and cleanup steps are recorded in results
    expect(result.steps).toHaveLength(2)
    // The actual prompts were sent through the real framework
    expect(sentPrompts).toContain('Main task')
    expect(sentPrompts).toContain('Cleanup task')
  })

  // ─── Workspace & Config Wiring ────────────────────────────────────────

  it('wires workspace config so gateway reads the correct token', async () => {
    // Track the Authorization header sent by AgentClient
    let authHeader = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'OPTIONS') return { ok: true }
      authHeader = (init?.headers as Record<string, string>)?.['Authorization'] ?? ''
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      }
    }))

    const path = await writeScenario('token-wiring', [
      'name: Token Wiring',
      'bots:',
      '  alpha:',
      '    preset: default',
      'steps:',
      '  - bot: alpha',
      '    prompt: Test',
    ])

    await runScenario(path, {
      configOverrides: { basePort: 29140 },
    })

    // The auth header should contain a real token that was:
    // 1. Generated by Workspace.buildConfig()
    // 2. Written to openclaw.json on disk
    // 3. Read back by Gateway.start() from the real filesystem
    // 4. Passed to AgentClient which included it in the request
    expect(authHeader).toMatch(/^Bearer claw-harness-\d+-[a-z0-9]+$/)
  })
})
