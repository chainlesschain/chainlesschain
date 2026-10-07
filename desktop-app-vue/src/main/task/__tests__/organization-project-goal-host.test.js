import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  createOrganizationProjectGoalController,
} = require("../organization-project-goal-host");
const {
  organizationProjectFixture,
} = require("./fixtures/organization-project-host-fixture.cjs");
function createDb(file) {
  const seed = organizationProjectFixture(async () => ({ response: 1 }));
  try {
    writeFileSync(file, seed.db.serialize());
  } finally {
    seed.db.close();
  }
  return new Database(file);
}

describe("organization goal native controller storage and lifecycle", () => {
  let directory, db, controller, options;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-goal-host-"));
    db = createDb(join(directory, "project.sqlite"));
    options = {
      database: { getDatabase: () => db },
      electron: { app: { getPath: vi.fn(() => join(directory, "app-data")) } },
      getCurrentUserDid: () => "did:owner",
      clock: () => 1000,
      protectDirectory: vi.fn((path) => {
        mkdirSync(path, { recursive: true });
        return path;
      }),
      protectFile: vi.fn((path) => path),
    };
    controller = createOrganizationProjectGoalController(options);
  });
  afterEach(async () => {
    await controller?.close();
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it("uses independent protected organization storage and starts one background loop", async () => {
    const timer = vi.spyOn(globalThis, "setInterval");
    try {
      const engine = await controller.initialize();
      expect(
        relative(
          join(directory, "app-data", "organization-goal-monitoring"),
          engine.store.file,
        ),
      ).toMatch(/^[a-f0-9]{64}[\\/]scheduler\.sqlite$/);
      expect(engine.store.db).not.toBe(db);
      expect(engine.store.db.constructor).toBe(Database);
      expect(existsSync(engine.store.file)).toBe(true);
      expect(options.protectDirectory).toHaveBeenCalledTimes(2);
      expect(options.protectFile.mock.calls.map(([path]) => path)).toEqual(
        expect.arrayContaining([
          engine.store.file,
          `${engine.store.file}-wal`,
          `${engine.store.file}-shm`,
        ]),
      );
      expect(timer).toHaveBeenCalledTimes(1);
      expect(await controller.initialize()).toBe(engine);
      expect(timer).toHaveBeenCalledTimes(1);
    } finally {
      timer.mockRestore();
    }
  });
  it("closes and rotates scheduler storage when the project database changes", async () => {
    const old = await controller.initialize();
    const previous = db;
    db = createDb(join(directory, "replacement.sqlite"));
    try {
      const next = await controller.initialize();
      expect(next).not.toBe(old);
      expect(next.store.file).not.toBe(old.store.file);
      expect(old.store.closed).toBe(true);
      expect(previous.open).toBe(true);
    } finally {
      previous.close();
    }
  });
  it("shares shutdown and closes the scheduler without closing the project database", async () => {
    const engine = await controller.initialize();
    const closing = controller.close();
    expect(controller.close()).toBe(closing);
    await closing;
    expect(engine.store.closed).toBe(true);
    expect(db.open).toBe(true);
    expect(() => controller.initialize()).toThrow("GOAL_MONITOR_HOST_CLOSED");
  });
  it("rejects an in-memory project database before opening storage", async () => {
    db.close();
    db = new Database(":memory:");
    await expect(controller.initialize()).rejects.toThrow(
      "GOAL_MONITOR_DATABASE_PATH_REQUIRED",
    );
    expect(options.protectDirectory).not.toHaveBeenCalled();
  });
  it("rejects non-native database wrappers", async () => {
    await controller.close();
    controller = createOrganizationProjectGoalController({
      ...options,
      database: { prepare() {}, exec() {} },
    });
    await expect(controller.initialize()).rejects.toThrow(
      "GOAL_NATIVE_DATABASE_REQUIRED",
    );
  });
  it.each([false, undefined, Promise.resolve("later")])(
    "rejects unconfirmed directory protection: %s",
    async (result) => {
      await controller.close();
      controller = createOrganizationProjectGoalController({
        ...options,
        protectDirectory: () => result,
      });
      await expect(controller.initialize()).rejects.toThrow();
      expect(
        existsSync(join(directory, "app-data", "organization-goal-monitoring")),
      ).toBe(false);
    },
  );
  it("rejects failed file ACL protection", async () => {
    await controller.close();
    controller = createOrganizationProjectGoalController({
      ...options,
      protectFile: () => false,
    });
    await expect(controller.initialize()).rejects.toThrow();
    expect(db.open).toBe(true);
  });
});
