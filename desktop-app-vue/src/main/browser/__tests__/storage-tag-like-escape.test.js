/**
 * WorkflowStorage.listWorkflows and RecordingStorage.listRecordings filter by
 * tag with `tags LIKE '%"${tag}"%'`, built with no escaping and (originally) no
 * `ESCAPE` clause. Tags routinely contain underscores (e.g. "machine_learning"),
 * and `_` is LIKE's single-character wildcard, so filtering by tag "a_b" also
 * returned rows tagged "axb" / "a-b" — wrong results silently. Both files
 * already escape their free-text `search` filter via SqlSecurity; the tag branch
 * was a missed site. Fix escapes each tag and adds `ESCAPE '\'`.
 *
 * Drives the real SQLCipher wrapper on in-memory better-sqlite3.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
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

const { SQLCipherWrapper } = require("../../database/sqlcipher-wrapper");
const { WorkflowStorage } = require("../workflow/workflow-storage");
const { RecordingStorage } = require("../recording/recording-storage");

const describeIf = hasSqlite ? describe : describe.skip;

describeIf("Storage tag filters escape LIKE wildcards", () => {
  let wrapper;

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
      CREATE TABLE browser_recordings (
        id TEXT PRIMARY KEY, name TEXT, description TEXT, url TEXT,
        events TEXT, screenshots TEXT, duration INTEGER, event_count INTEGER,
        tags TEXT, workflow_id TEXT, recording_options TEXT,
        created_at INTEGER, updated_at INTEGER);
    `);
  });

  afterEach(() => {
    try {
      wrapper.db.close();
    } catch {
      /* ignore */
    }
  });

  it("listWorkflows does not match a tag whose underscore is a wildcard", async () => {
    const storage = new WorkflowStorage(wrapper);
    await storage.createWorkflow({ id: "wf-und", name: "A", tags: ["a_b"] });
    await storage.createWorkflow({ id: "wf-dec", name: "B", tags: ["axb"] });

    const result = await storage.listWorkflows({ tags: ["a_b"] });
    const ids = result.map((w) => w.id);
    expect(ids).toContain("wf-und");
    expect(ids).not.toContain("wf-dec");
  });

  it("listRecordings does not match a tag whose underscore is a wildcard", async () => {
    const storage = new RecordingStorage(wrapper);
    await storage.saveRecording({
      id: "rec-und",
      name: "A",
      url: "http://x",
      tags: ["a_b"],
    });
    await storage.saveRecording({
      id: "rec-dec",
      name: "B",
      url: "http://y",
      tags: ["axb"],
    });

    const result = await storage.listRecordings({ tags: ["a_b"] });
    const ids = result.map((r) => r.id);
    expect(ids).toContain("rec-und");
    expect(ids).not.toContain("rec-dec");
  });
});
