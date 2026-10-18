"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { ACTIONS, UNSUPPORTED } = require("../board-write-authority");

const {
  fixture,
  withHost,
  inputFor,
  snapshot,
  notificationHost,
} = require("./board-authority-fixture.cjs");

test("all 36 write IPC channels reject unauthenticated, removed, outsider, viewer, false owner and untrusted callers without writes", async () => {
  const f = fixture();
  try {
    await withHost(f, async (handlers) => {
      const before = snapshot(f);
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
        for (const action of [
          ...Object.keys(ACTIONS),
          ...Object.keys(UNSUPPORTED),
        ]) {
          if (action === "generate-ai-summary") {
            assert.deepEqual(
              await handlers.get(`task:${action}`)(f.event, inputFor(action)),
              {
                success: false,
                error: "BOARD_WRITE_NOT_FOUND_OR_DENIED",
                run: undefined,
              },
            );
            continue;
          }
          await assert.rejects(
            handlers.get(`task:${action}`)(f.event, {
              ...inputFor(action),
              actorDid: "did:owner",
            }),
            /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
            action,
          );
        }
      }
      assert.deepEqual(snapshot(f), before);
    });
  } finally {
    f.close();
  }
});

for (const action of Object.keys(ACTIONS)) {
  // Attachment positive journeys require a real persistent DB and native picker.
  // Their dedicated suite exercises both IPCs; this fixture stays in memory.
  if (
    ["upload-attachment", "delete-attachment", "generate-ai-summary"].includes(
      action,
    )
  )
    continue;
  test(`authorized IPC ${action} ${["update-task", "assign-task", "set-priority", "set-due-date", "move-task", "create-task", "create-subtask"].includes(action) ? "requires controlled editing before mutation" : "executes its synchronous production core"}`, async () => {
    const f = fixture();
    try {
      // The seeded board-2 has a task; successful deletion needs an empty board.
      if (action === "delete-board")
        f.native.exec("DELETE FROM team_tasks WHERE id='task-2'");
      if (["link-tasks", "convert-to-subtask"].includes(action))
        f.native.exec(
          "INSERT INTO team_tasks (id,board_id,column_id,title,reporter_did,created_at,updated_at) VALUES ('task-peer','board-1','column-1','Peer','did:owner',1,1)",
        );
      await withHost(f, async (handlers) => {
        const before = snapshot(f);
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
        ) {
          await assert.rejects(
            handlers.get(`task:${action}`)(f.event, inputFor(action)),
            { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
          );
          assert.deepEqual(snapshot(f), before);
          return;
        }
        const result = await handlers.get(`task:${action}`)(
          f.event,
          inputFor(action),
        );
        assert.equal(result.success, true, action);
        assert.notDeepEqual(snapshot(f), before, action);
        assert.equal(f.native.isTransaction, false);
        if (action === "create-board") {
          assert.equal(result.board.ownerDid, "did:owner");
          assert.equal(result.board.columns.length, 3);
        }
        if (action === "create-task")
          assert.equal(
            f.native
              .prepare("SELECT reporter_did FROM team_tasks WHERE id=?")
              .get(result.taskId).reporter_did,
            "did:owner",
          );
        if (action === "assign-task")
          assert.equal(
            f.native
              .prepare("SELECT assigned_by FROM task_assignees WHERE id=?")
              .get(result.assigneeId).assigned_by,
            "did:owner",
          );
        if (action === "add-comment")
          assert.deepEqual(
            {
              ...f.native
                .prepare(
                  "SELECT author_did, author_name FROM task_comments WHERE id=?",
                )
                .get(result.commentId),
            },
            { author_did: "did:owner", author_name: "Owner" },
          );
        if (action === "create-report")
          assert.deepEqual(
            {
              ...f.native
                .prepare(
                  "SELECT author_did, author_name FROM team_reports WHERE id=?",
                )
                .get(result.reportId),
            },
            { author_did: "did:owner", author_name: "Owner" },
          );
      });
    } finally {
      f.close();
    }
  });
}

test("unsupported IPCs reject before any legacy manager or placeholder side effect", async () => {
  const f = fixture();
  try {
    await withHost(f, async (handlers) => {
      const before = snapshot(f);
      for (const action of Object.keys(UNSUPPORTED))
        await assert.rejects(
          handlers.get(`task:${action}`)(f.event, inputFor(action)),
          { code: "BOARD_WRITE_UNSUPPORTED" },
        );
      assert.deepEqual(snapshot(f), before);
    });
  } finally {
    f.close();
  }
});

test("current explicit role permissions distinguish collaboration and management without actor fallback", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      f.state.actor = "did:member";
      require("../board-write-authority")
        .authorizeBoardWrite(
          f.wrapper,
          f.event,
          "set-priority",
          inputFor("set-priority"),
          f.dependencies,
        )
        .checkTarget();
      assert.throws(() => f.write("set-priority", inputFor("set-priority")), {
        code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
      });
      assert.throws(
        () => f.write("archive-board", inputFor("archive-board")),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.task.set-priority"]' WHERE name='member'`,
      );
      assert.throws(
        () => f.write("assign-task", inputFor("assign-task")),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
      for (const permissions of [
        '["project.write"]',
        "[]",
        '"*"',
        "{}",
        "null",
        "broken",
        '["*",42]',
      ]) {
        f.native
          .prepare(
            "UPDATE organization_roles SET permissions=? WHERE name='member'",
          )
          .run(permissions);
        assert.throws(
          () => f.write("set-priority", inputFor("set-priority")),
          /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
          permissions,
        );
      }
      f.native.exec("DELETE FROM organization_roles WHERE name='member'");
      assert.throws(
        () => f.write("set-priority", inputFor("set-priority")),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
    });
  } finally {
    f.close();
  }
});

test("foreign board, organization, parent, labels, members and mixed batches cause zero writes", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      const cases = [
        ["move-task", { columnId: "column-2" }],
        ["create-task", { parentTaskId: "task-2" }],
        ["create-task", { sprintId: "sprint-2" }],
        ["create-task", { labels: ["label-2"] }],
        ["create-task", { assigneeDid: "did:other" }],
        ["create-task", { assigneeDid: "did:former" }],
        ["update-task", { updates: { assigneeDid: "did:other" } }],
        ["update-task", { updates: { boardId: "board-2" } }],
        ["assign-task", { userDid: "did:former" }],
        ["add-checklist-item", { assigneeDid: "did:other" }],
        ["add-comment", { comment: { content: "Bad", parentId: "comment-2" } }],
        [
          "add-comment",
          { comment: { content: "Bad", mentions: ["did:former"] } },
        ],
        ["reorder-columns", { columnOrder: ["done-1", "column-2"] }],
        ["reorder-columns", { columnOrder: ["done-1", "done-1"] }],
        ["move-to-sprint", { taskIds: ["task-1", "task-2"] }],
        ["move-to-sprint", { taskIds: ["task-1", "missing"] }],
        ["create-report", { boardId: "board-3" }],
        ["set-priority", { orgId: "org-2" }],
      ];
      const before = snapshot(f);
      for (const [action, override] of cases) {
        assert.throws(
          () => f.write(action, { ...inputFor(action), ...override }),
          /BOARD_WRITE_|BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED/,
        );
        assert.deepEqual(snapshot(f), before, action);
      }
    });
  } finally {
    f.close();
  }
});

