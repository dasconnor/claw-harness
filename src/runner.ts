/**
 * Runner — Executes a scenario against a set of bots.
 */

import { ClawHarness } from './bench.js'
import { loadScenario } from './scenario-loader.js'
import { queryUsage } from './cost-tracker.js'
import { parseDuration, sleep } from './utils.js'
import type {
  BenchConfig,
  BotConfig,
  ScenarioStep,
  ScenarioResult,
  StepResult,
  AssertionResult,
  StepExpectation,
} from './types.js'

export interface RunOptions {
  configOverrides?: Partial<BenchConfig>
  modelOverride?: string
}

/**
 * Run a scenario file end-to-end.
 */
export async function runScenario(
  scenarioPath: string,
  options?: RunOptions,
): Promise<ScenarioResult> {
  const scenario = await loadScenario(scenarioPath)

  // Health check before starting anything
  if (scenario.healthcheck) {
    await performHealthCheck(scenario.healthcheck.url, scenario.healthcheck.timeout)
  }

  const bench = new ClawHarness({ mode: 'local', ...options?.configOverrides })

  // Register bots
  for (const [botId, botConfig] of Object.entries(scenario.bots)) {
    const config: BotConfig = {
      preset: botConfig.preset,
      model: options?.modelOverride ?? botConfig.model,
      userMd: botConfig.user_md,
      soulMd: botConfig.soul_md,
      skills: botConfig.skills?.map(s => ({
        url: s.url,
        path: s.path,
        name: s.name ?? 'skill',
      })),
      configOverrides: botConfig.config_overrides,
    }
    bench.bot(botId, config)
  }

  let mainError: unknown
  try {
    // Start all bots
    console.log(`Starting ${Object.keys(scenario.bots).length} bot(s)...`)
    await bench.start()
    console.log('All bots ready.')

    // Execute steps
    await executeSteps(bench, scenario.steps)
  } catch (err) {
    mainError = err
  } finally {
    // Run cleanup steps if defined
    if (scenario.after && scenario.after.length > 0) {
      try {
        console.log('Running cleanup steps...')
        await executeSteps(bench, scenario.after)
      } catch (err) {
        console.error('Cleanup step error (non-fatal):', err)
      }
    }

    console.log('Stopping bots...')
    await bench.stop()
  }

  // Collect results
  const results = bench.getResults()
  results.name = scenario.name

  // Cost tracking
  const adminKey = options?.configOverrides?.anthropicAdminKey
    ?? process.env.ANTHROPIC_ADMIN_API_KEY
  if (adminKey) {
    try {
      const cost = await queryUsage(adminKey, results.startTime, results.endTime)
      if (cost) results.cost = cost
    } catch {
      // Cost tracking is best-effort
    }
  }

  if (mainError) throw mainError
  return results
}

async function performHealthCheck(url: string, timeout?: string): Promise<void> {
  const timeoutMs = parseDuration(timeout ?? '10s')
  console.log(`Health check: ${url}`)

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    console.log('Health check passed.')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Health check failed: ${url} — is the target service running? (${msg})`)
  }
}

async function executeSteps(bench: ClawHarness, steps: ScenarioStep[]): Promise<void> {
  for (const step of steps) {
    if (step.parallel) {
      // Execute parallel steps concurrently — use allSettled so one failure doesn't kill others
      const results = await Promise.allSettled(
        step.parallel.map(subStep => executeSingleStep(bench, subStep)),
      )
      // Log any rejected parallel steps
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error(`Parallel step failed: ${result.reason}`)
        }
      }
    } else if (step.repeat && step.steps) {
      // Execute repeat block
      const intervalMs = parseDuration(step.interval ?? '0s')

      for (let i = 0; i < step.repeat; i++) {
        if (i > 0 && intervalMs > 0) {
          await sleep(intervalMs)
        }
        await executeSteps(bench, step.steps)
      }
    } else if (step.bot && step.prompt) {
      await executeSingleStep(bench, step)
    }
  }
}

async function executeSingleStep(bench: ClawHarness, step: ScenarioStep): Promise<void> {
  if (!step.bot || !step.prompt) return

  const bot = bench.getBot(step.bot)
  if (!bot) {
    console.error(`Unknown bot: ${step.bot}`)
    return
  }

  const timeoutMs = parseDuration(step.timeout ?? '60s')

  console.log(`[${step.bot}] Sending prompt: ${step.prompt.slice(0, 80).trim()}...`)

  const response = await Promise.race([
    bot.send(step.prompt),
    sleep(timeoutMs).then(() => ({
      text: '',
      raw: null,
      duration: timeoutMs,
      ok: false as const,
      error: `Timeout after ${timeoutMs}ms`,
    })),
  ])

  // Evaluate assertions if present
  const assertions = step.expect ? evaluateAssertions(response.text, step.expect) : undefined

  const result: StepResult = {
    botId: step.bot,
    prompt: step.prompt,
    response,
    timestamp: new Date().toISOString(),
    assertions,
  }

  bench.recordStep(result)

  if (response.ok) {
    console.log(`[${step.bot}] Response (${response.duration}ms): ${response.text.slice(0, 120).trim()}...`)
  } else {
    console.error(`[${step.bot}] Error: ${response.error}`)
  }

  if (assertions) {
    for (const a of assertions) {
      const icon = a.passed ? '\u2713' : '\u2717'
      console.log(`  ${icon} ${a.type}: "${a.expected}" — ${a.passed ? 'passed' : 'FAILED'}`)
    }
  }
}

function evaluateAssertions(text: string, expect: StepExpectation): AssertionResult[] {
  const results: AssertionResult[] = []

  if (expect.contains !== undefined) {
    results.push({
      type: 'contains',
      expected: expect.contains,
      passed: text.includes(expect.contains),
    })
  }

  if (expect.not_contains !== undefined) {
    results.push({
      type: 'not_contains',
      expected: expect.not_contains,
      passed: !text.includes(expect.not_contains),
    })
  }

  if (expect.matches !== undefined) {
    results.push({
      type: 'matches',
      expected: expect.matches,
      passed: new RegExp(expect.matches).test(text),
    })
  }

  return results
}
