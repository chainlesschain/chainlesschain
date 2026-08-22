import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openCliVault,
  CliVaultDbManager,
  CLI_VAULT_SCHEMA,
  _deps,
  _setCcDirForTest,
  _resetCcDirForTest,
  _resetDepsForTest,
  _vaultPath,
} from "../../src/lib/sync-cli-db.js";

function useFixtureFilesystem() {
  // ACL repair is covered by secure-fs' dedicated platform tests. This suite
  // exercises driver selection and durable SQLite semantics, so avoid a
  // PowerShell ACL process for every temporary sql.js snapshot on Windows.
  _deps.ensureDir = (directory) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  };
  _deps.ensurePrivateFile = (target) => target;
}

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

  it("uses CLAUDE_CONFIG_DIR when no test/native root is supplied", () => {
    const originalNative = process.env.CHAINLESSCHAIN_HOME;
    const originalClaude = process.env.CLAUDE_CONFIG_DIR;
    try {
      _resetCcDirForTest();
      delete process.env.CHAINLESSCHAIN_HOME;
      process.env.CLAUDE_CONFIG_DIR = join("C:\\", "cc-cli-vault-root");
      expect(_vaultPath()).toBe(
        join("C:\\", "cc-cli-vault-root", "cli-vault.db"),
      );
    } finally {
      if (originalNative === undefined) delete process.env.CHAINLESSCHAIN_HOME;
      else process.env.CHAINLESSCHAIN_HOME = originalNative;
      if (originalClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = originalClaude;
    }
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

describe("sync-cli-db — openCliVault sql.js fallback", () => {
  let dir;
  let handle;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-cli-vault-"));
    _setCcDirForTest(dir);
    useFixtureFilesystem();
    _deps.loadNativeDatabase = async () => {
      throw new Error("forced native binding failure");
    };
  });
  afterEach(() => {
    if (handle) {
      handle.dbManager.close();
      handle = null;
    }
    _resetDepsForTest();
    _resetCcDirForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the vault file under the overridden dir and initializes the schema", async () => {
    handle = await openCliVault();
    expect(handle.backend).toBe("sql.js");
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

  it("persists sql.js writes across a close and reopen", async () => {
    handle = await openCliVault();
    handle.dbManager.run(
      "INSERT INTO knowledge_items (id,title,type,created_at,updated_at) VALUES (?,?,?,?,?)",
      ["persisted", "Persisted", "note", 1, 2],
    );
    handle.dbManager.close();
    handle = await openCliVault();

    expect(
      handle.dbManager.get("SELECT title FROM knowledge_items WHERE id=?", [
        "persisted",
      ]),
    ).toEqual({ title: "Persisted" });
  });

  it("reloads the latest bytes per locked operation so two fallback handles do not lose writes", async () => {
    const first = await openCliVault();
    const second = await openCliVault();
    try {
      first.dbManager.run(
        "INSERT INTO knowledge_items (id,title,type,created_at,updated_at) VALUES (?,?,?,?,?)",
        ["first", "First", "note", 1, 1],
      );
      second.dbManager.run(
        "INSERT INTO knowledge_items (id,title,type,created_at,updated_at) VALUES (?,?,?,?,?)",
        ["second", "Second", "note", 2, 2],
      );

      expect(
        first.dbManager.all("SELECT id FROM knowledge_items ORDER BY id", []),
      ).toEqual([{ id: "first" }, { id: "second" }]);
    } finally {
      first.dbManager.close();
      second.dbManager.close();
    }
  });

  it("fails closed instead of reading a vault with an active native SQLite journal", async () => {
    writeFileSync(join(dir, "cli-vault.db-wal"), "native writer active", {
      mode: 0o600,
    });

    await expect(openCliVault()).rejects.toMatchObject({
      code: "CLI_VAULT_WASM_NATIVE_CONCURRENCY_UNSAFE",
    });
  });
});

describe("sync-cli-db — driver selection", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-cli-vault-driver-"));
    _setCcDirForTest(dir);
    useFixtureFilesystem();
  });

  afterEach(() => {
    _resetDepsForTest();
    _resetCcDirForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers a loadable native database over sql.js", async () => {
    const opened = [];
    class FakeDatabase {
      constructor(filename) {
        this.filename = filename;
        this.open = true;
        opened.push(filename);
      }

      exec() {}

      close() {
        this.open = false;
      }
    }
    _deps.loadNativeDatabase = async () => FakeDatabase;
    _deps.loadSqlJs = async () => {
      throw new Error("sql.js must not be loaded when native is available");
    };

    const result = await openCliVault();
    try {
      expect(result.backend).toBe("better-sqlite3");
      expect(opened).toEqual([":memory:", join(dir, "cli-vault.db")]);
    } finally {
      result.dbManager.close();
    }
  });

  it("reports a stable error if both native and sql.js are unavailable", async () => {
    _deps.loadNativeDatabase = async () => {
      throw new Error("native binding unavailable");
    };
    _deps.loadSqlJs = async () => {
      throw new Error("wasm asset unavailable");
    };

    await expect(openCliVault()).rejects.toMatchObject({
      code: "CLI_VAULT_SQLJS_UNAVAILABLE",
    });
  });
});
