"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { spawnSync } = require("node:child_process");
const {
  fixture,
  withHost,
  inputFor,
} = require("./board-authority-fixture.cjs");
const { createBoardTaskUpdateHost } = require("../board-task-update-host");
const C = require("../board-task-update-contract");
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-board-create-")),
    f = fixture(path.join(directory, "vault.sqlite")),
    state = { now: Date.now(), mono: 0, confirmations: 0, confirm: null };
  const window = { isDestroyed: () => false };
  f.event.sender = { isDestroyed: () => false };
  f.electron = {
    BrowserWindow: { fromWebContents: () => window },
    dialog: {
      showMessageBox: async (parent, options) => {
        assert.equal(parent, window);
        assert.equal(options.defaultId, 0);
        assert.equal(options.cancelId, 0);
        assert.deepEqual(options.buttons, ["取消", "确认创建"]);
        state.confirmations++;
        return state.confirm ? state.confirm(options) : { response: 1 };
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
    createState: state,
    window,
    host,
    source: (parentTaskId) =>
      host.getBoardCreateSource(f.event, {
        boardId: "board-1",
        ...(parentTaskId ? { parentTaskId } : {}),
      }),
    preview: (
      taskData = { columnId: "column-1", title: "Private creation title" },
      idempotencyKey = randomUUID(),
    ) =>
      host.previewBoardCreate(f.event, {
        boardId: "board-1",
        taskData,
        idempotencyKey,
      }),
    execute: (prepared) =>
      host.executeBoardCreate(f.event, { request: prepared.request }),
    history: (extra) =>
      host.getBoardCreateRuns(f.event, { boardId: "board-1", ...extra }),
    cancel: (prepared) =>
      host.cancelBoardCreate(f.event, {
        boardId: "board-1",
        runId: prepared.runId,
      }),
    cleanup() {
      f.close();
      for (const file of fs.readdirSync(directory))
        fs.unlinkSync(path.join(directory, file));
      fs.rmdirSync(directory);
    },
  });
}
const task = (f, id) =>
  f.native.prepare("SELECT * FROM team_tasks WHERE id=?").get(id);
const row = (f, id) =>
  f.native.prepare("SELECT * FROM task_board_update_runs WHERE id=?").get(id);
const count = (f) =>
  f.native.prepare("SELECT COUNT(*) AS n FROM team_tasks").get().n;
const activityCount = (f) =>
  f.native
    .prepare(
      "SELECT COUNT(*) AS n FROM task_activity_log WHERE action='controlled_task_create'",
    )
    .get().n;

test("create histories keep unresolved attempts beyond pagination and count every creation against the board quota", () => {
  const f = setup();
  try {
    const first = f.preview(),
      stored = row(f, first.runId),
      parsed = C.readRun(stored);
    C.saveRun(
      f.db,
      stored,
      { ...parsed.run, status: "running" },
      parsed.evidence,
    );
    for (let i = 1; i < 100; i++)
      assert.equal(
        f.preview({ columnId: "column-1", title: `Preview ${i}` }).success,
        true,
      );
    const page = f.history();
    assert.equal(page.runs.length, 20);
    assert.equal(page.unresolvedRun.run.id, first.runId);
    assert.ok(page.nextCursor);
    const next = f.history({ beforeId: page.nextCursor });
    assert.equal(next.runs.length, 20);
    assert.ok(!next.runs.some((row) => row.run.id === page.runs[0].run.id));
    assert.equal(next.unresolvedRun.run.id, first.runId);
    assert.equal(f.preview().error, "BOARD_ACTION_RUN_LIMIT");
    assert.equal(f.cancel(first).run.status, "cancelled");
    assert.equal(f.preview().error, "BOARD_ACTION_RUN_LIMIT");
    assert.equal(count(f), 3);
  } finally {
    f.cleanup();
  }
});

test("malformed create receipts fail closed without returning bodies and nondurable storage is refused", () => {
  const f = setup();
  try {
    const prepared = f.preview(),
      stored = row(f, prepared.runId),
      parsed = C.readRun(stored),
      extra = {
        id: randomUUID(),
        kind: "PRIVATE BODY",
        actorDid: stored.actor_did,
        invocationDigest: stored.invocation_digest,
      };
    const changed = {
      ...parsed.run,
      evidenceRefs: [...parsed.run.evidenceRefs, C.reference(extra)],
    };
    f.native
      .prepare(
        "UPDATE task_board_update_runs SET run_json=?,evidence_json=? WHERE id=?",
      )
      .run(
        JSON.stringify(changed),
        JSON.stringify([...parsed.evidence, extra]),
        stored.id,
      );
    const result = f.history();
    assert.equal(result.error, "BOARD_ACTION_RECEIPT_CORRUPT");
    assert.ok(!JSON.stringify(result).includes("PRIVATE BODY"));
    f.native.exec("PRAGMA synchronous=OFF");
    assert.equal(f.preview().error, "BOARD_ACTION_DURABLE_SQLITE_REQUIRED");
    assert.equal(f.source().error, "BOARD_ACTION_DURABLE_SQLITE_REQUIRED");
  } finally {
    f.cleanup();
  }
});

