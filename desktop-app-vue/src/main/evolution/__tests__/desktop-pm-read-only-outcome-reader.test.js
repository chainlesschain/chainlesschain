import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const {
  BOARD_SQL,
  PROJECT_SQL,
  createDesktopPmReadOnlyOutcomeReaderFactory,
  digestDesktopPmDatabasePath,
} = require("../desktop-pm-read-only-outcome-reader");
const requireFromHere = createRequire(import.meta.url);

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function query(overrides = {}) {
  return {
    schema: "chainlesschain.pm-exploration-read-only-outcome-query/v1",
    planDigest: sha("plan"),
    environmentDigest: sha("environment"),
    sourceDigest: sha("source"),
    roundId: "round-one",
    taskId: "task-one",
    executionRequestDigest: sha("execution-request"),
    executionReceiptDigest: sha("execution-receipt"),
    outputMemoryDigest: sha("output-memory"),
    traceDigest: sha("trace"),
    ...overrides,
  };
}

function fixture({ projectRow = null, boardRows = [], databasePath } = {}) {
  const projectGet = vi.fn(() => projectRow);
  const boardAll = vi.fn(() => boardRows);
  const prepare = vi.fn((sql) => {
    if (sql === PROJECT_SQL) return { get: projectGet };
    if (sql === BOARD_SQL) return { all: boardAll };
    throw new Error("unexpected SQL");
  });
  const database = { prepare };
  const getDatabase = vi.fn(() => database);
  const currentDatabasePath =
    databasePath ?? path.resolve(process.cwd(), "pm-reader-fixture.db");
  const getCurrentDatabasePath = vi.fn(() => currentDatabasePath);
  const manager = { getDatabase, getCurrentDatabasePath };
  const databaseProvider = vi.fn(() => manager);
  const createReader =
    createDesktopPmReadOnlyOutcomeReaderFactory(databaseProvider);
  return {
    boardAll,
    createReader,
    database,
    databaseProvider,
    getDatabase,
    getCurrentDatabasePath,
    manager,
    prepare,
    projectGet,
    databasePath: currentDatabasePath,
  };
}

function reader(createReader, bindings, databasePath) {
  return createReader({
    planDigest: sha("plan"),
    environmentDigest: sha("environment"),
    databasePathDigest: digestDesktopPmDatabasePath(
      databasePath ?? path.resolve(process.cwd(), "pm-reader-fixture.db"),
    ),
    bindings,
  });
}

