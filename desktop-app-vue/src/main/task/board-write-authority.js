"use strict";

const { randomUUID } = require("node:crypto");
const { createBoardReadCheck } = require("./board-read-authority");

function fail(code = "BOARD_WRITE_NOT_FOUND_OR_DENIED") {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// These permissions belong to board tasks, independently of canonical actions.
// Resolve current role permissions from SQLite on every call, without the legacy
// report-only RBAC guard, cached grants, or renderer-supplied actor identities.
const ACTIONS = Object.freeze({
  "create-board": ["board.create", "orgId", "board", "createBoard"],
  "update-board": ["board.update", "boardId", "board", "updateBoard"],
  "delete-board": ["board.delete", "boardId", "board", "deleteBoard"],
  "archive-board": ["board.archive", "boardId", "board", "archiveBoard"],
  "create-column": ["board.column.create", "boardId", "board", "createColumn"],
  "update-column": ["board.column.update", "columnId", "board", "updateColumn"],
  "reorder-columns": [
    "board.column.reorder",
    "boardId",
    "board",
    "reorderColumns",
  ],
  "create-label": ["board.label.create", "orgId", "board", "createLabel"],
  "create-task": ["board.task.create", "boardId", "task", "createTask"],
  "update-task": ["board.task.update", "taskId", "task", "updateTask"],
  "delete-task": ["board.task.delete", "taskId", "task", "deleteTask"],
  "move-task": ["board.task.move", "taskId", "task", "moveTask"],
  "assign-task": ["board.task.assign", "taskId", "task", "assignTask"],
  "set-priority": ["board.task.set-priority", "taskId", "task", "setPriority"],
  "set-due-date": ["board.task.set-due-date", "taskId", "task", "setDueDate"],
  "create-checklist": [
    "board.checklist.create",
    "taskId",
    "task",
    "createChecklist",
  ],
  "add-checklist-item": [
    "board.checklist.item.add",
    "checklistId",
    "task",
    "addChecklistItem",
  ],
  "add-comment": ["board.comment.create", "taskId", "task", "addComment"],
  "mention-user": ["board.task.mention", "taskId", "task", "mentionUser"],
  "upload-attachment": [
    "board.attachment.upload",
    "taskId",
    "attachment",
    "uploadAttachment",
  ],
  "delete-attachment": [
    "board.attachment.delete",
    "attachmentId",
    "attachment",
    "deleteAttachment",
  ],
  "add-label": ["board.task.label", "taskId", "task", "addLabel"],
  "link-tasks": ["board.task.link", "taskId", "task", "linkTasks"],
  "create-subtask": [
    "board.task.subtask",
    "parentTaskId",
    "task",
    "createSubtask",
  ],
  "convert-to-subtask": [
    "board.task.subtask",
    "taskId",
    "task",
    "convertToSubtask",
  ],
  "toggle-checklist-item": [
    "board.checklist.item.toggle",
    "itemId",
    "task",
    "toggleChecklistItem",
  ],
  "delete-checklist-item": [
    "board.checklist.item.delete",
    "itemId",
    "task",
    "deleteChecklistItem",
  ],
  "reorder-checklist": [
    "board.checklist.reorder",
    "checklistId",
    "task",
    "reorderChecklist",
  ],
  "edit-comment": ["board.comment.edit", "commentId", "task", "editComment"],
  "delete-comment": [
    "board.comment.delete",
    "commentId",
    "task",
    "deleteComment",
  ],
  "create-sprint": ["board.sprint.create", "boardId", "board", "createSprint"],
  "start-sprint": ["board.sprint.start", "sprintId", "board", "startSprint"],
  "complete-sprint": [
    "board.sprint.complete",
    "sprintId",
    "board",
    "completeSprint",
  ],
  "move-to-sprint": [
    "board.sprint.assign",
    "sprintId",
    "board",
    "moveToSprint",
  ],
  "create-report": ["board.report.create", "orgId", "report", "createReport"],
  "generate-ai-summary": [
    "board.report.ai-summary",
    "reportId",
    "summary",
    "generateAISummary",
  ],
});

const UNSUPPORTED = Object.freeze({});

const REFERENCES = Object.freeze({
  orgId:
    "SELECT org_id AS orgId, NULL AS boardId FROM organization_info WHERE org_id=?",
  boardId: "SELECT org_id AS orgId, id AS boardId FROM task_boards WHERE id=?",
  columnId:
    "SELECT b.org_id AS orgId, b.id AS boardId FROM task_board_columns c JOIN task_boards b ON b.id=c.board_id WHERE c.id=?",
  taskId:
    "SELECT b.org_id AS orgId, b.id AS boardId FROM team_tasks t JOIN task_boards b ON b.id=t.board_id WHERE t.id=?",
  sprintId:
    "SELECT b.org_id AS orgId, b.id AS boardId FROM task_sprints s JOIN task_boards b ON b.id=s.board_id WHERE s.id=?",
  checklistId:
    "SELECT b.org_id AS orgId, b.id AS boardId FROM task_checklists c JOIN team_tasks t ON t.id=c.task_id JOIN task_boards b ON b.id=t.board_id WHERE c.id=?",
  itemId:
    "SELECT b.org_id AS orgId, b.id AS boardId FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id JOIN team_tasks t ON t.id=c.task_id JOIN task_boards b ON b.id=t.board_id WHERE i.id=?",
  commentId:
    "SELECT b.org_id AS orgId, b.id AS boardId FROM task_comments c JOIN team_tasks t ON t.id=c.task_id JOIN task_boards b ON b.id=t.board_id WHERE c.id=?",
  attachmentId:
    "SELECT b.org_id AS orgId, b.id AS boardId FROM task_attachments a JOIN team_tasks t ON t.id=a.task_id JOIN task_boards b ON b.id=t.board_id WHERE a.id=?",
  reportId:
    "SELECT org_id AS orgId, board_id AS boardId FROM team_reports WHERE id=?",
});

function scopeFor(db, kind, id) {
  if (typeof id !== "string" || !id || id.length > 512) fail();
  const row = db.prepare(REFERENCES[kind]).get(id);
  if (!row || typeof row.orgId !== "string") fail();
  return row;
}

function requirePermission(db, orgId, actor, permission) {
  const row = db
    .prepare(
      "SELECT r.permissions, m.role, o.owner_did AS ownerDid, m.display_name AS displayName FROM organization_members m JOIN organization_info o ON o.org_id=m.org_id JOIN organization_roles r ON r.org_id=m.org_id AND r.name=m.role WHERE m.org_id=? AND m.member_did=? AND m.status='active'",
    )
    .get(orgId, actor);
  if (row?.role === "owner" && row.ownerDid !== actor) fail();
  let permissions;
  try {
    permissions = JSON.parse(row?.permissions || "[]");
  } catch (_error) {
    fail();
  }
  if (
    !Array.isArray(permissions) ||
    !permissions.every((p) => typeof p === "string")
  )
    fail();
  const parts = permission.split(".");
  const allowed = ["*", permission];
  for (let i = 1; i < parts.length; i++)
    allowed.push(`${parts.slice(0, i).join(".")}.*`);
  if (!permissions.some((p) => allowed.includes(p))) fail();
  return row.displayName || "";
}

function boundedIds(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 500 ||
    new Set(value).size !== value.length
  )
    fail("BOARD_WRITE_INVALID_REQUEST");
  return value;
}

