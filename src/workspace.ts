/**
 * Workspace — Creates and manages isolated OpenClaw workspace directories.
 *
 * Each bot gets a profile directory at ~/.openclaw-claw-harness-<id>/
 * containing openclaw.json, USER.md, and skills.
 */

import { mkdir, writeFile, rm, readFile, access } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import JSON5 from 'json5'
import type { BotConfig } from './types.js'
import type { BotRuntimeConfig } from './bot.js'
import { deepMerge, getPackageRoot } from './utils.js'

export class Workspace {
  readonly profileName: string
  private _profileDir: string
  private workspaceSubdir: string
  private skillsDir: string

  get profileDir(): string { return this._profileDir }

  constructor(botId: string, baseDir: string) {
    this.profileName = `claw-harness-${botId}`
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'
    this._profileDir = join(home, `.openclaw-${this.profileName}`)
    this.workspaceSubdir = join(this._profileDir, 'workspace')
    this.skillsDir = join(this.workspaceSubdir, 'skills')
  }

  /**
   * Create the workspace directory structure and populate files.
   */
  async setup(config: BotConfig, runtime: BotRuntimeConfig): Promise<void> {
    // Create directory structure
    await mkdir(this.skillsDir, { recursive: true })

    // Write openclaw.json
    const openclawConfig = await this.buildConfig(config, runtime)
    await writeFile(
      join(this._profileDir, 'openclaw.json'),
      JSON.stringify(openclawConfig, null, 2),
    )

    // Write .env file with API keys so the agent can find them
    const envLines: string[] = []
    if (runtime.anthropicApiKey) {
      envLines.push(`ANTHROPIC_API_KEY=${runtime.anthropicApiKey}`)
    }
    if (runtime.openaiApiKey) {
      envLines.push(`OPENAI_API_KEY=${runtime.openaiApiKey}`)
    }
    if (envLines.length > 0) {
      await writeFile(join(this._profileDir, '.env'), envLines.join('\n') + '\n')
    }

    // Write USER.md (persona)
    if (config.userMd) {
      const content = await this.resolveContent(config.userMd)
      await writeFile(join(this.workspaceSubdir, 'USER.md'), content)
    }

    // Write SOUL.md (personality)
    if (config.soulMd) {
      const content = await this.resolveContent(config.soulMd)
      await writeFile(join(this.workspaceSubdir, 'SOUL.md'), content)
    }

    // Install skills
    if (config.skills) {
      for (const skill of config.skills) {
        await this.installSkill(skill)
      }
    }
  }

  /**
   * Remove the workspace directory.
   */
  async cleanup(): Promise<void> {
    try {
      await rm(this._profileDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup
    }
  }

  private async buildConfig(
    config: BotConfig,
    runtime: BotRuntimeConfig,
  ): Promise<Record<string, unknown>> {
    // Load preset if specified
    let base: Record<string, unknown> = {}
    if (config.preset) {
      base = await this.loadPreset(config.preset)
    }

    // Build the config, merging preset with overrides
    const token = `claw-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const agentsDefaults: Record<string, unknown> = {}
    if (config.model) {
      agentsDefaults.model = { primary: config.model }
    }

    let result = deepMerge(base, {
      gateway: {
        mode: 'local',
        port: runtime.port,
        auth: { token },
        http: {
          endpoints: {
            chatCompletions: { enabled: true },
          },
        },
      },
      agents: {
        defaults: agentsDefaults,
        list: [{ id: 'main', default: true }],
      },
      skills: {
        allowBundled: [],
      },
    })

    // Docker mode: enable headless browser with Chromium
    if (runtime.mode === 'docker') {
      result = deepMerge(result, {
        browser: { enabled: true, headless: true, noSandbox: true },
      })
    }

    // Apply user-specified overrides
    if (config.configOverrides) {
      return deepMerge(result, config.configOverrides)
    }

    return result
  }

  private async loadPreset(name: string): Promise<Record<string, unknown>> {
    const pkgRoot = await getPackageRoot()

    // Search order: cwd presets -> package presets
    const presetsLocations = [
      join(process.cwd(), 'presets', 'configs', `${name}.json5`),
      join(process.cwd(), 'presets', 'configs', `${name}.json`),
      join(pkgRoot, 'presets', 'configs', `${name}.json5`),
      join(pkgRoot, 'presets', 'configs', `${name}.json`),
    ]

    for (const loc of presetsLocations) {
      try {
        await access(loc)
        const content = await readFile(loc, 'utf-8')
        return JSON5.parse(content)
      } catch {
        continue
      }
    }

    console.warn(`Warning: preset "${name}" not found, using empty config`)
    return {}
  }

  private async installSkill(
    skill: { url?: string; path?: string; name?: string },
  ): Promise<void> {
    const skillName = skill.name ?? 'skill'
    const skillDir = join(this.skillsDir, skillName)
    await mkdir(skillDir, { recursive: true })

    let content: string

    if (skill.url) {
      // Fetch from URL with timeout
      const response = await fetch(skill.url, {
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch skill from ${skill.url}: ${response.status}`)
      }
      content = await response.text()
    } else if (skill.path) {
      // Read from local file
      content = await readFile(skill.path, 'utf-8')
    } else {
      throw new Error('Skill must have either url or path')
    }

    await writeFile(join(skillDir, 'SKILL.md'), content)
  }

  /**
   * Resolve content that could be a file path or inline string.
   * Tries: absolute path, cwd-relative, package-root-relative, then inline.
   */
  async resolveContent(pathOrContent: string): Promise<string> {
    // If it contains newlines or doesn't look like a path, treat as inline content
    if (pathOrContent.includes('\n') || !pathOrContent.match(/\.\w+$/)) {
      return pathOrContent
    }

    // Try resolving as file path from multiple locations
    const candidates: string[] = []

    if (isAbsolute(pathOrContent)) {
      candidates.push(pathOrContent)
    } else {
      candidates.push(resolve(process.cwd(), pathOrContent))
      const pkgRoot = await getPackageRoot()
      candidates.push(resolve(pkgRoot, pathOrContent))
    }

    for (const candidate of candidates) {
      try {
        return await readFile(candidate, 'utf-8')
      } catch {
        continue
      }
    }

    // Fall back to treating it as inline content
    return pathOrContent
  }
}