test("generic task updates and initial assignment require each specific permission", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      f.state.actor = "did:member";
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.task.update","board.task.create"]' WHERE name='member'`,
      );
      for (const patch of [
        { assigneeDid: "did:member" },
        { assigneeDid: null },
        { priority: "high" },
        { dueDate: null },
      ]) {
        assert.throws(
          () => f.write("update-task", { taskId: "task-1", updates: patch }),
          /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
        );
      }
      for (const patch of [
        { assigneeDid: "did:member" },
        { sprintId: "sprint-1" },
      ]) {
        assert.throws(
          () =>
            f.write("create-task", { ...inputFor("create-task"), ...patch }),
          /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
        );
      }
      assert.throws(
        () =>
          f.write("update-task", {
            taskId: "task-1",
            updates: { title: "Allowed" },
          }),
        { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
      );
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.task.update","board.task.assign","board.task.set-priority","board.task.set-due-date"]' WHERE name='member'`,
      );
      assert.throws(
        () =>
          f.write("update-task", {
            taskId: "task-1",
            updates: { assigneeDid: null, priority: "high", dueDate: null },
          }),
        { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
      );
    });
  } finally {
    f.close();
  }
});

test("multi-statement SQL failure rolls back board creation, assignment, sprint completion and batches", () => {
  for (const [action, pattern, setup] of [
    ["create-board", /INSERT INTO task_board_columns/, ""],
    ["add-label", /INSERT INTO task_activity_log/, ""],
    [
      "complete-sprint",
      /UPDATE team_tasks/,
      "UPDATE team_tasks SET sprint_id='sprint-1' WHERE id='task-1'",
    ],
    ["reorder-columns", /UPDATE task_board_columns/, ""],
  ]) {
    const f = fixture();
    try {
      withHost(f, () => {
        if (setup) f.native.exec(setup);
        const before = snapshot(f);
        let count = 0;
        f.state.beforeRun = (sql) => {
          if (
            pattern.test(sql) &&
            ++count === (action === "reorder-columns" ? 2 : 1)
          )
            throw new Error("INJECTED_SQL_FAILURE");
        };
        assert.throws(
          () => f.write(action, inputFor(action)),
          /INJECTED_SQL_FAILURE/,
        );
        assert.deepEqual(snapshot(f), before, action);
        assert.equal(f.native.isTransaction, false);
      });
    } finally {
      f.close();
    }
  }
});

test("authority loss during a write rolls back all SQL instead of merely hiding its result", () => {
  for (const change of [
    (f) => {
      f.state.generation++;
    },
    (f) => {
      f.state.actor = "did:member";
    },
    (f) => {
      f.event.senderFrame.url = "file:///other.html";
    },
    (f) => {
      f.event.senderFrame = { ...f.event.senderFrame };
    },
    (f) => {
      f.state.trusted = false;
    },
    (f) => {
      f.wrapper.current = {};
    },
    (f) => {
      f.native.exec(
        "UPDATE organization_members SET status='removed' WHERE member_did='did:owner'",
      );
    },
    (f) => {
      f.native.exec(
        "UPDATE organization_roles SET permissions='[]' WHERE name='owner'",
      );
    },
  ]) {
    const f = fixture();
    try {
      withHost(f, () => {
        const before = snapshot(f);
        let injected = false;
        f.state.beforeRun = () => {
          if (!injected) {
            injected = true;
            change(f);
          }
        };
        assert.throws(
          () => f.write("add-label", inputFor("add-label")),
          /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
        );
        assert.equal(injected, true);
        assert.deepEqual(snapshot(f), before);
        assert.equal(f.native.isTransaction, false);
      });
    } finally {
      f.close();
    }
  }
});

test("historical cross-board links cannot expand cascade deletion or sprint updates", () => {
  for (const [action, pollution] of [
    [
      "delete-task",
      "UPDATE team_tasks SET parent_task_id='task-1' WHERE id='task-2'",
    ],
    [
      "delete-board",
      "DELETE FROM team_tasks WHERE id='task-1'; UPDATE team_tasks SET column_id='column-1' WHERE id='task-2'",
    ],
    [
      "complete-sprint",
      "UPDATE team_tasks SET sprint_id='sprint-1' WHERE id='task-2'",
    ],
    [
      "delete-task",
      "UPDATE task_comments SET parent_id='comment-1' WHERE id='comment-2'",
    ],
    [
      "delete-task",
      "INSERT INTO task_dependencies (id,task_id,depends_on_task_id,created_at) VALUES ('bad','task-2','task-1',1)",
    ],
  ]) {
    const f = fixture();
    try {
      withHost(f, () => {
        f.native.exec(pollution);
        const before = snapshot(f);
        assert.throws(
          () =>
            f.write(action, {
              ...inputFor(action),
              ...(action === "delete-board" ? { boardId: "board-1" } : {}),
            }),
          { code: "BOARD_WRITE_SCOPE_CONFLICT" },
        );
        assert.deepEqual(snapshot(f), before);
      });
    } finally {
      f.close();
    }
  }
});

test("canonical create and update retain their governed route and legacy adjunct access stays denied", async () => {
  const f = fixture();
  try {
    await withHost(f, async (handlers) => {
      assert.deepEqual(
        await handlers.get("task:create-task")(f.event, { request: {} }),
        { canonical: "create" },
      );
      assert.deepEqual(
        await handlers.get("task:update-task")(f.event, {
          taskId: "canonical",
          request: { target: { id: "canonical" } },
        }),
        { canonical: "update" },
      );
      f.native.exec("INSERT INTO project_tasks VALUES ('canonical')");
      for (const [action, p] of [
        ["set-priority", { taskId: "canonical", priority: "high" }],
        [
          "create-task",
          { ...inputFor("create-task"), parentTaskId: "canonical" },
        ],
        ["create-checklist", { taskId: "canonical" }],
      ])
        await assert.rejects(
          handlers.get(`task:${action}`)(f.event, p),
          /ACTION_CONTROLLED_TASK_REQUIRED/,
        );
    });
  } finally {
    f.close();
  }
});

test("fresh manager instances bind writes to the checked database and public APIs remain async", async () => {
  const a = fixture();
  const b = fixture();
  try {
    await withHost(a, async () => {
      const {
        getTaskBoardManager,
        TaskBoardManager,
      } = require("../task-board-manager");
      getTaskBoardManager(a.wrapper);
      b.write("archive-board", { boardId: "board-1" });
      assert.equal(
        a.native
          .prepare("SELECT is_archived FROM task_boards WHERE id='board-1'")
          .get().is_archived,
        0,
      );
      assert.equal(
        b.native
          .prepare("SELECT is_archived FROM task_boards WHERE id='board-1'")
          .get().is_archived,
        1,
      );
      const result = new TaskBoardManager(a.wrapper).updateBoard("board-1", {
        name: "Async",
      });
      assert.equal(result instanceof Promise, true);
      assert.equal((await result).success, true);
    });
  } finally {
    a.close();
    b.close();
  }
});

test("savepoints preserve the caller's transaction on both success and failure", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      f.native.exec(
        "BEGIN; UPDATE task_boards SET name='Outer change' WHERE id='board-1'",
      );
      f.write("add-label", inputFor("add-label"));
      assert.equal(f.native.isTransaction, true);
      f.state.beforeRun = (sql) => {
        if (/INSERT INTO task_comments/.test(sql))
          throw new Error("FAILED_INNER_WRITE");
      };
      assert.throws(
        () => f.write("add-comment", inputFor("add-comment")),
        /FAILED_INNER_WRITE/,
      );
      assert.equal(f.native.isTransaction, true);
      assert.equal(
        f.native
          .prepare("SELECT name FROM task_boards WHERE id='board-1'")
          .get().name,
        "Outer change",
      );
      assert.equal(
        f.native
          .prepare("SELECT assignee_did FROM team_tasks WHERE id='task-1'")
          .get().assignee_did,
        null,
      );
      f.native.exec("ROLLBACK");
      assert.equal(
        f.native
          .prepare("SELECT name FROM task_boards WHERE id='board-1'")
          .get().name,
        "First",
      );
      assert.equal(
        f.native
          .prepare("SELECT column_id FROM team_tasks WHERE id='task-1'")
          .get().column_id,
        "column-1",
      );
    });
  } finally {
    f.close();
  }
});

