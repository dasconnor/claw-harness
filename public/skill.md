# ClawBench

ClawBench is a testing framework for OpenClaw bots. It drives real AI agents through multi-turn prompt sequences against target applications, validates responses with assertions, and produces structured test results.

## How to Write a Scenario

Create a YAML file that defines bots and steps:

```yaml
name: "My Test"
target:
  base_url: "http://localhost:3000"
healthcheck:
  url: "http://localhost:3000/health"
bots:
  alpha:
    preset: default
    model: anthropic/claude-haiku-4-5-20251001
    user_md: "You are a friendly test bot."
    skills:
      - url: "http://localhost:3000/skill.md"
steps:
  - bot: alpha
    prompt: "Register yourself on the platform."
    timeout: 60s
    expect:
      contains: "registered"
  - bot: alpha
    prompt: "Browse available features."
    expect:
      not_contains: "error"
after:
  - bot: alpha
    prompt: "Clean up your test data."
```

## How to Run

```bash
# Install
npm install clawbench

# Run a scenario
npx clawbench run my-test.yaml

# Override model for all bots
npx clawbench run my-test.yaml --model anthropic/claude-sonnet-4-5-20250929

# JSON output
npx clawbench run my-test.yaml --reporter json
```

## Key YAML Fields

| Field | Description |
|-------|-------------|
| `name` | Scenario name (required) |
| `target.base_url` | Target app URL |
| `healthcheck.url` | URL to check before starting |
| `bots.<id>.preset` | Config preset: `default` or `minimal` |
| `bots.<id>.model` | Model identifier |
| `bots.<id>.user_md` | Persona (file path or inline text) |
| `bots.<id>.skills` | Skills to install (`url` or `path`) |
| `steps[].bot` | Which bot runs this step |
| `steps[].prompt` | Message to send |
| `steps[].timeout` | Step timeout (e.g., `60s`, `2m`) |
| `steps[].expect.contains` | Response must include this string |
| `steps[].expect.not_contains` | Response must NOT include this string |
| `steps[].expect.matches` | Response must match this regex |
| `steps[].parallel` | Array of steps to run concurrently |
| `steps[].repeat` | Number of times to repeat sub-steps |
| `after` | Cleanup steps (run even on failure) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | API key for Claude models |
| `OPENAI_API_KEY` | No | API key for OpenAI models |
| `ANTHROPIC_ADMIN_API_KEY` | No | Enables cost tracking |

## Exit Codes

- `0` — All steps succeeded, all assertions passed
- `1` — Step error or assertion failure
