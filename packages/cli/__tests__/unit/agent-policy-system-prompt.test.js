/**
 * Regression guard: resolveAgentPolicy must forward --system-prompt /
 * --append-system-prompt overrides to the policy so startAgentRepl can compose
 * them into the interactive system message. (The composition itself is covered
 * by system-prompt.test.js.)
 */

import { describe, it, expect } from "vitest";
import { resolveAgentPolicy } from "../../src/runtime/policies/agent-policy.js";

describe("resolveAgentPolicy — system prompt overrides", () => {
  it("forwards systemPrompt and appendSystemPrompt overrides", () => {
    const policy = resolveAgentPolicy({
      config: {},
      overrides: {
        systemPrompt: "REPLACE",
        appendSystemPrompt: "EXTEND",
      },
    });
    expect(policy.systemPrompt).toBe("REPLACE");
    expect(policy.appendSystemPrompt).toBe("EXTEND");
  });

  it("defaults both to null when not supplied", () => {
    const policy = resolveAgentPolicy({ config: {}, overrides: {} });
    expect(policy.systemPrompt).toBeNull();
    expect(policy.appendSystemPrompt).toBeNull();
  });
});