test("new create capabilities never trust renderer identities, removed members, false owners or untrusted frames", async () => {
  const f = setup();
  try {
    const prepared = f.preview();
    for (const actor of [
      null,
      "did:former",
      "did:outsider",
      "did:viewer",
      "did:impostor",
      "did:owner",
    ]) {
      f.state.actor = actor;
      f.state.trusted = actor !== "did:owner";
      assert.equal(f.preview().success, false);
      assert.equal((await f.execute(prepared)).success, false);
      assert.equal(f.history().success, false);
      assert.equal(f.cancel(prepared).success, false);
      const source = f.source();
      if (actor === "did:viewer" || actor === "did:impostor")
        assert.equal(source.creatable, false);
      else assert.equal(source.success, false);
    }
    assert.equal(count(f), 3);
    assert.equal(activityCount(f), 0);
    assert.equal(f.createState.confirmations, 0);
  } finally {
    f.cleanup();
  }
});

test("creation reserves a host ID, confirms authoritative fields, commits exact task/revision/activity/Run and replays after reopen without duplicate", async () => {
  const f = setup();
  try {
    assert.equal(f.source().creatable, true);
    assert.equal(f.source().optionalFields.assigneeDid, true);
    const prepared = f.preview({
      columnId: "done-1",
      title: "Private creation title",
      description: "Private description",
      priority: "critical",
      assigneeDid: "did:member",
      dueDate: 0,
      estimatedHours: 0,
      actualHours: 1.25,
    });
    assert.equal(prepared.success, true, JSON.stringify(prepared));
    assert.match(prepared.taskId, /^[a-f0-9-]{36}$/);
    assert.equal(prepared.before, null);
    assert.equal(prepared.request.actionType, C.CREATE_ACTION_TYPE);
    assert.equal(task(f, prepared.taskId), undefined);
    assert.equal(row(f, prepared.runId).status, "queued");
    assert.equal(prepared.after.status, "open");
    f.createState.confirm = (options) => {
      assert.equal(row(f, prepared.runId).status, "running");
      assert.ok(options.detail.includes("Private creation title"));
      assert.ok(options.detail.includes("Done"));
      assert.ok(options.detail.includes("UTC Unix 毫秒"));
      return { response: 1 };
    };
    const result = await f.execute(prepared);
    assert.equal(result.run?.status, "succeeded", JSON.stringify(result));
    const created = task(f, prepared.taskId);
    assert.equal(created.reporter_did, "did:owner");
    assert.equal(created.column_id, "done-1");
    assert.equal(created.due_date, 0);
    assert.equal(created.estimated_hours, 0);
    assert.equal(created.actual_hours, 1.25);
    assert.equal(created.status, "open");
    assert.equal(created.completed_at, null);
    assert.equal(created.task_type, "task");
    assert.equal(result.evidence[0].revision, 0);
    assert.equal(result.evidence[2].revisionAfter, 1);
    assert.equal(activityCount(f), 1);
    const serialized = JSON.stringify(
      f.native.prepare("SELECT * FROM task_board_update_runs").all(),
    );
    assert.ok(!serialized.includes("Private creation title"));
    assert.ok(!serialized.includes("Private description"));
    assert.ok(!serialized.includes(prepared.request.idempotencyKey));
    f.reopen();
    assert.equal((await f.execute(prepared)).run.status, "succeeded");
    assert.equal(count(f), 4);
    assert.equal(f.createState.confirmations, 1);
    assert.equal(f.history().runs[0].run.id, result.run.id);
  } finally {
    f.cleanup();
  }
});

