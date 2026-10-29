"use strict";

const SCHEMA_VERSION = 1;
const CONTEXT_PLAN_SCHEMA = "chainlesschain.context-plan/v1";
const COMPACTION_EVENT_SCHEMA = "chainlesschain.context-compaction/v1";
const MEMORY_RECEIPT_SCHEMA = "chainlesschain.memory-receipt/v1";
const DELETION_RECEIPT_SCHEMA = "chainlesschain.memory-deletion-receipt/v1";

const CONTEXT_KINDS = Object.freeze([
  "system-policy",
  "tool-schema",
  "skill",
  "task-state",
  "message",
  "tool-evidence",
  "memory",
  "project-rule",
  "artifact-ref",
]);
const CONTEXT_SCOPES = Object.freeze([
  "turn",
  "session",
  "agent",
  "project",
  "user",
  "global",
]);
const CONTEXT_TRUST = Object.freeze([
  "host",
  "verified",
  "user",
  "external",
  "untrusted",
]);
const SENSITIVITY = Object.freeze([
  "public",
  "internal",
  "personal",
  "secret",
  "restricted",
]);
const MEMORY_STATES = Object.freeze([
  "candidate",
  "active",
  "reinforced",
  "superseded",
  "archived",
  "expired",
  "deleted",
  "purged",
]);
const COMPACTION_STATES = Object.freeze([
  "idle",
  "evaluating",
  "preparing",
  "summarizing",
  "verifying",
  "committing",
  "committed",
  "aborted",
  "stale",
  "reconciliation_required",
]);
const CONTEXT_PARTITIONS = Object.freeze([
  "trusted-system",
  "working-state",
  "tools-and-skills",
  "conversation",
  "tool-evidence",
  "memory-and-rules",
  "recovery-reserve",
]);
const KIND_PARTITION = Object.freeze({
  "system-policy": "trusted-system",
  "task-state": "working-state",
  "tool-schema": "tools-and-skills",
  skill: "tools-and-skills",
  message: "conversation",
  "tool-evidence": "tool-evidence",
  memory: "memory-and-rules",
  "project-rule": "memory-and-rules",
  "artifact-ref": "tool-evidence",
});
const DEFAULT_PARTITION_WEIGHTS = Object.freeze({
  "trusted-system": 0.12,
  "working-state": 0.18,
  "tools-and-skills": 0.16,
  conversation: 0.28,
  "tool-evidence": 0.14,
  "memory-and-rules": 0.12,
});
const CONTEXT_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "invalid_argument",
  CONTEXT_OVER_BUDGET: "context_over_budget",
  SCOPE_DENIED: "scope_denied",
  SINK_DENIED: "sink_denied",
  DIGEST_MISMATCH: "digest_mismatch",
  CONTENT_UNAVAILABLE: "content_unavailable",
  REVISION_CONFLICT: "revision_conflict",
  STALE: "stale",
  RECONCILIATION_REQUIRED: "reconciliation_required",
  ILLEGAL_MEMORY_TRANSITION: "illegal_memory_transition",
  LEGACY_WRITER_FENCED: "legacy_writer_fenced",
  PROVIDER_USAGE_UNSETTLED: "provider_usage_unsettled",
  DERIVATION_POLICY_VIOLATION: "derivation_policy_violation",
  REPLICA_TOMBSTONE_FENCED: "replica_tombstone_fenced",
});

module.exports = {
  SCHEMA_VERSION,
  CONTEXT_PLAN_SCHEMA,
  COMPACTION_EVENT_SCHEMA,
  MEMORY_RECEIPT_SCHEMA,
  DELETION_RECEIPT_SCHEMA,
  CONTEXT_KINDS,
  CONTEXT_SCOPES,
  CONTEXT_TRUST,
  SENSITIVITY,
  MEMORY_STATES,
  COMPACTION_STATES,
  CONTEXT_PARTITIONS,
  KIND_PARTITION,
  DEFAULT_PARTITION_WEIGHTS,
  CONTEXT_ERROR_CODES,
};
