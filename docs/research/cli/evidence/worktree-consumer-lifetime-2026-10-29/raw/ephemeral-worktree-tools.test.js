import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../helpers/test-model-egress.js";
import { listBackgroundShellTasks } from "../../src/runtime/agent-core.js";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";
import broker from "../../src/lib/process-execution-broker/index.js";
import { withEphemeralWorktreeScope } from "../../src/lib/ephemeral-worktree-scope.js";

const schedule = vi.hoisted(() => ({
  construct: vi.fn(),
  wakeup: vi.fn(() => ({ id: "later" })),
  cron: vi.fn(),
  monitor: vi.fn(),
  list: vi.fn(() => []),
  cancel: vi.fn(() => ({ id: "later" })),
}));
vi.mock("../../src/lib/agent-schedule-store.js", () => ({
  AgentScheduleStore: class {
    constructor() {
      schedule.construct();
    }
    scheduleWakeup(...args) {
      return schedule.wakeup(...args);
    }
    createCron(...args) {
      return schedule.cron(...args);
    }
    createMonitor(...args) {
      return schedule.monitor(...args);
    }
    list(...args) {
      return schedule.list(...args);
    }
    cancel(...args) {
      return schedule.cancel(...args);
    }
  },
}));

const parent = fs.realpathSync.native(os.tmpdir());
let root;
const refusal = { code: "CC_EPHEMERAL_WORKTREE_CONSUMER_UNOWNED" };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(parent, "cc-ephemeral-tools-"));
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (
    path.dirname(root) !== parent ||
    !path.basename(root).startsWith("cc-ephemeral-tools-")
  )
    throw new Error("Unsafe ephemeral tools fixture cleanup");
  fs.rmSync(root, { recursive: true, force: true });
});
const scoped = (callback) => withEphemeralWorktreeScope(root, callback);

