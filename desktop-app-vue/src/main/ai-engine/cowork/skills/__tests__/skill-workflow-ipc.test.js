import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { registerSkillWorkflowIPC } from "../skill-workflow-ipc.js";
import engineMod from "../skill-workflow-engine.js";
const { SkillWorkflowEngine, NodeType } = engineMod;

// Inject a fake ipcMain (the repo's proven IPC-test pattern) instead of
// fighting the electron module alias.
let handlers;
const makeIpcMain = () => {
  handlers = new Map();
  return { handle: (channel, fn) => handlers.set(channel, fn) };
};
const fakeBrowserWindow = { getAllWindows: () => [] };

const register = (opts = {}) =>
  registerSkillWorkflowIPC({
    ipcMain: makeIpcMain(),
    BrowserWindow: fakeBrowserWindow,
    ...opts,
  });

const invoke = (channel, ...args) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`handler not registered: ${channel}`);
  return fn({}, ...args);
};

describe("skill-workflow-ipc", () => {
  it("registers all 12 handlers", () => {
    register({ workflowEngine: new SkillWorkflowEngine() });
    expect(handlers.size).toBe(12);
  });

  describe("without an engine", () => {
    beforeEach(() => register({ workflowEngine: null }));

    it.each([
      ["skill-workflow:create", {}],
      ["skill-workflow:update", { workflowId: "x", updates: {} }],
      ["skill-workflow:execute", { workflowId: "x", context: {} }],
      ["skill-workflow:get", "x"],
      ["skill-workflow:list", undefined],
      ["skill-workflow:delete", "x"],
      ["skill-workflow:save", { workflowId: "x", updates: {} }],
      ["skill-workflow:import-pipeline", "x"],
      ["skill-workflow:export-pipeline", "x"],
    ])("%s returns not-initialized", async (channel, arg) => {
      const res = await invoke(channel, arg);
      expect(res).toEqual({
        success: false,
        error: "WorkflowEngine not initialized",
      });
    });
  });

  describe("with a real engine", () => {
    let engine;
    beforeEach(() => {
      engine = new SkillWorkflowEngine();
      register({ workflowEngine: engine });
    });

    it("create returns an id that exists in the engine", async () => {
      const res = await invoke("skill-workflow:create", { name: "W" });
      expect(res.success).toBe(true);
      expect(engine.getWorkflow(res.data.id)).not.toBeNull();
    });

    it("get returns the workflow, or a not-found envelope", async () => {
      const { data } = await invoke("skill-workflow:create", { name: "W" });
      const ok = await invoke("skill-workflow:get", data.id);
      expect(ok).toMatchObject({ success: true, data: { name: "W" } });
      const miss = await invoke("skill-workflow:get", "nope");
      expect(miss).toEqual({ success: false, error: "Workflow not found" });
    });

    it("list returns workflows with a count", async () => {
      await invoke("skill-workflow:create", { name: "A" });
      await invoke("skill-workflow:create", { name: "B" });
      const res = await invoke("skill-workflow:list");
      expect(res.success).toBe(true);
      expect(res.count).toBe(2);
      expect(res.data).toHaveLength(2);
    });

    it("delete of a missing workflow surfaces the engine error", async () => {
      const res = await invoke("skill-workflow:delete", "nope");
      expect(res).toMatchObject({ success: false });
      expect(res.error).toMatch(/Workflow not found/);
    });

    it("save updates a workflow, missing id surfaces an error", async () => {
      const { data } = await invoke("skill-workflow:create", { name: "old" });
      const ok = await invoke("skill-workflow:save", {
        workflowId: data.id,
        updates: { name: "new" },
      });
      expect(ok).toEqual({ success: true });
      expect(engine.getWorkflow(data.id).name).toBe("new");
      const miss = await invoke("skill-workflow:save", {
        workflowId: "nope",
        updates: {},
      });
      expect(miss).toMatchObject({ success: false });
    });

    it("execute of a missing workflow surfaces an error", async () => {
      const res = await invoke("skill-workflow:execute", {
        workflowId: "nope",
        context: {},
      });
      expect(res).toMatchObject({ success: false });
      expect(res.error).toMatch(/Workflow not found/);
    });

    it("export-pipeline of a cyclic workflow returns { success:false } (cycle guard)", async () => {
      const { data } = await invoke("skill-workflow:create", {
        name: "Cyclic",
        nodes: [],
        edges: [],
      });
      engine.addNode(data.id, { id: "p", type: NodeType.SKILL_NODE });
      engine.addNode(data.id, { id: "q", type: NodeType.SKILL_NODE });
      engine.addConnection(data.id, { source: "p", target: "q" });
      engine.addConnection(data.id, { source: "q", target: "p" });
      const res = await invoke("skill-workflow:export-pipeline", data.id);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/contains a cycle/);
    });
  });

  describe("get-templates", () => {
    beforeEach(() =>
      register({ workflowEngine: new SkillWorkflowEngine() }),
    );
    it("returns templates flagged as workflow templates", async () => {
      const res = await invoke("skill-workflow:get-templates");
      expect(res.success).toBe(true);
      expect(Array.isArray(res.data)).toBe(true);
      if (res.data.length) {
        expect(res.data[0].isWorkflowTemplate).toBe(true);
      }
    });
  });

  describe("orchestrate templates (real handler)", () => {
    beforeEach(() => register({ workflowEngine: new SkillWorkflowEngine() }));

    it("import-orchestrate builds a linear start->agents->end graph", async () => {
      const res = await invoke("skill-workflow:import-orchestrate", {
        templateName: "feature",
      });
      expect(res.success).toBe(true);
      const { nodes, edges, name } = res.data;
      expect(nodes[0].type).toBe("start");
      expect(nodes[nodes.length - 1].type).toBe("end");
      expect(nodes.length).toBeGreaterThanOrEqual(3); // start + >=1 agent + end
      // A linear chain has exactly one fewer edge than node.
      expect(edges).toHaveLength(nodes.length - 1);
      expect(name).toMatch(/^\[Orchestrate\] /);
    });

    it("import-orchestrate rejects an unknown template", async () => {
      const res = await invoke("skill-workflow:import-orchestrate", {
        templateName: "definitely-not-a-template",
      });
      expect(res).toMatchObject({ success: false });
      expect(res.error).toMatch(/Unknown orchestrate template/);
    });

    it("get-orchestrate-templates lists known templates with agent counts", async () => {
      const res = await invoke("skill-workflow:get-orchestrate-templates");
      expect(res.success).toBe(true);
      expect(res.data.length).toBeGreaterThan(0);
      const feature = res.data.find((t) => t.name === "feature");
      expect(feature).toBeDefined();
      expect(typeof feature.label).toBe("string");
      expect(feature.agentCount).toBeGreaterThan(0);
    });
  });
});
