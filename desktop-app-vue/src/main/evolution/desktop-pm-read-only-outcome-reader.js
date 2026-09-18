"use strict";

const { createHash } = require("node:crypto");
const path = require("node:path");
const { types } = require("util");

const OUTCOME_QUERY_SCHEMA =
  "chainlesschain.pm-exploration-read-only-outcome-query/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PROTOCOL_ID = /^[a-z][a-z0-9]*(?:[._:@/-][a-z0-9]+)*$/u;
const MAX_BINDINGS = 1024;
const MAX_ENTITY_ROWS = 20_001;

const PROJECT_SQL = `
  SELECT id, name, status, deleted
  FROM projects
  WHERE id = ?
  LIMIT 1
`;

// One compound SELECT gives the grader a single SQLite statement snapshot.
// MAX_ENTITY_ROWS + 1 lets the reader distinguish an allowed maximum from a
// truncated result without loading an unbounded board into memory.
const BOARD_SQL = `
  SELECT 'board' AS entity_type, id
  FROM task_boards
  WHERE id = ?
  UNION ALL
  SELECT 'task' AS entity_type, id
  FROM team_tasks
  WHERE board_id = ?
  UNION ALL
  SELECT 'sprint' AS entity_type, id
  FROM task_sprints
  WHERE board_id = ?
  ORDER BY entity_type ASC, id ASC
  LIMIT ${MAX_ENTITY_ROWS + 1}
`;

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function directFunction(value, label) {
  if (typeof value !== "function" || types.isProxy(value))
    throw new TypeError(`${label} must be a direct function`);
  return value;
}

function capturedMethod(owner, name, label) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner)) {
    throw new TypeError(`${label} owner is invalid`);
  }
  let current = owner;
  while (current && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) {
      if (
        !("value" in descriptor) ||
        typeof descriptor.value !== "function" ||
        types.isProxy(descriptor.value)
      ) {
        throw new TypeError(`${label} must be a direct function`);
      }
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  throw new TypeError(`${label} must be a direct function`);
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function normalizedDatabasePath(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 32_768 ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  ) {
    throw new TypeError("Desktop PM database path must be absolute");
  }
  return path.normalize(path.resolve(value));
}

function digestDesktopPmDatabasePath(value) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.desktop-pm-database-path/v1\0")
    .update(normalizedDatabasePath(value))
    .digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function bindingDigest(value) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.desktop-pm-outcome-binding/v1\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function protocolId(value, label) {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !PROTOCOL_ID.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function entityId(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value.trim() !== value ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function textValue(value, label, maximum = 65_536) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim().length === 0 ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function normalizeBinding(value, index) {
  const label = `Desktop PM outcome binding ${index}`;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (!kindDescriptor || !("value" in kindDescriptor))
    throw new TypeError(`${label}.kind must be plain data`);
  if (kindDescriptor.value === "project-state") {
    exact(value, ["taskId", "kind", "projectId"], label);
    return Object.freeze({
      taskId: protocolId(value.taskId, `${label}.taskId`),
      kind: value.kind,
      targetId: entityId(value.projectId, `${label}.projectId`),
    });
  }
  if (kindDescriptor.value === "board-export") {
    exact(value, ["taskId", "kind", "boardId"], label);
    return Object.freeze({
      taskId: protocolId(value.taskId, `${label}.taskId`),
      kind: value.kind,
      targetId: entityId(value.boardId, `${label}.boardId`),
    });
  }
  throw new TypeError(`${label}.kind is invalid`);
}

function normalizeBindings(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > MAX_BINDINGS ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError("Desktop PM outcome bindings must be a dense array");
  }
  const bindings = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        "Desktop PM outcome bindings cannot contain holes or accessors",
      );
    }
    bindings.push(normalizeBinding(descriptor.value, index));
  }
  if (new Set(bindings.map((entry) => entry.taskId)).size !== bindings.length)
    throw new TypeError("Desktop PM outcome binding taskIds must be unique");
  return Object.freeze(bindings);
}