function requireText(value, limit = 100000) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    fail("BOARD_WRITE_INVALID_REQUEST");
}

function requireParentChain(db, parentId, boardId, taskId = null) {
  const visited = new Set(taskId ? [taskId] : []);
  let nodeCount = 1;
  for (let id = parentId; id !== null; ) {
    if (visited.has(id)) fail("BOARD_WRITE_CYCLE");
    if (nodeCount >= 500) fail("BOARD_WRITE_GRAPH_LIMIT");
    nodeCount++;
    visited.add(id);
    const row = db
      .prepare("SELECT parent_task_id,board_id FROM team_tasks WHERE id=?")
      .get(id);
    if (!row || row.board_id !== boardId) fail("BOARD_WRITE_SCOPE_CONFLICT");
    id = row.parent_task_id;
  }
}

// Normalize precedence: blocks(A,B) means A -> B; blocked_by(A,B) means
// B -> A. Symmetric relates_to/duplicates links do not impose precedence.
function requireDependencyGraph(db, scope, p) {
  const type = p.dependencyType ?? "blocks";
  if (!["blocks", "blocked_by", "relates_to", "duplicates"].includes(type))
    fail("BOARD_WRITE_INVALID_REQUEST");
  if (p.taskId === p.dependsOnTaskId) fail("BOARD_WRITE_CYCLE");
  if (!["blocks", "blocked_by"].includes(type)) return;
  const rows = db
    .prepare(
      `SELECT d.task_id,d.depends_on_task_id,d.dependency_type
    FROM task_dependencies d JOIN team_tasks t ON t.id=d.task_id
    WHERE t.board_id=? AND d.dependency_type IN ('blocks','blocked_by') LIMIT 2001`,
    )
    .all(scope.boardId);
  if (rows.length > 2000) fail("BOARD_WRITE_GRAPH_LIMIT");
  const exists = rows.some(
    (row) =>
      row.task_id === p.taskId &&
      row.depends_on_task_id === p.dependsOnTaskId &&
      row.dependency_type === type,
  );
  if (!exists && rows.length >= 2000) fail("BOARD_WRITE_GRAPH_LIMIT");
  rows.push({
    task_id: p.taskId,
    depends_on_task_id: p.dependsOnTaskId,
    dependency_type: type,
  });
  const edges = new Map(),
    degrees = new Map();
  for (const row of rows) {
    const [from, to] =
      row.dependency_type === "blocks"
        ? [row.task_id, row.depends_on_task_id]
        : [row.depends_on_task_id, row.task_id];
    if (!edges.has(from)) edges.set(from, new Set());
    if (!degrees.has(from)) degrees.set(from, 0);
    if (!degrees.has(to)) degrees.set(to, 0);
    if (!edges.get(from).has(to)) {
      edges.get(from).add(to);
      degrees.set(to, degrees.get(to) + 1);
    }
  }
  const queue = [...degrees].filter(([, n]) => n === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++)
    for (const to of edges.get(queue[i]) || []) {
      degrees.set(to, degrees.get(to) - 1);
      if (degrees.get(to) === 0) queue.push(to);
    }
  if (queue.length !== degrees.size) fail("BOARD_WRITE_CYCLE");
}

