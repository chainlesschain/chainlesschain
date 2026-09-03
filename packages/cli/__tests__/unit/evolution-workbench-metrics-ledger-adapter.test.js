import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
  EvolutionLedger,
} from "../../src/lib/evolution/evolution-ledger.js";
import {
  EVOLUTION_WORKBENCH_METRICS_RETENTION_LEDGER_EVENT,
  EvolutionWorkbenchMetricsLedgerAdapter,
  isEvolutionWorkbenchMetricsLedgerAdapter,
  isEvolutionWorkbenchMetricsOutcomeReader,
} from "../../src/lib/evolution/evolution-workbench-metrics-ledger-adapter.js";
import {
  EvolutionWorkbenchMetricsAggregator,
  EvolutionWorkbenchMetricsOutcomeBackfiller,
  EVOLUTION_WORKBENCH_METRICS_HISTORY_SCHEMA,
  EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA,
  createEmptyEvolutionWorkbenchMetricsSnapshot,
  digestEvolutionWorkbenchMetricsDelta,
  digestEvolutionWorkbenchMetricsHistory,
} from "../../src/lib/evolution/evolution-workbench-metrics.js";
import { buildSkillOutcomeIndexAuthority } from "../../src/lib/evolution/skill-outcome-index-authority.js";

const { startSkillInvocation, settleSkillInvocation } = skillInvocationReceipt;
const D = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const H = (value) => D(typeof value === "string" ? value : canonical(value));

const descriptor = {
  tenantId: "tenant:a",
  artifactTenantId: "artifact-tenant:a",
  evolutionRunId: "run:1",
  skillName: "repair-tests",
  audience: "evolution-runtime",
  purpose: "evolution-ledger",
};
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const LEDGER_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/workbench-metrics-ledger",
  trustPolicyDigest: D("workbench-metrics-ledger-trust"),
};
const WITNESS_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/workbench-metrics-witness",
  trustPolicyDigest: D("workbench-metrics-witness-trust"),
};
const EMPTY_DISCARD_DIGEST = H(
  `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`,
);

function witnessRecord(witnessId, snapshot = null, previous = null) {
  const core = {
    ...WITNESS_TRUST,
    anchorDigest: snapshot?.anchorDigest ?? null,
    authenticated: true,
    durable: true,
    discardAccumulatorDigest:
      previous?.discardAccumulatorDigest ?? EMPTY_DISCARD_DIGEST,
    epoch: snapshot?.epoch ?? null,
    generation: previous ? previous.generation + 1 : 0,
    headDigest: snapshot?.headDigest ?? null,
    identityDigest: snapshot?.identityDigest ?? null,
    ledgerId: snapshot?.ledgerId ?? null,
    payloadDigest: snapshot?.payloadDigest ?? null,
    previousWitnessDigest: previous?.witnessDigest ?? null,
    schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
    segmentDigest: snapshot?.segmentDigest ?? null,
    sequence: snapshot?.sequence ?? null,
    status: snapshot ? "committed" : "absent",
    storeMarkerDigest: snapshot?.storeMarkerDigest ?? null,
    storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest ?? null,
    storeMarkerId: snapshot?.storeMarkerId ?? null,
    witnessId,
  };
  const message = `chainlesschain.evolution-ledger-witness/v1\0${canonical(core)}`;
  return {
    ...core,
    witnessDigest: H(message),
    signature: { ...WITNESS_TRUST, value: "A".repeat(43) },
  };
}

