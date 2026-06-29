/**
 * Regression test for AgentCoordinator template-based agent selection.
 *
 * Bug: selectBestAgent (sync) called templateManager.listTemplates() — which is
 * ASYNC and resolves to { templates, total } — WITHOUT await, then iterated the
 * returned Promise with `for...of`. That threw "Promise is not iterable", which
 * the surrounding try/catch swallowed, silently disabling ALL template-based
 * agent scoring. getPlan still returned a plan (so it looked fine), but no
 * subtask ever matched a template. Fixed by making selectBestAgent + getPlan
 * async and awaiting listTemplates.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  AgentCoordinator,
} = require("../../../../src/main/ai-engine/agents/agent-coordinator.js");

describe("AgentCoordinator template-based selection (async)", () => {
  it("awaits listTemplates and matches a template whose type fits the subtask", async () => {
    const templateManager = {
      // resolves to the real { templates, total } contract
      listTemplates: vi.fn().mockResolvedValue({ templates: [], total: 0 }),
    };
    const coord = new AgentCoordinator({ templateManager });

    // Learn the agentType decompose actually produces, then offer a matching
    // template (type match scores 0.5 >= minCapabilityScore 0.3).
    const task = "Write code to build a login feature";
    const subtasks = coord.decompose(task);
    expect(subtasks.length).toBeGreaterThan(0);
    const agentType = subtasks[0].agentType;

    templateManager.listTemplates.mockResolvedValue({
      templates: [
        {
          id: "tpl-match",
          name: "Matcher",
          type: agentType,
          enabled: 1,
          capabilities: "[]",
        },
      ],
      total: 1,
    });

    const plan = await coord.getPlan(task);

    expect(templateManager.listTemplates).toHaveBeenCalled();
    // The template branch now runs (was dead pre-fix): the subtask matched the
    // template and is executable.
    expect(plan.subtasks[0].canExecute).toBe(true);
    expect(plan.subtasks[0].proposedAgent).toMatchObject({ id: "tpl-match" });
  });

  it("getPlan resolves (no unhandled rejection) when listTemplates is empty", async () => {
    const templateManager = {
      listTemplates: vi.fn().mockResolvedValue({ templates: [], total: 0 }),
    };
    const coord = new AgentCoordinator({ templateManager });
    await expect(coord.getPlan("do something")).resolves.toBeTruthy();
    expect(templateManager.listTemplates).toHaveBeenCalled();
  });

  it("tolerates a bare-array listTemplates return (defensive)", async () => {
    const task = "Write code to build a feature";
    const probe = new AgentCoordinator({ templateManager: {} });
    const agentType = probe.decompose(task)[0].agentType;
    const templateManager = {
      listTemplates: vi
        .fn()
        .mockResolvedValue([
          {
            id: "arr-1",
            name: "Arr",
            type: agentType,
            enabled: 1,
            capabilities: "[]",
          },
        ]),
    };
    const coord = new AgentCoordinator({ templateManager });
    const plan = await coord.getPlan(task);
    expect(plan.subtasks[0].canExecute).toBe(true);
  });
});
