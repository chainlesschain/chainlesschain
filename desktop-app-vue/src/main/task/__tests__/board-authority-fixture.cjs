"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const Module = require("node:module");
const { DatabaseSync } = require("node:sqlite");
const {
  executeBoardWrite,
  ACTIONS,
  UNSUPPORTED,
} = require("../board-write-authority");

function fixture(filename = ":memory:") {
  let native =
    process.env.CC_BOARD_TEST_SQLITE === "better-sqlite3"
      ? new (require("better-sqlite3"))(filename)
      : new DatabaseSync(filename);
  if (!("isTransaction" in native))
    Object.defineProperty(native, "isTransaction", {
      get: () => native.inTransaction,
    });
  const schema = readFileSync(
    path.resolve(__dirname, "../../database/database-schema.js"),
    "utf8",
  );
  native.exec(
    schema.slice(
      schema.indexOf("      -- 任务看板表"),
      schema.indexOf("      -- 任务管理模块索引"),
    ),
  );
  native.exec(
    schema.match(
      /CREATE TABLE IF NOT EXISTS notifications \([\s\S]*?\n      \);/,
    )[0],
  );
  native.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE organization_info (org_id TEXT PRIMARY KEY, owner_did TEXT);
    CREATE TABLE organization_members (org_id TEXT, member_did TEXT, status TEXT, role TEXT, display_name TEXT);
    CREATE TABLE organization_roles (org_id TEXT, name TEXT, permissions TEXT);
    CREATE TABLE project_tasks (id TEXT PRIMARY KEY);
    INSERT INTO organization_info VALUES ('org-1','did:owner'), ('org-2','did:other');
    INSERT INTO organization_roles VALUES ('org-1', 'owner', '["*"]'),
      ('org-1', 'member', '["board.task.*","board.checklist.*","board.comment.create","board.report.create"]'),
      ('org-1', 'viewer', '["project.read"]');
    INSERT INTO organization_members VALUES
      ('org-1', 'did:owner', 'active', 'owner', 'Owner'),
      ('org-1', 'did:member', 'active', 'member', 'Member'),
      ('org-1', 'did:viewer', 'active', 'viewer', 'Viewer'),
      ('org-1', 'did:former', 'removed', 'owner', 'Former'),
      ('org-1', 'did:impostor', 'active', 'owner', 'Impostor'),
      ('org-2', 'did:other', 'active', 'owner', 'Other');
    INSERT INTO task_boards (id,org_id,name,owner_did,created_at,updated_at) VALUES
      ('board-1','org-1','First','did:owner',1,1),
      ('board-2','org-1','Second','did:owner',1,1),
      ('board-3','org-2','Other','did:other',1,1);
    INSERT INTO task_board_columns (id,board_id,name,position,created_at,updated_at) VALUES
      ('column-1','board-1','Todo',0,1,1),
      ('column-2','board-2','Todo',0,1,1),
      ('column-3','board-3','Todo',0,1,1),
      ('done-1','board-1','Done',1,1,1);
    UPDATE task_board_columns SET is_done_column=1 WHERE id='done-1';
    INSERT INTO team_tasks (id,board_id,column_id,title,reporter_did,created_at,updated_at) VALUES
      ('task-1','board-1','column-1','Original','did:owner',1,1),
      ('task-2','board-2','column-2','Second','did:owner',1,1),
      ('task-3','board-3','column-3','Other','did:other',1,1);
    INSERT INTO task_sprints (id,board_id,name,created_at,updated_at) VALUES
      ('sprint-1','board-1','Sprint 1',1,1), ('sprint-2','board-2','Sprint 2',1,1);
    INSERT INTO task_checklists (id,task_id,title,created_at,updated_at) VALUES ('checklist-1','task-1','List',1,1);
    INSERT INTO task_checklist_items (id,checklist_id,content,created_at,updated_at) VALUES ('item-1','checklist-1','Item',1,1);
    INSERT INTO task_comments (id,task_id,author_did,content,created_at,updated_at) VALUES
      ('comment-1','task-1','did:owner','Original',1,1), ('comment-2','task-2','did:owner','Second',1,1);
    INSERT INTO task_attachments (id,task_id,file_name,file_path,uploader_did,created_at) VALUES ('attachment-1','task-1','file','/unused','did:owner',1);
    INSERT INTO team_reports (id,org_id,board_id,report_type,author_did,report_date,created_at,updated_at) VALUES ('report-1','org-1','board-1','daily_standup','did:owner',1,1,1);
    INSERT INTO task_labels VALUES ('label-1','org-1','Label','#000','',1), ('label-2','org-2','Other','#000','',1);
  `);
  const state = {
    actor: "did:owner",
    generation: 1,
    trusted: true,
    beforeRun: null,
  };
  // Match better-sqlite3's undefined-as-NULL bindings while executing real SQL.
  const db = {
    get inTransaction() {
      return native.isTransaction;
    },
    get open() {
      return native.open !== false;
    },
    transaction(operation) {
      const run = () => {
        native.exec("BEGIN IMMEDIATE");
        try {
          const value = operation();
          native.exec("COMMIT");
          return value;
        } catch (error) {
          native.exec("ROLLBACK");
          throw error;
        }
      };
      run.immediate = run;
      return run;
    },
    exec: (sql) => native.exec(sql),
    prepare(sql) {
      const statement = native.prepare(sql);
      return {
        get: (...args) => statement.get(...args),
        all: (...args) => statement.all(...args),
        run(...args) {
          state.beforeRun?.(sql);
          return statement.run(
            ...args.map((arg) => (arg === undefined ? null : arg)),
          );
        },
      };
    },
  };
  const wrapper = {
    current: db,
    getDatabase() {
      return this.current;
    },
  };
  const event = { senderFrame: { url: "file:///app/index.html" } };
  const dependencies = {
    getActor: () => state.actor,
    getGeneration: () => state.generation,
    validateSender: () => ({ trusted: state.trusted }),
  };
  const write = (action, params) =>
    executeBoardWrite(wrapper, event, action, params, dependencies);
  return {
    get native() {
      return native;
    },
    db,
    wrapper,
    state,
    event,
    dependencies,
    write,
    reopen() {
      assert.notEqual(filename, ":memory:");
      native.close();
      native =
        process.env.CC_BOARD_TEST_SQLITE === "better-sqlite3"
          ? new (require("better-sqlite3"))(filename)
          : new DatabaseSync(filename);
      if (!("isTransaction" in native))
        Object.defineProperty(native, "isTransaction", {
          get: () => native.inTransaction,
        });
      native.exec("PRAGMA foreign_keys=ON");
    },
    close: () => native.close(),
  };
}

// Only the native host/session and logger are replaced. Every manager, SQL
// statement, schema constraint, cascade and transaction runs its production code.
function withHost(f, operation) {
  const handlers = new Map();
  const originalLoad = Module._load;
  const ipcPath = path.resolve(__dirname, "../task-ipc.js");
  Module._load = function (request, ...args) {
    if (request === "electron")
      return {
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        ...f.electron,
      };
    if (request === "../utils/logger.js")
      return { logger: { info() {}, error() {}, warn() {} } };
    if (request === "uuid") return { v4: randomUUID };
    if (request === "./project-goal-auth-session")
      return {
        getProjectGoalActor: f.dependencies.getActor,
        getProjectGoalAuthGeneration: f.dependencies.getGeneration,
      };
    if (request === "../ipc/ipc-sender-guard")
      return { validateSender: f.dependencies.validateSender };
    if (request === "./task-description-ipc")
      return {
        registerTaskDescriptionIPC() {},
        createTaskDescriptionHost: () => ({
          executeCreate: () => ({ canonical: "create" }),
          execute: () => ({ canonical: "update" }),
        }),
      };
    if (request === "./organization-project-ipc")
      return { registerOrganizationProjectIPC: () => ({}) };
    if (request === "./project-goal-ipc")
      return { registerProjectGoalIPC: () => ({}) };
    return originalLoad.call(this, request, ...args);
  };
  delete require.cache[ipcPath];
  require(ipcPath).registerTaskIPC(f.wrapper);
  const restore = () => {
    Module._load = originalLoad;
    delete require.cache[ipcPath];
  };
  try {
    const result = operation(handlers);
    if (result?.then) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function inputFor(action) {
  const inputs = {
    "generate-ai-summary": { reportId: "report-1", requestId: randomUUID() },
    "create-board": {
      orgId: "org-1",
      name: "New board",
      ownerDid: "did:forged",
    },
    "update-board": { boardId: "board-1", updates: { name: "Changed" } },
    "delete-board": { boardId: "board-2" },
    "archive-board": { boardId: "board-1" },
    "create-column": {
      boardId: "board-1",
      columnData: { name: "Review", position: 2 },
    },
    "update-column": { columnId: "column-1", updates: { name: "Changed" } },
    "reorder-columns": {
      boardId: "board-1",
      columnOrder: ["done-1", "column-1"],
    },
    "create-label": { orgId: "org-1", name: "New label" },
    "create-task": {
      boardId: "board-1",
      columnId: "column-1",
      title: "Created",
      createdBy: "did:forged",
      reporterDid: "did:forged",
    },
    "update-task": {
      taskId: "task-1",
      updates: { estimatedHours: 2 },
      actorDid: "did:forged",
    },
    "delete-task": { taskId: "task-1" },
    "move-task": { taskId: "task-1", columnId: "done-1" },
    "assign-task": {
      taskId: "task-1",
      userDid: "did:member",
      assignedBy: "did:forged",
    },
    "set-priority": { taskId: "task-1", priority: "high" },
    "upload-attachment": { taskId: "task-1" },
    "delete-attachment": { attachmentId: "attachment-1" },
    "mention-user": {
      taskId: "task-1",
      userDid: "did:member",
      mentionedBy: "did:forged",
    },
    "set-due-date": { taskId: "task-1", dueDate: "2026-10-20" },
    "create-checklist": { taskId: "task-1", title: "New checklist" },
    "add-checklist-item": {
      checklistId: "checklist-1",
      content: "New item",
      assigneeDid: "did:member",
    },
    "add-comment": {
      taskId: "task-1",
      comment: {
        content: "New comment",
        authorDid: "did:forged",
        authorName: "Forged",
        parentId: "comment-1",
        mentions: ["did:member"],
      },
    },
    "add-label": { taskId: "task-1", labelId: "label-1" },
    "link-tasks": {
      taskId: "task-1",
      dependsOnTaskId: "task-peer",
      dependencyType: "blocks",
    },
    "create-subtask": {
      parentTaskId: "task-1",
      subtaskData: { title: "Child", createdBy: "did:forged" },
    },
    "convert-to-subtask": { taskId: "task-peer", parentTaskId: "task-1" },
    "toggle-checklist-item": { itemId: "item-1", completedBy: "did:forged" },
    "delete-checklist-item": { itemId: "item-1" },
    "reorder-checklist": { checklistId: "checklist-1", itemOrder: ["item-1"] },
    "edit-comment": {
      commentId: "comment-1",
      content: "Edited",
      editorDid: "did:forged",
    },
    "delete-comment": { commentId: "comment-1", deleterDid: "did:forged" },
    "create-sprint": { boardId: "board-1", sprintData: { name: "New sprint" } },
    "start-sprint": { sprintId: "sprint-1" },
    "complete-sprint": { sprintId: "sprint-1" },
    "move-to-sprint": { taskIds: ["task-1"], sprintId: "sprint-1" },
    "create-report": {
      orgId: "org-1",
      boardId: "board-1",
      authorDid: "did:forged",
      authorName: "Forged",
    },
  };
  if (inputs[action]) return inputs[action];
  const kind = UNSUPPORTED[action];
  return {
    [kind]: {
      taskId: "task-1",
      parentTaskId: "task-1",
      itemId: "item-1",
      checklistId: "checklist-1",
      commentId: "comment-1",
      attachmentId: "attachment-1",
      reportId: "report-1",
    }[kind],
  };
}

function snapshot(f) {
  const tables = f.native
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  return tables.map(({ name }) => [
    name,
    f.native.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
  ]);
}

function notificationHost(f, handlers = new Map()) {
  const window = { isDestroyed: () => false };
  f.event.sender = { isDestroyed: () => false };
  const shown = [];
  const electron = {
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    BrowserWindow: { fromWebContents: () => window },
    Notification: class {
      static isSupported() {
        return true;
      }
      show() {
        shown.push(true);
      }
    },
  };
  require("../../notification/notification-ipc").registerNotificationIPC({
    database: f.wrapper,
    electron,
    getActor: f.dependencies.getActor,
    getAuthGeneration: f.dependencies.getGeneration,
    validateSender: f.dependencies.validateSender,
  });
  return {
    handlers,
    shown,
    call: (name, ...args) =>
      handlers.get(`notification:${name}`)(f.event, ...args),
  };
}

module.exports = { fixture, withHost, inputFor, snapshot, notificationHost };
