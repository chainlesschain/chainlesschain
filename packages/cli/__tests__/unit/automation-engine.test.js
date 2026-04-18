import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  FLOW_STATUS,
  EXECUTION_STATUS,
  TRIGGER_TYPE,
  NODE_TYPE,
  CONNECTOR_CATALOG,
  FLOW_TEMPLATES,
  ensureAutomationTables,
  listConnectors,
  getConnector,
  listFlowTemplates,
  getFlowTemplate,
  createFlow,
  getFlow,
  listFlows,
  updateFlowStatus,
  deleteFlow,
  scheduleFlow,
  shareFlow,
  importTemplate,
  addTrigger,
  listTriggers,
  getTrigger,
  setTriggerEnabled,
  executeFlow,
  fireTrigger,
  getExecution,
  listExecutions,
  getStats,
  getConfig,
} from "../../src/lib/automation-engine.js";

describe("automation-engine (Phase 96)", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    ensureAutomationTables(db);
  });

  // ─── Constants & catalog ──────────────────────────────────
  describe("constants & catalog", () => {
    it("exposes 4 flow statuses", () => {
      expect(Object.values(FLOW_STATUS).sort()).toEqual(
        ["active", "archived", "draft", "paused"].sort(),
      );
    });

    it("exposes 4 execution statuses", () => {
      expect(Object.values(EXECUTION_STATUS).sort()).toEqual(
        ["cancelled", "failed", "running", "success"].sort(),
      );
    });

    it("exposes 5 trigger types", () => {
      expect(Object.values(TRIGGER_TYPE).length).toBe(5);
      expect(Object.values(TRIGGER_TYPE)).toContain("webhook");
      expect(Object.values(TRIGGER_TYPE)).toContain("manual");
    });

    it("exposes 4 node types", () => {
      expect(Object.values(NODE_TYPE).sort()).toEqual(
        ["action", "condition", "loop", "parallel"].sort(),
      );
    });

    it("ships 12 built-in connectors", () => {
      expect(CONNECTOR_CATALOG.length).toBe(12);
      const ids = CONNECTOR_CATALOG.map((c) => c.id);
      expect(ids).toContain("gmail");
      expect(ids).toContain("slack");
      expect(ids).toContain("github");
      expect(ids).toContain("confluence");
    });

    it("listConnectors returns clones (not frozen refs)", () => {
      const a = listConnectors();
      a[0].actions.push("mutated");
      const b = listConnectors();
      expect(b[0].actions).not.toContain("mutated");
    });

    it("getConnector returns null for unknown", () => {
      expect(getConnector("nope")).toBeNull();
      expect(getConnector("slack").category).toBe("messaging");
    });

    it("ships >=4 built-in templates", () => {
      expect(FLOW_TEMPLATES.length).toBeGreaterThanOrEqual(4);
      const ids = listFlowTemplates().map((t) => t.id);
      expect(ids).toContain("github-issue-to-slack");
    });

    it("getFlowTemplate deep-clones", () => {
      const t = getFlowTemplate("github-issue-to-slack");
      t.nodes[0].action = "mutated";
      const t2 = getFlowTemplate("github-issue-to-slack");
      expect(t2.nodes[0].action).toBe("addWebhook");
    });

    it("getConfig returns static catalog snapshot", () => {
      const c = getConfig();
      expect(c.connectors).toBe(12);
      expect(c.triggerTypes.length).toBe(5);
    });
  });

  // ─── Tables ───────────────────────────────────────────────
  describe("ensureAutomationTables", () => {
    it("creates all 3 tables", () => {
      const fresh = new MockDatabase();
      ensureAutomationTables(fresh);
      expect(fresh.tables.has("auto_flows")).toBe(true);
      expect(fresh.tables.has("auto_executions")).toBe(true);
      expect(fresh.tables.has("auto_triggers")).toBe(true);
    });

    it("is idempotent", () => {
      ensureAutomationTables(db);
      ensureAutomationTables(db);
      expect(db.tables.has("auto_flows")).toBe(true);
    });
  });

  // ─── Flow CRUD ────────────────────────────────────────────
  describe("createFlow", () => {
    it("creates a flow with draft status", () => {
      const flow = createFlow(db, {
        name: "test flow",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
        edges: [],
      });
      expect(flow.status).toBe("draft");
      expect(flow.id).toMatch(/^flow-/);
      expect(flow.nodes.length).toBe(1);
      expect(flow.createdAt).toBeTruthy();
    });

    it("requires name", () => {
      expect(() => createFlow(db, { nodes: [] })).toThrow("name is required");
    });

    it("rejects unknown connector", () => {
      expect(() =>
        createFlow(db, {
          name: "bad",
          nodes: [{ id: "n1", type: "action", connector: "zzz", action: "x" }],
        }),
      ).toThrow(/Unknown connector/);
    });

    it("rejects unknown action for connector", () => {
      expect(() =>
        createFlow(db, {
          name: "bad",
          nodes: [
            { id: "n1", type: "action", connector: "slack", action: "zz" },
          ],
        }),
      ).toThrow(/Unknown action/);
    });

    it("rejects unknown node type", () => {
      expect(() =>
        createFlow(db, {
          name: "bad",
          nodes: [{ id: "n1", type: "xxx" }],
        }),
      ).toThrow(/Unknown node type/);
    });

    it("rejects edge referencing unknown node", () => {
      expect(() =>
        createFlow(db, {
          name: "bad",
          nodes: [
            {
              id: "n1",
              type: "action",
              connector: "slack",
              action: "postMessage",
            },
          ],
          edges: [{ from: "n1", to: "unknown" }],
        }),
      ).toThrow(/edge\.to unknown/);
    });

    it("requires node.id", () => {
      expect(() =>
        createFlow(db, {
          name: "bad",
          nodes: [
            { type: "action", connector: "slack", action: "postMessage" },
          ],
        }),
      ).toThrow(/node\.id required/);
    });

    it("requires condition node expression", () => {
      expect(() =>
        createFlow(db, {
          name: "bad",
          nodes: [{ id: "n1", type: "condition" }],
        }),
      ).toThrow(/expression required/);
    });
  });

  describe("getFlow / listFlows", () => {
    it("getFlow returns null for unknown", () => {
      expect(getFlow(db, "nope")).toBeNull();
    });

    it("listFlows returns all flows", () => {
      createFlow(db, { name: "a" });
      createFlow(db, { name: "b" });
      const flows = listFlows(db);
      expect(flows.length).toBe(2);
    });

    it("listFlows filters by status", () => {
      const f1 = createFlow(db, { name: "a" });
      createFlow(db, { name: "b" });
      updateFlowStatus(db, f1.id, "active");
      const active = listFlows(db, { status: "active" });
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(f1.id);
    });

    it("listFlows respects limit", () => {
      for (let i = 0; i < 5; i++) createFlow(db, { name: `f${i}` });
      const flows = listFlows(db, { limit: 3 });
      expect(flows.length).toBe(3);
    });
  });

  describe("updateFlowStatus", () => {
    it("transitions draft → active", () => {
      const f = createFlow(db, { name: "t" });
      const updated = updateFlowStatus(db, f.id, "active");
      expect(updated.status).toBe("active");
    });

    it("rejects invalid status", () => {
      const f = createFlow(db, { name: "t" });
      expect(() => updateFlowStatus(db, f.id, "xxx")).toThrow(
        /Invalid flow status/,
      );
    });

    it("throws for unknown flow", () => {
      expect(() => updateFlowStatus(db, "nope", "active")).toThrow(
        /Flow not found/,
      );
    });
  });

  describe("deleteFlow", () => {
    it("deletes flow and cascades triggers/executions", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      addTrigger(db, f.id, {
        type: "webhook",
        config: { url: "https://a.b/c" },
      });
      executeFlow(db, f.id);
      expect(listTriggers(db, f.id).length).toBe(1);
      expect(listExecutions(db, { flowId: f.id }).length).toBe(1);

      deleteFlow(db, f.id);
      expect(getFlow(db, f.id)).toBeNull();
      expect(listTriggers(db, f.id).length).toBe(0);
      expect(listExecutions(db, { flowId: f.id }).length).toBe(0);
    });
  });

  describe("scheduleFlow", () => {
    it("sets cron schedule", () => {
      const f = createFlow(db, { name: "t" });
      const updated = scheduleFlow(db, f.id, "0 9 * * *");
      expect(updated.schedule).toBe("0 9 * * *");
    });

    it("requires cron string", () => {
      const f = createFlow(db, { name: "t" });
      expect(() => scheduleFlow(db, f.id, "")).toThrow(/cron expression/);
    });
  });

  describe("shareFlow", () => {
    it("adds org to sharedWith", () => {
      const f = createFlow(db, { name: "t" });
      const shared = shareFlow(db, f.id, "org-alpha");
      expect(shared.sharedWith).toContain("org-alpha");
    });

    it("deduplicates shared targets", () => {
      const f = createFlow(db, { name: "t" });
      shareFlow(db, f.id, "org-1");
      const again = shareFlow(db, f.id, "org-1");
      expect(again.sharedWith.length).toBe(1);
    });

    it("requires targetOrg", () => {
      const f = createFlow(db, { name: "t" });
      expect(() => shareFlow(db, f.id, null)).toThrow(/targetOrg/);
    });
  });

  describe("importTemplate", () => {
    it("imports a template into a new flow", () => {
      const flow = importTemplate(db, "github-issue-to-slack");
      expect(flow.nodes.length).toBe(2);
      expect(flow.edges.length).toBe(1);
      expect(flow.status).toBe("draft");
    });

    it("accepts name override", () => {
      const flow = importTemplate(db, "github-issue-to-slack", {
        name: "custom",
      });
      expect(flow.name).toBe("custom");
    });

    it("throws on unknown template", () => {
      expect(() => importTemplate(db, "nope")).toThrow(/Template not found/);
    });
  });

  // ─── Triggers ─────────────────────────────────────────────
  describe("addTrigger", () => {
    let flowId;
    beforeEach(() => {
      flowId = createFlow(db, { name: "t" }).id;
    });

    it("creates a webhook trigger", () => {
      const t = addTrigger(db, flowId, {
        type: "webhook",
        config: { url: "https://a.b/c" },
      });
      expect(t.type).toBe("webhook");
      expect(t.enabled).toBe(true);
      expect(t.triggerCount).toBe(0);
    });

    it("creates a schedule trigger", () => {
      const t = addTrigger(db, flowId, {
        type: "schedule",
        config: { cron: "0 9 * * *" },
      });
      expect(t.config.cron).toBe("0 9 * * *");
    });

    it("rejects webhook without URL", () => {
      expect(() =>
        addTrigger(db, flowId, { type: "webhook", config: {} }),
      ).toThrow(/config\.url/);
    });

    it("rejects schedule without cron", () => {
      expect(() =>
        addTrigger(db, flowId, { type: "schedule", config: {} }),
      ).toThrow(/config\.cron/);
    });

    it("rejects event without event name", () => {
      expect(() =>
        addTrigger(db, flowId, { type: "event", config: {} }),
      ).toThrow(/config\.event/);
    });

    it("rejects condition without expression", () => {
      expect(() =>
        addTrigger(db, flowId, { type: "condition", config: {} }),
      ).toThrow(/config\.expression/);
    });

    it("rejects unknown trigger type", () => {
      expect(() =>
        addTrigger(db, flowId, { type: "weird", config: {} }),
      ).toThrow(/Unknown trigger/);
    });

    it("fails for unknown flow", () => {
      expect(() =>
        addTrigger(db, "nope", { type: "manual", config: {} }),
      ).toThrow(/Flow not found/);
    });
  });

  describe("listTriggers / getTrigger / setTriggerEnabled", () => {
    it("returns triggers for flow", () => {
      const f = createFlow(db, { name: "t" });
      addTrigger(db, f.id, { type: "manual", config: {} });
      addTrigger(db, f.id, { type: "webhook", config: { url: "https://a" } });
      expect(listTriggers(db, f.id).length).toBe(2);
    });

    it("enables/disables a trigger", () => {
      const f = createFlow(db, { name: "t" });
      const t = addTrigger(db, f.id, { type: "manual", config: {} });
      setTriggerEnabled(db, t.id, false);
      expect(getTrigger(db, t.id).enabled).toBe(false);
      setTriggerEnabled(db, t.id, true);
      expect(getTrigger(db, t.id).enabled).toBe(true);
    });
  });

  // ─── Execution ────────────────────────────────────────────
  describe("executeFlow", () => {
    it("executes a single-node flow and logs step", () => {
      const f = createFlow(db, {
        name: "one",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      const exec = executeFlow(db, f.id, { inputData: { foo: "bar" } });
      expect(exec.status).toBe("success");
      expect(exec.stepsLog.length).toBe(1);
      expect(exec.stepsLog[0].nodeId).toBe("n1");
      expect(exec.stepsLog[0].connector).toBe("slack");
    });

    it("executes multi-node flow in topological order", () => {
      const f = createFlow(db, {
        name: "multi",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "github",
            action: "createIssue",
          },
          {
            id: "n2",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
          {
            id: "n3",
            type: "action",
            connector: "notion",
            action: "createPage",
          },
        ],
        edges: [
          { from: "n1", to: "n2" },
          { from: "n2", to: "n3" },
        ],
      });
      const exec = executeFlow(db, f.id);
      expect(exec.stepsLog.map((s) => s.nodeId)).toEqual(["n1", "n2", "n3"]);
    });

    it("handles condition node with true branch", () => {
      const f = createFlow(db, {
        name: "cond",
        nodes: [
          { id: "n1", type: "condition", expression: "ctx.errorRate > 0.05" },
        ],
      });
      const exec = executeFlow(db, f.id, { inputData: { errorRate: 0.1 } });
      expect(exec.stepsLog[0].output.branch).toBe("true");
    });

    it("handles condition node with false branch", () => {
      const f = createFlow(db, {
        name: "cond",
        nodes: [
          { id: "n1", type: "condition", expression: "ctx.errorRate > 0.05" },
        ],
      });
      const exec = executeFlow(db, f.id, { inputData: { errorRate: 0.01 } });
      expect(exec.stepsLog[0].output.branch).toBe("false");
    });

    it("records trigger type on execution row", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      const exec = executeFlow(db, f.id, { triggerType: "schedule" });
      expect(exec.triggerType).toBe("schedule");
    });

    it("supports test mode flag", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      const exec = executeFlow(db, f.id, { testMode: true });
      expect(exec.testMode).toBe(true);
    });

    it("fails gracefully for flow with cycle", () => {
      const f = createFlow(db, {
        name: "cycle",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
          {
            id: "n2",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
        edges: [{ from: "n1", to: "n2" }],
      });
      // Smuggle a cycle in via direct table mutation — cannot create via createFlow
      const row = db.data.get("auto_flows").find((r) => r.id === f.id);
      row.edges = JSON.stringify([
        { from: "n1", to: "n2" },
        { from: "n2", to: "n1" },
      ]);
      const exec = executeFlow(db, f.id);
      expect(exec.status).toBe("failed");
      expect(exec.error).toMatch(/cycle/i);
    });

    it("throws for unknown flow", () => {
      expect(() => executeFlow(db, "nope")).toThrow(/Flow not found/);
    });

    it("returns input as merged ctx when a node has two parents", () => {
      const f = createFlow(db, {
        name: "fanin",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "github",
            action: "createIssue",
          },
          {
            id: "n2",
            type: "action",
            connector: "jira",
            action: "createIssue",
          },
          {
            id: "n3",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
        edges: [
          { from: "n1", to: "n3" },
          { from: "n2", to: "n3" },
        ],
      });
      const exec = executeFlow(db, f.id);
      expect(exec.status).toBe("success");
      expect(exec.stepsLog.length).toBe(3);
    });
  });

  describe("fireTrigger", () => {
    it("fires a trigger and creates an execution", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      updateFlowStatus(db, f.id, "active");
      const t = addTrigger(db, f.id, {
        type: "webhook",
        config: { url: "https://a" },
      });
      const exec = fireTrigger(db, t.id, { source: "hook" });
      expect(exec.status).toBe("success");
      expect(exec.triggerType).toBe("webhook");
      expect(getTrigger(db, t.id).triggerCount).toBe(1);
      expect(getTrigger(db, t.id).lastTriggeredAt).toBeTruthy();
    });

    it("increments trigger count on repeated fires", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      updateFlowStatus(db, f.id, "active");
      const t = addTrigger(db, f.id, { type: "manual", config: {} });
      fireTrigger(db, t.id);
      fireTrigger(db, t.id);
      fireTrigger(db, t.id);
      expect(getTrigger(db, t.id).triggerCount).toBe(3);
    });

    it("refuses to fire a disabled trigger", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      const t = addTrigger(db, f.id, { type: "manual", config: {} });
      setTriggerEnabled(db, t.id, false);
      expect(() => fireTrigger(db, t.id)).toThrow(/disabled/);
    });

    it("refuses to fire when flow is paused", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      const t = addTrigger(db, f.id, { type: "manual", config: {} });
      updateFlowStatus(db, f.id, "paused");
      expect(() => fireTrigger(db, t.id)).toThrow(/paused/);
    });

    it("refuses to fire when flow is archived", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      const t = addTrigger(db, f.id, { type: "manual", config: {} });
      updateFlowStatus(db, f.id, "archived");
      expect(() => fireTrigger(db, t.id)).toThrow(/archived/);
    });
  });

  // ─── Execution queries ───────────────────────────────────
  describe("getExecution / listExecutions", () => {
    it("filters executions by flow", () => {
      const a = createFlow(db, {
        name: "a",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      const b = createFlow(db, {
        name: "b",
        nodes: [
          { id: "n1", type: "action", connector: "gmail", action: "send" },
        ],
      });
      executeFlow(db, a.id);
      executeFlow(db, a.id);
      executeFlow(db, b.id);

      expect(listExecutions(db, { flowId: a.id }).length).toBe(2);
      expect(listExecutions(db, { flowId: b.id }).length).toBe(1);
    });

    it("filters by status", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      executeFlow(db, f.id);
      expect(listExecutions(db, { status: "success" }).length).toBe(1);
      expect(listExecutions(db, { status: "failed" }).length).toBe(0);
    });

    it("getExecution returns null for unknown", () => {
      expect(getExecution(db, "nope")).toBeNull();
    });
  });

  // ─── Stats ────────────────────────────────────────────────
  describe("getStats", () => {
    it("returns zeroes for empty db", () => {
      const s = getStats(db);
      expect(s.flows.total).toBe(0);
      expect(s.executions.total).toBe(0);
      expect(s.triggers.total).toBe(0);
      expect(s.connectors).toBe(12);
    });

    it("aggregates by status", () => {
      const f1 = createFlow(db, { name: "a" });
      const f2 = createFlow(db, { name: "b" });
      updateFlowStatus(db, f1.id, "active");
      updateFlowStatus(db, f2.id, "archived");
      const s = getStats(db);
      expect(s.flows.total).toBe(2);
      expect(s.flows.byStatus.active).toBe(1);
      expect(s.flows.byStatus.archived).toBe(1);
    });

    it("computes execution success rate", () => {
      const f = createFlow(db, {
        name: "t",
        nodes: [
          {
            id: "n1",
            type: "action",
            connector: "slack",
            action: "postMessage",
          },
        ],
      });
      executeFlow(db, f.id);
      executeFlow(db, f.id);
      const s = getStats(db);
      expect(s.executions.total).toBe(2);
      expect(s.executions.successRate).toBe(1.0);
      expect(s.executions.byStatus.success).toBe(2);
    });

    it("aggregates triggers by type", () => {
      const f = createFlow(db, { name: "t" });
      addTrigger(db, f.id, { type: "webhook", config: { url: "https://a" } });
      addTrigger(db, f.id, { type: "webhook", config: { url: "https://b" } });
      addTrigger(db, f.id, { type: "manual", config: {} });
      const s = getStats(db);
      expect(s.triggers.byType.webhook).toBe(2);
      expect(s.triggers.byType.manual).toBe(1);
    });
  });

  // ─── End-to-end ───────────────────────────────────────────
  describe("end-to-end", () => {
    it("imports template → activates → fires via trigger", () => {
      const f = importTemplate(db, "error-rate-alert");
      updateFlowStatus(db, f.id, "active");
      const t = addTrigger(db, f.id, {
        type: "condition",
        config: { expression: "ctx.errorRate > 0.05" },
      });
      const exec = fireTrigger(db, t.id, { errorRate: 0.12 });
      expect(exec.status).toBe("success");
      expect(exec.stepsLog.length).toBe(3);
      // First step is condition node; it should have evaluated true
      expect(exec.stepsLog[0].output.branch).toBe("true");
    });
  });
});