test("subtask creation binds an existing same-board parent and requires additional subtask and assignment authority", async () => {
  const f = setup();
  try {
    f.state.actor = "did:member";
    const perms = (values) =>
      f.native
        .prepare(
          "UPDATE organization_roles SET permissions=? WHERE name='member'",
        )
        .run(JSON.stringify(values));
    perms(["board.task.create"]);
    assert.equal(f.source().creatable, true);
    assert.equal(f.source("task-1").creatable, false);
    assert.equal(f.source().optionalFields.assigneeDid, false);
    assert.equal(
      f.preview({
        columnId: "column-1",
        title: "Child",
        parentTaskId: "task-1",
      }).success,
      false,
    );
    assert.equal(
      f.preview({
        columnId: "column-1",
        title: "Assigned",
        assigneeDid: "did:member",
      }).success,
      false,
    );
    perms(["board.task.create", "board.task.subtask", "board.task.assign"]);
    const prepared = f.preview({
      columnId: "column-1",
      title: "Child",
      parentTaskId: "task-1",
      assigneeDid: "did:member",
    });
    assert.equal((await f.execute(prepared)).run.status, "succeeded");
    assert.equal(task(f, prepared.taskId).task_type, "subtask");
    assert.equal(task(f, prepared.taskId).parent_task_id, "task-1");
    assert.equal(task(f, prepared.taskId).reporter_did, "did:member");
  } finally {
    f.cleanup();
  }
});

for (const [name, data] of [
  ["missing title", { columnId: "column-1" }],
  ["blank title", { columnId: "column-1", title: " " }],
  ["overlong title", { columnId: "column-1", title: "x".repeat(1025) }],
  [
    "unknown fields",
    { columnId: "column-1", title: "T", reporterDid: "did:forged" },
  ],
  ["initial status", { columnId: "column-1", title: "T", status: "done" }],
  ["foreign column", { columnId: "column-2", title: "T" }],
  [
    "foreign parent",
    { columnId: "column-1", title: "T", parentTaskId: "task-2" },
  ],
  [
    "removed assignee",
    { columnId: "column-1", title: "T", assigneeDid: "did:former" },
  ],
  ["negative position", { columnId: "column-1", title: "T", position: -1 }],
  ["legacy urgent", { columnId: "column-1", title: "T", priority: "urgent" }],
  ["date text", { columnId: "column-1", title: "T", dueDate: "2026-10-20" }],
  ["hours text", { columnId: "column-1", title: "T", estimatedHours: "1" }],
  [
    "oversize description",
    { columnId: "column-1", title: "T", description: "x".repeat(8193) },
  ],
])
  test(`${name} cannot reserve or create a task`, () => {
    const f = setup();
    try {
      assert.equal(f.preview(data).success, false);
      assert.equal(count(f), 3);
      assert.equal(f.history().runs.length, 0);
      assert.equal(f.createState.confirmations, 0);
    } finally {
      f.cleanup();
    }
  });

for (const [name, change] of [
  [
    "actor",
    (f) => {
      f.state.actor = "did:member";
    },
  ],
  [
    "generation ABA",
    (f) => {
      f.state.generation += 2;
    },
  ],
  [
    "parent update",
    (f) =>
      f.native.exec(
        "UPDATE team_tasks SET title='New parent' WHERE id='task-1'",
      ),
  ],
  [
    "parent delete/reuse",
    (f) =>
      f.native.exec(
        "DELETE FROM team_tasks WHERE id='task-1';INSERT INTO team_tasks(id,board_id,column_id,title,reporter_did,created_at,updated_at)VALUES('task-1','board-1','column-1','Original','did:owner',1,1)",
      ),
  ],
  [
    "column ABA",
    (f) =>
      f.native.exec(
        "UPDATE task_board_columns SET name='Changed' WHERE id='column-1';UPDATE task_board_columns SET name='Todo',updated_at=1 WHERE id='column-1'",
      ),
  ],
  [
    "board archived",
    (f) =>
      f.native.exec("UPDATE task_boards SET is_archived=1 WHERE id='board-1'"),
  ],
  [
    "assignee removed",
    (f) =>
      f.native.exec(
        "UPDATE organization_members SET status='removed' WHERE member_did='did:member'",
      ),
  ],
  [
    "create role revoked",
    (f) =>
      f.native.exec(
        "UPDATE organization_roles SET permissions='[]' WHERE name='owner'",
      ),
  ],
  [
    "frame replaced",
    (f) => {
      f.event.senderFrame = { ...f.event.senderFrame };
    },
  ],
  [
    "vault replaced",
    (f) => {
      f.wrapper.current = {};
    },
  ],
  [
    "expired",
    (f) => {
      f.createState.mono = 300000;
    },
  ],
])
  for (const phase of ["before", "during"])
    test(`${name} ${phase} native confirmation cannot commit an old creation`, async () => {
      const f = setup();
      try {
        const prepared = f.preview({
          columnId: "column-1",
          title: "Child",
          parentTaskId: "task-1",
          assigneeDid: "did:member",
        });
        if (phase === "before") change(f);
        else
          f.createState.confirm = () => {
            change(f);
            return { response: 1 };
          };
        assert.equal((await f.execute(prepared)).success, false);
        assert.equal(task(f, prepared.taskId), undefined);
        assert.equal(activityCount(f), 0);
        assert.notEqual(row(f, prepared.runId).status, "succeeded");
      } finally {
        f.cleanup();
      }
    });

