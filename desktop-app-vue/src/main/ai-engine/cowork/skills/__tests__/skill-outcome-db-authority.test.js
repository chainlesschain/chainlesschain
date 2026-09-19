import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA,
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
      environmentDigest: overrides.environmentDigest ?? digest("e"),
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

function legacyReceipt(overrides = {}) {
  const core = { ...receipt(overrides) };
  delete core.environmentDigest;
  delete core.receiptDigest;
  core.schema = LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA;
  return redigestReceipt(core);
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

  it("excludes legacy and stale-environment history from live routing metrics", async () => {
    const current = receipt({
      receiptId: "desktop-receipt:current",
      graderReceipts: [digest("d")],
    });
    const stale = receipt({
      receiptId: "desktop-receipt:stale",
      environmentDigest: digest("f"),
      graderReceipts: [digest("d")],
    });
    const legacy = legacyReceipt({
      receiptId: "desktop-receipt:legacy",
      graderReceipts: [digest("d")],
    });
    const authority = await buildDesktopSkillOutcomeAuthority({
      database: {
        all: async () => [
          row("current", current),
          row("stale", stale),
          row("legacy", legacy),
        ],
      },
      expectedEnvironmentDigest: digest("e"),
    });

    expect(authority.metrics[digest("a")]).toMatchObject({
      samples: 1,
      successRate: 1,
    });
    expect(authority.evidence).toMatchObject({
      receiptCount: 3,
      uniqueReceiptCount: 3,
      attributionEligibleReceiptCount: 1,
      outcomeEligibleReceiptCount: 1,
      legacyEnvironmentUnboundReceiptCount: 1,
      staleEnvironmentReceiptCount: 1,
      incompleteAttributionReceiptCount: 0,
      environmentPolicy: "current",
    });
  });

  it("reopens a real mixed-version SQLite history without restoring stale eligibility", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "desktop-outcome-mixed-"),
    );
    const databasePath = path.join(root, "skills.sqlite");
    let sqlite = new Database(databasePath);
    try {
      sqlite.exec(`CREATE TABLE skill_execution_metrics (
        id TEXT PRIMARY KEY,
        context_json TEXT,
        completed_at TEXT NOT NULL
      )`);
      const insert = sqlite.prepare(
        "INSERT INTO skill_execution_metrics (id, context_json, completed_at) VALUES (?, ?, ?)",
      );
      const current = receipt({
        receiptId: "desktop-reopen:current",
        graderReceipts: [digest("d")],
      });
      const stale = receipt({
        receiptId: "desktop-reopen:stale",
        environmentDigest: digest("f"),
        graderReceipts: [digest("d")],
      });
      const legacy = legacyReceipt({
        receiptId: "desktop-reopen:legacy",
        graderReceipts: [digest("d")],
      });
      for (const [index, value] of [current, stale, legacy].entries()) {
        insert.run(
          `row-${index}`,
          JSON.stringify({ invocationReceipt: value }),
          `2026-09-03T00:00:0${index}.000Z`,
        );
      }
      sqlite.close();

      sqlite = new Database(databasePath, { readonly: true });
      const authority = await buildDesktopSkillOutcomeAuthority({
        database: {
          all: async (sql, params) => sqlite.prepare(sql).all(...params),
        },
        expectedEnvironmentDigest: digest("e"),
      });
      expect(authority).toMatchObject({
        schema: "chainlesschain.desktop-skill-outcome-db-authority/v2",
        metrics: {
          [digest("a")]: { samples: 1, successRate: 1 },
        },
        evidence: {
          rowCount: 3,
          receiptCount: 3,
          uniqueReceiptCount: 3,
          attributionEligibleReceiptCount: 1,
          outcomeEligibleReceiptCount: 1,
          legacyEnvironmentUnboundReceiptCount: 1,
          staleEnvironmentReceiptCount: 1,
          environmentPolicy: "current",
        },
      });
    } finally {
      if (sqlite.open) sqlite.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
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
