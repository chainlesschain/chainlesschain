import { describe, expect, it } from "vitest";
import {
  validateGoalEvidenceProjection,
  formatGoalEvidenceProjection,
} from "@chainlesschain/session-core/goal-evidence-contract";

function evidence() {
  return {
    risk: {
      state: "insufficient-data",
      reviewId: "review-1",
      checkedAt: "2026-10-18T04:00:00.000Z",
      goalRevision: 2,
      controlGeneration: 1,
      riskTaskCount: null,
      reasonCodes: ["SOURCE_SCHEMA_INCOMPLETE"],
      history: true,
    },
    receipts: {
      state: "recorded",
      entries: [
        {
          id: "run-1",
          status: "unresolved",
          actionType: "task.create",
          goalRevision: 1,
          controlGeneration: 0,
          history: true,
        },
      ],
      hasMore: false,
    },
  };
}

describe("goal evidence transport contract", () => {
  it("keeps unknown risk and unresolved outcomes explicit in plaintext", () => {
    const result = formatGoalEvidenceProjection(evidence());
    expect(result.riskSummary).toContain("risk task count unknown");
    expect(result.riskSummary).toContain("does not establish current risk");
    expect(result.receiptSummary).toContain("run-1: unresolved");
    expect(result.receiptSummary).toContain("does not prove goal completion");
  });
  it.each([
    "risk-body",
    "receipt-body",
    "approval",
    "current-risk",
    "unknown-as-zero",
    "duplicate-receipt",
    "false-unavailable",
    "oversized-id",
    "control-character",
    "invalid-action",
    "too-many-receipts",
  ])("rejects forged or overbroad projection: %s", (mode) => {
    const value = evidence();
    if (mode === "risk-body") value.risk.snapshot = "PRIVATE";
    if (mode === "receipt-body")
      value.receipts.entries[0].description = "PRIVATE";
    if (mode === "approval") value.receipts.entries[0].approval = true;
    if (mode === "current-risk") value.risk.history = false;
    if (mode === "unknown-as-zero") value.risk.riskTaskCount = 0;
    if (mode === "duplicate-receipt")
      value.receipts.entries.push({ ...value.receipts.entries[0] });
    if (mode === "false-unavailable") value.receipts.state = "unavailable";
    if (mode === "oversized-id") value.receipts.entries[0].id = "x".repeat(257);
    if (mode === "control-character") value.risk.reviewId = "review\nforged";
    if (mode === "invalid-action")
      value.receipts.entries[0].actionType = "shell.execute";
    if (mode === "too-many-receipts")
      value.receipts.entries = Array.from({ length: 21 }, (_, i) => ({
        ...value.receipts.entries[0],
        id: `run-${i}`,
      }));
    expect(() => validateGoalEvidenceProjection(value)).toThrow(
      "GOAL_EVIDENCE_INVALID",
    );
  });
  it("validates all twenty receipts but bounds the displayed IDs to five", () => {
    const value = evidence();
    value.receipts.entries = Array.from({ length: 20 }, (_, i) => ({
      ...value.receipts.entries[0],
      id: `run-${i + 1}`,
    }));
    value.receipts.hasMore = true;
    const text = formatGoalEvidenceProjection(value).receiptSummary;
    expect(text).toContain(
      "20 in this page; older receipts exist. Showing 5 IDs",
    );
    expect(text).toContain("run-5:");
    expect(text).not.toContain("run-6:");
  });
});
