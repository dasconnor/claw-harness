# ClawBench Spec

*Created: 2026-02-07*

## Overview

ClawBench is a standalone, open-source testing framework for OpenClaw bots. It spins up real OpenClaw agent instances, loads configurable skills and personas, drives them with multi-turn prompts, and captures their responses for evaluation.

The core use case: **can a real AI agent, given only your skill.md, figure out how to use your site?**

Unlike API-level test harnesses that call endpoints directly, ClawBench tests the full agent experience end-to-end -- skill comprehension, API discovery, tool usage, and multi-agent interaction.

---

## Core Concepts

### The Fundamental Primitive

```ts
const response = await bot.send("Read the skill.md and register yourself")
// → { text: "I've registered as...", toolCalls: [...], duration: 12400 }
```

A test scenario is a sequence of prompt/response exchanges across one or more bots, with optional evaluation at the end.

### Three-Layer Configuration

Each bot receives three layers of context:

1. **Skills** (what the bot CAN do) -- Fetched from a URL or local path. This is the thing you're testing. The bot gets skills installed into its OpenClaw skills directory and has to figure out the API from them.

2. **Persona** (who the bot IS) -- A `user.md` system prompt. "You're a friendly, curious bot" vs "You're a terse technical bot." Lets you test how different bot personalities interact with your site.

3. **Prompts** (what the bot SHOULD do) -- Multi-turn instruction messages sent to the bot. Goal-oriented, not step-by-step. The less hand-holding, the better the test of your skill.md.

### Isolation Model

Each bot gets:
- Its own OpenClaw gateway (separate process or container)
- Its own isolated workspace directory
- Its own agent configuration, skills, and persona

No shared state between bots. They interact only through the target application.

---

## Architecture

```
┌────────────────────────────────┐
│     Test Scenario (YAML)       │
│  bots, prompts, evaluation     │
└───────────┬────────────────────┘
            ▼
┌────────────────────────────────┐
│      Bot Orchestrator          │
│  creates workspaces            │
│  spawns gateways               │
│  drives prompt sequences       │
│  collects responses            │
└──────┬─────────────┬───────────┘
       ▼             ▼
  ┌──────────┐  ┌──────────┐
  │ Gateway  │  │ Gateway  │
  │ + Agent  │  │ + Agent  │
  │ (Alpha)  │  │ (Beta)   │
  └────┬─────┘  └────┬─────┘
       │              │
       └──────┬───────┘  HTTP/WS
              ▼
┌────────────────────────────────┐
│     Target App                 │
│  serves skill.md + API         │
└───────────┬────────────────────┘
            ▼
┌────────────────────────────────┐
│     Evaluation (pluggable)     │
│  logs, API checks, LLM judge  │
└────────────────────────────────┘
```

---

## Bot Workspace Structure

Each bot gets a fully isolated workspace directory:

```
workspaces/alpha/
├── openclaw.json        # gateway + agent config
├── user.md              # persona / system instructions
└── skills/
    ├── moltup/
    │   └── SKILL.md     # fetched from URL or local path
    └── another-skill/
        └── SKILL.md
```

---

## Test Scenario Format (YAML)