function durableWitness(witnessId) {
  let current = witnessRecord(witnessId);
  return {
    id: witnessId,
    read: () => current,
    initialize: ({ expected, snapshot }) => {
      if (expected.witnessDigest !== current.witnessDigest) return current;
      current = witnessRecord(witnessId, snapshot, current);
      return current;
    },
    compareAndSwap: ({ expected, next }) => {
      if (expected.witnessDigest !== current.witnessDigest) return current;
      current = witnessRecord(witnessId, next, current);
      return current;
    },
    proveAncestry: () => {
      throw new Error("unexpected ancestry request in linear metrics test");
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -20_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(fileDescriptor) {
      if (directories.delete(fileDescriptor)) return;
      return fs.closeSync(fileDescriptor);
    },
    fsyncSync(fileDescriptor) {
      if (directories.has(fileDescriptor)) return;
      try {
        return fs.fsyncSync(fileDescriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(fileDescriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const fileDescriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(fileDescriptor);
          return fileDescriptor;
        }
        throw error;
      }
    },
  };
}

function invocation(id, contentDigest, outcome = {}) {
  const started = startSkillInvocation(
    {
      receiptId: `skill-invocation:${id}`,
      selectedSkillDigest: contentDigest,
      routerCandidates: [
        { digest: contentDigest, score: 1, reason: "exact match" },
      ],
      attributionRequired: true,
      evolutionRunId: descriptor.evolutionRunId,
      traceId: `trace:${id}`,
      trajectorySegmentId: `segment:${id}`,
      providerModelVersion: "provider:model-v1",
      toolSetDigest: D("tools"),
      osSandboxPermissionPolicyDigest: D("policy"),
      taskCohort: "pilot:a",
    },
    { clock: () => "2026-09-03T00:00:00.000Z" },
  );
  return settleSkillInvocation(
    started,
    {
      executionStatus: "completed",
      graderReceipts: outcome.graderReceipts || [],
      userCorrectionRef: outcome.userCorrectionRef || null,
      tokensInput: 10,
      tokensOutput: 5,
      costUsd: 0.25,
      latencyMs: 100,
    },
    { clock: () => "2026-09-03T00:01:00.000Z" },
  );
}

function backends() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-workbench-metrics-"),
  );
  roots.push(root);
  const secret = "test-only-workbench-metrics-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/workbench-metrics";
  const policyDigest = D("artifact-policy");
  const now = Date.parse("2026-09-03T01:00:00.000Z");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: descriptor.audience,
    tenantId: descriptor.artifactTenantId,
    now: () => now,
    envelopeSigner: {
      sign: ({ message }) => ({
        algorithm,
        keyId,
        value: sign(message),
      }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(now).toISOString(),
          decisionExpiresAt: new Date(now + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: D(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const state = { events: [] };
  const ledger = {
    read: vi.fn(() => structuredClone(state.events)),
    verify: vi.fn(() => ({
      epoch: "epoch:a",
      ledgerId: "ledger:a",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    })),
    appendDomainEvent: vi.fn((input, expected) => {
      if (
        expected.expectedSequence !== state.events.length ||
        expected.expectedHeadDigest !==
          (state.events.at(-1)?.eventDigest ?? null)
      ) {
        throw new Error("ledger CAS conflict");
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: D(canonical(input)),
      };
      state.events.push(event);
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: D(event.eventDigest),
      };
    }),
  };
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: descriptor.purpose,
  });
  return { artifactPorts, ledger, resolver, state, root };
}

function openRealLedger(value, witness) {
  const secret = "test-only-real-workbench-metrics-ledger-key";
  return new EvolutionLedger({
    rootDir: path.join(value.root, "ledger-events"),
    authorityRootDir: path.join(value.root, "ledger-authority"),
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => Date.parse("2026-09-03T01:00:00.000Z"),
    random: () => randomBytes(16).toString("hex"),
    trust: LEDGER_TRUST,
    witnessTrust: WITNESS_TRUST,
    witness,
    artifactResolver: value.resolver,
    sign: ({ message }) => ({
      ...LEDGER_TRUST,
      value: createHmac("sha256", secret).update(message).digest("base64url"),
    }),
    verifySignature: () => true,
    verifyWitnessSignature: () => true,
  });
}

function adapter(value) {
  return new EvolutionWorkbenchMetricsLedgerAdapter({
    descriptor,
    artifactPorts: value.artifactPorts,
    ledger: value.ledger,
    ledgerArtifactResolver: value.resolver,
  });
}

function delta(receipts, priorSourceDigest = null, index = 1) {
  const source = {
    authenticated: true,
    durable: true,
    tenantId: descriptor.tenantId,
    evolutionRunId: descriptor.evolutionRunId,
    priorSourceDigest,
    throughAt: `2026-09-03T0${index}:00:00.000Z`,
    receipts,
  };
  return {
    ...source,
    sourceDigest: digestEvolutionWorkbenchMetricsDelta(source),
  };
}

describe("EvolutionWorkbenchMetricsLedgerAdapter", () => {
  it("backfills a retained legacy snapshot through durable artifacts and ledger", async () => {
    const value = backends();
    const opened = adapter(value);
    const contentDigest = D("content:legacy-backfill");
    const oldReceipt = invocation("legacy-old", contentDigest);
    const gradedReceipt = invocation("legacy-graded", contentDigest, {
      graderReceipts: [D("grader:legacy-graded")],
      userCorrectionRef: "correction:legacy-graded",
    });
    const retained = opened.retainReceiptDigests({
      ...descriptor,
      priorRetentionRootDigest: null,
      priorRetainedReceiptCount: 0,
      throughAt: "2026-09-03T01:30:00.000Z",
      receiptDigests: [oldReceipt.receiptDigest],
    });
    const empty = createEmptyEvolutionWorkbenchMetricsSnapshot(
      descriptor.tenantId,
      descriptor.evolutionRunId,
      descriptor.skillName,
    );
    const legacyCore = {
      schema: EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA,
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      revision: 1,
      priorSnapshotDigest: empty.snapshotDigest,
      sourceDigest: D("legacy-source"),
      throughAt: "2026-09-03T02:00:00.000Z",
      retainedReceiptCount: 1,
      retentionRootDigest: retained.retentionRootDigest,
      receiptDigests: [gradedReceipt.receiptDigest],
      versions: [
        {
          contentDigest,
          receiptCount: 2,
          completed: 2,
          failed: 0,
          blocked: 0,
          tokensInput: 20,
          tokensOutput: 10,
          costUsd: 0.5,
          latencyMs: 200,
          maxLatencyMs: 100,
        },
      ],
    };
    const legacy = {
      ...legacyCore,
      snapshotDigest: D(
        `${EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA}\0${canonical(legacyCore)}`,
      ),
    };
    opened.commitSnapshot({
      expectedSnapshotDigest: empty.snapshotDigest,
      snapshot: legacy,
    });
    const receipts = [oldReceipt, gradedReceipt].sort((left, right) =>
      left.receiptDigest.localeCompare(right.receiptDigest),
    );
    const readReceiptHistory = vi.fn(async (request) => {
      const history = {
        schema: EVOLUTION_WORKBENCH_METRICS_HISTORY_SCHEMA,
        authenticated: true,
        durable: true,
        tenantId: request.tenantId,
        evolutionRunId: request.evolutionRunId,
        skillName: request.skillName,
        snapshotDigest: request.snapshotDigest,
        sourceDigest: request.sourceDigest,
        throughAt: request.throughAt,
        receipts,
      };
      return {
        ...history,
        historyDigest: digestEvolutionWorkbenchMetricsHistory(history),
      };
    });
    const reconciled = await new EvolutionWorkbenchMetricsOutcomeBackfiller({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      ports: adapter(value).backfillPorts({ readReceiptHistory }),
    }).backfill();
    expect(reconciled).toMatchObject({
      status: "reconciled",
      receiptCount: 2,
      snapshot: {
        outcomeHistoryComplete: true,
        retainedReceiptCount: 1,
        retentionRootDigest: retained.retentionRootDigest,
        versions: [
          {
            outcomeReceiptCount: 1,
            outcomeCompleted: 1,
            userCorrectionCount: 1,
          },
        ],
      },
    });
    expect(adapter(value).loadSnapshot()).toMatchObject({
      snapshot: { snapshotDigest: reconciled.snapshot.snapshotDigest },
    });
    expect(value.state.events).toHaveLength(3);
  });

  it("recovers compacted metrics through real Ledger files and witness", async () => {
    const value = backends();
    const witness = durableWitness("witness-workbench-metrics-integration");
    const firstLedger = openRealLedger(value, witness);
    const firstAdapter = new EvolutionWorkbenchMetricsLedgerAdapter({
      descriptor,
      artifactPorts: value.artifactPorts,
      ledger: firstLedger,
      ledgerArtifactResolver: value.resolver,
    });
    const contentDigest = D("content:real");
    const source = delta([
      invocation("real-1", contentDigest, {
        graderReceipts: [D("grader:real-1")],
      }),
    ]);
    const first = await new EvolutionWorkbenchMetricsAggregator({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      hotReceiptLimit: 1,
      ports: firstAdapter.aggregatorPorts({
        readReceiptDelta: async () => source,
      }),
    }).aggregate();
    const secondSource = delta(
      [
        invocation("real-2", contentDigest, {
          userCorrectionRef: "correction:real-2",
        }),
      ],
      source.sourceDigest,
      2,
    );
    const second = await new EvolutionWorkbenchMetricsAggregator({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      hotReceiptLimit: 1,
      ports: firstAdapter.aggregatorPorts({
        readReceiptDelta: async () => secondSource,
      }),
    }).aggregate();

    const reopenedLedger = openRealLedger(value, witness);
    const reopenedAdapter = new EvolutionWorkbenchMetricsLedgerAdapter({
      descriptor,
      artifactPorts: value.artifactPorts,
      ledger: reopenedLedger,
      ledgerArtifactResolver: value.resolver,
    });
    expect(reopenedAdapter.loadSnapshot()).toMatchObject({
      found: true,
      snapshot: {
        snapshotDigest: second.snapshotDigest,
        priorSnapshotDigest: first.snapshotDigest,
        retainedReceiptCount: 1,
        revision: 2,
      },
    });
    expect(reopenedLedger.verify()).toMatchObject({
      eventCount: 3,
      sequence: 3,
    });
    expect(isEvolutionWorkbenchMetricsLedgerAdapter(reopenedAdapter)).toBe(
      true,
    );
    const outcomeReader = reopenedAdapter.createOutcomeReader();
    expect(isEvolutionWorkbenchMetricsOutcomeReader(outcomeReader)).toBe(true);
    expect(Object.keys(outcomeReader)).toEqual(["loadOutcomeSnapshot"]);
    expect(() =>
      buildSkillOutcomeIndexAuthority({
        tenantId: descriptor.tenantId,
        readers: [reopenedAdapter],
      }),
    ).toThrow("outcome index readers are invalid");
    expect(reopenedAdapter.loadOutcomeSnapshot()).toMatchObject({
      found: true,
      descriptor,
      snapshot: { snapshotDigest: second.snapshotDigest },
      ledgerAuthority: {
        status: "verified",
        authenticated: true,
        durable: true,
        eventCount: 3,
        sequence: 3,
      },
    });
    expect(
      buildSkillOutcomeIndexAuthority({
        tenantId: descriptor.tenantId,
        readers: [outcomeReader],
      }),
    ).toMatchObject({
      status: "verified-indexed",
      metrics: {
        [contentDigest]: {
          samples: 2,
          successRate: 1,
          correctionRate: 0.5,
        },
      },
      evidence: {
        sourceCount: 1,
        snapshotCount: 1,
        outcomeSampleCount: 2,
        antiRollbackWitness: true,
      },
    });
    const replaySource = delta(
      [source.receipts[0]],
      secondSource.sourceDigest,
      3,
    );
    await expect(
      new EvolutionWorkbenchMetricsAggregator({
        tenantId: descriptor.tenantId,
        evolutionRunId: descriptor.evolutionRunId,
        skillName: descriptor.skillName,
        hotReceiptLimit: 1,
        ports: reopenedAdapter.aggregatorPorts({
          readReceiptDelta: async () => replaySource,
        }),
      }).aggregate(),
    ).rejects.toThrow("replayed a retained receipt");
  }, 15_000);

  it("persists an immutable metrics snapshot and recovers it in a new adapter", async () => {
    const value = backends();
    const contentDigest = D("content:a");
    const firstDelta = delta([invocation("1", contentDigest)]);
    const first = await new EvolutionWorkbenchMetricsAggregator({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      ports: adapter(value).aggregatorPorts({
        readReceiptDelta: async () => firstDelta,
      }),
    }).aggregate();

    const reopened = adapter(value).loadSnapshot();
    expect(reopened).toMatchObject({
      found: true,
      authenticated: true,
      durable: true,
      snapshot: { snapshotDigest: first.snapshotDigest, revision: 1 },
    });
    expect(value.state.events).toHaveLength(1);
  });

  it("extends the durable snapshot and preserves artifact lineage", async () => {
    const value = backends();
    const contentDigest = D("content:a");
    const firstSource = delta([invocation("1", contentDigest)]);
    const firstAdapter = adapter(value);
    const first = await new EvolutionWorkbenchMetricsAggregator({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      ports: firstAdapter.aggregatorPorts({
        readReceiptDelta: async () => firstSource,
      }),
    }).aggregate();
    const secondSource = delta(
      [invocation("2", contentDigest)],
      firstSource.sourceDigest,
      2,
    );
    const second = await new EvolutionWorkbenchMetricsAggregator({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      ports: adapter(value).aggregatorPorts({
        readReceiptDelta: async () => secondSource,
      }),
    }).aggregate();
    expect(second).toMatchObject({
      revision: 2,
      priorSnapshotDigest: first.snapshotDigest,
      versions: [{ receiptCount: 2 }],
    });
    expect(value.state.events[1].sourceRefs).toEqual([
      value.state.events[0].subjectRef,
    ]);
  });

  it("archives hot receipt digests and rejects their replay after reopen", async () => {
    const value = backends();
    const contentDigest = D("content:retained");
    const firstReceipt = invocation("retained-1", contentDigest);
    const firstSource = delta([firstReceipt]);
    const first = await new EvolutionWorkbenchMetricsAggregator({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      hotReceiptLimit: 1,
      ports: adapter(value).aggregatorPorts({
        readReceiptDelta: async () => firstSource,
      }),
    }).aggregate();
    const secondSource = delta(
      [invocation("retained-2", contentDigest)],
      firstSource.sourceDigest,
      2,
    );
    const second = await new EvolutionWorkbenchMetricsAggregator({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      hotReceiptLimit: 1,
      ports: adapter(value).aggregatorPorts({
        readReceiptDelta: async () => secondSource,
      }),
    }).aggregate();
    expect(second).toMatchObject({
      revision: 2,
      priorSnapshotDigest: first.snapshotDigest,
      retainedReceiptCount: 1,
    });
    expect(second.retentionRootDigest).toMatch(/^sha256:/u);
    expect(second.receiptDigests).toHaveLength(1);
    const reopened = adapter(value);
    expect(reopened.loadSnapshot()).toMatchObject({
      snapshot: {
        retainedReceiptCount: 1,
        retentionRootDigest: second.retentionRootDigest,
      },
    });
    const replaySource = delta([firstReceipt], secondSource.sourceDigest, 3);
    await expect(
      new EvolutionWorkbenchMetricsAggregator({
        tenantId: descriptor.tenantId,
        evolutionRunId: descriptor.evolutionRunId,
        skillName: descriptor.skillName,
        hotReceiptLimit: 1,
        ports: reopened.aggregatorPorts({
          readReceiptDelta: async () => replaySource,
        }),
      }).aggregate(),
    ).rejects.toThrow("replayed a retained receipt");
    const retentionEvent = value.state.events.find(
      ({ type }) => type === EVOLUTION_WORKBENCH_METRICS_RETENTION_LEDGER_EVENT,
    );
    retentionEvent.subjectRef = {
      ...retentionEvent.subjectRef,
      digest: D("substituted-retention"),
    };
    expect(() => adapter(value).loadSnapshot()).toThrow(
      "artifact envelope is not bound",
    );
  }, 15_000);

  it("recovers an identical retention append after acknowledgement loss", () => {
    const value = backends();
    const opened = adapter(value);
    const receiptDigest = invocation(
      "ack-loss",
      D("content:ack-loss"),
    ).receiptDigest;
    const request = {
      ...descriptor,
      priorRetentionRootDigest: null,
      priorRetainedReceiptCount: 0,
      throughAt: "2026-09-03T01:00:00.000Z",
      receiptDigests: [receiptDigest],
    };
    const first = opened.retainReceiptDigests(request);
    const recovered = adapter(value).retainReceiptDigests(request);
    expect(recovered).toMatchObject({
      authenticated: true,
      durable: true,
      recovered: true,
      retentionRootDigest: first.retentionRootDigest,
      retainedReceiptCount: 1,
    });
    expect(value.state.events).toHaveLength(1);
  });

  it("rejects a substituted ledger subject before returning a snapshot", async () => {
    const value = backends();
    const source = delta([invocation("1", D("content:a"))]);
    await new EvolutionWorkbenchMetricsAggregator({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      ports: adapter(value).aggregatorPorts({
        readReceiptDelta: async () => source,
      }),
    }).aggregate();
    value.state.events[0].subjectRef = {
      ...value.state.events[0].subjectRef,
      digest: D("substituted"),
    };
    expect(() => adapter(value).loadSnapshot()).toThrow(
      "artifact envelope is not bound",
    );
  });
});