function commentPermissions(db, action, p, actor) {
  if (!["edit-comment", "delete-comment"].includes(action)) return [];
  const root = db
    .prepare("SELECT task_id,author_did FROM task_comments WHERE id=?")
    .get(p.commentId);
  if (!root) fail();
  let otherAuthor = root.author_did !== actor;
  if (action === "delete-comment") {
    const rows = db
      .prepare(
        `WITH RECURSIVE replies(id) AS (
      SELECT id FROM task_comments WHERE id=?
      UNION SELECT c.id FROM task_comments c JOIN replies r ON c.parent_id=r.id LIMIT 501
    ) SELECT c.id,c.task_id,c.parent_id,c.author_did FROM task_comments c JOIN replies r ON r.id=c.id LIMIT 501`,
      )
      .all(p.commentId);
    if (rows.length > 500) fail("BOARD_WRITE_GRAPH_LIMIT");
    if (rows.some((row) => row.task_id !== root.task_id))
      fail("BOARD_WRITE_SCOPE_CONFLICT");
    const parents = new Map(rows.map((row) => [row.id, row.parent_id]));
    const visited = new Set();
    for (let id = p.commentId; parents.has(id); id = parents.get(id)) {
      if (visited.has(id)) fail("BOARD_WRITE_CYCLE");
      visited.add(id);
    }
    otherAuthor ||= rows.some((row) => row.author_did !== actor);
  }
  return otherAuthor ? ["board.comment.moderate"] : [];
}

