/**
 * WorkflowHandler — Phase 6.5 桌面 debt 修复测试
 *
 * 覆盖 3 个新加的 method:
 *   clone / export / import
 *
 * Android `WorkflowCommands.kt` 13 method typed wrapper — 之前桌面只 wire
 * 了 10 method，mobile peer 调 workflow.clone / workflow.export /
 * workflow.import 会拿 "Unknown action: <name>"。本测试防退保对 13 method
 * 路由全连通 + 各 method 行为 + Android `WorkflowCreateResponse` /
 * `WorkflowExportResponse` 兼容 shape。
 *
 * Reference:
 *   docs/design/Desktop_Mobile_Bridge_Namespace_Coverage.md §4.2 #8
 *   android-app/.../remote/commands/WorkflowCommands.kt:357,527
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");
const { WorkflowHandler } = require("../handlers/workflow-handler");

// commandExecutor stub — required by WorkflowHandler ctor but never called
// by clone/export/import (which only touch the workflows table).
const noopExecutor = async () => ({ ok: true });

describe("WorkflowHandler — Phase 6.5 3 桌面 debt method fix", () => {
  let handler;
  let db;
  const ctx = { did: "did:test:phone" };

  beforeEach(() => {
    db = new Database(":memory:");
    handler = new WorkflowHandler(db, noopExecutor, {});
  });

  afterEach(() => {
    db.close();
  });

  // Seed a workflow row directly so clone / export tests don't depend on
  // createWorkflow side effects (which has its own test coverage).
  function _seed(overrides = {}) {
    const id = overrides.id || `wf-${Date.now()}-seed`;
    const def = {
      id,
      name: overrides.name || "src",
      description: overrides.description || "src desc",
      steps: overrides.steps || [{ id: "s1", action: "noop" }],
      variables: overrides.variables || { foo: "bar" },
      rollback: overrides.rollback || null,
      tags: overrides.tags || ["t1", "t2"],
    };
    const now = overrides.now || Date.now();
    db.prepare(
      `INSERT INTO workflows (id, name, description, definition, tags, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      def.name,
      def.description,
      JSON.stringify(def),
      JSON.stringify(def.tags),
      now,
      now,
      "test",
    );
    return id;
  }

  // ─── handle() routing ───────────────────────────────────────────────

  describe("handle() routes the 3 new actions", () => {
    it("dispatches clone / export / import", async () => {
      const srcId = _seed();
      const c = await handler.handle(
        "clone",
        { workflowId: srcId, newName: "copy" },
        ctx,
      );
      expect(c.success).toBe(true);
      expect(typeof c.workflowId).toBe("string");

      const e = await handler.handle("export", { workflowId: srcId }, ctx);
      expect(e.success).toBe(true);
      expect(typeof e.definition).toBe("string");

      const i = await handler.handle(
        "import",
        { definition: e.definition, name: "imported" },
        ctx,
      );
      expect(i.success).toBe(true);
      expect(typeof i.workflowId).toBe("string");
    });

    it("still throws Unknown action for unrecognized methods", async () => {
      await expect(handler.handle("ghostMethod", {}, ctx)).rejects.toThrow(
        /Unknown action/,
      );
    });
  });

  // ─── clone ──────────────────────────────────────────────────────────

  describe("clone", () => {
    it("persists a new row with fresh id + provided newName, copying steps/tags/variables", async () => {
      const srcId = _seed({
        name: "orig",
        steps: [
          { id: "s1", action: "noop" },
          { id: "s2", action: "echo" },
        ],
        variables: { x: 1 },
        tags: ["a", "b"],
      });

      const r = await handler.cloneWorkflow(
        { workflowId: srcId, newName: "orig-copy" },
        ctx,
      );
      expect(r.success).toBe(true);
      expect(r.workflowId).not.toBe(srcId);

      const cloned = await handler.loadWorkflow(r.workflowId);
      expect(cloned).toBeTruthy();
      expect(cloned.name).toBe("orig-copy");
      expect(cloned.steps).toHaveLength(2);
      expect(cloned.variables).toEqual({ x: 1 });
      expect(cloned.tags).toEqual(["a", "b"]);
      // Tag array should be a copy, not a shared reference.
      const source = await handler.loadWorkflow(srcId);
      expect(cloned.tags).not.toBe(source.tags);
    });

    it("returns success:false with Workflow not found for an unknown id", async () => {
      const r = await handler.cloneWorkflow(
        { workflowId: "doesnotexist", newName: "x" },
        ctx,
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/Workflow not found/);
    });

    it("rejects missing workflowId / newName", async () => {
      expect(await handler.cloneWorkflow({ newName: "x" }, ctx)).toMatchObject({
        success: false,
        error: "workflowId required",
      });
      expect(
        await handler.cloneWorkflow({ workflowId: "x" }, ctx),
      ).toMatchObject({ success: false, error: "newName required" });
    });
  });

  // ─── export ─────────────────────────────────────────────────────────

  describe("export", () => {
    it("returns a JSON string round-trippable through JSON.parse", async () => {
      const id = _seed({
        name: "to-export",
        steps: [{ id: "s1", action: "noop" }],
        variables: { hello: "world" },
        tags: ["release"],
      });

      const r = await handler.exportWorkflow({ workflowId: id }, ctx);
      expect(r.success).toBe(true);
      expect(typeof r.definition).toBe("string");

      const parsed = JSON.parse(r.definition);
      expect(parsed.name).toBe("to-export");
      expect(parsed.steps).toEqual([{ id: "s1", action: "noop" }]);
      expect(parsed.variables).toEqual({ hello: "world" });
      expect(parsed.tags).toEqual(["release"]);
    });

    it("strips execution-history fields from export (portable shape only)", async () => {
      const id = _seed();
      const r = await handler.exportWorkflow({ workflowId: id }, ctx);
      const parsed = JSON.parse(r.definition);
      // The portable shape includes only: id, name, description, steps,
      // variables, rollback, tags. No execution rows / timestamps / counts.
      expect(Object.keys(parsed).sort()).toEqual([
        "description",
        "id",
        "name",
        "rollback",
        "steps",
        "tags",
        "variables",
      ]);
    });

    it("returns Workflow not found for unknown id", async () => {
      const r = await handler.exportWorkflow({ workflowId: "ghost" }, ctx);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/Workflow not found/);
    });

    it("rejects missing workflowId", async () => {
      const r = await handler.exportWorkflow({}, ctx);
      expect(r).toMatchObject({ success: false, error: "workflowId required" });
    });
  });

  // ─── import ─────────────────────────────────────────────────────────

  describe("import", () => {
    it("re-creates a workflow from a JSON definition with fresh id", async () => {
      const portable = {
        id: "old-id-ignored",
        name: "ported",
        description: "from elsewhere",
        steps: [{ id: "s1", action: "noop" }],
        variables: {},
        tags: ["imported"],
      };

      const r = await handler.importWorkflow(
        { definition: JSON.stringify(portable) },
        ctx,
      );
      expect(r.success).toBe(true);
      // Generated id, NOT the embedded "old-id-ignored"
      expect(r.workflowId).not.toBe("old-id-ignored");
      expect(r.workflowId).toMatch(/^wf-/);

      const loaded = await handler.loadWorkflow(r.workflowId);
      expect(loaded.name).toBe("ported");
      expect(loaded.steps).toEqual([{ id: "s1", action: "noop" }]);
    });

    it("optional name override replaces the embedded name", async () => {
      const portable = {
        name: "embedded-name",
        steps: [{ id: "s1", action: "noop" }],
      };
      const r = await handler.importWorkflow(
        { definition: JSON.stringify(portable), name: "override-name" },
        ctx,
      );
      expect(r.success).toBe(true);
      const loaded = await handler.loadWorkflow(r.workflowId);
      expect(loaded.name).toBe("override-name");
    });

    it("falls back to 'Imported workflow' when neither name nor parsed.name given", async () => {
      const portable = { steps: [{ id: "s1", action: "noop" }] };
      const r = await handler.importWorkflow(
        { definition: JSON.stringify(portable) },
        ctx,
      );
      expect(r.success).toBe(true);
      const loaded = await handler.loadWorkflow(r.workflowId);
      expect(loaded.name).toBe("Imported workflow");
    });

    it("rejects INVALID_JSON when definition is not parseable", async () => {
      const r = await handler.importWorkflow({ definition: "{ not json" }, ctx);
      expect(r).toMatchObject({ success: false, error: "INVALID_JSON" });
    });

    it("rejects INVALID_DEFINITION when parsed object lacks steps array", async () => {
      const r = await handler.importWorkflow(
        { definition: JSON.stringify({ name: "x" }) }, // no steps
        ctx,
      );
      expect(r).toMatchObject({ success: false, error: "INVALID_DEFINITION" });
    });

    it("rejects when engine.validateWorkflow flags steps as invalid", async () => {
      const r = await handler.importWorkflow(
        {
          definition: JSON.stringify({
            steps: [{ id: "s1" /* missing action */ }],
          }),
        },
        ctx,
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/missing action/);
    });

    it("rejects missing definition", async () => {
      const r = await handler.importWorkflow({}, ctx);
      expect(r).toMatchObject({ success: false, error: "definition required" });
    });
  });

  // ─── round-trip: clone → export → import (smoke) ────────────────────

  describe("round-trip", () => {
    it("clone then export then import yields a 3rd workflow with same step shape", async () => {
      const original = _seed({
        name: "rt",
        steps: [
          { id: "a", action: "step1" },
          { id: "b", action: "step2" },
        ],
      });
      const cloneR = await handler.cloneWorkflow(
        { workflowId: original, newName: "rt-clone" },
        ctx,
      );
      const exportR = await handler.exportWorkflow(
        { workflowId: cloneR.workflowId },
        ctx,
      );
      const importR = await handler.importWorkflow(
        { definition: exportR.definition, name: "rt-imported" },
        ctx,
      );
      expect(importR.success).toBe(true);

      const imported = await handler.loadWorkflow(importR.workflowId);
      expect(imported.name).toBe("rt-imported");
      expect(imported.steps).toEqual([
        { id: "a", action: "step1" },
        { id: "b", action: "step2" },
      ]);
      // All 3 are distinct rows on disk.
      const count = db.prepare("SELECT COUNT(*) as c FROM workflows").get().c;
      expect(count).toBe(3);
    });
  });
});
