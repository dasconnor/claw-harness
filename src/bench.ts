/**
 * Claw Harness — Main orchestrator class.
 *
 * Creates and manages bot instances, handles lifecycle.
 */

import { Bot } from './bot.js'
import type { BenchConfig, BotConfig, ScenarioResult, StepResult } from './types.js'

const DEFAULT_BASE_PORT = 18800

export class ClawHarness {
  private config: Required<BenchConfig>
  private bots: Map<string, Bot> = new Map()
  private stepResults: StepResult[] = []
  private startTime?: string
  private nextPortIndex = 0

  constructor(config: BenchConfig) {
    this.config = {
      mode: config.mode,
      basePort: config.basePort ?? DEFAULT_BASE_PORT,
      workspaceDir: config.workspaceDir ?? defaultWorkspaceDir(),
      anthropicApiKey: config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      openaiApiKey: config.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '',
      anthropicAdminKey: config.anthropicAdminKey ?? process.env.ANTHROPIC_ADMIN_API_KEY ?? '',
    }
  }

  /**
   * Register a bot with the bench.
   */
  bot(id: string, config: BotConfig): Bot {
    const port = this.config.basePort + (this.nextPortIndex * 20)
    this.nextPortIndex++

    const bot = new Bot(id, config, {
      mode: this.config.mode,
      port,
      workspaceDir: this.config.workspaceDir,
      anthropicApiKey: this.config.anthropicApiKey,
      openaiApiKey: this.config.openaiApiKey,
    })

    this.bots.set(id, bot)
    return bot
  }

  /**
   * Start all registered bots sequentially.
   * If a bot fails to start, all previously started bots are stopped.
   */
  async start(): Promise<void> {
    this.startTime = new Date().toISOString()
    const startedBots: Bot[] = []

    for (const bot of this.bots.values()) {
      try {
        await bot.start()
        startedBots.push(bot)
      } catch (err) {
        // Clean up already-started bots
        for (const started of startedBots) {
          await started.stop().catch(() => {})
        }
        throw err
      }
    }
  }

  /**
   * Stop all bots and clean up.
   */
  async stop(): Promise<void> {
    const stopPromises = Array.from(this.bots.values()).map(bot => bot.stop())
    await Promise.all(stopPromises)
  }

  /**
   * Get a bot by ID.
   */
  getBot(id: string): Bot | undefined {
    return this.bots.get(id)
  }

  /**
   * Record a step result (used by the runner).
   */
  recordStep(result: StepResult): void {
    this.stepResults.push(result)
  }

  /**
   * Get the full conversation log across all bots.
   */
  getConversationLog(): StepResult[] {
    return [...this.stepResults]
  }

  /**
   * Get a summary of the run.
   */
  getResults(): ScenarioResult {
    const endTime = new Date().toISOString()
    const botSummaries: ScenarioResult['bots'] = {}

    for (const [id] of this.bots) {
      const botSteps = this.stepResults.filter(s => s.botId === id)
      botSummaries[id] = {
        messagesSent: botSteps.length,
        totalDuration: botSteps.reduce((sum, s) => sum + s.response.duration, 0),
        errors: botSteps.filter(s => !s.response.ok).length,
      }
    }

    // Aggregate assertion counts
    let totalAssertions = 0
    let passedAssertions = 0
    for (const step of this.stepResults) {
      if (step.assertions) {
        for (const a of step.assertions) {
          totalAssertions++
          if (a.passed) passedAssertions++
        }
      }
    }

    return {
      name: '',
      startTime: this.startTime ?? endTime,
      endTime,
      duration: this.startTime
        ? new Date(endTime).getTime() - new Date(this.startTime).getTime()
        : 0,
      steps: this.stepResults,
      bots: botSummaries,
      assertions: {
        total: totalAssertions,
        passed: passedAssertions,
        failed: totalAssertions - passedAssertions,
      },
    }
  }
}

function defaultWorkspaceDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'
  return `${home}/.claw-harness/workspaces`
}
