/**
 * ClawHarness — Testing framework for OpenClaw bots
 *
 * @example
 * ```ts
 * import { ClawHarness } from 'claw-harness'
 *
 * const bench = new ClawHarness({ mode: 'local' })
 *
 * const alpha = bench.bot('alpha', {
 *   preset: 'default',
 *   skills: [{ url: 'http://localhost:3000/skill.md' }],
 *   userMd: 'You are a friendly bot.',
 * })
 *
 * await bench.start()
 * const r1 = await alpha.send("Register yourself on the platform")
 * await bench.stop()
 * ```
 */

export { ClawHarness } from './bench.js'
export { Bot } from './bot.js'
export { DockerGateway } from './docker-gateway.js'
export { loadScenario } from './scenario-loader.js'
export { runScenario } from './runner.js'
export { queryUsage } from './cost-tracker.js'
export { deepMerge, parseDuration, sleep, getPackageRoot, loadEnvFiles } from './utils.js'

export type {
  BenchConfig,
  BotConfig,
  BotResponse,
  Scenario,
  ScenarioStep,
  ScenarioResult,
  StepExpectation,
  AssertionResult,
  StepResult,
  CostReport,
  SkillSource,
} from './types.js'

export type { RunOptions } from './runner.js'
