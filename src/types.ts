/**
 * Core type definitions for ClawBench.
 */

// --- Bench Configuration ---

export interface BenchConfig {
  /** Execution mode: 'local' spawns processes, 'docker' uses containers */
  mode: 'local'
  /** Base port for gateway allocation. Each bot gets base + (index * 20). Default: 18800 */
  basePort?: number
  /** Directory for bot workspaces. Default: ~/.clawbench/workspaces */
  workspaceDir?: string
  /** Anthropic API key. Default: reads from ANTHROPIC_API_KEY env var */
  anthropicApiKey?: string
  /** OpenAI API key. Default: reads from OPENAI_API_KEY env var */
  openaiApiKey?: string
}

// --- Bot Configuration ---

export interface SkillSource {
  /** Fetch skill.md from this URL */
  url?: string
  /** Load skill.md from this local file path */
  path?: string
  /** Name for the skill directory. Defaults to 'skill'. */
  name?: string
}

export interface BotConfig {
  /** Preset config name (e.g., 'default', 'minimal') */
  preset?: string
  /** Model identifier (e.g., 'anthropic/claude-haiku-4-5-20251001') */
  model?: string
  /** Path to a user.md file, or inline string content */
  userMd?: string
  /** Path to a soul.md file, or inline string content */
  soulMd?: string
  /** Skills to load for this bot */
  skills?: SkillSource[]
  /** Additional config overrides merged into openclaw.json */
  configOverrides?: Record<string, unknown>
}

// --- Bot Response ---

export interface BotResponse {
  /** The agent's text response */
  text: string
  /** Raw response from the API */
  raw: unknown
  /** Time taken in milliseconds */
  duration: number
  /** Whether the request succeeded */
  ok: boolean
  /** Error message if failed */
  error?: string
}

// --- Scenario Format ---

export interface Scenario {
  name: string
  description?: string
  target?: {
    base_url?: string
  }
  bots: Record<string, ScenarioBotConfig>
  steps: ScenarioStep[]
  evaluate?: ScenarioEvaluation[]
}

export interface ScenarioBotConfig {
  preset?: string
  model?: string
  user_md?: string
  soul_md?: string
  skills?: Array<{
    url?: string
    path?: string
    name?: string
  }>
  config_overrides?: Record<string, unknown>
}

export interface ScenarioStep {
  /** Which bot should execute this step */
  bot?: string
  /** The prompt to send */
  prompt?: string
  /** Timeout for this step */
  timeout?: string
  /** Repeat block */
  repeat?: number
  /** Interval between repeats */
  interval?: string
  /** Sub-steps for repeat or parallel blocks */
  steps?: ScenarioStep[]
  /** Parallel execution block */
  parallel?: ScenarioStep[]
}

export interface ScenarioEvaluation {
  type: 'api' | 'llm_judge' | 'script'
  [key: string]: unknown
}

// --- Scenario Results ---

export interface StepResult {
  botId: string
  prompt: string
  response: BotResponse
  timestamp: string
}

export interface ScenarioResult {
  name: string
  startTime: string
  endTime: string
  duration: number
  steps: StepResult[]
  bots: Record<string, {
    messagesSent: number
    totalDuration: number
    errors: number
  }>
}
