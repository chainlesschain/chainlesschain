/**
 * Logger adapter for CJS modules
 * Uses @chainlesschain/shared-logger when available, falls back to console
 */

let _logger = null;

function getLogger() {
  if (_logger) return _logger;

  // Console-based fallback that matches the Logger API
  _logger = {
    debug: (...args) => console.debug(...args),
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    fatal: (...args) => console.error(...args),
  };

  return _logger;
}

/**
 * Inject a custom logger (used by bootstrap to inject shared-logger)
 */
function setLogger(logger) {
  _logger = logger;
}

module.exports = { getLogger, setLogger };
