/** Test helpers that make model-egress authority explicit in ordinary tests. */
import {
  agentLoop as productionAgentLoop,
  chatWithTools as productionChatWithTools,
} from "../../src/runtime/agent-core.js";
import { runAgentHeadless as productionRunAgentHeadless } from "../../src/runtime/headless-runner.js";
import { createChatFn as productionCreateChatFn } from "../../src/lib/cowork-adapter.js";

export * from "../../src/runtime/agent-core.js";
export * from "../../src/runtime/headless-runner.js";
export * from "../../src/lib/cowork-adapter.js";

const ingressKey = Symbol.for("chainlesschain.test.agent-evolution-ingress");

function withTestEvolutionIngress(options = {}) {
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

export function runAgentHeadless(options = {}, deps = {}) {
  return productionRunAgentHeadless(withTestEvolutionIngress(options), deps);
}

export function createChatFn(options = {}) {
  return productionCreateChatFn(withTestEvolutionIngress(options));
}
