const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { DatabaseSync } = require("node:sqlite");

const handlers = new Map();
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE project_tasks (id TEXT PRIMARY KEY);
  CREATE TABLE team_tasks (id TEXT PRIMARY KEY);
  CREATE TABLE task_checklists (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
  CREATE TABLE task_checklist_items (id TEXT PRIMARY KEY, checklist_id TEXT NOT NULL);
  CREATE TABLE task_comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
  CREATE TABLE task_attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
  INSERT INTO project_tasks VALUES ('task-1');
  INSERT INTO team_tasks VALUES ('other-task');
  INSERT INTO task_checklists VALUES ('checklist-1', 'task-1');
  INSERT INTO task_checklist_items VALUES ('item-1', 'checklist-1');
  INSERT INTO task_comments VALUES ('comment-1', 'task-1');
  INSERT INTO task_attachments VALUES ('attachment-1', 'task-1');
`);
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === "electron") {
    return {
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    };
  }
  if (request === "../utils/logger.js") {
    return { logger: { info() {}, error() {} } };
  }
  if (request === "./task-description-ipc") {
    return { registerTaskDescriptionIPC() {} };
  }
  if (request === "./organization-project-ipc") {
    return { registerOrganizationProjectIPC: () => ({}) };
  }
  if (request === "./project-goal-ipc") {
    return { registerProjectGoalIPC: () => ({}) };
  }
  if (request === "./team-task-manager") {
    return {
      getTeamTaskManager: () => ({
        createChecklist: async () => ({ success: true }),
      }),
    };
  }
  return originalLoad.call(this, request, ...args);
};
try {
  require(
    path.resolve(__dirname, "../src/main/task/task-ipc.js"),
  ).registerTaskIPC({ getDatabase: () => db });
} catch (error) {
  Module._load = originalLoad;
  throw error;
}

const cases = [
  ["create-checklist", { taskId: "task-1" }],
  ["add-checklist-item", { checklistId: "checklist-1" }],
  ["toggle-checklist-item", { itemId: "item-1" }],
  ["delete-checklist-item", { itemId: "item-1" }],
  ["reorder-checklist", { checklistId: "checklist-1" }],
  ["add-comment", { taskId: "task-1" }],
  ["add-comment", { taskId: "other-task", comment: { parentId: "comment-1" } }],
  ["edit-comment", { commentId: "comment-1" }],
  ["delete-comment", { commentId: "comment-1" }],
  ["get-comments", { taskId: "task-1" }],
  ["get-activity", { taskId: "task-1" }],
  ["mention-user", { taskId: "task-1" }],
  ["upload-attachment", { taskId: "task-1" }],
  ["delete-attachment", { attachmentId: "attachment-1" }],
  ["get-attachments", { taskId: "task-1" }],
  ["preview-attachment", { attachmentId: "attachment-1" }],
];
(async () => {
  for (const [name, params] of cases) {
    await assert.rejects(
      handlers.get(`task:${name}`)({}, { taskId: "other-task", ...params }),
      /ACTION_CONTROLLED_TASK_REQUIRED/,
      name,
    );
  }
  assert.deepEqual(
    await handlers.get("task:create-checklist")({}, { taskId: "other-task" }),
    { success: true },
  );
  process.stdout.write(
    `Passed ${cases.length} guarded IPC cases and team task path\n`,
  );
})()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
    db.close();
  });
