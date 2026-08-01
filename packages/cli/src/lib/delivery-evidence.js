/**
 * Versioned immutable delivery evidence.
 *
 * A record binds the code identity, diff, execution environment, selected
 * gates and their complete matrix results, review, unknowns, side effects and
 * PR/CI state. The record is content-digested and deeply frozen in memory.
 * Readiness is a separate fail-closed decision so blocked attempts can still be
 * archived as useful evidence.
 */

import crypto from "node:crypto";
import {
  strictAutoMergeDecision,
  summarizeSideEffects,
} from "./pr-automation-policy.js";
import {
  IMPACTED_GATE_SELECTION_SCHEMA,
  IMPACTED_GATE_SELECTION_VERSION,
} from "./impacted-gate-selector.js";

export const DELIVERY_EVIDENCE_SCHEMA = "chainlesschain.delivery-evidence";
export const DELIVERY_EVIDENCE_VERSION = 1;
export const DELIVERY_READINESS_SCHEMA =
  "chainlesschain.delivery-readiness-decision";
export const DELIVERY_READINESS_VERSION = 1;

const EXACT_COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/i;

export function canonicalDeliveryJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalDeliveryJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalDeliveryJson(value[key])}`)
    .join(",")}}`;
}

function evidenceDigest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(canonicalDeliveryJson(value))
    .digest("hex")}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function jsonClone(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch (error) {
    throw new Error(
      `delivery evidence must be JSON-serializable: ${error.message}`,
    );
  }
}

function timestamp(now) {
  const raw = typeof now === "function" ? now() : now;
  const date = raw == null ? new Date() : new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("delivery evidence requires a valid creation time");
  }
  return date.toISOString();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return value == null ? null : jsonClone(value);
  return value.map((item) => String(item));
}

function normalizeCommit(input) {
  const commit =
    input?.commit && typeof input.commit === "object"
      ? jsonClone(input.commit)
      : {};
  commit.sha = String(commit.sha || input?.commitSha || "").trim();
  return commit;
}

function normalizeDiff(input, commitSha) {
  const diff =
    input?.diff && typeof input.diff === "object" ? jsonClone(input.diff) : {};
  diff.baseCommitSha = String(diff.baseCommitSha || diff.baseSha || "").trim();
  diff.headCommitSha = String(
    diff.headCommitSha || diff.headSha || commitSha || "",
  ).trim();
  diff.digest = String(diff.digest || diff.sha256 || "").trim();
  diff.changedFiles = normalizeStringArray(diff.changedFiles);
  delete diff.baseSha;
  delete diff.headSha;
  delete diff.sha256;
  return diff;
}

function normalizeEnvironment(input) {
  const environment =
    input?.environment && typeof input.environment === "object"
      ? jsonClone(input.environment)
      : {};
  for (const key of ["os", "arch", "runtime", "runtimeVersion"]) {
    environment[key] = String(environment[key] || "").trim();
  }
  return environment;
}

function normalizeGates(input) {
  const gates =
    input?.gates && typeof input.gates === "object"
      ? jsonClone(input.gates)
      : {};
  gates.selection = gates.selection || null;
  gates.required = Array.isArray(gates.required) ? gates.required : null;
  gates.results = Array.isArray(gates.results) ? gates.results : null;
  return gates;
}

function normalizeReview(input) {
  const review =
    input?.review && typeof input.review === "object"
      ? jsonClone(input.review)
      : {};
  review.status = String(review.status || "")
    .trim()
    .toLowerCase();
  review.commitSha = String(review.commitSha || "").trim();
  review.evidenceDigest = String(
    review.evidenceDigest || review.reportDigest || "",
  ).trim();
  delete review.reportDigest;
  return review;
}

function recordMaterial(record) {
  const material = jsonClone(record);
  delete material.recordDigest;
  return material;
}

/** Create a deterministic-shape, content-digested, deeply frozen record. */
export function createDeliveryEvidenceRecord(input = {}, { now } = {}) {
  const source = jsonClone(input);
  const commit = normalizeCommit(source);
  const material = {
    schema: DELIVERY_EVIDENCE_SCHEMA,
    version: DELIVERY_EVIDENCE_VERSION,
    createdAt: timestamp(now),
    commit,
    diff: normalizeDiff(source, commit.sha),
    environment: normalizeEnvironment(source),
    gates: normalizeGates(source),
    review: normalizeReview(source),
    unverified: Array.isArray(source.unverified)
      ? source.unverified
      : source.unverified == null
        ? null
        : source.unverified,
    sideEffects: Array.isArray(source.sideEffects)
      ? source.sideEffects
      : source.sideEffects == null
        ? null
        : source.sideEffects,
    pr: source.pr && typeof source.pr === "object" ? source.pr : null,
    artifacts: Array.isArray(source.artifacts) ? source.artifacts : [],
  };
  const record = {
    ...material,
    recordDigest: evidenceDigest(material),
  };
  return deepFreeze(record);
}

