import { randomUUID } from "node:crypto";
import { JsonlRolloutStore } from "../app-server/rollout-store.js";
import { createGraphAuthorityBinding } from "./authority.js";

export const GRAPH_MIGRATION_SCHEMA =
  "chainlesschain.graph-authority-migration/v1";

export const GRAPH_MIGRATION_PHASES = Object.freeze([
  "prepared",
  "source_frozen",
  "state_copied",
  "verified",
  "authority_switched",
  "legacy_read_only",
  "completed",
]);

const NEXT_PHASE = Object.freeze({
  prepared: "source_frozen",
  source_frozen: "state_copied",
  state_copied: "verified",
  verified: "authority_switched",
  authority_switched: "legacy_read_only",
  legacy_read_only: "completed",
});

function migrationError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphAuthorityMigrationError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requireDigest(value, label) {
  const digest = String(value || "");
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw migrationError(
      "CC_GRAPH_MIGRATION_EVIDENCE_INVALID",
      `${label} must be a sha256 digest`,
    );
  }
  return digest;
}

function requireSafePoint(evidence = {}) {
  const counts = [
    ["inFlightEffects", evidence.inFlightEffects],
    ["inFlightAttempts", evidence.inFlightAttempts],
    ["pendingMessages", evidence.pendingMessages],
  ];
  for (const [name, value] of counts) {
    if (Number(value) !== 0) {
      throw migrationError(
        "CC_GRAPH_MIGRATION_UNSAFE_POINT",
        `${name} must be zero before authority migration`,
        { field: name, value },
      );
    }
  }
  return {
    inFlightEffects: 0,
    inFlightAttempts: 0,
    pendingMessages: 0,
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stateFromEvents(events, migrationId) {
  return [...events]
    .reverse()
    .find(
      (event) =>
        event.payload?.migrationId === migrationId && event.payload?.state,
    )?.payload?.state;
}

/**
 * Durable, one-way authority migration. After authority_switched, recovery is
 * only allowed to continue forward with the canonical writer generation;
 * this API intentionally has no "fall back to legacy" operation.
 */
export class GraphAuthorityMigrationSaga {
  constructor({ store = new JsonlRolloutStore(), now = Date.now } = {}) {
    this.store = store;
    this.now = now;
  }

  begin({
    migrationId = randomUUID(),
    logicalRunId,
    originSurface,
    sourceAuthority,
    targetAuthority,
    sourceEventHead,
    sourceCheckpointDigest,
    safePoint,
  }) {
    const source = createGraphAuthorityBinding(sourceAuthority);
    const target = createGraphAuthorityBinding(targetAuthority);
    if (
      source.logicalRunId !== logicalRunId ||
      target.logicalRunId !== logicalRunId ||
      source.originSurface !== originSurface ||
      target.originSurface !== originSurface
    ) {
      throw migrationError(
        "CC_GRAPH_MIGRATION_AUTHORITY_MISMATCH",
        "migration authorities must bind the exact logical run and surface",
      );
    }
    if (
      source.authorityMode !== "legacy" ||
      target.authorityMode !== "canonical" ||
      target.authorityGeneration <= source.authorityGeneration
    ) {
      throw migrationError(
        "CC_GRAPH_MIGRATION_GENERATION_INVALID",
        "migration must move from legacy to a higher canonical generation",
      );
    }
    const eventHead = requireDigest(sourceEventHead, "sourceEventHead");
    if (source.eventHead !== eventHead || target.eventHead !== eventHead) {
      throw migrationError(
        "CC_GRAPH_MIGRATION_HEAD_CONFLICT",
        "source and target authority must bind the exact source event head",
      );
    }
    const id = String(migrationId);
    const threadId = `graph-migration:${id}`;
    const state = {
      schema: GRAPH_MIGRATION_SCHEMA,
      migrationId: id,
      logicalRunId,
      originSurface,
      phase: "prepared",
      sourceAuthority: source,
      targetAuthority: target,
      sourceEventHead: eventHead,
      sourceCheckpointDigest: requireDigest(
        sourceCheckpointDigest,
        "sourceCheckpointDigest",
      ),
      safePoint: requireSafePoint(safePoint),
      copiedEventHead: null,
      copiedCheckpointDigest: null,
      verificationDigest: null,
      switchedAt: null,
      legacyReadOnlyAt: null,
      completedAt: null,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.store.start({
      threadId,
      title: `Graph authority migration ${id}`,
      metadata: {
        kind: "graph_authority_migration",
        migrationId: id,
        logicalRunId,
        originSurface,
      },
    });
    const startedEvents = this.store.read(threadId);
    const event = this.store.append({
      threadId,
      eventType: "migration.prepared",
      idempotencyKey: `migration:${id}:prepared`,
      payload: { migrationId: id, state },
      expectedRevision: startedEvents.at(-1)?.seq,
      expectedHeadHash: startedEvents.at(-1)?.hash,
    });
    return Object.freeze({ ...clone(state), eventHead: event.hash });
  }

  recover(migrationId) {
    const id = String(migrationId);
    const events = this.store.read(`graph-migration:${id}`);
    const state = stateFromEvents(events, id);
    if (!state) {
      throw migrationError(
        "CC_GRAPH_MIGRATION_NOT_FOUND",
        `authority migration was not found: ${id}`,
      );
    }
    return Object.freeze({
      ...clone(state),
      eventHead: events.at(-1)?.hash || null,
    });
  }

  advance(migrationId, phase, evidence = {}) {
    const current = this.recover(migrationId);
    if (current.phase === "completed") return current;
    const expected = NEXT_PHASE[current.phase];
    if (phase !== expected) {
      throw migrationError(
        "CC_GRAPH_MIGRATION_PHASE_INVALID",
        `migration must advance from ${current.phase} to ${expected}`,
      );
    }
    const next = clone(current);
    delete next.eventHead;
    next.phase = phase;
    next.updatedAt = new Date(this.now()).toISOString();
    if (phase === "source_frozen") {
      next.safePoint = requireSafePoint(evidence);
      if (
        requireDigest(evidence.eventHead, "eventHead") !==
          current.sourceEventHead ||
        requireDigest(evidence.checkpointDigest, "checkpointDigest") !==
          current.sourceCheckpointDigest
      ) {
        throw migrationError(
          "CC_GRAPH_MIGRATION_HEAD_CONFLICT",
          "freeze evidence no longer matches the prepared source",
        );
      }
    } else if (phase === "state_copied") {
      next.copiedEventHead = requireDigest(
        evidence.copiedEventHead,
        "copiedEventHead",
      );
      next.copiedCheckpointDigest = requireDigest(
        evidence.copiedCheckpointDigest,
        "copiedCheckpointDigest",
      );
      if (
        next.copiedEventHead !== current.sourceEventHead ||
        next.copiedCheckpointDigest !== current.sourceCheckpointDigest
      ) {
        throw migrationError(
          "CC_GRAPH_MIGRATION_COPY_DIVERGED",
          "copied state does not preserve the source head and checkpoint",
        );
      }
    } else if (phase === "verified") {
      if (
        evidence.semanticEquivalent !== true ||
        evidence.effectCountConserved !== true ||
        evidence.terminalEvidenceEquivalent !== true
      ) {
        throw migrationError(
          "CC_GRAPH_MIGRATION_VERIFICATION_FAILED",
          "semantic, effect, and terminal evidence verification must all pass",
        );
      }
      next.verificationDigest = requireDigest(
        evidence.verificationDigest,
        "verificationDigest",
      );
    } else if (phase === "authority_switched") {
      const target = createGraphAuthorityBinding(evidence.targetAuthority);
      const sameTarget = [
        "schema",
        "logicalRunId",
        "originSurface",
        "authorityMode",
        "authoritySource",
        "authorityGeneration",
        "writerId",
        "writerLeaseId",
        "writerLeaseExpiresAt",
        "eventHead",
        "projectionVersion",
      ].every((field) => target[field] === current.targetAuthority[field]);
      if (
        !sameTarget ||
        requireDigest(evidence.eventHead, "eventHead") !==
          current.sourceEventHead
      ) {
        throw migrationError(
          "CC_GRAPH_MIGRATION_SWITCH_CONFLICT",
          "authority switch must use the pre-verified target and exact head",
        );
      }
      next.switchedAt = next.updatedAt;
    } else if (phase === "legacy_read_only") {
      if (evidence.legacyWriterProbeCount !== 0) {
        throw migrationError(
          "CC_GRAPH_LEGACY_WRITERS_REMAIN",
          "legacy mutation probes must be zero before read-only transition",
        );
      }
      next.legacyReadOnlyAt = next.updatedAt;
    } else if (phase === "completed") {
      if (evidence.rollbackDrillPassed !== true) {
        throw migrationError(
          "CC_GRAPH_ROLLBACK_UNVERIFIED",
          "migration completion requires a canonical-generation rollback drill",
        );
      }
      next.completedAt = next.updatedAt;
    }
    const threadId = `graph-migration:${current.migrationId}`;
    const events = this.store.read(threadId);
    const event = this.store.append({
      threadId,
      eventType: `migration.${phase}`,
      idempotencyKey: `migration:${current.migrationId}:${phase}`,
      payload: { migrationId: current.migrationId, state: next },
      expectedRevision: events.at(-1)?.seq,
      expectedHeadHash: events.at(-1)?.hash,
    });
    return Object.freeze({ ...clone(next), eventHead: event.hash });
  }
}
