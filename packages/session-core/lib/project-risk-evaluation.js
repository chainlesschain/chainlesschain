"use strict";

/**
 * Deterministic, offline evaluation of an explicitly complete risk snapshot.
 *
 * A snapshot is a selected-field projection, not an authorized database read.
 * Its content-versioned references deliberately have risk-specific source
 * kinds: they must not be used as full database row revisions for actions.
 * No rule here approves, executes, predicts delivery, or labels a project safe.
 */
const crypto = require("node:crypto");
const { isProxy } = require("node:util").types;
const {
  createBusinessObjectRef,
  digestBusinessObjectContent,
} = require("./business-object-contract");

const PROJECT_RISK_SCHEMA = "chainlesschain.project-risk-evaluation/v1";
const PROJECT_RISK_RULE_VERSION = "project-risk/v1";
const PROJECT_RISK_LIMITS = Object.freeze({
  tasks: 1000,
  dependenciesPerTask: 1000,
  dependencyEdges: 10000,
  inputBytes: 2097152,
});
const PROJECT_RISK_SOURCE_SCHEMAS = Object.freeze({
  "desktop.project-tasks/v1": Object.freeze([
    "pending",
    "running",
    "completed",
    "failed",
  ]),
  "desktop.task-manager/v1": Object.freeze([
    "pending",
    "in_progress",
    "completed",
    "cancelled",
  ]),
});
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;
const MAX_TIMESTAMP = 253402300799999; // 9999-12-31T23:59:59.999Z

class InvalidSnapshot extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function reject(code) {
  throw new InvalidSnapshot(code);
}

