import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  destroyPlanModeManager,
  getPlanModeManager,
} from "../../src/lib/plan-mode.js";

describe("agent-core plan execution lock", () => {
  beforeEach(() => {
    destroyPlanModeManager();
  });

  afterEach(() => {
    const manager = getPlanModeManager();
    if (manager.isActive()) manager.exitPlanMode();
    destroyPlanModeManager();
  });

  it("does not let a settings allow rule widen the approved tool set", async () => {
    const manager = getPlanModeManager();
    manager.enterPlanMode({ title: "Locked plan" });
    manager.addPlanItem({ title: "Write result", tool: "write_file" });
    manager.approvePlan({ permissionMode: "acceptEdits" });

    const result = await executeTool(
      "run_shell",
      { command: "node --version" },
      {
        cwd: process.cwd(),
        permissionRules: { allow: ["run_shell"] },
      },
    );

    expect(result.error).toContain("[Plan Execution Lock]");
    expect(manager.currentPlan.items).toHaveLength(1);
    expect(manager.getExecutionLock()).toMatchObject({
      permissionMode: "acceptEdits",
      allowedTools: expect.not.arrayContaining(["run_shell"]),
    });
  });
});
