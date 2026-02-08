# OpenClaw Protocol Research

*Compiled: 2026-02-07*

Research findings on OpenClaw's gateway protocol, skills system, and deployment model for ClawBench integration.

---

## Key Finding: Two Integration Paths

OpenClaw exposes two programmatic interfaces on the same port. Both are viable for ClawBench:

### Path A: WebSocket Protocol (Full Control)

JSON-RPC-style protocol with `req/res/event` frames.

**Connection + Auth:**
```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "minProtocol": 1,
    "maxProtocol": 1,
    "auth": { "token": "your-gateway-token" },
    "client": { "name": "clawbench", "version": "0.1.0" },
    "capabilities": ["agent", "events"]
  }
}
```

**Sending a prompt to an agent:**
```json
{
  "type": "req",
  "id": "msg-001",
  "method": "agent",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "Read the skill.md and register yourself"
  }
}
```

**Response flow:**
1. Immediate ack: `{ "type": "res", "id": "msg-001", "ok": true, "payload": { "runId": "run_abc", "status": "accepted" } }`
2. Streaming events: `text_delta`, `tool_call`, `tool_output`
3. Completion: `{ "event": "agent", "payload": { "kind": "complete", "finalText": "..." } }`

**Pros:** Full visibility into tool calls, streaming, rich events.
**Cons:** More complex to implement, no published TypeScript SDK.

### Path B: OpenAI-Compatible HTTP API (Simpler)

Standard `/v1/chat/completions` endpoint on the same gateway port.

**Enabling (in openclaw.json):**
```json5
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}
```

**Usage:**
```bash
curl http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw",
    "messages": [{"role": "user", "content": "Read the skill and register"}],
    "stream": false,
    "user": "clawbench-alpha-session"
  }'
```

**Session persistence:** The `user` field derives a stable session key. Repeated calls with the same `user` value share context (multi-turn).

**Agent targeting:** Use `"model": "openclaw:main"` or header `x-openclaw-agent-id: main`.

**Pros:** Standard OpenAI SDK works, simple request/response, session persistence built-in.
**Cons:** Less visibility into tool calls (they happen server-side), no streaming events for individual tool calls.

### Recommendation for v0.1

**Start with the HTTP API.** It's dramatically simpler -- we can use the standard `fetch` API or even the OpenAI SDK. Multi-turn works via the `user` field. We get the agent's final response text, which is what we need for collecting conversation logs.

Add WebSocket support in a later version for users who want tool-call-level observability.

---

## Bot Isolation: The `--profile` Flag

OpenClaw has a built-in isolation mechanism that's perfect for our use case:

```bash
openclaw --profile alpha gateway --port 18789
openclaw --profile beta gateway --port 19001
```

This automatically scopes **all state** to `~/.openclaw-<profile>/`:
- Config: `~/.openclaw-alpha/openclaw.json`
- Skills: `~/.openclaw-alpha/workspace/skills/`
- Sessions: `~/.openclaw-alpha/agents/main/sessions/`
- Bootstrap files: `~/.openclaw-alpha/workspace/USER.md`, etc.

**Port spacing requirement:** At least 20 ports between instances (derived ports for browser control, canvas, CDP).

---

## Skills: Just Drop Files

Skills are discovered by scanning for directories containing `SKILL.md`. No CLI installation needed:

```bash
mkdir -p ~/.openclaw-alpha/workspace/skills/moltup
# Write SKILL.md there → automatically discovered
```

**Precedence (highest first):**
1. Workspace skills (`<workspace>/skills/`)
2. Managed skills (`~/.openclaw/skills/`)
3. Bundled skills (shipped with install)
4. Extra dirs (configured via `skills.load.extraDirs`)

Workspace skills override everything else, so our test skills always win.

**Hot-reload:** Enabled by default (250ms debounce). Skills changes are picked up without restart, though they take effect on new sessions.

### SKILL.md Format

```yaml
---
name: moltup
description: Social events platform for AI agents. Create jams, join meetups, chat in real-time.
metadata:
  openclaw:
    always: true    # Skip gating checks
---

# MoltUp Skill

Your instructions here...
```

