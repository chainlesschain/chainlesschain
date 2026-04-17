import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  PLUGIN_STATUS,
  UPDATE_TYPE,
  HEALTH_STATUS,
  PROFILE_TYPES,
  ensureRuntimeTables,
  loadPlugin,
  unloadPlugin,
  setPluginStatus,
  getPlugin,
  listPlugins,
  hotUpdate,
  rollbackUpdate,
  listUpdates,
  takeProfile,
  getProfile,
  listProfiles,
  setState,
  getState,
  listState,
  deleteState,
  configure,
  getConfig,
  getPlatformInfo,
  healthCheck,
  getMetrics,
  getRuntimeStats,
  _resetState,
} from "../../src/lib/universal-runtime.js";

describe("universal-runtime", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureRuntimeTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureRuntimeTables", () => {
    it("creates all five tables", () => {
      expect(db.tables.has("runtime_plugins")).toBe(true);
      expect(db.tables.has("runtime_updates")).toBe(true);
      expect(db.tables.has("runtime_profiles")).toBe(true);
      expect(db.tables.has("runtime_state")).toBe(true);
      expect(db.tables.has("runtime_config")).toBe(true);
    });

    it("is idempotent", () => {
      ensureRuntimeTables(db);
      expect(db.tables.has("runtime_plugins")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 5 plugin statuses", () => {
      expect(Object.keys(PLUGIN_STATUS)).toHaveLength(5);
    });

    it("has 4 update types including rollback", () => {
      expect(Object.keys(UPDATE_TYPE)).toHaveLength(4);
      expect(Object.values(UPDATE_TYPE)).toContain("rollback");
    });

    it("has 3 health levels", () => {
      expect(Object.keys(HEALTH_STATUS)).toHaveLength(3);
    });

    it("has 3 profile types", () => {
      expect(PROFILE_TYPES).toEqual(["cpu", "memory", "flamegraph"]);
    });
  });

  /* ── Plugin lifecycle ─────────────────────────────── */

  describe("loadPlugin", () => {
    it("loads a plugin with defaults", () => {
      const r = loadPlugin(db, { name: "test-plugin" });
      expect(r.loaded).toBe(true);
      expect(r.pluginId).toBeTruthy();
      const p = getPlugin(db, r.pluginId);
      expect(p.name).toBe("test-plugin");
      expect(p.version).toBe("1.0.0");
      expect(p.status).toBe("active");
    });

    it("loads with version and config", () => {
      const r = loadPlugin(db, {
        name: "p1",
        version: "2.3.4",
        config: { feature: "x" },
      });
      expect(r.loaded).toBe(true);
      const p = getPlugin(db, r.pluginId);
      expect(p.version).toBe("2.3.4");
      expect(JSON.parse(p.config)).toEqual({ feature: "x" });
    });

    it("accepts APIs and permissions arrays", () => {
      const r = loadPlugin(db, {
        name: "p2",
        apis: ["api.a", "api.b"],
        permissions: ["fs.read"],
      });
      const p = getPlugin(db, r.pluginId);
      expect(JSON.parse(p.apis)).toEqual(["api.a", "api.b"]);
      expect(JSON.parse(p.permissions)).toEqual(["fs.read"]);
    });

    it("rejects missing name", () => {
      expect(loadPlugin(db, {}).reason).toBe("missing_name");
    });

    it("rejects duplicate name while active", () => {
      loadPlugin(db, { name: "dup" });
      expect(loadPlugin(db, { name: "dup" }).reason).toBe("already_loaded");
    });

    it("allows reloading after unload", () => {
      const first = loadPlugin(db, { name: "reload-me" });
      unloadPlugin(db, first.pluginId);
      const second = loadPlugin(db, { name: "reload-me" });
      expect(second.loaded).toBe(true);
    });

    it("increments pluginsLoaded metric", () => {
      loadPlugin(db, { name: "a" });
      loadPlugin(db, { name: "b" });
      expect(getMetrics().pluginsLoaded).toBe(2);
    });
  });

  describe("unloadPlugin", () => {
    it("unloads an active plugin", () => {
      const { pluginId } = loadPlugin(db, { name: "up" });
      const r = unloadPlugin(db, pluginId);
      expect(r.unloaded).toBe(true);
      expect(getPlugin(db, pluginId).status).toBe("unloaded");
    });

    it("rejects unknown id", () => {
      expect(unloadPlugin(db, "nope").reason).toBe("not_found");
    });

    it("rejects double unload", () => {
      const { pluginId } = loadPlugin(db, { name: "u2" });
      unloadPlugin(db, pluginId);
      expect(unloadPlugin(db, pluginId).reason).toBe("already_unloaded");
    });
  });

  describe("setPluginStatus", () => {
    it("moves plugin to suspended", () => {
      const { pluginId } = loadPlugin(db, { name: "sus" });
      expect(setPluginStatus(db, pluginId, "suspended").updated).toBe(true);
      expect(getPlugin(db, pluginId).status).toBe("suspended");
    });

    it("rejects invalid status", () => {
      const { pluginId } = loadPlugin(db, { name: "inv" });
      expect(setPluginStatus(db, pluginId, "bogus").reason).toBe(
        "invalid_status",
      );
    });

    it("bumps errors metric when moving to error", () => {
      const { pluginId } = loadPlugin(db, { name: "err" });
      setPluginStatus(db, pluginId, "error");
      expect(getMetrics().errors).toBe(1);
    });
  });

  describe("listPlugins", () => {
    it("filters by status", () => {
      const a = loadPlugin(db, { name: "a" });
      const b = loadPlugin(db, { name: "b" });
      setPluginStatus(db, b.pluginId, "suspended");
      const active = listPlugins(db, { status: "active" });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe("a");
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) loadPlugin(db, { name: `p${i}` });
      expect(listPlugins(db, { limit: 3 })).toHaveLength(3);
    });
  });

  /* ── Hot update ───────────────────────────────────── */

  describe("hotUpdate", () => {
    it("updates version and records update", () => {
      const { pluginId } = loadPlugin(db, { name: "hu", version: "1.0.0" });
      const r = hotUpdate(db, pluginId, "1.0.1");
      expect(r.updated).toBe(true);
      expect(r.fromVersion).toBe("1.0.0");
      expect(r.toVersion).toBe("1.0.1");
      expect(r.updateType).toBe("patch");
      expect(getPlugin(db, pluginId).version).toBe("1.0.1");
    });

    it("infers minor update type", () => {
      const { pluginId } = loadPlugin(db, { name: "m", version: "1.0.0" });
      const r = hotUpdate(db, pluginId, "1.1.0");
      expect(r.updateType).toBe("minor");
    });

    it("infers major update type", () => {
      const { pluginId } = loadPlugin(db, { name: "mj", version: "1.0.0" });
      const r = hotUpdate(db, pluginId, "2.0.0");
      expect(r.updateType).toBe("major");
    });

    it("allows overriding update type", () => {
      const { pluginId } = loadPlugin(db, { name: "ov", version: "1.0.0" });
      const r = hotUpdate(db, pluginId, "1.0.5", { updateType: "major" });
      expect(r.updateType).toBe("major");
    });

    it("rejects missing version", () => {
      const { pluginId } = loadPlugin(db, { name: "nv" });
      expect(hotUpdate(db, pluginId, null).reason).toBe("missing_version");
    });

    it("rejects unknown plugin", () => {
      expect(hotUpdate(db, "nope", "1.0.0").reason).toBe("not_found");
    });

    it("bumps hotUpdates metric", () => {
      const { pluginId } = loadPlugin(db, { name: "met", version: "1.0.0" });
      hotUpdate(db, pluginId, "1.0.1");
      hotUpdate(db, pluginId, "1.0.2");
      expect(getMetrics().hotUpdates).toBe(2);
    });

    it("respects hot-update disabled config", () => {
      const { pluginId } = loadPlugin(db, { name: "d", version: "1.0.0" });
      configure(db, "hotUpdateEnabled", false);
      expect(hotUpdate(db, pluginId, "1.0.1").reason).toBe(
        "hot_update_disabled",
      );
    });
  });

  describe("rollbackUpdate", () => {
    it("rolls a plugin back to previous version", () => {
      const { pluginId } = loadPlugin(db, { name: "rb", version: "1.0.0" });
      const u = hotUpdate(db, pluginId, "1.0.1");
      const r = rollbackUpdate(db, u.updateId);
      expect(r.rolledBack).toBe(true);
      expect(r.toVersion).toBe("1.0.0");
      expect(getPlugin(db, pluginId).version).toBe("1.0.0");
    });

    it("rejects rolling back a rollback", () => {
      const { pluginId } = loadPlugin(db, { name: "x", version: "1.0.0" });
      const u = hotUpdate(db, pluginId, "1.0.1");
      const rb = rollbackUpdate(db, u.updateId);
      // find the new rollback entry
      const updates = listUpdates(db, { pluginId });
      const rollbackEntry = updates.find((u) => u.id === rb.rollbackId);
      expect(rollbackUpdate(db, rollbackEntry.id).reason).toBe(
        "already_rollback",
      );
    });

    it("rejects unknown update id", () => {
      expect(rollbackUpdate(db, "nope").reason).toBe("not_found");
    });

    it("bumps rollbacks metric", () => {
      const { pluginId } = loadPlugin(db, { name: "m2", version: "1.0.0" });
      const u = hotUpdate(db, pluginId, "1.0.1");
      rollbackUpdate(db, u.updateId);
      expect(getMetrics().rollbacks).toBe(1);
    });
  });

  describe("listUpdates", () => {
    it("filters by pluginId", () => {
      const a = loadPlugin(db, { name: "a", version: "1.0.0" });
      const b = loadPlugin(db, { name: "b", version: "1.0.0" });
      hotUpdate(db, a.pluginId, "1.0.1");
      hotUpdate(db, b.pluginId, "1.0.1");
      expect(listUpdates(db, { pluginId: a.pluginId })).toHaveLength(1);
    });
  });

  /* ── Profile ──────────────────────────────────────── */

  describe("takeProfile", () => {
    it("takes a CPU profile", () => {
      const r = takeProfile(db, { type: "cpu", duration: 500 });
      expect(r.taken).toBe(true);
      expect(r.type).toBe("cpu");
      expect(r.data.cores).toBeGreaterThan(0);
    });

    it("takes a memory profile", () => {
      const r = takeProfile(db, { type: "memory" });
      expect(r.data.heapUsed).toBeGreaterThan(0);
    });

    it("takes a flamegraph profile", () => {
      const r = takeProfile(db, { type: "flamegraph", duration: 2000 });
      expect(r.data.frames).toEqual([]);
      expect(r.data.totalSamples).toBeGreaterThan(0);
    });

    it("defaults to cpu when type omitted", () => {
      const r = takeProfile(db, {});
      expect(r.type).toBe("cpu");
    });

    it("rejects invalid type", () => {
      expect(takeProfile(db, { type: "bogus" }).reason).toBe("invalid_type");
    });

    it("rejects negative duration", () => {
      expect(takeProfile(db, { type: "cpu", duration: -1 }).reason).toBe(
        "invalid_duration",
      );
    });

    it("persists and can be retrieved", () => {
      const r = takeProfile(db, { type: "cpu" });
      const p = getProfile(db, r.profileId);
      expect(p.profile_type).toBe("cpu");
      expect(p.data).toBeTruthy();
    });
  });

  describe("listProfiles", () => {
    it("filters by type", () => {
      takeProfile(db, { type: "cpu" });
      takeProfile(db, { type: "memory" });
      expect(listProfiles(db, { type: "memory" })).toHaveLength(1);
    });
  });

  /* ── State sync ───────────────────────────────────── */

  describe("setState/getState", () => {
    it("sets and gets a string value", () => {
      setState(db, "theme", "dark");
      expect(getState(db, "theme").value).toBe("dark");
    });

    it("sets and gets a JSON value", () => {
      setState(db, "prefs", { a: 1, b: [2, 3] });
      expect(getState(db, "prefs").value).toEqual({ a: 1, b: [2, 3] });
    });

    it("updates an existing key (LWW)", () => {
      setState(db, "k", "v1");
      setState(db, "k", "v2");
      expect(getState(db, "k").value).toBe("v2");
    });

    it("rejects missing key", () => {
      expect(setState(db, "", "x").reason).toBe("missing_key");
    });

    it("returns null for unknown key", () => {
      expect(getState(db, "never")).toBeNull();
    });

    it("increments stateWrites metric", () => {
      setState(db, "a", 1);
      setState(db, "b", 2);
      expect(getMetrics().stateWrites).toBe(2);
    });
  });

  describe("listState + deleteState", () => {
    it("lists all state entries", () => {
      setState(db, "a", 1);
      setState(db, "b", 2);
      expect(listState(db)).toHaveLength(2);
    });

    it("deletes a key", () => {
      setState(db, "gone", "x");
      const r = deleteState(db, "gone");
      expect(r.deleted).toBe(true);
      expect(getState(db, "gone")).toBeNull();
    });

    it("returns not_found for delete of missing key", () => {
      expect(deleteState(db, "ghost").reason).toBe("not_found");
    });
  });

  /* ── Configure ────────────────────────────────────── */

  describe("configure/getConfig", () => {
    it("updates a known key", () => {
      const r = configure(db, "maxPlugins", 42);
      expect(r.configured).toBe(true);
      expect(getConfig().maxPlugins).toBe(42);
    });

    it("accepts arbitrary keys", () => {
      configure(db, "customKey", "val");
      expect(getConfig().customKey).toBe("val");
    });

    it("rejects missing key", () => {
      expect(configure(db, "", "x").reason).toBe("missing_key");
    });
  });

  /* ── Platform info ────────────────────────────────── */

  describe("getPlatformInfo", () => {
    it("returns platform metadata", () => {
      const info = getPlatformInfo();
      expect(info.platform).toBeTruthy();
      expect(info.arch).toBeTruthy();
      expect(info.nodeVersion).toMatch(/^v/);
      expect(info.cpus).toBeGreaterThan(0);
      expect(info.heapUsed).toBeGreaterThan(0);
    });
  });

  /* ── Health check ─────────────────────────────────── */

  describe("healthCheck", () => {
    it("returns healthy in a fresh runtime", () => {
      expect(healthCheck().status).toBe("healthy");
    });

    it("reports plugin counts", () => {
      const a = loadPlugin(db, { name: "a" });
      const b = loadPlugin(db, { name: "b" });
      setPluginStatus(db, b.pluginId, "error");
      const h = healthCheck();
      expect(h.plugins.total).toBe(2);
      expect(h.plugins.active).toBe(1);
      expect(h.plugins.errors).toBe(1);
    });

    it("degrades status once error threshold crossed", () => {
      const { pluginId } = loadPlugin(db, { name: "e" });
      for (let i = 0; i < 15; i++) setPluginStatus(db, pluginId, "error");
      expect(healthCheck().status).toBe("degraded");
    });
  });

  /* ── Metrics ──────────────────────────────────────── */

  describe("getMetrics", () => {
    it("rolls up runtime counters", () => {
      loadPlugin(db, { name: "p1", version: "1.0.0" });
      loadPlugin(db, { name: "p2", version: "1.0.0" });
      takeProfile(db, { type: "cpu" });
      setState(db, "k", "v");
      const m = getMetrics();
      expect(m.pluginsLoaded).toBe(2);
      expect(m.profilesTaken).toBe(1);
      expect(m.stateWrites).toBe(1);
      expect(m.activePlugins).toBe(2);
      expect(m.uptimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  /* ── Stats ────────────────────────────────────────── */

  describe("getRuntimeStats", () => {
    it("aggregates plugin/update/profile distributions", () => {
      const { pluginId } = loadPlugin(db, { name: "s", version: "1.0.0" });
      hotUpdate(db, pluginId, "1.0.1");
      takeProfile(db, { type: "cpu" });
      takeProfile(db, { type: "memory" });
      const s = getRuntimeStats();
      expect(s.plugins).toBe(1);
      expect(s.updates).toBe(1);
      expect(s.profiles).toBe(2);
      expect(s.byPluginStatus.active).toBe(1);
      expect(s.byUpdateType.patch).toBe(1);
      expect(s.byProfileType.cpu).toBe(1);
      expect(s.byProfileType.memory).toBe(1);
      expect(s.health.status).toBeTruthy();
    });
  });
});

/* ═════════════════════════════════════════════════════════ *
 *  Phase 63 V2 tests
 * ═════════════════════════════════════════════════════════ */

import {
  PLUGIN_MATURITY_V2,
  RUNTIME_TASK_V2,
  RT_DEFAULT_MAX_ACTIVE_PLUGINS_PER_OWNER,
  RT_DEFAULT_MAX_RUNNING_TASKS_PER_OWNER,
  RT_DEFAULT_PLUGIN_IDLE_MS,
  RT_DEFAULT_TASK_STUCK_MS,
  getDefaultMaxActivePluginsPerOwnerV2,
  getMaxActivePluginsPerOwnerV2,
  setMaxActivePluginsPerOwnerV2,
  getDefaultMaxRunningTasksPerOwnerV2,
  getMaxRunningTasksPerOwnerV2,
  setMaxRunningTasksPerOwnerV2,
  getDefaultPluginIdleMsV2,
  getPluginIdleMsV2,
  setPluginIdleMsV2,
  getDefaultTaskStuckMsV2,
  getTaskStuckMsV2,
  setTaskStuckMsV2,
  registerPluginV2,
  getPluginV2,
  setPluginMaturityV2,
  activatePluginV2,
  deprecatePluginV2,
  retirePluginV2,
  touchPluginInvocation,
  enqueueRuntimeTaskV2,
  getRuntimeTaskV2,
  setRuntimeTaskStatusV2,
  startRuntimeTask,
  completeRuntimeTask,
  failRuntimeTask,
  cancelRuntimeTask,
  getActivePluginCount,
  getRunningTaskCount,
  autoRetireIdlePlugins,
  autoFailStuckRuntimeTasks,
  getRuntimeStatsV2,
  _resetStateV2,
} from "../../src/lib/universal-runtime.js";

describe("universal-runtime V2", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums", () => {
    it("PLUGIN_MATURITY_V2 frozen with 4 states", () => {
      expect(Object.values(PLUGIN_MATURITY_V2)).toEqual([
        "draft",
        "active",
        "deprecated",
        "retired",
      ]);
      expect(Object.isFrozen(PLUGIN_MATURITY_V2)).toBe(true);
    });

    it("RUNTIME_TASK_V2 frozen with 5 states", () => {
      expect(Object.values(RUNTIME_TASK_V2)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "canceled",
      ]);
      expect(Object.isFrozen(RUNTIME_TASK_V2)).toBe(true);
    });
  });

  describe("config defaults + setters", () => {
    it("exposes frozen defaults", () => {
      expect(RT_DEFAULT_MAX_ACTIVE_PLUGINS_PER_OWNER).toBe(40);
      expect(RT_DEFAULT_MAX_RUNNING_TASKS_PER_OWNER).toBe(5);
      expect(RT_DEFAULT_PLUGIN_IDLE_MS).toBe(90 * 86400000);
      expect(RT_DEFAULT_TASK_STUCK_MS).toBe(4 * 3600000);
      expect(getDefaultMaxActivePluginsPerOwnerV2()).toBe(40);
      expect(getDefaultMaxRunningTasksPerOwnerV2()).toBe(5);
      expect(getDefaultPluginIdleMsV2()).toBe(90 * 86400000);
      expect(getDefaultTaskStuckMsV2()).toBe(4 * 3600000);
    });

    it("mutates config", () => {
      setMaxActivePluginsPerOwnerV2(5);
      setMaxRunningTasksPerOwnerV2(2);
      setPluginIdleMsV2(1000);
      setTaskStuckMsV2(500);
      expect(getMaxActivePluginsPerOwnerV2()).toBe(5);
      expect(getMaxRunningTasksPerOwnerV2()).toBe(2);
      expect(getPluginIdleMsV2()).toBe(1000);
      expect(getTaskStuckMsV2()).toBe(500);
    });

    it("rejects non-positive", () => {
      expect(() => setMaxActivePluginsPerOwnerV2(0)).toThrow();
      expect(() => setPluginIdleMsV2(-1)).toThrow();
      expect(() => setTaskStuckMsV2("x")).toThrow();
    });

    it("_resetStateV2 restores defaults + clears maps", () => {
      setMaxActivePluginsPerOwnerV2(10);
      registerPluginV2(null, { pluginId: "p", ownerId: "o" });
      enqueueRuntimeTaskV2(null, {
        taskId: "t",
        ownerId: "o",
        pluginId: "p",
        kind: "invoke",
      });
      _resetStateV2();
      expect(getMaxActivePluginsPerOwnerV2()).toBe(40);
      expect(getPluginV2("p")).toBeNull();
      expect(getRuntimeTaskV2("t")).toBeNull();
    });
  });

  describe("registerPluginV2", () => {
    it("creates draft plugin", () => {
      const p = registerPluginV2(null, {
        pluginId: "p",
        ownerId: "alice",
        name: "foo",
        version: "1.0.0",
      });
      expect(p.status).toBe("draft");
    });

    it("throws missing/duplicate/invalid/terminal", () => {
      expect(() => registerPluginV2(null, { ownerId: "a" })).toThrow();
      expect(() => registerPluginV2(null, { pluginId: "p" })).toThrow();
      registerPluginV2(null, { pluginId: "p", ownerId: "a" });
      expect(() =>
        registerPluginV2(null, { pluginId: "p", ownerId: "a" }),
      ).toThrow(/already/);
      expect(() =>
        registerPluginV2(null, {
          pluginId: "p2",
          ownerId: "a",
          initialStatus: "x",
        }),
      ).toThrow();
      expect(() =>
        registerPluginV2(null, {
          pluginId: "p3",
          ownerId: "a",
          initialStatus: "retired",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces per-owner active cap", () => {
      setMaxActivePluginsPerOwnerV2(2);
      registerPluginV2(null, {
        pluginId: "p1",
        ownerId: "a",
        initialStatus: "active",
      });
      registerPluginV2(null, {
        pluginId: "p2",
        ownerId: "a",
        initialStatus: "active",
      });
      expect(() =>
        registerPluginV2(null, {
          pluginId: "p3",
          ownerId: "a",
          initialStatus: "active",
        }),
      ).toThrow(/cap/);
    });
  });

  describe("setPluginMaturityV2 + shortcuts", () => {
    beforeEach(() => {
      registerPluginV2(null, { pluginId: "p", ownerId: "a" });
    });

    it("draft → active → deprecated → active → retired", () => {
      activatePluginV2(null, "p");
      expect(getPluginV2("p").status).toBe("active");
      deprecatePluginV2(null, "p");
      expect(getPluginV2("p").status).toBe("deprecated");
      activatePluginV2(null, "p");
      expect(getPluginV2("p").status).toBe("active");
      retirePluginV2(null, "p");
      expect(getPluginV2("p").status).toBe("retired");
    });

    it("rejects invalid transition", () => {
      expect(() => deprecatePluginV2(null, "p")).toThrow(/Invalid transition/);
    });

    it("retired is terminal", () => {
      activatePluginV2(null, "p");
      retirePluginV2(null, "p");
      expect(() => activatePluginV2(null, "p")).toThrow();
    });

    it("enforces cap on re-activate", () => {
      setMaxActivePluginsPerOwnerV2(1);
      registerPluginV2(null, {
        pluginId: "p2",
        ownerId: "a",
        initialStatus: "active",
      });
      expect(() => activatePluginV2(null, "p")).toThrow(/cap/);
    });

    it("patch-merges metadata + reason", () => {
      activatePluginV2(null, "p");
      setPluginMaturityV2(null, "p", "deprecated", {
        reason: "old",
        metadata: { note: "legacy" },
      });
      const r = getPluginV2("p");
      expect(r.lastReason).toBe("old");
      expect(r.metadata.note).toBe("legacy");
    });

    it("throws unknown", () => {
      expect(() => activatePluginV2(null, "nope")).toThrow(/Unknown plugin/);
    });
  });

  describe("touchPluginInvocation", () => {
    it("bumps lastInvokedAt", async () => {
      registerPluginV2(null, { pluginId: "p", ownerId: "a" });
      const before = getPluginV2("p").lastInvokedAt;
      await new Promise((r) => setTimeout(r, 5));
      const t = touchPluginInvocation("p");
      expect(t.lastInvokedAt).toBeGreaterThan(before);
    });

    it("throws unknown", () => {
      expect(() => touchPluginInvocation("x")).toThrow();
    });
  });

  describe("enqueueRuntimeTaskV2 + lifecycle", () => {
    beforeEach(() => {
      registerPluginV2(null, { pluginId: "p", ownerId: "a" });
    });

    it("enqueues queued task", () => {
      const t = enqueueRuntimeTaskV2(null, {
        taskId: "t",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      expect(t.status).toBe("queued");
    });

    it("throws missing required / duplicate", () => {
      expect(() =>
        enqueueRuntimeTaskV2(null, { taskId: "t", ownerId: "a" }),
      ).toThrow(/pluginId/);
      enqueueRuntimeTaskV2(null, {
        taskId: "t",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      expect(() =>
        enqueueRuntimeTaskV2(null, {
          taskId: "t",
          ownerId: "a",
          pluginId: "p",
          kind: "invoke",
        }),
      ).toThrow(/already/);
    });

    it("queued → running → completed", () => {
      enqueueRuntimeTaskV2(null, {
        taskId: "t",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      startRuntimeTask(null, "t");
      expect(getRuntimeTaskV2("t").startedAt).toBeDefined();
      completeRuntimeTask(null, "t");
      expect(getRuntimeTaskV2("t").status).toBe("completed");
    });

    it("enforces running-task cap", () => {
      setMaxRunningTasksPerOwnerV2(1);
      enqueueRuntimeTaskV2(null, {
        taskId: "t1",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      enqueueRuntimeTaskV2(null, {
        taskId: "t2",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      startRuntimeTask(null, "t1");
      expect(() => startRuntimeTask(null, "t2")).toThrow(/cap/);
    });

    it("startedAt stamp-once", async () => {
      enqueueRuntimeTaskV2(null, {
        taskId: "t",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      startRuntimeTask(null, "t");
      const first = getRuntimeTaskV2("t").startedAt;
      await new Promise((r) => setTimeout(r, 5));
      completeRuntimeTask(null, "t");
      expect(getRuntimeTaskV2("t").startedAt).toBe(first);
    });

    it("terminal states block further transitions", () => {
      enqueueRuntimeTaskV2(null, {
        taskId: "t",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      startRuntimeTask(null, "t");
      failRuntimeTask(null, "t");
      expect(() => completeRuntimeTask(null, "t")).toThrow(/Invalid/);
    });
  });

  describe("counts + auto-flips + stats", () => {
    it("counts scoped by owner", () => {
      registerPluginV2(null, {
        pluginId: "p1",
        ownerId: "a",
        initialStatus: "active",
      });
      registerPluginV2(null, {
        pluginId: "p2",
        ownerId: "b",
        initialStatus: "active",
      });
      expect(getActivePluginCount()).toBe(2);
      expect(getActivePluginCount("a")).toBe(1);
    });

    it("autoRetireIdlePlugins flips active + deprecated", () => {
      registerPluginV2(null, {
        pluginId: "p1",
        ownerId: "a",
        initialStatus: "active",
      });
      registerPluginV2(null, {
        pluginId: "p2",
        ownerId: "a",
        initialStatus: "active",
      });
      setPluginMaturityV2(null, "p2", "deprecated");
      registerPluginV2(null, { pluginId: "p3", ownerId: "a" }); // draft skipped
      setPluginIdleMsV2(100);
      const r = autoRetireIdlePlugins(null, Date.now() + 1000);
      expect(r.count).toBe(2);
    });

    it("autoFailStuckRuntimeTasks flips only running", () => {
      registerPluginV2(null, { pluginId: "p", ownerId: "a" });
      enqueueRuntimeTaskV2(null, {
        taskId: "t1",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      enqueueRuntimeTaskV2(null, {
        taskId: "t2",
        ownerId: "a",
        pluginId: "p",
        kind: "invoke",
      });
      startRuntimeTask(null, "t1");
      setTaskStuckMsV2(100);
      const r = autoFailStuckRuntimeTasks(null, Date.now() + 1000);
      expect(r.count).toBe(1);
      expect(getRuntimeTaskV2("t1").status).toBe("failed");
      expect(getRuntimeTaskV2("t2").status).toBe("queued");
    });

    it("stats zero-init", () => {
      const s = getRuntimeStatsV2();
      expect(s.totalPluginsV2).toBe(0);
      expect(s.totalTasksV2).toBe(0);
      expect(Object.keys(s.pluginsByStatus).sort()).toEqual(
        ["active", "deprecated", "draft", "retired"].sort(),
      );
      expect(Object.keys(s.tasksByStatus).sort()).toEqual(
        ["canceled", "completed", "failed", "queued", "running"].sort(),
      );
    });
  });
});
