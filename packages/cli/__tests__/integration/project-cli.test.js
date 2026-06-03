/**
 * v1.3+ #21 P1 — `cc project` CLI integration tests.
 *
 * 走 subprocess 跑 bin/chainlesschain.js + 临时 SQLite (better-sqlite3)，
 * 验证 init / list / show / delete 端到端 + error path。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const requireCjs = createRequire(import.meta.url);
const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

const PROJECTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    project_type TEXT NOT NULL CHECK(project_type IN (
      'web', 'document', 'data', 'app', 'presentation',
      'spreadsheet', 'design', 'code', 'workflow', 'knowledge'
    )),
    status TEXT DEFAULT 'active' CHECK(status IN (
      'draft', 'active', 'completed', 'archived'
    )),
    root_path TEXT,
    file_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    template_id TEXT,
    cover_image_url TEXT,
    tags TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN (
      'synced', 'pending', 'conflict', 'error'
    )),
    synced_at INTEGER,
    device_id TEXT,
    deleted INTEGER DEFAULT 0,
    category_id TEXT,
    delivered_at TEXT
  );
`;

async function initDb(dbPath) {
  // CLI package's node_modules only ships sql.js (WASM); native better-sqlite3
  // isn't an install dep here. Use sql.js so the test writes a clean schema
  // that the CLI subprocess (also via sql.js fallback) can read.
  const initSqlJs = requireCjs("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(PROJECTS_SCHEMA);
  const buf = db.export();
  fs.writeFileSync(dbPath, Buffer.from(buf));
  db.close();
}

function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let s = 0; s < lines.length; s++) {
    const t = lines[s].trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      for (let e = lines.length; e > s; e--) {
        try {
          return JSON.parse(lines.slice(s, e).join("\n"));
        } catch (_err) {
          /* try shorter */
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 400)}`);
}

describe("cc project — CLI integration (#21 P1)", () => {
  let tmpDir;
  let dbPath;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-project-cli-"));
    dbPath = path.join(tmpDir, "chainlesschain.db");
    await initDb(dbPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init creates a project + list returns it + show returns full row", () => {
    // init
    const init = runCli([
      "project",
      "init",
      "测试项目",
      "--description",
      "smoke test project",
      "--type",
      "document",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(init.status, init.stderr || init.stdout).toBe(0);
    const created = extractJson(init.stdout);
    expect(created.name).toBe("测试项目");
    expect(created.project_type).toBe("document");
    expect(created.status).toBe("active");
    expect(created.deleted).toBe(0);
    expect(created.id).toBeTruthy();

    // list
    const list = runCli(["project", "list", "--db", dbPath, "--json"]);
    expect(list.status).toBe(0);
    const listed = extractJson(list.stdout);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    // show
    const show = runCli([
      "project",
      "show",
      created.id,
      "--db",
      dbPath,
      "--json",
    ]);
    expect(show.status).toBe(0);
    const shown = extractJson(show.stdout);
    expect(shown.id).toBe(created.id);
    expect(shown.description).toBe("smoke test project");
  });

  it("init rejects invalid project_type with exit 2", () => {
    const r = runCli([
      "project",
      "init",
      "bad",
      "--type",
      "not-a-type",
      "--db",
      dbPath,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Invalid type");
  });

  it("show returns exit 2 + clear message for unknown id", () => {
    const r = runCli(["project", "show", "no-such-id", "--db", dbPath]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Project not found");
  });

  it("delete soft-deletes by default + list hides the row", () => {
    const init = runCli([
      "project",
      "init",
      "ToDelete",
      "--db",
      dbPath,
      "--json",
    ]);
    const created = extractJson(init.stdout);

    const del = runCli([
      "project",
      "delete",
      created.id,
      "--db",
      dbPath,
      "--json",
    ]);
    expect(del.status).toBe(0);
    const r = extractJson(del.stdout);
    expect(r).toMatchObject({ ok: true, id: created.id, hard: false });

    // list should not include the soft-deleted project (deleted = 0 filter)
    const list = runCli(["project", "list", "--db", dbPath, "--json"]);
    const listed = extractJson(list.stdout);
    expect(listed).toEqual([]);
  });

  it("delete --hard removes the row entirely", () => {
    const init = runCli([
      "project",
      "init",
      "HardDel",
      "--db",
      dbPath,
      "--json",
    ]);
    const created = extractJson(init.stdout);

    const del = runCli([
      "project",
      "delete",
      created.id,
      "--hard",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(del.status).toBe(0);

    // show should now fail (row gone)
    const show = runCli(["project", "show", created.id, "--db", dbPath]);
    expect(show.status).toBe(2);
  });

  it("list applies --status filter", () => {
    runCli(["project", "init", "A", "--db", dbPath, "--json"]);
    runCli(["project", "init", "B", "--db", dbPath, "--json"]);

    const all = runCli(["project", "list", "--db", dbPath, "--json"]);
    expect(extractJson(all.stdout)).toHaveLength(2);

    // archived → should be empty since all defaults to active
    const arch = runCli([
      "project",
      "list",
      "--status",
      "archived",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(extractJson(arch.stdout)).toEqual([]);
  });

  it("init --json output shape stable", () => {
    const r = runCli([
      "project",
      "init",
      "ShapeTest",
      "--type",
      "code",
      "--user",
      "did:cc:custom",
      "--root",
      "/tmp/proj-root",
      "--db",
      dbPath,
      "--json",
    ]);
    const p = extractJson(r.stdout);
    expect(p).toMatchObject({
      name: "ShapeTest",
      project_type: "code",
      user_id: "did:cc:custom",
      root_path: "/tmp/proj-root",
      status: "active",
      sync_status: "pending",
      deleted: 0,
    });
    expect(typeof p.created_at).toBe("number");
    expect(typeof p.updated_at).toBe("number");
  });
});
