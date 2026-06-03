import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  NODE_STATUS,
  TASK_STATUS,
  PRIVACY_MODE,
  DEFAULT_CONFIG,
  NODE_STATUS_V2,
  TASK_STATUS_V2,
  PRIVACY_MODE_V2,
  INFERENCE_DEFAULT_MAX_CONCURRENT_TASKS_PER_NODE,
  INFERENCE_DEFAULT_HEARTBEAT_TIMEOUT_MS,
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
  setMaxConcurrentTasksPerNode,
  getMaxConcurrentTasksPerNode,
  setHeartbeatTimeoutMs,
  getHeartbeatTimeoutMs,
  getActiveTasksPerNode,
  submitTaskV2,
  dispatchTaskV2,
  startTask,
  completeTaskV2,
  failTaskV2,
  setTaskStatus,
  autoMarkOfflineNodes,
  findEligibleNodes,
  getInferenceStatsV2,
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

  /* ─────────────────────────────────────────────────────────
   *  V2 surface — Phase 67
   * ───────────────────────────────────────────────────────── */

  describe("V2 frozen enums", () => {
    it("NODE_STATUS_V2 has 4 states", () => {
      expect(Object.keys(NODE_STATUS_V2)).toHaveLength(4);
      expect(Object.isFrozen(NODE_STATUS_V2)).toBe(true);
    });

    it("TASK_STATUS_V2 has 5 states", () => {
      expect(Object.keys(TASK_STATUS_V2)).toHaveLength(5);
      expect(Object.isFrozen(TASK_STATUS_V2)).toBe(true);
    });

    it("PRIVACY_MODE_V2 has 3 modes", () => {
      expect(Object.keys(PRIVACY_MODE_V2)).toHaveLength(3);
      expect(Object.isFrozen(PRIVACY_MODE_V2)).toBe(true);
    });

    it("DEFAULT_MAX_CONCURRENT_TASKS_PER_NODE = 4", () => {
      expect(INFERENCE_DEFAULT_MAX_CONCURRENT_TASKS_PER_NODE).toBe(4);
    });

    it("DEFAULT_HEARTBEAT_TIMEOUT_MS = 90000", () => {
      expect(INFERENCE_DEFAULT_HEARTBEAT_TIMEOUT_MS).toBe(90000);
    });
  });

  describe("setMaxConcurrentTasksPerNode validation", () => {
    it("defaults to 4", () => {
      expect(getMaxConcurrentTasksPerNode()).toBe(4);
    });

    it("sets positive integer", () => {
      setMaxConcurrentTasksPerNode(8);
      expect(getMaxConcurrentTasksPerNode()).toBe(8);
    });

    it("floors non-integer", () => {
      setMaxConcurrentTasksPerNode(5.7);
      expect(getMaxConcurrentTasksPerNode()).toBe(5);
    });

    it("rejects ≤0, NaN, non-number", () => {
      expect(() => setMaxConcurrentTasksPerNode(0)).toThrow();
      expect(() => setMaxConcurrentTasksPerNode(-1)).toThrow();
      expect(() => setMaxConcurrentTasksPerNode(NaN)).toThrow();
      expect(() => setMaxConcurrentTasksPerNode("3")).toThrow();
    });

    it("_resetState restores default", () => {
      setMaxConcurrentTasksPerNode(7);
      _resetState();
      expect(getMaxConcurrentTasksPerNode()).toBe(4);
    });
  });

  describe("setHeartbeatTimeoutMs validation", () => {
    it("defaults to 90000", () => {
      expect(getHeartbeatTimeoutMs()).toBe(90000);
    });

    it("sets and floors", () => {
      setHeartbeatTimeoutMs(30000.5);
      expect(getHeartbeatTimeoutMs()).toBe(30000);
    });

    it("rejects ≤0, NaN, non-number", () => {
      expect(() => setHeartbeatTimeoutMs(0)).toThrow();
      expect(() => setHeartbeatTimeoutMs(NaN)).toThrow();
      expect(() => setHeartbeatTimeoutMs("30000")).toThrow();
    });

    it("_resetState restores default", () => {
      setHeartbeatTimeoutMs(10000);
      _resetState();
      expect(getHeartbeatTimeoutMs()).toBe(90000);
    });
  });

  describe("getActiveTasksPerNode", () => {
    it("returns 0 for unknown or empty node", () => {
      expect(getActiveTasksPerNode("nope")).toBe(0);
      expect(getActiveTasksPerNode("")).toBe(0);
    });

    it("counts DISPATCHED + RUNNING only", () => {
      const { nodeId } = registerNode(db, "n1");
      const t1 = submitTaskV2(db, { model: "m1" });
      const t2 = submitTaskV2(db, { model: "m2" });
      const t3 = submitTaskV2(db, { model: "m3" });
      dispatchTaskV2(db, t1.id, { nodeId });
      dispatchTaskV2(db, t2.id, { nodeId });
      startTask(db, t2.id);
      // t3 still queued
      expect(getActiveTasksPerNode(nodeId)).toBe(2);
      completeTaskV2(db, t2.id, { output: "ok" });
      expect(getActiveTasksPerNode(nodeId)).toBe(1);
    });

    it("scopes by node — sibling node unaffected", () => {
      const { nodeId: a } = registerNode(db, "na");
      const { nodeId: b } = registerNode(db, "nb");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId: a });
      expect(getActiveTasksPerNode(a)).toBe(1);
      expect(getActiveTasksPerNode(b)).toBe(0);
    });
  });

  describe("submitTaskV2", () => {
    it("creates queued task with no assignment", () => {
      const t = submitTaskV2(db, { model: "llama", input: "hi" });
      expect(t.status).toBe("queued");
      expect(t.assigned_node).toBeNull();
      expect(t.model).toBe("llama");
    });

    it("rejects missing model", () => {
      expect(() => submitTaskV2(db, {})).toThrow(/model is required/);
    });

    it("rejects invalid privacy mode", () => {
      expect(() =>
        submitTaskV2(db, { model: "m", privacyMode: "quantum" }),
      ).toThrow(/Invalid privacy mode/);
    });

    it("clamps priority", () => {
      const t = submitTaskV2(db, { model: "m", priority: 99 });
      expect(t.priority).toBe(10);
    });
  });

  describe("dispatchTaskV2 + concurrency cap", () => {
    it("assigns to least-loaded online node when nodeId omitted", () => {
      const { nodeId: a } = registerNode(db, "na");
      const { nodeId: b } = registerNode(db, "nb");
      const t1 = submitTaskV2(db, { model: "m" });
      const t2 = submitTaskV2(db, { model: "m" });
      const r1 = dispatchTaskV2(db, t1.id);
      const r2 = dispatchTaskV2(db, t2.id);
      expect([a, b]).toContain(r1.assigned_node);
      expect([a, b]).toContain(r2.assigned_node);
      expect(r1.assigned_node).not.toBe(r2.assigned_node);
    });

    it("rejects dispatching to non-online node", () => {
      const { nodeId } = registerNode(db, "n1");
      updateNodeStatus(db, nodeId, "offline");
      const t = submitTaskV2(db, { model: "m" });
      expect(() => dispatchTaskV2(db, t.id, { nodeId })).toThrow(/not online/);
    });

    it("rejects when no eligible nodes", () => {
      const t = submitTaskV2(db, { model: "m" });
      expect(() => dispatchTaskV2(db, t.id)).toThrow(/No eligible/);
    });

    it("enforces per-node concurrency cap", () => {
      setMaxConcurrentTasksPerNode(2);
      const { nodeId } = registerNode(db, "n1");
      const t1 = submitTaskV2(db, { model: "m" });
      const t2 = submitTaskV2(db, { model: "m" });
      const t3 = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t1.id, { nodeId });
      dispatchTaskV2(db, t2.id, { nodeId });
      expect(() => dispatchTaskV2(db, t3.id, { nodeId })).toThrow(
        /Max concurrent tasks/,
      );
    });

    it("cap is released after task reaches terminal", () => {
      setMaxConcurrentTasksPerNode(1);
      const { nodeId } = registerNode(db, "n1");
      const t1 = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t1.id, { nodeId });
      startTask(db, t1.id);
      completeTaskV2(db, t1.id, { output: "ok" });
      const t2 = submitTaskV2(db, { model: "m" });
      expect(() => dispatchTaskV2(db, t2.id, { nodeId })).not.toThrow();
    });

    it("rejects dispatching non-queued task", () => {
      const { nodeId } = registerNode(db, "n1");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      expect(() => dispatchTaskV2(db, t.id, { nodeId })).toThrow(
        /Invalid transition/,
      );
    });
  });

  describe("startTask + completeTaskV2 + state machine", () => {
    it("full lifecycle queued → dispatched → running → complete", () => {
      const { nodeId } = registerNode(db, "n1");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      const r = startTask(db, t.id);
      expect(r.status).toBe("running");
      expect(r.started_at).toBeGreaterThan(0);
      const done = completeTaskV2(db, t.id, {
        output: "result",
        durationMs: 250,
      });
      expect(done.status).toBe("complete");
      expect(done.output).toBe("result");
      expect(done.duration_ms).toBe(250);
    });

    it("startTask rejects non-dispatched", () => {
      const t = submitTaskV2(db, { model: "m" });
      expect(() => startTask(db, t.id)).toThrow(/Invalid transition/);
    });

    it("completeTaskV2 rejects skipping running", () => {
      const { nodeId } = registerNode(db, "n1");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      expect(() => completeTaskV2(db, t.id, {})).toThrow(/Invalid transition/);
    });

    it("completeTaskV2 infers durationMs from started_at", () => {
      const { nodeId } = registerNode(db, "n1");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      startTask(db, t.id);
      const done = completeTaskV2(db, t.id, { output: "x" });
      expect(done.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("failTaskV2", () => {
    it("fails from queued", () => {
      const t = submitTaskV2(db, { model: "m" });
      const r = failTaskV2(db, t.id, { error: "bad input" });
      expect(r.status).toBe("failed");
      expect(r.error_message).toBe("bad input");
    });

    it("fails from dispatched / running", () => {
      const { nodeId } = registerNode(db, "n1");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      startTask(db, t.id);
      const r = failTaskV2(db, t.id, { error: "OOM" });
      expect(r.status).toBe("failed");
    });

    it("rejects failing terminal task", () => {
      const { nodeId } = registerNode(db, "n1");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      startTask(db, t.id);
      completeTaskV2(db, t.id, { output: "ok" });
      expect(() => failTaskV2(db, t.id, { error: "late" })).toThrow(
        /Invalid transition/,
      );
    });
  });

  describe("setTaskStatus generic setter", () => {
    it("rejects unknown status", () => {
      const t = submitTaskV2(db, { model: "m" });
      expect(() => setTaskStatus(db, t.id, "exploded", {})).toThrow(
        /Unknown status/,
      );
    });

    it("rejects unknown id", () => {
      expect(() => setTaskStatus(db, "nope", "failed", {})).toThrow(
        /Unknown task/,
      );
    });

    it("rejects invalid transition", () => {
      const t = submitTaskV2(db, { model: "m" });
      expect(() => setTaskStatus(db, t.id, "complete", {})).toThrow(
        /Invalid transition/,
      );
    });

    it("applies patch on terminal transition", () => {
      const { nodeId } = registerNode(db, "n1");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      startTask(db, t.id);
      const r = setTaskStatus(db, t.id, "complete", {
        output: "patched",
        durationMs: 777,
      });
      expect(r.output).toBe("patched");
      expect(r.duration_ms).toBe(777);
      expect(r.completed_at).toBeGreaterThan(0);
    });
  });

  describe("autoMarkOfflineNodes", () => {
    it("flips stale nodes to offline", async () => {
      setHeartbeatTimeoutMs(1);
      const { nodeId } = registerNode(db, "stale");
      await new Promise((r) => setTimeout(r, 20));
      const offlined = autoMarkOfflineNodes(db);
      expect(offlined).toHaveLength(1);
      expect(getNode(db, nodeId).status).toBe("offline");
    });

    it("skips already-offline nodes", () => {
      const { nodeId } = registerNode(db, "off");
      updateNodeStatus(db, nodeId, "offline");
      expect(autoMarkOfflineNodes(db)).toHaveLength(0);
    });

    it("leaves fresh-heartbeat nodes alone", () => {
      setHeartbeatTimeoutMs(60000);
      registerNode(db, "fresh");
      expect(autoMarkOfflineNodes(db)).toHaveLength(0);
    });
  });

  describe("findEligibleNodes", () => {
    it("returns online nodes sorted by load", () => {
      const { nodeId: a } = registerNode(db, "na");
      const { nodeId: b } = registerNode(db, "nb");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId: a });
      const eligible = findEligibleNodes();
      expect(eligible).toHaveLength(2);
      expect(eligible[0].id).toBe(b); // zero load first
      expect(eligible[1].id).toBe(a);
    });

    it("filters by capability", () => {
      registerNode(db, "llm-node", { capabilities: ["llm"] });
      registerNode(db, "vis-node", { capabilities: ["vision"] });
      expect(findEligibleNodes({ capability: "llm" })).toHaveLength(1);
    });

    it("excludes full nodes", () => {
      setMaxConcurrentTasksPerNode(1);
      const { nodeId } = registerNode(db, "busy");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      expect(findEligibleNodes()).toHaveLength(0);
    });

    it("excludes non-online nodes", () => {
      const { nodeId } = registerNode(db, "off");
      updateNodeStatus(db, nodeId, "offline");
      expect(findEligibleNodes()).toHaveLength(0);
    });
  });

  describe("getInferenceStatsV2", () => {
    it("zero-initialises all enum keys", () => {
      const s = getInferenceStatsV2();
      expect(s.totalNodes).toBe(0);
      expect(s.totalTasks).toBe(0);
      expect(s.maxConcurrentTasksPerNode).toBe(4);
      expect(s.nodesByStatus).toEqual({
        online: 0,
        offline: 0,
        busy: 0,
        degraded: 0,
      });
      expect(s.tasksByStatus).toEqual({
        queued: 0,
        dispatched: 0,
        running: 0,
        complete: 0,
        failed: 0,
      });
      expect(s.tasksByPrivacyMode).toEqual({
        standard: 0,
        encrypted: 0,
        federated: 0,
      });
    });

    it("aggregates correctly", () => {
      const { nodeId } = registerNode(db, "n1");
      registerNode(db, "n2");
      const t1 = submitTaskV2(db, { model: "m", privacyMode: "encrypted" });
      const t2 = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t1.id, { nodeId });
      startTask(db, t1.id);
      completeTaskV2(db, t1.id, { output: "ok", durationMs: 500 });

      const s = getInferenceStatsV2();
      expect(s.totalNodes).toBe(2);
      expect(s.totalTasks).toBe(2);
      expect(s.nodesByStatus.online).toBe(2);
      expect(s.tasksByStatus.complete).toBe(1);
      expect(s.tasksByStatus.queued).toBe(1);
      expect(s.tasksByPrivacyMode.encrypted).toBe(1);
      expect(s.tasksByPrivacyMode.standard).toBe(1);
      expect(s.avgDurationMs).toBe(500);
      expect(s.loadPerNode[nodeId]).toBe(0); // completed
    });

    it("tracks load per node", () => {
      const { nodeId } = registerNode(db, "n1");
      const t = submitTaskV2(db, { model: "m" });
      dispatchTaskV2(db, t.id, { nodeId });
      const s = getInferenceStatsV2();
      expect(s.loadPerNode[nodeId]).toBe(1);
    });
  });
});
