import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import mod from "../skill-workflow-engine.js";
const { SkillWorkflowEngine, NodeType } = mod;

describe("SkillWorkflowEngine", () => {
  let engine;
  beforeEach(() => {
    engine = new SkillWorkflowEngine();
  });

  describe("createWorkflow", () => {
    it("creates a workflow with start/end defaults and returns an id", () => {
      const id = engine.createWorkflow({ name: "W1" });
      const wf = engine.getWorkflow(id);
      expect(wf.name).toBe("W1");
      expect(wf.nodes.map((n) => n.type)).toEqual([
        NodeType.START_NODE,
        NodeType.END_NODE,
      ]);
      expect(wf.edges).toEqual([]);
      expect(wf.executionCount).toBe(0);
    });

    it("honors an explicit id and provided nodes/edges", () => {
      const id = engine.createWorkflow({
        id: "fixed",
        nodes: [{ id: "n1", type: NodeType.SKILL_NODE }],
        edges: [{ id: "e1", source: "n1", target: "n1" }],
      });
      expect(id).toBe("fixed");
      expect(engine.getWorkflow("fixed").nodes).toHaveLength(1);
    });

    it("emits workflow:created", () => {
      const spy = vi.fn();
      engine.on("workflow:created", spy);
      engine.createWorkflow({ name: "Evented" });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Evented" }),
      );
    });
  });

  describe("node CRUD", () => {
    let id;
    beforeEach(() => {
      id = engine.createWorkflow({ name: "W" });
    });

    it("adds a node and returns its id", () => {
      const nodeId = engine.addNode(id, { type: NodeType.SKILL_NODE, data: { x: 1 } });
      const wf = engine.getWorkflow(id);
      expect(wf.nodes.find((n) => n.id === nodeId)).toMatchObject({
        type: NodeType.SKILL_NODE,
        data: { x: 1 },
      });
    });

    it("updateNodeData merges into existing data", () => {
      const nodeId = engine.addNode(id, { data: { a: 1 } });
      engine.updateNodeData(id, nodeId, { b: 2 });
      const node = engine.getWorkflow(id).nodes.find((n) => n.id === nodeId);
      expect(node.data).toEqual({ a: 1, b: 2 });
    });

    it("removeNode also drops its connected edges", () => {
      const n1 = engine.addNode(id, {});
      const n2 = engine.addNode(id, {});
      engine.addConnection(id, { source: n1, target: n2 });
      engine.removeNode(id, n1);
      const wf = engine.getWorkflow(id);
      expect(wf.nodes.find((n) => n.id === n1)).toBeUndefined();
      expect(wf.edges).toHaveLength(0); // edge touching n1 removed
    });

    it("throws for an unknown workflow or node", () => {
      expect(() => engine.addNode("nope", {})).toThrow(/Workflow not found/);
      expect(() => engine.updateNodeData(id, "ghost", {})).toThrow(/Node not found/);
    });
  });

  describe("connection CRUD", () => {
    let id;
    beforeEach(() => {
      id = engine.createWorkflow({ name: "W" });
    });

    it("adds and removes a connection", () => {
      const eid = engine.addConnection(id, { source: "a", target: "b", label: "go" });
      expect(engine.getWorkflow(id).edges.find((e) => e.id === eid)).toMatchObject({
        source: "a",
        target: "b",
        label: "go",
      });
      engine.removeConnection(id, eid);
      expect(engine.getWorkflow(id).edges).toHaveLength(0);
    });
  });

  describe("listWorkflows / deleteWorkflow", () => {
    it("lists and deletes", () => {
      const a = engine.createWorkflow({ name: "A" });
      engine.createWorkflow({ name: "B" });
      expect(engine.listWorkflows()).toHaveLength(2);
      engine.deleteWorkflow(a);
      expect(engine.listWorkflows()).toHaveLength(1);
      expect(engine.getWorkflow(a)).toBeNull(); // getWorkflow returns null, not undefined
    });

    it("deleteWorkflow throws for an unknown id", () => {
      expect(() => engine.deleteWorkflow("nope")).toThrow(/Workflow not found/);
    });
  });

  describe("_topologicalSort", () => {
    const sort = (nodes, edges) =>
      engine._topologicalSort(nodes, edges).map((n) => n.id);

    it("orders a linear chain", () => {
      expect(
        sort(
          [{ id: "a" }, { id: "b" }, { id: "c" }],
          [
            { source: "a", target: "b" },
            { source: "b", target: "c" },
          ],
        ),
      ).toEqual(["a", "b", "c"]);
    });

    it("respects a diamond (root first, join last)", () => {
      const r = sort(
        [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        [
          { source: "a", target: "b" },
          { source: "a", target: "c" },
          { source: "b", target: "d" },
          { source: "c", target: "d" },
        ],
      );
      expect(r[0]).toBe("a");
      expect(r[r.length - 1]).toBe("d");
      expect(r).toHaveLength(4);
    });

    it("keeps isolated (edgeless) nodes", () => {
      expect(sort([{ id: "x" }, { id: "y" }], [])).toEqual(["x", "y"]);
    });

    it("ignores edges to a missing node", () => {
      expect(sort([{ id: "a" }], [{ source: "a", target: "ghost" }])).toEqual(["a"]);
    });

    it("returns [] for a fully cyclic graph (documents silent cycle behavior)", () => {
      // Kahn's algorithm cannot drain a cycle, so cycle nodes are silently
      // dropped — a cyclic workflow yields an EMPTY order rather than an error.
      // Flagged: callers get no signal that nodes were lost to a cycle.
      expect(
        sort(
          [{ id: "a" }, { id: "b" }],
          [
            { source: "a", target: "b" },
            { source: "b", target: "a" },
          ],
        ),
      ).toEqual([]);
    });

    it("emits the acyclic prefix but drops a downstream cycle's nodes", () => {
      // a -> b, b <-> c (cycle). Only the acyclic root `a` survives.
      const r = sort(
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        [
          { source: "a", target: "b" },
          { source: "b", target: "c" },
          { source: "c", target: "b" },
        ],
      );
      expect(r).toContain("a");
      expect(r).not.toContain("c"); // cycle members lost
    });
  });

  describe("_nodeTypeToPipelineType", () => {
    it("maps known node types and defaults unknown to skill", () => {
      expect(engine._nodeTypeToPipelineType(NodeType.CONDITION_NODE)).toBe("condition");
      expect(engine._nodeTypeToPipelineType(NodeType.PARALLEL_NODE)).toBe("parallel");
      expect(engine._nodeTypeToPipelineType(NodeType.TRANSFORM_NODE)).toBe("transform");
      expect(engine._nodeTypeToPipelineType("???")).toBe("skill");
    });
  });

  describe("executeWorkflow guards", () => {
    it("throws without a pipeline engine", async () => {
      const id = engine.createWorkflow({ name: "W" });
      await expect(engine.executeWorkflow(id)).rejects.toThrow(
        /PipelineEngine not available/,
      );
    });
    it("throws for an unknown workflow", async () => {
      await expect(engine.executeWorkflow("nope")).rejects.toThrow(
        /Workflow not found/,
      );
    });
  });
});
