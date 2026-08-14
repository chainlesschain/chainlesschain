import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
} from "./scheduler-kernel/contract.js";

export const AUTOMATION_EXECUTION_INCIDENT_SCHEMA_VERSION = 1;

export const AUTOMATION_EXECUTION_INCIDENT_CATEGORY = Object.freeze({
  PERMISSION: "permission",
  CONNECTOR: "connector",
  BUDGET: "budget",
  WRITE_SCOPE: "write_scope",
});

export const AUTOMATION_EXECUTION_INCIDENT_STATUS = Object.freeze({
  OPEN: "open",
  RESOLVED: "resolved",
  CANCELLED: "cancelled",
});

const CATEGORIES = new Set(
  Object.values(AUTOMATION_EXECUTION_INCIDENT_CATEGORY),
);
const STATUSES = new Set(Object.values(AUTOMATION_EXECUTION_INCIDENT_STATUS));
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const TRIGGER_TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;
const CONNECTOR_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const PERMISSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._*-]{0,255}$/u;
const MAX_EVIDENCE_LIST = 32;
const MAX_EVIDENCE_BYTES = 8 * 1024;
const MAX_DETAILS_BYTES = 4 * 1024;
const OBVIOUS_SECRET_PATTERN =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}|\b(?:sk|ghp|xox[baprs])[-_][a-z0-9]{16,}|\bgithub_pat_[a-z0-9_]{16,}|\bAKIA[0-9A-Z]{16}|\b(?:api[_-]?key|password|secret|token)\s*[:=])/iu;

const EVIDENCE_FIELDS = new Set([
  "actionId",
  "actionIndex",
  "budgetLimit",
  "budgetRequested",
  "budgetRevision",
  "budgetUsed",
  "budgetWindowStartedAtMs",
  "connector",
  "connectors",
  "decisionId",
  "deniedPermissions",
  "evidenceDigests",
  "permission",
  "policyRevision",
  "reasonCode",
  "recoveryCode",
  "schedulerFence",
  "retryable",
  "writeScopeDigests",
]);

function incidentError(code, message, details = undefined) {
  const error = new SchedulerKernelError(code, message, details);
  error.retryable = false;
  return error;
}

function assertDatabase(db) {
  if (
    !db ||
    typeof db.exec !== "function" ||
    typeof db.prepare !== "function" ||
    typeof db.transaction !== "function"
  ) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_DATABASE_REQUIRED",
      "automation execution incidents require a compatible database",
    );
  }
}

function normalizeOptionalIdentifier(value, field, options = undefined) {
  if (value === undefined || value === null) return null;
  return normalizeSafeIdentifier(value, field, options);
}

function normalizeSafeIdentifier(value, field, options = undefined) {
  const identifier = normalizeIdentifier(value, field, options);
  if (OBVIOUS_SECRET_PATTERN.test(identifier)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_UNSAFE_DETAILS",
      `${field} appears to contain secret material`,
    );
  }
  return identifier;
}

function normalizeDigest(value, field) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function normalizeCode(value, field) {
  if (typeof value !== "string" || !CODE_PATTERN.test(value)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} must be an uppercase machine-readable code`,
    );
  }
  return value;
}

function normalizeNonnegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} must be a non-negative safe integer`,
    );
  }
  return number;
}

function normalizeStringList(value, field, itemNormalizer) {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_LIST) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} must be an array with at most ${MAX_EVIDENCE_LIST} entries`,
    );
  }
  return [
    ...new Set(
      value.map((entry, index) => itemNormalizer(entry, `${field}[${index}]`)),
    ),
  ].sort();
}

function normalizePermission(value, field) {
  const permission = normalizeSafeIdentifier(value, field);
  if (!PERMISSION_PATTERN.test(permission)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} must be a machine-readable permission`,
    );
  }
  return permission;
}

function normalizeConnector(value, field) {
  const connector = normalizeSafeIdentifier(value, field, { maxLength: 64 });
  if (!CONNECTOR_PATTERN.test(connector)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} must be a lowercase connector identifier`,
    );
  }
  return connector;
}

function assertPlainObject(value, field) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} must be a plain object`,
    );
  }
}

