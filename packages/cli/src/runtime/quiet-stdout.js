/**
 * Run a function with stdout redirected to stderr.
 *
 * The headless runners emit machine-readable output (text answer / JSON /
 * NDJSON) on stdout, but bootstrap/db/config code logs diagnostics via
 * console.info — which Node writes to stdout — e.g. "[DatabaseManager] …",
 * "[AppConfig] Configuration loaded". Those lines corrupt a JSON/NDJSON stream
 * and muddy a plain-text answer. Wrapping the noisy setup in withQuietStdout
 * sends that chatter to stderr (the diagnostic channel) while keeping stdout
 * pristine for the actual payload.
 *
 * Scope is deliberately narrow: it swaps `stream.write` only for the duration
 * of `fn` and always restores it (even on throw), so it never affects the
 * payload writes that happen afterwards, nor any other command.
 *
 * @template T
 * @param {() => T | Promise<T>} fn
 * @param {object} [opts]
 * @param {{write: Function}} [opts.stream=process.stdout]  stream to silence
 * @param {{write: Function}} [opts.target=process.stderr]  where to divert to
 * @returns {Promise<T>}
 */
export async function withQuietStdout(fn, opts = {}) {
  const stream = opts.stream || process.stdout;
  const target = opts.target || process.stderr;
  const original = stream.write;
  stream.write = function (chunk, encoding, cb) {
    return target.write(chunk, encoding, cb);
  };
  try {
    return await fn();
  } finally {
    stream.write = original;
  }
}
