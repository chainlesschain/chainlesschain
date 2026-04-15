/**
 * Integration test: workflow WS handlers against real filesystem.
 *
 * Exercises the full handleWorkflow* pipeline through action-protocol.js,
 * writing/reading real files under a temp `projectRoot`. `runTask` is stubbed
 * (no LLM calls), everything else hits disk.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handleWorkflowList,
  handleWorkflowGet,
  handleWorkflowSave,
  handleWorkflowRemove,
  handleWorkflowRun,
} from "../../src/gateways/ws/action-protocol.js";
import { _deps as workflowDeps } from "../../src/lib/cowork-workflow.js";

function makeServer(projectRoot) {
  const sent = [];
  return {
    projectRoot,
    _send: (_ws, msg) => sent.push(msg),
    _sent: sent,
  };
}

describe("workflow WS handlers — integration (real fs)", () => {
  let tmpRoot;
  let server;
  let originalRunTask;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "cc-wf-int-"));
    server = makeServer(tmpRoot);
    originalRunTask = workflowDeps.runTask;
    workflowDeps.runTask = async ({ userMessage }) => ({
      taskId: `t-${Math.random().toString(36).slice(2, 8)}`,
      status: "completed",
      result: { summary: `ran:${userMessage}` },
    });
  });

  afterEach(() => {
    workflowDeps.runTask = originalRunTask;
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("full CRUD cycle writes and reads real files", async () => {
    // list empty
    await handleWorkflowList(server, "1", {});
    expect(server._sent[0]).toEqual({
      id: "1",
      type: "workflow:list",
      workflows: [],
    });

    // save
    const workflow = {
      id: "wf-int",
      name: "Integration Test",
      description: "hello",
      steps: [{ id: "s1", message: "greet" }],
    };
    await handleWorkflowSave(server, "2", {}, { workflow });
    expect(server._sent[1]).toMatchObject({
      saved: true,
      workflowId: "wf-int",
    });

    // file exists on disk
    const filePath = join(
      tmpRoot,
      ".chainlesschain",
      "cowork",
      "workflows",
      "wf-int.json",
    );
    expect(existsSync(filePath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(onDisk.id).toBe("wf-int");
    expect(onDisk.steps[0].message).toBe("greet");

    // list now returns it
    await handleWorkflowList(server, "3", {});
    const listMsg = server._sent.find(
      (m, i) => i >= 2 && m.type === "workflow:list",
    );
    expect(listMsg.workflows.map((w) => w.id)).toContain("wf-int");

    // get returns the saved workflow
    await handleWorkflowGet(server, "4", {}, { id: "wf-int" });
    const getMsg = server._sent.find((m) => m.type === "workflow:get");
    expect(getMsg.workflow.name).toBe("Integration Test");

    // remove
    await handleWorkflowRemove(server, "5", {}, { id: "wf-int" });
    const removeMsg = server._sent.find((m) => m.type === "workflow:remove");
    expect(removeMsg.removed).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it("run executes multi-step workflow with dependencies and emits event stream", async () => {
    const workflow = {
      id: "wf-run-int",
      name: "Multi-step",
      steps: [
        { id: "s1", message: "first" },
        { id: "s2", message: "second-${step.s1.summary}", dependsOn: ["s1"] },
      ],
    };
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(server, "2", {}, { id: "wf-run-int" });

    const types = server._sent.map((m) => m.type);
    expect(types).toContain("workflow:started");
    expect(types.filter((t) => t === "workflow:step-start").length).toBe(2);
    expect(types.filter((t) => t === "workflow:step-complete").length).toBe(2);
    expect(types).toContain("workflow:done");

    const done = server._sent.find((m) => m.type === "workflow:done");
    expect(done.status).toBe("completed");

    // run-history.jsonl should exist
    const historyPath = join(
      tmpRoot,
      ".chainlesschain",
      "cowork",
      "workflow-history.jsonl",
    );
    expect(existsSync(historyPath)).toBe(true);
    const lines = readFileSync(historyPath, "utf-8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects cyclic workflow with WORKFLOW_INVALID", async () => {
    await handleWorkflowSave(
      server,
      "1",
      {},
      {
        workflow: {
          id: "wf-cycle",
          name: "Cycle",
          steps: [
            { id: "a", message: "a", dependsOn: ["b"] },
            { id: "b", message: "b", dependsOn: ["a"] },
          ],
        },
      },
    );
    expect(server._sent[0]).toMatchObject({
      type: "error",
      code: "WORKFLOW_INVALID",
    });
    expect(
      existsSync(
        join(
          tmpRoot,
          ".chainlesschain",
          "cowork",
          "workflows",
          "wf-cycle.json",
        ),
      ),
    ).toBe(false);
  });

  it("save overwrites by id on disk", async () => {
    const v1 = {
      id: "ow",
      name: "F",
      steps: [{ id: "s1", message: "v1" }],
    };
    const v2 = {
      id: "ow",
      name: "F",
      steps: [{ id: "s1", message: "v2" }],
    };
    await handleWorkflowSave(server, "1", {}, { workflow: v1 });
    await handleWorkflowSave(server, "2", {}, { workflow: v2 });

    const filePath = join(
      tmpRoot,
      ".chainlesschain",
      "cowork",
      "workflows",
      "ow.json",
    );
    const onDisk = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(onDisk.steps[0].message).toBe("v2");
  });

  it("run bubbles WORKFLOW_NOT_FOUND for missing id", async () => {
    await handleWorkflowRun(server, "1", {}, { id: "ghost" });
    expect(server._sent[0]).toMatchObject({
      type: "error",
      code: "WORKFLOW_NOT_FOUND",
    });
  });
});