test("an accidentally asynchronous core is rejected before it can start any side effect", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      const { TeamTaskManager } = require("../team-task-manager");
      const original = TeamTaskManager.prototype.addLabelSync;
      let calls = 0;
      TeamTaskManager.prototype.addLabelSync = async () => {
        calls++;
        return { success: true };
      };
      try {
        const before = snapshot(f);
        assert.throws(() => f.write("add-label", inputFor("add-label")), {
          code: "BOARD_WRITE_ASYNC_CORE",
        });
        assert.equal(calls, 0);
        assert.deepEqual(snapshot(f), before);
      } finally {
        TeamTaskManager.prototype.addLabelSync = original;
      }
    });
  } finally {
    f.close();
  }
});

const LOCAL_ADJUNCT_ACTIONS = [
  "add-label",
  "link-tasks",
  "create-subtask",
  "convert-to-subtask",
  "toggle-checklist-item",
  "delete-checklist-item",
  "reorder-checklist",
  "edit-comment",
  "delete-comment",
];

function validateCreation(f, action, params) {
  const boardId =
    action === "create-subtask"
      ? f.native
          .prepare("SELECT board_id FROM team_tasks WHERE id=?")
          .get(params.parentTaskId).board_id
      : params.boardId;
  const orgId = f.native
    .prepare("SELECT org_id FROM task_boards WHERE id=?")
    .get(boardId).org_id;
  const data =
    action === "create-subtask"
      ? {
          boardId,
          columnId: "column-1",
          ...params.subtaskData,
          parentTaskId: params.parentTaskId,
        }
      : params;
  return require("../board-write-authority").checkBoardWriteReferences(
    f.db,
    "create-task",
    data,
    { boardId, orgId },
  );
}

function addPeer(f) {
  f.native.exec(
    "INSERT INTO team_tasks (id,board_id,column_id,title,reporter_did,created_at,updated_at) VALUES ('task-peer','board-1','column-1','Peer','did:owner',1,1)",
  );
}

test("local adjunct journey persists labels, relationships, completion, comments and author-bound activity visible through real read IPCs", async () => {
  const f = fixture();
  try {
    addPeer(f);
    await withHost(f, async (handlers) => {
      const invoke = (action, params = inputFor(action)) =>
        handlers.get(`task:${action}`)(f.event, params);
      // Creation has its own persistent native suite; seed this adjunct read/write journey.
      await assert.rejects(
        invoke("create-subtask", inputFor("create-subtask")),
        { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
      );
      f.native.exec(
        "INSERT INTO team_tasks(id,board_id,column_id,title,task_type,parent_task_id,reporter_did,created_at,updated_at)VALUES('adjunct-child','board-1','column-1','Child','subtask','task-1','did:owner',1,1)",
      );
      const child = { taskId: "adjunct-child" };
      await invoke("add-label", { taskId: child.taskId, labelId: "label-1" });
      const read = await invoke("get-task", { taskId: child.taskId });
      assert.equal(read.task.parentTaskId, "task-1");
      assert.deepEqual(read.task.labels, ["label-1"]);
      const link = await invoke("link-tasks", {
        taskId: child.taskId,
        dependsOnTaskId: "task-peer",
        dependencyType: "blocked_by",
        actorDid: "did:forged",
      });
      assert.equal(
        f.native
          .prepare("SELECT created_by FROM task_dependencies WHERE id=?")
          .get(link.dependencyId).created_by,
        "did:owner",
      );
      const toggle = await invoke("toggle-checklist-item");
      assert.equal(toggle.isDone, true);
      assert.equal(
        f.native
          .prepare(
            "SELECT completed_by FROM task_checklist_items WHERE id='item-1'",
          )
          .get().completed_by,
        "did:owner",
      );
      assert.equal((await invoke("toggle-checklist-item")).isDone, false);
      const unfinished = f.native
        .prepare(
          "SELECT completed_at,completed_by FROM task_checklist_items WHERE id='item-1'",
        )
        .get();
      assert.equal(unfinished.completed_at, null);
      assert.equal(unfinished.completed_by, null);
      await invoke("edit-comment", {
        commentId: "comment-1",
        content: "PRIVATE_EDITED_BODY",
      });
      const comments = await invoke("get-comments", { taskId: "task-1" });
      assert.equal(comments[0].content, "PRIVATE_EDITED_BODY");
      assert.equal(comments[0].is_edited, true);
      const activity = await invoke("get-activity", { taskId: "task-1" });
      assert.ok(activity.some((event) => event.action === "comment_edited"));
      assert.ok(activity.every((event) => event.actor_did === "did:owner"));
      assert.equal(
        JSON.stringify(activity).includes("PRIVATE_EDITED_BODY"),
        false,
      );
      await invoke("delete-comment");
      assert.deepEqual(await invoke("get-comments", { taskId: "task-1" }), []);
    });
  } finally {
    f.close();
  }
});

test("each local adjunct requires its own permission and extra create/update grants where needed", () => {
  for (const action of LOCAL_ADJUNCT_ACTIONS) {
    const f = fixture();
    try {
      addPeer(f);
      withHost(f, () => {
        f.state.actor = "did:member";
        f.native.exec(
          "UPDATE task_comments SET author_did='did:member' WHERE id='comment-1'",
        );
        const needed = [
          ACTIONS[action][0],
          ...(action === "create-subtask" ? ["board.task.create"] : []),
          ...(action === "convert-to-subtask" ? ["board.task.update"] : []),
        ];
        const before = snapshot(f);
        for (const omitted of needed) {
          f.native
            .prepare(
              "UPDATE organization_roles SET permissions=? WHERE name='member'",
            )
            .run(JSON.stringify(needed.filter((p) => p !== omitted)));
          assert.throws(
            () => f.write(action, inputFor(action)),
            /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
            `${action} without ${omitted}`,
          );
        }
        f.native
          .prepare(
            "UPDATE organization_roles SET permissions=? WHERE name='member'",
          )
          .run(JSON.stringify(needed));
        if (action === "create-subtask") {
          const afterGrant = snapshot(f);
          assert.throws(() => f.write(action, inputFor(action)), {
            code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
          });
          assert.deepEqual(snapshot(f), afterGrant);
        } else {
          assert.equal(f.write(action, inputFor(action)).success, true, action);
          assert.notDeepEqual(snapshot(f), before);
        }
      });
    } finally {
      f.close();
    }
  }
});

test("subtask creation routes share field permissions, inherited scope and canonical reference rejection", async () => {
  const f = fixture();
  try {
    await withHost(f, async (handlers) => {
      f.state.actor = "did:member";
      for (const [held, extra] of [
        [["board.task.create"], {}],
        [
          ["board.task.create", "board.task.subtask"],
          { assigneeDid: "did:member" },
        ],
        [["board.task.create", "board.task.subtask"], { sprintId: "sprint-1" }],
      ]) {
        f.native
          .prepare(
            "UPDATE organization_roles SET permissions=? WHERE name='member'",
          )
          .run(JSON.stringify(held));
        await assert.rejects(
          handlers.get("task:create-subtask")(f.event, {
            parentTaskId: "task-1",
            subtaskData: { title: "Child", ...extra },
          }),
          /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
        );
        await assert.rejects(
          handlers.get("task:create-task")(f.event, {
            ...inputFor("create-task"),
            parentTaskId: "task-1",
            ...extra,
          }),
          /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
        );
      }
      f.state.actor = "did:owner";
      const before = snapshot(f);
      for (const extra of [
        { boardId: "board-2" },
        { columnId: "column-2" },
        { parentTaskId: "task-2" },
        { taskType: "task" },
        { assigneeDid: "did:other" },
        { sprintId: "sprint-2" },
        { labels: ["label-2"] },
      ]) {
        await assert.rejects(
          handlers.get("task:create-subtask")(f.event, {
            parentTaskId: "task-1",
            subtaskData: { title: "Child", ...extra },
          }),
          /BOARD_WRITE_|BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED/,
        );
        assert.deepEqual(snapshot(f), before);
      }
      f.native.exec("INSERT INTO project_tasks VALUES ('canonical')");
      await assert.rejects(
        handlers.get("task:create-subtask")(f.event, {
          parentTaskId: "task-1",
          subtaskData: { title: "Child", parentTaskId: "canonical" },
        }),
        /ACTION_CONTROLLED_TASK_REQUIRED/,
      );
      await assert.rejects(
        handlers.get("task:link-tasks")(f.event, {
          taskId: "task-1",
          dependsOnTaskId: "canonical",
        }),
        /ACTION_CONTROLLED_TASK_REQUIRED/,
      );
    });
  } finally {
    f.close();
  }
});

test("label and dependency retries reuse persisted identity without additional activity", () => {
  const f = fixture();
  try {
    addPeer(f);
    withHost(f, () => {
      assert.equal(f.write("add-label", inputFor("add-label")).added, true);
      const linked = f.write("link-tasks", inputFor("link-tasks"));
      const before = snapshot(f);
      assert.equal(f.write("add-label", inputFor("add-label")).added, false);
      const replay = f.write("link-tasks", inputFor("link-tasks"));
      assert.equal(replay.linked, false);
      assert.equal(replay.dependencyId, linked.dependencyId);
      assert.deepEqual(snapshot(f), before);
    });
  } finally {
    f.close();
  }
});

test("corrupt, foreign and oversized existing label arrays are never silently replaced", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      for (const labels of [
        "broken",
        "{}",
        "null",
        "[42]",
        '["label-2"]',
        JSON.stringify(Array(501).fill("label-1")),
      ]) {
        f.native
          .prepare("UPDATE team_tasks SET labels=? WHERE id='task-1'")
          .run(labels);
        const before = snapshot(f);
        assert.throws(
          () => f.write("add-label", inputFor("add-label")),
          /BOARD_WRITE_/,
        );
        assert.deepEqual(snapshot(f), before);
      }
      f.native.exec("UPDATE team_tasks SET labels=NULL WHERE id='task-1'");
      assert.throws(
        () => f.write("add-label", { taskId: "task-1", labelId: "label-2" }),
        /BOARD_WRITE_SCOPE_CONFLICT/,
      );
    });
  } finally {
    f.close();
  }
});

