/**
 * TEMP diagnostic (setupFiles) — capture WHY the forks worker exits at teardown
 * on POSIX unit shard 2/4. vitest reports "Worker exited unexpectedly" but can't
 * attribute it to a JS error, so we need the worker's own exit code and any late
 * uncaught error/rejection. Writes straight to fd 2 (bypasses vitest's console
 * capture + the reporter's --silent=passed-only). Remove once diagnosed.
 */
import fs from "node:fs";

const w = (m) => {
  try {
    fs.writeSync(2, `\nWCRASH[pid=${process.pid}] ${m}\n`);
  } catch {
    /* noop */
  }
};

// FIX ATTEMPT: keep the forks worker's IPC channel ref'd so the worker cannot
// exit on its own while idle. tinypool unrefs the channel between tasks; if the
// worker's event loop then empties it exits cleanly (code 0) BEFORE the pool
// sends its stop RPC — and vitest's `worker.on("exit", emitUnexpectedExit)`
// (removed only once stop() begins) fires → "Worker exited unexpectedly /
// Timeout terminating forks worker" (POSIX-only unit shard-2/4). Re-reffing the
// channel makes the worker wait for the pool's explicit stop, the correct
// pool-worker lifecycle.
try {
  process.channel?.ref?.();
  w(`channel ref'd (hasChannel=${!!process.channel})`);
} catch (e) {
  w(`channel ref failed: ${e?.message || e}`);
}

// Adding these listeners also PREVENTS the default crash — if the worker was
// dying on a late async error, suppressing it here should let teardown finish
// (and the stack tells us the culprit). If the shard stays red with no WCRASH
// line, the exit is a signal/clean-exit, not a catchable error.
if (!process.__ccCrashDiag) {
  process.__ccCrashDiag = true;
  process.on("uncaughtException", (e) => w(`uncaughtException: ${e?.stack || e}`));
  process.on("unhandledRejection", (e) =>
    w(`unhandledRejection: ${e?.stack || e}`),
  );
  process.on("exit", (code) => w(`exit code=${code}`));
}
