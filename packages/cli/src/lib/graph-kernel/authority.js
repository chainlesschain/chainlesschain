export const GRAPH_AUTHORITY_SCHEMA = "chainlesschain.graph-authority/v1";
export const GRAPH_PROJECTION_VERSION = 1;
export const GRAPH_AUTHORITY_MODES = Object.freeze([
  "legacy",
  "shadow",
  "canonical",
]);
export const GRAPH_CUTOVER_STAGES = Object.freeze([
  "legacy",
  "shadow",
  "canary",
  "canonical",
  "legacy_read_only",
]);

const AUTHORITY_SOURCES = new Set([
  "legacy_runtime",
  "graph_kernel_shadow",
  "graph_kernel",
]);

function authorityError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphAuthorityError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function identifier(value, label) {
  const output = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(output)) {
    throw authorityError("CC_GRAPH_AUTHORITY_INVALID", `${label} is invalid`, {
      field: label,
    });
  }
  return output;
}

function eventHead(value) {
  if (value == null) return null;
  const output = String(value);
  if (!/^sha256:[a-f0-9]{64}$/u.test(output)) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_INVALID",
      "eventHead must be a sha256 digest or null",
      { field: "eventHead" },
    );
  }
  return output;
}

function leaseExpiry(value) {
  if (value == null) return null;
  const output = String(value);
  const milliseconds = Date.parse(output);
  if (!Number.isFinite(milliseconds)) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_INVALID",
      "writerLeaseExpiresAt must be an ISO timestamp",
      { field: "writerLeaseExpiresAt" },
    );
  }
  return new Date(milliseconds).toISOString();
}

export function createGraphAuthorityBinding(input = {}) {
  const authorityMode = String(input.authorityMode || "").trim();
  if (!GRAPH_AUTHORITY_MODES.includes(authorityMode)) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_INVALID",
      "authorityMode must be legacy, shadow, or canonical",
      { field: "authorityMode" },
    );
  }
  const authoritySource = String(input.authoritySource || "").trim();
  if (!AUTHORITY_SOURCES.has(authoritySource)) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_INVALID",
      "authoritySource is not recognized",
      { field: "authoritySource" },
    );
  }
  if (
    (authorityMode === "canonical" && authoritySource !== "graph_kernel") ||
    (authorityMode === "shadow" && authoritySource !== "graph_kernel_shadow") ||
    (authorityMode === "legacy" && authoritySource !== "legacy_runtime")
  ) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_SOURCE_MISMATCH",
      "authoritySource does not match authorityMode",
    );
  }
  const authorityGeneration = Number(input.authorityGeneration);
  if (!Number.isSafeInteger(authorityGeneration) || authorityGeneration < 1) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_INVALID",
      "authorityGeneration must be a positive safe integer",
      { field: "authorityGeneration" },
    );
  }
  const projectionVersion = Number(
    input.projectionVersion ?? GRAPH_PROJECTION_VERSION,
  );
  if (!Number.isSafeInteger(projectionVersion) || projectionVersion < 1) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_INVALID",
      "projectionVersion must be a positive safe integer",
      { field: "projectionVersion" },
    );
  }
  const binding = {
    schema: GRAPH_AUTHORITY_SCHEMA,
    logicalRunId: identifier(input.logicalRunId, "logicalRunId"),
    originSurface: identifier(input.originSurface, "originSurface"),
    authorityMode,
    authoritySource,
    authorityGeneration,
    writerId: identifier(input.writerId, "writerId"),
    writerLeaseId: identifier(input.writerLeaseId, "writerLeaseId"),
    writerLeaseExpiresAt: leaseExpiry(input.writerLeaseExpiresAt),
    eventHead: eventHead(input.eventHead),
    projectionVersion,
  };
  if (authorityMode === "canonical" && !binding.writerLeaseExpiresAt) {
    throw authorityError(
      "CC_GRAPH_WRITER_LEASE_REQUIRED",
      "canonical authority requires an expiring writer lease",
    );
  }
  return Object.freeze(binding);
}

export function assertGraphAuthorityWriter(
  binding,
  writer,
  {
    now = Date.now(),
    expectedEventHead = undefined,
    requireCanonical = true,
  } = {},
) {
  const current = createGraphAuthorityBinding(binding);
  if (requireCanonical && current.authorityMode !== "canonical") {
    throw authorityError(
      "CC_GRAPH_NON_CANONICAL_WRITER",
      "only canonical authority may mutate canonical Graph state",
    );
  }
  if (
    current.authoritySource !== writer?.authoritySource ||
    current.authorityGeneration !== Number(writer?.authorityGeneration) ||
    current.writerId !== writer?.writerId ||
    current.writerLeaseId !== writer?.writerLeaseId
  ) {
    throw authorityError(
      "CC_GRAPH_STALE_WRITER",
      "writer identity, generation, or lease does not own this GraphRun",
      {
        authorityGeneration: current.authorityGeneration,
        writerId: current.writerId,
      },
    );
  }
  if (
    current.writerLeaseExpiresAt &&
    Date.parse(current.writerLeaseExpiresAt) <= Number(now)
  ) {
    throw authorityError(
      "CC_GRAPH_WRITER_LEASE_EXPIRED",
      "GraphRun writer lease has expired",
    );
  }
  if (
    expectedEventHead !== undefined &&
    current.eventHead !== expectedEventHead
  ) {
    throw authorityError(
      "CC_GRAPH_EVENT_HEAD_CONFLICT",
      "GraphRun event head changed before mutation",
      { expectedEventHead, actualEventHead: current.eventHead },
    );
  }
  return current;
}