// Historical bad links must not let a cascade or sprint bulk update touch a
// different board. Refuse them rather than silently repairing ownership.
function requireBoardIntegrity(db, boardId) {
  if (!boardId) return;
  const bad = db
    .prepare(
      `
    SELECT 1 FROM team_tasks t
    LEFT JOIN task_board_columns c ON c.id=t.column_id
    LEFT JOIN team_tasks p ON p.id=t.parent_task_id
    LEFT JOIN task_sprints s ON s.id=t.sprint_id
    WHERE (t.board_id=? OR c.board_id=? OR p.board_id=? OR s.board_id=?)
      AND (c.id IS NULL OR c.board_id<>t.board_id
        OR (t.parent_task_id IS NOT NULL AND (p.id IS NULL OR p.board_id<>t.board_id))
        OR (t.sprint_id IS NOT NULL AND (s.id IS NULL OR s.board_id<>t.board_id))) LIMIT 1
  `,
    )
    .get(boardId, boardId, boardId, boardId);
  const badComment = db
    .prepare(
      `
    SELECT 1 FROM task_comments c LEFT JOIN task_comments p ON p.id=c.parent_id
    LEFT JOIN team_tasks t ON t.id=c.task_id LEFT JOIN team_tasks pt ON pt.id=p.task_id
    WHERE c.parent_id IS NOT NULL AND (t.board_id=? OR pt.board_id=?)
      AND (p.id IS NULL OR t.id IS NULL OR pt.id IS NULL OR t.board_id<>pt.board_id) LIMIT 1
  `,
    )
    .get(boardId, boardId);
  const badDependency = db
    .prepare(
      `
    SELECT 1 FROM task_dependencies d LEFT JOIN team_tasks t ON t.id=d.task_id
    LEFT JOIN team_tasks p ON p.id=d.depends_on_task_id
    WHERE (t.board_id=? OR p.board_id=?)
      AND (t.id IS NULL OR p.id IS NULL OR t.board_id<>p.board_id) LIMIT 1
  `,
    )
    .get(boardId, boardId);
  const badReport = db
    .prepare(
      `
    SELECT 1 FROM team_reports r JOIN task_boards b ON b.id=r.board_id
    WHERE b.id=? AND r.org_id<>b.org_id LIMIT 1
  `,
    )
    .get(boardId);
  if (bad || badComment || badDependency || badReport)
    fail("BOARD_WRITE_SCOPE_CONFLICT");
}

