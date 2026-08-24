import { createHash } from "node:crypto";
import { MemoryRolloutStore } from "../app-server/rollout-store.js";

const JOURNAL_THREAD_ID = "scheduler-graph-dispatch";

function dispatchKey(occurrence) {
  const jobRevision = String(occurrence?.jobRevision || "").trim();
  const occurrenceId = String(
    occurrence?.occurrenceId || occurrence?.idempotencyKey || "",
  ).trim();
  if (!jobRevision || !occurrenceId) {
    const error = new Error(
      "scheduler dispatch requires jobRevision and occurrence identity",
    );
    error.code = "CC_GRAPH_OCCURRENCE_INVALID";
    throw error;
  }
  return `${jobRevision}\0${occurrenceId}`;
}

function keyDigest(key) {
  return createHash("sha256").update(key).digest("hex");
}

export class SchedulerGraphDispatchJournal {
  constructor({ store = new MemoryRolloutStore() } = {}) {
    this.store = store;
    this.store.start({
      threadId: JOURNAL_THREAD_ID,
      title: "Scheduler to Graph dispatch journal",
      metadata: { kind: "scheduler_graph_dispatch" },
    });
  }

  append(key, phase, payload) {
    const digest = keyDigest(key);
    return this.store.append({
      threadId: JOURNAL_THREAD_ID,
      eventType: `dispatch.${phase}`,
      idempotencyKey: `dispatch:${digest}:${phase}`,
      payload: { keyDigest: digest, phase, ...payload },
    });
  }

  read(key) {
    const digest = keyDigest(key);
    return this.store
      .read(JOURNAL_THREAD_ID)
      .filter((event) => event.payload?.keyDigest === digest)
      .map((event) => event.payload);
  }
}

export class SchedulerGraphTriggerAdapter {
  constructor({ kernel, journal = new SchedulerGraphDispatchJournal() } = {}) {
    if (!kernel)
      throw new TypeError(
        "SchedulerGraphTriggerAdapter requires a GraphKernel",
      );
    this.kernel = kernel;
    this.journal = journal;
  }

  dispatch(occurrence, compiledGraph, options = {}) {
    const key = dispatchKey(occurrence);
    const digest = keyDigest(key);
    const runId = options.runId || `graph-run-${digest.slice(0, 32)}`;
    const journalEntries = this.journal.read(key);
    const existing = journalEntries.find((entry) => entry.phase === "accepted");
    if (existing) {
      let run;
      try {
        run = this.kernel.getRun(existing.runId);
      } catch {
        run = this.kernel.recoverRun(existing.runId);
      }
      return Object.freeze({
        occurrenceStatus: "succeeded",
        dispatchStatus: "accepted",
        graphRun: run,
        replayed: true,
      });
    }
    const pending = [...journalEntries]
      .reverse()
      .find((entry) => entry.phase === "pending");
    if (pending) {
      try {
        const graphRun = this.kernel.recoverRun(pending.runId);
        if (graphRun.revisionDigest !== compiledGraph.revisionDigest) {
          const error = new Error(
            "pending scheduler dispatch is bound to a different GraphRevision",
          );
          error.code = "CC_GRAPH_OCCURRENCE_CONFLICT";
          throw error;
        }
        this.journal.append(key, "accepted", {
          runId: graphRun.id,
          graphRevision: graphRun.graphRevision,
          revisionDigest: graphRun.revisionDigest,
        });
        return Object.freeze({
          occurrenceStatus: "succeeded",
          dispatchStatus: "accepted",
          graphRun,
          replayed: true,
          recoveredAfterCrash: true,
        });
      } catch (error) {
        if (
          ![
            "CC_GRAPH_RECOVERY_UNAVAILABLE",
            "CC_ROLLOUT_THREAD_NOT_FOUND",
          ].includes(error?.code)
        ) {
          throw error;
        }
      }
    }
    this.journal.append(key, "pending", {
      runId,
      jobRevision: occurrence.jobRevision,
      occurrenceId: occurrence.occurrenceId || occurrence.idempotencyKey,
      definitionDigest: compiledGraph.revisionDigest,
    });
    try {
      const graphRun = this.kernel.startRun(compiledGraph, {
        ...options,
        runId,
        occurrenceRef: {
          jobRevision: occurrence.jobRevision,
          occurrenceId: occurrence.occurrenceId || occurrence.idempotencyKey,
          idempotencyKey: occurrence.idempotencyKey || occurrence.occurrenceId,
        },
      });
      this.journal.append(key, "accepted", {
        runId: graphRun.id,
        graphRevision: graphRun.graphRevision,
        revisionDigest: graphRun.revisionDigest,
      });
      // Scheduler success means only that the idempotent start/wake was
      // durably admitted. GraphRun status remains a separate state machine.
      return Object.freeze({
        occurrenceStatus: "succeeded",
        dispatchStatus: "accepted",
        graphRun,
        replayed: false,
      });
    } catch (error) {
      this.journal.append(key, "failed", {
        runId,
        code: error?.code || "CC_GRAPH_DISPATCH_FAILED",
      });
      throw error;
    }
  }

  status(occurrence) {
    const key = dispatchKey(occurrence);
    const entries = this.journal.read(key);
    const accepted = [...entries]
      .reverse()
      .find((entry) => entry.phase === "accepted");
    if (!accepted) {
      return Object.freeze({
        occurrenceStatus: entries.some((entry) => entry.phase === "failed")
          ? "failed"
          : "pending",
        graphRun: null,
      });
    }
    let graphRun;
    try {
      graphRun = this.kernel.getRun(accepted.runId);
    } catch {
      graphRun = this.kernel.recoverRun(accepted.runId);
    }
    return Object.freeze({
      occurrenceStatus: "succeeded",
      graphRun,
    });
  }
}