```yaml
name: "Lounge Conversation Test"
description: "Test that bots can discover and chat in MoltUp lounges"

target:
  base_url: "http://localhost:3000"

bots:
  alpha:
    # Start from a preset, override what you need
    preset: default
    model: claude-haiku-4-5-20251001
    user_md: ./personas/friendly.md
    config_overrides:
      agent:
        thinking: low
    skills:
      - url: "{{target.base_url}}/skill.md"
      - path: "./skills/custom-tool.md"

  beta:
    preset: default
    model: claude-haiku-4-5-20251001
    skills:
      - url: "{{target.base_url}}/skill.md"
    user_md: |
      You are a curious, thoughtful bot. Ask interesting questions
      and engage deeply with conversation partners.

steps:
  - bot: alpha
    prompt: "Read the MoltUp skill and register yourself as a bot."
    timeout: 60s

  - bot: beta
    prompt: "Read the MoltUp skill and register yourself."
    timeout: 60s

  - bot: alpha
    prompt: "Browse for active lounges and join one. Introduce yourself."
    timeout: 60s

  - bot: beta
    prompt: "Find an active lounge with another bot and join the conversation."
    timeout: 60s

  # Repeat block for back-and-forth
  - repeat: 3
    interval: 15s
    steps:
      - bot: alpha
        prompt: "Check for new messages in the lounge and respond."
        timeout: 30s
      - bot: beta
        prompt: "Check for new messages and continue the conversation."
        timeout: 30s

  # Parallel prompts
  - parallel:
      - bot: alpha
        prompt: "Say goodbye and leave the lounge."
      - bot: beta
        prompt: "Say goodbye and leave the lounge."

# Optional evaluation
evaluate:
  # Tier 1: just collect outputs (default -- conversation log IS the eval)

  # Tier 2: API state checks
  - type: api
    url: "{{target.base_url}}/api/lounges/{{vars.lounge_id}}/messages"
    assert: "messages.length >= 6"

  # Tier 3: LLM judge
  - type: llm_judge
    model: claude-haiku-4-5-20251001
    input: conversation_log
    prompt: |
      Rate this bot conversation:
      - Coherence (1-5): Do messages follow logically?
      - API competence (1-5): Did bots correctly use the skill.md?
      - Naturalness (1-5): Does it feel like a real conversation?
      Return JSON: { coherence: N, api_competence: N, naturalness: N }
```

---

## Programmatic API

```ts
import { ClawBench } from 'clawbench'

const bench = new ClawBench({ mode: 'local' })

const alpha = bench.bot('alpha', {
  preset: 'default',
  model: 'claude-haiku-4-5-20251001',
  skills: [{ url: 'http://localhost:3000/skill.md' }],
  userMd: './personas/friendly.md',
})

const beta = bench.bot('beta', {
  preset: 'default',
  skills: [{ url: 'http://localhost:3000/skill.md' }],
  userMd: 'You are a curious, thoughtful bot.',
})

await bench.start()

const r1 = await alpha.send("Register yourself on MoltUp")
const r2 = await beta.send("Register yourself on MoltUp")
const r3 = await alpha.send("Find a lounge and join it.")
const r4 = await beta.send("Find the lounge Alpha is in and chat.")

// Each response has the full agent output
console.log(r3.text)       // agent's text response
console.log(r3.toolCalls)  // tools it invoked
console.log(r3.duration)   // how long it took

// Get full conversation log
const log = bench.getConversationLog()

await bench.stop()
```

---

## CLI

```bash
# Run a scenario
clawbench run scenarios/lounge-chat.yaml

# Run with overrides
clawbench run scenarios/lounge-chat.yaml \
  --model claude-sonnet-4-5-20250929 \
  --timeout 300

# Output formats
clawbench run scenarios/lounge-chat.yaml --reporter json > results.json
clawbench run scenarios/lounge-chat.yaml --reporter markdown

# Scaffold a new scenario
clawbench init my-scenario

# List available presets
clawbench presets
```

---

## Package Structure

```
clawbench/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                # Public API exports
│   ├── bench.ts                # ClawBench main class
│   ├── bot.ts                  # Bot instance (workspace + gateway + agent)
│   ├── workspace.ts            # Creates isolated workspace dirs
│   ├── gateway.ts              # Starts/stops OpenClaw gateway processes
│   ├── agent-client.ts         # WebSocket client for agent communication
│   ├── scenario-loader.ts      # YAML parsing + validation
│   ├── runner.ts               # Step execution engine
│   ├── evaluate/
│   │   ├── api-check.ts
│   │   ├── llm-judge.ts
│   │   └── index.ts
│   └── reporters/
│       ├── json.ts
│       ├── markdown.ts
│       └── console.ts
├── presets/
│   ├── configs/
│   │   ├── default.json        # Sensible openclaw.json defaults
│   │   └── minimal.json        # Minimal tools, low cost
│   ├── personas/
│   │   ├── friendly.md
│   │   ├── curious.md
│   │   └── terse.md
│   └── scenarios/
│       └── example-chat.yaml
└── bin/
    └── clawbench.ts            # CLI entry point
```

---

## Scope

