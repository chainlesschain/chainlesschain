"use strict";

/** Personal task descriptions: main-process identity and native confirmation. */
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");

const CHANNELS = Object.freeze({
  preview: "task:controlled-description-preview",
  execute: "task:controlled-description-execute",
  run: "task:controlled-description-run",
  list: "task:controlled-list",
  read: "task:controlled-read",
  runs: "task:controlled-description-runs",
  evaluateRisk: "project:risk-evaluate",
  riskReview: "project:risk-review",
});

function hostError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// Keep all content visible, including control/bidirectional characters that can
// otherwise conceal part of an identifier or alter the meaning of the preview.
function display(value) {
  return JSON.stringify(value).replace(
    /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function createTaskDescriptionHost({
  database,
  getCurrentUserDid = () =>
    require("../permission/current-user-context").getCurrentUserDid(),
  validateSender = (event) =>
    require("../ipc/ipc-sender-guard").validateSender(event),
  electron = null,
} = {}) {
  const getElectron = () => electron || require("electron");

  function currentWindow(event) {
    if (validateSender(event)?.trusted !== true) {
      throw hostError("BUSINESS_ACTION_UNTRUSTED_SENDER");
    }
    const window = getElectron().BrowserWindow.fromWebContents(event?.sender);
    if (!window || window.isDestroyed()) {
      throw hostError("BUSINESS_ACTION_WINDOW_UNAVAILABLE");
    }
    return window;
  }

  function createAuthority(event) {
    currentWindow(event);
    const getActor = () => {
      // Repeated by the service inside its atomic write, after the async dialog.
      currentWindow(event);
      const actor = getCurrentUserDid();
      if (typeof actor !== "string" || !actor) {
        throw hostError("BUSINESS_ACTION_IDENTITY_REQUIRED");
      }
      return actor;
    };
    getActor();
    const db = database?.getDatabase ? database.getDatabase() : database;
    return { db, getActor };
  }

  function createService(event) {
    const { db, getActor } = createAuthority(event);
    const gate = new ApprovalGate({
      defaultPolicy: "strict",
      confirm: async ({ request, before, after, actorDid }) => {
        const parent = currentWindow(event);
        if (getActor() !== actorDid) {
          throw hostError("BUSINESS_ACTION_IDENTITY_CHANGED");
        }
        const result = await getElectron().dialog.showMessageBox(parent, {
          type: "question",
          title: "确认修改任务描述",
          message: "修改以下任务的描述？",
          detail: [
            `当前身份：${display(actorDid)}`,
            `任务：${display(request.target.id)}`,
            `修改前：${display(before.description)}`,
            `修改后：${display(after.description)}`,
            `操作摘要：${request.actionDigest}`,
          ].join("\n\n"),
          buttons: ["取消", "确认修改"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return result?.response === 1;
      },
    });
    const {
      TaskDescriptionActionService,
    } = require("@chainlesschain/session-core/task-description-action-service");
    return new TaskDescriptionActionService({
      db,
      getActor,
      // Keep the gate private. Renderer input cannot select a weaker policy or
      // install a confirmer, and this does not share mutable session policies.
      approvalGate: Object.freeze({
        decide: (context) =>
          gate.decide({ ...context, policy: "strict", riskLevel: "high" }),
      }),
    });
  }

  function createRiskService(event) {
    const authority = createAuthority(event);
    const {
      ProjectRiskReviewService,
    } = require("@chainlesschain/session-core/project-risk-review-service");
    return new ProjectRiskReviewService(authority);
  }

  function selectedParams(params, keys) {
    return Object.fromEntries(
      keys
        .filter((key) => params?.[key] !== undefined)
        .map((key) => [key, params[key]]),
    );
  }

  return Object.freeze({
    preview(event, params = {}) {
      return createService(event).preview({
        taskId: params?.taskId,
        description: params?.description,
        idempotencyKey: params?.idempotencyKey,
      });
    },
    execute(event, params = {}) {
      return createService(event).execute(params?.request);
    },
    getRun(event, params = {}) {
      return createService(event).getRun(params?.runId);
    },
    listTasks(event, params = {}) {
      return createService(event).listTasks(
        selectedParams(params, ["projectId", "afterId", "limit"]),
      );
    },
    readTask(event, params = {}) {
      return createService(event).readTask(params?.taskId);
    },
    listRuns(event, params = {}) {
      return createService(event).listRuns(
        selectedParams(params, ["taskId", "beforeId", "limit"]),
      );
    },
    evaluateRisk(event, params = {}) {
      return createRiskService(event).evaluate({
        projectId: params?.projectId,
      });
    },
    getRiskReview(event, params = {}) {
      return createRiskService(event).getReview({ reviewId: params?.reviewId });
    },
  });
}

function registerTaskDescriptionIPC(database, dependencies = {}) {
  const electron = dependencies.electron || require("electron");
  const host = createTaskDescriptionHost({
    ...dependencies,
    database,
    electron,
  });
  electron.ipcMain.handle(
    "task:controlled-description-preview",
    (event, params) => host.preview(event, params),
  );
  electron.ipcMain.handle(
    "task:controlled-description-execute",
    (event, params) => host.execute(event, params),
  );
  electron.ipcMain.handle("task:controlled-description-run", (event, params) =>
    host.getRun(event, params),
  );
  electron.ipcMain.handle("task:controlled-list", (event, params) =>
    host.listTasks(event, params),
  );
  electron.ipcMain.handle("task:controlled-read", (event, params) =>
    host.readTask(event, params),
  );
  electron.ipcMain.handle("task:controlled-description-runs", (event, params) =>
    host.listRuns(event, params),
  );
  electron.ipcMain.handle("project:risk-evaluate", (event, params) =>
    host.evaluateRisk(event, params),
  );
  electron.ipcMain.handle("project:risk-review", (event, params) =>
    host.getRiskReview(event, params),
  );
}

module.exports = {
  CHANNELS,
  createTaskDescriptionHost,
  registerTaskDescriptionIPC,
};
