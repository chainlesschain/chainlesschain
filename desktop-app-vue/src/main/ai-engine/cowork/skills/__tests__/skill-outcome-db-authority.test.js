import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const {
  startSkillInvocation,
  settleSkillInvocation,
} = require("../skill-invocation-receipt.js");
const {
  DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
  buildDesktopSkillOutcomeAuthority,
  unavailableDesktopSkillOutcomeAuthority,
} = require("../skill-outcome-db-authority.js");

const digest = (character) => `sha256:${character.repeat(64)}`;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function redigestReceipt(value) {
  const core = { ...value };
  delete core.receiptDigest;
  return {
    ...core,
    receiptDigest: `sha256:${createHash("sha256")
      .update(`${core.schema}\0${canonicalJson(core)}`)
      .digest("hex")}`,
  };
}

function receipt(overrides = {}) {
  const started = startSkillInvocation(
    {
      receiptId: overrides.receiptId || "desktop-receipt:1",
      selectedSkillDigest: digest("a"),
      routerCandidates: [
        { digest: digest("a"), score: 1, reason: "test candidate" },
      ],
      evolutionRunId: "evolution:test",
      traceId: "trace:test",
      trajectorySegmentId: "segment:test",
      providerModelVersion: "provider/model@1",
      toolSetDigest: digest("b"),
      osSandboxPermissionPolicyDigest: digest("c"),
      taskCohort: "test",
      attributionRequired: true,
    },
    { clock: () => "2026-09-03T00:00:00.000Z" },
  );
  return settleSkillInvocation(
    started,
    {
      executionStatus: overrides.executionStatus || "completed",
      graderReceipts: overrides.graderReceipts || [],
      userCorrectionRef: overrides.userCorrectionRef || null,
      tokensInput: 1,
      tokensOutput: 1,
      costUsd: 0,
      latencyMs: 1,
    },
    { clock: () => "2026-09-03T00:00:01.000Z" },
  );
}

function row(id, value) {
  return { id, context_json: JSON.stringify({ invocationReceipt: value }) };
}

describe("Desktop Skill outcome DB authority", () => {
  it("queries the bounded canonical table and aggregates graded receipts", async () => {
    const completed = receipt({
      receiptId: "desktop-receipt:completed",
      graderReceipts: [digest("d")],
    });
    const correctedFailure = receipt({
      receiptId: "desktop-receipt:failed",
      executionStatus: "failed",
      graderReceipts: [digest("e")],
      userCorrectionRef: "correction:1",
    });
    const database = {
      all: vi.fn(async () => [
        row("row-1", completed),
        row("row-2", completed),
        row("row-3", correctedFailure),
      ]),
    };

    const authority = await buildDesktopSkillOutcomeAuthority({ database });
    expect(database.all).toHaveBeenCalledWith(
      expect.stringContaining("FROM skill_execution_metrics"),
      [10_001],
    );
    expect(authority).toMatchObject({
      schema: DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
      status: "verified-local-db",
      metrics: {
        [digest("a")]: {
          samples: 2,
          successRate: 0.5,
          correctionRate: 0.5,
        },
      },
      evidence: {
        rowCount: 3,
        receiptCount: 3,
        uniqueReceiptCount: 2,
        attributionEligibleReceiptCount: 2,
        outcomeEligibleReceiptCount: 2,
        duplicateReceiptCount: 1,
        antiRollbackWitness: false,
      },
    });
    expect(authority.evidence.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("does not treat ungraded completion or blocked execution as outcome", async () => {
    const database = {
      all: async () => [
        row("ungraded", receipt({ receiptId: "ungraded" })),
        row(
          "blocked",
          receipt({
            receiptId: "blocked",
            executionStatus: "blocked",
            graderReceipts: [digest("f")],
          }),
        ),
      ],
    };
    const authority = await buildDesktopSkillOutcomeAuthority({ database });
    expect(authority.metrics).toEqual({});
    expect(authority.evidence).toMatchObject({
      attributionEligibleReceiptCount: 2,
      outcomeEligibleReceiptCount: 0,
    });
  });

  it("fails closed on receipt tamper, invalid context, and row overflow", async () => {
    const valid = receipt();
    await expect(
      buildDesktopSkillOutcomeAuthority({
        database: {
          all: async () => [
            row("tampered", { ...valid, executionStatus: "failed" }),
          ],
        },
      }),
    ).rejects.toThrow(/digest is invalid/i);
    await expect(
      buildDesktopSkillOutcomeAuthority({
        database: { all: async () => [{ id: "bad", context_json: "{" }] },
      }),
    ).rejects.toThrow(/context JSON is invalid/i);
    await expect(
      buildDesktopSkillOutcomeAuthority({
        maxRows: 1,
        database: {
          all: async () => [row("one", valid), row("two", valid)],
        },
      }),
    ).rejects.toMatchObject({
      code: "CC_DESKTOP_SKILL_OUTCOME_AUTHORITY_CAPACITY",
    });
  });

  it("rejects a redigested receipt with inconsistent attribution state", async () => {
    const inconsistent = redigestReceipt({
      ...receipt({
        receiptId: "inconsistent-attribution",
        graderReceipts: [digest("d")],
      }),
      attributionStatus: "incomplete",
      missingAttribution: ["traceId"],
    });
    await expect(
      buildDesktopSkillOutcomeAuthority({
        database: { all: async () => [row("inconsistent", inconsistent)] },
      }),
    ).rejects.toThrow(/attribution is invalid|receipt is invalid/i);
  });

  it("does not expose database failure details in unavailable evidence", () => {
    const authority = unavailableDesktopSkillOutcomeAuthority(
      new Error("C:/private/database.sqlite"),
    );
    expect(authority).toEqual({
      schema: DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
      status: "unavailable",
      metrics: null,
      evidence: {
        schema: DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
        status: "unavailable",
        code: "CC_DESKTOP_SKILL_OUTCOME_AUTHORITY_UNAVAILABLE",
        antiRollbackWitness: false,
      },
    });
    expect(JSON.stringify(authority)).not.toContain("private");
  });
});
