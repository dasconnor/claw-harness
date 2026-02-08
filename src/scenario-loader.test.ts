import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { loadScenario } from './scenario-loader.js'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), 'clawbench-scenario-test')

describe('loadScenario', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('parses valid YAML scenario', async () => {
    const yaml = `
name: "Test Scenario"
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Hello"
`
    const file = join(TEST_DIR, 'valid.yaml')
    await writeFile(file, yaml)

    const scenario = await loadScenario(file)
    expect(scenario.name).toBe('Test Scenario')
    expect(scenario.bots.alpha).toBeDefined()
    expect(scenario.steps).toHaveLength(1)
  })

  it('throws for missing name', async () => {
    const yaml = `
bots:
  alpha:
    preset: default
steps:
  - bot: alpha
    prompt: "Hello"
`
    const file = join(TEST_DIR, 'no-name.yaml')
    await writeFile(file, yaml)

    await expect(loadScenario(file)).rejects.toThrow('name')
  })

  it('throws for missing bots', async () => {
    const yaml = `
name: "Test"
steps:
  - bot: alpha
    prompt: "Hello"
`
    const file = join(TEST_DIR, 'no-bots.yaml')
    await writeFile(file, yaml)

    await expect(loadScenario(file)).rejects.toThrow('bots')
  })

  it('throws for missing steps', async () => {
    const yaml = `
name: "Test"
bots:
  alpha:
    preset: default
`
    const file = join(TEST_DIR, 'no-steps.yaml')
    await writeFile(file, yaml)

    await expect(loadScenario(file)).rejects.toThrow('steps')
  })

  it('throws for unknown bot reference in steps', async () => {
    const yaml = `
name: "Test"
bots:
  alpha:
    preset: default
steps:
  - bot: unknown_bot
    prompt: "Hello"
`
    const file = join(TEST_DIR, 'unknown-bot.yaml')
    await writeFile(file, yaml)

    await expect(loadScenario(file)).rejects.toThrow('unknown_bot')
  })

  it('throws for unknown bot reference in parallel steps', async () => {
    const yaml = `
name: "Test"
bots:
  alpha:
    preset: default
steps:
  - parallel:
      - bot: unknown_bot
        prompt: "Hello"
`
    const file = join(TEST_DIR, 'unknown-parallel-bot.yaml')
    await writeFile(file, yaml)

    await expect(loadScenario(file)).rejects.toThrow('unknown_bot')
  })

  it('throws for unknown bot reference in repeat steps', async () => {
    const yaml = `
name: "Test"
bots:
  alpha:
    preset: default
steps:
  - repeat: 2
    steps:
      - bot: missing
        prompt: "Hello"
`
    const file = join(TEST_DIR, 'unknown-repeat-bot.yaml')
    await writeFile(file, yaml)

    await expect(loadScenario(file)).rejects.toThrow('missing')
  })
})