test("parent assignment rejects self, descendant, foreign board and historical cyclic ancestry", () => {
  const f = fixture();
  try {
    addPeer(f);
    withHost(f, () => {
      f.write("convert-to-subtask", {
        taskId: "task-peer",
        parentTaskId: "task-1",
      });
      for (const parentTaskId of ["task-1", "task-peer", "task-2"])
        assert.throws(
          () =>
            f.write("convert-to-subtask", { taskId: "task-1", parentTaskId }),
          /BOARD_WRITE_CYCLE|BOARD_WRITE_SCOPE_CONFLICT/,
        );
      f.native.exec(
        "UPDATE team_tasks SET parent_task_id='task-peer' WHERE id='task-1'",
      );
      const before = snapshot(f);
      assert.throws(
        () => validateCreation(f, "create-subtask", inputFor("create-subtask")),
        /BOARD_WRITE_CYCLE/,
      );
      assert.deepEqual(snapshot(f), before);
    });
  } finally {
    f.close();
  }
});

test("dependency precedence detects mixed-direction and historical cycles while symmetric relationships stay independent", () => {
  const f = fixture();
  try {
    addPeer(f);
    withHost(f, () => {
      f.write("link-tasks", {
        taskId: "task-1",
        dependsOnTaskId: "task-peer",
        dependencyType: "blocks",
      });
      const before = snapshot(f);
      assert.throws(
        () =>
          f.write("link-tasks", {
            taskId: "task-1",
            dependsOnTaskId: "task-peer",
            dependencyType: "blocked_by",
          }),
        /BOARD_WRITE_CYCLE/,
      );
      assert.throws(
        () =>
          f.write("link-tasks", {
            taskId: "task-peer",
            dependsOnTaskId: "task-1",
            dependencyType: "blocks",
          }),
        /BOARD_WRITE_CYCLE/,
      );
      assert.deepEqual(snapshot(f), before);
      for (const dependencyType of ["relates_to", "duplicates"])
        assert.equal(
          f.write("link-tasks", {
            taskId: "task-peer",
            dependsOnTaskId: "task-1",
            dependencyType,
          }).success,
          true,
        );
      for (const p of [
        { taskId: "task-1", dependsOnTaskId: "task-1" },
        { taskId: "task-1", dependsOnTaskId: "task-2" },
        {
          taskId: "task-1",
          dependsOnTaskId: "task-peer",
          dependencyType: "unknown",
        },
      ])
        assert.throws(() => f.write("link-tasks", p), /BOARD_WRITE_/);
      f.native.exec(
        "INSERT INTO task_dependencies (id,task_id,depends_on_task_id,dependency_type,created_at) VALUES ('old-cycle','task-peer','task-1','blocks',1)",
      );
      assert.throws(
        () => f.write("link-tasks", inputFor("link-tasks")),
        /BOARD_WRITE_CYCLE/,
      );
    });
  } finally {
    f.close();
  }
});

test("checklist order is a complete permutation of that checklist and completion states stay valid", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      f.native.exec(
        "INSERT INTO task_checklists(id,task_id,title,created_at,updated_at) VALUES ('list-other','task-1','Other',1,1); INSERT INTO task_checklist_items(id,checklist_id,content,created_at,updated_at) VALUES ('item-other','list-other','Other',1,1),('item-last','checklist-1','Last',1,1)",
      );
      const before = snapshot(f);
      for (const itemOrder of [
        [],
        ["item-1"],
        ["item-1", "item-1"],
        ["item-1", "item-other"],
        ["item-1", "unknown"],
      ]) {
        assert.throws(
          () =>
            f.write("reorder-checklist", {
              checklistId: "checklist-1",
              itemOrder,
            }),
          /BOARD_WRITE_/,
        );
        assert.deepEqual(snapshot(f), before);
      }
      f.write("reorder-checklist", {
        checklistId: "checklist-1",
        itemOrder: ["item-last", "item-1"],
      });
      assert.deepEqual(
        f.native
          .prepare(
            "SELECT id FROM task_checklist_items WHERE checklist_id='checklist-1' ORDER BY position",
          )
          .all()
          .map((r) => r.id),
        ["item-last", "item-1"],
      );
      f.native.exec(
        "UPDATE task_checklist_items SET is_done=99 WHERE id='item-1'",
      );
      assert.throws(
        () =>
          f.write("toggle-checklist-item", inputFor("toggle-checklist-item")),
        /BOARD_WRITE_INVALID_REQUEST/,
      );
    });
  } finally {
    f.close();
  }
});

