// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildPmDurableEntrypoint,
  readPmDurableDatabaseDiagnostics,
} from "../../../../tests/e2e/helpers";

const require = createRequire(import.meta.url);
const storage = require("../../../src/main/task/board-action-storage.js");

function launchProfile({ file = "/profile/data/chainlesschain.db", env } = {}) {
  const mainPath = path.resolve("desktop-dist/main/index.js");
  const db = {
    transaction: vi.fn(),
    prepare: vi.fn((sql) => ({
      all: () => [{ name: "main", file }],
      get: () => ({
        journal_mode: "wal",
        synchronous: 2,
        foreign_keys: 1,
      }),
    })),
  };
  class DatabaseManager {
    initializeWithBetterSQLite() {}
  }
  const manager = { getDatabase: () => db };
  const getDatabase = vi.fn(() => manager);
  const assertStorage = vi.fn(storage.assertStorage);
  const app = { setAppPath: vi.fn(), getPath: () => "/profile" };
  const context = vm.createContext({
    process: {
      env: env ?? { NODE_ENV: "test", CC_PM_E2E_DURABLE_SQLITE: "1" },
    },
    require: (module) => {
      if (module === "electron") return { app };
      if (module === path.join(path.dirname(mainPath), "database.js"))
        return { DatabaseManager, getDatabase };
      if (module.endsWith("board-action-storage.js"))
        return { ...storage, assertStorage };
      if (module === mainPath) return {};
      throw new Error(`Unexpected module: ${module}`);
    },
  });
  vm.runInContext(buildPmDurableEntrypoint(mainPath), context);
  // Match Playwright's evaluation boundary: no ambient CommonJS loader.
  delete context.require;
  const read = () =>
    vm.runInContext(
      `(${readPmDurableDatabaseDiagnostics.toString()})()`,
      context,
    );
  return { read, getDatabase, assertStorage, manager, db };
}

describe("PM durable profile diagnostics", () => {
  it("checks the live database after startup without require in evaluate", () => {
    const profile = launchProfile();
    expect(profile.getDatabase).not.toHaveBeenCalled();
    expect(profile.assertStorage).not.toHaveBeenCalled();
    expect(profile.read()).toMatchObject({
      file: "/profile/data/chainlesschain.db",
      userDataPath: "/profile",
      journalMode: "wal",
      synchronous: 2,
      foreignKeys: 1,
    });
    expect(profile.assertStorage).toHaveBeenCalledWith(
      profile.manager,
      profile.db,
    );
  });

  it("propagates the production storage gate failure", () => {
    const profile = launchProfile({ file: "" });
    expect(profile.read).toThrow("BOARD_ACTION_DURABLE_SQLITE_REQUIRED");
  });

  it.each([{ NODE_ENV: "production" }, { NODE_ENV: "test" }])(
    "rejects an entrypoint without the test-only environment: %j",
    (env) => {
      expect(() => launchProfile({ env })).toThrow(
        "requires its test-only environment",
      );
    },
  );

  it("fails closed when the durable entrypoint was not loaded", () => {
    expect(() =>
      vm.runInNewContext(`(${readPmDurableDatabaseDiagnostics.toString()})()`),
    ).toThrow("diagnostics entrypoint is unavailable");
  });
});
