"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  createBoardReadCheck,
  withBoardReadAccess,
} = require("../board-read-authority.js");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE organization_info (org_id TEXT PRIMARY KEY);
    CREATE TABLE organization_members (org_id TEXT, member_did TEXT, status TEXT);
    CREATE TABLE project_tasks (id TEXT PRIMARY KEY);
    CREATE TABLE task_boards (id TEXT PRIMARY KEY, org_id TEXT);
    CREATE TABLE team_tasks (id TEXT PRIMARY KEY, board_id TEXT);
    CREATE TABLE task_sprints (id TEXT PRIMARY KEY, board_id TEXT);
    CREATE TABLE task_attachments (id TEXT PRIMARY KEY, task_id TEXT);
    CREATE TABLE team_reports (id TEXT PRIMARY KEY, org_id TEXT);
    INSERT INTO organization_info VALUES ('org-1');
    INSERT INTO organization_members VALUES ('org-1', 'did:member', 'active');
    INSERT INTO organization_members VALUES ('org-1', 'did:former', 'removed');
    INSERT INTO task_boards VALUES ('board-1', 'org-1');
    INSERT INTO team_tasks VALUES ('task-1', 'board-1');
    INSERT INTO task_sprints VALUES ('sprint-1', 'board-1');
    INSERT INTO task_attachments VALUES ('attachment-1', 'task-1');
    INSERT INTO team_reports VALUES ('report-1', 'org-1');
  `);
  const frame = { url: "file:///app/index.html" };
  const event = { senderFrame: frame };
  const state = { actor: "did:member", generation: 1, trusted: true };
  const dependencies = {
    getActor: () => state.actor,
    getGeneration: () => state.generation,
    validateSender: () => ({ trusted: state.trusted }),
  };
  return { db, event, state, dependencies };
}

test("active member can read each board-owned reference", () => {
  const f = fixture();
  for (const reference of [
    { orgId: "org-1" },
    { boardId: "board-1" },
    { taskId: "task-1" },
    { sprintId: "sprint-1" },
    { attachmentId: "attachment-1" },
    { reportId: "report-1" },
  ]) {
    assert.doesNotThrow(() =>
      createBoardReadCheck(f.db, f.event, reference, f.dependencies)(),
    );
  }
  f.db.close();
});

test("unknown, removed, and unauthenticated actors cannot read board data", () => {
  const f = fixture();
  for (const actor of ["did:former", "did:outsider", null]) {
    f.state.actor = actor;
    assert.throws(
      () =>
        createBoardReadCheck(
          f.db,
          f.event,
          { boardId: "board-1" },
          f.dependencies,
        ),
      { code: "BOARD_READ_NOT_FOUND_OR_DENIED" },
    );
  }
  assert.throws(
    () =>
      createBoardReadCheck(
        f.db,
        f.event,
        { boardId: "missing" },
        f.dependencies,
      ),
    { code: "BOARD_READ_NOT_FOUND_OR_DENIED" },
  );
  f.db.close();
});

test("invalid scope and untrusted frame fail closed", () => {
  const f = fixture();
  for (const reference of [
    {},
    { boardId: "board-1", orgId: "org-1" },
    { boardId: "" },
    { unknownId: "board-1" },
  ]) {
    assert.throws(
      () => createBoardReadCheck(f.db, f.event, reference, f.dependencies),
      { code: "BOARD_READ_NOT_FOUND_OR_DENIED" },
    );
  }
  f.state.trusted = false;
  assert.throws(
    () =>
      createBoardReadCheck(
        f.db,
        f.event,
        { boardId: "board-1" },
        f.dependencies,
      ),
    { code: "BOARD_READ_NOT_FOUND_OR_DENIED" },
  );
  f.db.close();
});

test("revocation, identity ABA, navigation, and database replacement suppress an in-flight response", async () => {
  for (const change of [
    (f) =>
      f.db
        .prepare(
          "UPDATE organization_members SET status='removed' WHERE member_did='did:member'",
        )
        .run(),
    (f) => f.state.generation++,
    (f) => (f.event.senderFrame.url = "file:///app/other.html"),
    (f) => (f.wrapper.current = new DatabaseSync(":memory:")),
  ]) {
    const f = fixture();
    f.wrapper = {
      current: f.db,
      getDatabase() {
        return this.current;
      },
    };
    let release;
    const pending = withBoardReadAccess(
      f.wrapper,
      f.event,
      { taskId: "task-1" },
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      f.dependencies,
    );
    change(f);
    release({ secret: true });
    await assert.rejects(pending, { code: "BOARD_READ_NOT_FOUND_OR_DENIED" });
    if (f.wrapper.current !== f.db) f.wrapper.current.close();
    f.db.close();
  }
});

test("board read IPC channels enforce membership before manager access", async () => {
  const f = fixture();
  const handlers = new Map();
  const result = { visible: true };
  let managerCalls = 0;
  const manager = new Proxy(
    {},
    {
      get: () => async () => {
        managerCalls++;
        return result;
      },
    },
  );
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === "electron")
      return {
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      };
    if (request === "../utils/logger.js")
      return { logger: { info() {}, error() {} } };
    if (request === "./project-goal-auth-session")
      return {
        getProjectGoalActor: f.dependencies.getActor,
        getProjectGoalAuthGeneration: f.dependencies.getGeneration,
      };
    if (request === "../ipc/ipc-sender-guard")
      return { validateSender: f.dependencies.validateSender };
    if (request === "./task-description-ipc")
      return { registerTaskDescriptionIPC() {} };
    if (request === "./organization-project-ipc")
      return { registerOrganizationProjectIPC: () => ({}) };
    if (request === "./project-goal-ipc")
      return { registerProjectGoalIPC: () => ({}) };
    if (request === "./task-board-manager")
      return { getTaskBoardManager: () => manager };
    if (request === "./team-task-manager")
      return {
        getTeamTaskManager: () => manager,
        TeamTaskManager: class {
          constructor() {
            return manager;
          }
        },
      };
    if (request === "./task-manager") return { getTaskManager: () => manager };
    if (request === "./board-attachment-host")
      return {
        readBoardAttachment: (database, event, kind, params) =>
          withBoardReadAccess(
            database,
            event,
            kind === "list"
              ? { taskId: params.taskId }
              : { attachmentId: params.attachmentId },
            () =>
              kind === "list"
                ? manager.getAttachments()
                : manager.previewAttachment(),
            f.dependencies,
          ),
      };
    if (request === "./team-report-manager")
      return {
        TeamReportManager: class {
          getReportsSync() {
            managerCalls++;
            return result;
          }
        },
      };
    return originalLoad.call(this, request, ...args);
  };
  const ipcPath = path.resolve(__dirname, "../task-ipc.js");
  try {
    delete require.cache[ipcPath];
    require(ipcPath).registerTaskIPC({ getDatabase: () => f.db });
    const cases = [
      ["get-boards", { orgId: "org-1" }],
      ["get-board", { boardId: "board-1" }],
      ["get-tasks", { boardId: "board-1" }],
      ["get-task", { taskId: "task-1" }],
      ["get-sprints", { boardId: "board-1" }],
      ["get-labels", { orgId: "org-1" }],
      ["get-comments", { taskId: "task-1" }],
      ["get-activity", { taskId: "task-1" }],
      ["get-attachments", { taskId: "task-1" }],
      ["preview-attachment", { attachmentId: "attachment-1" }],
      ["get-sprint-stats", { sprintId: "sprint-1" }],
      ["get-reports", { orgId: "org-1" }],
      ["get-board-analytics", { boardId: "board-1" }],
      ["export-board", { boardId: "board-1", format: "json" }],
    ];
    for (const [name, params] of cases) {
      assert.ok(handlers.has(`task:${name}`), name);
      assert.deepEqual(
        await handlers.get(`task:${name}`)(f.event, params),
        name === "get-board" || name === "get-task"
          ? { success: true, [name === "get-board" ? "board" : "task"]: result }
          : result,
      );
    }
    const allowedCalls = managerCalls;
    f.state.actor = "did:outsider";
    for (const [name, params] of cases) {
      await assert.rejects(
        handlers.get(`task:${name}`)(f.event, params),
        { code: "BOARD_READ_NOT_FOUND_OR_DENIED" },
        name,
      );
    }
    assert.equal(managerCalls, allowedCalls);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ipcPath];
    f.db.close();
  }
});
