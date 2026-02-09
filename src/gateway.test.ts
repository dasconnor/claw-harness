import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Gateway } from './gateway.js'
import { createMockChildProcess } from './test-helpers.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

describe('Gateway', () => {
  it('creates with correct properties', () => {
    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    expect(gw.token).toBe('')
  })

  it('token getter/setter works', () => {
    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    gw.token = 'test-token'
    expect(gw.token).toBe('test-token')
  })

  it('stop() does nothing if process not started', async () => {
    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    // Should not throw
    await gw.stop()
  })

  it('polls OPTIONS until gateway is ready', async () => {
    vi.useFakeTimers()

    const mockProc = createMockChildProcess()
    const { spawn } = await import('node:child_process')
    vi.mocked(spawn).mockReturnValue(mockProc as any)

    // Mock readFile for config reading
    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockResolvedValue(JSON.stringify({
        gateway: { auth: { token: 'test-token-123' } },
      })),
    }))

    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    const startPromise = gw.start({ anthropicApiKey: 'key', openaiApiKey: '' })

    // Advance past two polling intervals (500ms each)
    await vi.advanceTimersByTimeAsync(600)
    await vi.advanceTimersByTimeAsync(600)

    await startPromise

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(gw.token).toBe('test-token-123')

    vi.useRealTimers()
    vi.doUnmock('node:fs/promises')
  })

  it('throws after waitForReady timeout', async () => {
    vi.useFakeTimers()

    const mockProc = createMockChildProcess()
    const { spawn } = await import('node:child_process')
    vi.mocked(spawn).mockReturnValue(mockProc as any)

    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockResolvedValue('{}'),
    }))

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    const startPromise = gw.start({ anthropicApiKey: 'key', openaiApiKey: '' })

    // Catch rejection eagerly to prevent unhandled rejection warning
    const rejectPromise = expect(startPromise).rejects.toThrow('did not become ready')

    // Advance past the 30s timeout
    await vi.advanceTimersByTimeAsync(31_000)

    await rejectPromise

    vi.useRealTimers()
    vi.doUnmock('node:fs/promises')
  })

  it('detects early process exit', async () => {
    vi.useFakeTimers()

    const mockProc = createMockChildProcess()
    const { spawn } = await import('node:child_process')
    // When spawn is called, schedule exit emission after a tick
    vi.mocked(spawn).mockImplementation((() => {
      setTimeout(() => mockProc.emit('exit', 1), 10)
      return mockProc
    }) as any)

    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockResolvedValue('{}'),
    }))

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    const startPromise = gw.start({ anthropicApiKey: 'key', openaiApiKey: '' })

    // Catch rejection eagerly to prevent unhandled rejection warning
    const rejectPromise = expect(startPromise).rejects.toThrow('exited with code 1')

    // Advance past the scheduled exit (10ms) and one polling interval (500ms)
    await vi.advanceTimersByTimeAsync(600)

    await rejectPromise

    vi.useRealTimers()
    vi.doUnmock('node:fs/promises')
  })
})
