/**
 * Test-only admission at the two private model-egress seams.
 *
 * Production still accepts only branded ingress instances.  Unit/integration
 * tests opt in through helpers/test-model-egress.js, which supplies this
 * sentinel explicitly; tests for the fail-closed boundary continue to call
 * the production APIs without it.
 */
import { vi } from "vitest";

export const TEST_AGENT_EVOLUTION_INGRESS = Object.freeze({
  tenantId: "tenant-test-agent-egress",
  testOnlyUnownedCompaction: true,
  start: async () => undefined,
  ingestUserPrompt: async () => undefined,
  ingestAgentEvent: async () => undefined,
  complete: async () => undefined,
  prepareModelRequest: async ({ messages, tools }) => ({ messages, tools }),
});

const ingressKey = Symbol.for("chainlesschain.test.agent-evolution-ingress");
if (globalThis[ingressKey] && globalThis[ingressKey] !== TEST_AGENT_EVOLUTION_INGRESS) {
  throw new Error("Agent evolution test ingress was initialized twice");
}
globalThis[ingressKey] = TEST_AGENT_EVOLUTION_INGRESS;

vi.mock("../../src/lib/evolution/agent-evolution-ingress.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    captureAgentEvolutionIngress(value, options = {}) {
      if (value === TEST_AGENT_EVOLUTION_INGRESS) {
        if (options.tenantId && options.tenantId !== value.tenantId) {
          throw new TypeError("Agent evolution ingress belongs to another tenant");
        }
        return value;
      }
      return actual.captureAgentEvolutionIngress(value, options);
    },
  };
});

vi.mock("../../src/runtime/fallback-model.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    captureCanonicalFallbackChatFn(value, ingress) {
      if (ingress === TEST_AGENT_EVOLUTION_INGRESS) return value;
      return actual.captureCanonicalFallbackChatFn(value, ingress);
    },
  };
});
