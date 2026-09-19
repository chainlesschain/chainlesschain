/**
 * Privacy boundary for provider-adapter diagnostics.
 *
 * Provider errors can carry request headers, query-string API keys, prompts,
 * response bodies, local paths, and generated content. This wrapper therefore
 * does not inspect or accept an Error object. It emits only fixed messages and
 * allowlisted identifiers owned by this module.
 */

const { logger } = require("../utils/logger.js");

const SAFE_PROVIDERS = new Set([
  "anthropic",
  "deepseek",
  "gemini",
  "llava",
  "mistral",
  "ollama",
  "openai",
  "volcengine",
]);

const SAFE_OPERATIONS = new Set([
  "chat",
  "chat-stream",
  "complete",
  "configure",
  "delete-model",
  "embed",
  "generate",
  "generate-stream",
  "image-analyze",
  "image-analyze-stream",
  "image-read",
  "initialize",
  "list-models",
  "model-info",
  "pull-model",
  "status",
]);

function allowlisted(value, values) {
  return typeof value === "string" && values.has(value) ? value : "unknown";
}

function boundedAttempt(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 100 ? value : 1;
}

function createProviderLogger(provider, sink = logger) {
  const safeProvider = allowlisted(provider, SAFE_PROVIDERS);
  const details = (operation) => ({
    provider: safeProvider,
    operation: allowlisted(operation, SAFE_OPERATIONS),
  });

  return Object.freeze({
    failure(operation) {
      sink.error("[LLMProvider] operation failed", details(operation));
    },
    retry(operation, attempt) {
      sink.warn("[LLMProvider] operation retry scheduled", {
        ...details(operation),
        attempt: boundedAttempt(attempt),
      });
    },
    started(operation) {
      sink.info("[LLMProvider] operation started", details(operation));
    },
    success(operation) {
      sink.info("[LLMProvider] operation succeeded", details(operation));
    },
  });
}

module.exports = {
  createProviderLogger,
};
