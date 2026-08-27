import { describe, expect, it } from "vitest";
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
