/**
 * Logger configuration
 * Shared between main process, renderer, and CLI.
 * Extracted from desktop-app-vue/src/shared/logger-config.js
 */

export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

export const LOG_LEVEL_NAMES = {
  0: "DEBUG",
  1: "INFO",
  2: "WARN",
  3: "ERROR",
  4: "FATAL",
};

export const DEFAULT_CONFIG = {
  level:
    process.env.NODE_ENV === "production" ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG,
  console: process.env.NODE_ENV !== "production",
  file: true,
  fileConfig: {
    maxSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    compress: true,
  },
  stackTrace: true,
  timestamp: true,
  module: true,
  performance: {
    enabled: true,
    slowThreshold: 1000,
  },
};

/**
 * Format a log message
 */
export function formatLogMessage(level, module, message, data, timestamp) {
  const parts = [];

  if (timestamp) {
    parts.push(`[${new Date().toISOString()}]`);
  }

  parts.push(`[${LOG_LEVEL_NAMES[level]}]`);

  if (module) {
    parts.push(`[${module}]`);
  }

  parts.push(message);

  if (data && Object.keys(data).length > 0) {
    parts.push(JSON.stringify(data, null, 2));
  }

  return parts.join(" ");
}

/**
 * Get call stack trace
 */
export function getStackTrace() {
  const stack = new Error().stack;
  if (!stack) return "";
  const lines = stack.split("\n");
  return lines.slice(3).join("\n");
}

// Substrings that mark a property name as sensitive (all lowercase; matched
// case-insensitively as a substring of the lowercased key). Previously these
// were inline with capitals like "apiKey"/"privateKey", so the includes() check
// never matched — the most sensitive fields leaked into logs unredacted.
const SENSITIVE_KEY_SUBSTRINGS = [
  "password",
  "token",
  "secret",
  "apikey",
  "privatekey",
  "pin",
];

function isSensitiveKey(key) {
  const lowerKey = String(key).toLowerCase();
  return SENSITIVE_KEY_SUBSTRINGS.some((sk) => lowerKey.includes(sk));
}

/**
 * Sanitize sensitive data from log output
 * @param {any} data
 * @param {WeakSet} [seen]
 */
export function sanitizeData(data, seen = new WeakSet()) {
  if (!data || typeof data !== "object") return data;

  // Cycle guard applies to BOTH the Error and plain-object paths. An Error with
  // a circular own-prop (e.g. err.self = err, or two errors cross-referencing)
  // would otherwise recurse forever in the Error branch and overflow the stack.
  if (seen.has(data)) return "[Circular Reference]";
  seen.add(data);

  if (data instanceof Error) {
    const serializedError = {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
    for (const key of Object.keys(data)) {
      // Redact by key name here too — the previous version copied scalar
      // own-props verbatim, leaking err.token / err.password / err.apiKey
      // strings (e.g. those hung off HTTP-client errors) into logs.
      if (isSensitiveKey(key)) {
        serializedError[key] = "***REDACTED***";
        continue;
      }
      const value = data[key];
      serializedError[key] =
        typeof value === "object" && value !== null
          ? sanitizeData(value, seen)
          : value;
    }
    return serializedError;
  }

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  for (const key in sanitized) {
    if (isSensitiveKey(key)) {
      sanitized[key] = "***REDACTED***";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeData(sanitized[key], seen);
    }
  }

  return sanitized;
}
