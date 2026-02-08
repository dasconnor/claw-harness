/**
 * ScenarioLoader — Parses and validates YAML scenario files.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Scenario, ScenarioStep } from './types.js'

export async function loadScenario(filePath: string): Promise<Scenario> {
  const content = await readFile(resolve(filePath), 'utf-8')
  const raw = parseYaml(content)

  return validateScenario(raw)
}

function validateScenario(raw: unknown): Scenario {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Scenario must be a YAML object')
  }

  const obj = raw as Record<string, unknown>

  if (!obj.name || typeof obj.name !== 'string') {
    throw new Error('Scenario must have a "name" field')
  }

  if (!obj.bots || typeof obj.bots !== 'object') {
    throw new Error('Scenario must have a "bots" section')
  }

  if (!Array.isArray(obj.steps)) {
    throw new Error('Scenario must have a "steps" array')
  }

  // Validate bot references in steps
  const botIds = new Set(Object.keys(obj.bots as Record<string, unknown>))
  validateStepBotRefs(obj.steps as ScenarioStep[], botIds)

  return obj as unknown as Scenario
}

function validateStepBotRefs(steps: ScenarioStep[], botIds: Set<string>): void {
  for (const step of steps) {
    if (step.bot && !botIds.has(step.bot)) {
      throw new Error(`Step references unknown bot "${step.bot}". Known bots: ${[...botIds].join(', ')}`)
    }

    if (step.steps) {
      validateStepBotRefs(step.steps, botIds)
    }

    if (step.parallel) {
      validateStepBotRefs(step.parallel, botIds)
    }
  }
}
