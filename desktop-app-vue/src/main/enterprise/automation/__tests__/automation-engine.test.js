/**
 * AutomationEngine unit tests — Phase 96
 *
 * Covers: initialize, createFlow, executeFlow, listConnectors, addTrigger,
 *         testFlow, getExecutionLogs, importTemplate, shareFlow, scheduleFlow, getStats
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { AutomationEngine } = require("../automation-engine");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("AutomationEngine", () => {
  let engine;
  let db;

  beforeEach(() => {
    engine = new AutomationEngine();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(engine.initialized).toBe(false);
    expect(engine._flows.size).toBe(0);
    expect(engine._connectors.size).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize and load default connectors", async () => {
    await engine.initialize(db);
    expect(engine.initialized).toBe(true);
    expect(engine._connectors.size).toBe(12);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await engine.initialize(db);
    await engine.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── createFlow ───────────────────────────────────────────────────────────
  it("should create a flow", async () => {
    await engine.initialize(db);
    const result = engine.createFlow({
      name: "My Flow",
      steps: [{ id: "s1", connector: "gmail", action: "send" }],
    });
    expect(result.id).toBeTruthy();
    expect(result.name).toBe("My Flow");
    expect(result.status).toBe("draft");
  });

  it("should emit automation:flow-created event", async () => {
    await engine.initialize(db);
    const listener = vi.fn();
    engine.on("automation:flow-created", listener);
    engine.createFlow({ name: "Test" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test" }),
    );
  });

  // ── executeFlow ──────────────────────────────────────────────────────────
  it("should execute a flow with steps", async () => {
    await engine.initialize(db);
    const flow = engine.createFlow({
      name: "Exec Flow",
      steps: [
        { id: "s1", connector: "slack", action: "send-message" },
        { id: "s2", connector: "gmail", action: "send" },
      ],
    });
    const result = await engine.executeFlow(flow.id, { message: "hello" });
    expect(result.status).toBe("completed");
    expect(result.results).toHaveLength(2);
    expect(result.duration).toBeDefined();
  });

  it("should throw when executing unknown flow", async () => {
    await engine.initialize(db);
    await expect(engine.executeFlow("nonexistent")).rejects.toThrow(
      "not found",
    );
  });

  it("should emit automation:flow-executed event", async () => {
    await engine.initialize(db);
    const flow = engine.createFlow({ name: "Test", steps: [] });
    const listener = vi.fn();
    engine.on("automation:flow-executed", listener);
    await engine.executeFlow(flow.id);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ flowId: flow.id }),
    );
  });

  // ── listConnectors ───────────────────────────────────────────────────────
  it("should list all connectors", async () => {
    await engine.initialize(db);
    const connectors = engine.listConnectors();
    expect(connectors.length).toBe(12);
  });

  it("should filter connectors by category", async () => {
    await engine.initialize(db);
    const devops = engine.listConnectors({ category: "devops" });
    expect(devops.length).toBe(1);
    expect(devops[0].id).toBe("github");
  });

  it("should return empty for unknown category filter", async () => {
    await engine.initialize(db);
    const result = engine.listConnectors({ category: "nonexistent" });
    expect(result).toHaveLength(0);
  });

  // ── addTrigger ───────────────────────────────────────────────────────────
  it("should add a trigger to a flow", async () => {
    await engine.initialize(db);
    const flow = engine.createFlow({ name: "Triggered Flow" });
    const triggers = engine.addTrigger(flow.id, {
      type: "webhook",
      url: "/hook",
    });
    expect(triggers.length).toBe(1);
    expect(triggers[0].type).toBe("webhook");
  });

  it("should throw when adding trigger to unknown flow", async () => {
    await engine.initialize(db);
    expect(() => engine.addTrigger("nonexistent", {})).toThrow("not found");
  });

  // ── testFlow ─────────────────────────────────────────────────────────────
  it("should dry-run test a flow", async () => {
    await engine.initialize(db);
    const flow = engine.createFlow({
      name: "Test Flow",
      steps: [{ id: "s1" }, { id: "s2" }],
    });
    const result = engine.testFlow(flow.id);
    expect(result.dryRun).toBe(true);
    expect(result.steps).toBe(2);
    expect(result.estimatedDuration).toBe(2000);
  });

  it("should throw when testing unknown flow", async () => {
    await engine.initialize(db);
    expect(() => engine.testFlow("nonexistent")).toThrow("not found");
  });

  // ── getExecutionLogs ─────────────────────────────────────────────────────
  it("should return execution logs after execution", async () => {
    await engine.initialize(db);
    const flow = engine.createFlow({ name: "Log Flow", steps: [] });
    await engine.executeFlow(flow.id);
    const logs = engine.getExecutionLogs(flow.id);
    expect(logs.length).toBe(1);
    expect(logs[0].flowId).toBe(flow.id);
  });

  it("should return empty logs when no executions", async () => {
    await engine.initialize(db);
    expect(engine.getExecutionLogs("any")).toHaveLength(0);
  });

  // ── importTemplate ───────────────────────────────────────────────────────
  it("should import template as new flow", async () => {
    await engine.initialize(db);
    const result = engine.importTemplate({
      name: "Imported Flow",
      steps: [{ id: "s1" }],
    });
    expect(result.name).toBe("Imported Flow");
    expect(result.status).toBe("draft");
  });

  // ── shareFlow ────────────────────────────────────────────────────────────
  it("should share a flow and return share URL", async () => {
    await engine.initialize(db);
    const flow = engine.createFlow({ name: "Shared Flow" });
    const result = engine.shareFlow(flow.id);
    expect(result.shared).toBe(true);
    expect(result.shareUrl).toContain(flow.id);
  });

  it("should return null when sharing unknown flow", async () => {
    await engine.initialize(db);
    expect(engine.shareFlow("unknown")).toBeNull();
  });

  // ── scheduleFlow ─────────────────────────────────────────────────────────
  it("should schedule a flow with cron expression", async () => {
    await engine.initialize(db);
    const flow = engine.createFlow({ name: "Scheduled" });
    const result = engine.scheduleFlow(flow.id, "0 */6 * * *");
    expect(result.cron).toBe("0 */6 * * *");
    expect(result.status).toBe("active");
  });

  // ── getStats ─────────────────────────────────────────────────────────────
  it("should return engine stats", async () => {
    await engine.initialize(db);
    engine.createFlow({ name: "Flow 1" });
    engine.createFlow({ name: "Flow 2" });
    const stats = engine.getStats();
    expect(stats.totalFlows).toBe(2);
    expect(stats.connectors).toBe(12);
    expect(stats.executionCount).toBe(0);
  });
});