function assertQuery(value, planDigest, environmentDigest) {
  exact(
    value,
    [
      "schema",
      "planDigest",
      "environmentDigest",
      "sourceDigest",
      "roundId",
      "taskId",
      "executionRequestDigest",
      "executionReceiptDigest",
      "outputMemoryDigest",
      "traceDigest",
    ],
    "Desktop PM outcome query",
  );
  if (
    value.schema !== OUTCOME_QUERY_SCHEMA ||
    value.planDigest !== planDigest ||
    value.environmentDigest !== environmentDigest
  ) {
    throw new Error("Desktop PM outcome query differs from its binding");
  }
  protocolId(value.roundId, "roundId");
  protocolId(value.taskId, "taskId");
  for (const key of [
    "sourceDigest",
    "executionRequestDigest",
    "executionReceiptDigest",
    "outputMemoryDigest",
    "traceDigest",
  ]) {
    digest(value[key], key);
  }
}

function assertSignal(signal) {
  if (!(signal instanceof AbortSignal))
    throw new TypeError("Desktop PM outcome query requires an AbortSignal");
  if (signal.aborted) throw new Error("Desktop PM outcome query was aborted");
}

function databasePort(databaseProvider, identity, expectedPathDigest) {
  const manager = databaseProvider();
  if (!manager || typeof manager !== "object" || types.isProxy(manager))
    throw new TypeError("Desktop PM database manager is unavailable");
  const getDatabase = capturedMethod(
    manager,
    "getDatabase",
    "Desktop PM database getDatabase",
  );
  const getCurrentDatabasePath = capturedMethod(
    manager,
    "getCurrentDatabasePath",
    "Desktop PM database getCurrentDatabasePath",
  );
  const currentPath = Reflect.apply(getCurrentDatabasePath, manager, []);
  const currentPathDigest = digestDesktopPmDatabasePath(currentPath);
  if (currentPathDigest !== expectedPathDigest) {
    throw new Error("Desktop PM database path differs from its signed binding");
  }
  const database = Reflect.apply(getDatabase, manager, []);
  if (!database || typeof database !== "object" || types.isProxy(database))
    throw new TypeError("Desktop PM native database is unavailable");
  if (identity.manager === null) {
    identity.manager = manager;
    identity.database = database;
    identity.pathDigest = currentPathDigest;
  } else if (identity.manager !== manager || identity.database !== database) {
    throw new Error("Desktop PM database identity changed");
  } else if (identity.pathDigest !== currentPathDigest) {
    throw new Error("Desktop PM database path identity changed");
  }
  return Object.freeze({
    database,
    prepare: capturedMethod(database, "prepare", "Desktop PM database prepare"),
  });
}

function statementMethod(statement, name) {
  if (!statement || typeof statement !== "object" || types.isProxy(statement))
    throw new TypeError("Desktop PM database statement is invalid");
  return capturedMethod(
    statement,
    name,
    `Desktop PM database statement ${name}`,
  );
}

function readProject(
  databaseProvider,
  databaseIdentity,
  expectedPathDigest,
  binding,
  signal,
) {
  assertSignal(signal);
  const port = databasePort(
    databaseProvider,
    databaseIdentity,
    expectedPathDigest,
  );
  const statement = Reflect.apply(port.prepare, port.database, [PROJECT_SQL]);
  const row = Reflect.apply(statementMethod(statement, "get"), statement, [
    binding.targetId,
  ]);
  assertSignal(signal);
  if (row == null) return Object.freeze({ success: false });
  exact(row, ["id", "name", "status", "deleted"], "Desktop PM project row");
  if (row.deleted !== 0 && row.deleted !== false)
    return Object.freeze({ success: false });
  return Object.freeze({
    success: true,
    id: entityId(row.id, "project.id"),
    name: textValue(row.name, "project.name"),
    status: textValue(row.status, "project.status", 256),
  });
}

