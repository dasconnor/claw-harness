#!/usr/bin/env node

/**
 * ClawBench CLI
 *
 * Usage:
 *   clawbench run <scenario.yaml> [options]
 *   clawbench init <name>
 *   clawbench presets
 */

import { runScenario } from '../runner.js'
import { getPackageRoot } from '../utils.js'
import { readdir, readFile, copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
    console.error('Usage: clawbench run <scenario.yaml>')
    process.exit(1)
  }

  // Parse optional flags
  let model: string | undefined
  let reporter = 'console'

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--model':
        model = args[++i]
        break
      case '--reporter':
        reporter = args[++i]
        break
    }
  }

  console.log(`Running scenario: ${scenarioPath}`)
  console.log()

  const result = await runScenario(scenarioPath, {
    modelOverride: model,
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
  }

  // Exit with error if any step failed
  const totalErrors = Object.values(result.bots).reduce((sum, b) => sum + b.errors, 0)
  process.exit(totalErrors > 0 ? 1 : 0)
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
ClawBench — Testing framework for OpenClaw bots

Usage:
  clawbench run <scenario.yaml> [options]   Run a test scenario
  clawbench init [name]                     Scaffold a new scenario
  clawbench presets                         List available presets

Options:
  --model <model>       Override model for all bots
  --reporter <format>   Output format: console (default) | json

Environment:
  ANTHROPIC_API_KEY     Required for Claude models
  OPENAI_API_KEY        Required for OpenAI models

Examples:
  clawbench run scenarios/lounge-chat.yaml
  clawbench run scenarios/lounge-chat.yaml --reporter json > results.json
`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