function validateReferences(db, action, p, scope) {
  const same = (kind, id, board = true) => {
    const other = scopeFor(db, kind, id);
    if (
      other.orgId !== scope.orgId ||
      (board && other.boardId !== scope.boardId)
    )
      fail("BOARD_WRITE_SCOPE_CONFLICT");
  };
  const member = (did) => {
    if (did == null || did === "") return;
    if (
      typeof did !== "string" ||
      !db
        .prepare(
          "SELECT 1 FROM organization_members WHERE org_id=? AND member_did=? AND status='active'",
        )
        .get(scope.orgId, did)
    )
      fail();
  };
  if (p.orgId != null && p.orgId !== scope.orgId)
    fail("BOARD_WRITE_SCOPE_CONFLICT");
  if (p.boardId != null) same("boardId", p.boardId, !!scope.boardId);
  if (["create-task", "create-subtask"].includes(action)) {
    const creation = action === "create-subtask" ? p.subtaskData : p;
    if (!creation || typeof creation !== "object" || Array.isArray(creation))
      fail("BOARD_WRITE_INVALID_REQUEST");
    requireText(creation.title, 1024);
    const parentId = p.parentTaskId;
    if (creation.boardId != null) same("boardId", creation.boardId);
    if (action === "create-subtask") {
      if (
        (creation.parentTaskId != null &&
          creation.parentTaskId !== p.parentTaskId) ||
        (creation.taskType != null && creation.taskType !== "subtask")
      )
        fail("BOARD_WRITE_INVALID_REQUEST");
    }
    if (action === "create-task" || creation.columnId != null)
      same("columnId", creation.columnId);
    if (parentId != null) {
      same("taskId", parentId);
      requireParentChain(db, parentId, scope.boardId);
      if (creation.taskType != null && creation.taskType !== "subtask")
        fail("BOARD_WRITE_INVALID_REQUEST");
    } else if (creation.taskType === "subtask")
      fail("BOARD_WRITE_INVALID_REQUEST");
    if (creation.sprintId != null) same("sprintId", creation.sprintId);
    member(creation.assigneeDid);
    if (creation.labels != null) {
      if (!Array.isArray(creation.labels) || creation.labels.length > 500)
        fail("BOARD_WRITE_INVALID_REQUEST");
      for (const id of creation.labels) {
        if (
          typeof id !== "string" ||
          db.prepare("SELECT org_id FROM task_labels WHERE id=?").get(id)
            ?.org_id !== scope.orgId
        )
          fail("BOARD_WRITE_SCOPE_CONFLICT");
      }
    }
  }
  if (["update-task", "controlled-update"].includes(action)) {
    if (!p.updates || typeof p.updates !== "object" || Array.isArray(p.updates))
      fail("BOARD_WRITE_INVALID_REQUEST");
    // The current core cannot change scope/attribution through generic updates.
    const fields = new Set([
      "title",
      "description",
      "status",
      "priority",
      "assigneeDid",
      "dueDate",
      "estimatedHours",
      "actualHours",
    ]);
    if (Object.keys(p.updates).some((k) => !fields.has(k)))
      fail("BOARD_WRITE_INVALID_REQUEST");
    if (action === "update-task")
      fail("BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED");
    member(p.updates.assigneeDid);
  }
  if (action === "move-task") same("columnId", p.columnId);
  if (action === "assign-task") {
    if (typeof p.userDid !== "string" || !p.userDid) fail();
    member(p.userDid);
  }
  if (action === "mention-user") {
    requireText(p.userDid, 1024);
    if (!p.userDid.startsWith("did:")) fail("BOARD_WRITE_INVALID_REQUEST");
    member(p.userDid);
  }
  if (action === "add-checklist-item") member(p.assigneeDid);
  if (action === "toggle-checklist-item") {
    const item = db
      .prepare("SELECT is_done FROM task_checklist_items WHERE id=?")
      .get(p.itemId);
    if (![0, 1].includes(item?.is_done)) fail("BOARD_WRITE_INVALID_REQUEST");
  }
  if (action === "add-label") {
    const task = db
      .prepare("SELECT labels FROM team_tasks WHERE id=?")
      .get(p.taskId);
    let labels;
    try {
      labels = task.labels == null ? [] : JSON.parse(task.labels);
    } catch {
      fail("BOARD_WRITE_INVALID_LABELS");
    }
    if (
      !Array.isArray(labels) ||
      labels.length > 500 ||
      labels.some((id) => typeof id !== "string")
    )
      fail("BOARD_WRITE_INVALID_LABELS");
    if (labels.length >= 500 && !labels.includes(p.labelId))
      fail("BOARD_WRITE_INVALID_LABELS");
    for (const id of [...labels, p.labelId])
      if (
        typeof id !== "string" ||
        db.prepare("SELECT org_id FROM task_labels WHERE id=?").get(id)
          ?.org_id !== scope.orgId
      )
        fail("BOARD_WRITE_SCOPE_CONFLICT");
  }
  if (action === "link-tasks") {
    same("taskId", p.dependsOnTaskId);
    requireDependencyGraph(db, scope, p);
  }
  if (action === "convert-to-subtask") {
    same("taskId", p.parentTaskId);
    requireParentChain(db, p.parentTaskId, scope.boardId, p.taskId);
  }
  if (action === "reorder-checklist") {
    if (
      !Array.isArray(p.itemOrder) ||
      p.itemOrder.length > 500 ||
      new Set(p.itemOrder).size !== p.itemOrder.length
    )
      fail("BOARD_WRITE_INVALID_REQUEST");
    const items = db
      .prepare(
        "SELECT id FROM task_checklist_items WHERE checklist_id=? LIMIT 501",
      )
      .all(p.checklistId);
    const ids = new Set(items.map((item) => item.id));
    if (
      items.length !== p.itemOrder.length ||
      p.itemOrder.some((id) => !ids.has(id))
    )
      fail("BOARD_WRITE_SCOPE_CONFLICT");
  }
  if (action === "edit-comment") requireText(p.content);
  if (action === "reorder-columns") {
    for (const id of boundedIds(p.columnOrder)) same("columnId", id);
  }
  if (action === "move-to-sprint") {
    for (const id of boundedIds(p.taskIds)) same("taskId", id);
  }
  if (action === "add-comment") {
    if (!p.comment || typeof p.comment !== "object")
      fail("BOARD_WRITE_INVALID_REQUEST");
    if (p.comment.parentId != null) {
      same("commentId", p.comment.parentId);
      if (
        db
          .prepare("SELECT task_id FROM task_comments WHERE id=?")
          .get(p.comment.parentId)?.task_id !== p.taskId
      )
        fail("BOARD_WRITE_SCOPE_CONFLICT");
    }
    if (p.comment.mentions != null) {
      if (!Array.isArray(p.comment.mentions) || p.comment.mentions.length > 100)
        fail("BOARD_WRITE_INVALID_REQUEST");
      for (const did of p.comment.mentions) member(did);
    }
  }
}

