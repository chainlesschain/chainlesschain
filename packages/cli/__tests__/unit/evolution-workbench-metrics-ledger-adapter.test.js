import { createHash, createHmac } from "node:crypto";
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
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import { EvolutionWorkbenchMetricsLedgerAdapter } from "../../src/lib/evolution/evolution-workbench-metrics-ledger-adapter.js";
import {
  EvolutionWorkbenchMetricsAggregator,
  digestEvolutionWorkbenchMetricsDelta,
} from "../../src/lib/evolution/evolution-workbench-metrics.js";

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

function invocation(id, contentDigest) {
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
  return { artifactPorts, ledger, resolver, state };
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
