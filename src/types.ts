/**
 * Core type definitions for ClawBench.
 */

// --- Bench Configuration ---

export interface BenchConfig {
  /** Execution mode: 'local' spawns processes, 'docker' uses containers */
  mode: 'local' | 'docker'
  /** Base port for gateway allocation. Each bot gets base + (index * 20). Default: 18800 */
  basePort?: number
  /** Directory for bot workspaces. Default: ~/.clawbench/workspaces */
  workspaceDir?: string
  /** Anthropic API key. Default: reads from ANTHROPIC_API_KEY env var */
  anthropicApiKey?: string
  /** OpenAI API key. Default: reads from OPENAI_API_KEY env var */
  openaiApiKey?: string
  /** Anthropic Admin API key for cost tracking. Default: reads from ANTHROPIC_ADMIN_API_KEY env var */
  anthropicAdminKey?: string
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
  /** Allowed hosts for web_fetch (set internally by runner) */
  allowedHosts?: string[]
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
    /** Additional hosts to allow for web_fetch beyond base_url */
    allowed_hosts?: string[]
  }
  /** Health check URL to verify before starting bots */
  healthcheck?: {
    url: string
    timeout?: string
  }
  bots: Record<string, ScenarioBotConfig>
  steps: ScenarioStep[]
  /** Cleanup steps to run after main steps (even if they fail) */
  after?: ScenarioStep[]
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

// --- Step Assertions ---

export interface StepExpectation {
  /** response.text must contain this string */
  contains?: string
  /** response.text must NOT contain this string */
  not_contains?: string
  /** response.text must match this regex */
  matches?: string
}

export interface AssertionResult {
  type: 'contains' | 'not_contains' | 'matches'
  expected: string
  passed: boolean
}

export interface ScenarioStep {
  /** Which bot should execute this step */
  bot?: string
  /** The prompt to send */
  prompt?: string
  /** Timeout for this step */
  timeout?: string
  /** Assertions to check on the response */
  expect?: StepExpectation
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
  assertions?: AssertionResult[]
}

export interface CostReport {
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  models: Record<string, {
    inputTokens: number
    outputTokens: number
    cost: number
  }>
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
  assertions: {
    total: number
    passed: number
    failed: number
  }
  cost?: CostReport
}