/** Verify schema/version and the content digest without trusting the record. */
export function verifyDeliveryEvidenceRecord(record) {
  const unmet = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      valid: false,
      reason: "record-invalid",
      unmet: ["record-invalid"],
      expectedDigest: null,
      actualDigest: null,
    };
  }
  if (record.schema !== DELIVERY_EVIDENCE_SCHEMA) {
    unmet.push("schema-unsupported");
  }
  if (record.version !== DELIVERY_EVIDENCE_VERSION) {
    unmet.push("version-unsupported");
  }
  const actualDigest = String(record.recordDigest || "");
  const expectedDigest = evidenceDigest(recordMaterial(record));
  if (!actualDigest || actualDigest !== expectedDigest) {
    unmet.push("record-digest-mismatch");
  }
  return {
    valid: unmet.length === 0,
    reason: unmet[0] || "ok",
    unmet,
    expectedDigest,
    actualDigest: actualDigest || null,
  };
}

function gateDefinitionMap(required, unmet) {
  if (!Array.isArray(required) || required.length === 0) {
    unmet.push("required-gates-unverified");
    return new Map();
  }
  const map = new Map();
  required.forEach((gate, index) => {
    const id = String(gate?.id || "").trim();
    if (!id) {
      unmet.push(`required-gate-id-invalid:${index}`);
      return;
    }
    if (map.has(id)) unmet.push(`required-gate-duplicate:${id}`);
    if (!Array.isArray(gate?.matrix)) {
      unmet.push(`required-matrix-unverified:${id}`);
    } else {
      const matrixIds = gate.matrix.map((cell) => String(cell || "").trim());
      if (matrixIds.some((cell) => !cell)) {
        unmet.push(`required-matrix-cell-invalid:${id}`);
      }
      if (new Set(matrixIds).size !== matrixIds.length) {
        unmet.push(`required-matrix-cell-duplicate:${id}`);
      }
    }
    map.set(id, gate);
  });
  return map;
}

function assessGates(record, commitSha, unmet) {
  const selection = record.gates?.selection;
  if (
    selection?.schema !== IMPACTED_GATE_SELECTION_SCHEMA ||
    selection?.version !== IMPACTED_GATE_SELECTION_VERSION ||
    selection?.decision !== "selected" ||
    !["full", "impacted"].includes(selection?.mode)
  ) {
    unmet.push("gate-selection-unverified");
    return;
  }
  const requiredIds = Array.isArray(selection.requiredGateIds)
    ? selection.requiredGateIds.map(String)
    : [];
  const selectedIds = Array.isArray(selection.selectedGateIds)
    ? selection.selectedGateIds.map(String)
    : [];
  if (requiredIds.length === 0) unmet.push("required-gates-unverified");
  if (selectedIds.length === 0) unmet.push("selected-gates-empty");
  if (new Set(requiredIds).size !== requiredIds.length) {
    unmet.push("gate-selection-required-set-ambiguous");
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    unmet.push("gate-selection-selected-set-ambiguous");
  }
  for (const id of selectedIds) {
    if (!requiredIds.includes(id)) unmet.push(`selected-gate-unknown:${id}`);
  }
  if (
    selection.mode === "full" &&
    (selectedIds.length !== requiredIds.length ||
      requiredIds.some((id) => !selectedIds.includes(id)))
  ) {
    unmet.push("full-gate-fallback-incomplete");
  }

  const definitions = gateDefinitionMap(record.gates?.required, unmet);
  for (const id of requiredIds) {
    if (!definitions.has(id))
      unmet.push(`required-gate-definition-missing:${id}`);
  }
  for (const id of definitions.keys()) {
    if (!requiredIds.includes(id)) {
      unmet.push(`gate-selection-required-set-mismatch:${id}`);
    }
  }
  const results = Array.isArray(record.gates?.results)
    ? record.gates.results
    : [];
  if (!Array.isArray(record.gates?.results))
    unmet.push("gate-results-unverified");
  for (const id of selectedIds) {
    const matches = results.filter(
      (result) => String(result?.id || "").trim() === id,
    );
    if (matches.length === 0) {
      unmet.push(`gate-result-missing:${id}`);
      continue;
    }
    if (matches.length > 1) {
      unmet.push(`gate-result-ambiguous:${id}`);
      continue;
    }
    const result = matches[0];
    if (String(result?.status || "").toLowerCase() !== "passed") {
      unmet.push(`gate-not-passed:${id}`);
    }
    if (String(result?.commitSha || "") !== commitSha) {
      unmet.push(`gate-commit-mismatch:${id}`);
    }

    const definition = definitions.get(id);
    const requiredMatrix = Array.isArray(definition?.matrix)
      ? definition.matrix.map(String)
      : [];
    const matrixResults = Array.isArray(result?.matrix) ? result.matrix : null;
    if (matrixResults === null) {
      unmet.push(`gate-matrix-results-unverified:${id}`);
      continue;
    }
    for (const cellId of requiredMatrix) {
      const cells = matrixResults.filter(
        (cell) => String(cell?.id || "") === cellId,
      );
      if (cells.length === 0) {
        unmet.push(`gate-matrix-cell-missing:${id}:${cellId}`);
        continue;
      }
      if (cells.length > 1) {
        unmet.push(`gate-matrix-cell-ambiguous:${id}:${cellId}`);
        continue;
      }
      if (String(cells[0]?.status || "").toLowerCase() !== "passed") {
        unmet.push(`gate-matrix-cell-not-passed:${id}:${cellId}`);
      }
      if (String(cells[0]?.commitSha || "") !== commitSha) {
        unmet.push(`gate-matrix-cell-commit-mismatch:${id}:${cellId}`);
      }
    }
  }
}