describe("ephemeral checkout tool lifetime admission", () => {
  it("refuses background shell before approval, Broker launch or task registration even with an external cwd", async () => {
    const spawn = vi.spyOn(broker, "spawn").mockImplementation(() => {
      throw new Error("must not spawn");
    });
    const approvalGate = { decide: vi.fn() };
    const before = listBackgroundShellTasks();
    const result = await scoped(() =>
      executeTool(
        "run_shell",
        {
          command: "echo child",
          run_in_background: true,
          cwd: parent,
        },
        { cwd: root, approvalGate },
      ),
    );
    expect(result).toMatchObject(refusal);
    expect(approvalGate.decide).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(listBackgroundShellTasks()).toEqual(before);
  });

  it.each(["explicit", "agent-file"])(
    "refuses %s background child before constructing it",
    async (kind) => {
      const create = vi
        .spyOn(SubAgentContext, "create")
        .mockImplementation(() => {
          throw new Error("must not create");
        });
      const args = { role: "worker", task: "Read the checkout" };
      if (kind === "explicit") args.background = true;
      else {
        fs.mkdirSync(path.join(root, ".chainlesschain", "agents"), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(root, ".chainlesschain", "agents", "worker.md"),
          "---\nname: worker\nbackground: true\n---\nRead the checkout.\n",
        );
        args.agent = "worker";
      }
      const backgroundSubAgents = new Map();
      expect(
        await scoped(() =>
          executeTool("spawn_sub_agent", args, {
            cwd: root,
            backgroundSubAgents,
          }),
        ),
      ).toMatchObject(refusal);
      expect(create).not.toHaveBeenCalled();
      expect(backgroundSubAgents.size).toBe(0);
    },
  );

  it.each(["wakeup", "cron", "monitor"])(
    "refuses schedule %s before constructing the persistent store",
    async (action) => {
      expect(
        await scoped(() =>
          executeTool(
            "schedule",
            {
              action,
              prompt: "Read checkout",
              command: "echo child",
              cron: "* * * * *",
            },
            { cwd: root },
          ),
        ),
      ).toMatchObject(refusal);
      expect(schedule.construct).not.toHaveBeenCalled();
      expect(schedule.wakeup).not.toHaveBeenCalled();
      expect(schedule.cron).not.toHaveBeenCalled();
      expect(schedule.monitor).not.toHaveBeenCalled();
    },
  );

  it("preserves schedule queries, cancellation and ordinary-host scheduling", async () => {
    expect(
      await scoped(() =>
        executeTool("schedule", { action: "list" }, { cwd: root }),
      ),
    ).toMatchObject({ entries: [] });
    expect(
      await scoped(() =>
        executeTool(
          "schedule",
          { action: "cancel", id: "later" },
          { cwd: root },
        ),
      ),
    ).toMatchObject({ cancelled: "later" });
    expect(
      await executeTool(
        "schedule",
        { action: "wakeup", prompt: "Persistent task" },
        { cwd: root },
      ),
    ).toMatchObject({ scheduled: { id: "later" } });
    expect(schedule.wakeup).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "refuses a skill child after materialization (initial isolation=%s) and releases its lease",
    async (isolation) => {
      const create = vi
        .spyOn(SubAgentContext, "create")
        .mockImplementation(() => {
          throw new Error("must not create");
        });
      const release = vi.fn();
      const skill = {
        id: "checkout-reader",
        hasHandler: true,
        isolation,
        body: "Read the checkout",
      };
      const skillLoader = {
        getResolvedSkills: () => [skill],
        acquireSkillExecution: () => ({ release }),
        materializeSkillForExecution: async () => ({
          ...skill,
          isolation: true,
        }),
      };
      expect(
        await scoped(() =>
          executeTool(
            "run_skill",
            { skill_name: skill.id },
            { cwd: root, skillLoader },
          ),
        ),
      ).toMatchObject(refusal);
      expect(create).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it("retains the restriction in late async descendants without leaking it to an ordinary host", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let late;
    await scoped(async () => {
      late = gate.then(() =>
        executeTool(
          "schedule",
          { action: "monitor", command: "echo late" },
          { cwd: parent },
        ),
      );
    });
    await executeTool(
      "schedule",
      { action: "wakeup", prompt: "Persistent host" },
      { cwd: root },
    );
    release();
    expect(await late).toMatchObject(refusal);
    expect(schedule.monitor).not.toHaveBeenCalled();
    expect(schedule.wakeup).toHaveBeenCalledTimes(1);
  });

  it("allows a synchronous child and waits for its result", async () => {
    let finish;
    const gate = new Promise((resolve) => {
      finish = resolve;
    });
    const outcome = {
      summary: "Child complete",
      artifacts: [],
      toolsUsed: [],
      iterationCount: 1,
      tokenCount: 0,
    };
    const child = {
      id: "sub-sync-fixture",
      role: "worker",
      status: "running",
      task: "Read the checkout",
      run: vi.fn(async () => {
        await gate;
        child.status = "completed";
        return outcome;
      }),
      recoveryBinding: () => ({}),
      forceComplete: vi.fn(),
    };
    vi.spyOn(SubAgentContext, "create").mockReturnValue(child);
    let settled = false;
    const pending = scoped(() =>
      executeTool(
        "spawn_sub_agent",
        { role: "worker", task: child.task },
        { cwd: root },
      ),
    ).finally(() => {
      settled = true;
    });
    // Admission contains dynamic imports; await the actual child invocation.
    await vi.waitFor(() => expect(child.run).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    finish();
    expect(await pending).toMatchObject({
      success: true,
      summary: outcome.summary,
    });
  });

  it("preserves the existing direct-handler denial for non-isolated skills", async () => {
    const create = vi.spyOn(SubAgentContext, "create");
    const release = vi.fn();
    const skill = {
      id: "inline-reader",
      hasHandler: true,
      isolation: false,
      body: "Read checkout inline",
    };
    const skillLoader = {
      getResolvedSkills: () => [skill],
      acquireSkillExecution: () => ({ release }),
      materializeSkillForExecution: async () => skill,
    };
    const result = await scoped(() =>
      executeTool(
        "run_skill",
        { skill_name: skill.id },
        { cwd: root, skillLoader },
      ),
    );
    expect(result.code).toBe("CC_SKILL_DIRECT_HANDLER_BLOCKED");
    expect(create).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
