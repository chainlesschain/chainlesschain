import { describe, expect, it } from "vitest";
import { DiffReviewFollowUpTracker } from "../../src/lib/diff-review-follow-up.js";
import { SideEffectLedger } from "../../src/lib/side-effect-ledger.js";

function audit(overrides = {}) {
  return {
    schema: "cc-diff-review/v1",
    reviewId: "drev_request",
    createdAt: "2026-07-23T00:00:00.000Z",
    sessionId: "sess-1",
    turnId: "run-1:t1",
    toolUseId: "call-1",
    path: "/repo/a.js",
    operation: "modify",
    outcome: "changes-requested",
    written: false,
    ...overrides,
  };
}

function startedLedger(...ids) {
  const ledger = new SideEffectLedger();
  for (const id of ids) {
    ledger
      .prepare(id, { kind: "file-write", meta: { tool: "edit_file" } })
      .start(id);
  }
  return ledger;
}

describe("DiffReviewFollowUpTracker", () => {
  it("links the next same-file review back to the original request", () => {
    const ledger = startedLedger("op-request", "op-follow-up");
    const tracker = new DiffReviewFollowUpTracker();
    tracker.observe(ledger, "op-request", audit());
    expect(ledger.get("op-request").meta.diffReview.followUp).toEqual({
      status: "pending",
      requestedAt: "2026-07-23T00:00:00.000Z",
    });

    const updates = tracker.observe(
      ledger,
      "op-follow-up",
      audit({
        reviewId: "drev_accept",
        createdAt: "2026-07-23T00:01:00.000Z",
        turnId: "run-1:t2",
        toolUseId: "call-2",
        outcome: "accepted",
        written: true,
      }),
    );

    expect(updates).toHaveLength(1);
    expect(ledger.get("op-request").meta.diffReview.followUp).toEqual({
      status: "accepted",
      reviewId: "drev_accept",
      turnId: "run-1:t2",
      toolUseId: "call-2",
      operation: "modify",
      targetPath: null,
      written: true,
      completedAt: "2026-07-23T00:01:00.000Z",
    });
    expect(ledger.get("op-follow-up").meta.diffReview).not.toHaveProperty(
      "followUp",
    );
    expect(ledger.get("op-follow-up").meta.diffReview.followUpOfReviewId).toBe(
      "drev_request",
    );
    expect(tracker.pendingCount).toBe(0);
  });

  it("chains repeated change requests and closes a turn without a re-proposal", () => {
    const ledger = startedLedger("op-1", "op-2");
    const tracker = new DiffReviewFollowUpTracker();
    tracker.observe(ledger, "op-1", audit());
    tracker.observe(
      ledger,
      "op-2",
      audit({
        reviewId: "drev_second",
        turnId: "run-1:t2",
        toolUseId: "call-2",
      }),
    );
    expect(ledger.get("op-1").meta.diffReview.followUp.status).toBe(
      "changes-requested",
    );
    expect(ledger.get("op-2").meta.diffReview.followUp.status).toBe("pending");

    tracker.complete(ledger, {
      status: "completed-without-reproposal",
      turnId: "run-1:t3",
    });
    expect(ledger.get("op-2").meta.diffReview.followUp).toMatchObject({
      status: "completed-without-reproposal",
      turnId: "run-1:t3",
    });
    expect(tracker.pendingCount).toBe(0);
  });

  it("does not cross-associate different paths", () => {
    const ledger = startedLedger("op-a", "op-b");
    const tracker = new DiffReviewFollowUpTracker();
    tracker.observe(ledger, "op-a", audit());
    tracker.observe(
      ledger,
      "op-b",
      audit({
        reviewId: "drev_other",
        path: "/repo/b.js",
        outcome: "accepted",
        written: true,
      }),
    );
    expect(ledger.get("op-a").meta.diffReview.followUp.status).toBe("pending");
    expect(tracker.pendingCount).toBe(1);
  });

  it("rehydrates a pending request after ledger serialization", () => {
    const before = startedLedger("op-request");
    new DiffReviewFollowUpTracker().observe(before, "op-request", audit());
    const ledger = SideEffectLedger.fromJSON(
      JSON.parse(JSON.stringify(before.toJSON())),
    );
    ledger
      .prepare("op-follow-up", { kind: "file-write" })
      .start("op-follow-up");
    const tracker = new DiffReviewFollowUpTracker(ledger);
    tracker.observe(
      ledger,
      "op-follow-up",
      audit({
        reviewId: "drev_after_resume",
        turnId: "run-2:t1",
        toolUseId: "call-9",
        outcome: "rejected",
      }),
    );
    expect(ledger.get("op-request").meta.diffReview.followUp).toMatchObject({
      status: "rejected",
      reviewId: "drev_after_resume",
      turnId: "run-2:t1",
      toolUseId: "call-9",
    });
  });
});
