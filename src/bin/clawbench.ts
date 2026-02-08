#!/usr/bin/env node

/**
 * Claw Harness CLI
 *
 * Usage:
 *   claw-harness run <scenario.yaml> [options]
 *   claw-harness init <name>
 *   claw-harness presets
 */

import { runScenario } from '../runner.js'
import { getPackageRoot, loadEnvFiles } from '../utils.js'
import { readdir, readFile, copyFile, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const command = args[0]

async function main() {
  switch (command) {
    case 'run':
      await handleRun(args.slice(1))
      break
    case 'init':
      await handleInit(args.slice(1))
      break
    case 'presets':
      await handlePresets()
      break
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      break
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

async function handleRun(args: string[]) {
  const scenarioPath = args[0]
  if (!scenarioPath) {
    console.error('Usage: claw-harness run <scenario.yaml>')
    process.exit(1)
  }

  // Parse optional flags
  let model: string | undefined
  let reporter = 'console'
  let docker = false

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--model':
        model = args[++i]
        break
      case '--reporter':
        reporter = args[++i]
        break
      case '--docker':
        docker = true
        break
    }
  }

  // Load .env files from cwd, scenario directory, and its parent
  // (handles repo-root .env when scenario is in a subdirectory)
  const scenarioDir = dirname(resolve(scenarioPath))
  const scenarioParent = dirname(scenarioDir)
  await loadEnvFiles(process.cwd(), scenarioDir, scenarioParent)

  console.log(`Running scenario: ${scenarioPath}`)
  console.log()

  const result = await runScenario(scenarioPath, {
    modelOverride: model,
    configOverrides: docker ? { mode: 'docker' as const } : undefined,
  })

  console.log()
  console.log('='.repeat(60))
  console.log(`SCENARIO: ${result.name}`)
  console.log('='.repeat(60))
  console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`)
  console.log(`Steps: ${result.steps.length}`)
  console.log()

  for (const [botId, summary] of Object.entries(result.bots)) {
    console.log(`  ${botId}: ${summary.messagesSent} messages, ${summary.errors} errors, ${(summary.totalDuration / 1000).toFixed(1)}s total`)
  }

  console.log()

  if (reporter === 'json') {
    console.log(JSON.stringify(result, null, 2))
  } else {
    // Console reporter: print conversation log
    console.log('Conversation Log:')
    console.log('-'.repeat(60))
    for (const step of result.steps) {
      console.log(`[${step.timestamp.slice(11, 19)}] ${step.botId} <- "${step.prompt.slice(0, 60).trim()}"`)
      if (step.response.ok) {
        console.log(`[${step.timestamp.slice(11, 19)}] ${step.botId} -> ${step.response.text.slice(0, 200)}`)
      } else {
        console.log(`[${step.timestamp.slice(11, 19)}] ${step.botId} ERROR: ${step.response.error}`)
      }
      console.log()
    }

    // Assertion summary
    if (result.assertions.total > 0) {
      console.log('-'.repeat(60))
      console.log(`Assertions: ${result.assertions.passed} passed, ${result.assertions.failed} failed, ${result.assertions.total} total`)
      console.log()
      for (const step of result.steps) {
        if (step.assertions && step.assertions.length > 0) {
          for (const a of step.assertions) {
            const icon = a.passed ? '\u2713' : '\u2717'
            const detail = a.passed ? '' : ' (not found in response)'
            console.log(`  ${icon} [${step.botId}] "${step.prompt.slice(0, 40).trim()}" \u2014 ${a.type} "${a.expected}"${detail}`)
          }
        }
      }
      console.log()
    }

    // Cost summary
    if (result.cost) {
      const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
      console.log(`Cost: ~$${result.cost.estimatedCost.toFixed(2)} (${fmt(result.cost.inputTokens)} input tokens, ${fmt(result.cost.outputTokens)} output tokens)`)
      for (const [model, data] of Object.entries(result.cost.models)) {
        console.log(`  ${model}: $${data.cost.toFixed(2)} (${fmt(data.inputTokens)} in / ${fmt(data.outputTokens)} out)`)
      }
      console.log()
    }
  }

  // Exit with error if any step failed or assertions failed
  const totalErrors = Object.values(result.bots).reduce((sum, b) => sum + b.errors, 0)
  const hasFailures = totalErrors > 0 || result.assertions.failed > 0
  process.exit(hasFailures ? 1 : 0)
}

async function handleInit(args: string[]) {
  const name = args[0] ?? 'my-scenario'
  const outputPath = `${name}.yaml`

  const pkgRoot = await getPackageRoot()
  const templatePath = join(pkgRoot, 'presets', 'scenarios', 'example-chat.yaml')

  try {
    let template = await readFile(templatePath, 'utf-8')
    // Replace the name in the template
    template = template.replace(/^name:.*$/m, `name: "${name}"`)
    await writeFile(outputPath, template)
    console.log(`Created scenario: ${outputPath}`)
    console.log(`Edit it to customize bots, skills, and steps.`)
  } catch {
    console.error(`Could not read template from ${templatePath}`)
    console.error('For now, copy presets/scenarios/example-chat.yaml and modify it.')
    process.exit(1)
  }
}

async function handlePresets() {
  const pkgRoot = await getPackageRoot()

  console.log('Available presets:')
  console.log()

  // List configs
  console.log('Configs:')
  try {
    const configDir = join(pkgRoot, 'presets', 'configs')
    const configs = await readdir(configDir)
    for (const file of configs) {
      const name = file.replace(/\.json5?$/, '')
      console.log(`  ${name}`)
    }
  } catch {
    console.log('  (none found)')
  }

  console.log()

  // List personas
  console.log('Personas:')
  try {
    const personaDir = join(pkgRoot, 'presets', 'personas')
    const personas = await readdir(personaDir)
    for (const file of personas) {
      const name = file.replace(/\.md$/, '')
      console.log(`  ${name}`)
    }
  } catch {
    console.log('  (none found)')
  }

  console.log()

  // List scenarios
  console.log('Example Scenarios:')
  try {
    const scenarioDir = join(pkgRoot, 'presets', 'scenarios')
    const scenarios = await readdir(scenarioDir)
    for (const file of scenarios) {
      const name = file.replace(/\.yaml$/, '')
      console.log(`  ${name}`)
    }
  } catch {
    console.log('  (none found)')
  }
}

function printHelp() {
  console.log(`
Claw Harness — Testing framework for OpenClaw bots

Usage:
  claw-harness run <scenario.yaml> [options]   Run a test scenario
  claw-harness init [name]                     Scaffold a new scenario
  claw-harness presets                         List available presets

Options:
  --model <model>       Override model for all bots
  --reporter <format>   Output format: console (default) | json
  --docker              Run bots in Docker containers (Xvfb + Chromium)

Environment:
  ANTHROPIC_API_KEY          Required for Claude models
  OPENAI_API_KEY             Required for OpenAI models
  ANTHROPIC_ADMIN_API_KEY    Optional: enables cost tracking via Admin API

Features:
  - Step assertions (expect.contains, expect.not_contains, expect.matches)
  - Health checks (healthcheck.url verified before bot startup)
  - Cleanup hooks (after: steps run even if main steps fail)
  - Cost tracking (automatic with ANTHROPIC_ADMIN_API_KEY)

Docker Mode:
  Requires Docker installed. On first run, builds an image (~800MB) with
  Node.js, Chromium, and Xvfb. Bots run in isolated containers with
  headless browser support — no windows pop up on your desktop.

Examples:
  claw-harness run scenarios/lounge-chat.yaml
  claw-harness run scenarios/lounge-chat.yaml --docker
  claw-harness run scenarios/lounge-chat.yaml --reporter json > results.json
`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
