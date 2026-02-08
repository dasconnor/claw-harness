/**
 * Cost Tracker — Queries Anthropic Admin API for usage data.
 */

import type { CostReport } from './types.js'

/** Price per million tokens (USD) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':               { input: 5.0,  output: 25.0 },
  'claude-opus-4-0-20250514':      { input: 5.0,  output: 25.0 },
  'claude-sonnet-4-5':             { input: 3.0,  output: 15.0 },
  'claude-sonnet-4-5-20250929':    { input: 3.0,  output: 15.0 },
  'claude-haiku-4-5':              { input: 1.0,  output: 5.0  },
  'claude-haiku-4-5-20251001':     { input: 1.0,  output: 5.0  },
  'claude-3-5-sonnet-20241022':    { input: 3.0,  output: 15.0 },
  'claude-3-5-haiku-20241022':     { input: 1.0,  output: 5.0  },
}

/** Default pricing for unknown models */
const DEFAULT_PRICING = { input: 3.0, output: 15.0 }

interface UsageBucket {
  model?: string
  input_tokens: number
  output_tokens: number
}

interface UsageResponse {
  data: UsageBucket[]
}

/**
 * Query the Anthropic Admin API for usage during a time window.
 * Returns undefined if the API call fails or returns no data.
 */
export async function queryUsage(
  adminKey: string,
  startTime: string,
  endTime: string,
): Promise<CostReport | undefined> {
  // Add 60s buffer to endTime for in-flight requests
  const endDate = new Date(endTime)
  endDate.setSeconds(endDate.getSeconds() + 60)

  const params = new URLSearchParams({
    starting_at: startTime,
    ending_at: endDate.toISOString(),
    'group_by[]': 'model',
    bucket_width: '1m',
  })

  const url = `https://api.anthropic.com/v1/organizations/usage_report/messages?${params}`

  const response = await fetch(url, {
    headers: {
      'x-api-key': adminKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    return undefined
  }

  const body = await response.json() as UsageResponse
  if (!body.data || body.data.length === 0) {
    return undefined
  }

  // Aggregate per model
  const modelTotals = new Map<string, { inputTokens: number; outputTokens: number }>()

  for (const bucket of body.data) {
    const model = bucket.model ?? 'unknown'
    const existing = modelTotals.get(model) ?? { inputTokens: 0, outputTokens: 0 }
    existing.inputTokens += bucket.input_tokens
    existing.outputTokens += bucket.output_tokens
    modelTotals.set(model, existing)
  }

  // Calculate costs
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCost = 0
  const models: CostReport['models'] = {}

  for (const [model, totals] of modelTotals) {
    const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING
    const inputCost = (totals.inputTokens / 1_000_000) * pricing.input
    const outputCost = (totals.outputTokens / 1_000_000) * pricing.output
    const cost = inputCost + outputCost

    totalInputTokens += totals.inputTokens
    totalOutputTokens += totals.outputTokens
    totalCost += cost

    models[model] = {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cost,
    }
  }

  return {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    estimatedCost: totalCost,
    models,
  }
}
