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
  proposals: "project:goal-proposals",
  prepareIntent: "project:goal-intent-prepare",
  executeIntent: "project:goal-intent-execute",
  readIntent: "project:goal-intent-read",
});
function error(code) {
  return Object.assign(new Error(code), { code });
}

function display(value) {
  return JSON.stringify(value).replace(
    /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Fixed personal goal endpoints. Writes use a persisted native intent and a
 * live trusted renderer window; the background monitoring host has no dialog. */
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
  const currentDatabase = () =>
    database?.getDatabase ? database.getDatabase() : database;
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
  function workflow(event) {
    currentWindow(event);
    const db = currentDatabase();
    const getActor = () => {
      currentWindow(event);
      if (currentDatabase() !== db) throw error("GOAL_DATABASE_CHANGED");
      const actor = getCurrentUserDid();
      if (!actor) throw error("GOAL_IDENTITY_REQUIRED");
      return actor;
    };
    getActor();
    const {
      ApprovalGate,
    } = require("@chainlesschain/session-core/approval-gate");
    const {
      ProjectGoalWorkflow,
    } = require("@chainlesschain/session-core/project-goal-workflow");
    const gate = new ApprovalGate({
      confirm: async ({ request, before, after, actorDid }) => {
        const parent = currentWindow(event);
        if (getActor() !== actorDid) throw error("GOAL_IDENTITY_CHANGED");
        const goal = hostWorkflow.goals.get({
          id: request.input.goalIntent.goalId,
        });
        const creation = request.actionType === "task.create";
        const result = await getElectron().dialog.showMessageBox(parent, {
          type: "question",
          title: creation ? "确认目标建议：创建任务" : "确认目标建议：修改描述",
          message: creation
            ? "为该目标保存以下待处理任务？"
            : "按该目标建议修改任务描述？",
          detail: [
            `目标：${display(goal.objective)}`,
            `目标版本：${goal.revision}`,
            `当前身份：${display(actorDid)}`,
            `对象：${display(request.target.id)}`,
            `对象版本：${request.expectedVersion}`,
            ...(creation ? [`任务类型：${display(after.taskType)}`] : []),
            `修改前：${display(before.description)}`,
            `修改后：${display(after.description)}`,
            `风险检查：${display(request.input.riskReview.id)}`,
            `风险来源摘要：${request.input.riskReview.contentDigest}`,
            `意图：${display(request.input.goalIntent.id)}`,
            `操作摘要：${request.actionDigest}`,
            "保存动作只证明该操作完成；原风险与目标验收需要再次检查。",
          ].join("\n\n"),
          buttons: ["取消", creation ? "确认创建" : "确认修改"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return result?.response === 1;
      },
    });
    const hostWorkflow = new ProjectGoalWorkflow({
      db,
      getActor,
      clock,
      approvalGate: Object.freeze({
        decide: (context) =>
          gate.decide({ ...context, policy: "strict", riskLevel: "high" }),
      }),
    });
    return hostWorkflow;
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
    proposals: (event, params) => workflow(event).list(params),
    prepareIntent: (event, params) => workflow(event).prepare(params),
    executeIntent: (event, params) => workflow(event).execute(params),
    readIntent: (event, params) => workflow(event).getIntent(params),
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