describe("Desktop PM read-only outcome reader", () => {
  it("reads the real Desktop tables through a query-only SQLite connection", async () => {
    const BetterSqlite3 = requireFromHere("better-sqlite3");
    const directory = mkdtempSync(path.join(tmpdir(), "cc-pm-reader-"));
    const databasePath = path.join(directory, "isolated-clone.db");
    const database = new BetterSqlite3(databasePath);
    try {
      database.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE task_boards (id TEXT PRIMARY KEY);
        CREATE TABLE team_tasks (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL
        );
        CREATE TABLE task_sprints (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL
        );
      `);
      database
        .prepare("INSERT INTO projects VALUES (?, ?, ?, ?)")
        .run("1-project-uuid", "Real project", "active", 0);
      database
        .prepare("INSERT INTO task_boards VALUES (?)")
        .run("2-board-uuid");
      database
        .prepare("INSERT INTO team_tasks VALUES (?, ?)")
        .run("3-task-uuid", "2-board-uuid");
      database
        .prepare("INSERT INTO task_sprints VALUES (?, ?)")
        .run("4-sprint-uuid", "2-board-uuid");
      database.pragma("query_only = ON");
      const manager = {
        getDatabase: () => database,
        getCurrentDatabasePath: () => databasePath,
      };
      const createReader = createDesktopPmReadOnlyOutcomeReaderFactory(
        () => manager,
      );
      const outcomeReader = reader(
        createReader,
        [
          {
            taskId: "task-project",
            kind: "project-state",
            projectId: "1-project-uuid",
          },
          {
            taskId: "task-board",
            kind: "board-export",
            boardId: "2-board-uuid",
          },
        ],
        databasePath,
      );

      await expect(
        outcomeReader.readProjectState(
          query({ taskId: "task-project" }),
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        success: true,
        id: "1-project-uuid",
        name: "Real project",
        status: "active",
      });
      await expect(
        outcomeReader.readBoardExport(
          query({ taskId: "task-board" }),
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        success: true,
        board: { id: "2-board-uuid" },
        tasks: [{ id: "3-task-uuid" }],
        sprints: [{ id: "4-sprint-uuid" }],
      });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads an exact project projection from the initialized Desktop database", async () => {
    const targetId = "1f3a-project-uuid";
    const test = fixture({
      projectRow: {
        id: targetId,
        name: "Release plan",
        status: "active",
        deleted: 0,
      },
    });
    const outcomeReader = reader(test.createReader, [
      { taskId: "task-one", kind: "project-state", projectId: targetId },
    ]);

    const result = await outcomeReader.readProjectState(
      query(),
      new AbortController().signal,
    );

    expect(result).toEqual({
      success: true,
      id: targetId,
      name: "Release plan",
      status: "active",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(test.prepare).toHaveBeenCalledOnce();
    expect(test.prepare).toHaveBeenCalledWith(PROJECT_SQL);
    expect(test.projectGet).toHaveBeenCalledWith(targetId);
    expect(PROJECT_SQL.trimStart()).toMatch(/^SELECT\b/u);
  });

  it("reads board, task and sprint IDs with one compound SELECT snapshot", async () => {
    const boardId = "2-board-uuid";
    const test = fixture({
      boardRows: [
        { entity_type: "board", id: boardId },
        { entity_type: "sprint", id: "3-sprint-uuid" },
        { entity_type: "task", id: "4-task-uuid" },
        { entity_type: "task", id: "5-task-uuid" },
      ],
    });
    const outcomeReader = reader(test.createReader, [
      { taskId: "task-one", kind: "board-export", boardId },
    ]);

    const result = await outcomeReader.readBoardExport(
      query(),
      new AbortController().signal,
    );

    expect(result).toEqual({
      success: true,
      board: { id: boardId },
      tasks: [{ id: "4-task-uuid" }, { id: "5-task-uuid" }],
      sprints: [{ id: "3-sprint-uuid" }],
    });
    expect(Object.isFrozen(result.tasks)).toBe(true);
    expect(test.prepare).toHaveBeenCalledOnce();
    expect(test.prepare).toHaveBeenCalledWith(BOARD_SQL);
    expect(test.boardAll).toHaveBeenCalledWith(boardId, boardId, boardId);
    expect(BOARD_SQL.trimStart()).toMatch(/^SELECT\b/u);
    expect(BOARD_SQL).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu);
  });

  it("returns a failed observation for missing, deleted or orphaned targets", async () => {
    const missing = fixture();
    const missingReader = reader(missing.createReader, [
      {
        taskId: "task-one",
        kind: "project-state",
        projectId: "project-missing",
      },
    ]);
    await expect(
      missingReader.readProjectState(query(), new AbortController().signal),
    ).resolves.toEqual({ success: false });

    const deleted = fixture({
      projectRow: {
        id: "project-deleted",
        name: "Deleted",
        status: "archived",
        deleted: 1,
      },
    });
    const deletedReader = reader(deleted.createReader, [
      {
        taskId: "task-one",
        kind: "project-state",
        projectId: "project-deleted",
      },
    ]);
    await expect(
      deletedReader.readProjectState(query(), new AbortController().signal),
    ).resolves.toEqual({ success: false });

    const orphaned = fixture({
      boardRows: [{ entity_type: "task", id: "task-orphaned" }],
    });
    const orphanedReader = reader(orphaned.createReader, [
      {
        taskId: "task-one",
        kind: "board-export",
        boardId: "board-missing",
      },
    ]);
    await expect(
      orphanedReader.readBoardExport(query(), new AbortController().signal),
    ).resolves.toEqual({ success: false });
  });

  it("rejects cross-plan, cross-kind and unregistered task reads before SQL", async () => {
    const test = fixture();
    const outcomeReader = reader(test.createReader, [
      {
        taskId: "task-one",
        kind: "project-state",
        projectId: "project-one",
      },
    ]);
    const signal = new AbortController().signal;

    await expect(
      outcomeReader.readProjectState(
        query({ planDigest: sha("other-plan") }),
        signal,
      ),
    ).rejects.toThrow("differs from its binding");
    await expect(
      outcomeReader.readBoardExport(query(), signal),
    ).rejects.toThrow("outside its binding");
    await expect(
      outcomeReader.readProjectState(query({ taskId: "task-other" }), signal),
    ).rejects.toThrow("outside its binding");
    expect(test.databaseProvider).not.toHaveBeenCalled();
  });

  it("honors cancellation before resolving the database", async () => {
    const test = fixture();
    const outcomeReader = reader(test.createReader, [
      {
        taskId: "task-one",
        kind: "project-state",
        projectId: "project-one",
      },
    ]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      outcomeReader.readProjectState(query(), controller.signal),
    ).rejects.toThrow("aborted");
    expect(test.databaseProvider).not.toHaveBeenCalled();
  });

  it("rejects a database outside the signed path binding before SQL", async () => {
    const test = fixture();
    const outcomeReader = reader(
      test.createReader,
      [
        {
          taskId: "task-one",
          kind: "project-state",
          projectId: "project-one",
        },
      ],
      path.resolve(process.cwd(), "different-clone.db"),
    );

    await expect(
      outcomeReader.readProjectState(query(), new AbortController().signal),
    ).rejects.toThrow("differs from its signed binding");
    expect(test.getDatabase).not.toHaveBeenCalled();
    expect(test.prepare).not.toHaveBeenCalled();
  });

  it("fails closed if the active Desktop database is substituted between rounds", async () => {
    const first = fixture({
      projectRow: {
        id: "project-one",
        name: "First",
        status: "active",
        deleted: 0,
      },
    });
    const second = fixture({
      projectRow: {
        id: "project-one",
        name: "Substituted",
        status: "active",
        deleted: 0,
      },
    });
    const databaseProvider = vi
      .fn()
      .mockReturnValueOnce(first.manager)
      .mockReturnValue(second.manager);
    const createReader =
      createDesktopPmReadOnlyOutcomeReaderFactory(databaseProvider);
    const outcomeReader = reader(createReader, [
      {
        taskId: "task-one",
        kind: "project-state",
        projectId: "project-one",
      },
    ]);

    await expect(
      outcomeReader.readProjectState(query(), new AbortController().signal),
    ).resolves.toMatchObject({ name: "First" });
    await expect(
      outcomeReader.readProjectState(
        query({ roundId: "round-two" }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("identity changed");
    expect(second.prepare).not.toHaveBeenCalled();
  });

  it("fails closed if the bound manager reports a different database path", async () => {
    const projectRow = {
      id: "project-one",
      name: "Bound clone",
      status: "active",
      deleted: 0,
    };
    const projectGet = vi.fn(() => projectRow);
    const prepare = vi.fn(() => ({ get: projectGet }));
    const database = { prepare };
    const boundPath = path.resolve(process.cwd(), "bound-clone.db");
    let currentPath = boundPath;
    const manager = {
      getDatabase: () => database,
      getCurrentDatabasePath: () => currentPath,
    };
    const createReader = createDesktopPmReadOnlyOutcomeReaderFactory(
      () => manager,
    );
    const outcomeReader = reader(
      createReader,
      [
        {
          taskId: "task-one",
          kind: "project-state",
          projectId: "project-one",
        },
      ],
      boundPath,
    );

    await expect(
      outcomeReader.readProjectState(query(), new AbortController().signal),
    ).resolves.toMatchObject({ name: "Bound clone" });
    currentPath = path.resolve(process.cwd(), "substituted-clone.db");
    await expect(
      outcomeReader.readProjectState(
        query({ roundId: "round-two" }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("differs from its signed binding");
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("never invokes an accessor masquerading as a database path method", async () => {
    const getPath = vi.fn(() => path.resolve(process.cwd(), "clone.db"));
    const manager = { getDatabase: () => ({ prepare: vi.fn() }) };
    Object.defineProperty(manager, "getCurrentDatabasePath", {
      enumerable: true,
      get: getPath,
    });
    const createReader = createDesktopPmReadOnlyOutcomeReaderFactory(
      () => manager,
    );
    const outcomeReader = reader(createReader, [
      {
        taskId: "task-one",
        kind: "project-state",
        projectId: "project-one",
      },
    ]);

    await expect(
      outcomeReader.readProjectState(query(), new AbortController().signal),
    ).rejects.toThrow("must be a direct function");
    expect(getPath).not.toHaveBeenCalled();
  });

  it("commits the signed database path into the public reader binding", () => {
    const test = fixture();
    const bindings = [
      {
        taskId: "task-one",
        kind: "project-state",
        projectId: "project-one",
      },
    ];
    const first = reader(
      test.createReader,
      bindings,
      path.resolve(process.cwd(), "clone-one.db"),
    );
    const second = reader(
      test.createReader,
      bindings,
      path.resolve(process.cwd(), "clone-two.db"),
    );

    expect(first.bindingDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(second.bindingDigest).not.toBe(first.bindingDigest);
  });

  it("rejects duplicate, accessor and protocol-invalid bindings", () => {
    const test = fixture();
    const binding = {
      taskId: "task-one",
      kind: "project-state",
      projectId: "project-one",
    };
    expect(() => reader(test.createReader, [binding, { ...binding }])).toThrow(
      "unique",
    );
    expect(() =>
      reader(test.createReader, [
        { ...binding, taskId: "1-not-a-protocol-id" },
      ]),
    ).toThrow("taskId is invalid");

    const accessor = { taskId: "task-one", projectId: "project-one" };
    Object.defineProperty(accessor, "kind", {
      enumerable: true,
      get: () => "project-state",
    });
    expect(() => reader(test.createReader, [accessor])).toThrow("plain data");

    const getBinding = vi.fn(() => binding);
    const accessorArray = [];
    Object.defineProperty(accessorArray, 0, {
      enumerable: true,
      configurable: true,
      get: getBinding,
    });
    accessorArray.length = 1;
    expect(() => reader(test.createReader, accessorArray)).toThrow(
      "holes or accessors",
    );
    expect(getBinding).not.toHaveBeenCalled();
  });
});