for (const choice of [0, "error"])
  test(`native ${choice === 0 ? "cancel" : "error"} is durable and never recreates or reopens dialog`, async () => {
    const f = setup();
    try {
      const prepared = f.preview();
      f.createState.confirm = () => {
        if (choice === "error") throw new Error("PRIVATE native error");
        return { response: choice };
      };
      const result = await f.execute(prepared);
      assert.equal(result.run.status, choice === 0 ? "cancelled" : "denied");
      assert.equal((await f.execute(prepared)).replayed, true);
      assert.equal(count(f), 3);
      assert.equal(f.createState.confirmations, 1);
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    } finally {
      f.cleanup();
    }
  });

test("same nonce and forged request cannot change a reserved task or adopt another actor's attempt", async () => {
  const f = setup();
  try {
    const key = randomUUID(),
      prepared = f.preview(undefined, key);
    assert.equal(
      f.preview(undefined, key).error,
      "BOARD_ACTION_IDEMPOTENCY_RECORDED",
    );
    const forged = JSON.parse(JSON.stringify(prepared.request));
    forged.input.taskData.title = "Forged";
    assert.equal((await f.execute({ request: forged })).success, false);
    f.state.actor = "did:member";
    assert.equal(
      (await f.execute(prepared)).error,
      "BOARD_ACTION_IDEMPOTENCY_CONFLICT",
    );
    assert.equal(task(f, prepared.taskId), undefined);
    assert.equal(f.createState.confirmations, 0);
  } finally {
    f.cleanup();
  }
});

test("queued previews do not lock, unresolved creation fences the whole board, and explicit cancellation prevents late write", async () => {
  const f = setup();
  try {
    const first = f.preview(),
      second = f.preview();
    let resolve;
    f.createState.confirm = () =>
      new Promise((yes) => {
        resolve = yes;
      });
    const pending = f.execute(first);
    assert.equal(
      (await f.execute(second)).error,
      "BOARD_ACTION_NATIVE_OPERATION_BUSY",
    );
    assert.equal(f.history().unresolvedRun.run.id, first.runId);
    assert.equal(f.cancel(first).run.status, "cancelled");
    resolve({ response: 1 });
    assert.equal((await pending).run.status, "cancelled");
    assert.equal(task(f, first.taskId), undefined);
    f.createState.confirm = null;
    const unresolved = row(f, second.runId);
    C.saveRun(
      f.wrapper.getDatabase(),
      unresolved,
      { ...C.readRun(unresolved).run, status: "running" },
      C.readRun(unresolved).evidence,
    );
    const third = f.preview();
    assert.equal(
      (await f.execute(third)).error,
      "BOARD_ACTION_UNRESOLVED_ACTION",
    );
    assert.equal(f.cancel(second).run.status, "cancelled");
    assert.equal((await f.execute(third)).run.status, "succeeded");
    assert.equal(count(f), 4);
  } finally {
    f.cleanup();
  }
});

test("creation cancellation requires current create authority and extra permission for another actor; history is board-bound", () => {
  const f = setup();
  try {
    const prepared = f.preview();
    f.state.actor = "did:member";
    f.native.exec(
      "UPDATE organization_roles SET permissions='[\"board.task.create\"]' WHERE name='member'",
    );
    assert.equal(f.cancel(prepared).success, false);
    assert.equal(f.history().runs.length, 1);
    f.native.exec(
      "UPDATE organization_roles SET permissions='[\"board.task.create\",\"board.task.action.cancel\"]' WHERE name='member'",
    );
    assert.equal(f.cancel(prepared).run.status, "cancelled");
    f.state.actor = "did:viewer";
    assert.equal(f.history().success, false);
    assert.equal(f.source().creatable, false);
    f.state.actor = "did:owner";
    assert.equal(
      f.host.getBoardCreateRuns(f.event, {
        boardId: "board-2",
        beforeId: prepared.runId,
      }).error,
      "BOARD_ACTION_INVALID_CURSOR",
    );
  } finally {
    f.cleanup();
  }
});

