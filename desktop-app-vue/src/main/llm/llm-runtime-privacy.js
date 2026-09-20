/** Fixed diagnostic boundary for LLM runtime primitives. */

const { logger } = require("../utils/logger.js");

const SAFE_COMPONENTS = new Set(["state-bus", "stream-controller"]);
const SAFE_EVENTS = new Set([
  "listener-failed",
  "pause-rejected",
  "resume-rejected",
  "source-already-forwarded",
]);
const SAFE_PUBLIC_EVENTS = new Set([
  "start",
  "chunk",
  "pause",
  "resume",
  "cancel",
  "complete",
  "stream-error",
  "reset",
]);

function allowlisted(value, values) {
  return typeof value === "string" && values.has(value) ? value : "unknown";
}

function createLlmRuntimePrivacy(component, sink = logger) {
  const safeComponent = allowlisted(component, SAFE_COMPONENTS);

  return Object.freeze({
    event(event) {
      sink.info("[LLMRuntime] internal event", {
        component: safeComponent,
        event: allowlisted(event, SAFE_EVENTS),
      });
    },
    publicEvent(event) {
      return Object.freeze({
        code: "CC_LLM_STREAM_EVENT",
        component: safeComponent,
        event: allowlisted(event, SAFE_PUBLIC_EVENTS),
      });
    },
  });
}

module.exports = { createLlmRuntimePrivacy };
