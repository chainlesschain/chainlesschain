"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { fixture, withHost } = require("./board-authority-fixture.cjs");
const { createBoardTaskUpdateHost } = require("../board-task-update-host");
const C = require("../board-task-update-contract");
const { preloadBoardHost } = require("./board-preload-fixture.cjs");
const {
  validateBusinessActionRequest,
  validateBusinessActionRun,
  createBusinessActionRequest,
} = require("@chainlesschain/session-core/business-object-contract");
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-board-update-"));
  const f = fixture(path.join(directory, "vault.sqlite"));
  const state = { now: Date.now(), mono: 0, confirmations: 0, confirm: null };
  const window = { isDestroyed: () => false };
  f.event.sender = { isDestroyed: () => false };
  f.electron = {
    BrowserWindow: { fromWebContents: () => window },
    dialog: {
      showMessageBox: async (parent, options) => {
        assert.equal(parent, window);
        assert.equal(options.defaultId, 0);
        assert.equal(options.cancelId, 0);
        assert.deepEqual(options.buttons, ["取消", "确认保存"]);
        state.confirmations++;
        return state.confirm ? await state.confirm(options) : { response: 1 };
      },
    },
  };
  const host = createBoardTaskUpdateHost({
    database: f.wrapper,
    ...f.dependencies,
    electron: f.electron,
    now: () => state.now,
    monotonicNow: () => state.mono,
  });
  return Object.assign(f, {
    directory,
    updateState: state,
    window,
    host,
    source: () => host.getBoardEditSource(f.event, { taskId: "task-1" }),
    preview: (
      updates = { title: "Changed by controlled update" },
      key = randomUUID(),
    ) =>
      host.previewBoardUpdate(f.event, {
        taskId: "task-1",
        updates,
        idempotencyKey: key,
      }),
    execute: (prepared) =>
      host.executeBoardUpdate(f.event, { request: prepared.request }),
    cancel: (prepared) =>
      host.cancelBoardUpdate(f.event, {
        taskId: "task-1",
        runId: prepared.runId,
      }),
    history: () => host.getBoardUpdateRuns(f.event, { taskId: "task-1" }),
    cleanup() {
      f.close();
      for (const name of fs.readdirSync(directory))
        fs.unlinkSync(path.join(directory, name));
      fs.rmdirSync(directory);
    },
  });
}

test("preload executeBoardUpdate previews and executes explicit null field resets", async () => {
  const f = setup();
  try {
    f.native
      .prepare(
        "UPDATE team_tasks SET assignee_did='did:member', due_date=1800000000000, estimated_hours=8, actual_hours=2 WHERE id='task-1'",
      )
      .run();
    const bridge = preloadBoardHost(f);
    const updates = {
      assigneeDid: null,
      dueDate: null,
      estimatedHours: null,
      actualHours: null,
    };
    const prepared = await bridge.task.previewBoardUpdate({
      taskId: "task-1",
      updates,
      idempotencyKey: randomUUID(),
    });
    assert.equal(prepared.success, true);
    assert.deepEqual(prepared.request.input.updates, updates);
    const originalRequest = structuredClone(prepared.request);
    const result = await bridge.task.executeBoardUpdate({
      request: prepared.request,
    });
    assert.deepEqual(bridge.calls.at(-1).params.request, originalRequest);
    assert.equal(result.success, true);
    assert.equal(result.run.status, "succeeded");
    const stored = f.native
      .prepare("SELECT * FROM team_tasks WHERE id='task-1'")
      .get();
    for (const field of [
      "assignee_did",
      "due_date",
      "estimated_hours",
      "actual_hours",
    ])
      assert.equal(stored[field], null, field);
    assert.equal(f.updateState.confirmations, 1);
  } finally {
    f.cleanup();
  }
});
const task = (f) =>
  f.native.prepare("SELECT * FROM team_tasks WHERE id='task-1'").get();
const revision = (f) =>
  f.native
    .prepare(
      "SELECT revision FROM task_board_task_revisions WHERE task_id='task-1'",
    )
    .get().revision;
const row = (f, id) =>
  f.native.prepare("SELECT * FROM task_board_update_runs WHERE id=?").get(id);
const activityCount = (f) =>
  f.native
    .prepare(
      "SELECT COUNT(*) AS n FROM task_activity_log WHERE action='controlled_task_update'",
    )
    .get().n;

const moveCount = (f) =>
  f.native
    .prepare(
      "SELECT COUNT(*) AS n FROM task_activity_log WHERE action='controlled_task_move'",
    )
    .get().n;
const boardRevision = (f) =>
  f.native
    .prepare(
      "SELECT revision FROM task_board_structure_revisions WHERE board_id='board-1'",
    )
    .get().revision;

test("production board structure migration seeds once, preserves later revisions and keeps tombstones on board ID changes", () => {
  const f = setup();
  try {
    for (const name of [
      "trg_board_structure_insert",
      "trg_board_structure_update",
      "trg_board_structure_delete",
      "trg_board_column_insert",
      "trg_board_column_update",
      "trg_board_column_delete",
    ])
      f.native.exec(`DROP TRIGGER ${name}`);
    f.native.exec("DROP TABLE task_board_structure_revisions");
    const ddl = fs.readFileSync(
      path.join(__dirname, "../../database/database-schema.js"),
      "utf8",
    );
    const migration = ddl.slice(
      ddl.indexOf("      -- Board structure tombstones"),
      ddl.indexOf("      -- Durable task revision tombstones"),
    );
    f.native.exec(migration);
    assert.equal(boardRevision(f), 1);
    f.native.exec(
      "UPDATE task_board_columns SET name='Done' WHERE id='done-1';UPDATE task_boards SET name='First' WHERE id='board-1'",
    );
    assert.equal(boardRevision(f), 3);
    f.native.exec(migration);
    assert.equal(boardRevision(f), 3);
    f.native.exec(
      "INSERT INTO task_boards(id,org_id,name,owner_did,created_at,updated_at)VALUES('empty-board','org-1','Empty','did:owner',1,1);UPDATE task_boards SET id='renamed-board' WHERE id='empty-board'",
    );
    const rev = (id) =>
      f.native
        .prepare(
          "SELECT revision FROM task_board_structure_revisions WHERE board_id=?",
        )
        .get(id).revision;
    assert.equal(rev("empty-board"), 2);
    assert.equal(rev("renamed-board"), 1);
    assert.equal(f.source().success, true);
  } finally {
    f.cleanup();
  }
});

