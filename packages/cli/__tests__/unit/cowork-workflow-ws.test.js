import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleWorkflowList,
  handleWorkflowGet,
  handleWorkflowSave,
  handleWorkflowRemove,
  handleWorkflowRun,
} from "../../src/gateways/ws/action-protocol.js";
import { _deps as wfDeps } from "../../src/lib/cowork-workflow.js";

function makeServer() {
  const sent = [];
  return {
    projectRoot: "/proj",
    _send: (_ws, msg) => sent.push(msg),
    _sent: sent,
  };
}

function installFakeFs() {
  const files = new Map();
  const dirs = new Set();
  const norm = (p) => p.replace(/\\/g, "/");
  wfDeps.existsSync = vi.fn((p) => {
    const n = norm(p);
    return files.has(n) || dirs.has(n);
  });
  wfDeps.readFileSync = vi.fn((p) => {
    const n = norm(p);
    if (!files.has(n)) throw new Error(`ENOENT: ${p}`);
    return files.get(n);
  });
  wfDeps.writeFileSync = vi.fn((p, content) => files.set(norm(p), content));
  wfDeps.mkdirSync = vi.fn((p) => dirs.add(norm(p)));
  wfDeps.appendFileSync = vi.fn(() => {});
  wfDeps.unlinkSync = vi.fn((p) => files.delete(norm(p)));
  wfDeps.readdirSync = vi.fn((dir) => {
    const prefix = norm(dir).replace(/\/$/, "") + "/";
    return [...files.keys()]
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length))
      .filter((f) => !f.includes("/"));
  });
  wfDeps.now = () => new Date("2026-04-15T00:00:00Z").getTime();
  return files;
}

describe("workflow WS handlers (N1)", () => {
  let server;
  beforeEach(() => {
    server = makeServer();
    installFakeFs();
  });

  it("workflow-list returns [] when no workflows", async () => {
    await handleWorkflowList(server, "1", {});
    expect(server._sent).toEqual([
      { id: "1", type: "workflow:list", workflows: [] },
    ]);
  });

  it("workflow-save persists a valid workflow then list shows it", async () => {
    const workflow = {
      id: "wf1",
      name: "F",
      steps: [{ id: "s1", message: "hello" }],
    };
    await handleWorkflowSave(server, "1", {}, { workflow });
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "workflow:save",
      saved: true,
      workflowId: "wf1",
    });
    await handleWorkflowList(server, "2", {});
    const listMsg = server._sent[1];
    expect(listMsg.type).toBe("workflow:list");
    expect(listMsg.workflows.map((w) => w.id)).toContain("wf1");
  });

  it("workflow-save rejects cyclic dependsOn", async () => {
    const workflow = {
      id: "wf-cycle",
      name: "C",
      steps: [
        { id: "a", message: "a", dependsOn: ["b"] },
        { id: "b", message: "b", dependsOn: ["a"] },
      ],
    };
    await handleWorkflowSave(server, "1", {}, { workflow });
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "error",
      code: "WORKFLOW_INVALID",
    });
  });

  it("workflow-save rejects missing workflow object", async () => {
    await handleWorkflowSave(server, "1", {}, {});
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "error",
      code: "INVALID_WORKFLOW",
    });
  });

  it("workflow-save overwrites by id", async () => {
    const wf1 = { id: "wf1", name: "F", steps: [{ id: "s1", message: "v1" }] };
    const wf2 = { id: "wf1", name: "F", steps: [{ id: "s1", message: "v2" }] };
    await handleWorkflowSave(server, "1", {}, { workflow: wf1 });
    await handleWorkflowSave(server, "2", {}, { workflow: wf2 });
    await handleWorkflowGet(server, "3", {}, { id: "wf1" });
    const getMsg = server._sent.find((m) => m.type === "workflow:get");
    expect(getMsg.workflow.steps[0].message).toBe("v2");
  });

  it("workflow-get returns null for unknown id", async () => {
    await handleWorkflowGet(server, "1", {}, { id: "nope" });
    expect(server._sent[0]).toEqual({
      id: "1",
      type: "workflow:get",
      workflow: null,
    });
  });

  it("workflow-get errors when id missing", async () => {
    await handleWorkflowGet(server, "1", {}, {});
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "error",
      code: "MISSING_ID",
    });
  });

  it("workflow-remove returns removed=true then false", async () => {
    const workflow = {
      id: "wf1",
      name: "F",
      steps: [{ id: "s1", message: "x" }],
    };
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRemove(server, "2", {}, { id: "wf1" });
    const first = server._sent.find((m) => m.type === "workflow:remove");
    expect(first.removed).toBe(true);
    await handleWorkflowRemove(server, "3", {}, { id: "wf1" });
    const second = server._sent.filter((m) => m.type === "workflow:remove")[1];
    expect(second.removed).toBe(false);
  });

  it("workflow-run emits started, step events, and done", async () => {
    wfDeps.runTask = vi.fn(async ({ userMessage }) => ({
      taskId: "t1",
      status: "completed",
      result: { summary: `ran ${userMessage}` },
    }));
    const workflow = {
      id: "wf-run",
      name: "R",
      steps: [{ id: "s1", message: "hello" }],
    };
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(server, "2", {}, { id: "wf-run" });

    const types = server._sent.map((m) => m.type);
    expect(types).toContain("workflow:started");
    expect(types).toContain("workflow:step-start");
    expect(types).toContain("workflow:step-complete");
    expect(types).toContain("workflow:done");
    const done = server._sent.find((m) => m.type === "workflow:done");
    expect(done.status).toBe("completed");
  });

  it("workflow-run errors when workflow not found", async () => {
    await handleWorkflowRun(server, "1", {}, { id: "ghost" });
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "error",
      code: "WORKFLOW_NOT_FOUND",
    });
  });
});
