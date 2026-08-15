/**
 * Pre-main barrier for one background-agent turn.
 *
 * Node loads this module through `--import` before executing the real CLI
 * entrypoint. Top-level await keeps both ESM and CommonJS entry semantics
 * intact while making execution contingent on the worker's durable PID
 * commit and listener installation.
 */

import { writeSync } from "node:fs";
import {
  BACKGROUND_TURN_BOOTSTRAP_ENV,
  BACKGROUND_TURN_BOOTSTRAP_READY,
  BACKGROUND_TURN_BOOTSTRAP_RELEASE,
  backgroundTurnBootstrapBindingFromEnvironment,
  clearBackgroundTurnBootstrapEnvironment,
  createBackgroundTurnBootstrapMessage,
  matchesBackgroundTurnBootstrapMessage,
  removeBackgroundTurnBootstrapImport,
} from "../lib/background-turn-bootstrap-protocol.js";

const DEFAULT_RELEASE_TIMEOUT_MS = 30_000;
const TEST_RELEASE_TIMEOUT_MAX_MS = 2_000;

function releaseTimeoutMs() {
  if (process.env.NODE_ENV !== "test") return DEFAULT_RELEASE_TIMEOUT_MS;
  const requested = Number(
    process.env[BACKGROUND_TURN_BOOTSTRAP_ENV.testTimeoutMs],
  );
  if (!Number.isFinite(requested)) return DEFAULT_RELEASE_TIMEOUT_MS;
  return Math.max(10, Math.min(TEST_RELEASE_TIMEOUT_MAX_MS, requested));
}

function failClosed(message) {
  try {
    writeSync(2, `[background-turn-bootstrap] ${message}\n`);
  } catch {
    // The inherited diagnostic handle may already be closed.
  }
  process.exit(1);
}

let binding;
try {
  binding = backgroundTurnBootstrapBindingFromEnvironment(
    process.env,
    process.pid,
  );
} catch (error) {
  failClosed(error?.message || String(error));
}

if (typeof process.send !== "function" || process.connected === false) {
  failClosed("dedicated worker IPC is unavailable");
}

await new Promise((resolve) => {
  let released = false;
  let failed = false;
  let timer = null;
  let readyTimer = null;

  const failOnce = (message) => {
    if (failed) return;
    failed = true;
    if (timer) clearTimeout(timer);
    if (readyTimer) clearInterval(readyTimer);
    failClosed(message);
  };

  const onMessage = (message) => {
    if (message?.type !== BACKGROUND_TURN_BOOTSTRAP_RELEASE) return;
    if (released) {
      failOnce("duplicate release rejected");
      return;
    }
    if (
      !matchesBackgroundTurnBootstrapMessage(
        message,
        BACKGROUND_TURN_BOOTSTRAP_RELEASE,
        binding,
      )
    ) {
      failOnce("release binding mismatch");
      return;
    }
    released = true;
    if (timer) clearTimeout(timer);
    if (readyTimer) clearInterval(readyTimer);
    try {
      process.execArgv = removeBackgroundTurnBootstrapImport(
        process.execArgv,
        import.meta.url,
      );
      clearBackgroundTurnBootstrapEnvironment(process.env);
      // Keep the disconnect listener as a fail-closed worker-death signal,
      // but do not make this private bootstrap channel keep an otherwise
      // completed Agent process alive. Interaction requests explicitly ref
      // the same channel for the duration of a pending same-turn answer.
      process.channel?.unref?.();
    } catch (error) {
      failOnce(error?.message || String(error));
      return;
    }
    resolve();
  };

  // Keep both listeners after release. A repeated release or loss of the
  // supervising worker remains fail-closed even after the real CLI starts.
  process.on("message", onMessage);
  process.once("disconnect", () =>
    failOnce("worker IPC disconnected before turn completion"),
  );
  timer = setTimeout(
    () => failOnce("timed out waiting for durable turn release"),
    releaseTimeoutMs(),
  );
  timer.unref?.();

  const sendReady = () => {
    if (released || failed) return;
    try {
      process.send(
        createBackgroundTurnBootstrapMessage(
          BACKGROUND_TURN_BOOTSTRAP_READY,
          binding,
        ),
        (error) => {
          if (error) failOnce(`ready delivery failed: ${error.message}`);
        },
      );
    } catch (error) {
      failOnce(`ready delivery failed: ${error?.message || String(error)}`);
    }
  };
  sendReady();
  // A very fast preload can publish readiness while the worker is still
  // fsyncing the PID commit. Repeat only READY (never RELEASE) until the
  // post-commit listener answers, so an early unobserved event cannot strand
  // the child. Matching duplicates are intentionally idempotent parent-side.
  readyTimer = setInterval(sendReady, 100);
  readyTimer.unref?.();
});
