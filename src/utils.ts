/**
 * Shared utilities for ClawBench.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { access, readFile } from 'node:fs/promises'

/**
 * Deep merge two objects. Arrays are replaced, not concatenated.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target }

  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = result[key]

    if (sourceVal === undefined) continue

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      )
    } else {
      result[key] = sourceVal
    }
  }

  return result
}

/**
 * Parse a duration string like "500ms", "30s", "2m" into milliseconds.
 * Returns 60000 (1 minute) for invalid inputs.
 */
export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(ms|s|m)$/)
  if (!match) return 60_000

  const value = parseInt(match[1], 10)
  switch (match[2]) {
    case 'ms': return value
    case 's': return value * 1000
    case 'm': return value * 60_000
    default: return 60_000
  }
}

/**
 * Promise-based sleep.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Get the root directory of the clawbench package.
 * Works whether running from source or as an installed npm package.
 */
export async function getPackageRoot(): Promise<string> {
  // Start from this file's directory and walk up to find package.json
  let dir = dirname(fileURLToPath(import.meta.url))

  for (let i = 0; i < 5; i++) {
    try {
      await access(join(dir, 'package.json'))
      return dir
    } catch {
      dir = dirname(dir)
    }
  }

  // Fallback to cwd
  return process.cwd()
}

/**
 * Load environment variables from .env files.
 * Searches: cwd/.env, scenario dir/.env. Does not override existing vars.
 */
export async function loadEnvFiles(...dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    const envPath = join(dir, '.env')
    try {
      const content = await readFile(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex < 0) continue
        const key = trimmed.slice(0, eqIndex).trim()
        let value = trimmed.slice(eqIndex + 1).trim()
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        // Don't override existing env vars
        if (!process.env[key]) {
          process.env[key] = value
        }
      }
    } catch {
      // .env file not found — that's fine
    }
  }
}
