import assert from "node:assert/strict";
import { DIAGNOSTIC } from "./verify01-volcengine-task-diagnostic.mjs";
import {
  BROKER,
  createVolcengineDiagnosticBroker,
} from "./verify01-volcengine-diagnostic-broker.mjs";
import {
  OPENAI_BROKER,
  createOpenAiDiagnosticBroker,
} from "./verify01-openai-diagnostic-broker.mjs";

/** Operator selection only; existing Volcengine cohorts retain their policy. */
export function nativeProviderProfile(provider = DIAGNOSTIC.provider) {
  assert.ok(
    ["volcengine", "openai"].includes(provider),
    "unsupported diagnostic provider",
  );
  return provider === "openai"
    ? Object.freeze({
        provider,
        model: OPENAI_BROKER.model,
        keyEnvironment: "OPENAI_API_KEY",
        policy: OPENAI_BROKER,
        createBroker: createOpenAiDiagnosticBroker,
        defaultThinkingPreserved: true,
      })
    : Object.freeze({
        provider,
        model: DIAGNOSTIC.model,
        keyEnvironment: "VOLCENGINE_API_KEY",
        policy: BROKER,
        createBroker: createVolcengineDiagnosticBroker,
        defaultThinkingPreserved: false,
      });
}