test("comment ownership and descendants require moderation in addition to the base mutation grant", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.comment.create","board.comment.edit","board.comment.delete"]' WHERE name='member'`,
      );
      f.state.actor = "did:member";
      assert.throws(
        () => f.write("edit-comment", inputFor("edit-comment")),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
      assert.throws(
        () => f.write("delete-comment", inputFor("delete-comment")),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
      const own = f.write("add-comment", {
        taskId: "task-1",
        comment: { content: "Own" },
      });
      f.write("edit-comment", {
        commentId: own.commentId,
        content: "Own edited",
      });
      f.state.actor = "did:owner";
      const reply = f.write("add-comment", {
        taskId: "task-1",
        comment: { content: "Someone else's reply", parentId: own.commentId },
      });
      f.state.actor = "did:member";
      const before = snapshot(f);
      assert.throws(
        () => f.write("delete-comment", { commentId: own.commentId }),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
      assert.deepEqual(snapshot(f), before);
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.comment.moderate"]' WHERE name='member'`,
      );
      assert.throws(
        () => f.write("delete-comment", { commentId: own.commentId }),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.comment.delete","board.comment.edit","board.comment.moderate"]' WHERE name='member'`,
      );
      f.write("edit-comment", {
        commentId: "comment-1",
        content: "Moderator edit",
      });
      const activity = f.native
        .prepare(
          "SELECT actor_did FROM task_activity_log WHERE action='comment_edited' ORDER BY rowid DESC LIMIT 1",
        )
        .get();
      assert.equal(activity.actor_did, "did:member");
      f.write("delete-comment", { commentId: own.commentId });
      assert.equal(
        f.native
          .prepare("SELECT 1 FROM task_comments WHERE id=?")
          .get(reply.commentId),
        undefined,
      );
      assert.equal(
        f.native
          .prepare("SELECT 1 FROM task_comments WHERE id='comment-1'")
          .get() != null,
        true,
      );
    });
  } finally {
    f.close();
  }
});

test("cross-task reply chains and historical comment cycles cannot expand deletion even for moderators", () => {
  for (const pollution of [
    "INSERT INTO task_comments(id,task_id,author_did,content,parent_id,created_at,updated_at) VALUES ('bad-reply','task-peer','did:owner','Other task','comment-1',1,1)",
    "UPDATE task_comments SET parent_id='comment-1' WHERE id='comment-1'",
  ]) {
    const f = fixture();
    try {
      addPeer(f);
      withHost(f, () => {
        f.native.exec(pollution);
        const before = snapshot(f);
        assert.throws(
          () => f.write("delete-comment", inputFor("delete-comment")),
          /BOARD_WRITE_SCOPE_CONFLICT|BOARD_WRITE_CYCLE/,
        );
        assert.deepEqual(snapshot(f), before);
      });
    } finally {
      f.close();
    }
  }
});

test("each adjunct mutation and its activity record roll back together on SQL failure or session loss", () => {
  for (const action of LOCAL_ADJUNCT_ACTIONS)
    for (const failure of ["sql", "session"]) {
      const f = fixture();
      try {
        addPeer(f);
        withHost(f, () => {
          const before = snapshot(f);
          let hit = false;
          f.state.beforeRun = (sql) => {
            if (/INSERT INTO task_activity_log/.test(sql)) {
              hit = true;
              if (failure === "sql") throw new Error("ADJUNCT_AUDIT_FAILED");
              f.state.generation++;
            }
          };
          if (action === "create-subtask") {
            assert.throws(() => f.write(action, inputFor(action)), {
              code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
            });
            assert.equal(hit, false);
            assert.deepEqual(snapshot(f), before);
            return;
          }
          assert.throws(
            () => f.write(action, inputFor(action)),
            /ADJUNCT_AUDIT_FAILED|BOARD_WRITE_NOT_FOUND_OR_DENIED/,
            `${action}/${failure}`,
          );
          assert.equal(hit, true, action);
          assert.deepEqual(snapshot(f), before, action);
          assert.equal(f.native.isTransaction, false);
        });
      } finally {
        f.close();
      }
    }
});

test("comment and activity read IPCs refuse revoked or changed in-flight identity", async () => {
  for (const action of ["get-comments", "get-activity"]) {
    const f = fixture();
    try {
      await withHost(f, async (handlers) => {
        const pending = handlers.get(`task:${action}`)(f.event, {
          taskId: "task-1",
        });
        f.state.generation++;
        await assert.rejects(pending, /BOARD_READ_NOT_FOUND_OR_DENIED/);
        f.native.exec(
          "UPDATE organization_members SET status='removed' WHERE member_did='did:owner'",
        );
        await assert.rejects(
          handlers.get(`task:${action}`)(f.event, { taskId: "task-1" }),
          /BOARD_READ_NOT_FOUND_OR_DENIED/,
        );
      });
    } finally {
      f.close();
    }
  }
});

test("parent, reply and dependency graph limits reject incomplete validation without mutating", () => {
  for (const kind of ["parent", "reply", "dependency"]) {
    const f = fixture();
    try {
      withHost(f, () => {
        if (kind === "reply")
          f.native
            .exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<500)
          INSERT INTO task_comments(id,task_id,author_did,content,parent_id,created_at,updated_at)
          SELECT 'reply-'||n,'task-1','did:owner','Reply','comment-1',1,1 FROM seq`);
        else {
          const count = kind === "parent" ? 501 : 2002;
          f.native
            .exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${count})
            INSERT INTO team_tasks(id,board_id,column_id,title,reporter_did,created_at,updated_at)
            SELECT 'node-'||n,'board-1','column-1','Node','did:owner',1,1 FROM seq`);
          if (kind === "parent")
            f.native.exec(
              "UPDATE team_tasks SET parent_task_id='node-'||(CAST(substr(id,6) AS INTEGER)+1) WHERE id LIKE 'node-%' AND id<>'node-501'",
            );
          else
            f.native
              .exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<2001)
            INSERT INTO task_dependencies(id,task_id,depends_on_task_id,dependency_type,created_at)
            SELECT 'edge-'||n,'node-'||n,'node-'||(n+1),'blocks',1 FROM seq`);
        }
        const before = snapshot(f);
        const action =
          kind === "reply"
            ? "delete-comment"
            : kind === "parent"
              ? "convert-to-subtask"
              : "link-tasks";
        const p =
          kind === "reply"
            ? { commentId: "comment-1" }
            : kind === "parent"
              ? { taskId: "task-1", parentTaskId: "node-1" }
              : { taskId: "task-1", dependsOnTaskId: "node-1" };
        assert.throws(
          () => f.write(action, p),
          /BOARD_WRITE_GRAPH_LIMIT/,
          kind,
        );
        assert.deepEqual(snapshot(f), before, kind);
      });
    } finally {
      f.close();
    }
  }
});

test("exact graph capacity permits duplicate links but rejects the next record and both child routes count the new node", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      f.native
        .exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<2001)
        INSERT INTO team_tasks(id,board_id,column_id,title,reporter_did,created_at,updated_at)
        SELECT 'cap-'||n,'board-1','column-1','Node','did:owner',1,1 FROM seq;
        WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<2000)
        INSERT INTO task_dependencies(id,task_id,depends_on_task_id,dependency_type,created_at)
        SELECT 'cap-edge-'||n,'cap-'||n,'cap-'||(n+1),'blocks',1 FROM seq`);
      const before = snapshot(f);
      const replay = f.write("link-tasks", {
        taskId: "cap-1",
        dependsOnTaskId: "cap-2",
      });
      assert.equal(replay.linked, false);
      assert.equal(replay.dependencyId, "cap-edge-1");
      assert.throws(
        () =>
          f.write("link-tasks", { taskId: "task-1", dependsOnTaskId: "cap-1" }),
        /BOARD_WRITE_GRAPH_LIMIT/,
      );
      assert.deepEqual(snapshot(f), before);
      f.native.exec(
        "UPDATE team_tasks SET parent_task_id='cap-'||(CAST(substr(id,5) AS INTEGER)+1) WHERE id LIKE 'cap-%' AND CAST(substr(id,5) AS INTEGER)<500",
      );
      const full = snapshot(f);
      for (const [action, p] of [
        [
          "create-subtask",
          { parentTaskId: "cap-1", subtaskData: { title: "Too deep" } },
        ],
        ["create-task", { ...inputFor("create-task"), parentTaskId: "cap-1" }],
        ["convert-to-subtask", { taskId: "task-1", parentTaskId: "cap-1" }],
      ])
        assert.throws(
          () =>
            action.startsWith("create-")
              ? validateCreation(f, action, p)
              : f.write(action, p),
          /BOARD_WRITE_GRAPH_LIMIT/,
        );
      assert.deepEqual(snapshot(f), full);
      assert.doesNotThrow(() =>
        validateCreation(f, "create-subtask", {
          parentTaskId: "cap-2",
          subtaskData: { title: "At capacity" },
        }),
      );
    });
  } finally {
    f.close();
  }
});

