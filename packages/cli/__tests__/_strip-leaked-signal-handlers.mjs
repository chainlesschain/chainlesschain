/**
 * setupFiles — strip process SIGTERM/SIGINT handlers a test leaks into the
 * shared vitest forks worker.
 *
 * Several source paths install a process-wide hard-signal handler that exits
 * the process — e.g. headless-runner.js:
 *   process.once("SIGTERM", () => { …reap…; process.exit(143); })
 * and remove it in a `finally`. A unit test that drives such a path but does
 * not run it fully to its `finally` (an early return, an assertion that stops
 * mid-flow, a rejected promise) leaves that handler installed on the WORKER's
 * process. The forks pool reuses one OS process across many files, so the
 * handler outlives the test. When tinypool later sends SIGTERM to recycle or
 * terminate the idle worker, the leaked handler runs and `process.exit(143)`s
 * the worker out from under the pool → "[vitest-pool]: Worker exited
 * unexpectedly / Timeout terminating forks worker" — the POSIX-only unit
 * shard-2/4 flake (Windows has no SIGTERM signal path, so it passes). Every
 * test still passes; only the worker teardown is corrupted, and whatever file
 * the reused worker ran last gets the blame.
 *
 * Fix: capture the listeners vitest itself installed (setupFiles run before the
 * test file, after the worker runtime is up), then at afterAll remove any
 * SIGTERM/SIGINT listener the file added beyond that baseline. Worker
 * termination stays the pool's job; no test-owned handler can hijack it.
 * setupFiles re-run per file under isolate, so each file cleans up only its own
 * leaks.
 */
import { afterAll } from "vitest";

const baselineSigterm = process.listeners("SIGTERM");
const baselineSigint = process.listeners("SIGINT");

afterAll(() => {
  for (const listener of process.listeners("SIGTERM")) {
    if (!baselineSigterm.includes(listener)) {
      process.removeListener("SIGTERM", listener);
    }
  }
  for (const listener of process.listeners("SIGINT")) {
    if (!baselineSigint.includes(listener)) {
      process.removeListener("SIGINT", listener);
    }
  }
});
