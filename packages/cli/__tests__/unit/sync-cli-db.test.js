import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openCliVault,
  CliVaultDbManager,
  CLI_VAULT_SCHEMA,
  _setCcDirForTest,
  _resetCcDirForTest,
  _vaultPath,
} from "../../src/lib/sync-cli-db.js";

describe("sync-cli-db — CLI_VAULT_SCHEMA", () => {
  it("declares the three sync tables and the tombstone trigger", () => {
    expect(CLI_VAULT_SCHEMA).toContain(
      "CREATE TABLE IF NOT EXISTS knowledge_items",
    );
    expect(CLI_VAULT_SCHEMA).toContain(
      "CREATE TABLE IF NOT EXISTS sync_external_provider_cursor",
    );
    expect(CLI_VAULT_SCHEMA).toContain(
      "CREATE TABLE IF NOT EXISTS sync_external_tombstones",
    );
    expect(CLI_VAULT_SCHEMA).toContain(
      "CREATE TRIGGER IF NOT EXISTS trg_sync_ext_tombstone_on_delete",
    );
  });
});

describe("sync-cli-db — _vaultPath resolution", () => {
  afterEach(() => _resetCcDirForTest());

  it("honours the test override", () => {
    _setCcDirForTest(join("X:", "fake-home"));
    expect(_vaultPath()).toBe(join("X:", "fake-home", "cli-vault.db"));
  });

  it("always ends with cli-vault.db", () => {
    _resetCcDirForTest();
    expect(_vaultPath().endsWith("cli-vault.db")).toBe(true);
  });
});

describe("sync-cli-db — CliVaultDbManager (delegation)", () => {
  function fakeDb() {
    const calls = [];
    return {
      open: true,
      calls,
      prepare(sql) {
        return {
          run: (...p) => {
            calls.push(["run", sql, p]);
            return { changes: 1 };
          },
          get: (...p) => {
            calls.push(["get", sql, p]);
            return sql === "MISS" ? null : { x: 1 };
          },
          all: (...p) => {
            calls.push(["all", sql, p]);
            return [{ x: 1 }];
          },
        };
      },
      close() {
        calls.push(["close"]);
        this.open = false;
      },
    };
  }

  it("run prepares the sql and spreads params", () => {
    const db = fakeDb();
    new CliVaultDbManager(db).run("INSERT INTO t VALUES (?,?)", [1, 2]);
    expect(db.calls).toContainEqual([
      "run",
      "INSERT INTO t VALUES (?,?)",
      [1, 2],
    ]);
  });

  it("get returns the row, or undefined when the row is null", () => {
    expect(new CliVaultDbManager(fakeDb()).get("SELECT 1", [])).toEqual({
      x: 1,
    });
    expect(new CliVaultDbManager(fakeDb()).get("MISS", [])).toBeUndefined();
  });

  it("all returns the row list", () => {
    expect(new CliVaultDbManager(fakeDb()).all("SELECT *", [])).toEqual([
      { x: 1 },
    ]);
  });

  it("defaults params to an empty array", () => {
    const db = fakeDb();
    new CliVaultDbManager(db).run("PRAGMA x");
    expect(db.calls).toContainEqual(["run", "PRAGMA x", []]);
  });

  it("close closes only when the db is open", () => {
    const open = fakeDb();
    new CliVaultDbManager(open).close();
    expect(open.calls).toContainEqual(["close"]);

    const closed = fakeDb();
    closed.open = false;
    new CliVaultDbManager(closed).close();
    expect(closed.calls).not.toContainEqual(["close"]);
  });
});

describe("sync-cli-db — openCliVault (real better-sqlite3)", () => {
  let dir;
  let handle;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-cli-vault-"));
    _setCcDirForTest(dir);
  });
  afterEach(() => {
    if (handle) {
      handle.dbManager.close();
      handle = null;
    }
    _resetCcDirForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the vault file under the overridden dir and initializes the schema", async () => {
    handle = await openCliVault();
    expect(handle.vaultPath).toBe(join(dir, "cli-vault.db"));
    expect(existsSync(handle.vaultPath)).toBe(true);
    // The three tables exist.
    const tables = handle.dbManager
      .all(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        [],
      )
      .map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "knowledge_items",
        "sync_external_provider_cursor",
        "sync_external_tombstones",
      ]),
    );
  });

  it("round-trips a knowledge_item", async () => {
    handle = await openCliVault();
    const { dbManager } = handle;
    dbManager.run(
      "INSERT INTO knowledge_items (id,title,type,content,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ["k1", "T", "note", "body", "", 1, 2],
    );
    expect(
      dbManager.get("SELECT title FROM knowledge_items WHERE id=?", ["k1"]),
    ).toEqual({ title: "T" });
  });

  it("the on-delete trigger fans out a tombstone per provider cursor", async () => {
    handle = await openCliVault();
    const { dbManager } = handle;
    dbManager.run(
      "INSERT INTO sync_external_provider_cursor (provider_id, account_key) VALUES (?,?)",
      ["webdav", ""],
    );
    dbManager.run(
      "INSERT INTO knowledge_items (id,title,type,created_at,updated_at) VALUES (?,?,?,?,?)",
      ["k1", "T", "note", 1, 2],
    );
    dbManager.run("DELETE FROM knowledge_items WHERE id=?", ["k1"]);
    const ts = dbManager.all(
      "SELECT item_id, resource_type, provider_id FROM sync_external_tombstones",
      [],
    );
    expect(ts).toEqual([
      { item_id: "k1", resource_type: "KNOWLEDGE_ITEM", provider_id: "webdav" },
    ]);
  });

  it("creates no tombstone when there is no provider cursor", async () => {
    handle = await openCliVault();
    const { dbManager } = handle;
    dbManager.run(
      "INSERT INTO knowledge_items (id,title,type,created_at,updated_at) VALUES (?,?,?,?,?)",
      ["k2", "T", "note", 1, 2],
    );
    dbManager.run("DELETE FROM knowledge_items WHERE id=?", ["k2"]);
    expect(
      dbManager.get("SELECT COUNT(*) AS c FROM sync_external_tombstones", []),
    ).toEqual({ c: 0 });
  });
});
