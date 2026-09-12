/** Test helpers that make model-egress authority explicit in ordinary tests. */
import {
  agentLoop as productionAgentLoop,
  chatWithTools as productionChatWithTools,
  executeTool as productionExecuteTool,
} from "../../src/runtime/agent-core.js";
import { runAgentHeadless as productionRunAgentHeadless } from "../../src/runtime/headless-runner.js";
import { createChatFn as productionCreateChatFn } from "../../src/lib/cowork-adapter.js";

export * from "../../src/runtime/agent-core.js";
export * from "../../src/runtime/headless-runner.js";
export * from "../../src/lib/cowork-adapter.js";

const ingressKey = Symbol.for("chainlesschain.test.agent-evolution-ingress");
const enableKey = Symbol.for("chainlesschain.test.model-egress-enabled");
const compositionFactoryKey = Symbol.for(
  "chainlesschain.test.evolution-composition-factory",
);

/** Opt this test module into the setup's test-only model-egress adapters. */
export function enableTestModelEgress() {
  globalThis[enableKey] = true;
}

export function createTestEvolutionCompositionFactory() {
  const factory = globalThis[compositionFactoryKey];
  if (typeof factory !== "function") {
    throw new Error("Agent evolution test boundary setup was not loaded");
  }
  return factory;
}

// Importing this helper is the test file's explicit opt-in. The test boundary
// resets the flag after each file, so this cannot leak into a neighbouring
// fail-closed contract suite.
enableTestModelEgress();

export function withTestEvolutionIngress(options = {}) {
  if (Object.hasOwn(options, "evolutionIngress")) return options;
  const evolutionIngress = globalThis[ingressKey];
  if (!evolutionIngress) {
    throw new Error("Agent evolution test boundary setup was not loaded");
  }
  return { ...options, evolutionIngress };
}

export function agentLoop(messages, options = {}) {
  return productionAgentLoop(messages, withTestEvolutionIngress(options));
}

export function chatWithTools(messages, options = {}) {
  return productionChatWithTools(messages, withTestEvolutionIngress(options));
}

export function executeTool(name, args, context = {}) {
  return productionExecuteTool(
    name,
    args,
    withTestEvolutionIngress(context),
  );
}

export function runAgentHeadless(options = {}, deps = {}) {
  return productionRunAgentHeadless(withTestEvolutionIngress(options), deps);
}

export function createChatFn(options = {}) {
  return productionCreateChatFn(withTestEvolutionIngress(options));
}
