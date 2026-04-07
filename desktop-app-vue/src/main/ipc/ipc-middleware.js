/**
 * @module ipc/ipc-middleware
 * IPC middleware layer providing unified error handling, request timing,
 * permission checking, and rate limiting for IPC handlers.
 *
 * Phase 78 - IPC Registry Domain Split + Lazy Loading + Middleware
 */
const { logger } = require("../utils/logger.js");

class IPCMiddleware {
  constructor() {
    this._timingEnabled = true;
    this._permissionChecks = new Map();
    this._rateLimits = new Map();
    this._requestCounts = new Map();
    // L4: per-channel wrapped handler cache (avoid double-wrap + O(1) channel index)
    this._wrapCache = new Map();
  }

  /**
   * Wrap an IPC handler with middleware (error handling, timing, rate limiting, permissions)
   * @param {string} channel - IPC channel name
   * @param {Function} handler - Original handler function
   * @param {Object} options - Middleware options
   * @param {Object} [options.rateLimit] - Rate limit config { max, windowMs }
   * @param {string} [options.permission] - Permission check name
   * @returns {Function} Wrapped handler
   */
  wrap(channel, handler, options = {}) {
    // L4: return cached wrapper for identical (channel, handler, options) tuple
    const cached = this._wrapCache.get(channel);
    if (cached && cached.handler === handler && cached.options === options) {
      return cached.wrapped;
    }

    // Pre-resolve options once to avoid per-call lookups
    const rateLimit = options.rateLimit || null;
    const rateLimitMax = rateLimit ? rateLimit.max : 0;
    const rateLimitWindow = rateLimit ? rateLimit.windowMs || 60000 : 0;
    const permissionName = options.permission || null;
    // Resolve permission checker lazily — checker may be registered after wrap()
    const middleware = this;

    const wrapped = async (event, ...args) => {
      const startTime = Date.now();

      try {
        // Rate limiting (pre-resolved config)
        if (rateLimit) {
          const key = `${channel}-${event?.sender?.id || "unknown"}`;
          const count = middleware._requestCounts.get(key) || 0;
          if (count >= rateLimitMax) {
            return { success: false, error: "Rate limit exceeded" };
          }
          middleware._requestCounts.set(key, count + 1);
          setTimeout(() => {
            middleware._requestCounts.set(
              key,
              Math.max(0, (middleware._requestCounts.get(key) || 1) - 1),
            );
          }, rateLimitWindow);
        }

        // Permission check (lazy lookup, allows late registration)
        if (permissionName) {
          const checker = middleware._permissionChecks.get(permissionName);
          if (checker && !(await checker(event, ...args))) {
            return { success: false, error: "Permission denied" };
          }
        }

        const result = await handler(event, ...args);

        // Timing log
        if (middleware._timingEnabled) {
          const duration = Date.now() - startTime;
          if (duration > 1000) {
            logger.warn(
              `[IPCMiddleware] Slow handler: ${channel} took ${duration}ms`,
            );
          }
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(
          `[IPCMiddleware] ${channel} failed after ${duration}ms:`,
          error.message,
        );
        return { success: false, error: error.message };
      }
    };

    this._wrapCache.set(channel, { handler, options, wrapped });
    return wrapped;
  }

  /**
   * Look up a previously wrapped handler by channel name (L4 — O(1) index)
   * @param {string} channel
   * @returns {Function|null}
   */
  getWrappedHandler(channel) {
    const entry = this._wrapCache.get(channel);
    return entry ? entry.wrapped : null;
  }

  /**
   * Drop the cached wrapper for a channel (e.g., after re-registration)
   * @param {string} channel
   */
  invalidateChannel(channel) {
    this._wrapCache.delete(channel);
  }

  /**
   * Register a named permission check function
   * @param {string} name - Permission name
   * @param {Function} checker - Async function (event, ...args) => boolean
   */
  registerPermissionCheck(name, checker) {
    this._permissionChecks.set(name, checker);
  }

  /**
   * Enable or disable request timing logs
   * @param {boolean} enabled
   */
  setTimingEnabled(enabled) {
    this._timingEnabled = enabled;
  }

  /**
   * Get middleware statistics
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      permissionChecks: this._permissionChecks.size,
      rateLimits: this._rateLimits.size,
      activeRequests: this._requestCounts.size,
      cachedChannels: this._wrapCache.size,
    };
  }
}

let instance = null;
function getIPCMiddleware() {
  if (!instance) {
    instance = new IPCMiddleware();
  }
  return instance;
}

module.exports = { IPCMiddleware, getIPCMiddleware };
