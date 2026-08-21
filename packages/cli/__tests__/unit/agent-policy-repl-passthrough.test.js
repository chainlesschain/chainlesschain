/**
 * Regression guard: resolveAgentPolicy is an explicit allowlist, and keys the
 * interactive REPL consumes were silently dropped before 2026-07-09 (breaking
 * --vim / --think / --thinking-budget / --fallback-model / --pdh /
 * --permission-mode for `cc agent` interactive sessions). Same bug class as
 * the systemPrompt guard in agent-policy-system-prompt.test.js.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentPolicy } from "../../src/runtime/policies/agent-policy.js";

const agentCommandSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../src/commands/agent.js"),
  "utf8",
);

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
        settingsFile: "run-settings.json",
        disableSlashCommands: true,
        remoteControl: true,
        remoteControlAllowLan: true,
        worktreeId: "agent/repl-task-1",
        sessionBudgetRoot: {
          enabled: true,
          limits: { maxTurns: 5 },
        },
      },
    });
    expect(policy.permissionMode).toBe("auto");
    expect(policy.vimMode).toBe(true);
    expect(policy.thinking).toBe("high");
    expect(policy.thinkingBudget).toBe(4096);
    expect(policy.fallbackModels).toEqual(["backup-a", "backup-b"]);
    expect(policy.pdh).toBe(true);
    expect(policy.outputStyle).toBe("concise");
    expect(policy.settingsFile).toBe("run-settings.json");
    expect(policy.disableSlashCommands).toBe(true);
    expect(policy.remoteControl).toBe(true);
    expect(policy.remoteControlAllowLan).toBe(true);
    expect(policy.worktreeId).toBe("agent/repl-task-1");
    expect(policy.sessionBudgetRoot).toEqual({
      enabled: true,
      limits: { maxTurns: 5 },
    });
    expect(Object.isFrozen(policy.sessionBudgetRoot)).toBe(true);
    expect(Object.isFrozen(policy.sessionBudgetRoot.limits)).toBe(true);
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
    expect(policy.settingsFile).toBeNull();
    // boolean-normalized (not tri-state): absent → false
    expect(policy.disableSlashCommands).toBe(false);
    expect(policy.remoteControl).toBe(false);
    expect(policy.remoteControlAllowLan).toBe(false);
    expect(policy.worktreeId).toBeNull();
    expect(policy.sessionBudgetRoot).toBeNull();
  });

  it("forwards command flags into the interactive runtime overrides", () => {
    expect(agentCommandSource).toContain(
      "outputStyle: options.outputStyle || null",
    );
    expect(agentCommandSource).toContain(
      "settingsFile: options.settings || null",
    );
  });
});
