/**
 * Test-only admission at the two private model-egress seams.
 *
 * Production still accepts only branded ingress instances.  Unit/integration
 * tests opt in through helpers/test-model-egress.js, which supplies this
 * sentinel explicitly; tests for the fail-closed boundary continue to call
 * the production APIs without it.
 */
import { afterAll, vi } from "vitest";

const testIngresses = new WeakSet();
const testCompositions = new WeakSet();

export const TEST_AGENT_EVOLUTION_INGRESS = Object.freeze({
  tenantId: "tenant-test-agent-egress",
  testOnlyUnownedCompaction: true,
  start: async () => undefined,
  ingestUserPrompt: async () => undefined,
  ingestAgentEvent: async () => undefined,
  complete: async () => undefined,
  prepareModelRequest: async ({ messages, tools }) => ({ messages, tools }),
});
testIngresses.add(TEST_AGENT_EVOLUTION_INGRESS);

const ingressKey = Symbol.for("chainlesschain.test.agent-evolution-ingress");
if (globalThis[ingressKey] && globalThis[ingressKey] !== TEST_AGENT_EVOLUTION_INGRESS) {
  throw new Error("Agent evolution test ingress was initialized twice");
}
globalThis[ingressKey] = TEST_AGENT_EVOLUTION_INGRESS;

const enableKey = Symbol.for("chainlesschain.test.model-egress-enabled");
globalThis[enableKey] = false;
afterAll(() => {
  globalThis[enableKey] = false;
});

function supportsImplicitTestIngress() {
  return globalThis[enableKey] === true;
}

function withTestIngress(options = {}) {
  if (!supportsImplicitTestIngress() || Object.hasOwn(options, "evolutionIngress")) {
    return options;
  }
  return { ...options, evolutionIngress: TEST_AGENT_EVOLUTION_INGRESS };
}

function createTestIngress(runId) {
  const ingress = Object.freeze({
    ...TEST_AGENT_EVOLUTION_INGRESS,
    runId,
  });
  testIngresses.add(ingress);
  return ingress;
}

const compositionFactoryKey = Symbol.for(
  "chainlesschain.test.evolution-composition-factory",
);
globalThis[compositionFactoryKey] = async ({ runId }) => {
  const evolutionIngress = createTestIngress(runId);
  const composition = Object.freeze({
    tenantId: evolutionIngress.tenantId,
    runId,
    evolutionIngress,
  });
  testCompositions.add(composition);
  return composition;
};

vi.mock("../../src/lib/evolution/agent-evolution-ingress.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    captureAgentEvolutionIngress(value, options = {}) {
      if (testIngresses.has(value)) {
        if (options.tenantId && options.tenantId !== value.tenantId) {
          throw new TypeError("Agent evolution ingress belongs to another tenant");
        }
        return value;
      }
      return actual.captureAgentEvolutionIngress(value, options);
    },
  };
});

vi.mock(
  "../../src/lib/evolution/agent-evolution-runtime-composition-brand.js",
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      captureAgentEvolutionRuntimeComposition(value, options) {
        if (testCompositions.has(value)) return value;
        return actual.captureAgentEvolutionRuntimeComposition(value, options);
      },
    };
  },
);

vi.mock("../../src/runtime/fallback-model.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    captureCanonicalFallbackChatFn(value, ingress) {
      if (testIngresses.has(ingress)) return value;
      return actual.captureCanonicalFallbackChatFn(value, ingress);
    },
  };
});

vi.mock("../../src/runtime/agent-core.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    agentLoop: (messages, options = {}) =>
      actual.agentLoop(messages, withTestIngress(options)),
    chatWithTools: (messages, options = {}) =>
      actual.chatWithTools(messages, withTestIngress(options)),
    executeTool: (name, args, context = {}) =>
      actual.executeTool(name, args, withTestIngress(context)),
  };
});

vi.mock("../../src/runtime/headless-runner.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runAgentHeadless: (options = {}, deps = {}) =>
      actual.runAgentHeadless(withTestIngress(options), deps),
  };
});

vi.mock("../../src/lib/cowork-adapter.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createChatFn: (options = {}) => actual.createChatFn(withTestIngress(options)),
  };
});

vi.mock("../../src/lib/evolution/governed-model-turn.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    prepareGovernedModelTurn: (factory, input) => {
      if (factory !== null || !supportsImplicitTestIngress()) {
        return actual.prepareGovernedModelTurn(factory, input);
      }
      return actual.prepareGovernedModelTurn(
        globalThis[compositionFactoryKey],
        input,
      );
    },
  };
});
