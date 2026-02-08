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

  // Validate expect fields in steps
  validateStepExpectations(obj.steps as ScenarioStep[])

  // Validate healthcheck if present
  if (obj.healthcheck !== undefined) {
    const hc = obj.healthcheck as Record<string, unknown>
    if (!hc.url || typeof hc.url !== 'string') {
      throw new Error('Healthcheck must have a "url" field')
    }
  }

  // Validate after steps if present
  if (obj.after !== undefined) {
    if (!Array.isArray(obj.after)) {
      throw new Error('"after" must be an array of steps')
    }
    validateStepBotRefs(obj.after as ScenarioStep[], botIds)
    validateStepExpectations(obj.after as ScenarioStep[])
  }

  return obj as unknown as Scenario
}

function validateStepExpectations(steps: ScenarioStep[]): void {
  for (const step of steps) {
    if (step.expect) {
      const { contains, not_contains, matches } = step.expect
      if (contains === undefined && not_contains === undefined && matches === undefined) {
        throw new Error('Step "expect" must have at least one of: contains, not_contains, matches')
      }
    }

    if (step.steps) {
      validateStepExpectations(step.steps)
    }

    if (step.parallel) {
      validateStepExpectations(step.parallel)
    }
  }
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
