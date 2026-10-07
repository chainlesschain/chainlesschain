"use strict";

const { createHash } = require("node:crypto");
const { existsSync, realpathSync } = require("node:fs");
const { isAbsolute, join, dirname } = require("node:path");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const {
  ensurePrivateDirectory,
  ensurePrivateFile,
} = require("@chainlesschain/session-core/private-storage");
const {
  ProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/project-goal-monitoring");

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Main-process owner. Neither database paths nor background identity come
 * from a renderer or from the window that originally enabled monitoring. */
function createProjectGoalMonitoringController({
  database,
  electron = null,
  getCurrentUserDid = () =>
    require("./project-goal-auth-session").getProjectGoalActor(),
  protectDirectory = (target) =>
    ensurePrivateDirectory(target, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    }),
  protectFile = (target) =>
    ensurePrivateFile(target, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    }),
  clock = Date.now,
  onError = () => {},
  engineFactory = (options) => new ProjectGoalMonitoringEngine(options),
  storageDirectory = "goal-monitoring",
  autoStart = true,
} = {}) {
  if (
    typeof engineFactory !== "function" ||
    typeof autoStart !== "boolean" ||
    !["goal-monitoring", "organization-goal-monitoring"].includes(
      storageDirectory,
    )
  )
    fail("GOAL_MONITOR_INVALID_HOST");
  let engine = null,
    sourceDb = null,
    opening = null,
    closed = false,
    closing = null;
  const currentDb = () =>
    database?.getDatabase ? database.getDatabase() : database;
  function getEngine() {
    if (closed) fail("GOAL_MONITOR_HOST_CLOSED");
    if (opening) return opening;
    opening = (async () => {
      const native = currentDb();
      if (engine && sourceDb === native) return engine;
      if (engine) {
        await engine.close();
        engine = null;
        sourceDb = null;
      }
      if (closed) fail("GOAL_MONITOR_HOST_CLOSED");
      if (currentDb() !== native) fail("GOAL_MONITOR_DATABASE_CHANGED");
      if (
        !native ||
        typeof native.transaction !== "function" ||
        typeof native.inTransaction !== "boolean" ||
        typeof native.transaction(() => {}).immediate !== "function" ||
        typeof native.constructor !== "function"
      )
        fail("GOAL_NATIVE_DATABASE_REQUIRED");
      if (typeof native.name !== "string" || !isAbsolute(native.name))
        fail("GOAL_MONITOR_DATABASE_PATH_REQUIRED");
      const app = (electron || require("electron")).app;
      const userData = app?.getPath("userData");
      if (typeof userData !== "string" || !isAbsolute(userData))
        fail("GOAL_MONITOR_STORAGE_PATH_REQUIRED");
      const namespace = createHash("sha256")
        .update(realpathSync(native.name))
        .digest("hex");
      const root = join(userData, storageDirectory);
      const file = join(root, namespace, "scheduler.sqlite");
      const store = openSchedulerStore({
        file,
        Database: native.constructor,
        clock,
        protectStorage: ({ phase, files }) => {
          if (phase === "before-open") {
            if (
              protectDirectory(root) !== root ||
              protectDirectory(dirname(file)) !== dirname(file)
            )
              fail("GOAL_MONITOR_STORAGE_PROTECTION_FAILED");
          }
          for (const candidate of files)
            if (existsSync(candidate) && protectFile(candidate) !== candidate)
              fail("GOAL_MONITOR_STORAGE_PROTECTION_FAILED");
          return true;
        },
      });
      try {
        const captured = native;
        engine = engineFactory({
          db: native,
          store,
          clock,
          getActor: () => {
            // Connection replacement locks the old engine until the next command
            // rotates it, after draining the previous host.
            try {
              return currentDb() === captured ? getCurrentUserDid() : null;
            } catch {
              return null;
            }
          },
        });
        sourceDb = native;
        if (autoStart)
          engine.startBackground().catch((error) => {
            try {
              onError(error);
            } catch {}
          });
        return engine;
      } catch (error) {
        store.close();
        throw error;
      }
    })();
    const result = opening;
    result.then(
      () => {
        opening = null;
      },
      () => {
        opening = null;
      },
    );
    return result;
  }
  function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try {
        await opening;
      } catch {}
      if (engine) await engine.close();
    })();
    return closing;
  }
  return Object.freeze({ initialize: getEngine, close });
}

module.exports = { createProjectGoalMonitoringController };
