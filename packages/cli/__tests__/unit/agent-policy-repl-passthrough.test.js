/**
 * Regression guard: resolveAgentPolicy is an explicit allowlist, and keys the
 * interactive REPL consumes were silently dropped before 2026-07-09 (breaking
 * --vim / --think / --thinking-budget / --fallback-model / --pdh /
 * --permission-mode for `cc agent` interactive sessions). Same bug class as
 * the systemPrompt guard in agent-policy-system-prompt.test.js.
 */

import { describe, it, expect } from "vitest";
import { resolveAgentPolicy } from "../../src/runtime/policies/agent-policy.js";

describe("resolveAgentPolicy — interactive REPL passthrough keys", () => {
  it("forwards the REPL-consumed overrides verbatim", () => {
    const policy = resolveAgentPolicy({
      config: {},
      overrides: {
        permissionMode: "auto",
        vimMode: true,
        thinking: "high",
        thinkingBudget: 4096,
        fallbackModels: ["backup-a", "backup-b"],
        pdh: true,
        outputStyle: "concise",
        disableSlashCommands: true,
      },
    });
    expect(policy.permissionMode).toBe("auto");
    expect(policy.vimMode).toBe(true);
    expect(policy.thinking).toBe("high");
    expect(policy.thinkingBudget).toBe(4096);
    expect(policy.fallbackModels).toEqual(["backup-a", "backup-b"]);
    expect(policy.pdh).toBe(true);
    expect(policy.outputStyle).toBe("concise");
    expect(policy.disableSlashCommands).toBe(true);
  });

  it("leaves them undefined when not supplied (tri-state / unset semantics)", () => {
    const policy = resolveAgentPolicy({ config: {}, overrides: {} });
    expect(policy.permissionMode).toBeUndefined();
    expect(policy.vimMode).toBeUndefined();
    expect(policy.thinking).toBeUndefined();
    expect(policy.thinkingBudget).toBeUndefined();
    expect(policy.fallbackModels).toBeUndefined();
    expect(policy.pdh).toBeUndefined();
    expect(policy.outputStyle).toBeUndefined();
    // boolean-normalized (not tri-state): absent → false
    expect(policy.disableSlashCommands).toBe(false);
  });
});