test("column count and byte budgets use actual SQL values before projection, with inclusive supported boundaries", () => {
  const f = setup();
  try {
    for (let i = 0; i < 198; i++)
      f.native
        .prepare(
          "INSERT INTO task_board_columns(id,board_id,name,position,created_at,updated_at)VALUES(?,'board-1','Column',?,1,1)",
        )
        .run(`bounded-${i}`, i + 2);
    assert.equal(f.source().movement.columns.length, 200);
    f.native.exec(
      "INSERT INTO task_board_columns(id,board_id,name,position,created_at,updated_at)VALUES('one-too-many','board-1','Column',201,1,1)",
    );
    assert.equal(f.source().error, "BOARD_ACTION_SOURCE_LIMIT");
    f.native.exec(
      "DELETE FROM task_board_columns WHERE id='one-too-many';DELETE FROM task_board_columns WHERE id LIKE 'bounded-%'",
    );
    f.native
      .prepare("UPDATE task_board_columns SET name=? WHERE id='done-1'")
      .run("x".repeat(4096));
    assert.equal(f.source().success, true);
    f.native
      .prepare("UPDATE task_board_columns SET name=? WHERE id='done-1'")
      .run("x".repeat(4097));
    assert.equal(f.source().error, "BOARD_ACTION_SOURCE_INVALID");
  } finally {
    f.cleanup();
  }
});

test("same-board movement uses its own action and atomic receipt, actual columns, current permissions and no status side effects", async () => {
  const f = setup();
  try {
    const source = f.source(),
      original = task(f),
      br = boardRevision(f);
    assert.equal(source.movement.editable, true);
    assert.deepEqual(
      source.movement.columns.map((c) => c.id),
      ["column-1", "done-1"],
    );
    const prepared = f.preview({ columnId: "done-1", position: 0 });
    assert.equal(prepared.request.actionType, C.MOVE_ACTION_TYPE);
    assert.deepEqual(prepared.before, { columnId: "column-1", position: 0 });
    assert.deepEqual(prepared.after, { columnId: "done-1", position: 0 });
    f.updateState.confirm = (options) => {
      assert.ok(options.detail.includes("原列名称"));
      assert.ok(options.detail.includes("目标列名称"));
      assert.ok(options.detail.includes("Done"));
      assert.ok(options.detail.includes("done-1"));
      return { response: 1 };
    };
    const result = await f.execute(prepared);
    assert.equal(result.run.status, "succeeded", JSON.stringify(result));
    assert.equal(result.run.actionType, C.MOVE_ACTION_TYPE);
    assert.equal(result.evidence[2].kind, "sqlite-board-task-move");
    assert.equal(task(f).column_id, "done-1");
    assert.equal(task(f).position, 0);
    assert.equal(task(f).status, original.status);
    assert.equal(task(f).completed_at, original.completed_at);
    assert.equal(task(f).updated_at > original.updated_at, true);
    assert.equal(boardRevision(f), br);
    assert.equal(revision(f), 2);
    assert.equal(moveCount(f), 1);
    assert.equal(activityCount(f), 0);
    assert.equal((await f.execute(prepared)).run.status, "succeeded");
    assert.equal(f.updateState.confirmations, 1);
    f.reopen();
    assert.equal((await f.execute(prepared)).run.status, "succeeded");
    assert.equal(f.history().runs[0].run.actionType, C.MOVE_ACTION_TYPE);
  } finally {
    f.cleanup();
  }
});

test("move input requires exact column and bounded position, never mixes business fields and refuses cross-board targets", () => {
  const f = setup();
  try {
    const original = task(f);
    for (const updates of [
      { columnId: "done-1" },
      { position: 0 },
      { columnId: "done-1", position: -1 },
      { columnId: "done-1", position: 0.1 },
      { columnId: "done-1", position: "0" },
      { columnId: "done-1", position: 1000001 },
      { columnId: "done-1", position: null },
      { columnId: "done-1", position: 0, title: "mixed" },
      { columnId: "column-2", position: 0 },
      { columnId: "missing", position: 0 },
    ])
      assert.equal(f.preview(updates).success, false, JSON.stringify(updates));
    assert.equal(
      f.preview({ columnId: "done-1", position: 1000000 }).success,
      true,
    );
    assert.deepEqual(task(f), original);
    assert.equal(moveCount(f), 0);
  } finally {
    f.cleanup();
  }
});

test("movement rechecks both update and move permissions, including withdrawal during native confirmation", async () => {
  const f = setup();
  try {
    f.state.actor = "did:member";
    const perms = (values) =>
      f.native
        .prepare(
          "UPDATE organization_roles SET permissions=? WHERE name='member'",
        )
        .run(JSON.stringify(values));
    for (const values of [["board.task.update"], ["board.task.move"], []]) {
      perms(values);
      assert.equal(f.source().movement.editable, false);
      assert.equal(
        f.preview({ columnId: "done-1", position: 0 }).success,
        false,
      );
    }
    perms(["board.task.update", "board.task.move"]);
    assert.equal(f.source().movement.editable, true);
    const prepared = f.preview({ columnId: "done-1", position: 0 });
    f.updateState.confirm = () => {
      perms(["board.task.update"]);
      return { response: 1 };
    };
    assert.equal((await f.execute(prepared)).success, false);
    assert.equal(task(f).column_id, "column-1");
    assert.equal(moveCount(f), 0);
    assert.equal(row(f, prepared.runId).status, "denied");
  } finally {
    f.cleanup();
  }
});

for (const [change, sql] of [
  [
    "target-column rename ABA",
    "UPDATE task_board_columns SET name='Changed' WHERE id='done-1';UPDATE task_board_columns SET name='Done',updated_at=1 WHERE id='done-1'",
  ],
  [
    "target-column delete/recreate",
    "DELETE FROM task_board_columns WHERE id='done-1';INSERT INTO task_board_columns(id,board_id,name,position,is_done_column,created_at,updated_at)VALUES('done-1','board-1','Done',1,1,1,1)",
  ],
  [
    "target-column board ABA",
    "UPDATE task_board_columns SET board_id='board-2' WHERE id='done-1';UPDATE task_board_columns SET board_id='board-1' WHERE id='done-1'",
  ],
  [
    "board metadata ABA",
    "UPDATE task_boards SET name='Changed' WHERE id='board-1';UPDATE task_boards SET name='First',updated_at=1 WHERE id='board-1'",
  ],
  ["target-column removal", "DELETE FROM task_board_columns WHERE id='done-1'"],
])
  for (const phase of ["before", "during"])
    test(`${change} ${phase} native movement invalidates the proposal without partial writes`, async () => {
      const f = setup();
      try {
        const prepared = f.preview({ columnId: "done-1", position: 3 }),
          br = boardRevision(f);
        if (phase === "before") f.native.exec(sql);
        else
          f.updateState.confirm = () => {
            f.native.exec(sql);
            return { response: 1 };
          };
        assert.equal((await f.execute(prepared)).success, false);
        assert.equal(task(f).column_id, "column-1");
        assert.equal(task(f).position, 0);
        assert.ok(boardRevision(f) > br);
        assert.equal(moveCount(f), 0);
        assert.notEqual(row(f, prepared.runId).status, "succeeded");
      } finally {
        f.cleanup();
      }
    });

