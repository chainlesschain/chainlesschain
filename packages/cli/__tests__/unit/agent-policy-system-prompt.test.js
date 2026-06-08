/**
 * Regression guard: resolveAgentPolicy must forward --system-prompt /
 * --append-system-prompt overrides to the policy so startAgentRepl can compose
 * them into the interactive system message. (The composition itself is covered
 * by system-prompt.test.js.)
 */

import { describe, it, expect } from "vitest";
import { resolveAgentPolicy } from "../../src/runtime/policies/agent-policy.js";

describe("resolveAgentPolicy — system prompt overrides", () => {
  it("forwards systemPrompt, appendSystemPrompt, and fallbackModel overrides", () => {
    const policy = resolveAgentPolicy({
      config: {},
      overrides: {
        systemPrompt: "REPLACE",
        appendSystemPrompt: "EXTEND",
        fallbackModel: "backup",
      },
    });
    expect(policy.systemPrompt).toBe("REPLACE");
    expect(policy.appendSystemPrompt).toBe("EXTEND");
    expect(policy.fallbackModel).toBe("backup");
  });

  it("defaults all three to null when not supplied", () => {
    const policy = resolveAgentPolicy({ config: {}, overrides: {} });
    expect(policy.systemPrompt).toBeNull();
    expect(policy.appendSystemPrompt).toBeNull();
    expect(policy.fallbackModel).toBeNull();
  });
});
