import { createHash } from "node:crypto";

export const WORKFLOW_DEFINITION_SCHEMA = "cc-dynamic-workflow-definition/v1";
export const COWORK_WORKFLOW_RECORD_SCHEMA = "cc-cowork-workflow-record/v1";
export const MAX_WORKFLOW_DEFINITION_BYTES = 1024 * 1024;

function stableJsonValue(value, state = { nodes: 0, depth: 0 }) {
  state.nodes += 1;
  if (state.nodes > 20_000 || state.depth > 32) {
    throw new TypeError("workflow definition exceeds canonicalization limits");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("workflow definition contains a non-finite number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    const childState = { ...state, depth: state.depth + 1 };
    const output = value.map((item) => stableJsonValue(item, childState));
    state.nodes = childState.nodes;
    return output;
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "workflow definition must contain plain JSON objects",
      );
    }
    const childState = { ...state, depth: state.depth + 1 };
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) continue;
      if (["function", "symbol", "bigint"].includes(typeof child)) {
        throw new TypeError("workflow definition contains a non-JSON value");
      }
      output[key] = stableJsonValue(child, childState);
    }
    state.nodes = childState.nodes;
    return output;
  }
  throw new TypeError("workflow definition contains a non-JSON value");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function digestDefinition(definition) {
  const canonical = JSON.stringify(definition);
  if (Buffer.byteLength(canonical, "utf8") > MAX_WORKFLOW_DEFINITION_BYTES) {
    throw new TypeError(
      `workflow definition exceeds ${MAX_WORKFLOW_DEFINITION_BYTES} bytes`,
    );
  }
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function integrityError(message) {
  const error = new Error(message);
  error.code = "WORKFLOW_DEFINITION_INTEGRITY";
  return error;
}

export function normalizeWorkflowDefinitionDigest(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^sha256:[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

export function createWorkflowDefinitionAuthority(workflow) {
  const definition = deepFreeze(stableJsonValue(workflow));
  return Object.freeze({
    schema: WORKFLOW_DEFINITION_SCHEMA,
    definitionDigest: digestDefinition(definition),
    definition,
  });
}

export function createCoworkWorkflowRecord(workflow) {
  const authority = createWorkflowDefinitionAuthority(workflow);
  const record = {
    schema: COWORK_WORKFLOW_RECORD_SCHEMA,
    definitionSchema: authority.schema,
    definitionDigest: authority.definitionDigest,
    definition: authority.definition,
  };
  const serialized = JSON.stringify(record, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAX_WORKFLOW_DEFINITION_BYTES) {
    throw new TypeError(
      `workflow definition exceeds ${MAX_WORKFLOW_DEFINITION_BYTES} bytes`,
    );
  }
  return Object.freeze(record);
}

export function verifyCoworkWorkflowRecord(value, options = {}) {
  if (
    value?.schema !== COWORK_WORKFLOW_RECORD_SCHEMA &&
    options.allowLegacy === true
  ) {
    const authority = createWorkflowDefinitionAuthority(value);
    return Object.freeze({
      status: "legacy-unversioned",
      recordSchema: null,
      definitionSchema: authority.schema,
      definitionDigest: authority.definitionDigest,
      definition: authority.definition,
    });
  }
  if (!value || value.schema !== COWORK_WORKFLOW_RECORD_SCHEMA) {
    throw integrityError(
      `workflow record must use ${COWORK_WORKFLOW_RECORD_SCHEMA}`,
    );
  }
  if (value.definitionSchema !== WORKFLOW_DEFINITION_SCHEMA) {
    throw integrityError("workflow definition schema is unsupported");
  }
  const declaredDigest = normalizeWorkflowDefinitionDigest(
    value.definitionDigest,
  );
  if (!declaredDigest) {
    throw integrityError("workflow definition digest is invalid");
  }
  const authority = createWorkflowDefinitionAuthority(value.definition);
  if (authority.definitionDigest !== declaredDigest) {
    throw integrityError("workflow definition digest mismatch");
  }
  return Object.freeze({
    status: "versioned",
    recordSchema: COWORK_WORKFLOW_RECORD_SCHEMA,
    definitionSchema: authority.schema,
    definitionDigest: authority.definitionDigest,
    definition: authority.definition,
  });
}