test("board/column changes also invalidate a field-edit preview and structure tombstones survive board reuse", async () => {
  const f = setup();
  try {
    const prepared = f.preview(),
      oldVersion = prepared.request.expectedVersion;
    f.native.exec(
      "UPDATE task_board_columns SET name='Renamed' WHERE id='done-1';UPDATE task_board_columns SET name='Done',updated_at=1 WHERE id='done-1'",
    );
    assert.notEqual(
      C.snapshot(f.wrapper.getDatabase(), "task-1").ref.version,
      oldVersion,
    );
    assert.equal(
      (await f.execute(prepared)).error,
      "BOARD_ACTION_VERSION_CONFLICT",
    );
    assert.equal(task(f).title, "Original");
    f.native.exec(
      "INSERT INTO task_boards(id,org_id,name,owner_did,created_at,updated_at)VALUES('empty-board','org-1','Empty','did:owner',1,1)",
    );
    const rev = () =>
      f.native
        .prepare(
          "SELECT revision FROM task_board_structure_revisions WHERE board_id='empty-board'",
        )
        .get().revision;
    assert.equal(rev(), 1);
    f.native.exec(
      "DELETE FROM task_boards WHERE id='empty-board';INSERT INTO task_boards(id,org_id,name,owner_did,created_at,updated_at)VALUES('empty-board','org-1','Empty','did:owner',1,1)",
    );
    assert.equal(rev(), 3);
  } finally {
    f.cleanup();
  }
});

test("move and field edit share a per-task unresolved fence, native operation, explicit cancellation and no late execution", async () => {
  const f = setup();
  try {
    let resolve;
    f.updateState.confirm = () =>
      new Promise((yes) => {
        resolve = yes;
      });
    const moved = f.preview({ columnId: "done-1", position: 2 }),
      edited = f.preview({ title: "Cannot overtake" });
    const waiting = f.execute(moved);
    assert.equal(row(f, moved.runId).status, "running");
    assert.equal(
      (await f.execute(edited)).error,
      "BOARD_ACTION_NATIVE_OPERATION_BUSY",
    );
    assert.equal(f.history().unresolvedRun.run.actionType, C.MOVE_ACTION_TYPE);
    assert.equal(f.cancel(moved).run.status, "cancelled");
    resolve({ response: 1 });
    assert.equal((await waiting).run.status, "cancelled");
    assert.equal(task(f).column_id, "column-1");
    assert.equal(moveCount(f), 0);
    f.updateState.confirm = null;
    assert.equal((await f.execute(edited)).run.status, "succeeded");
  } finally {
    f.cleanup();
  }
});

for (const stage of ["task", "activity", "receipt", "post-receipt-authority"])
  test(`movement ${stage} failure rolls back placement, revision, activity and success receipt`, async () => {
    const f = setup();
    try {
      const original = task(f),
        prepared = f.preview({ columnId: "done-1", position: 42 });
      let reachedActivity = false;
      f.state.beforeRun = (sql) => {
        if (stage === "task" && sql.startsWith("UPDATE team_tasks SET"))
          throw new Error("PRIVATE task");
        if (sql.startsWith("INSERT INTO task_activity_log")) {
          reachedActivity = true;
          if (stage === "activity") throw new Error("PRIVATE activity");
        }
        if (
          reachedActivity &&
          sql.startsWith("UPDATE task_board_update_runs SET")
        ) {
          if (stage === "receipt") throw new Error("PRIVATE receipt");
          if (stage === "post-receipt-authority") f.state.generation++;
        }
      };
      const result = await f.execute(prepared);
      assert.equal(result.success, false);
      assert.deepEqual(task(f), original);
      assert.equal(revision(f), 1);
      assert.equal(moveCount(f), 0);
      assert.notEqual(row(f, prepared.runId).status, "succeeded");
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    } finally {
      f.cleanup();
    }
  });

test("column reads are bounded before fetching bodies, and missing/modified structure triggers fail closed", () => {
  const f = setup();
  try {
    f.native
      .prepare("UPDATE task_board_columns SET name=? WHERE id='done-1'")
      .run("x".repeat(65537));
    assert.equal(f.source().error, "BOARD_ACTION_SOURCE_LIMIT");
    f.native.exec(
      "UPDATE task_board_columns SET name='Done' WHERE id='done-1';DROP TRIGGER trg_board_column_update",
    );
    assert.equal(f.preview().error, "BOARD_ACTION_REVISION_UNAVAILABLE");
  } finally {
    f.cleanup();
  }
});

