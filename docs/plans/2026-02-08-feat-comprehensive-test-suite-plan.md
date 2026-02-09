---
title: "feat: Comprehensive test suite to exercise claw-harness framework"
type: feat
date: 2026-02-08
deepened: 2026-02-08
---

# Comprehensive Test Suite for Claw Harness

## Enhancement Summary

**Deepened on:** 2026-02-08
**Review agents used:** kieran-typescript-reviewer, code-simplicity-reviewer, pattern-recognition-specialist, architecture-strategist, Context7 (Vitest docs)

### Key Improvements
1. Reduced scope from ~35 to ~18 high-value tests — cut redundant and implementation-detail tests
2. Added Step 0: vitest.config.ts safety nets (`restoreMocks`, `unstubGlobals`, `unstubEnvs`)
3. Replaced fragile `globalThis.fetch` monkey-patching with `vi.stubGlobal('fetch', ...)`
4. Added `vi.useFakeTimers()` strategy for gateway polling/timeout tests
5. Added `createMockChildProcess()` shared helper using EventEmitter for gateway tests
6. Clarified integration test wiring: port coordination, token handoff, mock boundary
7. Added invalid regex regression test (test-then-fix for known crash bug)
8. Standardized test names to bare verb form (existing convention)

### Tests Cut (from simplicity review)
- `bench.test.ts`: "zero assertions" (add as assertion in existing test)
- `runner.test.ts`: "after steps on error" and "propagate error" (merge into one; existing test at line 254 nearly identical)
- `runner.test.ts`: "all assertion types on single step" (each type already individually tested)
- `gateway.test.ts`: "spawn args" and "read token" (implementation details, fragile)
- `gateway.test.ts`: "SIGTERM then SIGKILL" (implementation detail)
- `workspace.test.ts`: "full setup flow" (already covered by 8 existing tests)
- `workspace.test.ts`: "preset loading" (implicitly tested via bot.test.ts)
- `docker-gateway.test.ts`: "macOS args" (already exists at line 62)
- `docker-gateway.test.ts`: "poll health" (duplicates gateway proposal)
- `cost-tracker.test.ts`: "60s buffer" (brittle implementation detail)
- `integration.test.ts`: entire file (coverage already exists via unit tests; mock HTTP server adds infrastructure for marginal gain; session ID test moved to agent-client.test.ts)

---

## Overview

Build a test suite that fills the coverage gaps in claw-harness, exercising under-tested modules to verify the framework works. The current suite has 82 passing tests but relies heavily on mocking and leaves key flows untested.

## Problem Statement

The existing test suite validates individual modules in isolation but does not exercise:
- Gateway lifecycle (start/waitForReady/stop) — the most failure-prone component
- Runner edge cases (parallel steps, timeouts)
- Assertion aggregation in `getResults()` — directly impacts CLI exit codes
- `.env` file loading — the primary way users configure API keys
- Invalid regex handling in assertion evaluation (known crash bug)

## Proposed Solution

Add ~18 new tests across 6 existing test files, following existing patterns (co-located tests, `vi.mock`, `vi.stubGlobal`, `tmpdir` for filesystem). No new test files needed.

## Technical Approach

### Step 0: Update `vitest.config.ts` (Do This First)

Add safety nets to prevent test pollution. This eliminates an entire class of bugs before any new tests are written.

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    restoreMocks: true,       // auto vi.restoreAllMocks() after each test
    unstubEnvs: true,          // auto vi.unstubAllEnvs() after each test
    unstubGlobals: true,       // auto vi.unstubAllGlobals() after each test
    testTimeout: 10_000,       // explicit default, catches runaway tests
  },
})
```

### Research Insights: Vitest Mock Hygiene

**Best Practices (from reviews + Vitest docs):**
- Use `vi.stubGlobal('fetch', mockFn)` instead of manual `globalThis.fetch = ...` assignment. With `unstubGlobals: true` in config, it auto-restores even if tests throw.
- Use `vi.stubEnv('KEY', 'value')` instead of `process.env.KEY = ...`. With `unstubEnvs: true`, it auto-restores.
- Use `vi.useFakeTimers()` with `vi.advanceTimersByTimeAsync()` for polling/timeout tests. Always pair with `vi.useRealTimers()` in `afterEach`.
- Always include `beforeEach(() => { vi.clearAllMocks() })` in any describe block that uses `vi.mock()`.

**Anti-Patterns to Avoid:**
- Never assign `globalThis.fetch` directly — if an assertion throws before restore, fetch is permanently corrupted for subsequent tests.
- Never test polling loops with real timers — a 30s `waitForReady` timeout means 30s of real test execution time.

### Shared Test Helper: `createMockChildProcess()`

Gateway and DockerGateway tests both need a mock that can simulate event emission (exit, error). Create a minimal shared helper:

```typescript
// src/test-helpers.ts
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

