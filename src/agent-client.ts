/**
 * AgentClient — Communicates with an OpenClaw agent via the HTTP API.
 *
 * Uses the OpenAI-compatible /v1/chat/completions endpoint.
 * Multi-turn sessions are maintained via the `user` field.
 */

import type { BotResponse } from './types.js'

const DEFAULT_TIMEOUT = 120_000

export class AgentClient {
  private baseUrl: string
  private token: string

  constructor(port: number, token: string) {
    this.baseUrl = `http://127.0.0.1:${port}`
    this.token = token
  }

  /**
   * Send a prompt to the agent and wait for the response.
   */
  async send(prompt: string, sessionId: string, timeout?: number): Promise<BotResponse> {
    const startTime = Date.now()

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openclaw',
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          user: sessionId,
        }),
        signal: AbortSignal.timeout(timeout ?? DEFAULT_TIMEOUT),
      })

      const duration = Date.now() - startTime

      if (!response.ok) {
        const errorText = await response.text()
        return {
          text: '',
          raw: errorText,
          duration,
          ok: false,
          error: `HTTP ${response.status}: ${errorText}`,
        }
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }

      // Extract text from OpenAI-compatible response format
      const text = data.choices?.[0]?.message?.content ?? ''

      return {
        text,
        raw: data,
        duration,
        ok: true,
      }
    } catch (error) {
      const duration = Date.now() - startTime

      // Differentiate timeout from network errors
      let message: string
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        message = `Request timed out after ${timeout ?? DEFAULT_TIMEOUT}ms`
      } else if (error instanceof TypeError && error.message.includes('fetch')) {
        message = `Network error: could not connect to ${this.baseUrl}`
      } else {
        message = error instanceof Error ? error.message : String(error)
      }

      return {
        text: '',
        raw: null,
        duration,
        ok: false,
        error: message,
      }
    }
  }
}