test("both legacy creation channels refuse before any task or activity side effect", async () => {
  const f = fixture();
  try {
    await withHost(f, async (handlers) => {
      const before = snapshot(f);
      let called = false;
      f.state.beforeRun = () => {
        called = true;
      };
      for (const action of ["create-task", "create-subtask"])
        await assert.rejects(
          handlers.get("task:" + action)(f.event, inputFor(action)),
          { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
        );
      assert.equal(called, false);
      assert.deepEqual(snapshot(f), before);
    });
  } finally {
    f.close();
  }
});

test("historical missing dependency endpoints and parent comments cannot be ignored during validation", () => {
  for (const pollution of [
    "INSERT INTO task_dependencies(id,task_id,depends_on_task_id,created_at) VALUES ('dangling-from','missing','task-1',1)",
    "INSERT INTO task_dependencies(id,task_id,depends_on_task_id,created_at) VALUES ('dangling-to','task-1','missing',1)",
    "UPDATE task_comments SET parent_id='missing' WHERE id='comment-1'",
  ]) {
    const f = fixture();
    try {
      addPeer(f);
      withHost(f, () => {
        f.native.exec(
          `PRAGMA foreign_keys=OFF; ${pollution}; PRAGMA foreign_keys=ON`,
        );
        const before = snapshot(f);
        assert.throws(
          () => f.write("link-tasks", inputFor("link-tasks")),
          /BOARD_WRITE_SCOPE_CONFLICT/,
        );
        assert.deepEqual(snapshot(f), before);
      });
    } finally {
      f.close();
    }
  }
});

test("moderation revoked at commit rolls back editing or cascading deletion of others' comments", () => {
  for (const action of ["edit-comment", "delete-comment"]) {
    const f = fixture();
    try {
      withHost(f, () => {
        f.state.actor = "did:member";
        f.native.exec(
          `UPDATE organization_roles SET permissions='["board.comment.edit","board.comment.delete","board.comment.moderate"]' WHERE name='member'`,
        );
        const before = snapshot(f);
        let hit = false;
        f.state.beforeRun = (sql) => {
          if (/INSERT INTO task_activity_log/.test(sql)) {
            hit = true;
            f.native.exec(
              `UPDATE organization_roles SET permissions='["board.comment.edit","board.comment.delete"]' WHERE name='member'`,
            );
          }
        };
        assert.throws(
          () => f.write(action, inputFor(action)),
          /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
        );
        assert.equal(hit, true);
        assert.deepEqual(snapshot(f), before);
      });
    } finally {
      f.close();
    }
  }
});

test("invalid comment text is refused without losing the persisted comment", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      const before = snapshot(f);
      for (const content of [null, "", "  ", 42, "x".repeat(100001)])
        assert.throws(
          () => f.write("edit-comment", { commentId: "comment-1", content }),
          /BOARD_WRITE_INVALID_REQUEST/,
        );
      assert.deepEqual(snapshot(f), before);
    });
  } finally {
    f.close();
  }
});

test("mention recipient and explicit mention permission cannot be substituted by renderer attribution", () => {
  const f = fixture();
  try {
    withHost(f, () => {
      const before = snapshot(f);
      for (const userDid of [
        null,
        undefined,
        "",
        " ",
        12,
        "did:former",
        "did:outsider",
        "did:other",
      ])
        assert.throws(() =>
          f.write("mention-user", { taskId: "task-1", userDid }),
        );
      f.state.actor = "did:member";
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.task.update"]' WHERE name='member'`,
      );
      assert.throws(
        () => f.write("mention-user", inputFor("mention-user")),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
      f.native.exec(
        `UPDATE organization_roles SET permissions='["board.task.*","board.checklist.*","board.comment.create","board.report.create"]' WHERE name='member'`,
      );
      assert.deepEqual(snapshot(f), before);
      f.state.actor = "did:owner";
      const result = f.write("mention-user", inputFor("mention-user"));
      const row = f.native
        .prepare("SELECT * FROM task_board_notice_events WHERE id=?")
        .get(result.notificationId);
      assert.equal(row.actor_did, "did:owner");
      assert.equal(row.recipient_did, "did:member");
      const notice = f.native
        .prepare("SELECT * FROM notifications WHERE id=?")
        .get(result.notificationId);
      assert.equal(notice.content, null);
      assert.deepEqual(Object.keys(JSON.parse(notice.data)).sort(), [
        "eventId",
        "schema",
      ]);
      assert.ok(!JSON.stringify(notice).includes("Original"));
    });
  } finally {
    f.close();
  }
});

test("mention event, activity and notification roll back together on each SQL failure or final authority change", () => {
  for (const scenario of [
    "activity",
    "ledger",
    "notification",
    "recipient",
    "scope",
    "session",
  ]) {
    const f = fixture();
    try {
      withHost(f, () => {
        const before = snapshot(f);
        f.state.beforeRun = (sql) => {
          if (
            (scenario === "activity" &&
              /INSERT INTO task_activity_log/.test(sql)) ||
            (scenario === "ledger" &&
              /INSERT INTO task_board_notice_events/.test(sql)) ||
            (scenario === "notification" &&
              /INSERT INTO notifications/.test(sql))
          )
            throw new Error("injected SQL failure");
          if (/INSERT INTO notifications/.test(sql)) {
            if (scenario === "recipient")
              f.native.exec(
                "UPDATE organization_members SET status='removed' WHERE member_did='did:member'",
              );
            if (scenario === "scope")
              f.native.exec(
                "UPDATE team_tasks SET board_id='board-2',column_id='column-2' WHERE id='task-1'",
              );
            if (scenario === "session") f.state.generation++;
          }
        };
        assert.throws(
          () => f.write("mention-user", inputFor("mention-user")),
          undefined,
          scenario,
        );
        assert.deepEqual(snapshot(f), before, scenario);
        assert.equal(f.native.isTransaction, false);
      });
    } finally {
      f.close();
    }
  }
});