function argumentsFor(action, p, actor, displayName, dependencies) {
  switch (action) {
    case "create-board":
      return [{ ...p, ownerDid: actor }];
    case "update-board":
      return [p.boardId, p.updates];
    case "delete-board":
    case "archive-board":
      return [p.boardId];
    case "create-column":
      return [p.boardId, p.columnData];
    case "update-column":
      return [p.columnId, p.updates];
    case "reorder-columns":
      return [p.boardId, p.columnOrder];
    case "create-label":
      return [p.orgId, p];
    case "create-task":
      return [
        {
          ...p,
          ...(p.parentTaskId != null ? { taskType: "subtask" } : {}),
          createdBy: actor,
          reporterDid: actor,
        },
      ];
    case "update-task":
      return [p.taskId, p.updates, actor];
    case "delete-task":
      return [p.taskId];
    case "move-task":
      return [p.taskId, p.columnId, p.position, actor];
    case "assign-task":
      return [p.taskId, p.userDid, p.role, actor];
    case "mention-user":
      return [p.taskId, p.userDid, actor];
    case "upload-attachment":
      return [p.taskId, dependencies.attachmentPayload, actor];
    case "delete-attachment":
      return [p.attachmentId, actor];
    case "set-priority":
      return [p.taskId, p.priority, actor];
    case "set-due-date":
      return [p.taskId, p.dueDate, actor];
    case "create-checklist":
      return [p.taskId, p.title];
    case "add-checklist-item":
      return [p.checklistId, p.content, p.assigneeDid];
    case "add-label":
      return [p.taskId, p.labelId, actor];
    case "link-tasks":
      return [p.taskId, p.dependsOnTaskId, p.dependencyType ?? "blocks", actor];
    case "create-subtask":
      return [p.parentTaskId, p.subtaskData, actor];
    case "convert-to-subtask":
      return [p.taskId, p.parentTaskId, actor];
    case "toggle-checklist-item":
    case "delete-checklist-item":
      return [p.itemId, actor];
    case "reorder-checklist":
      return [p.checklistId, p.itemOrder, actor];
    case "edit-comment":
      return [p.commentId, p.content, actor];
    case "delete-comment":
      return [p.commentId, actor];
    case "add-comment":
      return [
        p.taskId,
        { ...p.comment, authorDid: actor, authorName: displayName },
      ];
    case "create-sprint":
      return [p.boardId, p.sprintData];
    case "start-sprint":
    case "complete-sprint":
      return [p.sprintId];
    case "move-to-sprint":
      return [p.taskIds, p.sprintId];
    case "create-report":
      return [
        {
          ...p,
          boardId: p.boardId ?? null,
          authorDid: actor,
          authorName: displayName,
        },
      ];
    default:
      fail("BOARD_WRITE_UNSUPPORTED");
  }
}

