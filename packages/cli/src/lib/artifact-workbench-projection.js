import { publicArtifactMetadata } from "./artifact-store.js";
import { readArtifactAccessLedger } from "./artifact-access-ledger.js";
import { readArtifactCleanupLedger } from "./artifact-cleanup-ledger.js";
import { readArtifactDeletionLedger } from "./artifact-deletion-ledger.js";
import {
  buildArtifactRecoveryPlan,
  readArtifactOrphanGcLedger,
} from "./artifact-recovery.js";

export const ARTIFACT_WORKBENCH_PROJECTION_SCHEMA = "cc-artifact-workbench/v1";
export const MAX_ARTIFACT_WORKBENCH_ACTIVITY = 200;

function returnedResultLineage(lineage) {
  if (lineage?.schema !== "cc-execution-location-result-artifact-lineage/v1") {
    return null;
  }
  const fields = [
    "sessionId",
    "requestId",
    "reviewDigest",
    "item",
    "kind",
    "mediaType",
    "byteLength",
    "sourceDigest",
  ];
  if (fields.some((field) => lineage[field] == null)) return null;
  return Object.freeze(
    Object.fromEntries(fields.map((field) => [field, lineage[field]])),
  );
}

function accessActivity(event) {
  return Object.freeze({
    type: "access",
    occurredAt: event.authorizedAt,
    artifactId: event.artifactId,
    artifactSessionId: event.artifactSessionId,
    recordDigest: event.recordDigest,
    action: event.action,
    client: event.client,
    settlementId: event.accessId,
    eventDigest: event.eventDigest,
  });
}

function deletionActivity(event) {
  return Object.freeze({
    type: "deletion",
    phase: event.phase,
    occurredAt: event.occurredAt,
    artifactId: event.artifactId,
    artifactSessionId: event.artifactSessionId,
    recordDigest: event.recordDigest,
    action: event.reason,
    client: event.client,
    settlementId: event.deletionId,
    eventDigest: event.eventDigest,
  });
}

function cleanupActivity(event) {
  return Object.freeze({
    type: "cleanup",
    phase: event.phase,
    occurredAt: event.occurredAt,
    artifactId: null,
    artifactSessionId: null,
    recordDigest: null,
    action: "expired",
    client: event.client,
    settlementId: event.cleanupId,
    itemCount: event.itemCount,
    eventDigest: event.eventDigest,
  });
}

function orphanGcActivity(event) {
  return Object.freeze({
    type: "orphan-gc",
    phase: event.phase,
    occurredAt: event.occurredAt,
    artifactId: null,
    artifactSessionId: null,
    recordDigest: null,
    action: event.decision,
    client: "administrator",
    settlementId: event.adjudicationId,
    outcome: event.outcome,
    eventDigest: event.eventDigest,
  });
}

function occurredAtMs(event) {
  const parsed = Date.parse(event.occurredAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildArtifactWorkbenchProjection(store, options = {}) {
  if (!store?.dir) {
    throw new TypeError("artifact workbench requires an ArtifactStore");
  }
  const recovery = (
    options.buildArtifactRecoveryPlan || buildArtifactRecoveryPlan
  )(store, options.recoveryOptions || {});
  const access = (options.readArtifactAccessLedger || readArtifactAccessLedger)(
    store,
    options.accessOptions || {},
  );
  const deletion = (
    options.readArtifactDeletionLedger || readArtifactDeletionLedger
  )(store, options.deletionOptions || {});
  const cleanup = (
    options.readArtifactCleanupLedger || readArtifactCleanupLedger
  )(store, options.cleanupOptions || {});
  const orphanGc = (
    options.readArtifactOrphanGcLedger || readArtifactOrphanGcLedger
  )(store, options.orphanGcOptions || {});
  const accessByArtifact = new Map();
  for (const event of access.events) {
    const events = accessByArtifact.get(event.artifactId) || [];
    events.push(event);
    accessByArtifact.set(event.artifactId, events);
  }
  const artifacts = store.list().map((entry) => {
    const metadata = publicArtifactMetadata(entry);
    const accesses = accessByArtifact.get(entry.id) || [];
    const latestAccess = accesses.at(-1) || null;
    return Object.freeze({
      ...metadata,
      returnedResult: returnedResultLineage(metadata.lineage),
      history: Object.freeze({
        accessCount: accesses.length,
        latestAccess: latestAccess
          ? Object.freeze({
              action: latestAccess.action,
              client: latestAccess.client,
              authorizedAt: latestAccess.authorizedAt,
              eventDigest: latestAccess.eventDigest,
            })
          : null,
      }),
    });
  });
  const allActivity = [
    ...access.events.map(accessActivity),
    ...deletion.events.map(deletionActivity),
    ...cleanup.events.map(cleanupActivity),
    ...orphanGc.events.map(orphanGcActivity),
  ].sort((left, right) => {
    const time = occurredAtMs(right) - occurredAtMs(left);
    return time || right.eventDigest.localeCompare(left.eventDigest);
  });
  const activity = allActivity.slice(0, MAX_ARTIFACT_WORKBENCH_ACTIVITY);
  return Object.freeze({
    schema: ARTIFACT_WORKBENCH_PROJECTION_SCHEMA,
    observedAt: recovery.observedAt,
    artifacts: Object.freeze(artifacts),
    recovery,
    history: Object.freeze({
      accessHeadDigest: access.headDigest,
      deletionHeadDigest: deletion.headDigest,
      cleanupHeadDigest: cleanup.headDigest,
      orphanGcHeadDigest: orphanGc.headDigest,
      totalEventCount: allActivity.length,
      returnedEventCount: activity.length,
      truncated: allActivity.length > activity.length,
      activity: Object.freeze(activity),
    }),
  });
}
