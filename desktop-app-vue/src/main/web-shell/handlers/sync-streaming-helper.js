/**
 * Sync streaming envelope helper (Phase 3c follow-up D9).
 *
 * Converts a sync engine's `onProgress` callback into an async generator
 * suitable for the ws-cli-loader streaming envelope (yield → `<topic>.chunk`,
 * generator return → `<topic>.result`).
 *
 * Engines (webdav-engine / oss-engine) emit progress like:
 *   onProgress({ phase: "start"|"push"|"delete"|"success"|"conflict"|"failed",
 *                pushed, skipped, deleted, totalPending })
 *
 * Mirrors the llm-handlers `streamFromCallback` pattern but is engine-
 * agnostic: caller provides `runEngine(deps)` that takes a deps object
 * with `onProgress` and returns a promise resolving to the final result.
 *
 * Usage:
 *   async function* handler() {
 *     yield* syncStreamFromEngine({
 *       runEngine: (deps) => runWebDAVSync({...staticDeps, ...deps}),
 *     });
 *     // implicit: return value of last yielded item is engine result
 *   }
 *
 * The generator's RETURN value is the engine result. If engine throws,
 * the generator throws — caller (dispatcher) sees error envelope.
 */

"use strict";

/**
 * Wrap an engine call into a chunk-yielding async generator.
 *
 * @param {object} args
 * @param {(deps: {onProgress: Function}) => Promise<object>} args.runEngine
 *        — function that calls the underlying engine. Receives one arg
 *          `{onProgress}` which the caller should pass through to the
 *          engine's onProgress slot.
 * @returns {AsyncGenerator<object, object, void>}
 *          yields each progress event; returns final engine result.
 */
async function* syncStreamFromEngine({ runEngine }) {
  if (typeof runEngine !== "function") {
    throw new TypeError("syncStreamFromEngine: runEngine must be a function");
  }

  let queue = [];
  let done = false;
  let waker = null;

  const wake = () => {
    if (waker) {
      const fn = waker;
      waker = null;
      fn();
    }
  };

  const finalPromise = runEngine({
    onProgress: (chunk) => {
      // Defensive: ignore non-object pushes (engine shouldn't, but defend)
      if (!chunk || typeof chunk !== "object") {
        return;
      }
      queue.push(chunk);
      wake();
    },
  }).then(
    (value) => {
      done = true;
      wake();
      return value;
    },
    (err) => {
      done = true;
      wake();
      throw err;
    },
  );

  // Prevent unhandled rejection if generator is `return()`ed before
  // finalPromise resolves (e.g. WS close mid-sync). Real awaiter is
  // `return await finalPromise` below.
  finalPromise.catch(() => {});

  try {
    while (true) {
      // Drain whatever was buffered
      if (queue.length > 0) {
        const batch = queue;
        queue = [];
        for (const item of batch) {
          yield item;
        }
        continue;
      }
      if (done) {
        break;
      }
      await new Promise((resolve) => {
        waker = resolve;
      });
    }
  } finally {
    waker = null;
  }

  // Re-await final promise so its resolved value becomes the generator's
  // return value (or its rejection re-throws). Queue already drained.
  return await finalPromise;
}

module.exports = {
  syncStreamFromEngine,
};