for (const stage of [
  "insert",
  "activity",
  "receipt",
  "post-authority",
  "post-task",
])
  test(`${stage} failure atomically rolls back new task, revision, activity and success receipt`, async () => {
    const f = setup();
    try {
      const prepared = f.preview();
      let activity = false;
      f.state.beforeRun = (sql) => {
        if (stage === "insert" && sql.startsWith("INSERT INTO team_tasks"))
          throw new Error("PRIVATE insert");
        if (sql.startsWith("INSERT INTO task_activity_log")) {
          activity = true;
          if (stage === "activity") throw new Error("PRIVATE activity");
          if (stage === "post-task")
            f.native
              .prepare("UPDATE team_tasks SET title='Hidden change' WHERE id=?")
              .run(prepared.taskId);
        }
        if (activity && sql.startsWith("UPDATE task_board_update_runs SET")) {
          if (stage === "receipt") throw new Error("PRIVATE receipt");
          if (stage === "post-authority") f.state.generation++;
        }
      };
      const result = await f.execute(prepared);
      assert.equal(result.success, false);
      assert.equal(task(f, prepared.taskId), undefined);
      assert.equal(
        f.native
          .prepare("SELECT 1 FROM task_board_task_revisions WHERE task_id=?")
          .get(prepared.taskId),
        undefined,
      );
      assert.equal(activityCount(f), 0);
      assert.notEqual(row(f, prepared.runId).status, "succeeded");
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    } finally {
      f.cleanup();
    }
  });

test("actual create IPCs register scoped source/preview/execute/history/cancel and reject old raw creation and manager paths", async () => {
  const f = setup();
  try {
    await withHost(f, async (handlers) => {
      assert.equal(
        (
          await handlers.get("task:board-create-source")(f.event, {
            boardId: "board-1",
          })
        ).success,
        true,
      );
      const prepared = await handlers.get("task:board-create-preview")(
        f.event,
        {
          boardId: "board-1",
          taskData: { columnId: "column-1", title: "IPC creation" },
          idempotencyKey: randomUUID(),
        },
      );
      assert.equal(
        (
          await handlers.get("task:board-create-execute")(f.event, {
            request: prepared.request,
          })
        ).run.status,
        "succeeded",
      );
      assert.equal(
        (
          await handlers.get("task:board-create-runs")(f.event, {
            boardId: "board-1",
          })
        ).runs.length,
        1,
      );
      assert.equal(
        (
          await handlers.get("task:board-create-cancel")(f.event, {
            boardId: "board-1",
            runId: prepared.runId,
          })
        ).run.status,
        "succeeded",
      );
      for (const action of ["create-task", "create-subtask"])
        await assert.rejects(
          handlers.get(`task:${action}`)(f.event, inputFor(action)),
          { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
        );
      const manager = new (require("../team-task-manager").TeamTaskManager)(
        f.wrapper,
      );
      assert.throws(() => manager.createTaskSync({}), {
        code: "BOARD_ACTION_CONTROLLED_CREATE_REQUIRED",
      });
      assert.throws(() => manager.createSubtaskSync("task-1", {}), {
        code: "BOARD_ACTION_CONTROLLED_CREATE_REQUIRED",
      });
    });
  } finally {
    f.cleanup();
  }
});

for (const stage of [
  "queued",
  "running",
  "before-success-commit",
  "after-success-commit",
])
  test(`actual creation SIGKILL ${stage}: reserved request recovers in a separate process without duplicate task or dialog`, () => {
    const f = setup();
    try {
      f.native.exec("PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL");
      const file = path.join(f.directory, "vault.sqlite"),
        record = path.join(f.directory, "request.json"),
        worker = path.join(__dirname, "board-create-crash-worker.cjs");
      const killed = spawnSync(
        process.execPath,
        [worker, file, stage, record],
        { encoding: "utf8", timeout: 20000 },
      );
      assert.ok(fs.existsSync(file + ".stage"), killed.stderr);
      assert.notEqual(killed.status, 0);
      f.reopen();
      const prepared = JSON.parse(fs.readFileSync(record, "utf8")),
        succeeded = stage === "after-success-commit";
      assert.equal(
        f.native.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
      assert.equal(count(f), succeeded ? 4 : 3);
      assert.equal(!!task(f, prepared.taskId), succeeded);
      assert.equal(activityCount(f), succeeded ? 1 : 0);
      assert.equal(
        !!f.native
          .prepare("SELECT 1 FROM task_board_task_revisions WHERE task_id=?")
          .get(prepared.taskId),
        succeeded,
      );
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
      const result = JSON.parse(recovered.stdout);
      assert.equal(result.confirmations, 0);
      assert.equal(result.result.success, stage !== "queued");
      assert.equal(count(f), succeeded ? 4 : 3);
      if (stage === "queued")
        assert.equal(result.result.error, "BOARD_ACTION_PREVIEW_EXPIRED");
    } finally {
      f.cleanup();
    }
  });
