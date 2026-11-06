import { describe, expect, it, vi } from "vitest";
import { GraphKernel } from "../../src/lib/graph-kernel/runtime.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import {
  SchedulerOccurrenceGraphAuthority,
  schedulerGraphAuthorityMode,
} from "../../src/lib/scheduler-kernel/graph-authority-adapter.js";

function context(id = "occurrence-1") {
  return {
    job: {
      id: "job-1",
      kind: "routine",
      revision: 1,
      retryPolicy: { maxAttempts: 2 },
    },
    occurrence: {
      id,
      jobRevision: 1,
      idempotencyKey: id,
      ownerId: "scheduler-owner",
      fence: 1,
      attempt: 1,
    },
    authority: { decisionId: "decision-1" },
  };
}

function eventStore() {
  return new GraphEventStore({
    rolloutStore: new MemoryRolloutStore(),
  });
}

class CrashAfterGraphAppendStore extends GraphEventStore {
  arm(type) {
    this.crashType = type;
  }

  append(...args) {
    const event = super.append(...args);
    if (args[1] === this.crashType) {
      this.crashType = null;
      throw new Error(`crash after ${args[1]}`);
    }
    return event;
  }
}

describe("Scheduler Graph terminal authority", () => {
  it("validates terminal native evidence through a read-only projection without acquiring a writer", () => {
    const store = eventStore(),
      authority = new SchedulerOccurrenceGraphAuthority({
        mode: "canonical",
        eventStore: store,
      });
    const c = context("read-only-terminal");
    authority.begin(c);
    authority.settleSuccess(c, { exact: "native" });
    const writes = vi.spyOn(store.rolloutStore, "append");
    expect(
      authority.validateCommittedResult(c, { exact: "native" }),
    ).toMatchObject({
      present: true,
      status: "succeeded",
      authorityMode: "canonical",
    });
    expect(writes).not.toHaveBeenCalled();
    expect(() =>
      authority.validateCommittedResult(c, { exact: "forged" }),
    ).toThrow("Native result and Graph terminal evidence differ");
    expect(writes).not.toHaveBeenCalled();
  });
  it("can read an active run without writing recovery events or attaching a writable run", () => {
    const store = eventStore(),
      authority = new SchedulerOccurrenceGraphAuthority({
        mode: "canonical",
        eventStore: store,
      });
    const c = context("read-only-active"),
      claim = authority.begin(c),
      writes = vi.spyOn(store.rolloutStore, "append");
    const reader = new GraphKernel({ eventStore: store });
    expect(reader.readRun(claim.runId)).toMatchObject({
      status: "running",
      authorityGeneration: 1,
    });
    expect(writes).not.toHaveBeenCalled();
    expect(() => reader.getRun(claim.runId)).toThrow("GraphRun not found");
  });
  it("rejects asynchronous native recovery instead of treating a promise as committed proof", () => {
    const store = eventStore(),
      c = context("promise-proof");
    const first = new SchedulerOccurrenceGraphAuthority({
      mode: "canonical",
      eventStore: store,
    });
    first.begin(c);
    first.settleFailure(c, new Error("unknown"));
    const recovered = new SchedulerOccurrenceGraphAuthority({
      mode: "canonical",
      eventStore: store,
      readCommittedResult: () => Promise.resolve({ found: true, result: {} }),
    });
    expect(() => recovered.begin(c)).toThrow(
      "Native recovery must synchronously report found",
    );
  });
  it("does not ask a native reader to bind proof to a changed Graph definition", () => {
    const store = eventStore(),
      c = context("changed-definition"),
      first = new SchedulerOccurrenceGraphAuthority({
        mode: "canonical",
        eventStore: store,
      });
    first.begin(c);
    const read = vi.fn(() => ({ found: true, result: {} }));
    const recovered = new SchedulerOccurrenceGraphAuthority({
      mode: "canonical",
      eventStore: store,
      readCommittedResult: read,
    });
    expect(() =>
      recovered.begin({ ...c, job: { ...c.job, revision: 2 } }),
    ).toThrow("Graph revision changed");
    expect(read).not.toHaveBeenCalled();
  });
  it("records the adapter result before scheduler projection settlement", () => {
    const store = eventStore();
    const authority = new SchedulerOccurrenceGraphAuthority({
      mode: "canonical",
      eventStore: store,
      createId: () => "scheduler-id",
    });
    const claim = authority.begin(context());
    expect(claim.alreadySettled).toBe(false);
    const projection = authority.settleSuccess(context(), { delivered: true });
    expect(projection).toMatchObject({
      status: "succeeded",
      originSurface: "scheduler",
      authoritySource: "graph_kernel",
      reconciliationEffectIds: [],
    });

    const recovered = new SchedulerOccurrenceGraphAuthority({
      mode: "canonical",
      eventStore: store,
      createId: () => "scheduler-recovery-id",
    }).begin(context());
    expect(recovered).toMatchObject({
      alreadySettled: true,
      result: { delivered: true },
      projection: { status: "succeeded", authorityGeneration: 2 },
    });
  });

  it("pins an existing canonical occurrence across a ledger rollback", () => {
    const store = eventStore();
    let selectedMode = "canonical";
    const resolveAuthority = ({ runKey }) => {
      expect(runKey).toMatch(/^scheduler:/u);
      return selectedMode;
    };
    const first = new SchedulerOccurrenceGraphAuthority({
      mode: "legacy",
      authorityResolver: resolveAuthority,
      eventStore: store,
      createId: () => "scheduler-rollback-first",
    });
    const claim = first.begin(context("occurrence-before-rollback"));
    expect(claim.authorityMode).toBe("canonical");
    first.settleSuccess(context("occurrence-before-rollback"), {
      delivered: true,
    });

    selectedMode = "legacy";
    const recovered = new SchedulerOccurrenceGraphAuthority({
      mode: "legacy",
      authorityResolver: resolveAuthority,
      eventStore: store,
      createId: () => "scheduler-rollback-recovered",
    }).begin(context("occurrence-before-rollback"));
    expect(recovered).toMatchObject({
      authorityMode: "canonical",
      alreadySettled: true,
    });
    expect(
      new SchedulerOccurrenceGraphAuthority({
        mode: "canonical",
        authorityResolver: resolveAuthority,
        eventStore: store,
      }).begin(context("occurrence-after-rollback")),
    ).toBeNull();
  });

  it("does not replay an adapter with an unknown effect outcome", () => {
    const authority = new SchedulerOccurrenceGraphAuthority({
      mode: "canonical",
      eventStore: eventStore(),
    });
    authority.begin(context("occurrence-unknown"));
    const projection = authority.settleFailure(
      context("occurrence-unknown"),
      new Error("connection lost after dispatch"),
    );
    expect(projection).toMatchObject({
      status: "reconciliation_required",
      reconciliationEffectIds: [expect.any(String)],
    });
  });

  it("recovers the result/effect cutpoint without replaying the adapter", () => {
    const store = new CrashAfterGraphAppendStore({
      rolloutStore: new MemoryRolloutStore(),
    });
    const first = new SchedulerOccurrenceGraphAuthority({
      mode: "canonical",
      eventStore: store,
      createId: () => "scheduler-cutpoint-first",
    });
    first.begin(context("occurrence-cutpoint"));
    store.arm("effect.settled");
    expect(() =>
      first.settleSuccess(context("occurrence-cutpoint"), { exact: "result" }),
    ).toThrowError(/crash after effect\.settled/u);

    const recovered = new SchedulerOccurrenceGraphAuthority({
      mode: "canonical",
      eventStore: store,
      createId: () => "scheduler-cutpoint-recovered",
    }).begin(context("occurrence-cutpoint"));
    expect(recovered).toMatchObject({
      alreadySettled: true,
      result: { exact: "result" },
      projection: { status: "succeeded", authorityGeneration: 2 },
    });
  });

  it("keeps rollout explicit", () => {
    expect(schedulerGraphAuthorityMode({})).toBe("legacy");
    expect(
      schedulerGraphAuthorityMode({
        CHAINLESSCHAIN_GRAPH_SCHEDULER: "shadow",
      }),
    ).toBe("shadow");
    expect(() =>
      schedulerGraphAuthorityMode({
        CHAINLESSCHAIN_GRAPH_SCHEDULER: "surprise",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_AUTHORITY_MODE_INVALID" }),
    );
  });
});
