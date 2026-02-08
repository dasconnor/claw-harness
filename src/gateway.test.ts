import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Gateway } from './gateway.js'

describe('Gateway', () => {
  it('creates with correct properties', () => {
    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    expect(gw.token).toBe('')
  })

  it('token getter/setter works', () => {
    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    gw.token = 'test-token'
    expect(gw.token).toBe('test-token')
  })

  it('stop() does nothing if process not started', async () => {
    const gw = new Gateway('bot1', 18800, 'claw-harness-bot1')
    // Should not throw
    await gw.stop()
  })
})
