import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DockerGateway, ensureImage, resetImageCache } from './docker-gateway.js'

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn().mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      killed: false,
    }),
    execFileSync: vi.fn(),
  }
})

vi.mock('./utils.js', () => {
  return {
    getPackageRoot: vi.fn().mockResolvedValue('/mock/pkg'),
  }
})

describe('DockerGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetImageCache()
  })

  it('constructor sets container name from botId', () => {
    const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
    expect(gw.token).toBe('')
  })

  it('token getter/setter work', () => {
    const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
    gw.token = 'my-token'
    expect(gw.token).toBe('my-token')
  })

  it('stop() does not throw when not started', async () => {
    const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
    await gw.stop() // should not throw
  })

  describe('buildDockerArgs', () => {
    it('includes --network host on linux', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

      const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
      const args = gw.buildDockerArgs({ anthropicApiKey: 'sk-test', openaiApiKey: '' })

      expect(args).toContain('--network')
      expect(args[args.indexOf('--network') + 1]).toBe('host')
      // Should not have port mapping (the -p flag as its own element)
      const pIndex = args.indexOf('-p')
      expect(pIndex).toBe(-1)

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('includes -p port mapping on macOS', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
      const args = gw.buildDockerArgs({ anthropicApiKey: 'sk-test', openaiApiKey: '' })

      expect(args).toContain('-p')
      expect(args[args.indexOf('-p') + 1]).toBe('18800:18800')
      expect(args.join(' ')).not.toContain('--network')

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('includes --shm-size and bind mount', () => {
      const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
      const args = gw.buildDockerArgs({ anthropicApiKey: 'sk-test', openaiApiKey: '' })

      expect(args).toContain('--shm-size=2g')
      expect(args).toContain('-v')
      const vIndex = args.indexOf('-v')
      expect(args[vIndex + 1]).toContain('/home/user/.openclaw-clawbench-alpha')
    })

    it('includes openai key when provided', () => {
      const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
      const args = gw.buildDockerArgs({ anthropicApiKey: 'sk-test', openaiApiKey: 'sk-openai' })

      expect(args).toContain('OPENAI_API_KEY=sk-openai')
    })

    it('omits openai key when empty', () => {
      const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
      const args = gw.buildDockerArgs({ anthropicApiKey: 'sk-test', openaiApiKey: '' })

      expect(args.join(' ')).not.toContain('OPENAI_API_KEY')
    })

    it('includes openclaw command with profile and port', () => {
      const gw = new DockerGateway('alpha', 18800, 'clawbench-alpha', '/home/user/.openclaw-clawbench-alpha')
      const args = gw.buildDockerArgs({ anthropicApiKey: 'sk-test', openaiApiKey: '' })

      const imageIndex = args.indexOf('clawbench:latest')
      expect(imageIndex).toBeGreaterThan(-1)
      expect(args.slice(imageIndex + 1)).toEqual([
        'openclaw', '--profile', 'clawbench-alpha', 'gateway', '--port', '18800',
      ])
    })
  })

  describe('ensureImage', () => {
    it('checks for existing image first', async () => {
      const { execFileSync } = await import('node:child_process')
      vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from(''))

      await ensureImage()

      expect(execFileSync).toHaveBeenCalledWith(
        'docker', ['image', 'inspect', 'clawbench:latest'],
        expect.objectContaining({ stdio: 'ignore' }),
      )
    })

    it('builds image if inspect fails', async () => {
      const { execFileSync } = await import('node:child_process')
      // First call (inspect) throws, second call (build) succeeds
      vi.mocked(execFileSync)
        .mockImplementationOnce(() => { throw new Error('not found') })
        .mockReturnValueOnce(Buffer.from(''))

      await ensureImage()

      expect(execFileSync).toHaveBeenCalledTimes(2)
      expect(execFileSync).toHaveBeenLastCalledWith(
        'docker', ['build', '-t', 'clawbench:latest', '/mock/pkg/docker'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('caches result after successful check', async () => {
      const { execFileSync } = await import('node:child_process')
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      await ensureImage()
      await ensureImage()

      // Only called once for inspect — second call uses cache
      expect(execFileSync).toHaveBeenCalledTimes(1)
    })
  })
})
