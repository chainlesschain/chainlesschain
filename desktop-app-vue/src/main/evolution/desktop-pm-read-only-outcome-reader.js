"use strict";

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

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
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
  const bindings = value.map((entry, index) => {
    if (!Object.hasOwn(value, index))
      throw new TypeError("Desktop PM outcome bindings cannot contain holes");
    return normalizeBinding(entry, index);
  });
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

function databasePort(databaseProvider, identity) {
  const manager = databaseProvider();
  if (!manager || typeof manager !== "object" || types.isProxy(manager))
    throw new TypeError("Desktop PM database manager is unavailable");
  const getDatabase = directFunction(
    manager.getDatabase,
    "Desktop PM database getDatabase",
  );
  const database = Reflect.apply(getDatabase, manager, []);
  if (!database || typeof database !== "object" || types.isProxy(database))
    throw new TypeError("Desktop PM native database is unavailable");
  if (identity.manager === null) {
    identity.manager = manager;
    identity.database = database;
  } else if (identity.manager !== manager || identity.database !== database) {
    throw new Error("Desktop PM database identity changed");
  }
  return Object.freeze({
    database,
    prepare: directFunction(database.prepare, "Desktop PM database prepare"),
  });
}

function statementMethod(statement, name) {
  if (!statement || typeof statement !== "object" || types.isProxy(statement))
    throw new TypeError("Desktop PM database statement is invalid");
  return directFunction(
    statement[name],
    `Desktop PM database statement ${name}`,
  );
}

function readProject(databaseProvider, databaseIdentity, binding, signal) {
  assertSignal(signal);
  const port = databasePort(databaseProvider, databaseIdentity);
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

function readBoard(databaseProvider, databaseIdentity, binding, signal) {
  assertSignal(signal);
  const port = databasePort(databaseProvider, databaseIdentity);
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
    if (!Object.hasOwn(rows, index))
      throw new TypeError("Desktop PM board rows cannot contain holes");
    const row = rows[index];
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
      ["planDigest", "environmentDigest", "bindings"],
      "Desktop PM read-only outcome reader options",
    );
    const planDigest = digest(options.planDigest, "planDigest");
    const environmentDigest = digest(
      options.environmentDigest,
      "environmentDigest",
    );
    const bindings = normalizeBindings(options.bindings);
    const byTaskId = new Map(
      bindings.map((binding) => [binding.taskId, binding]),
    );
    const databaseIdentity = { manager: null, database: null };
    const resolve = (query, signal, expectedKind) => {
      assertQuery(query, planDigest, environmentDigest);
      const binding = byTaskId.get(query.taskId);
      if (!binding || binding.kind !== expectedKind)
        throw new Error("Desktop PM outcome task is outside its binding");
      return binding;
    };
    return Object.freeze({
      readProjectState: async (query, signal) =>
        readProject(
          databaseProvider,
          databaseIdentity,
          resolve(query, signal, "project-state"),
          signal,
        ),
      readBoardExport: async (query, signal) =>
        readBoard(
          databaseProvider,
          databaseIdentity,
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
};
