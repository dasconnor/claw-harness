/**
 * DockerGateway — Runs an OpenClaw gateway inside a Docker container
 * with Xvfb + Chromium for headless browser support.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPackageRoot } from './utils.js'

const HEALTH_CHECK_INTERVAL = 1000
const HEALTH_CHECK_TIMEOUT = 60_000
const IMAGE_NAME = 'claw-harness:latest'

let imageReady = false

/**
 * Build the Docker image if it doesn't already exist.
 * Result is cached in a module-level boolean.
 */
export async function ensureImage(): Promise<void> {
  if (imageReady) return

  try {
    execFileSync('docker', ['image', 'inspect', IMAGE_NAME], { stdio: 'ignore' })
    imageReady = true
    return
  } catch {
    // Image not found — build it
  }

  const pkgRoot = await getPackageRoot()
  const dockerDir = join(pkgRoot, 'docker')

  console.log('Building claw-harness Docker image (first run — this may take a few minutes)...')

  try {
    execFileSync('docker', ['build', '-t', IMAGE_NAME, dockerDir], {
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
    })
  } catch (err) {
    throw new Error(`Failed to build Docker image: ${(err as Error).message}`)
  }

  imageReady = true
}

/**
 * Reset the image cache (for testing).
 */
export function resetImageCache(): void {
  imageReady = false
}

export class DockerGateway {
  private botId: string
  private port: number
  private profileName: string
  private hostProfileDir: string
  private containerName: string
  private process?: ChildProcess
  private _token: string = ''

  constructor(botId: string, port: number, profileName: string, hostProfileDir: string) {
    this.botId = botId
    this.port = port
    this.profileName = profileName
    this.hostProfileDir = hostProfileDir
    this.containerName = `claw-harness-${botId}`
  }

  get token(): string {
    return this._token
  }

  set token(value: string) {
    this._token = value
  }

  async start(env: { anthropicApiKey: string; openaiApiKey: string }): Promise<void> {
    // Read token from host config
    const configPath = join(this.hostProfileDir, 'openclaw.json')
    try {
      const configContent = await readFile(configPath, 'utf-8')
      const config = JSON.parse(configContent)
      this._token = config?.gateway?.auth?.token ?? ''
    } catch {
      // Token will be empty if config can't be read
    }

    // Ensure Docker image exists
    await ensureImage()

    // Build docker run arguments
    const args = this.buildDockerArgs(env)

    this.process = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) {
        console.log(`[${this.botId}:docker] ${line}`)
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) {
        console.error(`[${this.botId}:docker:err] ${line}`)
      }
    })

    this.process.on('error', (err) => {
      console.error(`[${this.botId}:docker] spawn error: ${err.message}`)
    })

    // Wait for gateway to be ready
    await this.waitForReady()
  }

  async stop(): Promise<void> {
    // Stop the container gracefully
    try {
      execFileSync('docker', ['stop', '-t', '10', this.containerName], {
        stdio: 'ignore',
        timeout: 15_000,
      })
    } catch {
      // Container may already be stopped
    }

    // Kill the spawned docker process if still alive
    if (this.process && !this.process.killed) {
      this.process.kill('SIGKILL')
    }

    this.process = undefined
  }

  /**
   * Build the docker run argument array.
   * Exported as a method for testability.
   */
  buildDockerArgs(env: { anthropicApiKey: string; openaiApiKey: string }): string[] {
    const containerProfileDir = `/home/node/.openclaw-${this.profileName}`

    const args: string[] = [
      'run', '--rm',
      '--name', this.containerName,
      '--shm-size=2g',
      '--add-host=host.docker.internal:host-gateway',
      '-v', `${this.hostProfileDir}:${containerProfileDir}`,
      '-e', `ANTHROPIC_API_KEY=${env.anthropicApiKey}`,
      '-e', `OPENCLAW_STATE_DIR=${containerProfileDir}`,
      '-e', `OPENCLAW_CONFIG_PATH=${containerProfileDir}/openclaw.json`,
    ]

    if (env.openaiApiKey) {
      args.push('-e', `OPENAI_API_KEY=${env.openaiApiKey}`)
    }

    // Platform-specific networking
    if (process.platform === 'linux') {
      args.push('--network', 'host')
    } else {
      args.push('-p', `${this.port}:${this.port}`)
    }

    // Image and command
    // --bind lan makes the gateway listen on 0.0.0.0 so it's reachable
    // from the host via Docker port mapping
    args.push(
      IMAGE_NAME,
      'openclaw',
      '--profile', this.profileName,
      'gateway',
      '--port', String(this.port),
      '--bind', 'lan',
    )

    return args
  }

  private async waitForReady(): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
          method: 'OPTIONS',
          signal: AbortSignal.timeout(2000),
        })
        // Any response means the server is up
        return
      } catch {
        // Not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL))
    }

    throw new Error(
      `Docker gateway for bot '${this.botId}' did not become ready within ${HEALTH_CHECK_TIMEOUT}ms`
    )
  }
}