const CUTOVER_TRANSITIONS = Object.freeze({
  legacy: new Set(["shadow"]),
  shadow: new Set(["legacy", "canary"]),
  canary: new Set(["shadow", "canonical"]),
  canonical: new Set(["canary", "legacy_read_only"]),
  legacy_read_only: new Set(["canonical"]),
});

export function assertGraphCutoverTransition(from, to) {
  if (
    !GRAPH_CUTOVER_STAGES.includes(from) ||
    !GRAPH_CUTOVER_STAGES.includes(to)
  ) {
    throw authorityError(
      "CC_GRAPH_CUTOVER_STAGE_INVALID",
      "Graph cutover stage is invalid",
    );
  }
  if (from === to) return to;
  if (!CUTOVER_TRANSITIONS[from].has(to)) {
    throw authorityError(
      "CC_GRAPH_CUTOVER_TRANSITION_INVALID",
      `Graph cutover cannot transition from ${from} to ${to}`,
    );
  }
  return to;
}

export class GraphRunAuthorityRegistry {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.runs = new Map();
    this.cutovers = new Map();
  }

  bind(input, { replace = false } = {}) {
    const next = createGraphAuthorityBinding(input);
    const previous = this.runs.get(next.logicalRunId);
    if (previous) {
      if (next.authorityGeneration < previous.authorityGeneration) {
        throw authorityError(
          "CC_GRAPH_STALE_GENERATION",
          "authority generation cannot move backwards",
        );
      }
      if (next.authorityGeneration === previous.authorityGeneration) {
        const sameOwner =
          next.authoritySource === previous.authoritySource &&
          next.authorityMode === previous.authorityMode &&
          next.writerId === previous.writerId &&
          next.writerLeaseId === previous.writerLeaseId;
        if (!sameOwner) {
          throw authorityError(
            "CC_GRAPH_MULTIPLE_AUTHORITATIVE_WRITERS",
            "one logical GraphRun cannot have two writers in one generation",
          );
        }
      } else {
        if (!replace) {
          throw authorityError(
            "CC_GRAPH_AUTHORITY_REPLACEMENT_REQUIRED",
            "a higher writer generation requires an explicit replacement",
          );
        }
        if (next.eventHead !== previous.eventHead) {
          throw authorityError(
            "CC_GRAPH_EVENT_HEAD_CONFLICT",
            "writer replacement must bind the exact persisted event head",
          );
        }
      }
    }
    this.runs.set(next.logicalRunId, next);
    return this.get(next.logicalRunId);
  }

  assertWriter(logicalRunId, writer, options = {}) {
    const current = this.runs.get(identifier(logicalRunId, "logicalRunId"));
    if (!current) {
      throw authorityError(
        "CC_GRAPH_AUTHORITY_NOT_FOUND",
        "GraphRun has no registered authority",
      );
    }
    return assertGraphAuthorityWriter(current, writer, {
      now: this.now(),
      ...options,
    });
  }

  advanceEventHead(
    logicalRunId,
    writer,
    { expectedEventHead, eventHead: next },
  ) {
    const current = this.assertWriter(logicalRunId, writer, {
      expectedEventHead,
    });
    const updated = createGraphAuthorityBinding({
      ...current,
      eventHead: next,
    });
    this.runs.set(current.logicalRunId, updated);
    return this.get(current.logicalRunId);
  }

  transition(originSurface, to) {
    const surface = identifier(originSurface, "originSurface");
    const from = this.cutovers.get(surface) || "legacy";
    this.cutovers.set(surface, assertGraphCutoverTransition(from, to));
    return Object.freeze({ originSurface: surface, from, to });
  }

  cutoverStage(originSurface) {
    return (
      this.cutovers.get(identifier(originSurface, "originSurface")) || "legacy"
    );
  }

  get(logicalRunId) {
    const value = this.runs.get(identifier(logicalRunId, "logicalRunId"));
    return value ? Object.freeze(clone(value)) : null;
  }

  list() {
    return Object.freeze(
      [...this.runs.values()]
        .map(clone)
        .sort((left, right) =>
          left.logicalRunId.localeCompare(right.logicalRunId),
        ),
    );
  }
}