function normalizeEvidence(value, field, maximumBytes) {
  const input = value ?? {};
  assertPlainObject(input, field);
  const unknown = Object.keys(input).filter((key) => !EVIDENCE_FIELDS.has(key));
  if (unknown.length > 0) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_UNSAFE_DETAILS",
      `${field} contains fields that are not safe to persist`,
      { fields: unknown.sort() },
    );
  }

  const normalized = {};
  for (const key of Object.keys(input).sort()) {
    const entry = input[key];
    if (entry === undefined) continue;
    switch (key) {
      case "actionId":
      case "decisionId":
      case "policyRevision":
        normalized[key] = normalizeSafeIdentifier(entry, `${field}.${key}`);
        break;
      case "reasonCode":
      case "recoveryCode":
        normalized[key] = normalizeCode(entry, `${field}.${key}`);
        break;
      case "actionIndex":
      case "budgetLimit":
      case "budgetRequested":
      case "budgetRevision":
      case "budgetUsed":
      case "budgetWindowStartedAtMs":
      case "schedulerFence":
        normalized[key] = normalizeNonnegativeInteger(entry, `${field}.${key}`);
        break;
      case "retryable":
        if (typeof entry !== "boolean") {
          throw incidentError(
            "AUTOMATION_EXECUTION_INCIDENT_INVALID",
            `${field}.${key} must be a boolean`,
          );
        }
        normalized[key] = entry;
        break;
      case "connector":
        normalized[key] = normalizeConnector(entry, `${field}.${key}`);
        break;
      case "connectors":
        normalized[key] = normalizeStringList(
          entry,
          `${field}.${key}`,
          normalizeConnector,
        );
        break;
      case "permission":
        normalized[key] = normalizePermission(entry, `${field}.${key}`);
        break;
      case "deniedPermissions":
        normalized[key] = normalizeStringList(
          entry,
          `${field}.${key}`,
          normalizePermission,
        );
        break;
      case "evidenceDigests":
      case "writeScopeDigests":
        normalized[key] = normalizeStringList(
          entry,
          `${field}.${key}`,
          normalizeDigest,
        );
        break;
      default:
        throw incidentError(
          "AUTOMATION_EXECUTION_INCIDENT_UNSAFE_DETAILS",
          `${field}.${key} is not safe to persist`,
        );
    }
  }

  const encoded = canonicalJson(normalized, field);
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} exceeds ${maximumBytes} encoded bytes`,
    );
  }
  return { value: normalized, encoded };
}

function digest(namespace, value) {
  return createHash("sha256")
    .update(namespace, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function normalizeTriggerType(value) {
  if (typeof value !== "string" || !TRIGGER_TYPE_PATTERN.test(value)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      "triggerType must be a lowercase machine-readable trigger type",
    );
  }
  return value;
}

function normalizeCategory(value) {
  if (!CATEGORIES.has(value)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `category must be one of ${[...CATEGORIES].join(", ")}`,
    );
  }
  return value;
}

function normalizeStatus(value, field = "status") {
  if (!STATUSES.has(value)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      `${field} must be one of ${[...STATUSES].join(", ")}`,
    );
  }
  return value;
}

function normalizeNow(now) {
  const value = typeof now === "function" ? now() : (now ?? Date.now());
  return normalizeEpochMs(value, "now");
}

function normalizeNewIncident(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      "automation execution incident input must be an object",
    );
  }
  const boundary = normalizeEvidence(
    input.boundary,
    "incident.boundary",
    MAX_EVIDENCE_BYTES,
  );
  const details = normalizeEvidence(
    input.details,
    "incident.details",
    MAX_DETAILS_BYTES,
  );
  const authorityDigest = normalizeDigest(
    input.authorityDigest,
    "incident.authorityDigest",
  );
  const boundaryDigest = digest(
    "chainlesschain.automation.incident.boundary.v1\0",
    boundary.value,
  );
  const detailsDigest = digest(
    "chainlesschain.automation.incident.details.v1\0",
    details.value,
  );
  const identity = {
    schemaVersion: AUTOMATION_EXECUTION_INCIDENT_SCHEMA_VERSION,
    runId: normalizeSafeIdentifier(input.runId, "incident.runId"),
    flowId: normalizeSafeIdentifier(input.flowId, "incident.flowId"),
    occurrenceId: normalizeOptionalIdentifier(
      input.occurrenceId,
      "incident.occurrenceId",
    ),
    triggerType: normalizeTriggerType(input.triggerType),
    triggerId: normalizeOptionalIdentifier(
      input.triggerId,
      "incident.triggerId",
    ),
    category: normalizeCategory(input.category),
    code: normalizeCode(input.code, "incident.code"),
  };
  return {
    ...identity,
    incidentId: digest("chainlesschain.automation.incident.identity.v2\0", {
      ...identity,
      authorityDigest,
      boundaryDigest,
      detailsDigest,
    }),
    authorityDigest,
    boundaryDigest,
    boundary: boundary.value,
    boundaryJson: boundary.encoded,
    details: details.value,
    detailsJson: details.encoded,
  };
}

function parseEvidence(value, field) {
  try {
    return JSON.parse(value);
  } catch {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_CORRUPT",
      `stored ${field} is not valid JSON`,
    );
  }
}

function rowToIncident(row) {
  if (!row) return null;
  return {
    schemaVersion: row.schema_version,
    incidentId: row.incident_id,
    runId: row.run_id,
    flowId: row.flow_id,
    occurrenceId: row.occurrence_id,
    triggerType: row.trigger_type,
    triggerId: row.trigger_id,
    category: row.category,
    code: row.code,
    authorityDigest: row.authority_digest,
    boundaryDigest: row.boundary_digest,
    boundary: parseEvidence(row.boundary_json, "incident boundary"),
    details: parseEvidence(row.details_json, "incident details"),
    status: row.status,
    revision: row.revision,
    resolutionCode: row.resolution_code,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    closedAtMs: row.closed_at_ms,
  };
}

export function ensureAutomationExecutionIncidentSchema(db) {
  assertDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_execution_incidents (
      incident_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      run_id TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      occurrence_id TEXT,
      trigger_type TEXT NOT NULL,
      trigger_id TEXT,
      category TEXT NOT NULL CHECK (category IN ('permission', 'connector', 'budget', 'write_scope')),
      code TEXT NOT NULL,
      authority_digest TEXT NOT NULL,
      boundary_digest TEXT NOT NULL,
      boundary_json TEXT NOT NULL,
      details_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'cancelled')),
      revision INTEGER NOT NULL,
      resolution_code TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      closed_at_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS auto_execution_incidents_run_idx
      ON auto_execution_incidents (run_id, created_at_ms DESC);
    CREATE INDEX IF NOT EXISTS auto_execution_incidents_flow_status_idx
      ON auto_execution_incidents (flow_id, status, created_at_ms DESC);
    CREATE INDEX IF NOT EXISTS auto_execution_incidents_occurrence_idx
      ON auto_execution_incidents (occurrence_id, created_at_ms DESC);
  `);
}

