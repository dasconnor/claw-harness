/**
 * Bot — Represents a single OpenClaw bot instance.
 *
 * Manages workspace setup, gateway lifecycle, and prompt communication.
 */

import type { BotConfig, BotResponse } from './types.js'
import { Workspace } from './workspace.js'
import { Gateway } from './gateway.js'
import { DockerGateway } from './docker-gateway.js'
import { AgentClient } from './agent-client.js'

interface GatewayLike {
  token: string
  start(env: { anthropicApiKey: string; openaiApiKey: string }): Promise<void>
  stop(): Promise<void>
}

export interface BotRuntimeConfig {
  mode: 'local' | 'docker'
  port: number
  workspaceDir: string
  anthropicApiKey: string
  openaiApiKey: string
}

export class Bot {
  readonly id: string
  private config: BotConfig
  private runtime: BotRuntimeConfig
  private workspace?: Workspace
  private gateway?: GatewayLike
  private client?: AgentClient
  private sessionId: string

  constructor(id: string, config: BotConfig, runtime: BotRuntimeConfig) {
    this.id = id
    this.config = config
    this.runtime = runtime
    this.sessionId = `clawbench-${id}-${Date.now()}`
  }

  /**
   * Set up workspace and start the gateway.
   */
  async start(): Promise<void> {
    // 1. Create isolated workspace
    this.workspace = new Workspace(this.id, this.runtime.workspaceDir)
    await this.workspace.setup(this.config, this.runtime)

    // 2. Start gateway — clean up workspace if this fails
    if (this.runtime.mode === 'docker') {
      this.gateway = new DockerGateway(
        this.id, this.runtime.port,
        this.workspace.profileName, this.workspace.profileDir,
      )
    } else {
      this.gateway = new Gateway(this.id, this.runtime.port, this.workspace.profileName)
    }
    try {
      await this.gateway.start({
        anthropicApiKey: this.runtime.anthropicApiKey,
        openaiApiKey: this.runtime.openaiApiKey,
      })
    } catch (err) {
      await this.workspace.cleanup()
      throw err
    }

    // 3. Create HTTP client
    this.client = new AgentClient(this.runtime.port, this.gateway.token)
  }

  /**
   * Send a prompt to the bot and wait for the response.
   */
  async send(prompt: string): Promise<BotResponse> {
    if (!this.client) {
      return {
        text: '',
        raw: null,
        duration: 0,
        ok: false,
        error: 'Bot not started. Call start() first.',
      }
    }

    return this.client.send(prompt, this.sessionId)
  }

  /**
   * Stop the gateway and clean up the workspace.
   */
  async stop(): Promise<void> {
    await this.gateway?.stop()
    await this.workspace?.cleanup()
  }
}
