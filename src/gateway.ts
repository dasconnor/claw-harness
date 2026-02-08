/**
 * Gateway — Starts and manages an OpenClaw gateway process.
 */

import { spawn, type ChildProcess } from 'node:child_process'

const HEALTH_CHECK_INTERVAL = 500
const HEALTH_CHECK_TIMEOUT = 30_000

export class Gateway {
  private botId: string
  private port: number
  private profileName: string
  private process?: ChildProcess
  private _token: string = ''
  private processExited = false
  private processExitCode: number | null = null

  constructor(botId: string, port: number, profileName: string) {
    this.botId = botId
    this.port = port
    this.profileName = profileName
  }

  get token(): string {
    return this._token
  }

  set token(value: string) {
    this._token = value
  }

  /**
   * Start the OpenClaw gateway process.
   */
  async start(env: { anthropicApiKey: string; openaiApiKey: string }): Promise<void> {
    // Read the token from the generated config
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'
    const { readFile } = await import('node:fs/promises')
    const configPath = `${home}/.openclaw-${this.profileName}/openclaw.json`

    try {
      const configContent = await readFile(configPath, 'utf-8')
      const config = JSON.parse(configContent)
      this._token = config?.gateway?.auth?.token ?? ''
    } catch {
      // Token will be empty if config can't be read
    }

    const processEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      ANTHROPIC_API_KEY: env.anthropicApiKey,
    }

    if (env.openaiApiKey) {
      processEnv.OPENAI_API_KEY = env.openaiApiKey
    }

    this.processExited = false
    this.processExitCode = null

    this.process = spawn('openclaw', [
      '--profile', this.profileName,
      'gateway',
      '--port', String(this.port),
    ], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    // Log gateway output for debugging
    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) {
        console.log(`[${this.botId}:gateway] ${line}`)
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) {
        console.error(`[${this.botId}:gateway:err] ${line}`)
      }
    })

    // Handle spawn errors (e.g., command not found)
    this.process.on('error', (err) => {
      this.processExited = true
      this.processExitCode = 1
      console.error(`[${this.botId}:gateway] spawn error: ${err.message}`)
    })

    // Track early process exit
    this.process.on('exit', (code) => {
      this.processExited = true
      this.processExitCode = code
      console.log(`[${this.botId}:gateway] exited with code ${code}`)
    })

    // Wait for gateway to be ready
    await this.waitForReady()
  }

  /**
   * Stop the gateway process.
   */
  async stop(): Promise<void> {
    if (!this.process) return

    this.process.kill('SIGTERM')

    // Wait for clean exit with timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill('SIGKILL')
        resolve()
      }, 5000)

      this.process!.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    this.process = undefined
  }

  /**
   * Poll the gateway health endpoint until it responds.
   * Fails immediately if the process exits early (e.g., OpenClaw not installed).
   */
  private async waitForReady(): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT) {
      // Check if process exited early
      if (this.processExited) {
        throw new Error(
          `Gateway for bot '${this.botId}' exited with code ${this.processExitCode} before becoming ready. ` +
          `Is OpenClaw installed? (npm install -g openclaw@latest)`
        )
      }

      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
          method: 'OPTIONS',
          signal: AbortSignal.timeout(2000),
        })
        // Any response (even 405) means the server is up
        return
      } catch {
        // Not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL))
    }

    throw new Error(
      `Gateway for bot '${this.botId}' did not become ready within ${HEALTH_CHECK_TIMEOUT}ms`
    )
  }
}