export function deriveAutomationExecutionIncidentId(input) {
  return normalizeNewIncident(input).incidentId;
}

export function automationExecutionBoundaryDigest(boundary) {
  const normalized = normalizeEvidence(
    boundary,
    "incident.boundary",
    MAX_EVIDENCE_BYTES,
  );
  return digest(
    "chainlesschain.automation.incident.boundary.v1\0",
    normalized.value,
  );
}

export function upsertAutomationExecutionIncident(
  db,
  input,
  { now = Date.now } = {},
) {
  ensureAutomationExecutionIncidentSchema(db);
  const incident = normalizeNewIncident(input);
  const nowMs = normalizeNow(now);
  const transaction = db.transaction(() => {
    const inserted = db
      .prepare(
        `INSERT INTO auto_execution_incidents
       (incident_id, schema_version, run_id, flow_id, occurrence_id,
        trigger_type, trigger_id, category, code, authority_digest,
        boundary_digest, boundary_json, details_json, status, revision,
        resolution_code, created_at_ms, updated_at_ms, closed_at_ms)
       VALUES
       (@incidentId, @schemaVersion, @runId, @flowId, @occurrenceId,
        @triggerType, @triggerId, @category, @code, @authorityDigest,
        @boundaryDigest, @boundaryJson, @detailsJson, 'open', 1,
        NULL, @nowMs, @nowMs, NULL)
       ON CONFLICT(incident_id) DO NOTHING`,
      )
      .run({ ...incident, nowMs });
    const existing = db
      .prepare("SELECT * FROM auto_execution_incidents WHERE incident_id = ?")
      .get(incident.incidentId);
    const expected = {
      schema_version: incident.schemaVersion,
      run_id: incident.runId,
      flow_id: incident.flowId,
      occurrence_id: incident.occurrenceId,
      trigger_type: incident.triggerType,
      trigger_id: incident.triggerId,
      category: incident.category,
      code: incident.code,
      authority_digest: incident.authorityDigest,
      boundary_digest: incident.boundaryDigest,
      boundary_json: incident.boundaryJson,
      details_json: incident.detailsJson,
    };
    const mismatchedFields = Object.entries(expected)
      .filter(([field, value]) => existing?.[field] !== value)
      .map(([field]) => field)
      .sort();
    if (mismatchedFields.length > 0) {
      throw incidentError(
        "AUTOMATION_EXECUTION_INCIDENT_CONFLICT",
        `automation execution incident evidence conflicts with ${incident.incidentId}`,
        { incidentId: incident.incidentId, fields: mismatchedFields },
      );
    }
    return {
      ...rowToIncident(existing),
      deduplicated: inserted.changes === 0,
    };
  });
  // BEGIN IMMEDIATE serializes cross-process observers before the atomic
  // INSERT-or-read path, eliminating the select-then-insert race.
  return transaction.immediate();
}

