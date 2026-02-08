import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClawHarness } from './bench.js'

// Mock Bot to avoid spawning real processes
vi.mock('./bot.js', () => {
  return {
    Bot: vi.fn().mockImplementation((id: string) => ({
      id,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({
        text: 'response',
        raw: {},
        duration: 100,
        ok: true,
      }),
    })),
  }
})

describe('ClawHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers bots with incremental port allocation', async () => {
    const bench = new ClawHarness({ mode: 'local', basePort: 10000 })

    bench.bot('alpha', { preset: 'default' })
    bench.bot('beta', { preset: 'default' })

    const { Bot } = vi.mocked(await import('./bot.js'))

    // First bot gets port 10000, second gets 10020
    expect(Bot).toHaveBeenCalledWith('alpha', expect.anything(), expect.objectContaining({ port: 10000 }))
    expect(Bot).toHaveBeenCalledWith('beta', expect.anything(), expect.objectContaining({ port: 10020 }))
  })

  it('getBot returns registered bot', () => {
    const bench = new ClawHarness({ mode: 'local' })
    bench.bot('alpha', { preset: 'default' })

    expect(bench.getBot('alpha')).toBeDefined()
    expect(bench.getBot('nonexistent')).toBeUndefined()
  })

  it('start() calls start on all bots sequentially', async () => {
    const bench = new ClawHarness({ mode: 'local' })
    bench.bot('alpha', { preset: 'default' })
    bench.bot('beta', { preset: 'default' })

    await bench.start()

    const alpha = bench.getBot('alpha')
    const beta = bench.getBot('beta')
    expect(alpha!.start).toHaveBeenCalled()
    expect(beta!.start).toHaveBeenCalled()
  })

  it('start() cleans up started bots if one fails', async () => {
    const bench = new ClawHarness({ mode: 'local' })
    const alpha = bench.bot('alpha', { preset: 'default' })
    const beta = bench.bot('beta', { preset: 'default' })

    // Make beta.start() fail
    vi.mocked(beta.start).mockRejectedValueOnce(new Error('gateway failed'))

    await expect(bench.start()).rejects.toThrow('gateway failed')

    // Alpha should have been stopped for cleanup
    expect(alpha.stop).toHaveBeenCalled()
  })

  it('recordStep and getResults work correctly', () => {
    const bench = new ClawHarness({ mode: 'local' })
    bench.bot('alpha', { preset: 'default' })

    bench.recordStep({
      botId: 'alpha',
      prompt: 'Hello',
      response: { text: 'Hi', raw: {}, duration: 50, ok: true },
      timestamp: new Date().toISOString(),
    })

    bench.recordStep({
      botId: 'alpha',
      prompt: 'Bye',
      response: { text: '', raw: null, duration: 100, ok: false, error: 'timeout' },
      timestamp: new Date().toISOString(),
    })

    const results = bench.getResults()
    expect(results.steps).toHaveLength(2)
    expect(results.bots.alpha.messagesSent).toBe(2)
    expect(results.bots.alpha.errors).toBe(1)
    expect(results.bots.alpha.totalDuration).toBe(150)
  })

  it('getConversationLog returns a copy', () => {
    const bench = new ClawHarness({ mode: 'local' })
    bench.bot('alpha', { preset: 'default' })

    bench.recordStep({
      botId: 'alpha',
      prompt: 'Hello',
      response: { text: 'Hi', raw: {}, duration: 50, ok: true },
      timestamp: new Date().toISOString(),
    })

    const log = bench.getConversationLog()
    expect(log).toHaveLength(1)
    // Modifying the copy should not affect internal state
    log.pop()
    expect(bench.getConversationLog()).toHaveLength(1)
  })
})
