"use strict";
const { randomUUID } = require("node:crypto");
const {
  createBusinessObjectRef,
  createBusinessActionRequest,
  validateBusinessActionRequest,
  createBusinessActionRun,
  validateBusinessActionRun,
  digestBusinessObjectContent: digest,
} = require("@chainlesschain/session-core/business-object-contract");
const { fail } = require("./board-action-storage");
const ACTION_TYPE = "board-task.update-fields",
  MOVE_ACTION_TYPE = "board-task.move",
  CREATE_ACTION_TYPE = "board-task.create",
  LABEL_ACTION_TYPE = "board-task.add-label",
  LEGACY_ACTION_TYPE = "board-task.update",
  SOURCE_KIND = "desktop.board-task";
const LEGACY_FIELDS = Object.freeze(["title", "description", "status"]);
const COLUMN_MAP = Object.freeze({
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  assigneeDid: "assignee_did",
  dueDate: "due_date",
  estimatedHours: "estimated_hours",
  actualHours: "actual_hours",
});
const FIELDS = Object.freeze(Object.keys(COLUMN_MAP));
const MOVE_COLUMNS = Object.freeze({
  columnId: "column_id",
  position: "position",
});
const MOVE_FIELDS = Object.freeze(Object.keys(MOVE_COLUMNS));
const isMove = (value) => MOVE_FIELDS.some((key) => Object.hasOwn(value, key));
const isLabel = (value) => Object.hasOwn(value, "labelId");
const actionTypeFor = (patch) =>
  isLabel(patch) ? LABEL_ACTION_TYPE : isMove(patch) ? MOVE_ACTION_TYPE : ACTION_TYPE;
