import { describe, expect, it, vi } from "vitest";
import {
  executeAdvisorCommand,
  parseAdvisorCommand,
  renderAdvisorStatus,
} from "../../src/repl/advisor-command.js";

describe("advisor REPL command", () => {
  it("parses on/off/status/once and rejects unknown actions", () => {
    expect(parseAdvisorCommand("hello")).toBeNull();
    expect(parseAdvisorCommand("/advisor")).toEqual({ action: "status" });
    expect(parseAdvisorCommand("/advisor on")).toEqual({ action: "on" });
    expect(parseAdvisorCommand("/advisor off")).toEqual({ action: "off" });
    expect(parseAdvisorCommand("/advisor once focus on rollback")).toEqual({
      action: "once",
      focus: "focus on rollback",
    });
    expect(parseAdvisorCommand("/advisor nope")).toMatchObject({
      action: "error",
    });
  });

  it("renders policy, budget and authority status", () => {
    const text = renderAdvisorStatus({
      enabled: true,
      allowed: true,
      managed: true,
      provider: "openai",
      model: "gpt-5",
      budgetUsd: 0.1,
      spentUsd: 0.02,
      remainingUsd: 0.08,
      calls: 2,
      totalTokens: 300,
      repeatErrorThreshold: 3,
    });
    expect(text).toContain("Advisor: on");
    expect(text).toContain("managed allowlist: allowed");
    expect(text).toContain("openai/gpt-5");
    expect(text).toContain("no tools, no permission escalation");
  });

  it("toggles session state and permits one forced call while off", async () => {
    const runtime = {
      status: vi.fn(() => ({ enabled: false, allowed: true })),
      setEnabled: vi.fn((enabled) => ({ ok: true, enabled })),
      advise: vi.fn(async () => ({
        ok: true,
        trigger: "manual",
        guidance: "verify locally",
        advice: {
          risk: "low",
          recommendation: "Inspect the diff.",
          verification: ["git diff --check"],
        },
      })),
    };
    expect(
      await executeAdvisorCommand(parseAdvisorCommand("/advisor on"), {
        runtime,
      }),
    ).toMatchObject({ ok: true, output: "Advisor enabled for this session." });
    const once = await executeAdvisorCommand(
      parseAdvisorCommand("/advisor once check completion"),
      { runtime, messages: [{ role: "user", content: "task" }] },
    );
    expect(once).toMatchObject({ ok: true, guidance: "verify locally" });
    expect(once.output).toContain("Verify locally");
    expect(runtime.advise).toHaveBeenCalledWith(
      expect.objectContaining({ force: true, subject: "check completion" }),
    );
  });
});
