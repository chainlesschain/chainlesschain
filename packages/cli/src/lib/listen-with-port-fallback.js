/**
 * listen-with-port-fallback.js
 *
 * Try to bind a server on the preferred port. If that port is taken
 * (EADDRINUSE), walk through adjacent ports up to `maxAttempts`. If
 * every adjacent port is also taken, fall back once more to port 0
 * (OS-assigned ephemeral). Surfaces the actually bound port so the
 * caller can log it / propagate it to dependent servers (e.g. the
 * HTTP server's `__CC_CONFIG__.wsPort` injection).
 *
 * Used by `cc ui`'s startUiServer for both the WS and HTTP servers
 * — port collisions are common during development (multiple `cc ui`
 * instances, prior crashes that left listeners orphaned, the desktop
 * web-shell already running, etc.) and crashing on EADDRINUSE makes
 * for poor UX.
 */

/**
 * @template T
 * @param {(port: number) => Promise<T>} listenFn
 *   Per-attempt binder. Must reject with `err.code === "EADDRINUSE"` on
 *   conflict; any other error propagates immediately. Resolved value is
 *   passed through verbatim so the caller can pull the actual port from
 *   their server handle (the listenFn is expected to readback the bound
 *   port from `address()` after listen — see ws-server.js for the pattern).
 *
 * @param {number} preferred
 *   First port to attempt. Must be in [1, 65535]; pass 0 to skip the
 *   sequential walk and go straight to OS-assigned.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=20]
 *   How many sequential adjacent ports to try after `preferred` (so the
 *   walk covers `preferred`, `preferred+1`, …, `preferred + maxAttempts - 1`).
 * @param {(msg: string) => void} [opts.onFallback]
 *   Optional notifier called once when the preferred port is taken,
 *   with a human-readable message summarising the fallback decision.
 *
 * @returns {Promise<T>} the listenFn's resolved value for the port that bound.
 */
export async function listenWithPortFallback(listenFn, preferred, opts = {}) {
  const { maxAttempts = 20, onFallback } = opts;

  if (typeof listenFn !== "function") {
    throw new TypeError("listenWithPortFallback: listenFn must be a function");
  }
  if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65535) {
    throw new RangeError(
      `listenWithPortFallback: preferred port out of range: ${preferred}`,
    );
  }

  // preferred === 0 means caller already wants OS-assigned, no fallback needed.
  if (preferred === 0) {
    return listenFn(0);
  }

  const upper = Math.min(preferred + maxAttempts, 65536);
  const tried = [];

  for (let port = preferred; port < upper; port++) {
    try {
      const result = await listenFn(port);
      if (port !== preferred && typeof onFallback === "function") {
        try {
          onFallback(
            `Port ${preferred} in use; bound on ${port} instead (tried ${tried.join(", ")}).`,
          );
        } catch {
          /* swallow — onFallback is informational */
        }
      }
      return result;
    } catch (err) {
      if (err && err.code === "EADDRINUSE") {
        tried.push(port);
        continue;
      }
      throw err;
    }
  }

  // All sequential ports busy — final fallback to OS-assigned.
  if (typeof onFallback === "function") {
    try {
      onFallback(
        `Ports ${tried.join(", ")} all in use; falling back to OS-assigned port.`,
      );
    } catch {
      /* swallow */
    }
  }
  try {
    return await listenFn(0);
  } catch (err) {
    if (err && err.code === "EADDRINUSE") {
      throw new Error(
        `Could not bind any port. Tried: ${tried.join(", ")} and OS-assigned. Last error: ${err.message}`,
      );
    }
    throw err;
  }
}
