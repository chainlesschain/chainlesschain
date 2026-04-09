/**
 * Workflow Hook Runner — Phase 4 of the canonical coding workflow.
 *
 * Lets users drop lifecycle scripts into their project at
 *   <projectRoot>/.chainlesschain/hooks/<event>.js
 *
 * Supported events:
 *   pre-intent / post-intent   — around $deep-interview writeIntent
 *   pre-plan / post-plan       — around $ralplan writePlan and approvePlan
 *   pre-execute / post-execute — around $ralph / $team execute()
 *   pre-verify / post-verify   — around $verify running checks
 *   pre-complete / post-complete — around $complete writing summary.md
 *   pre-done / post-done       — around marking a session DONE (legacy)
 *
 * Hook file contract: exports an async function (CJS default or `run` export)
 *   module.exports = async ({ event, sessionId, projectRoot, payload }) => { ... }
 * Return value (if any) is forwarded in the runner result as `data`.
 *
 * Semantics:
 *   - Missing hook file → { skipped: true, success: true }
 *   - Successful hook → { success: true, data }
 *   - Thrown pre-* hook → runner RE-THROWS so caller bails (VETO)
 *   - Thrown post-* hook → logged, runner returns { success: false, error }
 *     (post-* hooks cannot veto — the action already happened)
 *   - Timeout default 30s → treated like a thrown error (pre-* vetoes)
 */

const path = require("path");
const fs = require("fs");
const { logger } = require("../../utils/logger.js");

const HOOK_EVENTS = Object.freeze([
  "pre-intent",
  "post-intent",
  "pre-plan",
  "post-plan",
  "pre-execute",
  "post-execute",
  "pre-verify",
  "post-verify",
  "pre-complete",
  "post-complete",
  "pre-done",
  "post-done",
]);

const DEFAULT_TIMEOUT_MS = 30_000;

const _deps = {
  fs,
  // `loadHook` is pulled through _deps so tests can inject fake modules
  // without going through require() (which is hard to mock in Vitest forks).
  loadHook(hookFile) {
    // Clear require cache so user edits take effect without restarting.
    delete require.cache[require.resolve(hookFile)];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(hookFile);
  },
};

function isPreHook(event) {
  return event.startsWith("pre-");
}

function resolveHookFile(projectRoot, event) {
  return path.join(projectRoot, ".chainlesschain", "hooks", `${event}.js`);
}

function hookFileExists(projectRoot, event) {
  return _deps.fs.existsSync(resolveHookFile(projectRoot, event));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Run a lifecycle hook.
 *
 * @param {string} event — one of HOOK_EVENTS
 * @param {object} ctx
 * @param {string} ctx.projectRoot
 * @param {string} ctx.sessionId
 * @param {object} [ctx.payload]
 * @param {number} [ctx.timeoutMs]
 * @returns {Promise<{ success: boolean, skipped?: boolean, data?: any, error?: string }>}
 */
async function runHook(event, ctx = {}) {
  if (!HOOK_EVENTS.includes(event)) {
    throw new Error(`workflow-hook-runner: unknown event "${event}"`);
  }
  const { projectRoot, sessionId, payload } = ctx;
  if (!projectRoot) {
    throw new Error("workflow-hook-runner: projectRoot is required");
  }

  const hookFile = resolveHookFile(projectRoot, event);
  if (!_deps.fs.existsSync(hookFile)) {
    return { success: true, skipped: true };
  }

  const timeoutMs = ctx.timeoutMs || DEFAULT_TIMEOUT_MS;
  let hookFn;
  try {
    const mod = _deps.loadHook(hookFile);
    hookFn =
      typeof mod === "function"
        ? mod
        : typeof mod?.run === "function"
          ? mod.run
          : typeof mod?.default === "function"
            ? mod.default
            : null;
    if (!hookFn) {
      throw new Error(
        `hook file "${hookFile}" must export a function (module.exports = async (ctx) => {...})`,
      );
    }
  } catch (loadError) {
    const msg = `[hook:${event}] load failed: ${loadError.message}`;
    logger.error(msg);
    if (isPreHook(event)) {
      throw new Error(msg);
    }
    return { success: false, error: msg };
  }

  try {
    const data = await withTimeout(
      Promise.resolve(hookFn({ event, sessionId, projectRoot, payload })),
      timeoutMs,
      `[hook:${event}]`,
    );
    logger.info(`[hook:${event}] session=${sessionId || "(none)"} ok`);
    return { success: true, data };
  } catch (runError) {
    const msg = `[hook:${event}] ${runError.message}`;
    logger.error(msg);
    if (isPreHook(event)) {
      // Propagate so the caller can bail out of the workflow step.
      throw new Error(msg);
    }
    return { success: false, error: msg };
  }
}

module.exports = {
  HOOK_EVENTS,
  DEFAULT_TIMEOUT_MS,
  runHook,
  resolveHookFile,
  hookFileExists,
  _deps,
};
