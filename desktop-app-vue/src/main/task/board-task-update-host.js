"use strict";
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");
const {
  authorizeBoardWrite,
  checkBoardWriteReferences,
} = require("./board-write-authority");
const { createBoardReadCheck } = require("./board-read-authority");
const {
  fail,
  databaseFile,
  assertStorage,
  transaction,
} = require("./board-action-storage");
const C = require("./board-task-update-contract");
const FIELD_LABELS = Object.freeze({
  title: "标题",
  description: "描述",
  status: "状态",
  priority: "优先级",
  assigneeDid: "主负责人 DID",
  dueDate: "截止时间（UTC Unix 毫秒）",
  estimatedHours: "预计工时（小时）",
  actualHours: "实际工时（小时）",
  columnId: "所在列",
  position: "排序位置",
});
const capabilities = new WeakMap(),
  nativeOperations = new WeakSet();
const safeCode = (error) =>
  typeof error?.code === "string" &&
  /^(?:BOARD_(?:ACTION|WRITE|READ)|ACTION_CONTROLLED)_[A-Z_]+$/u.test(
    error.code,
  )
    ? error.code
    : "BOARD_ACTION_OPERATION_FAILED";
const display = (value) =>
  JSON.stringify(value).replace(
    /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
const scopeMatches = (row, ctx) =>
  row &&
  row.task_id === ctx.taskId &&
  row.org_id === ctx.auth.scope.orgId &&
  row.board_id === ctx.auth.scope.boardId;
const response = (row, replayed = false) => ({
  success: true,
  ...C.readRun(row),
  replayed,
  executionState: ["queued", "running", "unknown"].includes(row.status)
    ? "unresolved"
    : "recorded",
});

function createBoardTaskUpdateHost({ database, ...dependencies } = {}) {
  const now = dependencies.now || Date.now,
    mono = dependencies.monotonicNow || (() => performance.now());
  const generation =
    dependencies.getGeneration ||
    require("./project-goal-auth-session").getProjectGoalAuthGeneration;
  const platform = () => dependencies.electron || require("electron");
  const wall = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0)
      fail("BOARD_ACTION_CLOCK_INVALID");
    return value;
  };
  function context(event, taskId, updates = {}) {
    const auth = authorizeBoardWrite(
      database,
      event,
      "update-task",
      { taskId, updates },
      dependencies,
    );
    const db = auth.db;
    assertStorage(database, db);
    const check = () => {
      auth.checkTarget();
      if (db.prepare("SELECT 1 FROM project_tasks WHERE id=?").get(taskId))
        fail("ACTION_CONTROLLED_TASK_REQUIRED");
      checkBoardWriteReferences(
        db,
        "update-task",
        { taskId, updates: {} },
        auth.scope,
      );
    };
    check();
    return { auth, db, taskId, check };
  }
  function currentSource(ctx, editable = true) {
    ctx.check();
    const source = C.snapshot(ctx.db, ctx.taskId);
    if (
      source.board.id !== ctx.auth.scope.boardId ||
      source.board.org_id !== ctx.auth.scope.orgId
    )
      fail("BOARD_WRITE_SCOPE_CONFLICT");
    if (editable && source.board.is_archived !== 0)
      fail("BOARD_ACTION_TARGET_ARCHIVED");
    return source;
  }
  function checkUpdateReferences(ctx, updates) {
    checkBoardWriteReferences(
      ctx.db,
      "update-task",
      { taskId: ctx.taskId, updates },
      ctx.auth.scope,
    );
  }
  function capFor(ctx, event) {
    const electron = platform(),
      sender = event.sender,
      window = electron.BrowserWindow?.fromWebContents(sender);
    if (!window || window.isDestroyed() || sender?.isDestroyed?.())
      fail("BOARD_ACTION_WINDOW_UNAVAILABLE");
    const file = databaseFile(ctx.db);
    const currentPath = () =>
      typeof database.getCurrentDatabasePath === "function"
        ? database.getCurrentDatabasePath()
        : database.dbPath;
    const wrapperPath = currentPath(),
      frame = event.senderFrame,
      frameUrl = frame.url,
      authGeneration = generation();
    const deadline = mono() + C.LIMITS.previewMs;
    const created = wall();
    return {
      actor: ctx.auth.actor,
      authGeneration,
      deadline,
      created,
      expires: created + C.LIMITS.previewMs,
      check(newEvent) {
        ctx.check();
        if (
          newEvent.sender !== sender ||
          newEvent.senderFrame !== frame ||
          frame.url !== frameUrl ||
          sender?.isDestroyed?.() ||
          window.isDestroyed() ||
          electron.BrowserWindow.fromWebContents(sender) !== window ||
          currentPath() !== wrapperPath ||
          databaseFile(ctx.db) !== file ||
          generation() !== authGeneration
        )
          fail("BOARD_ACTION_CONTEXT_CHANGED");
        if (
          mono() >= deadline ||
          wall() < created ||
          wall() >= created + C.LIMITS.previewMs
        )
          fail("BOARD_ACTION_PREVIEW_EXPIRED");
      },
    };
  }
  function checkCap(cap, row, event) {
    if (
      !cap ||
      row.actor_did !== cap.actor ||
      row.auth_generation !== cap.authGeneration ||
      row.created_at !== cap.created ||
      row.expires_at !== cap.expires
    )
      fail("BOARD_ACTION_PREVIEW_EXPIRED");
    cap.check(event);
  }
  function assertBinding(row, request, ctx) {
    C.readRun(row);
    if (
      !scopeMatches(row, ctx) ||
      row.actor_did !== ctx.auth.actor ||
      row.invocation_digest !== request.invocationDigest ||
      row.idempotency_digest !== request.idempotencyDigest ||
      row.preview_id !== request.input.previewId ||
      row.expected_version !== request.expectedVersion
    )
      fail("BOARD_ACTION_IDEMPOTENCY_CONFLICT");
  }
  function terminal(
    ctx,
    row,
    parsed,
    status,
    {
      approval = null,
      execution = null,
      afterVersion = null,
      evidence = parsed.evidence,
      errorCode = null,
    } = {},
  ) {
    // The request body need not be retained to build a terminal standard Run.
    const run = Object.freeze({
      ...parsed.run,
      status,
      completedAt: new Date(Math.max(wall(), row.created_at)).toISOString(),
      afterVersion,
      approvalRef: approval ? C.reference(approval) : null,
      executionRef: execution ? C.reference(execution) : null,
      evidenceRefs: evidence.map(C.reference),
    });
    require("@chainlesschain/session-core/business-object-contract").validateBusinessActionRun(
      run,
    );
    C.saveRun(ctx.db, row, run, evidence, errorCode);
    const saved = C.rowById(ctx.db, row.id);
    if (
      saved?.run_json !== JSON.stringify(run) ||
      saved?.evidence_json !== JSON.stringify(evidence) ||
      saved.status !== status ||
      saved.error_code !== errorCode
    )
      fail("BOARD_ACTION_RECEIPT_CONFLICT");
    C.readRun(saved);
    return saved;
  }
  function readSource(event, params) {
    C.fields(params, ["taskId"]);
    C.id(params.taskId);
    const check = createBoardReadCheck(
      database,
      event,
      { taskId: params.taskId },
      dependencies,
    );
    const db = database.getDatabase();
    return transaction(database, db, () => {
      check();
      const source = C.snapshot(db, params.taskId);
      checkBoardWriteReferences(
        db,
        "update-task",
        { taskId: params.taskId, updates: {} },
        { boardId: source.board.id, orgId: source.board.org_id },
      );
      let editable = source.board.is_archived === 0,
        reason = editable ? null : "BOARD_ACTION_TARGET_ARCHIVED";
      try {
        authorizeBoardWrite(
          database,
          event,
          "update-task",
          { taskId: params.taskId, updates: {} },
          dependencies,
        ).checkTarget();
      } catch {
        editable = false;
        reason = "BOARD_WRITE_NOT_FOUND_OR_DENIED";
      }
      check();
      const projected = C.projection(source.task);
      let movable = editable;
      try {
        authorizeBoardWrite(
          database,
          event,
          "update-task",
          { taskId: params.taskId, updates: C.moveProjection(source.task) },
          dependencies,
        ).checkTarget();
      } catch {
        movable = false;
      }
      const editableFields = editable
        ? C.FIELDS.filter((field) => {
            try {
              authorizeBoardWrite(
                database,
                event,
                "update-task",
                {
                  taskId: params.taskId,
                  updates: { [field]: projected[field] },
                },
                dependencies,
              ).checkTarget();
              return true;
            } catch {
              return false;
            }
          })
        : [];
      return {
        success: true,
        task: {
          id: source.task.id,
          orgId: source.board.org_id,
          boardId: source.board.id,
          ...C.projection(source.task),
        },
        editable,
        editableFields,
        movement: {
          editable: movable,
          ...C.moveProjection(source.task),
          columns: source.columns.map((column) => ({
            id: column.id,
            name: column.name,
          })),
        },
        reason,
      };
    });
  }
  function preview(event, params) {
    C.fields(params, ["taskId", "updates", "idempotencyKey"]);
    C.id(params.taskId);
    C.nonce(params.idempotencyKey);
    C.patch(params.updates);
    const ctx = context(event, params.taskId, params.updates),
      cap = capFor(ctx, event),
      { db } = ctx;
    let caps = capabilities.get(db);
    if (!caps) {
      caps = new Map();
      capabilities.set(db, caps);
    }
    for (const [key, value] of caps)
      if (value.deadline <= mono()) caps.delete(key);
    if (caps.size >= C.LIMITS.capsPerVault) fail("BOARD_ACTION_PREVIEW_LIMIT");
    const result = transaction(database, db, () => {
      cap.check(event);
      const source = currentSource(ctx);
      checkUpdateReferences(ctx, params.updates);
      const previewId = randomUUID(),
        request = C.requestFor(
          source,
          params.updates,
          params.idempotencyKey,
          previewId,
        );
      const previous = C.rowByKey(db, request.idempotencyDigest);
      if (previous) {
        assertBinding(
          previous,
          C.requestFor(
            source,
            params.updates,
            params.idempotencyKey,
            previous.preview_id,
          ),
          ctx,
        );
        fail("BOARD_ACTION_IDEMPOTENCY_RECORDED");
      }
      if (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM task_board_update_runs WHERE task_id=?",
          )
          .get(ctx.taskId).n >= C.LIMITS.runsPerTask ||
        db.prepare("SELECT COUNT(*) AS n FROM task_board_update_runs").get()
          .n >= C.LIMITS.runsPerVault
      )
        fail("BOARD_ACTION_RUN_LIMIT");
      const evidence = [
          C.sourceEvidence(source, request, ctx.auth.actor, cap.authGeneration),
        ],
        run = C.actionRun(request, {
          startedAt: new Date(cap.created).toISOString(),
          evidence,
        });
      db.prepare(
        `INSERT INTO task_board_update_runs (id,preview_id,task_id,board_id,org_id,actor_did,auth_generation,idempotency_digest,invocation_digest,status,expected_version,expires_at,created_at,run_json,evidence_json)
        VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?)`,
      ).run(
        run.id,
        previewId,
        ctx.taskId,
        source.board.id,
        source.board.org_id,
        ctx.auth.actor,
        cap.authGeneration,
        request.idempotencyDigest,
        request.invocationDigest,
        request.expectedVersion,
        cap.expires,
        cap.created,
        JSON.stringify(run),
        JSON.stringify(evidence),
      );
      C.revisionSchema(db);
      cap.check(event);
      C.readRun(C.rowById(db, run.id));
      return {
        success: true,
        runId: run.id,
        request,
        before: C.projectionFor(source.task, request.actionType),
        after: {
          ...C.projectionFor(source.task, request.actionType),
          ...params.updates,
        },
      };
    });
    caps.set(result.request.input.previewId, cap);
    return result;
  }
  async function execute(event, params) {
    C.fields(params, ["request"]);
    const request = C.request(params.request),
      ctx = context(event, request.target.id, request.input.updates),
      { db } = ctx;
    if (request.target.scope.id !== ctx.auth.scope.orgId)
      fail("BOARD_WRITE_SCOPE_CONFLICT");
    let admitted,
      ownedOperation = false;
    try {
      admitted = transaction(database, db, () => {
        ctx.check();
        let row = C.rowByKey(db, request.idempotencyDigest);
        if (!row) fail("BOARD_ACTION_PREVIEW_REQUIRED");
        assertBinding(row, request, ctx);
        if (row.status !== "queued") return { previous: response(row, true) };
        if (![C.ACTION_TYPE, C.MOVE_ACTION_TYPE].includes(request.actionType))
          fail("BOARD_ACTION_PREVIEW_EXPIRED");
        checkUpdateReferences(ctx, request.input.updates);
        if (nativeOperations.has(db))
          fail("BOARD_ACTION_NATIVE_OPERATION_BUSY");
        const cap = capabilities.get(db)?.get(request.input.previewId);
        checkCap(cap, row, event);
        if (ctx.auth.actor !== cap.actor)
          fail("BOARD_WRITE_NOT_FOUND_OR_DENIED");
        if (
          db
            .prepare(
              "SELECT 1 FROM task_board_update_runs WHERE task_id=? AND status IN ('running','unknown')",
            )
            .get(ctx.taskId)
        )
          fail("BOARD_ACTION_UNRESOLVED_ACTION");
        const source = currentSource(ctx);
        if (source.ref.version !== request.expectedVersion)
          fail("BOARD_ACTION_VERSION_CONFLICT");
        const parsed = C.readRun(row),
          run = { ...parsed.run, status: "running" };
        C.saveRun(db, row, run, parsed.evidence);
        row = C.rowById(db, row.id);
        assertBinding(row, request, ctx);
        checkCap(cap, row, event);
        return { row, parsed: C.readRun(row), cap, source };
      });
      if (admitted.previous) return admitted.previous;
      nativeOperations.add(db);
      ownedOperation = true;
      const { cap, source } = admitted;
      const gate = new ApprovalGate({
        defaultPolicy: "strict",
        confirm: async () => {
          checkCap(cap, admitted.row, event);
          const parent = platform().BrowserWindow.fromWebContents(event.sender);
          const chosen = await platform().dialog.showMessageBox(parent, {
            type: "question",
            title: "确认修改看板任务",
            message: "保存以下任务修改？",
            detail: [
              `当前身份：${display(ctx.auth.actor)}`,
              `组织：${display(source.board.org_id)}`,
              `看板：${display(source.board.id)}`,
              `任务：${display(ctx.taskId)}`,
              ...Object.keys(request.input.updates).map(
                (key) =>
                  `${FIELD_LABELS[key]}\n修改前：${display(C.projectionFor(source.task, request.actionType)[key])}\n修改后：${display(request.input.updates[key])}${key === "columnId" ? `\n原列名称：${display(source.columns.find((column) => column.id === source.task.column_id)?.name)}\n目标列名称：${display(source.columns.find((column) => column.id === request.input.updates.columnId)?.name)}` : ""}`,
              ),
              `操作摘要：${request.actionDigest}`,
            ].join("\n\n"),
            buttons: ["取消", "确认保存"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          return chosen?.response === 1;
        },
      });
      const decision = await gate.decide({
        sessionId: "board-task-update",
        policy: "strict",
        riskLevel: "high",
        tool: request.actionType,
      });
      const approved =
        decision?.decision === "allow" &&
        decision.via === "user-confirm" &&
        decision.policy === "strict" &&
        decision.riskLevel === "high" &&
        !decision.authorization;
      const cancelled =
        decision?.decision === "deny" &&
        decision.via === "user-deny" &&
        decision.policy === "strict" &&
        decision.riskLevel === "high" &&
        !decision.authorization;
      const approval = {
        id: randomUUID(),
        kind:
          approved || cancelled
            ? "local-user-confirmation"
            : "approval-gate-decision",
        actorDid: ctx.auth.actor,
        invocationDigest: request.invocationDigest,
        actionDigest: request.actionDigest,
        expectedVersion: request.expectedVersion,
        decision: approved ? "allow" : "deny",
        via: approved
          ? "user-confirm"
          : cancelled
            ? "user-deny"
            : "confirm-error",
        policy: "strict",
        riskLevel: "high",
        at: new Date(Math.max(wall(), admitted.row.created_at)).toISOString(),
      };
      admitted.approval = approval;
      const result = transaction(database, db, () => {
        checkCap(cap, admitted.row, event);
        const row = C.rowById(db, admitted.row.id);
        assertBinding(row, request, ctx);
        if (row.status !== "running") return response(row, true);
        if (
          row.run_json !== admitted.row.run_json ||
          row.evidence_json !== admitted.row.evidence_json
        )
          fail("BOARD_ACTION_RECEIPT_CONFLICT");
        const latest = currentSource(ctx);
        checkUpdateReferences(ctx, request.input.updates);
        if (latest.ref.version !== request.expectedVersion)
          fail("BOARD_ACTION_VERSION_CONFLICT");
        const parsed = C.readRun(row),
          evidence = [...parsed.evidence, approval];
        if (!approved) {
          const saved = terminal(
            ctx,
            row,
            parsed,
            cancelled ? "cancelled" : "denied",
            {
              approval,
              evidence,
              errorCode: cancelled ? null : "BOARD_ACTION_CONFIRMATION_FAILED",
            },
          );
          ctx.check();
          C.readRun(saved);
          return response(saved);
        }
        const timestamp = Math.max(wall(), latest.task.updated_at + 1);
        if (!Number.isSafeInteger(timestamp))
          fail("BOARD_ACTION_SOURCE_INVALID");
        const columnMap =
          request.actionType === C.MOVE_ACTION_TYPE
            ? C.MOVE_COLUMNS
            : C.COLUMN_MAP;
        const expectedTask = {
          ...latest.task,
          ...Object.fromEntries(
            Object.entries(request.input.updates).map(([key, value]) => [
              columnMap[key],
              value,
            ]),
          ),
          updated_at: timestamp,
        };
        if (Object.hasOwn(request.input.updates, "status"))
          expectedTask.completed_at =
            request.input.updates.status === "done"
              ? latest.task.status === "done" &&
                Number.isSafeInteger(latest.task.completed_at)
                ? latest.task.completed_at
                : timestamp
              : null;
        const keys = Object.keys(request.input.updates),
          sets = keys.map((key) => `${columnMap[key]}=?`),
          bindings = keys.map((key) => request.input.updates[key]);
        if (Object.hasOwn(request.input.updates, "status")) {
          sets.push("completed_at=?");
          bindings.push(expectedTask.completed_at);
        }
        sets.push("updated_at=?");
        bindings.push(
          timestamp,
          ctx.taskId,
          latest.task.updated_at,
          latest.revision,
        );
        const changed = db
          .prepare(
            `UPDATE team_tasks SET ${sets.join(",")} WHERE id=? AND updated_at=? AND (SELECT revision FROM task_board_task_revisions WHERE task_id=team_tasks.id)=?`,
          )
          .run(...bindings);
        if (Number(changed.changes) !== 1)
          fail("BOARD_ACTION_VERSION_CONFLICT");
        const after = currentSource(ctx);
        checkUpdateReferences(ctx, request.input.updates);
        if (
          C.digest(after.task) !== C.digest(expectedTask) ||
          C.digest(after.board) !== C.digest(latest.board) ||
          after.boardRevision !== latest.boardRevision ||
          C.digest(after.columns) !== C.digest(latest.columns) ||
          after.revision !== latest.revision + 1
        )
          fail("BOARD_ACTION_POSTCONDITION_FAILED");
        const activityId = randomUUID(),
          metadata = JSON.stringify({
            runId: row.id,
            invocationDigest: request.invocationDigest,
            fields: keys,
            revisionBefore: latest.revision,
            revisionAfter: after.revision,
          });
        db.prepare(
          "INSERT INTO task_activity_log(id,task_id,actor_did,action,metadata,created_at) VALUES(?,?,?,?,?,?)",
        ).run(
          activityId,
          ctx.taskId,
          ctx.auth.actor,
          request.actionType === C.MOVE_ACTION_TYPE
            ? "controlled_task_move"
            : "controlled_task_update",
          metadata,
          timestamp,
        );
        const execution = {
          id: randomUUID(),
          kind:
            request.actionType === C.MOVE_ACTION_TYPE
              ? "sqlite-board-task-move"
              : "sqlite-board-task-update",
          actorDid: ctx.auth.actor,
          invocationDigest: request.invocationDigest,
          beforeVersion: request.expectedVersion,
          afterVersion: after.ref.version,
          affectedRows: 1,
          revisionBefore: latest.revision,
          revisionAfter: after.revision,
          activityId,
        };
        evidence.push(execution);
        let saved = terminal(ctx, row, parsed, "succeeded", {
          approval,
          execution,
          evidence,
          afterVersion: after.ref.version,
        });
        checkCap(cap, saved, event);
        const final = currentSource(ctx),
          activity = db
            .prepare("SELECT * FROM task_activity_log WHERE id=?")
            .get(activityId);
        checkUpdateReferences(ctx, request.input.updates);
        if (
          final.ref.version !== after.ref.version ||
          C.digest(final.task) !== C.digest(expectedTask) ||
          C.digest(final.board) !== C.digest(latest.board) ||
          !activity ||
          activity.task_id !== ctx.taskId ||
          activity.actor_did !== ctx.auth.actor ||
          activity.action !==
            (request.actionType === C.MOVE_ACTION_TYPE
              ? "controlled_task_move"
              : "controlled_task_update") ||
          activity.metadata !== metadata ||
          activity.old_value != null ||
          activity.new_value != null ||
          activity.created_at !== timestamp
        )
          fail("BOARD_ACTION_POSTCONDITION_FAILED");
        const finalRow = C.rowById(db, row.id);
        assertBinding(finalRow, request, ctx);
        if (
          finalRow.status !== "succeeded" ||
          finalRow.run_json !== saved.run_json ||
          finalRow.evidence_json !== saved.evidence_json ||
          C.readRun(finalRow).run.afterVersion !== after.ref.version
        )
          fail("BOARD_ACTION_RECEIPT_CONFLICT");
        return response(finalRow);
      });
      return result;
    } catch (error) {
      const code = safeCode(error);
      if (admitted?.row)
        try {
          transaction(database, db, () => {
            const row = C.rowById(db, admitted.row.id);
            if (
              !row ||
              row.status !== "running" ||
              row.actor_did !== ctx.auth.actor ||
              row.invocation_digest !== request.invocationDigest
            )
              return;
            const parsed = C.readRun(row),
              known =
                /^(BOARD_WRITE_|BOARD_READ_|ACTION_CONTROLLED_|BOARD_ACTION_(?:VERSION_CONFLICT|CONTEXT_CHANGED|PREVIEW_EXPIRED|TARGET_ARCHIVED|SOURCE_INVALID|SOURCE_LIMIT|REVISION_UNAVAILABLE))/u.test(
                  code,
                );
            const approval = admitted.approval || null,
              evidence = [...parsed.evidence, ...(approval ? [approval] : [])];
            terminal(ctx, row, parsed, known ? "denied" : "unknown", {
              approval,
              evidence,
              errorCode: code,
            });
          });
        } catch {
          /* A retained running receipt is unresolved and never replayed. */
        }
      try {
        ctx.check();
        return {
          success: false,
          error: code,
          ...(admitted?.row
            ? { run: C.readRun(C.rowById(db, admitted.row.id)).run }
            : {}),
        };
      } catch {
        return { success: false, error: "BOARD_WRITE_NOT_FOUND_OR_DENIED" };
      }
    } finally {
      if (ownedOperation) {
        nativeOperations.delete(db);
        capabilities.get(db)?.delete(request.input.previewId);
      }
    }
  }
  function listRuns(event, params) {
    C.fields(params, ["taskId"], ["beforeId", "limit"]);
    C.id(params.taskId);
    if (params.beforeId !== undefined) C.id(params.beforeId);
    const limit = params.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("BOARD_ACTION_INVALID_REQUEST");
    const ctx = context(event, params.taskId),
      { db } = ctx;
    return transaction(database, db, () => {
      ctx.check();
      let cursor;
      if (params.beforeId !== undefined) {
        cursor = db
          .prepare(
            "SELECT rowid FROM task_board_update_runs WHERE id=? AND task_id=? AND org_id=? AND board_id=?",
          )
          .get(
            params.beforeId,
            ctx.taskId,
            ctx.auth.scope.orgId,
            ctx.auth.scope.boardId,
          )?.rowid;
        if (cursor === undefined) fail("BOARD_ACTION_INVALID_CURSOR");
      }
      const rows = db
        .prepare(
          `SELECT ${C.COLUMNS} FROM task_board_update_runs WHERE task_id=? AND org_id=? AND board_id=? ${cursor === undefined ? "" : "AND rowid<?"} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(
          ctx.taskId,
          ctx.auth.scope.orgId,
          ctx.auth.scope.boardId,
          ...(cursor === undefined ? [] : [cursor]),
          limit + 1,
        );
      const selected = rows.slice(0, limit);
      const unresolved = db
        .prepare(
          `SELECT ${C.COLUMNS} FROM task_board_update_runs WHERE task_id=? AND org_id=? AND board_id=? AND status IN ('running','unknown') LIMIT 1`,
        )
        .get(ctx.taskId, ctx.auth.scope.orgId, ctx.auth.scope.boardId);
      const result = {
        success: true,
        runs: selected.map((row) => C.readRun(row)),
        unresolvedRun: unresolved ? C.readRun(unresolved) : null,
        nextCursor: rows.length > limit ? selected.at(-1).id : null,
      };
      ctx.check();
      return result;
    });
  }
  function cancel(event, params) {
    C.fields(params, ["taskId", "runId"]);
    C.id(params.taskId);
    C.id(params.runId);
    const ctx = context(event, params.taskId),
      { db } = ctx;
    return transaction(database, db, () => {
      ctx.check();
      const row = C.rowById(db, params.runId);
      if (!scopeMatches(row, ctx)) fail("BOARD_WRITE_NOT_FOUND_OR_DENIED");
      const parsed = C.readRun(row);
      if (row.actor_did !== ctx.auth.actor) {
        ctx.auth.requiredPermissions.push("board.task.action.cancel");
        ctx.auth.checkAuthority();
      }
      if (!["queued", "running", "unknown"].includes(row.status))
        return response(row, true);
      const approval = {
        id: randomUUID(),
        kind: "host-user-cancellation",
        actorDid: row.actor_did,
        cancelledBy: ctx.auth.actor,
        invocationDigest: parsed.run.invocationDigest,
        actionDigest: parsed.run.actionDigest,
        expectedVersion: parsed.run.expectedVersion,
        decision: "deny",
        via: "explicit-cancel",
        policy: "strict",
        riskLevel: "high",
        at: new Date(Math.max(wall(), row.created_at)).toISOString(),
      };
      const evidence = [parsed.evidence[0], approval],
        saved = terminal(ctx, row, parsed, "cancelled", { approval, evidence });
      ctx.check();
      capabilities.get(db)?.delete(row.preview_id);
      return response(saved);
    });
  }
  const safe = (operation) => (event, params) => {
    try {
      const value = operation(event, params);
      return value?.then
        ? value.catch((error) => ({ success: false, error: safeCode(error) }))
        : value;
    } catch (error) {
      return { success: false, error: safeCode(error) };
    }
  };
  return Object.freeze({
    ...require("./board-task-create-operations").createBoardTaskCreateOperations(
      {
        database,
        dependencies,
        wall,
        mono,
        capFor,
        checkCap,
        capabilities,
        nativeOperations,
        terminal,
        response,
        safe,
        safeCode,
        display,
      },
    ),
    getBoardEditSource: safe(readSource),
    previewBoardUpdate: safe(preview),
    executeBoardUpdate: safe(execute),
    getBoardUpdateRuns: safe(listRuns),
    cancelBoardUpdate: safe(cancel),
  });
}
module.exports = { createBoardTaskUpdateHost, safeCode };