export function createMockChildProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess & EventEmitter
  proc.stdout = new EventEmitter() as any
  proc.stderr = new EventEmitter() as any
  proc.stdin = null
  proc.pid = 12345
  proc.killed = false
  proc.kill = vi.fn(() => { proc.killed = true; return true })
  return proc
}
```

This enables `proc.emit('exit', 1)` in tests to simulate early process exit, which is impossible with the current `{ on: vi.fn() }` mock pattern in docker-gateway.test.ts.

### Mocking Strategy

- **Gateway/DockerGateway**: Mock `node:child_process.spawn` (returning `createMockChildProcess()`), mock `globalThis.fetch` via `vi.stubGlobal`, use `vi.useFakeTimers()` for polling tests
- **Env vars**: Use `vi.stubEnv()` (auto-restored by vitest config)
- **Fetch**: Use `vi.stubGlobal('fetch', vi.fn())` (auto-restored by vitest config)

### Naming Convention

Use bare verb form to match existing tests (not "should" prefix):

- `'aggregates assertion counts across steps'` (not `'should aggregate...'`)
- `'polls OPTIONS until gateway is ready'` (not `'should poll...'`)
- `'detects early process exit'` (not `'should detect...'`)

---

### Tests to Add

#### 1. `bench.test.ts` — Assertion Aggregation + Config (2 tests)

```typescript
// src/bench.test.ts — add to existing describe block

it('aggregates assertion counts across steps', () => {
  const bench = new ClawHarness({ mode: 'local' })
  bench.bot('alpha', { preset: 'default' })

  bench.recordStep({
    botId: 'alpha',
    prompt: 'Step 1',
    response: { text: 'ok', raw: {}, duration: 50, ok: true },
    timestamp: new Date().toISOString(),
    assertions: [
      { type: 'contains', expected: 'ok', passed: true },
      { type: 'not_contains', expected: 'error', passed: true },
    ],
  })

  bench.recordStep({
    botId: 'alpha',
    prompt: 'Step 2',
    response: { text: 'fail', raw: {}, duration: 50, ok: true },
    timestamp: new Date().toISOString(),
    assertions: [
      { type: 'contains', expected: 'success', passed: false },
    ],
  })

  const results = bench.getResults()
  expect(results.assertions).toEqual({ total: 3, passed: 2, failed: 1 })
  // Also verify zero case: steps without assertions should not affect counts
})

it('populates config from env vars', () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key')
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key')
  const bench = new ClawHarness({ mode: 'local' })
  // Verify config reflects env values
  // (implementation detail: access via bench.config or verify through bot creation)
})
```

#### 2. `runner.test.ts` — Parallel Steps, Timeout, Invalid Regex (3 tests)

```typescript
// src/runner.test.ts — add to existing describe block

it('executes parallel steps concurrently', async () => {
  // Write YAML scenario with parallel: block containing 2 steps for different bots
  // Verify both bots receive send() calls
  // Verify one sub-step failure (mockBot.send rejects) does not prevent the other
  // Key: runner uses Promise.allSettled, not Promise.all
})

it('times out a step that exceeds its duration', async () => {
  // Write YAML scenario with step timeout: "500ms"
  // Mock bot.send() to return a never-resolving promise
  // Use vi.useFakeTimers() + vi.advanceTimersByTimeAsync(600)
  // Verify step result has ok: false with timeout error message
  // Verify subsequent steps still execute
})

it('marks invalid regex assertion as failed instead of crashing', async () => {
  // Write YAML scenario with expect: { matches: '[unclosed' }
  // NOTE: Current code THROWS here (runner.ts:227 new RegExp('[unclosed'))
  // This test documents the crash; fix wraps in try/catch
  // After fix: verify assertion result has passed: false
})
```

**Research Insight — Invalid Regex Bug Fix:**
The `evaluateAssertions` function at `runner.ts:225` does `new RegExp(expect.matches).test(text)`. This throws on invalid regex. The fix is:
```typescript
try {
  passed = new RegExp(expect.matches).test(text)
} catch {
  passed = false  // Invalid regex always fails
}
```
Test this first (demonstrates the crash), then fix, then verify the test passes.

**Research Insight — Export `evaluateAssertions` for Direct Testing:**
Consider exporting `evaluateAssertions` from `runner.ts`. It is a pure function that can be tested with zero mocking, which is far more maintainable than testing it indirectly through the `runScenario` mock setup. This would enable:
```typescript
import { evaluateAssertions } from './runner.js'

