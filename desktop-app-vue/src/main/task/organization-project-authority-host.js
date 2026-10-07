"use strict";

const {
  OrganizationProjectAuthority,
} = require("@chainlesschain/session-core/organization-project-authority");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function display(value) {
  return JSON.stringify(value).replace(
    /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Native host adapter; deliberately not registered as renderer IPC until the
 * organization action/approval journey and ownership migration UI are ready. */
function createOrganizationProjectAuthorityHost({
  database,
  getCurrentUserDid = () =>
    require("./project-goal-auth-session").getProjectGoalActor(),
  getAuthenticationGeneration = () =>
    require("./project-goal-auth-session").getProjectGoalAuthGeneration(),
  validateSender = (event) =>
    require("../ipc/ipc-sender-guard").validateSender(event),
  electron = null,
} = {}) {
  const getElectron = () => electron || require("electron");
  const currentDatabase = () =>
    database?.getDatabase ? database.getDatabase() : database;
  function service(event) {
    function currentWindow() {
      if (validateSender(event)?.trusted !== true)
        fail("ORG_AUTH_UNTRUSTED_SENDER");
      const window = getElectron().BrowserWindow.fromWebContents(event?.sender);
      if (!window || window.isDestroyed()) fail("ORG_AUTH_WINDOW_UNAVAILABLE");
      return window;
    }
    const initialWindow = currentWindow();
    const db = currentDatabase();
    const initialActor = getCurrentUserDid();
    const generation = getAuthenticationGeneration();
    if (!Number.isSafeInteger(generation) || generation < 0)
      fail("ORG_AUTH_IDENTITY_REQUIRED");
    const getActor = () => {
      if (currentWindow() !== initialWindow)
        fail("ORG_AUTH_WINDOW_UNAVAILABLE");
      if (currentDatabase() !== db) fail("ORG_AUTH_DATABASE_CHANGED");
      const actor = getCurrentUserDid();
      if (typeof actor !== "string" || !actor.startsWith("did:"))
        fail("ORG_AUTH_IDENTITY_REQUIRED");
      if (
        actor !== initialActor ||
        getAuthenticationGeneration() !== generation
      )
        fail("ORG_AUTH_IDENTITY_CHANGED");
      return actor;
    };
    getActor();
    return new OrganizationProjectAuthority({
      db,
      getActor,
      confirm: async ({ kind, actorDid, ...preview }) => {
        if (getActor() !== actorDid) fail("ORG_AUTH_IDENTITY_CHANGED");
        const result = await getElectron().dialog.showMessageBox(
          currentWindow(),
          {
            type: "warning",
            title: "确认组织项目授权",
            message:
              kind === "bind-project"
                ? "将规范项目绑定到组织？绑定后个人任务、风险及目标入口将停止访问该项目。"
                : kind === "revoke-binding"
                  ? "撤销组织项目绑定的使用权限？此操作保留组织归属，不会恢复个人访问。"
                  : "确认以下组织受控权限？旧角色与授权不会自动继承。",
            detail: `当前身份：${display(actorDid)}\n\n操作：${display(kind)}\n\n授权内容：${display(preview)}`,
            buttons: ["取消", "确认"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          },
        );
        return result?.response === 1;
      },
    });
  }
  return Object.freeze({
    createAuthority: service,
    previewPolicy: (event, input) => service(event).previewPolicy(input),
    attestPolicy: (event, input) => service(event).attestPolicy(input),
    previewBinding: (event, input) => service(event).previewBinding(input),
    bindProject: (event, input) => service(event).bindProject(input),
    revokeBinding: (event, input) => service(event).revokeBinding(input),
  });
}

module.exports = { createOrganizationProjectAuthorityHost };
