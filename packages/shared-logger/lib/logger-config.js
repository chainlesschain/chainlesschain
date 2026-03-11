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

/**
 * Sanitize sensitive data from log output
 * @param {any} data
 * @param {WeakSet} [seen]
 */
export function sanitizeData(data, seen = new WeakSet()) {
  if (!data || typeof data !== "object") return data;

  if (data instanceof Error) {
    const serializedError = {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
    for (const key of Object.keys(data)) {
      const value = data[key];
      serializedError[key] =
        typeof value === "object" && value !== null
          ? sanitizeData(value, seen)
          : value;
    }
    return serializedError;
  }

  if (seen.has(data)) return "[Circular Reference]";
  seen.add(data);

  const sensitiveKeys = [
    "password",
    "token",
    "secret",
    "apiKey",
    "privateKey",
    "pin",
  ];
  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  for (const key in sanitized) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = "***REDACTED***";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeData(sanitized[key], seen);
    }
  }

  return sanitized;
}