test("mention native list/count/open/read reconstruct source-authorized references without cached task text or desktop output", async () => {
  const f = fixture();
  try {
    await withHost(f, async () => {
      const { notificationId } = f.write(
        "mention-user",
        inputFor("mention-user"),
      );
      f.native
        .prepare(
          "UPDATE notifications SET title='stale secret',content='stale task body' WHERE id=?",
        )
        .run(notificationId);
      const host = notificationHost(f);
      assert.equal((await host.call("get-tasks")).notifications.length, 0);
      f.state.actor = "did:member";
      const result = await host.call("get-tasks");
      assert.equal(result.notifications.length, 1);
      assert.equal(result.notifications[0].content, null);
      assert.ok(!JSON.stringify(result).includes("stale"));
      assert.deepEqual(await host.call("get-unread-count"), {
        success: true,
        count: 1,
      });
      assert.deepEqual(await host.call("open-task", notificationId), {
        success: true,
        target: { taskId: "task-1", boardId: "board-1", orgId: "org-1" },
      });
      assert.equal(
        (await host.call("mark-read", notificationId)).success,
        true,
      );
      assert.deepEqual(await host.call("get-unread-count"), {
        success: true,
        count: 0,
      });
      assert.equal(
        (await host.call("get-tasks", { isRead: true })).notifications.length,
        1,
      );
      f.native.exec(
        "UPDATE organization_members SET status='removed' WHERE member_did='did:member'",
      );
      assert.equal((await host.call("get-tasks")).notifications.length, 0);
      assert.equal((await host.call("get-all")).notifications.length, 0);
      assert.equal(
        (await host.call("open-task", notificationId)).success,
        false,
      );
      await assert.rejects(
        host.call("mark-read", notificationId),
        /NOTIFICATION_NOT_FOUND_OR_DENIED/,
      );
      assert.deepEqual(host.shown, []);
    });
  } finally {
    f.close();
  }
});

test("mention projections fail closed after reference downgrade, ledger/activity tamper, deletion, scope migration or canonical collision", async () => {
  const mutations = [
    "UPDATE notifications SET data=NULL",
    "UPDATE notifications SET data='{}'",
    "UPDATE notifications SET data='{broken'",
    `UPDATE notifications SET data='{"schema":"chainlesschain.board-notice-ref/v1","eventId":"forged"}'`,
    "UPDATE notifications SET type='system'",
    "UPDATE notifications SET created_at=0",
    "UPDATE notifications SET user_did='did:owner'",
    "UPDATE task_board_notice_events SET org_id='org-2'",
    "UPDATE task_board_notice_events SET board_id='board-2'",
    "UPDATE task_board_notice_events SET actor_did='did:forged'",
    "UPDATE task_board_notice_events SET recipient_did='did:owner'",
    "UPDATE task_activity_log SET metadata='{}'",
    "UPDATE task_activity_log SET action='comment_added'",
    "UPDATE task_activity_log SET task_id='task-2'",
    "DELETE FROM task_activity_log",
    "DELETE FROM task_board_notice_events",
    "DELETE FROM team_tasks WHERE id='task-1'",
    "UPDATE team_tasks SET board_id='board-2',column_id='column-2' WHERE id='task-1'",
    "UPDATE task_boards SET org_id='org-2' WHERE id='board-1'",
    "INSERT INTO project_tasks VALUES ('task-1')",
  ];
  for (const mutation of mutations) {
    const f = fixture();
    try {
      await withHost(f, async () => {
        const { notificationId } = f.write(
          "mention-user",
          inputFor("mention-user"),
        );
        f.native.exec(mutation);
        f.state.actor = "did:member";
        const host = notificationHost(f);
        assert.deepEqual(
          await host.call("get-tasks"),
          { success: true, notifications: [] },
          mutation,
        );
        assert.deepEqual(
          await host.call("get-all"),
          { success: true, notifications: [] },
          mutation,
        );
        assert.deepEqual(
          await host.call("get-unread-count"),
          { success: true, count: 0 },
          mutation,
        );
        assert.equal(
          (await host.call("open-task", notificationId)).success,
          false,
          mutation,
        );
        await assert.rejects(
          host.call("mark-read", notificationId),
          /NOTIFICATION_NOT_FOUND_OR_DENIED/,
          mutation,
        );
        assert.equal((await host.call("mark-all-read")).success, true);
        assert.equal(
          f.native
            .prepare("SELECT is_read FROM notifications WHERE id=?")
            .get(notificationId).is_read,
          0,
        );
      });
    } finally {
      f.close();
    }
  }
});

test("ledger-bound rows cannot downgrade through an ordinary ID and null/legacy reference", async () => {
  const f = fixture();
  try {
    await withHost(f, async () => {
      f.write("mention-user", inputFor("mention-user"));
      f.native.exec(`UPDATE task_board_notice_events SET id='legacy-disguised';
      UPDATE notifications SET id='legacy-disguised',data=NULL,title='cached secret',content='cached task';`);
      f.state.actor = "did:member";
      const host = notificationHost(f);
      assert.deepEqual(await host.call("get-all"), {
        success: true,
        notifications: [],
      });
      assert.deepEqual(await host.call("get-unread-count"), {
        success: true,
        count: 0,
      });
      await assert.rejects(
        host.call("mark-read", "legacy-disguised"),
        /NOTIFICATION_NOT_FOUND_OR_DENIED/,
      );
      assert.equal((await host.call("mark-all-read")).success, true);
      assert.equal(
        f.native.prepare("SELECT is_read FROM notifications").get().is_read,
        0,
      );
    });
  } finally {
    f.close();
  }
});

test("source infrastructure errors clear list/count output and do not acknowledge a protected notice", async () => {
  const f = fixture();
  try {
    await withHost(f, async () => {
      const { notificationId } = f.write(
        "mention-user",
        inputFor("mention-user"),
      );
      f.native.exec(
        "ALTER TABLE task_board_notice_events RENAME COLUMN recipient_did TO broken_recipient",
      );
      f.state.actor = "did:member";
      const host = notificationHost(f);
      for (const channel of ["get-all", "get-tasks"])
        assert.deepEqual(await host.call(channel), {
          success: false,
          notifications: [],
          error: "NOTIFICATION_OPERATION_FAILED",
        });
      assert.deepEqual(await host.call("get-unread-count"), {
        success: false,
        count: 0,
        error: "NOTIFICATION_OPERATION_FAILED",
      });
      assert.equal(
        (await host.call("open-task", notificationId)).success,
        false,
      );
      await assert.rejects(host.call("mark-read", notificationId));
      await assert.rejects(host.call("mark-all-read"));
      assert.equal(
        f.native.prepare("SELECT is_read FROM notifications").get().is_read,
        0,
      );
    });
  } finally {
    f.close();
  }
});

test("notice acknowledgments recheck source after SQL triggers and roll back all affected rows", async () => {
  for (const action of ["mark-read", "mark-all-read"]) {
    const f = fixture();
    try {
      await withHost(f, async () => {
        const first = f.write("mention-user", inputFor("mention-user"));
        f.write("mention-user", inputFor("mention-user"));
        f.state.actor = "did:member";
        const host = notificationHost(f);
        f.native
          .exec(`CREATE TRIGGER revoke_notice_reader AFTER UPDATE OF is_read ON notifications
        BEGIN UPDATE organization_members SET status='removed' WHERE member_did='did:member'; END;`);
        const before = snapshot(f);
        await assert.rejects(
          host.call(
            action,
            ...(action === "mark-read" ? [first.notificationId] : []),
          ),
          /NOTIFICATION_NOT_FOUND_OR_DENIED/,
        );
        assert.deepEqual(snapshot(f), before);
      });
    } finally {
      f.close();
    }
  }
});

