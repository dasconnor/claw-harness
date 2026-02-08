# Claw Harness

## What This Is

Claw Harness is a testing framework for OpenClaw bots. It spins up real OpenClaw agent instances with configurable skills and personas, drives them with multi-turn prompts, and captures responses.

## Key Architecture Decisions

- One OpenClaw gateway per bot (true isolation via `--profile` flag)
- Communication via OpenClaw's HTTP API (`/v1/chat/completions`) for v0.1
- Skills installed by dropping SKILL.md files in workspace dirs
- Personas configured via USER.md in workspace root
- Multi-turn sessions via the `user` field in HTTP requests

## Important Files

- `docs/SPEC.md` — Full design spec
- `docs/RESEARCH-OPENCLAW-PROTOCOL.md` — Protocol research findings
- `presets/` — Pre-baked configs, personas, and example scenarios

## Development

- TypeScript, ESM modules, Node >= 22
- Tests: `npm test` (vitest)
- Build: `npm run build`