it('evaluates compound assertions', () => {
  const results = evaluateAssertions('hello world', {
    contains: 'hello',
    not_contains: 'goodbye',
    matches: 'h.*d',
  })
  expect(results).toEqual([
    { type: 'contains', expected: 'hello', passed: true },
    { type: 'not_contains', expected: 'goodbye', passed: true },
    { type: 'matches', expected: 'h.*d', passed: true },
  ])
})
```

#### 3. `utils.test.ts` — loadEnvFiles + deepMerge null (4 tests)

```typescript
// src/utils.test.ts — add new describe('loadEnvFiles', ...) block

describe('loadEnvFiles', () => {
  it('parses KEY=value pairs, skipping comments and blank lines', () => {
    // Write .env to tmpdir:
    //   # comment
    //   FOO=bar
    //
    //   BAZ=qux=extra
    // Call loadEnvFiles([tmpPath])
    // Verify process.env.FOO === 'bar'
    // Verify process.env.BAZ === 'qux=extra' (handles = in values)
  })

  it('strips quotes from values', () => {
    // Write .env: SINGLE='single' and DOUBLE="double"
    // Verify values are unquoted
  })

  it('does not override existing env vars and skips missing files', () => {
    vi.stubEnv('EXISTING', 'original')
    // Write .env: EXISTING=overridden, NEW=fresh
    // Call loadEnvFiles([tmpPath, '/nonexistent/.env'])
    // Verify EXISTING still === 'original'
    // Verify NEW === 'fresh'
    // Verify no error thrown for missing file
  })
})

// Add to existing describe('deepMerge', ...) block

it('replaces object with null', () => {
  expect(deepMerge({ a: { nested: true } }, { a: null })).toEqual({ a: null })
})
```

#### 4. `gateway.test.ts` — Polling, Timeout, Early Exit (3 tests)

```typescript
// src/gateway.test.ts — add tests with mocked spawn + fetch + fake timers
// Import: createMockChildProcess from './test-helpers.js'

// Mock child_process.spawn to return createMockChildProcess()
// Mock fs/promises.readFile to return openclaw.json with token

it('polls OPTIONS until gateway is ready', async () => {
  vi.useFakeTimers()
  const mockFetch = vi.fn()
    .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    .mockResolvedValueOnce({ ok: true })
  vi.stubGlobal('fetch', mockFetch)

  // Start gateway, advance timers past 2 polling intervals
  // Verify gateway resolves successfully
  // Verify fetch called 3 times (fail, fail, success)
  vi.useRealTimers()
})

it('throws after waitForReady timeout', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

  // Start gateway, advance timers past 30s timeout
  await vi.advanceTimersByTimeAsync(31_000)
  // Verify rejects with 'did not become ready'
  vi.useRealTimers()
})

it('detects early process exit', async () => {
  const mockProc = createMockChildProcess()
  // Mock spawn to return mockProc
  // Immediately emit: mockProc.emit('exit', 1)
  // Verify start() rejects with error about early exit
})
```

**Research Insight — Fake Timers with Async Polling:**
Gateway's `waitForReady()` uses `await fetch()` + `await new Promise(resolve => setTimeout(resolve, 500))` in a while loop. With fake timers, the `setTimeout` is controlled but `fetch` resolves immediately (mocked). Use `vi.advanceTimersByTimeAsync()` (not `advanceTimersByTime`) to properly flush promise microtasks between timer advances. This is a known Vitest pattern for async polling loops.

#### 5. `workspace.test.ts` — Skill Installation (1 test)

```typescript
// src/workspace.test.ts — add to existing describe block

it('installs skills from URL during setup', async () => {
  // Mock globalThis.fetch for skill URL
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve('# Skill Content\nThis is a skill.'),
  }))

  // Create workspace with skills: [{ url: 'https://example.com/skill.md', name: 'test-skill' }]
  // Call setup()
  // Verify skill file written to workspace skills directory
  // Verify file contains expected content
})
```

**Research Insight — Isolate from `$HOME`:**
Workspace tests write to `$HOME/.openclaw-claw-harness-<id>/`. Consider using `vi.stubEnv('HOME', tmpdir())` to redirect all workspace operations into a temp directory, preventing filesystem side effects in the real home directory on test failure.

#### 6. `docker-gateway.test.ts` — ensureImage Ordering (1 test)

```typescript
// src/docker-gateway.test.ts — add to existing describe block

