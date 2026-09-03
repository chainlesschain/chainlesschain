import { createHash } from "node:crypto";

import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";
import { describe, expect, it, vi } from "vitest";

import {
  EvolutionWorkbenchMetricsAggregator,
  digestEvolutionWorkbenchMetricsDelta,
} from "../../src/lib/evolution/evolution-workbench-metrics.js";
import {
  SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA,
  buildSkillOutcomeIndexAuthority,
  unavailableSkillOutcomeIndexAuthority,
} from "../../src/lib/evolution/skill-outcome-index-authority.js";

const { startSkillInvocation, settleSkillInvocation } = skillInvocationReceipt;
const digest = (character) => `sha256:${character.repeat(64)}`;

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function redigestSnapshot(value) {
  const core = structuredClone(value);
  delete core.snapshotDigest;
  return {
    ...core,
    snapshotDigest: `sha256:${createHash("sha256")
      .update("chainlesschain.evolution-workbench-metrics-snapshot/v1")
      .update("\0")
      .update(canonical(core))
      .digest("hex")}`,
  };
}

function receipt(runId, id, executionStatus, outcome = {}) {
  const started = startSkillInvocation(
    {
      receiptId: `indexed:${id}`,
      selectedSkillDigest: digest("a"),
      routerCandidates: [
        { digest: digest("a"), score: 1, reason: "indexed candidate" },
      ],
      attributionRequired: true,
      evolutionRunId: runId,
      traceId: `trace:${id}`,
      trajectorySegmentId: `segment:${id}`,
      providerModelVersion: "provider/model@1",
      toolSetDigest: digest("b"),
      osSandboxPermissionPolicyDigest: digest("c"),
      taskCohort: "index-test",
    },
    { clock: () => "2026-09-03T00:00:00.000Z" },
  );
  return settleSkillInvocation(
    started,
    {
      executionStatus,
      graderReceipts: outcome.graderReceipts || [],
      userCorrectionRef: outcome.userCorrectionRef || null,
      tokensInput: 1,
      tokensOutput: 1,
      costUsd: 0,
      latencyMs: 1,
    },
    { clock: () => "2026-09-03T00:00:01.000Z" },
  );
}

async function snapshot(runId, receipts) {
  let stored = null;
  const source = {
    authenticated: true,
    durable: true,
    tenantId: "tenant:test",
    evolutionRunId: runId,
    priorSourceDigest: null,
    throughAt: "2026-09-03T00:01:00.000Z",
    receipts,
  };
  source.sourceDigest = digestEvolutionWorkbenchMetricsDelta(source);
  const aggregator = new EvolutionWorkbenchMetricsAggregator({
    tenantId: source.tenantId,
    evolutionRunId: runId,
    skillName: "repair-tests",
    ports: {
      loadSnapshot: async () => ({
        found: false,
        authenticated: true,
        durable: true,
      }),
      readReceiptDelta: async () => source,
      commitSnapshot: async ({ snapshot: value }) => {
        stored = value;
        return {
          authenticated: true,
          durable: true,
          snapshotDigest: value.snapshotDigest,
        };
      },
    },
  });
  await aggregator.aggregate();
  return stored;
}

function adapter(value, index, overrides = {}) {
  const descriptor = {
    tenantId: "tenant:test",
    evolutionRunId: value.evolutionRunId,
    skillName: value.skillName,
  };
  return {
    loadOutcomeSnapshot: () => ({
      found: true,
      authenticated: true,
      durable: true,
      descriptor,
      snapshot: value,
      ledgerAuthority: {
        schema: "chainlesschain.evolution-ledger-verification/v2",
        status: "verified",
        authenticated: true,
        durable: true,
        ledgerId: `ledger:${index}`,
        identityDigest: digest("d"),
        headDigest: digest("e"),
        sequence: 1,
        eventCount: 1,
        witnessId: `witness:${index}`,
        witnessGeneration: 1,
        witnessDigest: digest("f"),
        ...overrides,
      },
    }),
  };
}

const dependencies = { isMetricsLedgerAdapter: () => true };