function createManager(kind, db) {
  const wrapper = { getDatabase: () => db };
  // A singleton can still hold a previously opened vault. Writes use an instance
  // tied to the same SQLite connection that is checked and transacted here.
  if (kind === "board")
    return new (require("./task-board-manager").TaskBoardManager)(wrapper);
  if (kind === "task")
    return new (require("./team-task-manager").TeamTaskManager)(wrapper);
  if (kind === "attachment")
    return new (require("./board-attachment-store").BoardAttachmentStore)(
      wrapper,
    );
  return new (require("./team-report-manager").TeamReportManager)(wrapper);
}

function authorizeBoardWrite(
  database,
  event,
  action,
  params,
  dependencies = {},
) {
  const spec = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!spec && !Object.hasOwn(UNSUPPORTED, action))
    fail("BOARD_WRITE_UNSUPPORTED");
  if (!params || typeof params !== "object" || Array.isArray(params))
    fail("BOARD_WRITE_INVALID_REQUEST");
  const db = database?.getDatabase ? database.getDatabase() : database;
  if (!db?.prepare || !db?.exec) fail();
  const getActor =
    dependencies.getActor ||
    require("./project-goal-auth-session").getProjectGoalActor;
  const getGeneration =
    dependencies.getGeneration ||
    require("./project-goal-auth-session").getProjectGoalAuthGeneration;
  const validateSender =
    dependencies.validateSender ||
    require("../ipc/ipc-sender-guard").validateSender;
  const actor = getActor();
  if (
    typeof actor !== "string" ||
    !actor.startsWith("did:") ||
    !Number.isSafeInteger(getGeneration()) ||
    !event?.senderFrame ||
    validateSender(event)?.trusted !== true
  )
    fail();
  const kind = spec?.[1] || UNSUPPORTED[action];
  const referenceKind = kind === "parentTaskId" ? "taskId" : kind;
  const scope = scopeFor(db, referenceKind, params[kind]);
  // Preserve the original organization for deletes; re-resolving the removed
  // target after a successful write would reject every valid deletion.
  let check;
  try {
    check = createBoardReadCheck(
      database,
      event,
      { orgId: scope.orgId },
      dependencies,
    );
  } catch (_error) {
    fail();
  }
  const requiredPermissions = [spec?.[0] || "board.unsupported"];
  if (action === "generate-ai-summary")
    requiredPermissions.push("board.report.ai.local-send");
  if (action === "update-task") {
    for (const [field, permission] of [
      ["assigneeDid", "board.task.assign"],
      ["priority", "board.task.set-priority"],
      ["dueDate", "board.task.set-due-date"],
      ["columnId", "board.task.move"],
      ["position", "board.task.move"],
    ]) {
      if (params.updates && Object.hasOwn(params.updates, field))
        requiredPermissions.push(permission);
    }
  }
  if (["create-task", "create-subtask"].includes(action)) {
    const creation = action === "create-subtask" ? params.subtaskData : params;
    if (action === "create-subtask")
      requiredPermissions.push("board.task.create");
    if (action === "create-task" && params.parentTaskId != null)
      requiredPermissions.push("board.task.subtask");
    if (creation?.assigneeDid) requiredPermissions.push("board.task.assign");
    if (creation?.sprintId) requiredPermissions.push("board.sprint.assign");
  }
  if (action === "convert-to-subtask")
    requiredPermissions.push("board.task.update");
  const checkAuthority = () => {
    try {
      check();
    } catch (_error) {
      fail();
    }
    if (getActor() !== actor) fail();
    let name;
    for (const permission of requiredPermissions)
      name = requirePermission(db, scope.orgId, actor, permission);
    return name;
  };
  const displayName = checkAuthority();
  if (!spec) fail("BOARD_WRITE_UNSUPPORTED");
  const checkTarget = () => {
    checkAuthority();
    const current = scopeFor(db, referenceKind, params[kind]);
    if (current.orgId !== scope.orgId || current.boardId !== scope.boardId)
      fail("BOARD_WRITE_SCOPE_CONFLICT");
  };
  return {
    db,
    actor,
    spec,
    scope,
    kind,
    referenceKind,
    requiredPermissions,
    displayName,
    checkAuthority,
    checkTarget,
  };
}