it('calls ensureImage before spawning container', async () => {
  // Mock ensureImage, mock spawn, mock readFile
  // Call start()
  // Verify ensureImage called before spawn (via mock.invocationCallOrder)
})
```

#### 7. `agent-client.test.ts` — Session ID Threading (1 test)

```typescript
// src/agent-client.test.ts — add to existing describe block
// (Replaces integration.test.ts multi-turn test — tests the same behavior without HTTP server infrastructure)

it('sends consistent session ID across multi-turn requests', async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      choices: [{ message: { content: 'response' } }],
    }),
  })
  vi.stubGlobal('fetch', mockFetch)

  const client = new AgentClient(18800, 'test-token')
  await client.send('first message')
  await client.send('second message')

  // Verify both fetch calls include the same 'user' field (session ID)
  const body1 = JSON.parse(mockFetch.mock.calls[0][1].body)
  const body2 = JSON.parse(mockFetch.mock.calls[1][1].body)
  expect(body1.user).toBeDefined()
  expect(body1.user).toBe(body2.user)
})
```

---

## Test Count Summary

| File | New Tests | What They Cover |
|---|---|---|
| `bench.test.ts` | 2 | Assertion aggregation, config from env |
| `runner.test.ts` | 3 | Parallel steps, step timeout, invalid regex |
| `utils.test.ts` | 4 | loadEnvFiles (3), deepMerge null (1) |
| `gateway.test.ts` | 3 | Polling, timeout, early exit |
| `workspace.test.ts` | 1 | Skill installation from URL |
| `docker-gateway.test.ts` | 1 | ensureImage ordering |
| `agent-client.test.ts` | 1 | Session ID consistency |
| `test-helpers.ts` | 0 | Shared mock helper (no tests itself) |
| **vitest.config.ts** | 0 | Safety nets (restoreMocks, unstubEnvs, unstubGlobals) |
| **Total** | **~18** | |

**Final count: 82 existing + ~18 new = ~100 tests**

## Acceptance Criteria

- [x] `vitest.config.ts` updated with `clearMocks`, `unstubEnvs`, `unstubGlobals`, `testTimeout`
- [x] `src/test-helpers.ts` created with `createMockChildProcess()` helper
- [x] All existing 82 tests continue passing
- [x] `bench.test.ts`: assertion aggregation in `getResults()` verified (total/passed/failed)
- [x] `runner.test.ts`: parallel step execution and step timeout tested
- [x] `runner.test.ts`: invalid regex in `matches` field handled gracefully (bug fix included)
- [x] `utils.test.ts`: `loadEnvFiles()` tested (parsing, quoting, no-override, missing files)
- [x] `utils.test.ts`: `deepMerge` null handling documented with test
- [x] `gateway.test.ts`: `waitForReady()` polling, timeout, and early exit tested with fake timers
- [x] `workspace.test.ts`: skill installation from URL tested
- [x] `docker-gateway.test.ts`: ensureImage ordering verified
- [x] `agent-client.test.ts`: session ID consistency across multi-turn requests verified
- [x] `npm test` passes with all new + existing tests (98 total)
- [x] No tests make real API calls or spawn real processes
- [x] All new tests use bare verb form naming convention
- [x] All fetch mocking uses `vi.stubGlobal` (not manual assignment)

## Known Issues

- **`evaluate` field**: Defined in types but unimplemented — ignore in test suite.
- **CLI (bin/clawbench.ts)**: Zero coverage. Out of scope — file follow-up issue to refactor CLI into thin wrapper over testable `main()` function.

## Dependencies & Risks

- **No external dependencies needed** — all testing infrastructure (Vitest, Node http module) is already available
- **Risk**: Gateway tests depend on internal implementation of `waitForReady` polling loop — mitigated by testing behavior (resolves/rejects) not internals (exact poll count)
- **Risk**: Fake timer interaction with async polling — mitigated by using `vi.advanceTimersByTimeAsync()` (not sync version)
- **Risk**: Runner test mock drift — the ClawHarness mock in runner.test.ts (lines 15-60) reimplements behavior; consider adding `satisfies ScenarioResult` type check on mock return values

## References

- Existing test files: `src/*.test.ts` (10 files, 82 tests)
- Vitest docs: https://vitest.dev/
- Vitest fake timers: https://main.vitest.dev/guide/mocking/timers
- Vitest `vi.stubGlobal`: https://main.vitest.dev/api/vi#vi-stubglobal
- Key source files: `bench.ts`, `runner.ts`, `gateway.ts`, `workspace.ts`, `utils.ts`, `agent-client.ts`
- Project conventions: `CLAUDE.md`, ESM imports use `.js` extension
