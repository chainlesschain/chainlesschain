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
    return async (event, ...args) => {
      const startTime = Date.now();

      try {
        // Rate limiting
        if (options.rateLimit) {
          const key = `${channel}-${event?.sender?.id || "unknown"}`;
          const count = this._requestCounts.get(key) || 0;
          if (count >= options.rateLimit.max) {
            return { success: false, error: "Rate limit exceeded" };
          }
          this._requestCounts.set(key, count + 1);
          setTimeout(() => {
            this._requestCounts.set(
              key,
              Math.max(0, (this._requestCounts.get(key) || 1) - 1),
            );
          }, options.rateLimit.windowMs || 60000);
        }

        // Permission check
        if (options.permission) {
          const checker = this._permissionChecks.get(options.permission);
          if (checker && !(await checker(event, ...args))) {
            return { success: false, error: "Permission denied" };
          }
        }

        const result = await handler(event, ...args);

        // Timing log
        if (this._timingEnabled) {
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
