import { describe, it, expect, vi, afterEach } from 'vitest'
import { queryUsage } from './cost-tracker.js'

describe('queryUsage', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('parses usage response and calculates cost', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { model: 'claude-haiku-4-5', input_tokens: 10000, output_tokens: 2000 },
          { model: 'claude-haiku-4-5', input_tokens: 5000, output_tokens: 1000 },
        ],
      }),
    }) as unknown as typeof fetch

    const result = await queryUsage(
      'test-admin-key',
      '2026-02-01T00:00:00Z',
      '2026-02-01T01:00:00Z',
    )

    expect(result).toBeDefined()
    expect(result!.inputTokens).toBe(15000)
    expect(result!.outputTokens).toBe(3000)
    // haiku: 15k/1M * $1.0 + 3k/1M * $5.0 = $0.015 + $0.015 = $0.03
    expect(result!.estimatedCost).toBeCloseTo(0.03, 4)
    expect(result!.models['claude-haiku-4-5']).toBeDefined()
    expect(result!.models['claude-haiku-4-5'].inputTokens).toBe(15000)
    expect(result!.models['claude-haiku-4-5'].outputTokens).toBe(3000)
  })

  it('aggregates multiple models', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { model: 'claude-haiku-4-5', input_tokens: 10000, output_tokens: 2000 },
          { model: 'claude-sonnet-4-5', input_tokens: 5000, output_tokens: 1000 },
        ],
      }),
    }) as unknown as typeof fetch

    const result = await queryUsage(
      'test-admin-key',
      '2026-02-01T00:00:00Z',
      '2026-02-01T01:00:00Z',
    )

    expect(result).toBeDefined()
    expect(Object.keys(result!.models)).toHaveLength(2)
    expect(result!.models['claude-haiku-4-5']).toBeDefined()
    expect(result!.models['claude-sonnet-4-5']).toBeDefined()
  })

  it('returns undefined on API error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as unknown as typeof fetch

    const result = await queryUsage(
      'bad-key',
      '2026-02-01T00:00:00Z',
      '2026-02-01T01:00:00Z',
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined for empty data', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    }) as unknown as typeof fetch

    const result = await queryUsage(
      'test-admin-key',
      '2026-02-01T00:00:00Z',
      '2026-02-01T01:00:00Z',
    )

    expect(result).toBeUndefined()
  })

  it('uses default pricing for unknown models', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { model: 'some-future-model', input_tokens: 1000000, output_tokens: 100000 },
        ],
      }),
    }) as unknown as typeof fetch

    const result = await queryUsage(
      'test-admin-key',
      '2026-02-01T00:00:00Z',
      '2026-02-01T01:00:00Z',
    )

    expect(result).toBeDefined()
    // Default pricing: 1M/1M * $3.0 + 100k/1M * $15.0 = $3.0 + $1.5 = $4.5
    expect(result!.estimatedCost).toBeCloseTo(4.5, 4)
  })
})
