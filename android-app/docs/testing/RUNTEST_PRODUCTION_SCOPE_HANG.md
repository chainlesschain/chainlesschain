# `runTest` + production-scope while-delay = silent hang

**For**: Developers debugging unit tests that hang in Gradle CI without producing PASSED/FAILED events
**Source**: Real incident on `:core-p2p:testDebugUnitTest`, root-caused 2026-05-11 — see [commit chain](#commit-chain) and [issue #10](https://github.com/chainlesschain/chainlesschain/issues/10)

---

## Symptom

A `:core-X:testDebugUnitTest` Gradle task runs for 10+ minutes without emitting any per-test `STARTED` / `PASSED` / `FAILED` event before being killed by either the Test task timeout (if configured) or the job-level timeout. The Gradle log only shows compilation and the `> Task :core-X:testDebugUnitTest` header — no test class enters its body completely.

If you bisect with `--info`, the LAST test that emits `STARTED` is the one that hangs; nothing after it ever runs because Gradle's JUnit runner queues sequentially.

## Root cause

Two conditions stack:

1. A production class accepts a `CoroutineDispatcher` via constructor and internally creates `CoroutineScope(dispatcher + SupervisorJob())`. Its `start()` (or equivalent) launches two coroutines on that scope:
   - `scope.launch { someHotSharedFlow.collect { ... } }` — a `SharedFlow.collect` never completes by design.
   - `scope.launch { while (isActive) { delay(N_MS); doWork() } }` — an infinite poll loop.

2. The test injects `StandardTestDispatcher()` into the constructor and wraps the body in `runTest { ... }`.

After the test body completes its assertions, kotlinx-coroutines-test's `runTest` internally calls `advanceUntilIdle()` to drain pending coroutines on the test scheduler. The two background coroutines above are scheduled on that same test scheduler (because they were launched from the dispatcher we injected). They have pending `delay(...)` invocations that the scheduler can advance virtually — but the `while (isActive)` loop re-schedules itself forever, so `advanceUntilIdle()` never reaches an idle state. The test hangs until the surrounding Gradle Test task times out.

`@After tearDown { thing.release() }` does **not** help, because `@After` runs **after** `runTest` has already returned (or in this case, failed to return). The cancellation must happen **inside** the `runTest` block.

## Fix — three complementary changes

Apply all three. Each addresses a different layer.

### 1. Wrap `runTest` with a helper that calls `release()` in `finally`

```kotlin
@OptIn(ExperimentalCoroutinesApi::class)
private fun runReconnectTest(testBody: suspend TestScope.() -> Unit): TestResult = runTest {
    try { testBody() } finally { autoReconnectManager.release() }
}
```

Replace every `fun \`test name\`() = runTest {` with `... = runReconnectTest {`. The `finally` cancels the production scope **inside** the `runTest` block, so `advanceUntilIdle()` sees no more pending coroutines.

### 2. Replace explicit `advanceUntilIdle()` with bounded `advanceTimeBy(N) + runCurrent()`

```kotlin
// Wrong — drains forever against an infinite while-delay loop:
advanceUntilIdle()

// Right — bounded virtual time advance, then process resulting work:
advanceTimeBy(2500); runCurrent()
```

Choose `N` as 2–3× the production loop's `delay()` interval. This is enough to trigger any `executeAt <= now` queued task once or twice, but bounded so the call returns deterministically.

### 3. Per-Test Gradle task timeout + per-test logging (defensive)

Add to the module's `build.gradle.kts` (note the explicit `import` — Kotlin DSL script compiler does not accept `java.time.Duration` as a fully-qualified inline reference):

```kotlin
import java.time.Duration

// ...

tasks.withType<Test>().configureEach {
    timeout.set(Duration.ofMinutes(10))
    testLogging {
        events("started", "passed", "skipped", "failed")
        showStandardStreams = false
    }
}
```

This serves two purposes:

- The 10-min timeout fails the task fast instead of letting it consume the 60-min job budget.
- `testLogging.events("started", ...)` makes the CI log show **exactly which test class** is in flight when the hang fires — the single most useful diagnostic when you re-encounter this pattern.

## Roles of the three fixes

| Fix | What it solves |
|---|---|
| Helper wrapper | The immediate, visible hang on test body return |
| Bounded `advanceTimeBy` | The next layer — tests that explicitly call `advanceUntilIdle()` mid-body |
| Per-Test gradle timeout + logging | Safety net + next-hang diagnostic |

Without (1) and (2), the safety net (3) still leaves your CI red for 10 min per affected test. Without (3), the next regression of this kind is opaque.

## Workflow split (optional but recommended while diagnosing)

In `.github/workflows/android-tests.yml`, isolate the suspect module's `testDebugUnitTest` task into its own step with a short `timeout-minutes`:

```yaml
- name: Run Library Module Unit Tests (excl core-p2p)
  working-directory: android-app
  run: |
    ./gradlew :core-common:testDebugUnitTest :core-database:testDebugUnitTest \
      :core-security:testDebugUnitTest :core-did:testDebugUnitTest \
      :core-e2ee:testDebugUnitTest :core-blockchain:testDebugUnitTest \
      :core-network:testDebugUnitTest \
      --parallel --max-workers=4 --no-daemon

- name: Run core-p2p Unit Tests (isolated, diagnostic)
  working-directory: android-app
  timeout-minutes: 15
  run: ./gradlew :core-p2p:testDebugUnitTest --no-daemon
```

The split lets the other 7 core modules reach green independently of the broken one, and a short `timeout-minutes` on the isolated step gives a fast failure signal. After the underlying hang is fixed, fold the isolated step back into the main one.

## Verification data from the real incident

| Step / phase | Before fix | After fix |
|---|---:|---:|
| `Run Library Module Unit Tests` (all 8 modules, one step) | 55+ min, cancelled | n/a (split) |
| `Run Library Module Unit Tests (excl core-p2p)` | n/a | 80–90 s |
| `Run core-p2p Unit Tests` (isolated) | 10-min timeout, no test events | 35 s, all events emitted |
| AutoReconnectManagerTest 14 tests | First one hangs, rest skipped | All 14 pass (3 s / 95 ms / ...) |

## Related smells worth auditing

The same pattern can hide in any production class that uses `scope.launch { while (...) delay(...) }` or `scope.launch { someHotFlow.collect { } }` on an injected dispatcher and exposes a `start()`-style entry. Specifically watch:

- `HeartbeatManager` — heartbeat loop
- `SyncManager` — sync interval poll
- Anything with a `*ProcessJob` / `*PollJob` Job field

These have not been observed to hang yet but use a similar architecture and could surface the issue if their tests start using `advanceUntilIdle()` or expand to call `start()`.

## Commit chain

In session order, the six commits that landed this fix:

| Commit | Role |
|---|---|
| `28424cd85` | DatabaseMigrationsTest self-validating assertion (unrelated test, kicked off the session) |
| `8bbd651ff` | Job-level `timeout-minutes: 30 → 60` (turned out insufficient, kept for sibling-job alignment) |
| `0202a5f2c` | Split core-p2p into its own step; add per-Test timeout + `testLogging` to `build.gradle.kts` |
| `fa47e11f4` | Add explicit `import java.time.Duration` (Kotlin DSL FQN rejection) |
| `fbd4e380b` | Introduce `runReconnectTest` helper; convert 14 `runTest` calls |
| `620b80200` | Replace 6 `advanceUntilIdle()` with `advanceTimeBy(2500); runCurrent()` |

## Downstream finding

Removing the hang exposed pre-existing real assertion failures in `IceServerConfigTest` (6 tests, init-block code/test drift). Tracked as [issue #10](https://github.com/chainlesschain/chainlesschain/issues/10) — not caused by anything in this fix.
