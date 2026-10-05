import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { Command } from "commander";

vi.mock("../../src/runtime/bootstrap.js", () => ({
  bootstrap: vi.fn(),
  shutdown: vi.fn(),
}));

import { bootstrap, shutdown } from "../../src/runtime/bootstrap.js";
import { logger } from "../../src/lib/logger.js";
import { registerAutomationCommand } from "../../src/commands/automation.js";
import {
  AUTOMATION_EXECUTION_CAPABILITY,
  addTrigger,
  createFlow,
  ensureAutomationTables,
  getFlow,
  listExecutions,
  updateFlowStatus,
} from "../../src/lib/automation-engine.js";
import { buildAutomationCenterProjection } from "../../src/lib/automation-center.js";
import { grantPermission } from "../../src/lib/permission-engine.js";
import { setAutomationExecutionBudget } from "../../src/lib/automation-execution-authority.js";

describe("automation commands report actual execution capability", () => {
  let db;
  let flow;
  let trigger;
  let priorExitCode;
  let stdout;
  let output;
  let successes;
  let errors;

  beforeEach(() => {
    priorExitCode = process.exitCode;
    process.exitCode = 0;
    db = new Database(":memory:");
    ensureAutomationTables(db);
    const principal = "did:test:capability-commands";
    flow = createFlow(db, {
      name: "CLI notification capability",
      createdBy: principal,
      nodes: [
        {
          id: "notify",
          type: "action",
          connector: "slack",
          action: "postMessage",
        },
      ],
      edges: [],
    });
    updateFlowStatus(db, flow.id, "active");
    trigger = addTrigger(db, flow.id, { type: "manual" });
    grantPermission(db, principal, "automation:execute");
    grantPermission(db, principal, "automation:connector:slack");
    setAutomationExecutionBudget(db, flow.id, {
      windowMs: 3600000,
      maxRuns: 10,
      maxActionSteps: 10,
    });
    bootstrap.mockResolvedValue({ db: { getDatabase: () => db } });
    shutdown.mockResolvedValue(undefined);
    stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    output = vi.spyOn(logger, "log").mockImplementation(() => {});
    successes = vi.spyOn(logger, "success").mockImplementation(() => {});
    errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Unexpected process.exit(${code})`);
    });
  });

  afterEach(() => {
    db.close();
    process.exitCode = priorExitCode;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function run(args, alias = "automation") {
    const program = new Command();
    program.exitOverride();
    registerAutomationCommand(program);
    await program.parseAsync([alias, ...args], { from: "user" });
    expect(shutdown).toHaveBeenCalledOnce();
  }

  function revision() {
    return buildAutomationCenterProjection(db, {
      routineStore: { list: () => [] },
    }).items.find((item) => item.id === flow.id).revision;
  }

  it.each(["execute", "fire-trigger"])(
    "%s defaults to unsupported, records no applied steps and exits nonzero",
    async (command) => {
      await run([command, command === "execute" ? flow.id : trigger.id]);
      const [execution] = listExecutions(db, { flowId: flow.id });
      expect(execution).toMatchObject({
        status: "unsupported",
        testMode: false,
        stepsLog: [],
      });
      expect(execution.outputData).toMatchObject({
        executed: false,
        code: "AUTOMATION_EXECUTION_UNSUPPORTED",
      });
      expect(process.exitCode).toBe(1);
      expect(errors).toHaveBeenCalledWith(
        expect.stringContaining("unsupported"),
      );
      expect(successes).not.toHaveBeenCalled();
    },
  );

  it.each(["execute", "fire-trigger"])(
    "%s --test explicitly reports simulation without claiming business success",
    async (command) => {
      await run(
        [command, command === "execute" ? flow.id : trigger.id, "--test"],
        "auto",
      );
      const [execution] = listExecutions(db, { flowId: flow.id });
      expect(execution).toMatchObject({ status: "simulated", testMode: true });
      expect(execution.stepsLog).toHaveLength(1);
      expect(execution.stepsLog[0].status).toBe("simulated");
      expect(process.exitCode).toBe(0);
      expect(output).toHaveBeenCalledWith(
        expect.stringContaining("simulation only; no external actions applied"),
      );
      expect(successes).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it.each(["text", "json"])(
    "center-action %s rejects unavailable live execution before reserving budget",
    async (format) => {
      await run([
        "center-action",
        flow.id,
        "run_now",
        "--expected-revision",
        revision(),
        ...(format === "json" ? ["--json"] : []),
      ]);
      expect(errors).toHaveBeenCalledWith(
        AUTOMATION_EXECUTION_CAPABILITY.reason,
      );
      expect(process.exitCode).toBe(1);
      expect(successes).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(listExecutions(db, { flowId: flow.id })).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT * FROM auto_execution_budget_usage WHERE flow_id = ?",
          )
          .all(flow.id),
      ).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT * FROM auto_execution_budget_reservations WHERE flow_id = ?",
          )
          .all(flow.id),
      ).toEqual([]);
      expect(getFlow(db, flow.id).status).toBe("active");
    },
  );

  it("retains successful state changes independently of unsupported connector execution", async () => {
    await run([
      "center-action",
      flow.id,
      "pause",
      "--expected-revision",
      revision(),
      "--json",
    ]);
    const receipt = JSON.parse(stdout.mock.calls[0][0]);
    expect(receipt).toMatchObject({
      action: "pause",
      result: { status: "paused" },
    });
    expect(getFlow(db, flow.id).status).toBe("paused");
    expect(listExecutions(db, { flowId: flow.id })).toEqual([]);
    expect(process.exitCode).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });
});
