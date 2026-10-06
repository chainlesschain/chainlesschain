"use strict";

const {
  PersonalProjectGoalService,
} = require("@chainlesschain/session-core/project-goal-service");
const CHANNELS = Object.freeze({
  create: "project:goal-create",
  read: "project:goal-read",
  list: "project:goal-list",
  revise: "project:goal-revise",
  start: "project:goal-monitor-start",
  stop: "project:goal-monitor-stop",
  check: "project:goal-monitor-check",
  status: "project:goal-monitor-status",
});
function error(code) {
  return Object.assign(new Error(code), { code });
}

/** Authorized commands and metadata. No completion verifier or task writer. */
function createProjectGoalHost({
  database,
  electron = null,
  getCurrentUserDid = () =>
    require("./project-goal-auth-session").getProjectGoalActor(),
  validateSender = (event) =>
    require("../ipc/ipc-sender-guard").validateSender(event),
  monitoringController = null,
  clock = Date.now,
} = {}) {
  const getElectron = () => electron || require("electron");
  function currentWindow(event) {
    if (validateSender(event)?.trusted !== true)
      throw error("GOAL_UNTRUSTED_SENDER");
    const window = getElectron().BrowserWindow.fromWebContents(event?.sender);
    if (!window || window.isDestroyed()) throw error("GOAL_WINDOW_UNAVAILABLE");
    return window;
  }
  function service(event) {
    currentWindow(event);
    const getActor = () => {
      currentWindow(event);
      const actor = getCurrentUserDid();
      if (typeof actor !== "string" || !actor)
        throw error("GOAL_IDENTITY_REQUIRED");
      return actor;
    };
    getActor();
    return new PersonalProjectGoalService({
      db: database?.getDatabase ? database.getDatabase() : database,
      getActor,
      now: () => new Date(clock()).toISOString(),
    });
  }
  const controller =
    monitoringController ||
    require("./project-goal-monitoring-host").createProjectGoalMonitoringController(
      {
        database,
        electron: getElectron(),
        getCurrentUserDid,
        clock,
        onError: (error) =>
          require("../utils/logger.js").logger.error(
            "[Goals] Monitoring host error:",
            error,
          ),
      },
    );
  async function monitor(event) {
    currentWindow(event);
    if (!getCurrentUserDid()) throw error("GOAL_IDENTITY_REQUIRED");
    const engine = await controller.initialize();
    currentWindow(event);
    if (!getCurrentUserDid()) throw error("GOAL_IDENTITY_REQUIRED");
    return engine;
  }
  return Object.freeze({
    create: (event, params) => service(event).create(params),
    read: (event, params) => service(event).get(params),
    list: (event, params) => service(event).list(params),
    revise: (event, params) => service(event).revise(params),
    start: async (event, params) => (await monitor(event)).start(params),
    stop: async (event, params) => (await monitor(event)).stop(params),
    check: async (event, params) => (await monitor(event)).checkNow(params),
    status: async (event, params) => (await monitor(event)).status(params),
    initializeMonitoring: () => controller.initialize(),
    close: () => controller.close(),
  });
}
function registerProjectGoalIPC(database, dependencies = {}) {
  const electron = dependencies.electron || require("electron");
  const host = createProjectGoalHost({ ...dependencies, database, electron });
  for (const [method, channel] of Object.entries(CHANNELS))
    electron.ipcMain.handle(channel, (event, params) =>
      host[method](event, params),
    );
  return host;
}
module.exports = { CHANNELS, createProjectGoalHost, registerProjectGoalIPC };
