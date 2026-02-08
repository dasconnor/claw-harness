/**
 * Runner — Executes a scenario against a set of bots.
 */

import { ClawBench } from './bench.js'
import { loadScenario } from './scenario-loader.js'
import { parseDuration, sleep } from './utils.js'
import type {
  BenchConfig,
  BotConfig,
  Scenario,
  ScenarioStep,
  ScenarioResult,
  StepResult,
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
  const bench = new ClawBench({ mode: 'local', ...options?.configOverrides })

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

  try {
    // Start all bots
    console.log(`Starting ${Object.keys(scenario.bots).length} bot(s)...`)
    await bench.start()
    console.log('All bots ready.')

    // Execute steps
    await executeSteps(bench, scenario.steps)

    // Collect results
    const results = bench.getResults()
    results.name = scenario.name
    return results
  } finally {
    console.log('Stopping bots...')
    await bench.stop()
  }
}

async function executeSteps(bench: ClawBench, steps: ScenarioStep[]): Promise<void> {
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

async function executeSingleStep(bench: ClawBench, step: ScenarioStep): Promise<void> {
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

  const result: StepResult = {
    botId: step.bot,
    prompt: step.prompt,
    response,
    timestamp: new Date().toISOString(),
  }

  bench.recordStep(result)

  if (response.ok) {
    console.log(`[${step.bot}] Response (${response.duration}ms): ${response.text.slice(0, 120).trim()}...`)
  } else {
    console.error(`[${step.bot}] Error: ${response.error}`)
  }
}
