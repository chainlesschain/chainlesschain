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

  it("forwards the --no-project-memory tri-state (allowlist passthrough)", () => {
    // Without the allowlist entry the flag is silently dropped and the REPL
    // never sees `options.projectMemory === false` — the lean prompt breaks.
    expect(
      resolveAgentPolicy({ config: {}, overrides: { projectMemory: false } })
        .projectMemory,
    ).toBe(false);
    expect(
      resolveAgentPolicy({ config: {}, overrides: { projectMemory: true } })
        .projectMemory,
    ).toBe(true);
    // Absent flag → undefined (default-on path preserved downstream).
    expect(
      resolveAgentPolicy({ config: {}, overrides: {} }).projectMemory,
    ).toBeUndefined();
  });
});