### v0.1

- Local process execution mode only (no Docker)
- YAML scenario files with per-bot config
- Multi-turn prompt sequences (serial, repeat, parallel)
- Per-bot skills, user.md, and openclaw.json configuration
- Preset system for reusable configs
- Console + JSON reporters
- Conversation log collection (no built-in eval -- logs are the output)
- CLI: `clawbench run`, `clawbench init`, `clawbench presets`
- Programmatic API for integration with test frameworks (Vitest, Jest, etc.)

### v0.2 (Future)

- Docker execution mode
- LLM-as-judge evaluation
- API state check assertions
- Template variables in scenarios (e.g., `{{target.base_url}}`)
- Watch mode for iterating on skill.md

### v0.3+ (Future)

- Scenario recording (run manually, record as YAML)
- Comparative runs (A/B test two skill.md versions)
- CI/CD integration helpers
- ClawHub skill testing (test published skills)

---

## Integration with OpenClaw

*Based on protocol research — see [RESEARCH-OPENCLAW-PROTOCOL.md](./RESEARCH-OPENCLAW-PROTOCOL.md) for full details.*

### Communication: HTTP API (v0.1) → WebSocket (future)

OpenClaw exposes an **OpenAI-compatible HTTP API** (`/v1/chat/completions`) on the same gateway port. For v0.1, we use this:

```ts
const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${gatewayToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'openclaw',
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    user: sessionId,  // stable session key for multi-turn
  }),
})
```

The `user` field provides **multi-turn session persistence** — repeated calls with the same value share conversation context. This is exactly the primitive we need.

Requires enabling in config: `gateway.http.endpoints.chatCompletions.enabled: true`.

Future versions can add the WebSocket protocol for streaming and tool-call-level observability.

### Bot Isolation: `--profile` Flag

OpenClaw's `--profile` flag scopes all state automatically:

```bash
openclaw --profile clawbench-alpha gateway --port 18789
# All state lives under ~/.openclaw-clawbench-alpha/
```

Each profile gets its own config, workspace, skills, and sessions. Port spacing of 20+ is required between instances.

### Skills Installation: Drop Files

No CLI needed. Drop a `SKILL.md` in the workspace skills directory:

```
~/.openclaw-clawbench-alpha/workspace/skills/moltup/SKILL.md
```

Workspace skills have highest precedence. Set `skills.allowBundled: []` to disable all bundled skills.

### Persona: USER.md + SOUL.md

Bootstrap files in the workspace root get injected into the system prompt:

- `USER.md` — persona, behavioral instructions
- `SOUL.md` — personality, tone, boundaries (optional)

### Minimal Bot Config (openclaw.json)

```json5
{
  "gateway": {
    "mode": "local",
    "port": 18789,
    "auth": { "token": "clawbench-alpha-token" },
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-haiku-4-5-20251001" },
      "tools": { "profile": "full" }
    },
    "list": [
      { "id": "main", "default": true }
    ]
  },
  "skills": {
    "allowBundled": []
  }
}
```

### Bot Lifecycle (what ClawBench does per bot)

1. Create profile directory (`~/.openclaw-clawbench-<id>/`)
2. Write `openclaw.json` from preset + overrides
3. Fetch skill.md(s) from URL or copy from local path into `workspace/skills/`
4. Write `USER.md` (persona) into `workspace/`
5. Start gateway: `openclaw --profile clawbench-<id> gateway --port <port>`
6. Health-check poll until ready
7. Send prompts via HTTP `/v1/chat/completions`
8. Collect responses
9. Kill gateway process
10. Clean up profile directory

---

## Design Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Isolation model | One gateway per bot | True isolation, no shared state, simpler reasoning |
| Instruction model | Multi-turn prompts (not goals) | More control, inspectable per-step, flexible |
| Config model | Per-bot with presets | Maximum flexibility, DRY via presets |
| Evaluation | Pluggable, optional | MoltUp case: logs are the eval. Others may want LLM judge. |
| Package scope | Standalone open-source | Useful beyond MoltUp for any site with a skill.md |
| v0.1 execution | Local process only | Simpler, faster to build, Docker in v0.2 |
