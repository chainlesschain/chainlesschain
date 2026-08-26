import { describe, expect, it } from "vitest";
import {
  normalizeRemoteApprovalDecision,
  REMOTE_APPROVAL_DECISION_CAPABILITY,
  requireRemoteApprovalDecision,
} from "../../src/lib/remote-approval-decision.js";

describe("remote approval canonical decision boundary", () => {
  it("accepts the binary canonical decisions with matching N-1 projections", () => {
    expect(
      normalizeRemoteApprovalDecision({
        decision: { kind: "acceptOnce" },
        answer: true,
        approved: true,
      }),
    ).toEqual({
      ok: true,
      approved: true,
      kind: "acceptOnce",
      canonical: true,
    });
    expect(
      normalizeRemoteApprovalDecision({
        decision: { kind: "decline", reason: "not now" },
        approved: false,
      }),
    ).toEqual({
      ok: true,
      approved: false,
      kind: "decline",
      canonical: true,
    });
  });

  it("keeps N-1 boolean clients compatible unless canonical was negotiated", () => {
    expect(normalizeRemoteApprovalDecision({ answer: "yes" })).toMatchObject({
      ok: true,
      approved: true,
      canonical: false,
    });
    expect(
      normalizeRemoteApprovalDecision(
        { approved: false },
        { requireCanonical: true },
      ),
    ).toEqual({ ok: false, reason: "canonical-decision-required" });
    expect(REMOTE_APPROVAL_DECISION_CAPABILITY).toBe("approval-decision-v1");
  });

  it("rejects conflicts, invalid schema values, grants, and cancel", () => {
    expect(
      normalizeRemoteApprovalDecision({
        decision: { kind: "acceptOnce" },
        approved: false,
      }),
    ).toEqual({
      ok: false,
      reason: "canonical-legacy-decision-conflict",
    });
    expect(
      normalizeRemoteApprovalDecision({ answer: true, approved: false }),
    ).toEqual({ ok: false, reason: "legacy-decision-conflict" });
    expect(
      normalizeRemoteApprovalDecision({
        decision: { kind: "acceptOnce", permissions: [] },
      }),
    ).toEqual({ ok: false, reason: "canonical-decision-invalid" });
    for (const kind of ["acceptForTurn", "acceptForSession", "cancel"]) {
      expect(normalizeRemoteApprovalDecision({ decision: { kind } })).toEqual({
        ok: false,
        reason: "remote-decision-kind-not-supported",
      });
    }
    expect(() =>
      requireRemoteApprovalDecision({ decision: { kind: "cancel" } }),
    ).toThrow(/remote-decision-kind-not-supported/);
  });
});
