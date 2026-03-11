/**
 * Logger adapter for CJS modules
 */
let _logger = null;

function getLogger() {
  if (_logger) return _logger;
  _logger = {
    debug: (...args) => console.debug(...args),
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
  };
  return _logger;
}

function setLogger(logger) {
  _logger = logger;
}

module.exports = { getLogger, setLogger };
