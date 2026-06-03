/**
 * AIChat WebView 鉴权向导 — HealthChecker (Phase 10.3.5).
 *
 * Periodic worker that walks every registered AIChat vendor and re-runs
 * `vendorAdapter.registerVendor(vendor, cookies)` against the *current*
 * cookies in `aichat-accounts.json`. Result writes back to the entry as:
 *
 *   entry.lastHealth = { ok, reason?, at }
 *
 * The wizard UI (Step 1 card grid) reads `lastHealth.ok` to render the red
 * dot / "Cookie 即将过期" / "🔴 重登" affordance.
 *
 * Wiring:
 *   const hc = createAIChatHealthChecker({
 *     accountsStore,
 *     vendorAdapter,            // same bridge used by Wizard (registerVendor)
 *     intervalMs: 6 * 3600_000, // default 6h
 *     firstRunDelayMs: 30_000,  // first check 30s after start
 *     specVersion: 1,           // bump on incompatible spec changes
 *   });
 *   hc.start();
 *   …
 *   hc.stop();
 *
 * Test seam: pass `_deps.setInterval` / `_deps.clearInterval` /
 * `_deps.setTimeout` / `_deps.clock` so vitest can fast-forward without
 * needing fake timers + real timers in the same suite.
 *
 * Reference: docs/design/Personal_Data_Hub_Phase_10_3_AIChat_WebView_Wizard.md §6
 */

"use strict";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_FIRST_RUN_DELAY_MS = 30_000; // 30s after start

function createAIChatHealthChecker({
  accountsStore,
  vendorAdapter,
  intervalMs = DEFAULT_INTERVAL_MS,
  firstRunDelayMs = DEFAULT_FIRST_RUN_DELAY_MS,
  specVersion = 1,
  _deps,
} = {}) {
  if (!accountsStore || typeof accountsStore.list !== "function") {
    throw new Error("aichat-health-checker: accountsStore.list required");
  }
  if (typeof accountsStore.put !== "function") {
    throw new Error("aichat-health-checker: accountsStore.put required");
  }
  if (!vendorAdapter || typeof vendorAdapter.registerVendor !== "function") {
    throw new Error("aichat-health-checker: vendorAdapter.registerVendor required");
  }

  const defaults = {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h),
    clock: () => Date.now(),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  // Merge instead of replace so tests can supply just the timer slots and
  // inherit a no-op logger / Date.now clock from defaults.
  const deps = { ...defaults, ..._deps };

  let intervalHandle = null;
  let firstRunHandle = null;
  let running = false;
  let lastRunAt = 0;
  let _runs = 0;

  /**
   * Walk all registered vendors, refresh their lastHealth.
   *
   * - If `cookieSpecVersion` < current `specVersion` → mark SPEC_VERSION_MISMATCH
   * - Else call vendorAdapter.registerVendor with the stored cookies and
   *   propagate the result. The bridge already maps to validateCookie under
   *   the hood (matches the registerVendor contract from the wizard).
   *
   * Returns `{ checked, ok, failed, mismatch }` for callers / tests.
   */
  async function runOnce() {
    if (running) {
      deps.logger.warn("[aichat-health] previous run still in flight, skipping");
      return { checked: 0, ok: 0, failed: 0, mismatch: 0, skipped: true };
    }
    running = true;
    const start = deps.clock();
    let checked = 0;
    let ok = 0;
    let failed = 0;
    let mismatch = 0;
    try {
      const entries = (await accountsStore.list()) || [];
      for (const entry of entries) {
        if (!entry || !entry.vendor) continue;
        checked++;
        // Spec version downgrade trap (T7) — the on-disk cookies were
        // captured under an older cookie-capture-spec version; cookies may
        // still work but mark them so the UI flags re-login.
        const entryVer = Number.isFinite(entry.cookieSpecVersion) ? entry.cookieSpecVersion : 0;
        if (entryVer < specVersion) {
          mismatch++;
          await _writeHealth(entry, {
            ok: false,
            reason: "SPEC_VERSION_MISMATCH",
            at: deps.clock(),
          });
          continue;
        }
        let result;
        try {
          result = await vendorAdapter.registerVendor(entry.vendor, entry.cookies || {});
        } catch (err) {
          deps.logger.warn(
            `[aichat-health] ${entry.vendor} registerVendor threw`,
            err && err.message,
          );
          result = { ok: false, reason: "ADAPTER_THREW", error: err && err.message };
        }
        if (result && result.ok === true) {
          ok++;
          await _writeHealth(entry, { ok: true, at: deps.clock() });
        } else {
          failed++;
          await _writeHealth(entry, {
            ok: false,
            reason: (result && result.reason) || "VALIDATE_FAILED",
            at: deps.clock(),
          });
        }
      }
      lastRunAt = start;
      _runs++;
      deps.logger.info(
        `[aichat-health] checked=${checked} ok=${ok} failed=${failed} mismatch=${mismatch}`,
      );
      return { checked, ok, failed, mismatch };
    } finally {
      running = false;
    }
  }

  async function _writeHealth(entry, lastHealth) {
    const next = { ...entry, lastHealth };
    try {
      await accountsStore.put(entry.vendor, next);
    } catch (err) {
      deps.logger.warn(`[aichat-health] write back ${entry.vendor} failed`, err && err.message);
    }
  }

  /**
   * Begin the periodic loop. Idempotent — second call returns early.
   * Schedules:
   *   - first run firstRunDelayMs after start()
   *   - subsequent runs every intervalMs
   */
  function start() {
    if (intervalHandle || firstRunHandle) {
      return false;
    }
    firstRunHandle = deps.setTimeout(() => {
      firstRunHandle = null;
      // Fire-and-forget; runOnce is internally guarded.
      runOnce().catch((err) =>
        deps.logger.error("[aichat-health] first run failed", err && err.message),
      );
      intervalHandle = deps.setInterval(() => {
        runOnce().catch((err) =>
          deps.logger.error("[aichat-health] interval run failed", err && err.message),
        );
      }, intervalMs);
      // Don't keep the event loop alive on the periodic check alone. Without
      // unref a one-shot `cc hub list-adapters --json` from in-APK Android
      // sits idle in epoll_wait until Kotlin LocalCcRunner.waitFor 240s
      // timeout → false "写入本地数据库失败". Real-device repro 2026-05-27
      // Xiaomi 24115RA8EC (PID 24828 lingered with vault.db RW handles).
      if (intervalHandle && typeof intervalHandle.unref === "function") {
        intervalHandle.unref();
      }
    }, firstRunDelayMs);
    if (firstRunHandle && typeof firstRunHandle.unref === "function") {
      firstRunHandle.unref();
    }
    return true;
  }

  function stop() {
    if (firstRunHandle) {
      deps.clearTimeout(firstRunHandle);
      firstRunHandle = null;
    }
    if (intervalHandle) {
      deps.clearInterval(intervalHandle);
      intervalHandle = null;
    }
    return true;
  }

  function status() {
    return {
      running,
      started: !!(firstRunHandle || intervalHandle),
      lastRunAt,
      runs: _runs,
      intervalMs,
      firstRunDelayMs,
      specVersion,
    };
  }

  return { start, stop, runOnce, status };
}

module.exports = {
  createAIChatHealthChecker,
  DEFAULT_INTERVAL_MS,
  DEFAULT_FIRST_RUN_DELAY_MS,
};