function executeBoardWrite(database, event, action, params, dependencies = {}) {
  const {
    db,
    actor,
    spec,
    scope,
    kind,
    referenceKind,
    requiredPermissions,
    displayName,
    checkAuthority,
  } = authorizeBoardWrite(database, event, action, params, dependencies);
  if (
    [
      "update-task",
      "assign-task",
      "set-priority",
      "set-due-date",
      "move-task",
      "create-task",
      "create-subtask",
    ].includes(action)
  )
    fail("BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED");
  // This action requires native review, governed model evidence and a durable
  // attempt ledger. It cannot use a synchronous manager or caller payload.
  if (action === "generate-ai-summary")
    fail("BOARD_SUMMARY_NATIVE_HOST_REQUIRED");
  const savepoint = `board_write_${randomUUID().replaceAll("-", "")}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    checkAuthority();
    const currentScope = scopeFor(db, referenceKind, params[kind]);
    if (
      currentScope.orgId !== scope.orgId ||
      currentScope.boardId !== scope.boardId
    )
      fail("BOARD_WRITE_SCOPE_CONFLICT");
    validateReferences(db, action, params, scope);
    requireBoardIntegrity(db, scope.boardId || params.boardId);
    requiredPermissions.push(...commentPermissions(db, action, params, actor));
    checkAuthority();
    // No promise, await, native dialog, file IO, or model request may enter this
    // transaction. Existing async APIs wrap these same synchronous cores.
    const manager = createManager(spec[2], db);
    const operation = manager[`${spec[3]}Sync`];
    if (
      typeof operation !== "function" ||
      operation.constructor.name === "AsyncFunction"
    )
      fail("BOARD_WRITE_ASYNC_CORE");
    const result = operation.call(
      manager,
      ...argumentsFor(action, params, actor, displayName, dependencies),
    );
    if (result?.then) fail("BOARD_WRITE_ASYNC_CORE");
    checkAuthority();
    if (action === "mention-user") {
      validateReferences(db, action, params, scope);
      const finalScope = scopeFor(db, referenceKind, params[kind]);
      if (
        finalScope.orgId !== scope.orgId ||
        finalScope.boardId !== scope.boardId
      )
        fail("BOARD_WRITE_SCOPE_CONFLICT");
      if (
        !require("./board-notice-projection").readBoardNoticeProjection({
          db,
          id: result.notificationId,
          getActor: () => params.userDid,
        })
      )
        fail("BOARD_WRITE_SCOPE_CONFLICT");
    }
    if (result?.success !== true) {
      db.exec(`ROLLBACK TO ${savepoint}`);
    }
    db.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO ${savepoint}`);
    db.exec(`RELEASE ${savepoint}`);
    throw error;
  }
}

module.exports = {
  executeBoardWrite,
  authorizeBoardWrite,
  ACTIONS,
  UNSUPPORTED,
  checkBoardWriteReferences(db, action, params, scope) {
    if (
      action === "update-task" &&
      Object.hasOwn(params.updates || {}, "columnId")
    ) {
      validateReferences(
        db,
        "move-task",
        { taskId: params.taskId, ...params.updates },
        scope,
      );
      requireBoardIntegrity(db, scope.boardId);
      return;
    }
    // The controlled update adapter validates its bounded field patch separately.
    // Reuse the same current relationship/cascade checks without raw mutation.
    validateReferences(
      db,
      action === "update-task" ? "controlled-update" : action,
      params,
      scope,
    );
    requireBoardIntegrity(db, scope.boardId || params.boardId);
  },
};