// ── V2 Surface ──

import {
  AUTOMATION_MATURITY_V2,
  EXECUTION_LIFECYCLE_V2,
  AUTOMATION_DEFAULT_MAX_ACTIVE_PER_OWNER,
  AUTOMATION_DEFAULT_MAX_RUNNING_PER_AUTOMATION,
  AUTOMATION_DEFAULT_AUTOMATION_IDLE_MS,
  AUTOMATION_DEFAULT_EXECUTION_STUCK_MS,
  getMaxActiveAutomationsPerOwnerV2,
  setMaxActiveAutomationsPerOwnerV2,
  getMaxRunningExecutionsPerAutomationV2,
  setMaxRunningExecutionsPerAutomationV2,
  getAutomationIdleMsV2,
  setAutomationIdleMsV2,
  getExecutionStuckMsV2,
  setExecutionStuckMsV2,
  registerAutomationV2,
  getAutomationV2,
  listAutomationsV2,
  setAutomationStatusV2,
  activateAutomationV2,
  pauseAutomationV2,
  retireAutomationV2,
  touchAutomationV2,
  getActiveAutomationCountV2,
  createExecutionV2,
  getExecutionV2,
  listExecutionsV2,
  setExecutionStatusV2,
  startExecutionV2,
  succeedExecutionV2,
  failExecutionV2,
  cancelExecutionV2,
  getRunningExecutionCountV2,
  autoPauseIdleAutomationsV2,
  autoFailStuckExecutionsV2,
  getAutomationEngineStatsV2,
  _resetStateAutomationEngineV2,
} from "../../src/lib/automation-engine.js";