describe("indexed Skill outcome authority", () => {
  it("aggregates only graded or corrected completed/failed outcomes", async () => {
    const completed = await snapshot("run:completed", [
      receipt("run:completed", "completed", "completed", {
        graderReceipts: [digest("1")],
      }),
      receipt("run:completed", "ungraded", "completed"),
    ]);
    const failed = await snapshot("run:failed", [
      receipt("run:failed", "failed", "failed", {
        userCorrectionRef: "correction:failed",
      }),
      receipt("run:failed", "blocked", "blocked", {
        graderReceipts: [digest("2")],
      }),
    ]);
    const authority = buildSkillOutcomeIndexAuthority(
      { adapters: [adapter(completed, 1), adapter(failed, 2)] },
      dependencies,
    );
    expect(authority).toMatchObject({
      schema: SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA,
      status: "verified-indexed",
      metrics: {
        [digest("a")]: {
          samples: 2,
          successRate: 0.5,
          correctionRate: 0.5,
        },
      },
      evidence: {
        sourceCount: 2,
        snapshotCount: 2,
        versionCount: 2,
        outcomeSampleCount: 2,
        antiRollbackWitness: true,
      },
    });
    expect(authority.evidence.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("fails closed when legacy outcome history was not backfilled", async () => {
    const value = await snapshot("run:legacy", [
      receipt("run:legacy", "legacy", "completed"),
    ]);
    const legacy = structuredClone(value);
    delete legacy.outcomeHistoryComplete;
    for (const version of legacy.versions) {
      delete version.outcomeReceiptCount;
      delete version.outcomeCompleted;
      delete version.userCorrectionCount;
    }
    expect(() =>
      buildSkillOutcomeIndexAuthority(
        { adapters: [adapter(redigestSnapshot(legacy), 1)] },
        dependencies,
      ),
    ).toThrow(/complete outcome backfill/u);
  });

  it("accepts an empty legacy snapshot because it has no history to backfill", async () => {
    const value = await snapshot("run:legacy-empty", []);
    const legacy = structuredClone(value);
    delete legacy.outcomeHistoryComplete;
    const authority = buildSkillOutcomeIndexAuthority(
      { adapters: [adapter(redigestSnapshot(legacy), 1)] },
      dependencies,
    );
    expect(authority).toMatchObject({
      status: "verified-indexed",
      metrics: {},
      evidence: {
        snapshotCount: 1,
        versionCount: 0,
        outcomeSampleCount: 0,
        antiRollbackWitness: true,
      },
    });
  });

  it("rejects substituted ledger authority and duplicate sources", async () => {
    const value = await snapshot("run:authority", []);
    expect(() =>
      buildSkillOutcomeIndexAuthority(
        {
          adapters: [adapter(value, 1, { witnessDigest: "forged" })],
        },
        dependencies,
      ),
    ).toThrow(/ledger authority is invalid/u);
    expect(() =>
      buildSkillOutcomeIndexAuthority(
        { adapters: [adapter(value, 1), adapter(value, 2)] },
        dependencies,
      ),
    ).toThrow(/duplicate source/u);
  });

  it("requires branded bounded adapters before reading them", () => {
    const read = vi.fn();
    expect(() =>
      buildSkillOutcomeIndexAuthority(
        { adapters: [{ loadOutcomeSnapshot: read }] },
        { isMetricsLedgerAdapter: () => false },
      ),
    ).toThrow(/invalid or unbounded/u);
    expect(read).not.toHaveBeenCalled();
  });

  it("sanitizes unavailable authority evidence", () => {
    const authority = unavailableSkillOutcomeIndexAuthority(
      Object.assign(new Error("C:/private/index"), {
        code: "CC_SKILL_OUTCOME_INDEX_BACKFILL_REQUIRED",
      }),
    );
    expect(authority).toEqual({
      schema: SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA,
      status: "unavailable",
      metrics: null,
      evidence: {
        schema: SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA,
        status: "unavailable",
        code: "CC_SKILL_OUTCOME_INDEX_BACKFILL_REQUIRED",
        antiRollbackWitness: false,
      },
    });
    expect(JSON.stringify(authority)).not.toContain("private");
  });
});
