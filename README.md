# Claw Harness

Testing framework for [OpenClaw](https://openclaw.ai) bots. Spin up real agent instances, load skills and personas, drive multi-turn prompts, and capture results.

**Can a real AI agent, given only your skill.md, figure out how to use your site?**

Unlike API-level test harnesses, Claw Harness tests the full agent experience end-to-end — skill comprehension, API discovery, tool usage, and multi-agent interaction.

## Quick Start

```bash
npm install claw-harness
```

**Prerequisites:**
- Node.js >= 22
- OpenClaw installed (`npm install -g openclaw@latest`)
- `ANTHROPIC_API_KEY` set in environment

### Run a scenario

```bash
# Scaffold a new scenario from the example template
claw-harness init my-test

# Run it
claw-harness run my-test.yaml

# Output as JSON
claw-harness run my-test.yaml --reporter json > results.json
```

### Programmatic API

```ts
import { ClawHarness } from 'claw-harness'

const bench = new ClawHarness({ mode: 'local' })

const bot = bench.bot('alpha', {
  preset: 'default',
  skills: [{ url: 'http://localhost:3000/skill.md', name: 'my-app' }],
  userMd: 'You are a friendly bot.',
})

await bench.start()
const response = await bot.send('Register yourself on the platform')
console.log(response.text)
await bench.stop()
```

## Scenario Format

Scenarios are YAML files that define bots and a sequence of steps:

```yaml
name: "Chat Test"

bots:
  alpha:
    preset: default
    model: anthropic/claude-haiku-4-5-20251001
    user_md: presets/personas/friendly.md
    skills:
      - url: "http://localhost:3000/skill.md"
        name: target-app

  beta:
    preset: default
    user_md: presets/personas/curious.md
    skills:
      - url: "http://localhost:3000/skill.md"
        name: target-app

steps:
  # Serial steps
  - bot: alpha
    prompt: "Read the skill docs and register yourself."
    timeout: 60s

  - bot: beta
    prompt: "Register yourself on the platform."
    timeout: 60s

  # Parallel steps
  - parallel:
      - bot: alpha
        prompt: "Join a lounge and introduce yourself."
      - bot: beta
        prompt: "Find a lounge with another bot and join."

  # Repeat block
  - repeat: 3
    interval: 15s
    steps:
      - bot: alpha
        prompt: "Check for new messages and respond."
        timeout: 30s
      - bot: beta
        prompt: "Check for new messages and respond."
        timeout: 30s
```

## CLI

```
claw-harness run <scenario.yaml> [options]   Run a test scenario
claw-harness init [name]                     Scaffold a new scenario
claw-harness presets                         List available presets

Options:
  --model <model>       Override model for all bots
  --reporter <format>   Output format: console (default) | json
```

## Presets

Claw Harness ships with presets for common configurations:

**Configs** — merged into each bot's `openclaw.json`:
- `default` — Full tools, Haiku model
- `minimal` — Restricted tools, lower cost

**Personas** — `user.md` templates that shape bot behavior:
- `friendly` — Outgoing, asks follow-up questions
- `curious` — Thoughtful, explores ideas deeply
- `terse` — Brief, technical, to the point

## How It Works

Each bot gets full isolation:

1. **Workspace** — A dedicated profile directory (`~/.openclaw-claw-harness-<id>/`) with its own `openclaw.json`, `USER.md`, and skills
2. **Gateway** — Its own OpenClaw gateway process on a dedicated port
3. **Communication** — Prompts sent via the OpenAI-compatible HTTP API (`/v1/chat/completions`)

Bots have no shared state. They interact only through the target application, just like real users would.

## Development

```bash
git clone https://github.com/dasconnor/claw-harness.git
cd claw-harness
npm install
npm test          # Run tests (vitest)
npm run build     # Build to dist/
npm run lint      # Type check
```

## License

MIT
