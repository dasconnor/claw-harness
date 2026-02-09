import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentClient } from './agent-client.js'

describe('AgentClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends a prompt and returns successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Hello back!' } }],
      }),
    })

    const client = new AgentClient(18800, 'test-token')
    const result = await client.send('Hello', 'session-1')

    expect(result.ok).toBe(true)
    expect(result.text).toBe('Hello back!')
    expect(result.duration).toBeGreaterThanOrEqual(0)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://127.0.0.1:18800/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
        }),
      }),
    )
  })

  it('handles HTTP error responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    })

    const client = new AgentClient(18800, 'test-token')
    const result = await client.send('Hello', 'session-1')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('HTTP 500')
    expect(result.error).toContain('Internal Server Error')
  })

  it('handles network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

    const client = new AgentClient(18800, 'test-token')
    const result = await client.send('Hello', 'session-1')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Network error')
  })

  it('sends session ID in the user field for multi-turn threading', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'reply' } }],
      }),
    })

    const client = new AgentClient(18800, 'test-token')
    await client.send('First message', 'session-abc')
    await client.send('Second message', 'session-abc')

    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(2)

    // Both calls should include the same session ID in the request body
    for (const [, init] of calls) {
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body.user).toBe('session-abc')
    }
  })

  it('handles missing choices in response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })

    const client = new AgentClient(18800, 'test-token')
    const result = await client.send('Hello', 'session-1')

    expect(result.ok).toBe(true)
    expect(result.text).toBe('')
  })
})
