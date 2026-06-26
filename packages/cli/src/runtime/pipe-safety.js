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
// across the modules that share it.
const _PIPE_SAFE = Symbol.for("cc.headless.pipeSafe");

/**
 * Install an EPIPE-safe `error` listener on the given write streams (default:
 * process.stdout + process.stderr). Idempotent. `onEpipe` defaults to a clean
 * `process.exit(0)`; the REPL passes a graceful-shutdown callback instead.
 *
 * @param {Array<NodeJS.WriteStream>} [streams]
 * @param {() => void} [onEpipe]
 */
export function installPipeSafety(streams, onEpipe) {
  const targets = streams || [process.stdout, process.stderr];
  const handleEpipe = onEpipe || (() => process.exit(0));
  for (const stream of targets) {
    if (!stream || typeof stream.on !== "function" || stream[_PIPE_SAFE]) {
      continue;
    }
    stream[_PIPE_SAFE] = true;
    stream.on("error", (err) => {
      if (err && err.code === "EPIPE") {
        handleEpipe();
        return;
      }
      // Non-EPIPE stream error: surface best-effort (never onto the stream that
      // just errored, to avoid a loop) and otherwise swallow.
      try {
        if (stream !== process.stderr) {
          process.stderr.write(`stream error: ${err?.message || err}\n`);
        }
      } catch {
        /* nothing more we can do */
      }
    });
  }
}