const CREATE_FIELDS = Object.freeze([
  "columnId",
  "title",
  "description",
  "priority",
  "assigneeDid",
  "dueDate",
  "estimatedHours",
  "actualHours",
  "position",
  "parentTaskId",
]);
const PRIORITIES = Object.freeze(["low", "medium", "high", "critical"]);
const STATUSES = Object.freeze([
  "open",
  "in_progress",
  "review",
  "done",
  "cancelled",
]);
const LIMITS = Object.freeze({
  titleBytes: 1024,
  descriptionBytes: 8192,
  sourceBytes: 32768,
  receiptBytes: 16384,
  previewMs: 300000,
  runsPerTask: 100,
  runsPerVault: 4096,
  capsPerVault: 128,
  hours: 1000000,
  dateMs: 8640000000000000,
  columns: 200,
  columnsBytes: 65536,
  position: 1000000,
});
const TRIGGERS = Object.freeze({
  trg_board_task_revision_insert: `CREATE TRIGGER trg_board_task_revision_insert AFTER INSERT ON team_tasks BEGIN
    INSERT INTO task_board_task_revisions(task_id,revision) VALUES(NEW.id,1) ON CONFLICT(task_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_task_revision_update: `CREATE TRIGGER trg_board_task_revision_update AFTER UPDATE ON team_tasks BEGIN
    INSERT INTO task_board_task_revisions(task_id,revision) VALUES(OLD.id,1) ON CONFLICT(task_id) DO UPDATE SET revision=revision+1;
    INSERT INTO task_board_task_revisions(task_id,revision) SELECT NEW.id,1 WHERE NEW.id<>OLD.id ON CONFLICT(task_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_task_revision_delete: `CREATE TRIGGER trg_board_task_revision_delete AFTER DELETE ON team_tasks BEGIN
    INSERT INTO task_board_task_revisions(task_id,revision) VALUES(OLD.id,1) ON CONFLICT(task_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_structure_insert: `CREATE TRIGGER trg_board_structure_insert AFTER INSERT ON task_boards BEGIN
    INSERT INTO task_board_structure_revisions(board_id,revision) VALUES(NEW.id,1) ON CONFLICT(board_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_structure_update: `CREATE TRIGGER trg_board_structure_update AFTER UPDATE ON task_boards BEGIN
    INSERT INTO task_board_structure_revisions(board_id,revision) VALUES(OLD.id,1) ON CONFLICT(board_id) DO UPDATE SET revision=revision+1;
    INSERT INTO task_board_structure_revisions(board_id,revision) SELECT NEW.id,1 WHERE NEW.id<>OLD.id ON CONFLICT(board_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_structure_delete: `CREATE TRIGGER trg_board_structure_delete AFTER DELETE ON task_boards BEGIN
    INSERT INTO task_board_structure_revisions(board_id,revision) VALUES(OLD.id,1) ON CONFLICT(board_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_column_insert: `CREATE TRIGGER trg_board_column_insert AFTER INSERT ON task_board_columns BEGIN
    INSERT INTO task_board_structure_revisions(board_id,revision) VALUES(NEW.board_id,1) ON CONFLICT(board_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_column_update: `CREATE TRIGGER trg_board_column_update AFTER UPDATE ON task_board_columns BEGIN
    INSERT INTO task_board_structure_revisions(board_id,revision) VALUES(OLD.board_id,1) ON CONFLICT(board_id) DO UPDATE SET revision=revision+1;
    INSERT INTO task_board_structure_revisions(board_id,revision) SELECT NEW.board_id,1 WHERE NEW.board_id<>OLD.board_id ON CONFLICT(board_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_column_delete: `CREATE TRIGGER trg_board_column_delete AFTER DELETE ON task_board_columns BEGIN
    INSERT INTO task_board_structure_revisions(board_id,revision) VALUES(OLD.board_id,1) ON CONFLICT(board_id) DO UPDATE SET revision=revision+1; END`,
});
const TRIGGER_TABLES =
  "'team_tasks','task_board_task_revisions','task_board_update_runs','task_activity_log','task_boards','task_board_columns','task_board_structure_revisions'";
const canonicalSql = (sql) =>
  sql
    .replace(/\bIF\s+NOT\s+EXISTS\b/giu, "")
    .replace(/\s+/gu, "")
    .toLowerCase();
function revisionSchema(db) {
  if (
    db
      .prepare(
        `SELECT 1 FROM sqlite_temp_master WHERE type='trigger' AND tbl_name IN (${TRIGGER_TABLES}) LIMIT 1`,
      )
      .get()
  )
    fail("BOARD_ACTION_UNEXPECTED_TRIGGER");
  const rows = db
    .prepare(
      `SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${TRIGGER_TABLES})`,
    )
    .all();
  if (rows.some((row) => !Object.hasOwn(TRIGGERS, row.name)))
    fail("BOARD_ACTION_UNEXPECTED_TRIGGER");
  if (
    rows.length !== Object.keys(TRIGGERS).length ||
    rows.some(
      (row) => canonicalSql(row.sql) !== canonicalSql(TRIGGERS[row.name]),
    )
  )
    fail("BOARD_ACTION_REVISION_UNAVAILABLE");
}
function fields(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("BOARD_ACTION_INVALID_REQUEST");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("BOARD_ACTION_INVALID_REQUEST");
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("BOARD_ACTION_INVALID_REQUEST");
  return value;
}
function nonce(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    fail("BOARD_ACTION_INVALID_REQUEST");
  return value;
}
function text(value, max) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= max;
}
const validField = (key, value) => {
  switch (key) {
    case "title":
      return text(value, LIMITS.titleBytes) && !!value.trim();
    case "description":
      return text(value, LIMITS.descriptionBytes);
    case "status":
      return STATUSES.includes(value);
    case "priority":
      return PRIORITIES.includes(value);
    case "assigneeDid":
      return (
        value === null ||
        (text(value, 256) && /^did:[^\s\u0000-\u001f\u007f]+$/u.test(value))
      );
    case "dueDate":
      return (
        value === null ||
        (Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.dateMs)
      );
    case "estimatedHours":
    case "actualHours":
      return (
        value === null ||
        (typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= LIMITS.hours)
      );
    default:
      return false;
  }
};
function updates(value, allowed = FIELDS) {
  fields(value, [], allowed);
  if (
    !Object.keys(value).length ||
    Object.keys(value).some((key) => !validField(key, value[key]))
  )
    fail("BOARD_ACTION_INVALID_UPDATE");
  return value;
}
function patch(value) {
  fields(value, [], [...FIELDS, ...MOVE_FIELDS, "labelId"]);
  if (isLabel(value)) {
    fields(value, ["labelId"]);
    id(value.labelId);
    return value;
  }
  if (!isMove(value)) return updates(value);
  fields(value, MOVE_FIELDS);
  id(value.columnId);
  if (
    !Number.isSafeInteger(value.position) ||
    value.position < 0 ||
    value.position > LIMITS.position
  )
    fail("BOARD_ACTION_INVALID_UPDATE");
  return value;
}
function createData(value) {
  fields(value, ["columnId", "title"], CREATE_FIELDS);
  id(value.columnId);
  const normalized = {
    description: "",
    priority: "medium",
    assigneeDid: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    position: 0,
    parentTaskId: null,
    ...value,
  };
  for (const key of [
    "title",
    "description",
    "priority",
    "assigneeDid",
    "dueDate",
    "estimatedHours",
    "actualHours",
  ])
    if (!validField(key, normalized[key])) fail("BOARD_ACTION_INVALID_UPDATE");
  if (
    !Number.isSafeInteger(normalized.position) ||
    normalized.position < 0 ||
    normalized.position > LIMITS.position
  )
    fail("BOARD_ACTION_INVALID_UPDATE");
  if (normalized.parentTaskId !== null) id(normalized.parentTaskId);
  return normalized;
}
function creationSource(db, boardId, taskId, parentTaskId = null) {
  const source = boardSnapshot(db, boardId);
  if (source.board.is_archived !== 0) fail("BOARD_ACTION_TARGET_ARCHIVED");
  if (
    db
      .prepare(
        "SELECT 1 FROM team_tasks WHERE id=? UNION ALL SELECT 1 FROM project_tasks WHERE id=? UNION ALL SELECT 1 FROM task_board_task_revisions WHERE task_id=? LIMIT 1",
      )
      .get(taskId, taskId, taskId)
  )
    fail("BOARD_ACTION_TARGET_EXISTS");
  const parent = parentTaskId === null ? null : snapshot(db, parentTaskId);
  if (parent && parent.board.id !== boardId) fail("BOARD_WRITE_SCOPE_CONFLICT");
  const version = digest({
    taskId,
    ...source,
    parent: parent ? { id: parent.task.id, version: parent.ref.version } : null,
  });
  return {
    ...source,
    task: { id: taskId },
    revision: 0,
    parentTaskId,
    parentVersion: parent?.ref.version || null,
    ref: createBusinessObjectRef({
      type: "Task",
      id: taskId,
      sourceKind: SOURCE_KIND,
      scope: { kind: "organization", id: source.board.org_id },
      version,
    }),
  };
}
function createRequestFor(source, data, key, previewId) {
  return createBusinessActionRequest({
    actionType: CREATE_ACTION_TYPE,
    actionVersion: 1,
    target: source.ref,
    expectedVersion: source.ref.version,
    input: { boardId: source.board.id, taskData: data, previewId },
    idempotencyKey: key,
  });
}
function boardSnapshot(db, boardId) {
  revisionSchema(db);
  const quote = (name) => `"${name.replaceAll('"', '""')}"`;
  const boardSize = db
    .prepare(
      "SELECT COALESCE(length(CAST(id AS BLOB)),0)+COALESCE(length(CAST(org_id AS BLOB)),0)+COALESCE(length(CAST(owner_did AS BLOB)),0)+COALESCE(length(CAST(is_archived AS BLOB)),0)+COALESCE(length(CAST(updated_at AS BLOB)),0) AS bytes FROM task_boards WHERE id=?",
    )
    .get(boardId);
  if (!boardSize || boardSize.bytes > 2048) fail("BOARD_ACTION_SOURCE_LIMIT");
  const board = db
    .prepare(
      "SELECT id,org_id,owner_did,is_archived,updated_at FROM task_boards WHERE id=?",
    )
    .get(boardId);
  if (!board) fail("BOARD_ACTION_SOURCE_INVALID");
  const boardRevision = db
    .prepare(
      "SELECT revision FROM task_board_structure_revisions WHERE board_id=?",
    )
    .get(board.id)?.revision;
  const selected = [
    "id",
    "board_id",
    "name",
    "position",
    "wip_limit",
    "is_done_column",
    "color",
    "created_at",
    "updated_at",
  ];
  const columnsSize = db
    .prepare(
      `SELECT COUNT(*) AS count,COALESCE(SUM(${selected.map((name) => `COALESCE(length(CAST(${quote(name)} AS BLOB)),0)`).join("+")}),0) AS bytes FROM task_board_columns WHERE board_id=?`,
    )
    .get(board.id);
  if (
    columnsSize.count > LIMITS.columns ||
    columnsSize.bytes > LIMITS.columnsBytes
  )
    fail("BOARD_ACTION_SOURCE_LIMIT");
  const boardColumns = db
    .prepare(
      `SELECT ${selected.join(",")} FROM task_board_columns WHERE board_id=? ORDER BY id`,
    )
    .all(board.id);
  if (
    !Number.isSafeInteger(boardRevision) ||
    boardRevision < 1 ||
    boardColumns.some(
      (column) => !text(column.name, 4096) || !column.name.trim(),
    )
  )
    fail("BOARD_ACTION_SOURCE_INVALID");
  return { board, boardRevision, columns: boardColumns };
}

function snapshot(db, taskId) {
  revisionSchema(db);
  if (db.prepare("SELECT 1 FROM project_tasks WHERE id=?").get(taskId))
    fail("ACTION_CONTROLLED_TASK_REQUIRED");
  const columns = db
    .prepare("PRAGMA table_info(team_tasks)")
    .all()
    .map((row) => row.name);
  const quote = (name) => `"${name.replaceAll('"', '""')}"`;
  const size = db
    .prepare(
      `SELECT ${columns.map((name) => `COALESCE(length(CAST(${quote(name)} AS BLOB)),0)`).join("+")} AS bytes FROM team_tasks WHERE id=?`,
    )
    .get(taskId);
  if (!size || size.bytes > LIMITS.sourceBytes)
    fail("BOARD_ACTION_SOURCE_LIMIT");
  const task = db.prepare("SELECT * FROM team_tasks WHERE id=?").get(taskId);
  const {
    board,
    boardRevision,
    columns: boardColumns,
  } = boardSnapshot(db, task.board_id);
  const revision = db
    .prepare("SELECT revision FROM task_board_task_revisions WHERE task_id=?")
    .get(taskId)?.revision;
  if (
    !board ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(task.updated_at) ||
    !text(task.title, LIMITS.titleBytes) ||
    !task.title.trim() ||
    (task.description !== null &&
      !text(task.description, LIMITS.descriptionBytes)) ||
    !STATUSES.includes(task.status) ||
    FIELDS.filter((key) => !LEGACY_FIELDS.includes(key)).some(
      (key) => !validField(key, task[COLUMN_MAP[key]]),
    )
  )
    fail("BOARD_ACTION_SOURCE_INVALID");
  if (
    !boardColumns.some((column) => column.id === task.column_id) ||
    !Number.isSafeInteger(task.position) ||
    task.position < 0 ||
    task.position > LIMITS.position
  )
    fail("BOARD_ACTION_SOURCE_INVALID");
  const version = digest({
    task,
    board,
    revision,
    boardRevision,
    columns: boardColumns,
  });
  const ref = createBusinessObjectRef({
    type: "Task",
    id: task.id,
    sourceKind: SOURCE_KIND,
    scope: { kind: "organization", id: board.org_id },
    version,
  });
  return { task, board, revision, boardRevision, columns: boardColumns, ref };
}
const projection = (task) => ({
  title: task.title,
  description: task.description ?? "",
  status: task.status,
  priority: task.priority,
  assigneeDid: task.assignee_did,
  dueDate: task.due_date,
  estimatedHours: task.estimated_hours,
  actualHours: task.actual_hours,
});
const moveProjection = (task) => ({
  columnId: task.column_id,
  position: task.position,
});
const projectionFor = (task, actionType) =>
  actionType === LABEL_ACTION_TYPE
    ? { labels: task.labels === null ? [] : JSON.parse(task.labels) }
    : actionType === MOVE_ACTION_TYPE ? moveProjection(task) : projection(task);
function requestFor(source, patch, key, previewId) {
  return createBusinessActionRequest({
    actionType: actionTypeFor(patch),
    actionVersion: 1,
    target: source.ref,
    expectedVersion: source.ref.version,
    input: { updates: patch, previewId },
    idempotencyKey: key,
  });
}
function request(value) {
  let result;
  try {
    result = validateBusinessActionRequest(value);
  } catch {
    fail("BOARD_ACTION_INVALID_REQUEST");
  }
  if (
    ![
      ACTION_TYPE,
      LEGACY_ACTION_TYPE,
      MOVE_ACTION_TYPE,
      CREATE_ACTION_TYPE,
      LABEL_ACTION_TYPE,
    ].includes(result.actionType) ||
    result.actionVersion !== 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(result.expectedVersion) ||
    result.target.type !== "Task" ||
    result.target.sourceKind !== SOURCE_KIND ||
    result.target.scope.kind !== "organization"
  )
    fail("BOARD_ACTION_INVALID_REQUEST");
  if (result.actionType === CREATE_ACTION_TYPE) {
    fields(result.input, ["boardId", "taskData", "previewId"]);
    id(result.input.boardId);
    if (
      digest(createData(result.input.taskData)) !==
      digest(result.input.taskData)
    )
      fail("BOARD_ACTION_INVALID_REQUEST");
  } else {
    fields(result.input, ["updates", "previewId"]);
    if (result.actionType === LABEL_ACTION_TYPE) {
      fields(result.input.updates, ["labelId"]);
      id(result.input.updates.labelId);
    } else if (result.actionType === MOVE_ACTION_TYPE) {
      patch(result.input.updates);
      if (!isMove(result.input.updates)) fail("BOARD_ACTION_INVALID_REQUEST");
    } else
      updates(
        result.input.updates,
        result.actionType === LEGACY_ACTION_TYPE ? LEGACY_FIELDS : FIELDS,
      );
  }
  nonce(result.input.previewId);
  nonce(result.idempotencyKey);
  return result;
}
const reference = (item) => ({ id: item.id, digest: digest(item) });
function sourceEvidence(source, request, actor, generation) {
  return {
    id: randomUUID(),
    kind:
      request.actionType === CREATE_ACTION_TYPE
        ? "board-task-create-source"
        : "board-task-source",
    taskId: source.task.id,
    boardId: source.board.id,
    orgId: source.board.org_id,
    actorDid: actor,
    authGeneration: generation,
    previewId: request.input.previewId,
    invocationDigest: request.invocationDigest,
    actionDigest: request.actionDigest,
    expectedVersion: request.expectedVersion,
    revision: source.revision,
    boardRevision: source.boardRevision,
    ...(request.actionType === CREATE_ACTION_TYPE
      ? {
          parentTaskId: source.parentTaskId,
          parentVersion: source.parentVersion,
        }
      : {}),
    ...(request.actionType === LABEL_ACTION_TYPE
      ? {
          labelId: source.label.id,
          labelRevision: source.labels.find((label) => label.id === source.label.id).revision,
          labelsDigest: digest(source.labels),
        }
      : {}),
  };
}
function actionRun(
  request,
  {
    id: runId = randomUUID(),
    status = "queued",
    startedAt = new Date().toISOString(),
    completedAt,
    afterVersion,
    approval,
    execution,
    evidence = [],
  } = {},
) {
  return createBusinessActionRun({
    id: runId,
    request,
    status,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    ...(afterVersion ? { afterVersion } : {}),
    ...(approval ? { approvalRef: reference(approval) } : {}),
    ...(execution ? { executionRef: reference(execution) } : {}),
    evidenceRefs: evidence.map(reference),
  });
}
const COLUMNS = `id,preview_id,task_id,board_id,org_id,actor_did,auth_generation,idempotency_digest,invocation_digest,status,expected_version,expires_at,created_at,error_code,
  CASE WHEN length(CAST(run_json AS BLOB))<=16384 THEN run_json END AS run_json,
  CASE WHEN length(CAST(evidence_json AS BLOB))<=16384 THEN evidence_json END AS evidence_json`;
const rowById = (db, value) =>
  db
    .prepare(`SELECT ${COLUMNS} FROM task_board_update_runs WHERE id=?`)
    .get(value);
const rowByKey = (db, value) =>
  db
    .prepare(
      `SELECT ${COLUMNS} FROM task_board_update_runs WHERE idempotency_digest=?`,
    )
    .get(value);
function readRun(row) {
  try {
    if (
      !row ||
      !text(row.run_json, LIMITS.receiptBytes) ||
      !text(row.evidence_json, LIMITS.receiptBytes)
    )
      throw new Error();
    const run = validateBusinessActionRun(JSON.parse(row.run_json)),
      evidence = JSON.parse(row.evidence_json);
    if (
      ![
        ACTION_TYPE,
        LEGACY_ACTION_TYPE,
        MOVE_ACTION_TYPE,
        CREATE_ACTION_TYPE,
        LABEL_ACTION_TYPE,
      ].includes(run.actionType) ||
      run.actionVersion !== 1 ||
      !/^sha256:[0-9a-f]{64}$/u.test(run.expectedVersion) ||
      (run.afterVersion !== null &&
        !/^sha256:[0-9a-f]{64}$/u.test(run.afterVersion)) ||
      run.target.type !== "Task" ||
      run.target.sourceKind !== SOURCE_KIND ||
      run.target.scope.kind !== "organization" ||
      run.id !== row.id ||
      run.target.id !== row.task_id ||
      run.target.scope.id !== row.org_id ||
      run.status !== row.status ||
      run.expectedVersion !== row.expected_version ||
      run.idempotencyDigest !== row.idempotency_digest ||
      run.invocationDigest !== row.invocation_digest ||
      !Array.isArray(evidence) ||
      evidence.length !== run.evidenceRefs.length ||
      evidence.length < 1 ||
      evidence.length > 3 ||
      new Set(evidence.map((item) => item.id)).size !== evidence.length
    )
      throw new Error();
    for (const item of evidence) {
      const ref = run.evidenceRefs.find((ref) => ref.id === item.id);
      if (
        !ref ||
        ref.digest !== digest(item) ||
        item.actorDid !== row.actor_did ||
        item.invocationDigest !== run.invocationDigest
      )
        throw new Error();
    }
    const source = evidence[0];
    fields(
      source,
      [
        "id",
        "kind",
        "taskId",
        "boardId",
        "orgId",
        "actorDid",
        "authGeneration",
        "previewId",
        "invocationDigest",
        "actionDigest",
        "expectedVersion",
        "revision",
      ],
      ["boardRevision", "parentTaskId", "parentVersion", "labelId", "labelRevision", "labelsDigest"],
    );
    if (
      source.kind !==
        (run.actionType === CREATE_ACTION_TYPE
          ? "board-task-create-source"
          : "board-task-source") ||
      source.taskId !== row.task_id ||
      source.boardId !== row.board_id ||
      source.orgId !== row.org_id ||
      source.authGeneration !== row.auth_generation ||
      source.previewId !== row.preview_id ||
      source.expectedVersion !== run.expectedVersion ||
      source.actionDigest !== run.actionDigest ||
      !Number.isSafeInteger(source.revision) ||
      (run.actionType === CREATE_ACTION_TYPE
        ? source.revision !== 0
        : source.revision < 1) ||
      (run.actionType === CREATE_ACTION_TYPE &&
        (!Object.hasOwn(source, "parentTaskId") ||
          !Object.hasOwn(source, "parentVersion") ||
          (source.parentTaskId === null
            ? source.parentVersion !== null
            : typeof source.parentTaskId !== "string" ||
              !/^sha256:[0-9a-f]{64}$/u.test(source.parentVersion)))) ||
      (run.actionType !== CREATE_ACTION_TYPE &&
        (Object.hasOwn(source, "parentTaskId") ||
          Object.hasOwn(source, "parentVersion"))) ||
      (run.actionType === LABEL_ACTION_TYPE
        ? typeof source.labelId !== "string" ||
          !Number.isSafeInteger(source.labelRevision) || source.labelRevision < 1 ||
          !/^sha256:[0-9a-f]{64}$/u.test(source.labelsDigest)
        : ["labelId", "labelRevision", "labelsDigest"].some((key) => Object.hasOwn(source, key))) ||
      (Object.hasOwn(source, "boardRevision") &&
        (!Number.isSafeInteger(source.boardRevision) ||
          source.boardRevision < 1)) ||
      ([MOVE_ACTION_TYPE, CREATE_ACTION_TYPE, LABEL_ACTION_TYPE].includes(run.actionType) &&
        !Object.hasOwn(source, "boardRevision")) ||
      !Number.isSafeInteger(row.auth_generation) ||
      !Number.isSafeInteger(row.created_at) ||
      row.expires_at !== row.created_at + LIMITS.previewMs ||
      new Date(row.created_at).toISOString() !== run.startedAt
    )
      throw new Error();
    const resolve = (ref) => {
      if (!ref) return null;
      if (
        !run.evidenceRefs.some(
          (item) => item.id === ref.id && item.digest === ref.digest,
        )
      )
        throw new Error();
      return evidence.find((item) => item.id === ref.id);
    };
    const approval = resolve(run.approvalRef),
      execution = resolve(run.executionRef);
    const classified = [
      source,
      ...(approval ? [approval] : []),
      ...(execution ? [execution] : []),
    ];
    if (
      evidence.length !== classified.length ||
      evidence.some((item, index) => item !== classified[index])
    )
      throw new Error();
    if (approval)
      fields(
        approval,
        [
          "id",
          "kind",
          "actorDid",
          "invocationDigest",
          "actionDigest",
          "expectedVersion",
          "decision",
          "via",
          "policy",
          "riskLevel",
          "at",
        ],
        ["cancelledBy"],
      );
    if (execution)
      fields(execution, [
        "id",
        "kind",
        "actorDid",
        "invocationDigest",
        "beforeVersion",
        "afterVersion",
        "affectedRows",
        "revisionBefore",
        "revisionAfter",
        "activityId",
      ]);
    if (
      approval &&
      (approval !== evidence[1] ||
        ![
          "local-user-confirmation",
          "approval-gate-decision",
          "host-user-cancellation",
        ].includes(approval.kind) ||
        approval.actionDigest !== run.actionDigest ||
        approval.expectedVersion !== run.expectedVersion ||
        !["allow", "deny"].includes(approval.decision))
    )
      throw new Error();
    if (
      approval &&
      (approval.policy !== "strict" ||
        approval.riskLevel !== "high" ||
        ![
          "user-confirm",
          "user-deny",
          "confirm-error",
          "explicit-cancel",
        ].includes(approval.via) ||
        typeof approval.at !== "string" ||
        new Date(approval.at).toISOString() !== approval.at ||
        Date.parse(approval.at) < row.created_at ||
        (approval.kind === "local-user-confirmation" &&
          !(
            (approval.decision === "allow" &&
              approval.via === "user-confirm") ||
            (approval.decision === "deny" && approval.via === "user-deny")
          )) ||
        (approval.kind === "approval-gate-decision" &&
          (approval.decision !== "deny" || approval.via !== "confirm-error")) ||
        (approval.kind === "host-user-cancellation" &&
          (approval.decision !== "deny" ||
            approval.via !== "explicit-cancel" ||
            typeof approval.cancelledBy !== "string" ||
            !approval.cancelledBy.startsWith("did:"))) ||
        (approval.kind !== "host-user-cancellation" &&
          Object.hasOwn(approval, "cancelledBy")))
    )
      throw new Error();
    if (
      run.status === "cancelled" &&
      (!approval ||
        approval.decision !== "deny" ||
        !["local-user-confirmation", "host-user-cancellation"].includes(
          approval.kind,
        ))
    )
      throw new Error();
    if (
      ["queued", "running"].includes(run.status) &&
      (evidence.length !== 1 || approval || execution)
    )
      throw new Error();
    if (
      run.status === "succeeded" &&
      (evidence.length !== 3 ||
        approval?.kind !== "local-user-confirmation" ||
        approval.decision !== "allow" ||
        approval.via !== "user-confirm" ||
        approval.policy !== "strict" ||
        approval.riskLevel !== "high" ||
        execution !== evidence[2] ||
        execution?.kind !==
          (run.actionType === CREATE_ACTION_TYPE
            ? "sqlite-board-task-create"
            : run.actionType === LABEL_ACTION_TYPE
              ? "sqlite-board-task-add-label"
            : run.actionType === MOVE_ACTION_TYPE
              ? "sqlite-board-task-move"
              : "sqlite-board-task-update") ||
        execution.affectedRows !== 1 ||
        execution.beforeVersion !== run.expectedVersion ||
        execution.afterVersion !== run.afterVersion ||
        execution.revisionBefore !== source.revision ||
        execution.revisionAfter !== source.revision + 1 ||
        typeof execution.activityId !== "string")
    )
      throw new Error();
    if (run.status !== "succeeded" && execution) throw new Error();
    return { run, evidence };
  } catch {
    fail("BOARD_ACTION_RECEIPT_CORRUPT");
  }
}
function saveRun(db, row, run, evidence, errorCode = null) {
  revisionSchema(db);
  const result = db
    .prepare(
      "UPDATE task_board_update_runs SET status=?,run_json=?,evidence_json=?,error_code=? WHERE id=? AND invocation_digest=? AND run_json=? AND evidence_json=? AND status=?",
    )
    .run(
      run.status,
      JSON.stringify(run),
      JSON.stringify(evidence),
      errorCode,
      row.id,
      row.invocation_digest,
      row.run_json,
      row.evidence_json,
      row.status,
    );
  if (Number(result.changes) !== 1) fail("BOARD_ACTION_RECEIPT_CONFLICT");
  revisionSchema(db);
}
module.exports = {
  ACTION_TYPE,
  MOVE_ACTION_TYPE,
  CREATE_ACTION_TYPE,
  LABEL_ACTION_TYPE,
  LEGACY_ACTION_TYPE,
  SOURCE_KIND,
  FIELDS,
  COLUMN_MAP,
  MOVE_COLUMNS,
  MOVE_FIELDS,
  isMove,
  isLabel,
  actionTypeFor,
  validField,
  STATUSES,
  LIMITS,
  fields,
  id,
  nonce,
  updates,
  patch,
  createData,
  creationSource,
  createRequestFor,
  boardSnapshot,
  snapshot,
  projection,
  projectionFor,
  moveProjection,
  requestFor,
  request,
  reference,
  sourceEvidence,
  actionRun,
  readRun,
  saveRun,
  rowById,
  rowByKey,
  COLUMNS,
  digest,
  revisionSchema,
};
