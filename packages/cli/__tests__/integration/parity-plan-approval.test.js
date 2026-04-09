/**
 * Parity Harness — Plan Mode approval flow
 *
 * Phase 7 Step 2. Drives `agentLoop` with the mock LLM provider to assert the
 * deterministic event stream for the Plan Mode gate:
 *
 *   1. In ANALYZING state, a write tool call is blocked, added to the plan,
 *      and the agent loop surfaces a `[Plan Mode] Tool "X" is blocked` error
 *      via tool-result — WITHOUT touching the filesystem.
 *   2. Read tools (`read_file`) continue to execute normally during ANALYZING.
 *   3. After `approvePlan()`, the same write tool now executes and mutates
 *      the filesystem.
 *
 * This test exercises the real PlanModeManager + real executeTool path —
 * only the LLM is mocked. The manager is passed explicitly via options so
 * the test owns its own isolated state (the plan manager is a module
 * singleton by default, which would leak between tests).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import { PlanModeManager } from "../../src/lib/plan-mode.js";
import {
  createMockLLMProvider,
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

async function drain(iterable) {
  const out = [];
  for await (const event of iterable) {
    out.push(event);
  }
  return out;
}

describe("Phase 7 parity: Plan Mode approval flow", () => {
  let workDir;
  let planManager;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "parity-plan-"));
    planManager = new PlanModeManager();
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("blocks write_file during ANALYZING and records it as a plan item", async () => {
    planManager.enterPlanMode({ title: "test plan", goal: "write a file" });
    expect(planManager.state).toBe("analyzing");

    const target = join(workDir, "should-not-exist.txt");

    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage(
            "write_file",
            { path: target, content: "blocked" },
            "call_plan_block",
          ),
        },
      },
      {
        // After the tool-result comes back with a block error, the "model"
        // acknowledges it and ends the turn.
        expect: (messages) =>
          messages.some(
            (m) =>
              m.role === "tool" &&
              typeof m.content === "string" &&
              m.content.includes("[Plan Mode]"),
          ),
        response: {
          message: mockTextMessage("Blocked — added to plan."),
        },
      },
    ]);

    const events = await drain(
      agentLoop([{ role: "user", content: "write the file" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
        planManager,
      }),
    );

    // Exactly 3 events: tool-executing, tool-result (blocked), response-complete
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("tool-executing");
    expect(events[0].tool).toBe("write_file");

    expect(events[1].type).toBe("tool-result");
    expect(events[1].tool).toBe("write_file");
    // Plan Mode returns an error object (not a throw) — error field on the
    // yielded event stays null because no exception was raised.
    expect(events[1].result.error).toMatch(
      /\[Plan Mode\].*write_file.*blocked/,
    );

    expect(events[2]).toEqual({
      type: "response-complete",
      content: "Blocked — added to plan.",
    });

    // Filesystem side-effect MUST NOT have happened
    expect(existsSync(target)).toBe(false);

    // Plan manager recorded the blocked call as a plan item with medium impact
    expect(planManager.currentPlan.items).toHaveLength(1);
    const item = planManager.currentPlan.items[0];
    expect(item.tool).toBe("write_file");
    expect(item.estimatedImpact).toBe("medium");
    expect(item.params.path).toBe(target);

    mock.assertDrained();
  });

  it("allows read_file during ANALYZING without blocking", async () => {
    planManager.enterPlanMode({ title: "read-only plan" });

    const readTarget = join(workDir, "readable.txt");
    writeFileSync(readTarget, "plan-mode visible content", "utf8");

    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage(
            "read_file",
            { path: readTarget },
            "call_plan_read",
          ),
        },
      },
      {
        expect: (messages) =>
          messages.some(
            (m) =>
              m.role === "tool" &&
              typeof m.content === "string" &&
              m.content.includes("plan-mode visible content"),
          ),
        response: { message: mockTextMessage("Read while planning — ok.") },
      },
    ]);

    const events = await drain(
      agentLoop([{ role: "user", content: "read" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
        planManager,
      }),
    );

    expect(events[1].type).toBe("tool-result");
    // Real read_file executor ran — result carries content, NO plan-mode block
    expect(JSON.stringify(events[1].result)).toContain(
      "plan-mode visible content",
    );
    expect(JSON.stringify(events[1].result)).not.toContain("[Plan Mode]");

    // read tools are not recorded as plan items
    expect(planManager.currentPlan.items).toHaveLength(0);
  });

  it("write_file executes after approvePlan() and actually mutates the filesystem", async () => {
    planManager.enterPlanMode({ title: "approve & execute" });
    planManager.approvePlan(); // jump straight to APPROVED
    expect(planManager.state).toBe("approved");

    const target = join(workDir, "after-approval.txt");

    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage(
            "write_file",
            { path: target, content: "post-approval payload" },
            "call_post_approve",
          ),
        },
      },
      {
        // Expect the tool result does NOT carry a plan-mode block error
        expect: (messages) => {
          const toolMsg = [...messages]
            .reverse()
            .find((m) => m.role === "tool");
          return toolMsg && !toolMsg.content.includes("[Plan Mode]");
        },
        response: { message: mockTextMessage("Wrote it.") },
      },
    ]);

    const events = await drain(
      agentLoop([{ role: "user", content: "write now" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
        planManager,
      }),
    );

    expect(events[1].type).toBe("tool-result");
    expect(events[1].result.error).toBeUndefined();
    expect(events[2].content).toBe("Wrote it.");

    // Filesystem side-effect DID happen this time
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("post-approval payload");

    mock.assertDrained();
  });

  it("isolated PlanModeManager state does not leak between tests", () => {
    // Sanity: beforeEach always creates a fresh manager, so previous tests
    // can't bleed plan state into this one.
    expect(planManager.isActive()).toBe(false);
    expect(planManager.currentPlan).toBeNull();
  });
});