/**
 * Fail-closed delivery decision. It performs no I/O and never creates or
 * merges a PR; it only explains whether the supplied evidence proves that the
 * delivery is eligible.
 */
export function assessDeliveryEvidence(record) {
  const unmet = [];
  const integrity = verifyDeliveryEvidenceRecord(record);
  unmet.push(...integrity.unmet);

  const commitSha = String(record?.commit?.sha || "").trim();
  if (!EXACT_COMMIT_RE.test(commitSha)) unmet.push("commit-sha-not-exact");
  if (!EXACT_COMMIT_RE.test(String(record?.diff?.baseCommitSha || ""))) {
    unmet.push("diff-base-commit-not-exact");
  }
  if (String(record?.diff?.headCommitSha || "") !== commitSha) {
    unmet.push("diff-head-commit-mismatch");
  }
  if (!SHA256_RE.test(String(record?.diff?.digest || ""))) {
    unmet.push("diff-digest-unverified");
  }
  if (
    !Array.isArray(record?.diff?.changedFiles) ||
    record.diff.changedFiles.length === 0
  ) {
    unmet.push("diff-changed-files-unverified");
  }

  for (const key of ["os", "arch", "runtime", "runtimeVersion"]) {
    if (!String(record?.environment?.[key] || "").trim()) {
      unmet.push(`environment-${key}-unverified`);
    }
  }
  const dependencyDigest = String(
    record?.environment?.dependencyDigest ||
      record?.environment?.dependencyLockDigest ||
      record?.environment?.imageDigest ||
      "",
  );
  if (!SHA256_RE.test(dependencyDigest)) {
    unmet.push("environment-dependency-digest-unverified");
  }

  assessGates(record, commitSha, unmet);

  if (record?.review?.status !== "approved") {
    unmet.push("review-not-approved");
  }
  if (String(record?.review?.commitSha || "") !== commitSha) {
    unmet.push("review-commit-mismatch");
  }
  if (!SHA256_RE.test(String(record?.review?.evidenceDigest || ""))) {
    unmet.push("review-evidence-digest-unverified");
  }

  if (!Array.isArray(record?.unverified)) {
    unmet.push("unverified-ledger-missing");
  } else if (record.unverified.length > 0) {
    unmet.push("unverified-items-present");
  }

  const sideEffectSummary = summarizeSideEffects(record?.sideEffects);
  if (!sideEffectSummary.verified) {
    unmet.push("side-effects-unverified");
  }
  for (const id of sideEffectSummary.unresolved) {
    if (sideEffectSummary.verified) unmet.push(`side-effect-unresolved:${id}`);
  }

  const pr = record?.pr && typeof record.pr === "object" ? record.pr : {};
  if (!Number.isInteger(Number(pr.number)) || Number(pr.number) <= 0) {
    unmet.push("pr-unverified");
  }
  if (String(pr.headCommitSha || "") !== commitSha) {
    unmet.push("pr-head-commit-mismatch");
  }
  if (String(pr.ciCommitSha || "") !== commitSha) {
    unmet.push("pr-ci-commit-mismatch");
  }
  const prDecision = strictAutoMergeDecision({
    enabled: pr.autoMergeEnabled,
    hasOpenPr: pr.hasOpenPr,
    branchProtectionSatisfied: pr.branchProtectionSatisfied,
    reviewApproved: pr.reviewApproved,
    pendingApprovals: pr.pendingApprovals,
    requiredChecks: pr.requiredChecks,
    requiredMatrixComplete: pr.requiredMatrixComplete,
    checks: pr.checks,
    headCommitSha: pr.headCommitSha,
    ciCommitSha: pr.ciCommitSha,
    sideEffects: record?.sideEffects,
  });
  unmet.push(...prDecision.unmet.map((reason) => `pr:${reason}`));

  const uniqueUnmet = [...new Set(unmet)];
  return deepFreeze({
    schema: DELIVERY_READINESS_SCHEMA,
    version: DELIVERY_READINESS_VERSION,
    ready: uniqueUnmet.length === 0,
    reason: uniqueUnmet[0] || "ok",
    unmet: uniqueUnmet,
    recordDigest: String(record?.recordDigest || "") || null,
    commitSha: commitSha || null,
    prDecision,
  });
}