export function getAutomationExecutionIncident(db, incidentId) {
  ensureAutomationExecutionIncidentSchema(db);
  const id = normalizeIdentifier(incidentId, "incidentId");
  return rowToIncident(
    db
      .prepare("SELECT * FROM auto_execution_incidents WHERE incident_id = ?")
      .get(id),
  );
}

export function listAutomationExecutionIncidents(db, filters = {}) {
  ensureAutomationExecutionIncidentSchema(db);
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      "incident filters must be an object",
    );
  }
  const clauses = [];
  const parameters = [];
  const addIdentifierFilter = (column, value, field) => {
    if (value === undefined) return;
    clauses.push(`${column} = ?`);
    parameters.push(normalizeIdentifier(value, field));
  };
  addIdentifierFilter("run_id", filters.runId, "filters.runId");
  addIdentifierFilter("flow_id", filters.flowId, "filters.flowId");
  addIdentifierFilter(
    "occurrence_id",
    filters.occurrenceId,
    "filters.occurrenceId",
  );
  if (filters.triggerType !== undefined) {
    clauses.push("trigger_type = ?");
    parameters.push(normalizeTriggerType(filters.triggerType));
  }
  if (filters.category !== undefined) {
    clauses.push("category = ?");
    parameters.push(normalizeCategory(filters.category));
  }
  if (filters.status !== undefined) {
    clauses.push("status = ?");
    parameters.push(normalizeStatus(filters.status, "filters.status"));
  }
  const requestedLimit = filters.limit ?? 50;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      "filters.limit must be a positive safe integer",
    );
  }
  const limit = Math.min(requestedLimit, 200);
  parameters.push(limit);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT * FROM auto_execution_incidents
       ${where}
       ORDER BY created_at_ms DESC, incident_id ASC
       LIMIT ?`,
    )
    .all(...parameters)
    .map(rowToIncident);
}

function transitionIncident(
  db,
  incidentId,
  targetStatus,
  { expectedRevision, resolutionCode, now },
) {
  ensureAutomationExecutionIncidentSchema(db);
  const id = normalizeIdentifier(incidentId, "incidentId");
  const revision = normalizeNonnegativeInteger(
    expectedRevision,
    "expectedRevision",
  );
  if (revision < 1) {
    throw incidentError(
      "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      "expectedRevision must be a positive safe integer",
    );
  }
  const normalizedResolutionCode = normalizeCode(
    resolutionCode,
    "resolutionCode",
  );
  const nowMs = normalizeNow(now);
  const transaction = db.transaction(() => {
    const current = db
      .prepare("SELECT * FROM auto_execution_incidents WHERE incident_id = ?")
      .get(id);
    if (!current) {
      throw incidentError(
        "AUTOMATION_EXECUTION_INCIDENT_NOT_FOUND",
        `automation execution incident was not found: ${id}`,
        { incidentId: id },
      );
    }
    if (current.revision !== revision) {
      throw incidentError(
        "AUTOMATION_EXECUTION_INCIDENT_REVISION_CONFLICT",
        `automation execution incident revision changed: ${id}`,
        {
          incidentId: id,
          expectedRevision: revision,
          actualRevision: current.revision,
        },
      );
    }
    if (current.status !== AUTOMATION_EXECUTION_INCIDENT_STATUS.OPEN) {
      throw incidentError(
        "AUTOMATION_EXECUTION_INCIDENT_STATE_CONFLICT",
        `automation execution incident is already closed: ${id}`,
        { incidentId: id, status: current.status },
      );
    }
    const result = db
      .prepare(
        `UPDATE auto_execution_incidents
         SET status = ?, revision = revision + 1, resolution_code = ?,
             updated_at_ms = ?, closed_at_ms = ?
         WHERE incident_id = ? AND revision = ? AND status = 'open'`,
      )
      .run(targetStatus, normalizedResolutionCode, nowMs, nowMs, id, revision);
    if (result.changes !== 1) {
      throw incidentError(
        "AUTOMATION_EXECUTION_INCIDENT_REVISION_CONFLICT",
        `automation execution incident changed concurrently: ${id}`,
        { incidentId: id, expectedRevision: revision },
      );
    }
    return rowToIncident(
      db
        .prepare("SELECT * FROM auto_execution_incidents WHERE incident_id = ?")
        .get(id),
    );
  });
  return transaction();
}

export function resolveAutomationExecutionIncident(
  db,
  incidentId,
  { expectedRevision, resolutionCode = "RESOLVED", now = Date.now } = {},
) {
  return transitionIncident(
    db,
    incidentId,
    AUTOMATION_EXECUTION_INCIDENT_STATUS.RESOLVED,
    { expectedRevision, resolutionCode, now },
  );
}

export function cancelAutomationExecutionIncident(
  db,
  incidentId,
  { expectedRevision, resolutionCode = "CANCELLED", now = Date.now } = {},
) {
  return transitionIncident(
    db,
    incidentId,
    AUTOMATION_EXECUTION_INCIDENT_STATUS.CANCELLED,
    { expectedRevision, resolutionCode, now },
  );
}

/**
 * Close every incident that is still open for one exact, authoritative run.
 * The per-row revision/status predicate is the CAS: only applied updates are
 * reported, so an incident closed before this transaction is never presented
 * to callers as resolved by the successful execution.
 */
export function resolveAutomationExecutionIncidentsForSucceededRun(
  db,
  runId,
  { now = Date.now } = {},
) {
  ensureAutomationExecutionIncidentSchema(db);
  const id = normalizeSafeIdentifier(runId, "runId");
  const nowMs = normalizeNow(now);
  const transaction = db.transaction(() => {
    const candidates = db
      .prepare(
        `SELECT incident_id, revision
         FROM auto_execution_incidents
         WHERE run_id = ? AND status = 'open'
         ORDER BY created_at_ms ASC, incident_id ASC`,
      )
      .all(id);
    const update = db.prepare(
      `UPDATE auto_execution_incidents
       SET status = 'resolved', revision = revision + 1,
           resolution_code = 'EXECUTION_SUCCEEDED', updated_at_ms = ?,
           closed_at_ms = ?
       WHERE incident_id = ? AND revision = ? AND status = 'open'`,
    );
    const resolvedIncidentIds = [];
    for (const candidate of candidates) {
      const result = update.run(
        nowMs,
        nowMs,
        candidate.incident_id,
        candidate.revision,
      );
      if (result.changes === 1) {
        resolvedIncidentIds.push(candidate.incident_id);
      }
    }
    return {
      runId: id,
      resolutionCode: "EXECUTION_SUCCEEDED",
      resolvedCount: resolvedIncidentIds.length,
      resolvedIncidentIds,
    };
  });
  return transaction.immediate();
}
