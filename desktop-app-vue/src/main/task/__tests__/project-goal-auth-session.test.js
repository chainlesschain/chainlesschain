import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import Module from "node:module";
import { logger } from "../../utils/logger.js";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const require = createRequire(import.meta.url);
const auth = require("../project-goal-auth-session.js");
const Database = require("better-sqlite3");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const {
  ProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/project-goal-monitoring");
// Only Electron is replaced at the CommonJS boundary. The platform manager's
// verifyPIN, lock, detect, driver switching and events execute their real code.
const originalLoad = Module._load;
let UKeyManager;
try {
  Module._load = function (request, ...args) {
    if (request === "electron") return { app: { getPath: () => "." } };
    return originalLoad.call(this, request, ...args);
  };
  ({ UKeyManager } = require("../../ukey/ukey-manager.js"));
} finally {
  Module._load = originalLoad;
}
const { registerUKeyIPC } = await import("../../ukey/ukey-ipc.js");
const owner = "did:chainless:goal-owner";

describe("monitoring login authority through production authentication handlers", () => {
  let did, manager, driver, handlers, event, db, engine, goal, now;

  function createDriver() {
    return {
      unlocked: false,
      detected: true,
      async verifyPIN(pin) {
        this.unlocked = pin === "test-pin";
        return { success: this.unlocked };
      },
      isDeviceUnlocked() {
        return this.unlocked;
      },
      lock() {
        this.unlocked = false;
      },
      async detect() {
        return { detected: this.detected, unlocked: this.unlocked };
      },
      async initialize() {},
      async close() {
        this.lock();
      },
    };
  }
  const passwordLogin = () =>
    handlers["auth:verify-password"](event, "goal-test", "test-password");
  const pinLogin = () => handlers["ukey:verify-pin"](event, "test-pin");
  const logout = () => handlers["auth:logout"](event);
  const usage = () =>
    db.prepare("SELECT COUNT(*) AS n FROM cc_project_goal_checks").get().n;

  beforeEach(async () => {
    vi.stubEnv("DEFAULT_USERNAME", "goal-test");
    vi.stubEnv("DEFAULT_PASSWORD", "test-password");
    now = 1791244800000;
    did = owner;
    manager = new UKeyManager();
    driver = createDriver();
    manager.currentDriver = driver;
    auth.configureProjectGoalAuth({
      getDid: () => did,
      getUKeyManager: () => manager,
    });
    event = {
      sender: { isDestroyed: () => false },
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    handlers = {};
    registerUKeyIPC({
      ukeyManager: manager,
      ipcMain: {
        handle: (name, handler) => {
          handlers[name] = handler;
        },
      },
      ipcGuard: { isModuleRegistered: () => false, markModuleRegistered() {} },
    });
    db = new Database(":memory:");
    const store = openSchedulerStore({
      file: ":memory:",
      Database,
      clock: () => now,
    });
    engine = new ProjectGoalMonitoringEngine({
      db,
      store,
      getActor: auth.getProjectGoalActor,
      clock: () => now,
    });
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      now,
    );
    await passwordLogin();
    goal = engine.state.goals.create({
      projectId: "p1",
      objective: "Monitor delivery risk",
    });
    engine.start({
      id: goal.id,
      expectedRevision: goal.revision,
      intervalMs: 60_000,
    });
    await logout();
  });

  afterEach(async () => {
    await engine?.close();
    db?.close();
    auth.disposeProjectGoalAuth();
    manager?.stopDeviceMonitor();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("does not authenticate an automatically loaded default DID", async () => {
    expect(did).toBe(owner);
    expect(auth.getProjectGoalActor()).toBeNull();
    expect(await engine.tick()).toMatchObject({ reason: "identity-locked" });
    expect(usage()).toBe(0);
  });

  it("authenticates software password login without a UKey and revokes it on actual logout", async () => {
    manager = null;
    expect(await passwordLogin()).toMatchObject({ success: true });
    expect(auth.getProjectGoalActor()).toBe(owner);
    await engine.tick();
    expect(usage()).toBe(1);
    await logout();
    now += 60_000;
    expect(await engine.tick()).toMatchObject({ reason: "identity-locked" });
    expect(usage()).toBe(1);
  });

  it("stops monitoring after the real UKey lock handler while the DID stays loaded", async () => {
    await pinLogin();
    await engine.tick();
    expect(usage()).toBe(1);
    await handlers["ukey:lock"](event);
    expect(did).toBe(owner);
    expect(manager.isUnlocked()).toBe(false);
    now += 60_000;
    expect(await engine.tick()).toMatchObject({ reason: "identity-locked" });
    expect(usage()).toBe(1);
  });

  it("revokes a missing device immediately and requires a fresh PIN after reinsertion", async () => {
    await pinLogin();
    driver.detected = false;
    await manager.detect();
    expect(auth.getProjectGoalActor()).toBeNull();
    driver.detected = true;
    await manager.detect();
    expect(auth.getProjectGoalActor()).toBeNull();
    await pinLogin();
    expect(auth.getProjectGoalActor()).toBe(owner);
  });

  it("observes the actual hotplug monitor's disconnection and lock events", async () => {
    vi.useFakeTimers();
    await pinLogin();
    manager.startDeviceMonitor(100);
    await vi.advanceTimersByTimeAsync(100);
    driver.detected = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(manager.isUnlocked()).toBe(false);
    expect(auth.getProjectGoalActor()).toBeNull();
  });

  it("revokes authentication when the real manager switches driver", async () => {
    await pinLogin();
    const replacement = createDriver();
    replacement.unlocked = true;
    manager.drivers.set("replacement", replacement);
    await manager.switchDriver("replacement");
    expect(auth.getProjectGoalActor()).toBeNull();
  });

  it("does not treat unrelated hardware loss as software logout", async () => {
    await passwordLogin();
    await handlers["ukey:lock"](event);
    driver.detected = false;
    await manager.detect();
    expect(auth.getProjectGoalActor()).toBe(owner);
  });

  it("never falls back to an earlier software session after hardware login is revoked", async () => {
    await passwordLogin();
    await pinLogin();
    manager.lock();
    expect(auth.getProjectGoalActor()).toBeNull();
  });

  it("rejects an identity change and does not revive the old session when switched back", async () => {
    await passwordLogin();
    did = "did:chainless:someone-else";
    expect(auth.getProjectGoalActor()).toBeNull();
    did = owner;
    expect(auth.getProjectGoalActor()).toBeNull();
  });

  it("does not create a session for a failed PIN or password", async () => {
    expect(await handlers["ukey:verify-pin"](event, "incorrect")).toMatchObject(
      { success: false },
    );
    expect(
      await handlers["auth:verify-password"](event, "goal-test", "incorrect"),
    ).toMatchObject({ success: false });
    expect(auth.getProjectGoalActor()).toBeNull();
  });

  it("does not log submitted or configured login credentials", async () => {
    vi.clearAllMocks();
    await passwordLogin();
    await pinLogin();
    const logged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logged).not.toContain("test-password");
    expect(logged).not.toContain("test-pin");
    expect(logged).not.toContain("goal-test");
  });

  it.each(["password", "pin"])(
    "does not grant monitoring authority to an untrusted %s sender",
    async (method) => {
      event.senderFrame.url = "https://untrusted.example";
      if (method === "password") await passwordLogin();
      else await pinLogin();
      expect(auth.getProjectGoalActor()).toBeNull();
    },
  );

  it("requires the manager's live unlocked state in addition to a successful PIN result", async () => {
    driver.verifyPIN = async () => ({ success: true });
    await pinLogin();
    expect(auth.getProjectGoalActor()).toBeNull();
  });

  it.each(["logout", "lock", "identity", "navigation"])(
    "cannot grant a pending PIN after %s",
    async (change) => {
      let release;
      driver.verifyPIN = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      const pending = pinLogin();
      if (change === "logout") await logout();
      if (change === "lock") await handlers["ukey:lock"](event);
      if (change === "identity") did = "did:chainless:someone-else";
      if (change === "navigation")
        event.senderFrame.url = "https://untrusted.example";
      driver.unlocked = true;
      release({ success: true });
      await pending;
      expect(auth.getProjectGoalActor()).toBeNull();
    },
  );

  it("rejects an untrusted logout without revoking the authenticated session", async () => {
    await passwordLogin();
    event.senderFrame.url = "https://untrusted.example";
    await expect(logout()).rejects.toThrow("GOAL_UNTRUSTED_SENDER");
    expect(auth.getProjectGoalActor()).toBe(owner);
  });

  it("removes manager listeners and pending authority when disposed", async () => {
    await pinLogin();
    expect(manager.listenerCount("locked")).toBe(1);
    auth.disposeProjectGoalAuth();
    expect(manager.listenerCount("locked")).toBe(0);
    expect(auth.getProjectGoalActor()).toBeNull();
  });

  it("revokes the session and removes the logout handler during IPC re-registration", async () => {
    await passwordLogin();
    const removeHandler = vi.fn((name) => {
      delete handlers[name];
    });
    registerUKeyIPC({
      ukeyManager: manager,
      ipcMain: {
        handle: (name, handler) => {
          handlers[name] = handler;
        },
        removeHandler,
      },
      ipcGuard: {
        isModuleRegistered: () => true,
        markModuleRegistered() {},
        unregisterModule() {},
      },
    });
    expect(removeHandler).toHaveBeenCalledWith("auth:logout");
    expect(auth.getProjectGoalActor()).toBeNull();
    expect(typeof handlers["auth:logout"]).toBe("function");
  });
});
