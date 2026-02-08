import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Bot } from './bot.js'

// Mock dependencies
vi.mock('./workspace.js', () => {
  return {
    Workspace: vi.fn().mockImplementation(() => ({
      profileName: 'clawbench-test',
      setup: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
    })),
  }
})

vi.mock('./gateway.js', () => {
  return {
    Gateway: vi.fn().mockImplementation(() => ({
      token: 'mock-token',
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    })),
  }
})

vi.mock('./agent-client.js', () => {
  return {
    AgentClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({
        text: 'hello',
        raw: {},
        duration: 100,
        ok: true,
      }),
    })),
  }
})

describe('Bot', () => {
  const runtime = {
    port: 18800,
    workspaceDir: '/tmp/test',
    anthropicApiKey: 'test-key',
    openaiApiKey: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('send() returns error before start()', async () => {
    const bot = new Bot('test', { preset: 'default' }, runtime)
    const result = await bot.send('hello')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Bot not started')
  })

  it('start() sets up workspace, gateway, and client', async () => {
    const bot = new Bot('test', { preset: 'default' }, runtime)
    await bot.start()

    // After start, send should work (via mocked client)
    const result = await bot.send('hello')
    expect(result.ok).toBe(true)
    expect(result.text).toBe('hello')
  })

  it('start() cleans up workspace if gateway throws', async () => {
    const { Gateway } = await import('./gateway.js')
    const { Workspace } = await import('./workspace.js')

    // Make gateway.start() fail
    vi.mocked(Gateway).mockImplementationOnce(() => ({
      token: 'mock-token',
      start: vi.fn().mockRejectedValue(new Error('spawn failed')),
      stop: vi.fn().mockResolvedValue(undefined),
    }) as any)

    const mockCleanup = vi.fn().mockResolvedValue(undefined)
    vi.mocked(Workspace).mockImplementationOnce(() => ({
      profileName: 'clawbench-test',
      setup: vi.fn().mockResolvedValue(undefined),
      cleanup: mockCleanup,
    }) as any)

    const bot = new Bot('test', { preset: 'default' }, runtime)
    await expect(bot.start()).rejects.toThrow('spawn failed')
    expect(mockCleanup).toHaveBeenCalled()
  })

  it('stop() does not throw if not started', async () => {
    const bot = new Bot('test', { preset: 'default' }, runtime)
    await bot.stop() // Should not throw
  })
})
