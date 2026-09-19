"use strict";

const {
  redactBrowserLogValue,
  sanitizeBrowserLogData,
} = require("../browser/browser-log-redaction");

const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u;
const LEVELS = ["debug", "info", "warn", "error"];

function createPluginLogRedactor(logSink, component) {
  if (!logSink || typeof logSink !== "object") {
    throw new TypeError("Plugin log sink is invalid");
  }
  if (typeof component !== "string" || !COMPONENT_NAME.test(component)) {
    throw new TypeError("Plugin log component is invalid");
  }

  const logger = {};
  for (const level of LEVELS) {
    if (typeof logSink[level] !== "function") {
      throw new TypeError("Plugin log sink level is invalid");
    }
    logger[level] = (message, ...data) => {
      const projection = Object.create(null);
      projection.message = redactBrowserLogValue(
        `plugin-${component}-${level}-message`,
        message,
      );
      if (data.length > 0) {
        projection.data = sanitizeBrowserLogData(
          data.length === 1 ? data[0] : data,
        );
      }
      return logSink[level](
        `[Plugin:${component}] redacted event`,
        Object.freeze(projection),
      );
    };
  }

  return Object.freeze(logger);
}

module.exports = { createPluginLogRedactor };
