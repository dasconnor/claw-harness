# Claw Harness Guide

A comprehensive guide for writing and running Claw Harness tests, aimed at AI agents and developers.

## What Claw Harness Does

Claw Harness is a testing framework for OpenClaw bots. It spins up isolated OpenClaw agent instances with configurable skills and personas, drives them through multi-turn prompt sequences, evaluates responses with assertions, and produces structured results. The core question it answers: **can a real AI agent, given only your skill.md, figure out how to use your site?**

## Prerequisites

1. **OpenClaw** installed globally: `npm install -g openclaw@latest`
2. **API key** set: `export ANTHROPIC_API_KEY=sk-ant-...`
3. **Target app** running (if your scenario uses skills from a URL)
4. **Node.js >= 22**

Optional:
- `ANTHROPIC_ADMIN_API_KEY` — enables cost tracking via the Admin API
- `OPENAI_API_KEY` — if using OpenAI models

## Scenario YAML Reference

A scenario file defines bots, steps, and optional assertions. Here's the complete field reference:

```yaml
# Required
name: "My Test Scenario"

# Optional description
description: "What this test validates"

# Optional target configuration
target:
  base_url: "http://localhost:3000"
# Optional health check — runs before bots start
healthcheck:
  url: "http://localhost:3000/health"
  timeout: "10s"                    # Default: 10s

# Required: bot definitions
bots:
  alpha:
    preset: default                 # Config preset (default | minimal)
    model: anthropic/claude-haiku-4-5-20251001
    user_md: presets/personas/friendly.md   # File path or inline string
    soul_md: |                      # Optional personality
      You are warm and enthusiastic.
    skills:
      - url: "http://localhost:3000/skill.md"
        name: target-app            # Directory name (default: "skill")
      - path: "./local-skill.md"
        name: local-tool
    config_overrides:               # Merged into openclaw.json
      agents:
        defaults:
          thinking: low

  beta:
    preset: default
    model: anthropic/claude-haiku-4-5-20251001
    user_md: "You are a curious bot who asks deep questions."
    skills:
      - url: "http://localhost:3000/skill.md"

# Required: step sequence
steps:
  # Simple step
  - bot: alpha
    prompt: "Register yourself on the platform."
    timeout: 60s                    # Default: 60s
    expect:                         # Optional assertions
      contains: "registered"

  # Step with multiple assertions
  - bot: beta
    prompt: "Register and confirm your API key."
    expect:
      contains: "mk_live_"
      not_contains: "error"

  # Step with regex assertion
  - bot: alpha
    prompt: "List your available actions."
    expect:
      matches: "(register|login|browse)"

  # Parallel steps (run concurrently)
  - parallel:
      - bot: alpha
        prompt: "Join the lounge."
        expect:
          contains: "joined"
      - bot: beta
        prompt: "Join the lounge."

  # Repeat block
  - repeat: 3
    interval: 15s                   # Wait between iterations
    steps:
      - bot: alpha
        prompt: "Check for new messages and respond."
        timeout: 30s
      - bot: beta
        prompt: "Check for new messages and respond."
        timeout: 30s

# Optional: cleanup steps (run after main steps, even on failure)
after:
  - bot: alpha
    prompt: "Delete your account to clean up."
  - bot: beta
    prompt: "Delete your account to clean up."
```

### Field Details

#### `bots.<id>`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `preset` | string | No | Config preset name (`default` or `minimal`) |
| `model` | string | No | Model identifier (e.g., `anthropic/claude-haiku-4-5-20251001`) |
| `user_md` | string | No | File path or inline persona content |
| `soul_md` | string | No | File path or inline personality content |
| `skills` | array | No | Skills to install (url or path) |
| `config_overrides` | object | No | Merged into the bot's openclaw.json |

#### `steps[]`

| Field | Type | Description |
|-------|------|-------------|
| `bot` | string | Bot ID to execute this step |
| `prompt` | string | Message to send to the bot |
| `timeout` | string | Timeout duration (e.g., `30s`, `2m`). Default: `60s` |
| `expect` | object | Assertions on the response |
| `parallel` | array | Sub-steps to run concurrently |
| `repeat` | number | Number of times to repeat sub-steps |
| `interval` | string | Wait between repeat iterations |
| `steps` | array | Sub-steps for repeat blocks |

#### `expect`

| Field | Type | Description |
|-------|------|-------------|
| `contains` | string | Response text must include this string |
| `not_contains` | string | Response text must NOT include this string |
| `matches` | string | Response text must match this regex |

At least one field is required when `expect` is specified.

## Preset Reference

### Configs

- **`default`** — Full tool profile, Haiku model, bundled skills disabled. Good for most tests.
- **`minimal`** — Same as default, optimized for cost. Good for simple interaction tests.

### Personas

- **`friendly`** — Outgoing, asks follow-up questions, explores features naturally
- **`curious`** — Thoughtful, reads documentation carefully, asks deep questions
- **`terse`** — Brief, technical, gets straight to the point

Use personas via `user_md: presets/personas/friendly.md` in your bot config.

## Docker Mode

Docker mode runs each bot's OpenClaw gateway inside a container with Xvfb and Chromium, providing headless browser support and filesystem isolation. No browser windows pop up on your desktop.

### Prerequisites

- **Docker** installed and running
- No need to install OpenClaw on the host — it's installed inside the container

### Usage

**CLI:**
```bash
claw-harness run my-scenario.yaml --docker
```

**Programmatic:**
```ts
const bench = new ClawHarness({ mode: 'docker' })
```

### How It Works

