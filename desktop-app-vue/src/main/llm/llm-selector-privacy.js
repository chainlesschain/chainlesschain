/** Fixed diagnostic boundary for the business LLM selector. */

const { logger } = require("../utils/logger.js");

const SAFE_EVENTS = new Set([
  "provider-defaulted",
  "provider-fallback-selected",
  "provider-selected",
  "task-model-defaulted",
  "task-model-selected",
]);

function createLlmSelectorPrivacy(sink = logger) {
  return Object.freeze({
    event(event) {
      sink.info("[LLMSelector] internal event", {
        component: "selector",
        event:
          typeof event === "string" && SAFE_EVENTS.has(event)
            ? event
            : "unknown",
      });
    },
  });
}

module.exports = { createLlmSelectorPrivacy };
