import { describe, expect, it, vi } from "vitest";

import {
  buildSkillOutcomeTranscriptAuthority,
  SKILL_OUTCOME_AUTHORITY_SCHEMA,
  unavailableSkillOutcomeTranscriptAuthority,
} from "../../src/lib/skill-outcome-transcript-authority.js";
import { settledSkillInvocationReceipt } from "../helpers/skill-invocation-receipt.js";

const selectedDigest = `sha256:${"a".repeat(64)}`;

function row(id) {
  return {
    id,
    _store: "jsonl",
    _presence: "present",
    _blocked: false,
  };
}

function toolEvent(receipt, tool = "run_skill") {
  return {
    type: "tool_call",
    data: { tool, skill_invocation_receipt: receipt },
  };
}

function reader(sessions) {
  return (sessionId, createProjection) => {
    const projection = createProjection();
    const events = sessions[sessionId] || [];
    for (const event of events) projection.accept(event);
    return projection.finish({
      headHash: "d".repeat(64),
      eventCount: events.length,
    });
  };
}

describe("Skill outcome transcript authority", () => {
  it("deduplicates verified receipts and aggregates success/correction rates", () => {
    const completed = settledSkillInvocationReceipt({
      receiptId: "receipt:1",
      graderReceipts: [`sha256:${"b".repeat(64)}`],
    });
    const correctedFailure = settledSkillInvocationReceipt({
      receiptId: "receipt:2",
      executionStatus: "failed",
      userCorrectionRef: "correction:1",
      graderReceipts: [`sha256:${"c".repeat(64)}`],
    });
    const sessions = {
      first: [toolEvent(completed)],
      second: [toolEvent(completed), toolEvent(correctedFailure)],
    };
    const authority = buildSkillOutcomeTranscriptAuthority(
      {},
      {
        listSessionAuthoritySummaries: () => [row("second"), row("first")],
        readVerifiedProjection: reader(sessions),
      },
    );

    expect(authority).toMatchObject({
      schema: SKILL_OUTCOME_AUTHORITY_SCHEMA,
      status: "verified",
      metrics: {
        [selectedDigest]: {
          samples: 2,
          successRate: 0.5,
          correctionRate: 0.5,
        },
      },
      evidence: {
        status: "verified",
        selectedSessionCount: 2,
        receiptCount: 3,
        uniqueReceiptCount: 2,
        attributionEligibleReceiptCount: 2,
        outcomeEligibleReceiptCount: 2,
        duplicateReceiptCount: 1,
      },
    });
    expect(authority.evidence.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("produces the same source digest regardless of authority row order", () => {
    const sessions = { a: [], b: [] };
    const dependencies = {
      readVerifiedProjection: reader(sessions),
    };
    const left = buildSkillOutcomeTranscriptAuthority(
      {},
      {
        ...dependencies,
        listSessionAuthoritySummaries: () => [row("a"), row("b")],
      },
    );
    const right = buildSkillOutcomeTranscriptAuthority(
      {},
      {
        ...dependencies,
        listSessionAuthoritySummaries: () => [row("b"), row("a")],
      },
    );
    expect(left.evidence.sourceDigest).toBe(right.evidence.sourceDigest);
  });

  it("does not equate execution completion or blocking with graded outcome", () => {
    const ungraded = settledSkillInvocationReceipt({ receiptId: "ungraded" });
    const blocked = settledSkillInvocationReceipt({
      receiptId: "blocked",
      executionStatus: "blocked",
      graderReceipts: [`sha256:${"e".repeat(64)}`],
    });
    const authority = buildSkillOutcomeTranscriptAuthority(
      {},
      {
        listSessionAuthoritySummaries: () => [row("one")],
        readVerifiedProjection: reader({
          one: [toolEvent(ungraded), toolEvent(blocked)],
        }),
      },
    );
    expect(authority.metrics).toEqual({});
    expect(authority.evidence).toMatchObject({
      attributionEligibleReceiptCount: 2,
      outcomeEligibleReceiptCount: 0,
    });
  });

  it("fails closed before reading when any selected authority row is blocked", () => {
    const readVerifiedProjection = vi.fn();
    expect(() =>
      buildSkillOutcomeTranscriptAuthority(
        {},
        {
          listSessionAuthoritySummaries: () => [
            row("good"),
            { ...row("blocked"), _blocked: true },
          ],
          readVerifiedProjection,
        },
      ),
    ).toThrow(/blocked row/i);
    expect(readVerifiedProjection).not.toHaveBeenCalled();
  });

  it("rejects digest tamper, event misbinding, and receipt overflow", () => {
    const receipt = settledSkillInvocationReceipt();
    const dependencies = (events) => ({
      listSessionAuthoritySummaries: () => [row("one")],
      readVerifiedProjection: reader({ one: events }),
    });
    expect(() =>
      buildSkillOutcomeTranscriptAuthority(
        {},
        dependencies([toolEvent({ ...receipt, executionStatus: "failed" })]),
      ),
    ).toThrow(/digest is invalid/i);
    expect(() =>
      buildSkillOutcomeTranscriptAuthority(
        {},
        dependencies([toolEvent(receipt, "read_file")]),
      ),
    ).toThrow(/non-Skill event/i);
    expect(() =>
      buildSkillOutcomeTranscriptAuthority(
        { maxReceipts: 1 },
        dependencies([toolEvent(receipt), toolEvent(receipt)]),
      ),
    ).toThrow(/capacity exceeded/i);
  });

  it("never returns a favorable partial aggregate after a projection failure", () => {
    const completed = settledSkillInvocationReceipt();
    const readVerifiedProjection = vi.fn((sessionId, createProjection) => {
      if (sessionId === "broken") throw new Error("corrupt transcript detail");
      const projection = createProjection();
      projection.accept(toolEvent(completed));
      return projection.finish({
        headHash: "e".repeat(64),
        eventCount: 1,
      });
    });
    expect(() =>
      buildSkillOutcomeTranscriptAuthority(
        {},
        {
          listSessionAuthoritySummaries: () => [row("good"), row("broken")],
          readVerifiedProjection,
        },
      ),
    ).toThrow("corrupt transcript detail");
    expect(readVerifiedProjection).toHaveBeenCalledTimes(2);
  });

  it("projects failures to a bounded public unavailable status", () => {
    const authority = unavailableSkillOutcomeTranscriptAuthority(
      Object.assign(new Error("C:/secret/transcript.jsonl"), {
        code: "SESSION_TRANSCRIPT_UNVERIFIED",
      }),
    );
    expect(authority).toEqual({
      schema: SKILL_OUTCOME_AUTHORITY_SCHEMA,
      status: "unavailable",
      metrics: null,
      evidence: {
        schema: SKILL_OUTCOME_AUTHORITY_SCHEMA,
        status: "unavailable",
        code: "CC_SKILL_OUTCOME_AUTHORITY_UNAVAILABLE",
      },
    });
    expect(JSON.stringify(authority)).not.toContain("secret");
  });
});
