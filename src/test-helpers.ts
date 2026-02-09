/**
 * Shared test helpers for Claw Harness.
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { vi } from 'vitest'

/**
 * Create a mock ChildProcess that supports event emission.
 * Enables `proc.emit('exit', 1)` and `proc.emit('error', err)` in tests.
 */
export function createMockChildProcess(): ChildProcess {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = null
  proc.pid = 12345
  proc.killed = false
  proc.kill = vi.fn(() => { proc.killed = true; return true })
  return proc as ChildProcess
}
