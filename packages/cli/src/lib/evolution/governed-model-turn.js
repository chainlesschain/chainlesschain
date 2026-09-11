import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { captureAgentEvolutionRuntimeComposition } from "./agent-evolution-runtime-composition-brand.js";
import { captureAgentEvolutionIngress } from "./agent-evolution-ingress.js";

export function readEvolutionCompositionFactory(dependencies = {}) {
  if (
    !dependencies ||
    typeof dependencies !== "object" ||
    Array.isArray(dependencies) ||
    types.isProxy(dependencies)
  ) {
    throw new TypeError("Model turn dependencies must be a plain object");
  }
  const property = Object.getOwnPropertyDescriptor(
    dependencies,
    "evolutionCompositionFactory",
  );
  if (
    property &&
    (!Object.hasOwn(property, "value") || typeof property.value !== "function")
  ) {
    throw new TypeError(
      "evolutionCompositionFactory must be a function data property",
    );
  }
  return property?.value ?? null;
}

// Only a host-owned factory can supply authority. Client messages supply input,
// never a run identifier or composition to borrow from another request.
export async function prepareGovernedModelTurn(
  factory,
  { mode, messages, signal },
) {
  signal?.throwIfAborted();
  if (factory === null) {
    const error = new Error(
      "Model egress requires an authenticated evolution composition factory",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  if (typeof factory !== "function")
    throw new TypeError("Invalid evolution composition factory");
  const runId = `${mode}-${randomUUID()}`;
  const composition = captureAgentEvolutionRuntimeComposition(
    await factory(
      Object.freeze({ mode, runId, taskId: runId, cwd: process.cwd() }),
    ),
  );
  const ingress = captureAgentEvolutionIngress(composition.evolutionIngress);
  if (
    composition.runId !== runId ||
    ingress.runId !== runId ||
    composition.tenantId !== ingress.tenantId
  ) {
    throw new Error(
      "Model evolution composition is not bound to the requested Run",
    );
  }
  signal?.throwIfAborted();
  await ingress.start();
  await ingress.ingestUserPrompt({ messages, source: mode });
  const prepared = await ingress.prepareModelRequest({ messages, tools: [] });
  signal?.throwIfAborted();
  return Object.freeze({
    governed: true,
    messages: prepared.messages,
    async complete(content) {
      signal?.throwIfAborted();
      await ingress.ingestAgentEvent({ type: "response-complete", content });
      signal?.throwIfAborted();
      await ingress.complete();
    },
  });
}

export async function* governModelTokenSource(source, turn, signal) {
  let content = "";
  for await (const delta of source) {
    signal?.throwIfAborted();
    content += delta;
    yield delta;
  }
  await turn.complete(content);
}
