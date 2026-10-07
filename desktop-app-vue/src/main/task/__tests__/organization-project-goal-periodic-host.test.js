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
  organizationProjectFixture,
} = require("./fixtures/organization-project-host-fixture.cjs");
const {
  createOrganizationProjectGoalController,
} = require("../organization-project-goal-host");
function createDb(file) {
  const seed = organizationProjectFixture(async () => ({ response: 1 }));
  try {
    writeFileSync(file, seed.db.serialize());
  } finally {
    seed.db.close();
  }
  return new Database(file);
}
describe("organization periodic goal production native controller", () => {
  let directory, db, controller, options, now;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-periodic-host-"));
    now = 1000;
    db = createDb(join(directory, "project.sqlite"));
    options = {
      database: { getDatabase: () => db },
      electron: { app: { getPath: () => join(directory, "app-data") } },
      getCurrentUserDid: () => "did:owner",
      getAuthenticationGeneration: () => 1,
      clock: () => now,
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
  it("starts exactly one background loop on protected independent organization storage", async () => {
    const engine = await controller.initialize();
    expect(engine.backgroundTimer).not.toBeNull();
    const timer = engine.backgroundTimer;
    expect(await controller.initialize()).toBe(engine);
    expect(engine.backgroundTimer).toBe(timer);
    expect(
      relative(
        join(directory, "app-data", "organization-goal-monitoring"),
        engine.store.file,
      ),
    ).toMatch(/^[a-f0-9]{64}[\\/]scheduler\.sqlite$/);
    expect(engine.store.db).not.toBe(db);
    expect(options.protectFile.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        engine.store.file,
        `${engine.store.file}-wal`,
        `${engine.store.file}-shm`,
      ]),
    );
  });
  it("stops the old background engine before replacing its database connection", async () => {
    const old = await controller.initialize(),
      previous = db;
    db = createDb(join(directory, "replacement.sqlite"));
    try {
      const fresh = await controller.initialize();
      expect(fresh).not.toBe(old);
      expect(old.backgroundTimer).toBeNull();
      expect(old.store.closed).toBe(true);
      expect(fresh.backgroundTimer).not.toBeNull();
      expect(previous.open).toBe(true);
    } finally {
      previous.close();
    }
  });
  it("drains background work and closes only its scheduler on shared shutdown", async () => {
    const engine = await controller.initialize(),
      closing = controller.close();
    expect(controller.close()).toBe(closing);
    await closing;
    expect(engine.backgroundTimer).toBeNull();
    expect(engine.store.closed).toBe(true);
    expect(db.open).toBe(true);
    expect(() => controller.initialize()).toThrow("GOAL_MONITOR_HOST_CLOSED");
  });
  it("refuses background activation when directory protection fails", async () => {
    await controller.close();
    controller = createOrganizationProjectGoalController({
      ...options,
      protectDirectory: () => false,
    });
    await expect(controller.initialize()).rejects.toThrow();
    expect(
      existsSync(join(directory, "app-data", "organization-goal-monitoring")),
    ).toBe(false);
  });
  it("restores bounded same-identity consent from native storage after controller restart", async () => {
    const dialog = vi.fn(async () => ({ response: 1 }));
    const f = organizationProjectFixture(dialog, {
      database: options.database,
      goalMonitoringController: {
        initialize: () => controller.initialize(),
        close: () => controller.close(),
      },
    });
    try {
      const { permissions, workflowIds } = await f.setup();
      for (const grant of permissions)
        grant.permissions.push(
          "goal.read",
          "goal.create",
          "goal.check",
          "goal.monitor",
          "risk.read",
          "risk.evaluate",
        );
      const policy = { orgId: "org1", permissions, workflowIds };
      await f.host.attestPolicy(f.event, {
        ...policy,
        expectedDigest: f.host.previewPolicy(f.event, policy).digest,
      });
      const { goal } = await f.host.createGoal(f.event, {
        projectId: "p1",
        requestId: "persistent-goal",
        objective: "Check bounded consent",
        budgetPolicy: { maxRuns: 5 },
      });
      const { monitor } = await f.host.startGoalMonitoring(f.event, {
        id: goal.id,
        expectedRevision: 1,
        requestId: "persistent-consent",
        intervalMs: 60_000,
        expiresAt: 3600_000,
      });
      const old = await controller.initialize();
      const file = old.store.file;
      await controller.close();
      controller = createOrganizationProjectGoalController(options);
      now = 61_000;
      f.setNow(now);
      const fresh = await controller.initialize();
      await fresh.tick();
      expect(fresh.store.file).toBe(file);
      expect(fresh.status({ id: goal.id })).toMatchObject({
        usage: { checks: 1 },
        monitor: {
          id: monitor.id,
          enabled: true,
          executorDid: f.identities.owner,
        },
      });
      await fresh.tick();
      expect(fresh.status({ id: goal.id }).usage.checks).toBe(1);
    } finally {
      f.db.close();
    }
  });
});
