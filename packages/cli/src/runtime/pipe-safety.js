/**
 * pipe-safety — shared EPIPE guard for cc's stdout/stderr writers.
 *
 * A downstream consumer that closes the pipe (e.g. `cc agent -p … | head`)
 * makes the next write fail ASYNCHRONOUSLY via the stream's `error` event,
 * which the try/catch around a write call cannot catch. With no `error`
 * listener that is an unhandled EPIPE → the process crashes with a stack trace
 * instead of stopping cleanly. `installPipeSafety` adds an idempotent listener
 * that treats EPIPE as "consumer done" (the Unix pipeline convention) and
 * surfaces other stream errors best-effort.
 *
 * Used by the headless `-p` runner, the stream-json driver, and the REPL.
 */

// Global-registry symbol so the guard is installed at most once per stream even
// across the modules that share it. The stored route is replaceable: repeated
// in-process invocations must not retain a callback (and its session resources)
// from an earlier run.
const _PIPE_SAFE = Symbol.for("cc.headless.pipeSafe");

/**
 * Install an EPIPE-safe `error` listener on the given write streams (default:
 * process.stdout + process.stderr). Idempotent. `onEpipe` defaults to setting a
 * clean exit code and returning control to the owner; it never calls
 * `process.exit()`, because that would bypass the owner's async cleanup.
 *
 * @param {Array<NodeJS.WriteStream>} [streams]
 * @param {() => void|Promise<void>} [onEpipe]
 * @returns {() => void} disposer for this installation's active routes
 */
export function installPipeSafety(streams, onEpipe) {
  const targets = streams || [process.stdout, process.stderr];
  const handleEpipe = onEpipe || (() => (process.exitCode = 0));
  let handled = false;
  const routeEpipe = () => {
    if (handled) return;
    handled = true;
    try {
      Promise.resolve(handleEpipe()).catch(() => {});
    } catch {
      // A shutdown callback is best-effort. Most importantly, never turn a
      // closed downstream pipe into another unhandled process error.
    }
  };
  const installed = [];

  for (const stream of targets) {
    if (!stream || typeof stream.on !== "function") {
      continue;
    }

    let state = stream[_PIPE_SAFE];
    if (!state || typeof state !== "object") {
      state = { route: null };
      Object.defineProperty(stream, _PIPE_SAFE, {
        value: state,
        configurable: false,
        enumerable: false,
        writable: false,
      });
      stream.on("error", (err) => {
        if (err && err.code === "EPIPE") {
          state.route?.();
          return;
        }
        // Non-EPIPE stream error: surface best-effort (never onto the stream
        // that just errored, to avoid a loop) and otherwise swallow.
        try {
          if (stream !== process.stderr) {
            process.stderr.write(`stream error: ${err?.message || err}\n`);
          }
        } catch {
          /* nothing more we can do */
        }
      });
    }
    state.route = routeEpipe;
    installed.push(state);
  }

  return () => {
    for (const state of installed) {
      if (state.route === routeEpipe) state.route = null;
    }
  };
}