function readBoard(
  databaseProvider,
  databaseIdentity,
  expectedPathDigest,
  binding,
  signal,
) {
  assertSignal(signal);
  const port = databasePort(
    databaseProvider,
    databaseIdentity,
    expectedPathDigest,
  );
  const statement = Reflect.apply(port.prepare, port.database, [BOARD_SQL]);
  const rows = Reflect.apply(statementMethod(statement, "all"), statement, [
    binding.targetId,
    binding.targetId,
    binding.targetId,
  ]);
  assertSignal(signal);
  if (
    !Array.isArray(rows) ||
    types.isProxy(rows) ||
    Object.getPrototypeOf(rows) !== Array.prototype ||
    Reflect.ownKeys(rows).length !== rows.length + 1 ||
    rows.length > MAX_ENTITY_ROWS
  ) {
    throw new TypeError("Desktop PM board rows are invalid or oversized");
  }
  const grouped = { board: [], task: [], sprint: [] };
  for (let index = 0; index < rows.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, index);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        "Desktop PM board rows cannot contain holes or accessors",
      );
    }
    const row = descriptor.value;
    exact(row, ["entity_type", "id"], `Desktop PM board row ${index}`);
    if (!Object.hasOwn(grouped, row.entity_type))
      throw new TypeError("Desktop PM board row type is invalid");
    grouped[row.entity_type].push(
      Object.freeze({ id: entityId(row.id, "board entity id") }),
    );
  }
  if (grouped.board.length !== 1 || grouped.board[0].id !== binding.targetId) {
    return Object.freeze({ success: false });
  }
  return deepFreeze({
    success: true,
    board: grouped.board[0],
    tasks: grouped.task,
    sprints: grouped.sprint,
  });
}

function createDesktopPmReadOnlyOutcomeReaderFactory(databaseProvider) {
  directFunction(databaseProvider, "Desktop PM database provider");
  return function createDesktopPmReadOnlyOutcomeReader(options = {}) {
    exact(
      options,
      ["planDigest", "environmentDigest", "databasePathDigest", "bindings"],
      "Desktop PM read-only outcome reader options",
    );
    const planDigest = digest(options.planDigest, "planDigest");
    const environmentDigest = digest(
      options.environmentDigest,
      "environmentDigest",
    );
    const databasePathDigest = digest(
      options.databasePathDigest,
      "databasePathDigest",
    );
    const bindings = normalizeBindings(options.bindings);
    const byTaskId = new Map(
      bindings.map((binding) => [binding.taskId, binding]),
    );
    const readerBindingDigest = bindingDigest({
      planDigest,
      environmentDigest,
      databasePathDigest,
      bindings,
    });
    const databaseIdentity = { manager: null, database: null };
    const resolve = (query, signal, expectedKind) => {
      assertQuery(query, planDigest, environmentDigest);
      const binding = byTaskId.get(query.taskId);
      if (!binding || binding.kind !== expectedKind)
        throw new Error("Desktop PM outcome task is outside its binding");
      return binding;
    };
    return Object.freeze({
      bindingDigest: readerBindingDigest,
      readProjectState: async (query, signal) =>
        readProject(
          databaseProvider,
          databaseIdentity,
          databasePathDigest,
          resolve(query, signal, "project-state"),
          signal,
        ),
      readBoardExport: async (query, signal) =>
        readBoard(
          databaseProvider,
          databaseIdentity,
          databasePathDigest,
          resolve(query, signal, "board-export"),
          signal,
        ),
    });
  };
}

const createDesktopPmReadOnlyOutcomeReader =
  createDesktopPmReadOnlyOutcomeReaderFactory(() => {
    const { getDatabase } = require("../database.js");
    return getDatabase();
  });

module.exports = {
  BOARD_SQL,
  PROJECT_SQL,
  createDesktopPmReadOnlyOutcomeReader,
  createDesktopPmReadOnlyOutcomeReaderFactory,
  digestDesktopPmDatabasePath,
};