test("legacy movement IPC and direct manager cannot mutate, including forged destination aliases", async () => {
  const f = setup();
  try {
    await withHost(f, async (handlers) => {
      const manager = new (require("../team-task-manager").TeamTaskManager)(
        f.wrapper,
      );
      assert.throws(
        () => manager.moveTaskSync("task-1", "done-1", 0, "did:owner"),
        { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
      );
      for (const params of [
        { taskId: "task-1", columnId: "done-1", position: 0 },
        { taskId: "task-1", targetColumnId: "done-1", position: 0 },
      ])
        await assert.rejects(handlers.get("task:move-task")(f.event, params), {
          code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
        });
      assert.equal(task(f).column_id, "column-1");
      assert.equal(revision(f), 1);
    });
  } finally {
    f.cleanup();
  }
});

test("all eight fields use column-safe atomic edits, exact zero/null/fractional values and native confirmation", async () => {
  const f = setup();
  try {
    const originalRoster = f.native
      .prepare("SELECT * FROM task_assignees")
      .all();
    const patch = {
      title: "Full edit",
      description: "new",
      status: "review",
      priority: "critical",
      assigneeDid: "did:member",
      dueDate: 0,
      estimatedHours: 0,
      actualHours: 1.25,
    };
    assert.deepEqual(f.source().editableFields, C.FIELDS);
    const prepared = f.preview(patch);
    assert.equal(prepared.request.actionType, "board-task.update-fields");
    assert.equal(prepared.request.actionVersion, 1);
    assert.equal(prepared.before.priority, "medium");
    f.updateState.confirm = (options) => {
      assert.ok(options.detail.includes("主负责人 DID"));
      assert.ok(options.detail.includes("did:member"));
      assert.ok(options.detail.includes("UTC Unix 毫秒"));
      assert.ok(options.detail.includes("1.25"));
      return { response: 1 };
    };
    assert.equal((await f.execute(prepared)).run.status, "succeeded");
    assert.deepEqual(C.projection(task(f)), patch);
    assert.equal(revision(f), 2);
    assert.equal(activityCount(f), 1);
    assert.deepEqual(
      f.native.prepare("SELECT * FROM task_assignees").all(),
      originalRoster,
    );
    const cleared = f.preview({
      assigneeDid: null,
      dueDate: null,
      estimatedHours: null,
      actualHours: null,
    });
    f.updateState.confirm = null;
    assert.equal((await f.execute(cleared)).run.status, "succeeded");
    for (const field of [
      "assigneeDid",
      "dueDate",
      "estimatedHours",
      "actualHours",
    ])
      assert.equal(f.source().task[field], null);
    const ledger = JSON.stringify(
      f.native.prepare("SELECT * FROM task_board_update_runs").all(),
    );
    assert.ok(!ledger.includes("Full edit"));
    assert.ok(!ledger.includes('"assigneeDid":"did:member"'));
  } finally {
    f.cleanup();
  }
});

for (const [field, invalid] of Object.entries({
  priority: [null, "urgent", 1],
  assigneeDid: ["", "did:", "did:bad value", "x", "did:" + "x".repeat(253)],
  dueDate: [-1, "2026-10-20", "0", 0.5, 8640000000000001],
  estimatedHours: [-1, "1.5", 1000000.1, Infinity, NaN],
  actualHours: [-0.01, "", 1000001, undefined],
}))
  test(`invalid ${field} values cannot create previews or mutate task state`, () => {
    const f = setup();
    try {
      const before = task(f),
        rev = revision(f);
      for (const value of invalid)
        assert.equal(
          f.preview({ [field]: value }).success,
          false,
          String(value),
        );
      assert.deepEqual(task(f), before);
      assert.equal(revision(f), rev);
      assert.equal(f.history().runs.length, 0);
    } finally {
      f.cleanup();
    }
  });

test("date and hours upper bounds retain exact supported values", async () => {
  const f = setup();
  try {
    const prepared = f.preview({
      dueDate: 8640000000000000,
      estimatedHours: 1000000,
      actualHours: 0,
    });
    assert.equal((await f.execute(prepared)).run.status, "succeeded");
    assert.equal(task(f).due_date, 8640000000000000);
    assert.equal(task(f).estimated_hours, 1000000);
    assert.equal(task(f).actual_hours, 0);
  } finally {
    f.cleanup();
  }
});

for (const [field, permission, value] of [
  ["priority", "board.task.set-priority", "high"],
  ["assigneeDid", "board.task.assign", "did:member"],
  ["dueDate", "board.task.set-due-date", null],
])
  test(`${field} requires base update plus its specific current permission throughout native confirmation`, async () => {
    const f = setup();
    try {
      f.state.actor = "did:member";
      const setPermissions = (list) =>
        f.native
          .prepare(
            "UPDATE organization_roles SET permissions=? WHERE name='member'",
          )
          .run(JSON.stringify(list));
      setPermissions(["board.task.update"]);
      assert.ok(!f.source().editableFields.includes(field));
      assert.equal(f.preview({ [field]: value }).success, false);
      setPermissions([permission]);
      assert.equal(f.source().editable, false);
      assert.equal(f.preview({ [field]: value }).success, false);
      setPermissions(["board.task.update", permission]);
      assert.ok(f.source().editableFields.includes(field));
      const prepared = f.preview({ [field]: value });
      f.updateState.confirm = () => {
        setPermissions(["board.task.update"]);
        return { response: 1 };
      };
      const before = task(f);
      assert.equal((await f.execute(prepared)).success, false);
      assert.deepEqual(task(f), before);
      assert.equal(activityCount(f), 0);
      assert.equal(row(f, prepared.runId).status, "denied");
      setPermissions(["board.task.update", permission]);
      assert.equal((await f.execute(prepared)).run.status, "denied");
      assert.equal(f.updateState.confirmations, 1);
    } finally {
      f.cleanup();
    }
  });

test("proposed primary assignee must stay active in the same organization, while terminal replay does not revalidate the old proposal", async () => {
  const f = setup();
  try {
    for (const assigneeDid of ["did:other", "did:former", "did:missing"])
      assert.equal(f.preview({ assigneeDid }).success, false);
    const prepared = f.preview({ assigneeDid: "did:member" });
    f.updateState.confirm = () => {
      f.native.exec(
        "UPDATE organization_members SET status='removed' WHERE member_did='did:member'",
      );
      return { response: 1 };
    };
    assert.equal((await f.execute(prepared)).success, false);
    assert.equal(task(f).assignee_did, null);
    f.native.exec(
      "UPDATE organization_members SET status='active' WHERE member_did='did:member'",
    );
    f.updateState.confirm = null;
    const successful = f.preview({ assigneeDid: "did:member" });
    assert.equal((await f.execute(successful)).run.status, "succeeded");
    f.native.exec(
      "UPDATE organization_members SET status='removed' WHERE member_did='did:member'",
    );
    assert.equal((await f.execute(successful)).run.status, "succeeded");
    assert.equal(f.updateState.confirmations, 2);
  } finally {
    f.cleanup();
  }
});

test("legacy three-field records remain readable and cancellable but queued legacy requests never execute", async () => {
  const f = setup();
  try {
    const prepared = f.preview(),
      stored = row(f, prepared.runId);
    const request = createBusinessActionRequest({
      actionType: C.LEGACY_ACTION_TYPE,
      actionVersion: 1,
      target: prepared.request.target,
      expectedVersion: prepared.request.expectedVersion,
      input: prepared.request.input,
      idempotencyKey: prepared.request.idempotencyKey,
    });
    const evidence = [
      C.sourceEvidence(
        C.snapshot(f.wrapper.getDatabase(), "task-1"),
        request,
        stored.actor_did,
        stored.auth_generation,
      ),
    ];
    const run = C.actionRun(request, {
      id: stored.id,
      startedAt: new Date(stored.created_at).toISOString(),
      evidence,
    });
    f.native
      .prepare(
        "UPDATE task_board_update_runs SET idempotency_digest=?,invocation_digest=?,run_json=?,evidence_json=? WHERE id=?",
      )
      .run(
        request.idempotencyDigest,
        request.invocationDigest,
        JSON.stringify(run),
        JSON.stringify(evidence),
        stored.id,
      );
    assert.equal(f.history().runs[0].run.actionType, C.LEGACY_ACTION_TYPE);
    assert.equal(
      (await f.execute({ request })).error,
      "BOARD_ACTION_PREVIEW_EXPIRED",
    );
    assert.equal(f.cancel(prepared).run.status, "cancelled");
    assert.equal((await f.execute({ request })).run.status, "cancelled");
    assert.equal(f.updateState.confirmations, 0);
    const forged = createBusinessActionRequest({
      actionType: C.LEGACY_ACTION_TYPE,
      actionVersion: 1,
      target: request.target,
      expectedVersion: request.expectedVersion,
      input: { ...request.input, updates: { priority: "high" } },
      idempotencyKey: randomUUID(),
    });
    assert.throws(() => C.request(forged));
  } finally {
    f.cleanup();
  }
});

test("legacy direct setters and generic update cannot bypass the host, including direct manager calls", async () => {
  const f = setup();
  try {
    await withHost(f, async () => {
      const { TeamTaskManager } = require("../team-task-manager");
      const manager = new TeamTaskManager(f.wrapper),
        before = task(f);
      for (const method of [
        "updateTaskSync",
        "assignTaskSync",
        "setPrioritySync",
        "setDueDateSync",
      ])
        assert.throws(() => manager[method]("task-1", { priority: "high" }), {
          code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
        });
      for (const action of ["assign-task", "set-priority", "set-due-date"])
        assert.throws(
          () =>
            f.write(action, {
              taskId: "task-1",
              userDid: "did:member",
              priority: "high",
              dueDate: 0,
            }),
          { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
        );
      for (const field of C.FIELDS)
        assert.throws(
          () =>
            f.write("update-task", {
              taskId: "task-1",
              updates: { [field]: C.projection(before)[field] },
            }),
          { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
        );
      assert.deepEqual(task(f), before);
      assert.equal(activityCount(f), 0);
    });
  } finally {
    f.cleanup();
  }
});

test("production preview, native approval, full-row CAS, activity and standard ActionRun commit together; nonce replay survives reopen", async () => {
  const f = setup();
  try {
    assert.equal(f.source().editable, true);
    const prepared = f.preview({
      title: "Secret proposed title",
      description: "Private report body",
      status: "done",
    });
    assert.equal(prepared.success, true, JSON.stringify(prepared));
    validateBusinessActionRequest(prepared.request);
    assert.equal(prepared.request.target.sourceKind, "desktop.board-task");
    assert.equal(row(f, prepared.runId).status, "queued");
    assert.equal(task(f).title, "Original");
    assert.equal(revision(f), 1);
    assert.equal(f.updateState.confirmations, 0);
    f.updateState.confirm = (options) => {
      assert.match(options.detail, /Secret proposed title/);
      assert.equal(row(f, prepared.runId).status, "running");
      return { response: 1 };
    };
    const result = await f.execute(prepared);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.run.status, "succeeded");
    validateBusinessActionRun(result.run);
    assert.equal(task(f).title, "Secret proposed title");
    assert.equal(task(f).description, "Private report body");
    assert.equal(task(f).completed_at, f.updateState.now);
    assert.equal(revision(f), 2);
    assert.equal(activityCount(f), 1);
    assert.equal(result.evidence.length, 3);
    assert.ok(result.run.approvalRef);
    assert.ok(result.run.executionRef);
    assert.notEqual(result.run.afterVersion, result.run.expectedVersion);
    const ledger = JSON.stringify(row(f, prepared.runId));
    assert.ok(!ledger.includes("Secret proposed title"));
    assert.ok(!ledger.includes("Private report body"));
    const audit = JSON.stringify(
      f.native.prepare("SELECT * FROM task_activity_log").all(),
    );
    assert.ok(!audit.includes("Private report body"));
    f.reopen();
    const replay = await f.execute(prepared);
    assert.equal(replay.replayed, true);
    assert.equal(replay.run.status, "succeeded");
    assert.equal(f.updateState.confirmations, 1);
    assert.equal(activityCount(f), 1);
    assert.equal(revision(f), 2);
    assert.equal(f.history().runs[0].run.id, result.run.id);
  } finally {
    f.cleanup();
  }
});

test("actual IPC and fixed host source preserve canonical separation and reject raw controlled fields", async () => {
  const f = setup();
  try {
    await withHost(f, async (handlers) => {
      const source = await handlers.get("task:board-edit-source")(f.event, {
        taskId: "task-1",
      });
      assert.equal(source.task.orgId, "org-1");
      const prepared = await handlers.get("task:board-update-preview")(
        f.event,
        {
          taskId: "task-1",
          updates: { description: "Actual IPC" },
          idempotencyKey: randomUUID(),
        },
      );
      const result = await handlers.get("task:board-update-execute")(f.event, {
        request: prepared.request,
      });
      assert.equal(result.run.status, "succeeded", JSON.stringify(result));
      assert.equal(
        (
          await handlers.get("task:board-update-runs")(f.event, {
            taskId: "task-1",
          })
        ).runs.length,
        1,
      );
      assert.equal(
        (
          await handlers.get("task:board-update-cancel")(f.event, {
            taskId: "task-1",
            runId: prepared.runId,
          })
        ).run.status,
        "succeeded",
      );
      for (const updates of [
        { title: "bypass" },
        { description: "bypass" },
        { status: "done" },
        { title: "bypass", priority: "high" },
      ])
        await assert.rejects(
          handlers.get("task:update-task")(f.event, {
            taskId: "task-1",
            updates,
          }),
          { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
        );
      f.native.exec("INSERT INTO project_tasks VALUES ('task-1')");
      assert.equal(f.source().success, false);
      assert.equal(f.preview().error, "ACTION_CONTROLLED_TASK_REQUIRED");
    });
  } finally {
    f.cleanup();
  }
});

for (const choice of [0, "error"])
  test(`native ${choice === 0 ? "cancellation" : "error"} cannot apply and is durably non-replayable`, async () => {
    const f = setup();
    try {
      const prepared = f.preview();
      f.updateState.confirm = () => {
        if (choice === "error") throw new Error("PRIVATE error");
        return { response: choice };
      };
      const result = await f.execute(prepared);
      assert.equal(result.run.status, choice === 0 ? "cancelled" : "denied");
      assert.equal(task(f).title, "Original");
      assert.equal(activityCount(f), 0);
      assert.equal(revision(f), 1);
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
      await f.execute(prepared);
      assert.equal(f.updateState.confirmations, 1);
    } finally {
      f.cleanup();
    }
  });

const changes = {
  actor: (f) => {
    f.state.actor = "did:member";
  },
  generation: (f) => {
    f.state.generation++;
  },
  frame: (f) => {
    f.event.senderFrame = { url: "file:///app/index.html" };
  },
  sender: (f) => {
    f.event.sender = { isDestroyed: () => false };
  },
  window: (f) => {
    f.window.isDestroyed = () => true;
  },
  vault: (f) => {
    f.wrapper.current = { ...f.db };
  },
  path: (f) => {
    f.wrapper.dbPath = "different.sqlite";
  },
  role: (f) =>
    f.native.exec(
      "UPDATE organization_roles SET permissions='[]' WHERE name='owner'",
    ),
  membership: (f) =>
    f.native.exec(
      "UPDATE organization_members SET status='removed' WHERE member_did='did:owner'",
    ),
  source: (f) =>
    f.native.exec(
      "UPDATE team_tasks SET description='Changed outside preview' WHERE id='task-1'",
    ),
  aba: (f) =>
    f.native.exec(
      "UPDATE team_tasks SET title='Intermediate' WHERE id='task-1';UPDATE team_tasks SET title='Original',updated_at=1 WHERE id='task-1'",
    ),
  archived: (f) =>
    f.native.exec("UPDATE task_boards SET is_archived=1 WHERE id='board-1'"),
  scope: (f) =>
    f.native.exec("UPDATE task_boards SET org_id='org-2' WHERE id='board-1'"),
  expiry: (f) => {
    f.updateState.mono += C.LIMITS.previewMs;
  },
  clockRollback: (f) => {
    f.updateState.now -= 1;
  },
};
for (const phase of ["before", "during"])
  for (const [name, change] of Object.entries(changes))
    test(`${name} change ${phase} native confirmation cannot apply an old preview`, async () => {
      const f = setup();
      try {
        const prepared = f.preview();
        assert.equal(prepared.success, true);
        if (phase === "before") change(f);
        else
          f.updateState.confirm = () => {
            change(f);
            return { response: 1 };
          };
        const result = await f.execute(prepared);
        assert.equal(result.success, false, JSON.stringify(result));
        assert.notEqual(row(f, prepared.runId).status, "succeeded");
        assert.notEqual(task(f).title, "Changed by controlled update");
        assert.equal(activityCount(f), 0);
        const count = f.updateState.confirmations;
        await f.execute(prepared);
        assert.equal(f.updateState.confirmations, count);
      } finally {
        f.cleanup();
      }
    });

test("cross-actor/forged requests and nonce conflicts cannot use another preview or approval", async () => {
  const f = setup();
  try {
    const prepared = f.preview();
    const forged = JSON.parse(JSON.stringify(prepared.request));
    forged.input.updates.title = "forged";
    assert.equal(
      (await f.host.executeBoardUpdate(f.event, { request: forged })).error,
      "BOARD_ACTION_INVALID_REQUEST",
    );
    const rebuilt = createBusinessActionRequest({
      actionType: prepared.request.actionType,
      actionVersion: 1,
      target: prepared.request.target,
      expectedVersion: prepared.request.expectedVersion,
      input: { ...prepared.request.input, updates: { title: "forged" } },
      idempotencyKey: prepared.request.idempotencyKey,
    });
    assert.equal(
      (await f.host.executeBoardUpdate(f.event, { request: rebuilt })).error,
      "BOARD_ACTION_IDEMPOTENCY_CONFLICT",
    );
    assert.equal(
      f.preview({ description: "different" }, prepared.request.idempotencyKey)
        .error,
      "BOARD_ACTION_IDEMPOTENCY_CONFLICT",
    );
    f.state.actor = "did:member";
    assert.equal(
      (await f.execute(prepared)).error,
      "BOARD_ACTION_IDEMPOTENCY_CONFLICT",
    );
    assert.equal(f.updateState.confirmations, 0);
  } finally {
    f.cleanup();
  }
});

test("cancel queued/running attempts and ignore a late native approval; only explicit authority may cancel another actor", async () => {
  const f = setup();
  try {
    const queued = f.preview();
    assert.equal(f.cancel(queued).run.status, "cancelled");
    assert.equal((await f.execute(queued)).run.status, "cancelled");
    assert.equal(f.updateState.confirmations, 0);
    let release, reached;
    const ready = new Promise((r) => {
        reached = r;
      }),
      wait = new Promise((r) => {
        release = r;
      });
    f.updateState.confirm = async () => {
      reached();
      await wait;
      return { response: 1 };
    };
    const prepared = f.preview(),
      pending = f.execute(prepared);
    await ready;
    assert.equal((await f.execute(prepared)).executionState, "unresolved");
    assert.equal(f.updateState.confirmations, 1);
    f.native.exec(
      `UPDATE organization_roles SET permissions='["board.task.update"]' WHERE name='member'`,
    );
    f.state.actor = "did:member";
    assert.equal(f.cancel(prepared).success, false);
    f.state.actor = "did:owner";
    assert.equal(f.cancel(prepared).run.status, "cancelled");
    release();
    assert.equal((await pending).run.status, "cancelled");
    assert.equal(task(f).title, "Original");
  } finally {
    f.cleanup();
  }
});

test("single native operation per vault, per-task unresolved fence and explicit recovery of an interrupted run", async () => {
  const f = setup();
  try {
    let release, reached;
    const ready = new Promise((r) => {
        reached = r;
      }),
      wait = new Promise((r) => {
        release = r;
      });
    f.updateState.confirm = async () => {
      reached();
      await wait;
      return { response: 1 };
    };
    const first = f.preview(),
      pending = f.execute(first);
    await ready;
    const other = f.host.previewBoardUpdate(f.event, {
      taskId: "task-2",
      updates: { title: "Other" },
      idempotencyKey: randomUUID(),
    });
    assert.equal(
      (await f.host.executeBoardUpdate(f.event, { request: other.request }))
        .error,
      "BOARD_ACTION_NATIVE_OPERATION_BUSY",
    );
    f.cancel(first);
    release();
    await pending;
    f.updateState.confirm = null;
    assert.equal(
      (await f.host.executeBoardUpdate(f.event, { request: other.request })).run
        .status,
      "succeeded",
    );
    const next = f.preview();
    const stored = C.readRun(row(f, next.runId));
    f.native
      .prepare(
        "UPDATE task_board_update_runs SET status='running',run_json=? WHERE id=?",
      )
      .run(JSON.stringify({ ...stored.run, status: "running" }), next.runId);
    f.reopen();
    assert.equal((await f.execute(next)).executionState, "unresolved");
    const fresh = f.preview();
    assert.equal(
      (await f.execute(fresh)).error,
      "BOARD_ACTION_UNRESOLVED_ACTION",
    );
    assert.equal(f.cancel(next).run.status, "cancelled");
    assert.equal((await f.execute(fresh)).run.status, "succeeded");
  } finally {
    f.cleanup();
  }
});

test("done completion time is preserved for done edits and cleared when reopened", async () => {
  const f = setup();
  try {
    await f.execute(f.preview({ status: "done" }));
    const completed = task(f).completed_at;
    f.updateState.now += 100;
    await f.execute(f.preview({ status: "done", title: "Still done" }));
    assert.equal(task(f).completed_at, completed);
    await f.execute(f.preview({ status: "open" }));
    assert.equal(task(f).completed_at, null);
    assert.equal(revision(f), 4);
  } finally {
    f.cleanup();
  }
});

test("revision triggers cover all legacy SQL, ID changes and deletion/reuse, and missing/modified triggers fail closed", () => {
  const f = setup();
  try {
    const original = C.snapshot(f.db, "task-1").ref.version;
    f.native.exec(
      "UPDATE team_tasks SET priority='high' WHERE id='task-1';UPDATE team_tasks SET priority='medium' WHERE id='task-1'",
    );
    assert.equal(revision(f), 3);
    assert.notEqual(C.snapshot(f.db, "task-1").ref.version, original);
    f.native.exec("UPDATE team_tasks SET id='renamed' WHERE id='task-3'");
    assert.equal(
      f.native
        .prepare(
          "SELECT revision FROM task_board_task_revisions WHERE task_id='task-3'",
        )
        .get().revision,
      2,
    );
    f.native.exec("UPDATE team_tasks SET id='task-3' WHERE id='renamed'");
    assert.equal(
      f.native
        .prepare(
          "SELECT revision FROM task_board_task_revisions WHERE task_id='task-3'",
        )
        .get().revision,
      3,
    );
    const prepared = f.preview();
    f.native.exec(
      "DELETE FROM team_tasks WHERE id='task-1';INSERT INTO team_tasks(id,board_id,column_id,title,reporter_did,created_at,updated_at)VALUES('task-1','board-1','column-1','Original','did:owner',1,1)",
    );
    assert.equal(revision(f), 5);
    assert.notEqual(
      C.snapshot(f.db, "task-1").ref.version,
      prepared.request.expectedVersion,
    );
    f.native.exec("DROP TRIGGER trg_board_task_revision_update");
    assert.equal(f.preview().error, "BOARD_ACTION_REVISION_UNAVAILABLE");
    f.native.exec(
      "CREATE TRIGGER trg_board_task_revision_update AFTER UPDATE ON team_tasks BEGIN SELECT 1;END",
    );
    assert.equal(f.source().error, "BOARD_ACTION_REVISION_UNAVAILABLE");
  } finally {
    f.cleanup();
  }
});

for (const stage of [
  "task",
  "activity",
  "receipt",
  "final-authority",
  "post-task",
  "post-activity",
  "post-receipt",
])
  test(`${stage} failure rolls back task, revision, activity and successful receipt`, async () => {
    const f = setup();
    try {
      const originalTask = task(f);
      const prepared = f.preview({
        title: "Changed by controlled update",
        priority: "high",
        assigneeDid: "did:member",
        dueDate: 0,
        estimatedHours: 1.25,
        actualHours: 0,
      });
      let afterActivity = false;
      if (stage === "post-task")
        f.native.exec(
          "CREATE TRIGGER inject_bad_task AFTER INSERT ON task_activity_log BEGIN UPDATE team_tasks SET title='Tampered' WHERE id=NEW.task_id;END",
        );
      if (stage === "post-activity")
        f.native.exec(
          "CREATE TRIGGER inject_bad_activity AFTER UPDATE ON task_board_update_runs WHEN NEW.status='succeeded' BEGIN UPDATE task_activity_log SET metadata='{}' WHERE task_id=NEW.task_id;END",
        );
      if (stage === "post-receipt")
        f.native.exec(
          "CREATE TRIGGER inject_bad_receipt AFTER UPDATE ON task_board_update_runs WHEN NEW.status='succeeded' BEGIN UPDATE task_board_update_runs SET error_code='PRIVATE' WHERE id=NEW.id;END",
        );
      f.state.beforeRun = (sql) => {
        if (stage === "task" && sql.startsWith("UPDATE team_tasks SET"))
          throw new Error("PRIVATE task error");
        if (sql.startsWith("INSERT INTO task_activity_log")) {
          if (stage === "activity") throw new Error("PRIVATE activity error");
          afterActivity = true;
        }
        if (
          sql.startsWith("UPDATE task_board_update_runs SET") &&
          afterActivity
        ) {
          if (stage === "receipt") throw new Error("PRIVATE receipt error");
          if (stage === "final-authority") f.state.generation++;
        }
      };
      const result = await f.execute(prepared);
      assert.equal(result.success, false, JSON.stringify(result));
      assert.equal(task(f).title, "Original");
      assert.deepEqual(task(f), originalTask);
      assert.equal(revision(f), 1);
      assert.equal(activityCount(f), 0);
      assert.notEqual(row(f, prepared.runId).status, "succeeded");
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    } finally {
      f.cleanup();
    }
  });

test("read/history/cancel reauthorize current source; malformed input, bounds and nondurable databases are refused", async () => {
  const f = setup();
  try {
    for (const updates of [
      { title: "" },
      { title: "x".repeat(1025) },
      { description: null },
      { description: "x".repeat(8193) },
      { status: "todo" },
      { title: "ok", boardId: "board-2" },
      {},
    ])
      assert.equal(f.preview(updates).success, false);
    const prepared = f.preview();
    assert.equal(f.history().runs.length, 1);
    f.state.actor = "did:viewer";
    assert.equal(f.source().editable, false);
    assert.equal(f.history().success, false);
    assert.equal(f.cancel(prepared).success, false);
    f.state.actor = "did:outsider";
    assert.equal(f.source().success, false);
    f.state.actor = "did:owner";
    f.native.exec("PRAGMA synchronous=OFF");
    assert.equal(f.source().error, "BOARD_ACTION_DURABLE_SQLITE_REQUIRED");
    assert.equal(
      (await f.execute(prepared)).error,
      "BOARD_ACTION_DURABLE_SQLITE_REQUIRED",
    );
  } finally {
    f.cleanup();
  }
});

for (const kind of ["fields", "move"])
  for (const stage of [
    "queued",
    "running",
    "before-success-commit",
    "after-success-commit",
  ])
    test(`actual ${kind} kill at ${stage}: reopen preserves atomic task/revision/activity/Run and a new process never replays`, async () => {
      const f = setup();
      try {
        f.native.exec("PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL");
        const file = path.join(f.directory, "vault.sqlite"),
          record = path.join(f.directory, "request.json"),
          worker = path.join(__dirname, "board-update-crash-worker.cjs");
        const killed = spawnSync(
          process.execPath,
          [worker, file, stage, record, kind],
          { encoding: "utf8", timeout: 20000 },
        );
        assert.ok(fs.existsSync(file + ".stage"), killed.stderr);
        assert.notEqual(killed.status, 0);
        f.reopen();
        const prepared = JSON.parse(fs.readFileSync(record, "utf8"));
        const succeeded = stage === "after-success-commit";
        assert.equal(
          f.native.prepare("PRAGMA integrity_check").get().integrity_check,
          "ok",
        );
        assert.equal(
          task(f).title,
          succeeded && kind === "fields" ? "Crash verified title" : "Original",
        );
        assert.equal(revision(f), succeeded ? 2 : 1);
        assert.equal(
          task(f).priority,
          succeeded && kind === "fields" ? "critical" : "medium",
        );
        assert.equal(
          task(f).assignee_did,
          succeeded && kind === "fields" ? "did:member" : null,
        );
        assert.equal(
          task(f).due_date,
          succeeded && kind === "fields" ? 1792281600123 : null,
        );
        assert.equal(
          task(f).estimated_hours,
          succeeded && kind === "fields" ? 1.25 : null,
        );
        assert.equal(
          task(f).actual_hours,
          succeeded && kind === "fields" ? 0 : null,
        );
        assert.equal(
          task(f).column_id,
          succeeded && kind === "move" ? "done-1" : "column-1",
        );
        assert.equal(task(f).position, succeeded && kind === "move" ? 42 : 0);
        assert.equal(activityCount(f) + moveCount(f), succeeded ? 1 : 0);
        assert.equal(
          row(f, prepared.runId).status,
          succeeded ? "succeeded" : stage === "queued" ? "queued" : "running",
        );
        const recovered = spawnSync(
          process.execPath,
          [worker, file, "recover", record],
          { encoding: "utf8", timeout: 20000 },
        );
        assert.equal(recovered.status, 0, recovered.stderr);
        const outcome = JSON.parse(recovered.stdout);
        assert.equal(outcome.confirmations, 0);
        assert.equal(outcome.result.success, stage !== "queued");
        if (stage === "queued")
          assert.equal(outcome.result.error, "BOARD_ACTION_PREVIEW_EXPIRED");
        else assert.equal(outcome.result.replayed, true);
        assert.equal(activityCount(f) + moveCount(f), succeeded ? 1 : 0);
      } finally {
        f.cleanup();
      }
    });

test("existing task revision migration seeds once without resetting later revisions", () => {
  const f = setup();
  try {
    f.native.exec(
      "DROP TRIGGER trg_board_task_revision_insert;DROP TRIGGER trg_board_task_revision_update;DROP TRIGGER trg_board_task_revision_delete;DROP TABLE task_board_task_revisions",
    );
    const ddl = fs.readFileSync(
      path.join(__dirname, "../../database/database-schema.js"),
      "utf8",
    );
    const migration = ddl.slice(
      ddl.indexOf("      -- Durable task revision tombstones"),
      ddl.indexOf("      -- Metadata-only standard ActionRuns"),
    );
    f.native.exec(migration);
    assert.equal(revision(f), 1);
    f.native.exec("UPDATE team_tasks SET priority='high' WHERE id='task-1'");
    assert.equal(revision(f), 2);
    f.native.exec(migration);
    assert.equal(revision(f), 2);
    assert.equal(f.preview().success, true);
  } finally {
    f.cleanup();
  }
});

for (const status of ["cancelled", "denied", "unknown"])
  test(`${status} receipt cannot return unclassified or malformed evidence`, () => {
    const f = setup();
    try {
      const prepared = f.preview(),
        stored = row(f, prepared.runId),
        parsed = C.readRun(stored);
      const extra = {
        id: randomUUID(),
        actorDid: stored.actor_did,
        invocationDigest: stored.invocation_digest,
        rawBody: "PRIVATE unclassified content",
      };
      const corruptRun = {
        ...parsed.run,
        status,
        completedAt: new Date(stored.created_at).toISOString(),
        evidenceRefs: [...parsed.run.evidenceRefs, C.reference(extra)],
      };
      f.native
        .prepare(
          "UPDATE task_board_update_runs SET status=?,run_json=?,evidence_json=? WHERE id=?",
        )
        .run(
          status,
          JSON.stringify(corruptRun),
          JSON.stringify([...parsed.evidence, extra]),
          stored.id,
        );
      const result = f.history();
      assert.equal(result.success, false);
      assert.equal(result.error, "BOARD_ACTION_RECEIPT_CORRUPT");
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    } finally {
      f.cleanup();
    }
  });

for (const temporary of [false, true])
  for (const table of [
    "task_board_update_runs",
    "task_board_task_revisions",
    "task_activity_log",
    "team_tasks",
    "task_boards",
    "task_board_columns",
    "task_board_structure_revisions",
  ])
    test(`unexpected ${temporary ? "TEMP " : ""}${table} triggers cannot introduce hidden writes during approval, cancellation or recovery`, async () => {
      const f = setup();
      try {
        const prepared = f.preview();
        f.native.exec(
          `CREATE ${temporary ? "TEMP " : ""}TRIGGER malicious_metadata AFTER UPDATE ON ${table} BEGIN UPDATE team_tasks SET title='Hidden write' WHERE id='task-2';END`,
        );
        assert.equal(
          (await f.execute(prepared)).error,
          "BOARD_ACTION_UNEXPECTED_TRIGGER",
        );
        assert.equal(
          f.cancel(prepared).error,
          "BOARD_ACTION_UNEXPECTED_TRIGGER",
        );
        assert.equal(
          f.native
            .prepare("SELECT title FROM team_tasks WHERE id='task-2'")
            .get().title,
          "Second",
        );
        assert.equal(task(f).title, "Original");
        assert.equal(row(f, prepared.runId).status, "queued");
      } finally {
        f.cleanup();
      }
    });

test("board metadata is byte-bounded before being fetched or shown", () => {
  const f = setup();
  try {
    f.native
      .prepare("UPDATE task_boards SET owner_did=? WHERE id='board-1'")
      .run("did:" + "x".repeat(4096));
    assert.equal(f.source().error, "BOARD_ACTION_SOURCE_LIMIT");
    assert.equal(f.preview().error, "BOARD_ACTION_SOURCE_LIMIT");
    assert.equal(f.updateState.confirmations, 0);
  } finally {
    f.cleanup();
  }
});

test("unresolved attempts remain explicitly recoverable beyond the latest history page and cursor paging is scope-bound", () => {
  const f = setup();
  try {
    const first = f.preview(),
      stored = row(f, first.runId),
      parsed = C.readRun(stored);
    f.native
      .prepare(
        "UPDATE task_board_update_runs SET status='running',run_json=? WHERE id=?",
      )
      .run(JSON.stringify({ ...parsed.run, status: "running" }), first.runId);
    for (let i = 0; i < 21; i++) f.preview({ description: "queued " + i });
    const history = f.history();
    assert.equal(history.runs.length, 20);
    assert.ok(!history.runs.some((item) => item.run.id === first.runId));
    assert.equal(history.unresolvedRun.run.id, first.runId);
    const older = f.host.getBoardUpdateRuns(f.event, {
      taskId: "task-1",
      beforeId: history.nextCursor,
      limit: 20,
    });
    assert.ok(older.runs.some((item) => item.run.id === first.runId));
    assert.equal(f.cancel(first).run.status, "cancelled");
    assert.equal(f.history().unresolvedRun, null);
    assert.equal(
      f.host.getBoardUpdateRuns(f.event, {
        taskId: "task-2",
        beforeId: first.runId,
      }).error,
      "BOARD_ACTION_INVALID_CURSOR",
    );
  } finally {
    f.cleanup();
  }
});

test("per-task and per-vault hard quotas count all records, including queued or corrupt metadata, without pruning unknown outcomes", () => {
  const f = setup();
  try {
    const first = f.preview(),
      base = row(f, first.runId);
    f.native
      .exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<99)
      INSERT INTO task_board_update_runs SELECT 'quota-'||x,'preview-'||x,task_id,board_id,org_id,actor_did,auth_generation,'nonce-'||x,invocation_digest,'queued',expected_version,expires_at,created_at,run_json,evidence_json,NULL FROM task_board_update_runs,n WHERE id='${base.id}'`);
    assert.equal(f.preview().error, "BOARD_ACTION_RUN_LIMIT");
    f.native
      .exec(`UPDATE task_board_update_runs SET task_id='other-task' WHERE id<>'${base.id}';
      WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<3996)
      INSERT INTO task_board_update_runs SELECT 'vault-'||x,'vault-preview-'||x,'other-task',board_id,org_id,actor_did,auth_generation,'vault-nonce-'||x,invocation_digest,'queued',expected_version,expires_at,created_at,run_json,evidence_json,NULL FROM task_board_update_runs,n WHERE id='${base.id}'`);
    assert.equal(
      f.native.prepare("SELECT COUNT(*) AS n FROM task_board_update_runs").get()
        .n,
      4096,
    );
    assert.equal(f.preview().error, "BOARD_ACTION_RUN_LIMIT");
    assert.equal(f.updateState.confirmations, 0);
  } finally {
    f.cleanup();
  }
});
