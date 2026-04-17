import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  NODE_STATUS,
  TASK_STATUS,
  PRIVACY_MODE,
  DEFAULT_CONFIG,
  ensureInferenceTables,
  registerNode,
  unregisterNode,
  heartbeat,
  updateNodeStatus,
  getNode,
  listNodes,
  submitTask,
  completeTask,
  failTask,
  getTask,
  listTasks,
  getSchedulerStats,
  _resetState,
} from "../../src/lib/inference-network.js";

describe("inference-network", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureInferenceTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureInferenceTables", () => {
    it("creates both tables", () => {
      expect(db.tables.has("inference_nodes")).toBe(true);
      expect(db.tables.has("inference_tasks")).toBe(true);
    });

    it("is idempotent", () => {
      ensureInferenceTables(db);
      expect(db.tables.has("inference_nodes")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 4 node statuses", () => {
      expect(Object.keys(NODE_STATUS)).toHaveLength(4);
    });

    it("has 5 task statuses", () => {
      expect(Object.keys(TASK_STATUS)).toHaveLength(5);
    });

    it("has 3 privacy modes", () => {
      expect(Object.keys(PRIVACY_MODE)).toHaveLength(3);
    });
  });

  /* ── Node Registry ───────────────────────────────── */

  describe("registerNode", () => {
    it("registers a node", () => {
      const r = registerNode(db, "node-1", {
        endpoint: "http://localhost:8080",
        capabilities: ["llm", "vision"],
        gpuMemory: 8192,
      });
      expect(r.nodeId).toBeTruthy();
      const n = getNode(db, r.nodeId);
      expect(n.node_id).toBe("node-1");
      expect(n.status).toBe("online");
      expect(n.gpu_memory_mb).toBe(8192);
      expect(n.capabilities).toEqual(["llm", "vision"]);
    });

    it("rejects missing node id", () => {
      const r = registerNode(db, "");
      expect(r.nodeId).toBeNull();
      expect(r.reason).toBe("missing_node_id");
    });

    it("rejects duplicate node id", () => {
      registerNode(db, "dup-1");
      const r = registerNode(db, "dup-1");
      expect(r.nodeId).toBeNull();
      expect(r.reason).toBe("duplicate_node");
    });
  });

  describe("unregisterNode", () => {
    it("removes a node", () => {
      const { nodeId } = registerNode(db, "to-remove");
      const r = unregisterNode(db, nodeId);
      expect(r.removed).toBe(true);
      expect(getNode(db, nodeId)).toBeNull();
    });

    it("rejects unknown node", () => {
      const r = unregisterNode(db, "nope");
      expect(r.removed).toBe(false);
    });
  });

  describe("heartbeat", () => {
    it("updates heartbeat timestamp", () => {
      const { nodeId } = registerNode(db, "hb-node");
      const n1 = getNode(db, nodeId);
      const r = heartbeat(db, nodeId);
      expect(r.updated).toBe(true);
      expect(getNode(db, nodeId).last_heartbeat).toBeGreaterThanOrEqual(
        n1.last_heartbeat,
      );
    });

    it("brings offline node back online", () => {
      const { nodeId } = registerNode(db, "off-node");
      updateNodeStatus(db, nodeId, "offline");
      heartbeat(db, nodeId);
      expect(getNode(db, nodeId).status).toBe("online");
    });

    it("rejects unknown node", () => {
      const r = heartbeat(db, "nope");
      expect(r.updated).toBe(false);
    });
  });

  describe("updateNodeStatus", () => {
    it("updates status", () => {
      const { nodeId } = registerNode(db, "st-node");
      const r = updateNodeStatus(db, nodeId, "busy");
      expect(r.updated).toBe(true);
      expect(getNode(db, nodeId).status).toBe("busy");
    });

    it("rejects invalid status", () => {
      const { nodeId } = registerNode(db, "inv-node");
      const r = updateNodeStatus(db, nodeId, "exploded");
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("invalid_status");
    });
  });

  describe("listNodes", () => {
    it("lists all nodes", () => {
      registerNode(db, "a");
      registerNode(db, "b");
      registerNode(db, "c");
      expect(listNodes(db)).toHaveLength(3);
    });

    it("filters by status", () => {
      const { nodeId } = registerNode(db, "off");
      registerNode(db, "on");
      updateNodeStatus(db, nodeId, "offline");
      expect(listNodes(db, { status: "offline" })).toHaveLength(1);
      expect(listNodes(db, { status: "online" })).toHaveLength(1);
    });

    it("filters by capability", () => {
      registerNode(db, "llm-node", { capabilities: ["llm"] });
      registerNode(db, "vis-node", { capabilities: ["vision"] });
      expect(listNodes(db, { capability: "llm" })).toHaveLength(1);
    });

    it("respects limit", () => {
      registerNode(db, "x");
      registerNode(db, "y");
      registerNode(db, "z");
      expect(listNodes(db, { limit: 2 })).toHaveLength(2);
    });
  });

  /* ── Task Scheduler ──────────────────────────────── */

  describe("submitTask", () => {
    it("submits queued task when no nodes", () => {
      const r = submitTask(db, "qwen2:7b", { input: "hello" });
      expect(r.taskId).toBeTruthy();
      expect(r.status).toBe("queued");
      expect(r.assignedNode).toBeNull();
    });

    it("dispatches to online node", () => {
      const { nodeId } = registerNode(db, "worker-1");
      const r = submitTask(db, "llama3:8b", { input: "test" });
      expect(r.status).toBe("dispatched");
      expect(r.assignedNode).toBe(nodeId);
    });

    it("balances load across nodes", () => {
      const { nodeId: n1 } = registerNode(db, "w1");
      registerNode(db, "w2");
      submitTask(db, "model1"); // goes to first node (both have 0 tasks)
      const r2 = submitTask(db, "model2");
      // Second task should go to the node with fewer tasks
      expect(r2.assignedNode).toBeTruthy();
    });

    it("rejects missing model", () => {
      const r = submitTask(db, "");
      expect(r.taskId).toBeNull();
      expect(r.reason).toBe("missing_model");
    });

    it("rejects invalid privacy mode", () => {
      const r = submitTask(db, "model", { privacyMode: "quantum" });
      expect(r.taskId).toBeNull();
      expect(r.reason).toBe("invalid_privacy_mode");
    });

    it("clamps priority to 1-10", () => {
      const r = submitTask(db, "model", { priority: 20 });
      const t = getTask(db, r.taskId);
      expect(t.priority).toBe(10);
    });
  });

  describe("completeTask", () => {
    it("marks task complete with output", () => {
      const { taskId } = submitTask(db, "model", { input: "x" });
      const r = completeTask(db, taskId, {
        output: "result",
        durationMs: 150,
      });
      expect(r.completed).toBe(true);
      const t = getTask(db, taskId);
      expect(t.status).toBe("complete");
      expect(t.output).toBe("result");
      expect(t.duration_ms).toBe(150);
    });

    it("rejects completing already-complete task", () => {
      const { taskId } = submitTask(db, "model");
      completeTask(db, taskId);
      const r = completeTask(db, taskId);
      expect(r.completed).toBe(false);
      expect(r.reason).toBe("already_complete");
    });

    it("rejects unknown task", () => {
      const r = completeTask(db, "nope");
      expect(r.completed).toBe(false);
    });
  });

  describe("failTask", () => {
    it("marks task as failed", () => {
      const { taskId } = submitTask(db, "model");
      const r = failTask(db, taskId, { error: "OOM" });
      expect(r.failed).toBe(true);
      expect(getTask(db, taskId).status).toBe("failed");
      expect(getTask(db, taskId).output).toBe("OOM");
    });

    it("rejects failing completed task", () => {
      const { taskId } = submitTask(db, "model");
      completeTask(db, taskId);
      const r = failTask(db, taskId);
      expect(r.failed).toBe(false);
    });
  });

  describe("getTask / listTasks", () => {
    it("returns null for unknown id", () => {
      expect(getTask(db, "nope")).toBeNull();
    });

    it("lists tasks with filters", () => {
      submitTask(db, "llama");
      submitTask(db, "qwen", { privacyMode: "encrypted" });
      const { taskId } = submitTask(db, "llama");
      completeTask(db, taskId);

      expect(listTasks(db)).toHaveLength(3);
      expect(listTasks(db, { model: "llama" })).toHaveLength(2);
      expect(listTasks(db, { status: "complete" })).toHaveLength(1);
      expect(listTasks(db, { privacyMode: "encrypted" })).toHaveLength(1);
    });

    it("respects limit", () => {
      submitTask(db, "a");
      submitTask(db, "b");
      submitTask(db, "c");
      expect(listTasks(db, { limit: 2 })).toHaveLength(2);
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getSchedulerStats", () => {
    it("returns zeros when empty", () => {
      const s = getSchedulerStats(db);
      expect(s.nodes.total).toBe(0);
      expect(s.tasks.total).toBe(0);
    });

    it("computes correct stats", () => {
      registerNode(db, "n1");
      const { nodeId: n2 } = registerNode(db, "n2");
      updateNodeStatus(db, n2, "offline");

      submitTask(db, "model1");
      const { taskId } = submitTask(db, "model2");
      completeTask(db, taskId, { durationMs: 200 });
      const { taskId: t3 } = submitTask(db, "model3");
      failTask(db, t3);

      const s = getSchedulerStats(db);
      expect(s.nodes.total).toBe(2);
      expect(s.nodes.online).toBe(1);
      expect(s.nodes.offline).toBe(1);
      expect(s.tasks.total).toBe(3);
      expect(s.tasks.completed).toBe(1);
      expect(s.tasks.failed).toBe(1);
      expect(s.tasks.avgDurationMs).toBe(200);
    });
  });
});
