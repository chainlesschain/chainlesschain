"use strict";

const {
  redactBrowserLogValue,
  sanitizeBrowserLogData,
} = require("../browser/browser-log-redaction");

const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u;
const LEVELS = ["debug", "info", "warn", "error"];

function createRemoteLogRedactor(logSink, component) {
  if (!logSink || typeof logSink !== "object") {
    throw new TypeError("Remote log sink is invalid");
  }
  if (typeof component !== "string" || !COMPONENT_NAME.test(component)) {
    throw new TypeError("Remote log component is invalid");
  }

  const logger = {};
  for (const level of LEVELS) {
    if (typeof logSink[level] !== "function") {
      throw new TypeError("Remote log sink level is invalid");
    }
    logger[level] = (message, data) => {
      const projection = Object.create(null);
      projection.message = redactBrowserLogValue(
        `remote-${component}-${level}-message`,
        message,
      );
      const sanitizedData = sanitizeBrowserLogData(data);
      if (sanitizedData !== undefined) {
        projection.data = sanitizedData;
      }
      return logSink[level](
        `[${component}] redacted event`,
        Object.freeze(projection),
      );
    };
  }

  return Object.freeze(logger);
}

module.exports = { createRemoteLogRedactor };
