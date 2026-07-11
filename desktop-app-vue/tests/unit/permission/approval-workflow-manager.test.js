/**
 * ApprovalWorkflowManager.getWorkflows tests
 *
 * Backs the perm:get-workflows IPC channel (Approval Center workflows list).
 * Uses a real better-sqlite3 :memory: database with the production schema.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ApprovalWorkflowManager } from "../../../src/main/permission/approval-workflow-manager.js";

const SCHEMA = `
  CREATE TABLE approval_workflows (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    trigger_resource_type TEXT NOT NULL,
    trigger_action TEXT NOT NULL,
    trigger_conditions TEXT,
    approval_type TEXT DEFAULT 'sequential' CHECK(approval_type IN ('sequential', 'parallel', 'any_one')),
    approvers TEXT NOT NULL,
    timeout_hours INTEGER DEFAULT 72,
    on_timeout TEXT DEFAULT 'reject' CHECK(on_timeout IN ('approve', 'reject', 'escalate')),
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(org_id, name)
  );
`;

describe("ApprovalWorkflowManager.getWorkflows", () => {
  let db;
  let manager;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    manager = new ApprovalWorkflowManager({ getDatabase: () => db });
  });

  it("returns an empty list for an org with no workflows", async () => {
    const result = await manager.getWorkflows("org-1");
    expect(result.success).toBe(true);
    expect(result.workflows).toEqual([]);
  });

  it("returns created workflows mapped to camelCase with parsed approvers", async () => {
    await manager.createWorkflow({
      orgId: "org-1",
      name: "发布审批",
      description: "知识发布需审批",
      triggerResourceType: "knowledge",
      triggerAction: "publish",
      approvalType: "any_one",
      approvers: [["did:a", "did:b"]],
      timeoutHours: 24,
    });

    const result = await manager.getWorkflows("org-1");
    expect(result.success).toBe(true);
    expect(result.workflows).toHaveLength(1);

    const wf = result.workflows[0];
    expect(wf.orgId).toBe("org-1");
    expect(wf.name).toBe("发布审批");
    expect(wf.triggerResourceType).toBe("knowledge");
    expect(wf.triggerAction).toBe("publish");
    expect(wf.approvalType).toBe("any_one");
    expect(wf.approvers).toEqual([["did:a", "did:b"]]);
    expect(wf.timeoutHours).toBe(24);
    expect(wf.enabled).toBe(true);
    expect(typeof wf.createdAt).toBe("number");
  });

  it("scopes to the requested org only", async () => {
    await manager.createWorkflow({
      orgId: "org-1",
      name: "wf-a",
      triggerResourceType: "permission",
      triggerAction: "grant",
      approvers: [["did:a"]],
    });
    await manager.createWorkflow({
      orgId: "org-2",
      name: "wf-b",
      triggerResourceType: "permission",
      triggerAction: "grant",
      approvers: [["did:b"]],
    });

    const result = await manager.getWorkflows("org-2");
    expect(result.workflows.map((w) => w.name)).toEqual(["wf-b"]);
  });

  it("enabledOnly filters out disabled workflows", async () => {
    const created = await manager.createWorkflow({
      orgId: "org-1",
      name: "wf-off",
      triggerResourceType: "permission",
      triggerAction: "grant",
      approvers: [["did:a"]],
      enabled: false,
    });
    await manager.createWorkflow({
      orgId: "org-1",
      name: "wf-on",
      triggerResourceType: "permission",
      triggerAction: "grant",
      approvers: [["did:a"]],
    });

    const all = await manager.getWorkflows("org-1");
    expect(all.workflows).toHaveLength(2);

    const enabledOnly = await manager.getWorkflows("org-1", {
      enabledOnly: true,
    });
    expect(enabledOnly.workflows.map((w) => w.name)).toEqual(["wf-on"]);
    expect(created.success).toBe(true);
  });

  it("a corrupt JSON column on one row degrades that row instead of breaking the list", async () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO approval_workflows (
        id, org_id, name, trigger_resource_type, trigger_action,
        trigger_conditions, approvers, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      "wf-corrupt",
      "org-1",
      "坏数据",
      "permission",
      "grant",
      "{not-json",
      "[broken",
      now,
      now,
    );
    await manager.createWorkflow({
      orgId: "org-1",
      name: "好数据",
      triggerResourceType: "permission",
      triggerAction: "grant",
      approvers: [["did:a"]],
    });

    const result = await manager.getWorkflows("org-1");
    expect(result.success).toBe(true);
    expect(result.workflows).toHaveLength(2);

    const corrupt = result.workflows.find((w) => w.id === "wf-corrupt");
    expect(corrupt.approvers).toEqual([]);
    expect(corrupt.triggerConditions).toBeNull();

    const good = result.workflows.find((w) => w.name === "好数据");
    expect(good.approvers).toEqual([["did:a"]]);
  });

  it("orders newest first", async () => {
    const insert = db.prepare(
      `INSERT INTO approval_workflows (
        id, org_id, name, trigger_resource_type, trigger_action,
        approvers, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    insert.run(
      "wf-old",
      "org-1",
      "older",
      "permission",
      "grant",
      "[]",
      1000,
      1000,
    );
    insert.run(
      "wf-new",
      "org-1",
      "newer",
      "permission",
      "grant",
      "[]",
      2000,
      2000,
    );

    const result = await manager.getWorkflows("org-1");
    expect(result.workflows.map((w) => w.id)).toEqual(
      ["wf-old", "wf-new"].reverse(),
    );
  });
});