function immutable(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

// Read only plain data descriptors. Rejected accessors, proxies and serializers
// are never invoked, even for a malformed snapshot that will not be evaluated.
function snapshotCopy(input) {
  let bytes = 0;
  let nodes = 0;
  const ancestors = new Set();
  function copy(value, depth) {
    if (++nodes > 50000 || depth > 8) reject("INPUT_BOUNDS_EXCEEDED");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value, "utf8");
      if (bytes > PROJECT_RISK_LIMITS.inputBytes)
        reject("INPUT_BOUNDS_EXCEEDED");
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || isProxy(value))
      reject("INVALID_SNAPSHOT");
    const array = Array.isArray(value);
    if (
      !array &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      reject("INVALID_SNAPSHOT");
    if (ancestors.has(value)) reject("INVALID_SNAPSHOT");
    const keys = Reflect.ownKeys(value);
    if (keys.length > 10001) reject("INPUT_BOUNDS_EXCEEDED");
    if (array && keys.length !== value.length + 1) reject("INVALID_SNAPSHOT");
    ancestors.add(value);
    const result = array ? [] : Object.create(null);
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        (array && !/^(0|[1-9][0-9]*)$/u.test(key))
      )
        reject("INVALID_SNAPSHOT");
      bytes += Buffer.byteLength(key, "utf8");
      if (bytes > PROJECT_RISK_LIMITS.inputBytes)
        reject("INPUT_BOUNDS_EXCEEDED");
      Object.defineProperty(result, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
      });
    }
    ancestors.delete(value);
    return result;
  }
  return copy(input, 0);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function inputDigest(snapshot) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(canonical(snapshot))
    .digest("hex")}`;
}

function fields(value, expected, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    reject(code);
}

function identifier(value) {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP;
}

function asOfInstant(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function normalize(snapshot) {
  fields(
    snapshot,
    ["sourceSchema", "readStatus", "asOf", "scope", "project", "tasks"],
    "INVALID_SNAPSHOT",
  );
  if (snapshot.readStatus !== "complete") reject("READ_NOT_COMPLETE");
  if (!asOfInstant(snapshot.asOf)) reject("INVALID_AS_OF");
  if (!Object.hasOwn(PROJECT_RISK_SOURCE_SCHEMAS, snapshot.sourceSchema))
    reject("UNSUPPORTED_SOURCE_SCHEMA");
  fields(snapshot.scope, ["kind", "id"], "INVALID_SCOPE");
  if (
    !["personal", "team", "organization"].includes(snapshot.scope.kind) ||
    !identifier(snapshot.scope.id)
  )
    reject("INVALID_SCOPE");
  fields(snapshot.project, ["id", "status", "updated_at"], "INVALID_PROJECT");
  if (!identifier(snapshot.project.id)) reject("INVALID_PROJECT");
  if (
    !["draft", "active", "completed", "archived"].includes(
      snapshot.project.status,
    )
  )
    reject("UNKNOWN_PROJECT_STATUS");
  if (!timestamp(snapshot.project.updated_at)) reject("INVALID_PROJECT_DATE");
  if (snapshot.project.updated_at > Date.parse(snapshot.asOf))
    reject("SNAPSHOT_AFTER_AS_OF");
  if (!Array.isArray(snapshot.tasks)) reject("INVALID_TASKS");
  if (snapshot.tasks.length > PROJECT_RISK_LIMITS.tasks)
    reject("TASK_LIMIT_EXCEEDED");
  const ids = new Set();
  let edges = 0;
  const tasks = snapshot.tasks.map((task) => {
    fields(
      task,
      ["id", "project_id", "status", "due_date", "blocked_by", "updated_at"],
      "INVALID_TASK",
    );
    if (!identifier(task.id) || !identifier(task.project_id))
      reject("INVALID_TASK");
    if (task.project_id !== snapshot.project.id) reject("CROSS_PROJECT_TASK");
    if (ids.has(task.id)) reject("DUPLICATE_TASK");
    ids.add(task.id);
    if (
      !PROJECT_RISK_SOURCE_SCHEMAS[snapshot.sourceSchema].includes(task.status)
    )
      reject("UNKNOWN_TASK_STATUS");
    if (
      !timestamp(task.updated_at) ||
      !(task.due_date === null || timestamp(task.due_date))
    )
      reject("INVALID_TASK_DATE");
    if (task.updated_at > Date.parse(snapshot.asOf))
      reject("SNAPSHOT_AFTER_AS_OF");
    let dependencies = task.blocked_by;
    if (typeof dependencies === "string") {
      try {
        dependencies = JSON.parse(dependencies);
      } catch {
        reject("INVALID_DEPENDENCIES");
      }
    }
    if (
      !Array.isArray(dependencies) ||
      dependencies.length > PROJECT_RISK_LIMITS.dependenciesPerTask ||
      dependencies.some((id) => !identifier(id)) ||
      new Set(dependencies).size !== dependencies.length
    )
      reject("INVALID_DEPENDENCIES");
    if (dependencies.includes(task.id)) reject("SELF_DEPENDENCY");
    edges += dependencies.length;
    if (edges > PROJECT_RISK_LIMITS.dependencyEdges)
      reject("DEPENDENCY_LIMIT_EXCEEDED");
    return { ...task, blocked_by: [...dependencies].sort() };
  });
  for (const task of tasks) {
    if (task.blocked_by.some((id) => !ids.has(id)))
      reject("MISSING_DEPENDENCY");
  }
  return {
    ...snapshot,
    tasks: tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

function riskRef(type, row, snapshot) {
  // Bind the explicit source schema too: the two task models are not aliases.
  return createBusinessObjectRef({
    type,
    id: row.id,
    sourceKind:
      type === "Project"
        ? "desktop.project-risk-project"
        : "desktop.project-risk-task",
    scope: snapshot.scope,
    version: digestBusinessObjectContent({
      sourceSchema: snapshot.sourceSchema,
      rowDigest: inputDigest(row),
    }),
  });
}

/**
 * Required input keys: sourceSchema, readStatus, asOf, scope, project, tasks.
 * project: {id,status,updated_at}; task:
 * {id,project_id,status,due_date,blocked_by,updated_at}. Dates in rows are epoch
 * milliseconds; due_date may be null, blocked_by is an array or JSON array.
 * asOf is canonical UTC ISO with milliseconds. Rows newer than it are rejected.
 * readStatus='complete' must be established by the caller, never inferred from
 * an empty/fallback query result. Unknown values fail closed without signals.
 */
function evaluateProjectRiskSnapshot(input) {
  const result = {
    schema: PROJECT_RISK_SCHEMA,
    ruleVersion: PROJECT_RISK_RULE_VERSION,
    status: "insufficient-data",
    sourceSchema: null,
    asOf: null,
    inputDigest: null,
    projectRef: null,
    taskRefs: [],
    reasonCodes: [],
    tasks: [],
    summary: null,
  };
  try {
    const copied = snapshotCopy(input);
    result.inputDigest = inputDigest(copied);
    if (copied && typeof copied === "object") {
      if (asOfInstant(copied.asOf)) result.asOf = copied.asOf;
      if (Object.hasOwn(PROJECT_RISK_SOURCE_SCHEMAS, copied.sourceSchema))
        result.sourceSchema = copied.sourceSchema;
    }
    const snapshot = normalize(copied);
    result.inputDigest = inputDigest(snapshot);
    result.projectRef = riskRef("Project", snapshot.project, snapshot);
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
    const refs = new Map(
      snapshot.tasks.map((task) => [task.id, riskRef("Task", task, snapshot)]),
    );
    result.taskRefs = [...refs.values()];
    let overdue = 0;
    let blocked = 0;
    let unresolved = 0;
    for (const task of snapshot.tasks) {
      if (["completed", "cancelled"].includes(task.status)) continue;
      unresolved++;
      const reasonCodes = [];
      if (task.due_date !== null && task.due_date < Date.parse(snapshot.asOf)) {
        reasonCodes.push("OVERDUE_INCOMPLETE_TASK");
        overdue++;
      }
      // A cancelled dependency did not complete the prerequisite. Only direct
      // dependencies are evaluated; no transitive or probabilistic inference.
      const blockingTaskRefs = task.blocked_by
        .filter((id) => byId.get(id).status !== "completed")
        .map((id) => refs.get(id));
      if (blockingTaskRefs.length > 0) {
        reasonCodes.push("BLOCKED_BY_INCOMPLETE_DEPENDENCY");
        blocked++;
      }
      if (reasonCodes.length > 0)
        result.tasks.push({
          taskRef: refs.get(task.id),
          dueDate: task.due_date,
          reasonCodes,
          blockingTaskRefs,
        });
    }
    result.reasonCodes = [
      ...(overdue > 0 ? ["OVERDUE_INCOMPLETE_TASK"] : []),
      ...(blocked > 0 ? ["BLOCKED_BY_INCOMPLETE_DEPENDENCY"] : []),
    ];
    result.summary = {
      taskCount: snapshot.tasks.length,
      unresolvedTaskCount: unresolved,
      riskTaskCount: result.tasks.length,
      overdueTaskCount: overdue,
      blockedTaskCount: blocked,
    };
    result.status = "evaluated";
  } catch (error) {
    result.reasonCodes = [
      error instanceof InvalidSnapshot ? error.code : "INVALID_SNAPSHOT",
    ];
    result.projectRef = null;
    result.taskRefs = [];
    result.tasks = [];
    result.summary = null;
  }
  return immutable(result);
}

module.exports = {
  PROJECT_RISK_SCHEMA,
  PROJECT_RISK_RULE_VERSION,
  PROJECT_RISK_LIMITS,
  PROJECT_RISK_SOURCE_SCHEMAS,
  evaluateProjectRiskSnapshot,
};