describe("automation-engine V2", () => {
  beforeEach(() => {
    _resetStateAutomationEngineV2();
  });

  describe("enums", () => {
    it("AUTOMATION_MATURITY_V2 frozen 4 states", () => {
      expect(Object.values(AUTOMATION_MATURITY_V2)).toEqual([
        "draft",
        "active",
        "paused",
        "retired",
      ]);
      expect(Object.isFrozen(AUTOMATION_MATURITY_V2)).toBe(true);
    });

    it("EXECUTION_LIFECYCLE_V2 frozen 5 states", () => {
      expect(Object.values(EXECUTION_LIFECYCLE_V2)).toEqual([
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ]);
      expect(Object.isFrozen(EXECUTION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config defaults & setters", () => {
    it("defaults match constants", () => {
      expect(getMaxActiveAutomationsPerOwnerV2()).toBe(
        AUTOMATION_DEFAULT_MAX_ACTIVE_PER_OWNER,
      );
      expect(getMaxRunningExecutionsPerAutomationV2()).toBe(
        AUTOMATION_DEFAULT_MAX_RUNNING_PER_AUTOMATION,
      );
      expect(getAutomationIdleMsV2()).toBe(
        AUTOMATION_DEFAULT_AUTOMATION_IDLE_MS,
      );
      expect(getExecutionStuckMsV2()).toBe(
        AUTOMATION_DEFAULT_EXECUTION_STUCK_MS,
      );
    });

    it("setters update", () => {
      setMaxActiveAutomationsPerOwnerV2(50);
      expect(getMaxActiveAutomationsPerOwnerV2()).toBe(50);
      setMaxRunningExecutionsPerAutomationV2(7);
      expect(getMaxRunningExecutionsPerAutomationV2()).toBe(7);
      setAutomationIdleMsV2(1234);
      expect(getAutomationIdleMsV2()).toBe(1234);
      setExecutionStuckMsV2(5678);
      expect(getExecutionStuckMsV2()).toBe(5678);
    });

    it("setters floor non-integers", () => {
      setMaxActiveAutomationsPerOwnerV2(8.6);
      expect(getMaxActiveAutomationsPerOwnerV2()).toBe(8);
    });

    it("setters reject zero/negative/NaN", () => {
      expect(() => setMaxActiveAutomationsPerOwnerV2(0)).toThrow();
      expect(() => setMaxRunningExecutionsPerAutomationV2(-1)).toThrow();
      expect(() => setAutomationIdleMsV2(NaN)).toThrow();
      expect(() => setExecutionStuckMsV2("nope")).toThrow();
    });

    it("_resetState restores defaults", () => {
      setMaxActiveAutomationsPerOwnerV2(99);
      _resetStateAutomationEngineV2();
      expect(getMaxActiveAutomationsPerOwnerV2()).toBe(
        AUTOMATION_DEFAULT_MAX_ACTIVE_PER_OWNER,
      );
    });
  });

  describe("registerAutomationV2", () => {
    it("creates draft automation", () => {
      const a = registerAutomationV2("a1", {
        ownerId: "u1",
        name: "Sync flow",
        now: 1000,
      });
      expect(a.status).toBe("draft");
      expect(a.ownerId).toBe("u1");
      expect(a.activatedAt).toBeNull();
      expect(a.retiredAt).toBeNull();
    });

    it("rejects invalid id/owner/name", () => {
      expect(() =>
        registerAutomationV2("", { ownerId: "u", name: "n" }),
      ).toThrow();
      expect(() =>
        registerAutomationV2("a", { ownerId: "", name: "n" }),
      ).toThrow();
      expect(() =>
        registerAutomationV2("a", { ownerId: "u", name: "" }),
      ).toThrow();
    });

    it("rejects duplicate", () => {
      registerAutomationV2("a1", { ownerId: "u", name: "n" });
      expect(() =>
        registerAutomationV2("a1", { ownerId: "u", name: "n2" }),
      ).toThrow(/already exists/);
    });

    it("returns defensive copy", () => {
      const a = registerAutomationV2("a1", {
        ownerId: "u",
        name: "n",
        metadata: { k: "v" },
      });
      a.metadata.k = "tampered";
      expect(getAutomationV2("a1").metadata.k).toBe("v");
    });
  });

  describe("automation transitions", () => {
    beforeEach(() => {
      registerAutomationV2("a1", { ownerId: "u1", name: "n", now: 1000 });
    });

    it("draft→active stamps activatedAt", () => {
      const a = activateAutomationV2("a1", { now: 2000 });
      expect(a.status).toBe("active");
      expect(a.activatedAt).toBe(2000);
    });

    it("paused→active recovery preserves activatedAt", () => {
      activateAutomationV2("a1", { now: 2000 });
      pauseAutomationV2("a1", { now: 3000 });
      const a = activateAutomationV2("a1", { now: 4000 });
      expect(a.activatedAt).toBe(2000);
    });

    it("→retired stamps retiredAt and is terminal", () => {
      const a = retireAutomationV2("a1", { now: 5000 });
      expect(a.retiredAt).toBe(5000);
      expect(() => activateAutomationV2("a1")).toThrow(/terminal/);
    });

    it("rejects unknown status", () => {
      expect(() => setAutomationStatusV2("a1", "bogus")).toThrow(/unknown/);
    });

    it("rejects illegal draft→paused", () => {
      expect(() => pauseAutomationV2("a1")).toThrow(/cannot transition/);
    });

    it("rejects missing", () => {
      expect(() => activateAutomationV2("nope")).toThrow(/not found/);
    });

    it("per-owner cap enforced on draft→active only", () => {
      setMaxActiveAutomationsPerOwnerV2(2);
      registerAutomationV2("a2", { ownerId: "u1", name: "n" });
      registerAutomationV2("a3", { ownerId: "u1", name: "n" });
      activateAutomationV2("a1");
      activateAutomationV2("a2");
      expect(() => activateAutomationV2("a3")).toThrow(/active-automation cap/);
    });

    it("paused→active recovery exempt from cap", () => {
      setMaxActiveAutomationsPerOwnerV2(2);
      registerAutomationV2("a2", { ownerId: "u1", name: "n" });
      registerAutomationV2("a3", { ownerId: "u1", name: "n" });
      activateAutomationV2("a1");
      activateAutomationV2("a2");
      pauseAutomationV2("a1");
      activateAutomationV2("a3");
      const a1 = activateAutomationV2("a1");
      expect(a1.status).toBe("active");
    });

    it("per-owner cap is owner-scoped", () => {
      setMaxActiveAutomationsPerOwnerV2(1);
      registerAutomationV2("a2", { ownerId: "u2", name: "n" });
      activateAutomationV2("a1");
      const a = activateAutomationV2("a2");
      expect(a.status).toBe("active");
    });
  });

  describe("touchAutomationV2", () => {
    it("updates lastSeenAt", () => {
      registerAutomationV2("a1", { ownerId: "u", name: "n", now: 1000 });
      activateAutomationV2("a1", { now: 2000 });
      const a = touchAutomationV2("a1", { now: 9999 });
      expect(a.lastSeenAt).toBe(9999);
      expect(a.status).toBe("active");
    });

    it("throws on missing", () => {
      expect(() => touchAutomationV2("nope")).toThrow(/not found/);
    });
  });

  describe("listAutomationsV2 + getActiveAutomationCountV2", () => {
    it("filters by ownerId/status", () => {
      registerAutomationV2("a1", { ownerId: "u1", name: "n" });
      registerAutomationV2("a2", { ownerId: "u1", name: "n" });
      registerAutomationV2("a3", { ownerId: "u2", name: "n" });
      activateAutomationV2("a1");
      expect(listAutomationsV2({ ownerId: "u1" })).toHaveLength(2);
      expect(listAutomationsV2({ status: "active" })).toHaveLength(1);
    });

    it("counts only active", () => {
      registerAutomationV2("a1", { ownerId: "u", name: "n" });
      registerAutomationV2("a2", { ownerId: "u", name: "n" });
      activateAutomationV2("a1");
      expect(getActiveAutomationCountV2("u")).toBe(1);
    });
  });

  describe("createExecutionV2", () => {
    beforeEach(() => {
      registerAutomationV2("a1", { ownerId: "u", name: "n" });
    });

    it("creates queued execution", () => {
      const e = createExecutionV2("e1", {
        automationId: "a1",
        now: 1000,
      });
      expect(e.status).toBe("queued");
      expect(e.startedAt).toBeNull();
      expect(e.settledAt).toBeNull();
    });

    it("rejects invalid id/automationId", () => {
      expect(() => createExecutionV2("", { automationId: "a1" })).toThrow();
      expect(() => createExecutionV2("e", { automationId: "" })).toThrow();
    });

    it("rejects duplicate", () => {
      createExecutionV2("e1", { automationId: "a1" });
      expect(() => createExecutionV2("e1", { automationId: "a1" })).toThrow(
        /already exists/,
      );
    });
  });

  describe("execution transitions", () => {
    beforeEach(() => {
      registerAutomationV2("a1", { ownerId: "u", name: "n" });
      createExecutionV2("e1", { automationId: "a1", now: 1000 });
    });

    it("queued→running stamps startedAt", () => {
      const e = startExecutionV2("e1", { now: 2000 });
      expect(e.status).toBe("running");
      expect(e.startedAt).toBe(2000);
      expect(e.settledAt).toBeNull();
    });

    it("running→succeeded stamps settledAt (terminal)", () => {
      startExecutionV2("e1", { now: 2000 });
      const e = succeedExecutionV2("e1", { now: 3000 });
      expect(e.settledAt).toBe(3000);
      expect(() => failExecutionV2("e1")).toThrow(/terminal/);
    });

    it("running→failed stamps settledAt", () => {
      startExecutionV2("e1", { now: 2000 });
      const e = failExecutionV2("e1", { now: 3000 });
      expect(e.status).toBe("failed");
      expect(e.settledAt).toBe(3000);
    });

    it("queued→cancelled stamps settledAt", () => {
      const e = cancelExecutionV2("e1", { now: 2500 });
      expect(e.status).toBe("cancelled");
      expect(e.settledAt).toBe(2500);
    });

    it("queued cannot succeed directly", () => {
      expect(() => succeedExecutionV2("e1")).toThrow(/cannot transition/);
    });

    it("rejects unknown status", () => {
      expect(() => setExecutionStatusV2("e1", "bogus")).toThrow(/unknown/);
    });

    it("rejects missing", () => {
      expect(() => startExecutionV2("nope")).toThrow(/not found/);
    });

    it("per-automation running cap enforced at queued→running", () => {
      setMaxRunningExecutionsPerAutomationV2(2);
      createExecutionV2("e2", { automationId: "a1" });
      createExecutionV2("e3", { automationId: "a1" });
      startExecutionV2("e1");
      startExecutionV2("e2");
      expect(() => startExecutionV2("e3")).toThrow(/running-execution cap/);
    });

    it("running cap excludes terminals", () => {
      setMaxRunningExecutionsPerAutomationV2(2);
      createExecutionV2("e2", { automationId: "a1" });
      createExecutionV2("e3", { automationId: "a1" });
      startExecutionV2("e1");
      startExecutionV2("e2");
      succeedExecutionV2("e1");
      const e3 = startExecutionV2("e3");
      expect(e3.status).toBe("running");
    });
  });

  describe("listExecutionsV2 + getRunningExecutionCountV2", () => {
    beforeEach(() => {
      registerAutomationV2("a1", { ownerId: "u", name: "n" });
      registerAutomationV2("a2", { ownerId: "u", name: "n" });
      createExecutionV2("e1", { automationId: "a1" });
      createExecutionV2("e2", { automationId: "a1" });
      createExecutionV2("e3", { automationId: "a2" });
      startExecutionV2("e1");
    });

    it("filters by automationId/status", () => {
      expect(listExecutionsV2({ automationId: "a1" })).toHaveLength(2);
      expect(listExecutionsV2({ status: "queued" })).toHaveLength(2);
    });

    it("counts only running per automation", () => {
      expect(getRunningExecutionCountV2("a1")).toBe(1);
      expect(getRunningExecutionCountV2("a2")).toBe(0);
    });
  });

  describe("autoPauseIdleAutomationsV2", () => {
    it("flips active→paused when idle", () => {
      registerAutomationV2("a1", { ownerId: "u", name: "n", now: 1000 });
      activateAutomationV2("a1", { now: 1000 });
      setAutomationIdleMsV2(500);
      const flipped = autoPauseIdleAutomationsV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("paused");
    });

    it("skips non-active", () => {
      registerAutomationV2("a1", { ownerId: "u", name: "n", now: 1000 });
      setAutomationIdleMsV2(500);
      const flipped = autoPauseIdleAutomationsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });

    it("preserves under-threshold", () => {
      registerAutomationV2("a1", { ownerId: "u", name: "n", now: 1000 });
      activateAutomationV2("a1", { now: 1000 });
      setAutomationIdleMsV2(5000);
      const flipped = autoPauseIdleAutomationsV2({ now: 2000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckExecutionsV2", () => {
    beforeEach(() => {
      registerAutomationV2("a1", { ownerId: "u", name: "n" });
    });

    it("flips running→failed when stuck", () => {
      createExecutionV2("e1", { automationId: "a1", now: 1000 });
      startExecutionV2("e1", { now: 1000 });
      setExecutionStuckMsV2(500);
      const flipped = autoFailStuckExecutionsV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].settledAt).toBe(2000);
    });

    it("skips non-running (queued)", () => {
      createExecutionV2("e1", { automationId: "a1", now: 1000 });
      setExecutionStuckMsV2(500);
      const flipped = autoFailStuckExecutionsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });

    it("skips terminals", () => {
      createExecutionV2("e1", { automationId: "a1", now: 1000 });
      cancelExecutionV2("e1", { now: 1000 });
      setExecutionStuckMsV2(500);
      const flipped = autoFailStuckExecutionsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getAutomationEngineStatsV2", () => {
    it("zero-init when empty", () => {
      const s = getAutomationEngineStatsV2();
      expect(s.totalAutomationsV2).toBe(0);
      expect(s.totalExecutionsV2).toBe(0);
      expect(s.automationsByStatus).toEqual({
        draft: 0,
        active: 0,
        paused: 0,
        retired: 0,
      });
      expect(s.executionsByStatus).toEqual({
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      });
    });

    it("counts by status + config snapshot", () => {
      registerAutomationV2("a1", { ownerId: "u", name: "n" });
      activateAutomationV2("a1");
      createExecutionV2("e1", { automationId: "a1" });
      startExecutionV2("e1");
      setMaxActiveAutomationsPerOwnerV2(33);
      const s = getAutomationEngineStatsV2();
      expect(s.totalAutomationsV2).toBe(1);
      expect(s.automationsByStatus.active).toBe(1);
      expect(s.totalExecutionsV2).toBe(1);
      expect(s.executionsByStatus.running).toBe(1);
      expect(s.maxActiveAutomationsPerOwner).toBe(33);
    });
  });
});
