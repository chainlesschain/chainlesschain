import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let Database;
let hasSqlite = true;
try {
  Database = require("better-sqlite3");
  const t = new Database(":memory:");
  t.close();
} catch {
  hasSqlite = false;
}

const { SQLCipherWrapper } = require("../../../database/sqlcipher-wrapper");
const { WorkflowStorage } = require("../workflow-storage");

const describeIf = hasSqlite ? describe : describe.skip;

// Reads in workflow-storage used the dead sql.js idiom (bind()/step()/
// getAsObject()) which the SQLCipher wrapper stubs to false/null → every read
// silently returned null/[]. These tests drive the REAL wrapper so they fail if
// the module regresses to the sql.js iteration API.
describeIf("WorkflowStorage reads via real SQLCipher wrapper", () => {
  let wrapper, storage;

  beforeEach(() => {
    wrapper = new SQLCipherWrapper(":memory:", {}, Database);
    wrapper.open();
    wrapper.db.exec(`
      CREATE TABLE browser_workflows (
        id TEXT PRIMARY KEY, name TEXT, description TEXT, steps TEXT,
        variables TEXT, triggers TEXT, tags TEXT, is_template INTEGER,
        is_enabled INTEGER, created_by TEXT, created_at INTEGER,
        updated_at INTEGER, usage_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0, last_executed_at INTEGER,
        avg_duration REAL);
      CREATE TABLE browser_workflow_executions (
        id TEXT PRIMARY KEY, workflow_id TEXT, workflow_name TEXT,
        target_id TEXT, status TEXT, variables_snapshot TEXT, results TEXT,
        current_step INTEGER DEFAULT 0, total_steps INTEGER DEFAULT 0,
        error_message TEXT, error_step INTEGER, retry_count INTEGER DEFAULT 0,
        started_at INTEGER, paused_at INTEGER, completed_at INTEGER,
        duration INTEGER);
    `);
    storage = new WorkflowStorage(wrapper);
  });

  afterEach(() => {
    try {
      wrapper.db.close();
    } catch {
      /* ignore */
    }
  });

  it("getWorkflow returns the saved workflow (not null)", async () => {
    await storage.createWorkflow({
      id: "wf-1",
      name: "My Flow",
      steps: [{ action: "click" }],
      tags: ["a", "b"],
    });

    const wf = await storage.getWorkflow("wf-1");
    expect(wf).not.toBeNull();
    expect(wf).toMatchObject({ id: "wf-1", name: "My Flow", tags: ["a", "b"] });
    expect(wf.steps).toEqual([{ action: "click" }]);
  });

  it("getWorkflow returns null for a missing id", async () => {
    expect(await storage.getWorkflow("nope")).toBeNull();
  });

  it("listWorkflows returns saved workflows (not empty)", async () => {
    await storage.createWorkflow({ id: "wf-1", name: "A" });
    await storage.createWorkflow({ id: "wf-2", name: "B" });

    const list = await storage.listWorkflows({});
    expect(list.map((w) => w.id).sort()).toEqual(["wf-1", "wf-2"]);
  });

  it("getExecution / listExecutions return saved executions (not null/empty)", async () => {
    await storage.createWorkflow({ id: "wf-1", name: "A" });
    await storage.createExecution({
      id: "ex-1",
      workflowId: "wf-1",
      workflowName: "A",
      status: "running",
      totalSteps: 3,
    });

    const ex = await storage.getExecution("ex-1");
    expect(ex).not.toBeNull();
    expect(ex).toMatchObject({ id: "ex-1", workflowId: "wf-1", totalSteps: 3 });

    const list = await storage.listExecutions({ workflowId: "wf-1" });
    expect(list.map((e) => e.id)).toEqual(["ex-1"]);
  });
});
