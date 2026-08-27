import path from "node:path";
import {
  JsonlRolloutStore,
  defaultRolloutStoreDirectory,
} from "../app-server/rollout-store.js";

export const GRAPH_EVENT_SCHEMA = "chainlesschain.graph-event/v1";

export function defaultGraphEventStoreDirectory() {
  return path.join(path.dirname(defaultRolloutStoreDirectory()), "graph-runs");
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class GraphEventStore {
  constructor({
    rolloutStore = new JsonlRolloutStore({
      directory: defaultGraphEventStoreDirectory(),
    }),
  } = {}) {
    this.rolloutStore = rolloutStore;
  }

  start(runId, metadata = {}) {
    this.rolloutStore.start({
      threadId: runId,
      title: `GraphRun ${runId}`,
      metadata: { kind: "graph_run", ...metadata },
    });
    return this.head(runId);
  }

  append(
    runId,
    type,
    payload,
    {
      idempotencyKey = null,
      traceId = null,
      authority = null,
      expectedRevision = undefined,
      expectedHeadHash = undefined,
    } = {},
  ) {
    const record = this.rolloutStore.append({
      threadId: runId,
      eventType: `graph.${type}`,
      traceId,
      idempotencyKey,
      expectedRevision,
      expectedHeadHash,
      payload: {
        schema: GRAPH_EVENT_SCHEMA,
        type,
        authority: clone(authority),
        ...clone(payload),
      },
    });
    return Object.freeze({
      schema: GRAPH_EVENT_SCHEMA,
      runId,
      seq: record.event_seq,
      type,
      timestamp: record.timestamp,
      prevHash: record.prev_hash,
      hash: record.hash,
      idempotencyKey: record.idempotency_key,
      payload: clone(record.payload),
    });
  }

  read(runId, { afterSeq = 0, limit = 100_000 } = {}) {
    return this.rolloutStore
      .read(runId, { afterSeq, limit })
      .filter((record) => record.event_type.startsWith("graph."))
      .map((record) =>
        Object.freeze({
          schema: GRAPH_EVENT_SCHEMA,
          runId,
          seq: record.event_seq,
          type: record.payload?.type || record.event_type.slice(6),
          timestamp: record.timestamp,
          prevHash: record.prev_hash,
          hash: record.hash,
          idempotencyKey: record.idempotency_key,
          payload: clone(record.payload),
        }),
      );
  }

  head(runId) {
    const events = this.rolloutStore.read(runId);
    const record = events.at(-1);
    return record
      ? Object.freeze({ seq: record.event_seq, hash: record.hash })
      : Object.freeze({ seq: 0, hash: null });
  }

  listRuns(options = {}) {
    return this.rolloutStore
      .list({ includeArchived: true, ...options })
      .filter((thread) => thread.metadata?.kind === "graph_run")
      .map((thread) =>
        Object.freeze({
          runId: thread.id,
          revision: thread.revision,
          headHash: thread.headHash,
          status: thread.status,
          updatedAt: thread.updatedAt,
        }),
      );
  }
}