Required fields: `name`, `description`. Everything else is optional.

---

## Bootstrap Files (Persona Configuration)

Each workspace can contain these files that get injected into the system prompt:

| File | Purpose | ClawBench Usage |
|------|---------|-----------------|
| `USER.md` | Who the user is, preferences | **Bot persona / instructions** |
| `AGENTS.md` | Operating rules, priorities | General agent rules |
| `SOUL.md` | Personality, tone, boundaries | Bot personality |
| `IDENTITY.md` | Agent name, emoji | Bot identity |
| `MEMORY.md` | Long-term memory | Not used (fresh per test) |
| `BOOTSTRAP.md` | First-run instructions (deleted after) | Could use for one-time setup |

All live in workspace root: `~/.openclaw-<profile>/workspace/`

Max size: 20,000 chars each (default, configurable via `bootstrapMaxChars`).

**For ClawBench, the key files are:**
- `USER.md` — persona and behavioral instructions
- `SOUL.md` — personality boundaries (optional)
- Skills in `workspace/skills/` — what the bot can do

---

## Agent Configuration (openclaw.json)

Minimal config for a test bot:

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

Key settings:
- `skills.allowBundled: []` — disables all bundled skills so only our test skills are active
- `gateway.http.endpoints.chatCompletions.enabled: true` — enables the HTTP API
- `agents.defaults.model.primary` — the model to use

---

## Headless Operation

**The gateway is fully headless.** It's a WebSocket/HTTP server that doesn't need a TTY.

**The onboarding wizard is interactive.** But we bypass it entirely by pre-generating `openclaw.json` configs. The gateway starts fine with a pre-existing config.

**The `--allow-unconfigured` flag** lets the gateway start even without complete configuration.

**Environment variables for API keys:**
- `ANTHROPIC_API_KEY` — for Claude models
- `OPENAI_API_KEY` — for OpenAI models

---

## ClawBench Workspace Setup Recipe

For each bot, ClawBench will:

```bash
# 1. Create profile directory
mkdir -p ~/.openclaw-clawbench-alpha/workspace/skills/moltup

# 2. Write openclaw.json (from preset + overrides)
# → ~/.openclaw-clawbench-alpha/openclaw.json

# 3. Fetch and write skill.md
curl -s http://localhost:3000/skill.md > \
  ~/.openclaw-clawbench-alpha/workspace/skills/moltup/SKILL.md

# 4. Write persona (user.md)
# → ~/.openclaw-clawbench-alpha/workspace/USER.md

# 5. Start gateway
ANTHROPIC_API_KEY=sk-ant-xxx \
openclaw --profile clawbench-alpha gateway --port 18789 &

# 6. Send prompts via HTTP API
curl http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer clawbench-alpha-token" \
  -d '{"model":"openclaw","messages":[{"role":"user","content":"..."}],"user":"test-session"}'

# 7. Cleanup
kill %1
rm -rf ~/.openclaw-clawbench-alpha
```

---

## Open Questions Resolved

| Question | Answer |
|----------|--------|
| How to send prompts? | HTTP `/v1/chat/completions` for v0.1, WebSocket for later |
| How to maintain session? | `"user"` field in HTTP request body |
| How to isolate bots? | `--profile` flag scopes all state automatically |
| How to install skills? | Drop `SKILL.md` in workspace skills dir |
| How to set persona? | Write `USER.md` in workspace root |
| How to configure model? | `agents.defaults.model.primary` in openclaw.json |
| How to run headless? | Pre-generate config, gateway runs without TTY |
| Port spacing? | 20+ ports between instances |

## Remaining Unknowns

1. **Exact HTTP response format** — Need to test what `/v1/chat/completions` returns for tool calls. It likely follows OpenAI format but tool execution details may be opaque.
2. **Session key derivation** — The `user` field hashes to a session key; the exact algorithm isn't documented. Need to verify multi-turn actually works.
3. **Gateway startup time** — How long until the gateway is ready to accept connections? We'll need a health check polling loop.
4. **Cleanup behavior** — What happens to profile dirs on unclean shutdown? May need a cleanup step.
