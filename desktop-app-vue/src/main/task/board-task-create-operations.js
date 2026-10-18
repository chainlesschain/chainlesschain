"use strict";
const { randomUUID } = require("node:crypto");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");
const {
  authorizeBoardWrite,
  checkBoardWriteReferences,
} = require("./board-write-authority");
const { createBoardReadCheck } = require("./board-read-authority");
const { fail, assertStorage, transaction } = require("./board-action-storage");
const C = require("./board-task-update-contract");

function createBoardTaskCreateOperations({
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
}) {
  function context(event, boardId, data = {}) {
    const auth = authorizeBoardWrite(
        database,
        event,
        "create-task",
        { boardId, ...data },
        dependencies,
      ),
      db = auth.db;
    assertStorage(database, db);
    const check = () => {
      auth.checkTarget();
      checkBoardWriteReferences(db, "create-source", { boardId }, auth.scope);
    };
    check();
    return { auth, db, check, taskId: null };
  }
  function references(ctx, data) {
    checkBoardWriteReferences(
      ctx.db,
      "create-task",
      { boardId: ctx.auth.scope.boardId, ...data },
      ctx.auth.scope,
    );
  }
  function createRows(ctx) {
    // Bounded pages avoid fetching a vault-sized collection of receipt JSON.
    let cursor = 0,
      total = 0;
    const rows = [];
    for (;;) {
      const page = ctx.db
        .prepare(
          `SELECT rowid AS sequence,${C.COLUMNS} FROM task_board_update_runs WHERE board_id=? AND org_id=? AND rowid>? ORDER BY rowid LIMIT 50`,
        )
        .all(ctx.auth.scope.boardId, ctx.auth.scope.orgId, cursor);
      if (!page.length) break;
      total += page.length;
      if (total > C.LIMITS.runsPerVault) fail("BOARD_ACTION_RUN_LIMIT");
      for (const row of page) {
        const parsed = C.readRun(row);
        if (parsed.run.actionType === C.CREATE_ACTION_TYPE)
          rows.push({ ...row, parsed });
      }
      cursor = page.at(-1).sequence;
    }
    return rows;
  }
  function binding(row, request, ctx) {
    C.readRun(row);
    if (
      !row ||
      row.task_id !== request.target.id ||
      row.board_id !== ctx.auth.scope.boardId ||
      row.org_id !== ctx.auth.scope.orgId ||
      row.actor_did !== ctx.auth.actor ||
      row.invocation_digest !== request.invocationDigest ||
      row.idempotency_digest !== request.idempotencyDigest ||
      row.expected_version !== request.expectedVersion ||
      row.preview_id !== request.input.previewId
    )
      fail("BOARD_ACTION_IDEMPOTENCY_CONFLICT");
  }
  const projected = (ctx, id, data) => ({
    id,
    boardId: ctx.auth.scope.boardId,
    columnId: data.columnId,
    title: data.title,
    description: data.description,
    priority: data.priority,
    status: "open",
    taskType: data.parentTaskId === null ? "task" : "subtask",
    parentTaskId: data.parentTaskId,
    assigneeDid: data.assigneeDid,
    dueDate: data.dueDate,
    estimatedHours: data.estimatedHours,
    actualHours: data.actualHours,
    position: data.position,
  });
  function source(event, params) {
    C.fields(params, ["boardId"], ["parentTaskId"]);
    C.id(params.boardId);
    const parentId = params.parentTaskId ?? null;
    if (parentId !== null) C.id(parentId);
    const check = createBoardReadCheck(
        database,
        event,
        { boardId: params.boardId },
        dependencies,
      ),
      db = database.getDatabase();
    return transaction(database, db, () => {
      check();
      const current = C.boardSnapshot(db, params.boardId);
      if (parentId !== null) {
        const parent = C.snapshot(db, parentId);
        if (parent.board.id !== params.boardId)
          fail("BOARD_WRITE_SCOPE_CONFLICT");
      }
      let creatable = current.board.is_archived === 0,
        assigneeDid = false;
      try {
        authorizeBoardWrite(
          database,
          event,
          "create-task",
          { boardId: params.boardId, parentTaskId: parentId },
          dependencies,
        ).checkTarget();
      } catch {
        creatable = false;
      }
      if (creatable)
        try {
          authorizeBoardWrite(
            database,
            event,
            "create-task",
            {
              boardId: params.boardId,
              parentTaskId: parentId,
              assigneeDid: "did:permission-check",
            },
            dependencies,
          ).checkTarget();
          assigneeDid = true;
        } catch {
          /* No assignment authority. */
        }
      check();
      return {
        success: true,
        board: { id: current.board.id, orgId: current.board.org_id },
        columns: current.columns.map((c) => ({ id: c.id, name: c.name })),
        creatable,
        optionalFields: { assigneeDid },
      };
    });
  }
  function preview(event, params) {
    C.fields(params, ["boardId", "taskData", "idempotencyKey"]);
    C.id(params.boardId);
    C.nonce(params.idempotencyKey);
    const data = C.createData(params.taskData),
      ctx = context(event, params.boardId, data),
      cap = capFor(ctx, event),
      db = ctx.db;
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
      references(ctx, data);
      if (
        db.prepare("SELECT COUNT(*) AS n FROM task_board_update_runs").get()
          .n >= C.LIMITS.runsPerVault ||
        createRows(ctx).length >= 100
      )
        fail("BOARD_ACTION_RUN_LIMIT");
      const taskId = randomUUID(),
        previewId = randomUUID(),
        source = C.creationSource(
          db,
          params.boardId,
          taskId,
          data.parentTaskId,
        ),
        request = C.createRequestFor(
          source,
          data,
          params.idempotencyKey,
          previewId,
        );
      if (C.rowByKey(db, request.idempotencyDigest))
        fail("BOARD_ACTION_IDEMPOTENCY_RECORDED");
      const evidence = [
          C.sourceEvidence(source, request, ctx.auth.actor, cap.authGeneration),
        ],
        run = C.actionRun(request, {
          startedAt: new Date(cap.created).toISOString(),
          evidence,
        });
      db.prepare(
        `INSERT INTO task_board_update_runs(id,preview_id,task_id,board_id,org_id,actor_did,auth_generation,idempotency_digest,invocation_digest,status,expected_version,expires_at,created_at,run_json,evidence_json)VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?)`,
      ).run(
        run.id,
        previewId,
        taskId,
        params.boardId,
        ctx.auth.scope.orgId,
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
        taskId,
        request,
        before: null,
        after: projected(ctx, taskId, data),
      };
    });
    caps.set(result.request.input.previewId, cap);
    return result;
  }
  async function execute(event, params) {
    C.fields(params, ["request"]);
    const request = C.request(params.request);
    if (request.actionType !== C.CREATE_ACTION_TYPE)
      fail("BOARD_ACTION_INVALID_REQUEST");
    const data = request.input.taskData,
      ctx = context(event, request.input.boardId, data),
      db = ctx.db;
    ctx.taskId = request.target.id;
    if (request.target.scope.id !== ctx.auth.scope.orgId)
      fail("BOARD_WRITE_SCOPE_CONFLICT");
    let admitted,
      owned = false;
    try {
      admitted = transaction(database, db, () => {
        ctx.check();
        let row = C.rowByKey(db, request.idempotencyDigest);
        if (!row) fail("BOARD_ACTION_PREVIEW_REQUIRED");
        binding(row, request, ctx);
        if (row.status !== "queued") return { previous: response(row, true) };
        if (nativeOperations.has(db))
          fail("BOARD_ACTION_NATIVE_OPERATION_BUSY");
        const cap = capabilities.get(db)?.get(request.input.previewId);
        checkCap(cap, row, event);
        if (
          createRows(ctx).some((item) =>
            ["running", "unknown"].includes(item.status),
          )
        )
          fail("BOARD_ACTION_UNRESOLVED_ACTION");
        references(ctx, data);
        const source = C.creationSource(
          db,
          request.input.boardId,
          request.target.id,
          data.parentTaskId,
        );
        if (source.ref.version !== request.expectedVersion)
          fail("BOARD_ACTION_VERSION_CONFLICT");
        const parsed = C.readRun(row);
        C.saveRun(
          db,
          row,
          { ...parsed.run, status: "running" },
          parsed.evidence,
        );
        row = C.rowById(db, row.id);
        binding(row, request, ctx);
        checkCap(cap, row, event);
        return { row, source, cap };
      });
      if (admitted.previous) return admitted.previous;
      nativeOperations.add(db);
      owned = true;
      const { cap, source } = admitted;
      const gate = new ApprovalGate({
        defaultPolicy: "strict",
        confirm: async () => {
          checkCap(cap, admitted.row, event);
          const parent = dependencies.electron || require("electron");
          const result = await parent.dialog.showMessageBox(
            parent.BrowserWindow.fromWebContents(event.sender),
            {
              type: "question",
              title: "确认创建看板任务",
              message: "创建以下任务？",
              detail: [
                `当前身份：${display(ctx.auth.actor)}`,
                `组织：${display(source.board.org_id)}`,
                `看板：${display(source.board.id)}`,
                `任务ID：${display(request.target.id)}`,
                `目标列：${display(data.columnId)} ${display(source.columns.find((c) => c.id === data.columnId)?.name)}`,
                ...Object.entries({
                  标题: data.title,
                  描述: data.description,
                  优先级: data.priority,
                  父任务ID: data.parentTaskId,
                  主要负责人DID: data.assigneeDid,
                  "截止时间（UTC Unix 毫秒）": data.dueDate,
                  "预计工时（小时）": data.estimatedHours,
                  "实际工时（小时）": data.actualHours,
                  排序位置: data.position,
                  初始状态: "open",
                }).map(([key, value]) => `${key}：${display(value)}`),
                `操作摘要：${request.actionDigest}`,
              ].join("\n\n"),
              buttons: ["取消", "确认创建"],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            },
          );
          return result?.response === 1;
        },
      });
      const decision = await gate.decide({
        sessionId: "board-task-create",
        policy: "strict",
        riskLevel: "high",
        tool: C.CREATE_ACTION_TYPE,
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
      return transaction(database, db, () => {
        checkCap(cap, admitted.row, event);
        const row = C.rowById(db, admitted.row.id);
        binding(row, request, ctx);
        if (row.status !== "running") return response(row, true);
        if (
          row.run_json !== admitted.row.run_json ||
          row.evidence_json !== admitted.row.evidence_json
        )
          fail("BOARD_ACTION_RECEIPT_CONFLICT");
        references(ctx, data);
        const latest = C.creationSource(
          db,
          request.input.boardId,
          request.target.id,
          data.parentTaskId,
        );
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
          return response(saved);
        }
        const timestamp = wall();
        const expected = {
          id: request.target.id,
          board_id: source.board.id,
          column_id: data.columnId,
          title: data.title,
          description: data.description,
          priority: data.priority,
          status: "open",
          task_type: data.parentTaskId === null ? "task" : "subtask",
          parent_task_id: data.parentTaskId,
          assignee_did: data.assigneeDid,
          reporter_did: ctx.auth.actor,
          due_date: data.dueDate,
          start_date: null,
          story_points: null,
          estimated_hours: data.estimatedHours,
          actual_hours: data.actualHours,
          labels: null,
          position: data.position,
          sprint_id: null,
          created_at: timestamp,
          updated_at: timestamp,
          completed_at: null,
        };
        const keys = Object.keys(expected);
        db.prepare(
          `INSERT INTO team_tasks(${keys.join(",")})VALUES(${keys.map(() => "?").join(",")})`,
        ).run(...keys.map((key) => expected[key]));
        const after = C.snapshot(db, request.target.id),
          activityId = randomUUID(),
          metadata = JSON.stringify({
            runId: row.id,
            invocationDigest: request.invocationDigest,
            parentTaskId: data.parentTaskId,
          });
        if (C.digest(after.task) !== C.digest(expected) || after.revision !== 1)
          fail("BOARD_ACTION_POSTCONDITION_FAILED");
        db.prepare(
          "INSERT INTO task_activity_log(id,task_id,actor_did,action,metadata,created_at)VALUES(?,?,?,'controlled_task_create',?,?)",
        ).run(
          activityId,
          request.target.id,
          ctx.auth.actor,
          metadata,
          timestamp,
        );
        const execution = {
          id: randomUUID(),
          kind: "sqlite-board-task-create",
          actorDid: ctx.auth.actor,
          invocationDigest: request.invocationDigest,
          beforeVersion: request.expectedVersion,
          afterVersion: after.ref.version,
          affectedRows: 1,
          revisionBefore: 0,
          revisionAfter: 1,
          activityId,
        };
        evidence.push(execution);
        const saved = terminal(ctx, row, parsed, "succeeded", {
          approval,
          execution,
          evidence,
          afterVersion: after.ref.version,
        });
        checkCap(cap, saved, event);
        references(ctx, data);
        const final = C.snapshot(db, request.target.id),
          finalBoard = C.boardSnapshot(db, source.board.id),
          activity = db
            .prepare("SELECT * FROM task_activity_log WHERE id=?")
            .get(activityId),
          finalRow = C.rowById(db, row.id);
        if (
          final.ref.version !== after.ref.version ||
          C.digest(final.task) !== C.digest(expected) ||
          C.digest(finalBoard) !==
            C.digest({
              board: source.board,
              boardRevision: source.boardRevision,
              columns: source.columns,
            }) ||
          (data.parentTaskId !== null &&
            C.snapshot(db, data.parentTaskId).ref.version !==
              source.parentVersion) ||
          !activity ||
          activity.task_id !== request.target.id ||
          activity.actor_did !== ctx.auth.actor ||
          activity.action !== "controlled_task_create" ||
          activity.metadata !== metadata ||
          activity.old_value != null ||
          activity.new_value != null ||
          activity.created_at !== timestamp ||
          finalRow.run_json !== saved.run_json ||
          finalRow.evidence_json !== saved.evidence_json ||
          finalRow.status !== "succeeded"
        )
          fail("BOARD_ACTION_POSTCONDITION_FAILED");
        binding(finalRow, request, ctx);
        return response(finalRow);
      });
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
              approval = admitted.approval || null;
            terminal(
              ctx,
              row,
              parsed,
              /^(BOARD_WRITE_|BOARD_READ_|ACTION_CONTROLLED_|BOARD_ACTION_(?:VERSION_CONFLICT|CONTEXT_CHANGED|PREVIEW_EXPIRED|TARGET_ARCHIVED|SOURCE_|REVISION_|TARGET_EXISTS))/u.test(
                code,
              )
                ? "denied"
                : "unknown",
              {
                approval,
                evidence: [...parsed.evidence, ...(approval ? [approval] : [])],
                errorCode: code,
              },
            );
          });
        } catch {
          /* Retained running stays unresolved. */
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
      if (owned) {
        nativeOperations.delete(db);
        capabilities.get(db)?.delete(request.input.previewId);
      }
    }
  }
  function history(event, params) {
    C.fields(params, ["boardId"], ["limit", "beforeId"]);
    C.id(params.boardId);
    const limit = params.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("BOARD_ACTION_INVALID_REQUEST");
    if (params.beforeId !== undefined) C.id(params.beforeId);
    const ctx = context(event, params.boardId);
    return transaction(database, ctx.db, () => {
      ctx.check();
      const rows = createRows(ctx).reverse();
      let candidates = rows;
      if (params.beforeId !== undefined) {
        const at = rows.findIndex((row) => row.id === params.beforeId);
        if (at < 0) fail("BOARD_ACTION_INVALID_CURSOR");
        candidates = rows.slice(at + 1);
      }
      const selected = candidates.slice(0, limit),
        unresolved = rows.find((row) =>
          ["running", "unknown"].includes(row.status),
        );
      ctx.check();
      return {
        success: true,
        runs: selected.map((row) => row.parsed),
        unresolvedRun: unresolved?.parsed || null,
        nextCursor: candidates.length > limit ? selected.at(-1).id : null,
      };
    });
  }
  function cancel(event, params) {
    C.fields(params, ["boardId", "runId"]);
    C.id(params.boardId);
    C.id(params.runId);
    const ctx = context(event, params.boardId);
    return transaction(database, ctx.db, () => {
      ctx.check();
      const row = C.rowById(ctx.db, params.runId),
        parsed = C.readRun(row);
      if (
        row.board_id !== params.boardId ||
        row.org_id !== ctx.auth.scope.orgId ||
        parsed.run.actionType !== C.CREATE_ACTION_TYPE
      )
        fail("BOARD_WRITE_NOT_FOUND_OR_DENIED");
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
      const saved = terminal(ctx, row, parsed, "cancelled", {
        approval,
        evidence: [parsed.evidence[0], approval],
      });
      ctx.check();
      capabilities.get(ctx.db)?.delete(row.preview_id);
      return response(saved);
    });
  }
  return {
    getBoardCreateSource: safe(source),
    previewBoardCreate: safe(preview),
    executeBoardCreate: safe(execute),
    getBoardCreateRuns: safe(history),
    cancelBoardCreate: safe(cancel),
  };
}
module.exports = { createBoardTaskCreateOperations };