test("protected notification pagination skips inaccessible source rows before applying offsets across scan pages", async () => {
  const f = fixture();
  try {
    await withHost(f, async () => {
      const first = f.write("mention-user", inputFor("mention-user"));
      const second = f.write("mention-user", inputFor("mention-user"));
      for (let i = 0; i < 105; i++)
        f.native
          .prepare(
            "INSERT INTO notifications VALUES (?,?,'comment','stale','hidden',NULL,0,?)",
          )
          .run(`cc-board-mention:orphan-${i}`, "did:member", Date.now() + i);
      f.state.actor = "did:member";
      const host = notificationHost(f);
      const expected = [first.notificationId, second.notificationId].sort(
        (a, b) => {
          const get = (id) =>
            f.native
              .prepare("SELECT created_at FROM notifications WHERE id=?")
              .get(id).created_at;
          return get(b) - get(a) || b.localeCompare(a);
        },
      );
      for (const channel of ["get-all", "get-tasks"])
        assert.deepEqual(
          (await host.call(channel, { limit: 1, offset: 1 })).notifications.map(
            (row) => row.id,
          ),
          [expected[1]],
        );
      assert.deepEqual(await host.call("get-unread-count"), {
        success: true,
        count: 2,
      });
    });
  } finally {
    f.close();
  }
});

test("durable notice references survive database close/reopen and retain revocation/deletion checks", async () => {
  const fs = require("node:fs"),
    os = require("node:os");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cc-board-notice-"));
  const filename = path.join(folder, "notice.sqlite");
  const f = fixture(filename);
  try {
    await withHost(f, async () => {
      const { notificationId } = f.write(
        "mention-user",
        inputFor("mention-user"),
      );
      f.reopen();
      f.state.actor = "did:member";
      const host = notificationHost(f);
      assert.equal(
        (await host.call("open-task", notificationId)).success,
        true,
      );
      assert.equal(
        (await host.call("mark-read", notificationId)).success,
        true,
      );
      f.reopen();
      assert.equal((await host.call("get-tasks")).notifications[0].is_read, 1);
      f.native.exec("DELETE FROM team_tasks WHERE id='task-1'");
      f.reopen();
      assert.equal(
        (await host.call("open-task", notificationId)).success,
        false,
      );
      assert.equal((await host.call("get-tasks")).notifications.length, 0);
    });
  } finally {
    f.close();
    fs.unlinkSync(filename);
    fs.rmdirSync(folder);
  }
});

test("notification host invalidation during acknowledgment prevents persistence and suppresses late source results", async () => {
  for (const change of ["session", "actor", "frame", "database"]) {
    const f = fixture();
    try {
      await withHost(f, async () => {
        const { notificationId } = f.write(
          "mention-user",
          inputFor("mention-user"),
        );
        f.state.actor = "did:member";
        const host = notificationHost(f);
        const before = snapshot(f);
        f.state.beforeRun = (sql) => {
          if (!/UPDATE notifications SET is_read/.test(sql)) return;
          if (change === "session") f.state.generation++;
          if (change === "actor") f.state.actor = "did:owner";
          if (change === "frame")
            f.event.senderFrame = { url: "file:///elsewhere" };
          if (change === "database") f.wrapper.current = {};
        };
        await assert.rejects(
          host.call("mark-read", notificationId),
          /NOTIFICATION_(AUTHENTICATION|WINDOW|DATABASE)_CHANGED/,
        );
        assert.deepEqual(snapshot(f), before, change);
      });
    } finally {
      f.close();
    }
  }
});

test("sandboxed preload methods and exact generic capabilities reach the governed native handlers", async () => {
  const f = fixture();
  try {
    addPeer(f);
    await withHost(f, async (handlers) => {
      const exposed = {};
      const calls = [];
      const notifications = notificationHost(f, handlers);
      const ipcRenderer = {
        invoke(channel, ...args) {
          calls.push(channel);
          assert.ok(handlers.has(channel), channel);
          return handlers.get(channel)(
            f.event,
            ...args.map((value) =>
              value === undefined
                ? undefined
                : JSON.parse(JSON.stringify(value)),
            ),
          );
        },
      };
      const electron = {
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld(name, value) {
            exposed[name] = value;
          },
        },
        desktopCapturer: {},
      };
      const source = readFileSync(
        path.resolve(__dirname, "../../../preload/index.js"),
        "utf8",
      );
      require("node:vm").runInNewContext(source, {
        require(name) {
          assert.equal(name, "electron");
          return electron;
        },
        console: { log() {}, info() {}, warn() {}, error() {} },
      });
      const methods = [
        ["addLabel", "add-label"],
        ["linkTasks", "link-tasks"],
        ["createSubtask", "create-subtask"],
        ["convertToSubtask", "convert-to-subtask"],
        ["toggleChecklistItem", "toggle-checklist-item"],
        ["reorderChecklist", "reorder-checklist"],
        ["deleteChecklistItem", "delete-checklist-item"],
        ["editComment", "edit-comment"],
        ["updateComment", "edit-comment"],
        ["deleteComment", "delete-comment"],
        ["mentionUser", "mention-user"],
      ];
      for (const [method, action] of methods) {
        if (action === "create-subtask") {
          await assert.rejects(
            exposed.electronAPI.task[method](inputFor(action)),
            { code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED" },
          );
          continue;
        }
        assert.equal(
          (await exposed.electronAPI.task[method](inputFor(action))).success,
          true,
          method,
        );
      }
      const activity = await exposed.electronAPI.task.getActivity({
        taskId: "task-1",
      });
      assert.ok(activity.length > 0);
      const manifest = JSON.parse(
        readFileSync(
          path.resolve(
            __dirname,
            "../../../preload/renderer-ipc-capabilities.json",
          ),
          "utf8",
        ),
      );
      for (const action of LOCAL_ADJUNCT_ACTIONS.filter(
        (action) => action !== "create-subtask",
      ))
        assert.ok(manifest.channels.includes(`task:${action}`), action);
      assert.equal(
        (
          await exposed.electronAPI.invoke(
            "task:add-label",
            inputFor("add-label"),
          )
        ).added,
        false,
      );
      assert.throws(
        () =>
          exposed.electronAPI.invoke(
            "task:update-comment",
            inputFor("edit-comment"),
          ),
        { code: "RENDERER_IPC_CAPABILITY_DENIED" },
      );
      assert.throws(
        () =>
          exposed.electronAPI.invoke(
            "task:force-delete-comment",
            inputFor("delete-comment"),
          ),
        { code: "RENDERER_IPC_CAPABILITY_DENIED" },
      );
      const before = calls.length;
      assert.throws(() => exposed.electronAPI.invoke("attacker:anything", {}), {
        code: "RENDERER_IPC_CAPABILITY_DENIED",
      });
      assert.equal(calls.length, before);
      f.state.actor = "did:member";
      const taskNotices = await exposed.electronAPI.notification.getTasks({
        limit: 50,
      });
      assert.equal(taskNotices.notifications.length, 1);
      const noticeId = taskNotices.notifications[0].id;
      assert.equal(
        (await exposed.electronAPI.notification.openTask(noticeId)).target
          .taskId,
        "task-1",
      );
      assert.equal(
        (await exposed.electronAPI.notification.markRead(noticeId)).success,
        true,
      );
      assert.equal(
        (await exposed.electronAPI.notification.getUnreadCount()).count,
        0,
      );
      assert.ok(manifest.channels.includes("notification:get-tasks"));
      assert.ok(manifest.channels.includes("notification:open-task"));
      assert.ok(manifest.channels.includes("task:mention-user"));
      assert.deepEqual(notifications.shown, []);
      f.state.actor = "did:outsider";
      await assert.rejects(
        exposed.electronAPI.task.addLabel(inputFor("add-label")),
        /BOARD_WRITE_NOT_FOUND_OR_DENIED/,
      );
    });
  } finally {
    f.close();
  }
});
