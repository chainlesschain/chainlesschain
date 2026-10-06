"use strict";

const {
  PersonalProjectGoalService,
} = require("@chainlesschain/session-core/project-goal-service");
const CHANNELS = Object.freeze({
  create: "project:goal-create",
  read: "project:goal-read",
  list: "project:goal-list",
  revise: "project:goal-revise",
});
function error(code) {
  return Object.assign(new Error(code), { code });
}

/** Metadata only in B1: no scheduler start, completion verifier or task writer. */
function createProjectGoalHost({
  database,
  electron = null,
  getCurrentUserDid = () =>
    require("../permission/current-user-context").getCurrentUserDid(),
  validateSender = (event) =>
    require("../ipc/ipc-sender-guard").validateSender(event),
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
    });
  }
  return Object.freeze({
    create: (event, params) => service(event).create(params),
    read: (event, params) => service(event).get(params),
    list: (event, params) => service(event).list(params),
    revise: (event, params) => service(event).revise(params),
  });
}
function registerProjectGoalIPC(database, dependencies = {}) {
  const electron = dependencies.electron || require("electron");
  const host = createProjectGoalHost({ ...dependencies, database, electron });
  for (const [method, channel] of Object.entries(CHANNELS))
    electron.ipcMain.handle(channel, (event, params) =>
      host[method](event, params),
    );
}
module.exports = { CHANNELS, createProjectGoalHost, registerProjectGoalIPC };