1. On first run, Claw Harness builds a Docker image (`claw-harness:latest`) containing Node.js 22, Chromium, Xvfb, and OpenClaw (~800MB, cached after first build)
2. Each bot gets its own container named `claw-harness-{botId}`
3. The bot's profile directory is bind-mounted into the container
4. Xvfb provides a virtual display for Chromium (no GUI needed)
5. The container runs `openclaw gateway` with the same profile/port as local mode

### Localhost Access

- **Linux:** Uses `--network host` — containers share the host's network, so `localhost` works as expected
- **macOS:** Containers use port mapping (`-p`). To reach host services from inside the container, use `host.docker.internal` instead of `localhost`

### Known Limitations

- **First-run build time:** 2-5 minutes to download the base image + Chromium + OpenClaw
- **OpenClaw version:** Uses `@latest` inside the container, which may differ from the host's version
- **Orphaned containers:** If Claw Harness crashes, containers keep running. Clean up with `docker rm -f $(docker ps -q --filter name=claw-harness-)`
- **No GPU passthrough:** Chromium runs in software rendering mode

## CLI Reference

### `claw-harness run <scenario.yaml> [options]`

Run a test scenario.

```bash
claw-harness run my-test.yaml
claw-harness run my-test.yaml --model anthropic/claude-sonnet-4-5-20250929
claw-harness run my-test.yaml --reporter json > results.json
```

**Options:**
- `--model <model>` — Override model for all bots
- `--reporter <format>` — Output format: `console` (default) or `json`

**Exit codes:**
- `0` — All steps succeeded and all assertions passed
- `1` — Any step error or assertion failure

### `claw-harness init [name]`

Scaffold a new scenario file from a template.

```bash
claw-harness init my-scenario
# Creates my-scenario.yaml
```

### `claw-harness presets`

List available preset configs, personas, and example scenarios.

## Programmatic API

```ts
import { ClawHarness } from 'claw-harness'

const bench = new ClawHarness({ mode: 'local' })

const alpha = bench.bot('alpha', {
  preset: 'default',
  model: 'anthropic/claude-haiku-4-5-20251001',
  skills: [{ url: 'http://localhost:3000/skill.md' }],
  userMd: 'You are a friendly bot.',
})

await bench.start()

const r1 = await alpha.send("Register yourself on the platform")
console.log(r1.text)       // Agent's response text
console.log(r1.duration)   // Response time in ms
console.log(r1.ok)         // Whether it succeeded

await bench.stop()
```

### Running a scenario programmatically

```ts
import { runScenario } from 'claw-harness'

const result = await runScenario('./my-test.yaml', {
  modelOverride: 'anthropic/claude-sonnet-4-5-20250929',
})

console.log(result.assertions)  // { total: 5, passed: 4, failed: 1 }
console.log(result.cost)        // { estimatedCost: 0.12, ... } (if admin key set)
console.log(result.steps)       // Full step results with assertions
```

## Common Patterns

### Registration Flow with Assertions

```yaml
name: "Registration Test"
target:
  base_url: "http://localhost:3000"
healthcheck:
  url: "http://localhost:3000/health"
bots:
  alpha:
    preset: default
    skills:
      - url: "http://localhost:3000/skill.md"
steps:
  - bot: alpha
    prompt: "Read the skill docs and register yourself."
    timeout: 60s
    expect:
      contains: "registered"
      not_contains: "error"
```

### Multi-Bot Conversation

```yaml
name: "Conversation Test"
target:
  base_url: "http://localhost:3000"
bots:
  alpha:
    preset: default
    user_md: presets/personas/friendly.md
    skills:
      - url: "http://localhost:3000/skill.md"
  beta:
    preset: default
    user_md: presets/personas/curious.md
    skills:
      - url: "http://localhost:3000/skill.md"
steps:
  - bot: alpha
    prompt: "Register and join a lounge."
  - bot: beta
    prompt: "Register and find the lounge alpha is in."
  - repeat: 3
    interval: 15s
    steps:
      - bot: alpha
        prompt: "Check messages and respond."
      - bot: beta
        prompt: "Check messages and respond."
```

### Cleanup After Test

```yaml
name: "Test with Cleanup"
bots:
  alpha:
    preset: default
    skills:
      - url: "http://localhost:3000/skill.md"
steps:
  - bot: alpha
    prompt: "Register and create test data."
after:
  - bot: alpha
    prompt: "Delete your account and all test data."
```

## Tips

### Timeouts

- Default step timeout is 60s. Agent responses typically take 10-30s.
- For complex multi-tool operations, use `timeout: 120s` or more.
- For simple checks, `timeout: 30s` is usually enough.

### Model Selection

- **claude-haiku-4-5** — Fastest and cheapest. Good for most tests.
- **claude-sonnet-4-5** — Better reasoning. Use for complex skill comprehension.
- Use `--model` flag to override all bots for quick experiments.

### Persona Design

- Keep personas short (2-3 sentences). Agents work well with brief, clear instructions.
- Focus on behavioral goals, not technical details.
- Use `user_md` for inline persona text or file paths for reusable personas.

### Health Checks

Always add a `healthcheck` when your scenario depends on a running target app. This prevents wasted time and confusing errors when the server isn't running:

```yaml
healthcheck:
  url: "http://localhost:3000/health"
  timeout: "5s"
```

### Cost Tracking

Set `ANTHROPIC_ADMIN_API_KEY` to automatically track API costs per scenario run. The cost report breaks down usage by model and shows estimated USD cost. Cost tracking is completely optional and non-blocking — if the admin key is missing or the API call fails, the test still runs normally.
