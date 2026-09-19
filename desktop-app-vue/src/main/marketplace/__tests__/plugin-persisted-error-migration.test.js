// @vitest-environment node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PluginRegistry = require("../../plugins/plugin-registry.js");
const PluginInstallerModule = await import("../plugin-installer.js");
const PluginInstaller = PluginInstallerModule.default || PluginInstallerModule;

const cleanupPaths = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  );
});

function createRegistryAdapter(database) {
  return {
    exec: (sql) => database.exec(sql),
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        run: (...params) => statement.run(...params),
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        free: () => {},
      };
    },
  };
}

function createAsyncAdapter(database) {
  return {
    run: async (sql, params = []) => database.prepare(sql).run(...params),
    get: async (sql, params = []) => database.prepare(sql).get(...params),
    all: async (sql, params = []) => database.prepare(sql).all(...params),
  };
}

describe("legacy plugin error migration", () => {
  it("rewrites registry error columns in a real SQLite database", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE system_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          type TEXT,
          updated_at INTEGER
        )
      `);
      const migration = await fs.readFile(
        path.resolve(
          process.cwd(),
          "src/main/database/migrations/001_plugin_system.sql",
        ),
        "utf8",
      );
      database.exec(migration);
      database
        .prepare(
          `INSERT INTO plugins
           (id, name, version, path, manifest, installed_at, updated_at, last_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "plugin-1",
          "Plugin",
          "1.0.0",
          "C:/plugins/plugin-1",
          "{}",
          1,
          1,
          "legacy-registry-secret",
        );
      database
        .prepare(
          `INSERT INTO plugin_event_logs
           (plugin_id, event_type, event_data, level, created_at)
           VALUES (?, 'error', ?, 'error', ?)`,
        )
        .run("plugin-1", '{"error":"legacy-event-secret"}', 1);

      const registry = new PluginRegistry({
        db: createRegistryAdapter(database),
      });
      await registry.initialize();

      expect(
        database
          .prepare("SELECT last_error FROM plugins WHERE id = ?")
          .get("plugin-1").last_error,
      ).toBe("Plugin operation failed");
      expect(
        JSON.parse(
          database
            .prepare(
              "SELECT event_data FROM plugin_event_logs WHERE plugin_id = ?",
            )
            .get("plugin-1").event_data,
        ),
      ).toEqual({
        error: "Plugin operation failed",
        code: "PLUGIN_OPERATION_FAILED",
      });
    } finally {
      database.close();
    }
  });

  it("rewrites marketplace history and keeps readback redacted", async () => {
    const database = new Database(":memory:");
    const pluginsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "plugin-error-migration-"),
    );
    cleanupPaths.push(pluginsDir);

    try {
      database.exec(`
        CREATE TABLE plugin_update_history (
          id TEXT PRIMARY KEY,
          plugin_id TEXT NOT NULL,
          from_version TEXT NOT NULL,
          to_version TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          success INTEGER DEFAULT 0,
          error_message TEXT DEFAULT NULL
        );
        INSERT INTO plugin_update_history
          (id, plugin_id, from_version, to_version, updated_at, success, error_message)
        VALUES
          ('history-1', 'plugin-1', '1.0.0', '2.0.0', 1, 0, 'legacy-history-secret');
      `);
      const installer = new PluginInstaller({
        database: createAsyncAdapter(database),
        marketplaceClient: {},
        pluginsDir,
      });

      await expect(installer.initialize()).resolves.toEqual({ success: true });
      expect(
        database
          .prepare(
            "SELECT error_message FROM plugin_update_history WHERE id = ?",
          )
          .get("history-1").error_message,
      ).toBe("Plugin marketplace operation failed");

      database
        .prepare(
          `UPDATE plugin_update_history
           SET error_message = ?
           WHERE id = ?`,
        )
        .run("post-initialize-secret", "history-1");
      const result = await installer.getUpdateHistory("plugin-1");
      expect(result.data[0].error_message).toBe(
        "Plugin marketplace operation failed",
      );
      expect(JSON.stringify(result)).not.toContain("post-initialize-secret");
    } finally {
      database.close();
    }
  });
});
