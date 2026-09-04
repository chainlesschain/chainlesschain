import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  createEmptyWikiState,
  digestWikiState,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA,
  SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA,
  SKILL_WIKI_PILOT_OUTCOME_SCHEMA,
  SKILL_WIKI_REVIEW_DECISION_SCHEMA,
  SKILL_WIKI_TRANSITION_SCHEMA,
  createSkillWikiReconciliationSource,
  createSkillWikiPilotReconciliationSource,
  createSkillWikiReviewReconciliationSource,
  createSkillWikiReconciler,
} from "../../src/lib/evolution/skill-wiki-reconciliation.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function evidence(ref, trustDomain) {
  const core = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId: "tenant-a",
    ref,
    sourceDigest: hash(`source:${ref}`),
    projectionDigest: hash(`projection:${ref}`),
    artifactRef: `artifact://${ref}`,
    trustedProjection: true,
    trustDomain,
    kind: "tool-observation",
    status: "active",
    observedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: null,
    data: { result: "verified" },
  };
  return { ...core, envelopeDigest: hash(core) };
}

function transition(overrides = {}) {
  return {
    schema: SKILL_WIKI_TRANSITION_SCHEMA,
    authenticated: true,
    durable: true,
    tenantId: "tenant-a",
    streamId: "registry-main",
    sequence: 7,
    candidateId: hash("candidate"),
    skillName: "safe-refactor",
    activeReleaseDigest: hash("release"),
    stateDigest: hash("state"),
    settlementDigest: hash("settlement"),
    occurredAt: "2026-09-03T00:00:00.000Z",
    wikiRevision: "wiki:source-revision",
    sourceEvidenceRefs: [
      { ref: "source://observation", digest: hash("source") },
    ],
    sourceReceiptDigest: hash("settlement-event"),
    ...overrides,
  };
}

function pilotOutcome(outcome, overrides = {}) {
  return {
    schema: SKILL_WIKI_PILOT_OUTCOME_SCHEMA,
    authenticated: true,
    durable: true,
    tenantId: "tenant-a",
    streamId: `pilot-${outcome}:wiki-outcomes`,
    sequence: 9,
    pilotId: `pilot-${outcome}`,
    descriptorDigest: hash(`descriptor:${outcome}`),
    candidateId: hash(`candidate:${outcome}`),
    skillName: "safe-refactor",
    outcome,
    reason:
      outcome === "stable"
        ? "The statistical progressive Canary reached stable."
        : "The production Pilot rolled back the candidate.",
    occurredAt: "2026-09-04T00:00:00.000Z",
    activeStateDigest: hash(`active-state:${outcome}`),
    evidenceReceiptDigests: [hash(`gate:${outcome}`)],
    sourceReceiptDigest: hash(`pilot-transition:${outcome}`),
    ...overrides,
  };
}

async function harness({
  crashAfterWiki = false,
  loseCheckpointAck = false,
} = {}) {
  let state = createEmptyWikiState("tenant-a");
  let checkpoint = null;
  let loseAck = loseCheckpointAck;
  let crash = crashAfterWiki;
  const evidenceByRef = new Map([
    ["ev-1", evidence("ev-1", "workspace-a")],
    ["ev-2", evidence("ev-2", "workspace-b")],
  ]);
  const maintainer = new EvidenceBackedWikiMaintainer({
    descriptor: {
      tenantId: "tenant-a",
      evolutionRunId: "run-reconcile",
      maintainerModel: "provider:maintainer-v1",
      rulesDigest: hash("rules"),
      minCorroboratingSources: 2,
    },
    policy: {
      trustedProjectionRead: true,
      rawEvidenceRead: false,
      activeSkillWrite: false,
      shell: false,
      network: false,
      secretRead: false,
    },
    ports: {
      async loadWiki() {
        return { trusted: true, state, stateDigest: digestWikiState(state) };
      },
      async resolveEvidence(ref) {
        return evidenceByRef.get(ref);
      },
      async derive({ evidence: items }) {
        const proposal = items.find(
          (item) => item.kind === "proposal-decision",
        );
        if (proposal) {
          return {
            operations: [
              {
                type: "proposal-impact",
                decision: {
                  ...proposal.data.decision,
                  receiptRef: proposal.ref,
                },
              },
            ],
          };
        }
        return {
          operations: [
            {
              type: "upsert",
              pattern: {
                patternId: "pat-safe-refactor",
                kind: "success",
                summary: "Bounded refactors pass deterministic verification.",
                rootCause: "Small changes preserve observable behavior.",
                procedure:
                  "Apply one bounded change and run deterministic tests.",
                appliesWhen: ["deterministic tests exist"],
                doesNotApplyWhen: [],
                positiveEvidence: ["ev-1", "ev-2"],
                negativeEvidence: [],
                contradicts: [],
                supersedes: [],
                confidence: 0.8,
                trustDomains: [],
                lastVerifiedAt: "2026-09-01T00:00:00.000Z",
                expiresAt: null,
                skillNames: ["safe-refactor"],
              },
            },
          ],
        };
      },
      async commitRevision({ expectedStateDigest, revision }) {
        expect(expectedStateDigest).toBe(digestWikiState(state));
        state = revision.state;
        return {
          committed: true,
          revisionId: revision.revisionId,
          stateDigest: revision.stateDigest,
          evolutionRunId: revision.evolutionRunId,
        };
      },
    },
  });
  await maintainer.maintain({
    evidenceRefs: ["ev-1", "ev-2"],
    effectiveAt: "2026-09-01T00:00:00.000Z",
  });
  const source = createSkillWikiReconciliationSource({
    tenantId: "tenant-a",
    streamId: "registry-main",
    readTransitions: () => [transition()],
  });
  const ports = {
    resolveImpact: vi.fn(async (item) => ({
      schema: SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA,
      authenticated: true,
      durable: true,
      tenantId: "tenant-a",
      transitionDigest: item.transitionDigest,
      candidateId: item.candidateId,
      skillName: item.skillName,
      wikiRevision: item.wikiRevision,
      patternRefs: ["pat-safe-refactor"],
      reason: "The evaluated candidate became the active release.",
      receiptDigest: hash("impact-resolution"),
    })),
    retainEvidence: vi.fn(async (item) => {
      evidenceByRef.set(item.ref, item);
      return {
        schema: SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA,
        authenticated: true,
        durable: true,
        tenantId: "tenant-a",
        ref: item.ref,
        envelopeDigest: item.envelopeDigest,
        receiptDigest: hash(`retained:${item.ref}`),
      };
    }),
    loadCheckpoint: vi.fn(async () => checkpoint),
    commitCheckpoint: vi.fn(
      async ({ checkpoint: next, expectedCheckpointDigest }) => {
        expect(expectedCheckpointDigest).toBe(
          checkpoint?.checkpointDigest ?? null,
        );
        checkpoint = next;
        if (loseAck) {
          loseAck = false;
          throw new Error("simulated checkpoint response loss");
        }
        return {
          authenticated: true,
          durable: true,
          committed: true,
          checkpointDigest: next.checkpointDigest,
        };
      },
    ),
  };
  const reconciler = createSkillWikiReconciler({
    source,
    maintainer,
    ports,
    crashHook() {
      if (crash) {
        crash = false;
        throw new Error("simulated Wiki commit response loss");
      }
    },
  });
  return { getState: () => state, maintainer, ports, reconciler, source };
}

describe("SkillWikiReconciler", () => {
  it("reconciles an active registry settlement exactly once", async () => {
    const fixture = await harness();

    await expect(fixture.reconciler.reconcile()).resolves.toMatchObject({
      processed: 1,
      cursor: 7,
    });
    await expect(fixture.reconciler.reconcile()).resolves.toEqual({
      processed: 0,
      cursor: 7,
      results: [],
    });

    expect(fixture.getState().skillImpact["safe-refactor"]).toMatchObject({
      accepted: 1,
      rejected: 0,
    });
    expect(
      fixture.getState().skillImpact["safe-refactor"].decisions,
    ).toHaveLength(1);
    expect(fixture.ports.resolveImpact).toHaveBeenCalledTimes(1);
  });

  it("recovers Wiki and checkpoint response loss without duplicate impact", async () => {
    const fixture = await harness({
      crashAfterWiki: true,
      loseCheckpointAck: true,
    });

    await expect(fixture.reconciler.reconcile()).rejects.toThrow(
      /simulated Wiki commit response loss/,
    );
    const reopened = createSkillWikiReconciler({
      source: fixture.source,
      maintainer: fixture.maintainer,
      ports: fixture.ports,
    });
    await expect(reopened.reconcile()).resolves.toMatchObject({
      processed: 1,
      cursor: 7,
      results: [{ recovered: true }],
    });
    expect(fixture.getState().skillImpact["safe-refactor"].accepted).toBe(1);
    await expect(reopened.reconcile()).resolves.toMatchObject({ processed: 0 });
  });

  it("records a rejected human review against its dependent pattern", async () => {
    const fixture = await harness();
    const reviewSource = createSkillWikiReviewReconciliationSource({
      tenantId: "tenant-a",
      streamId: "review-main:wiki-rejections",
      readReviewDecisions: async () => [
        {
          schema: SKILL_WIKI_REVIEW_DECISION_SCHEMA,
          authenticated: true,
          durable: true,
          tenantId: "tenant-a",
          streamId: "review-main:wiki-rejections",
          sequence: 2,
          candidateId: hash("rejected-candidate"),
          skillName: "safe-refactor",
          decision: "rejected",
          reason: "The candidate failed the human review policy.",
          occurredAt: "2026-09-02T00:00:00.000Z",
          packetDigest: hash("review-packet"),
          decisionReceiptDigest: hash("review-rejection"),
          sourceEvidenceRefs: [
            { ref: "source://rejected", digest: hash("rejected-source") },
          ],
          sourceReceiptDigest: hash("review-ledger-event"),
        },
      ],
    });
    const reconciler = createSkillWikiReconciler({
      source: reviewSource,
      maintainer: fixture.maintainer,
      ports: fixture.ports,
    });

    await expect(reconciler.reconcile()).resolves.toMatchObject({
      processed: 1,
      cursor: 2,
    });
    expect(fixture.getState().skillImpact["safe-refactor"]).toMatchObject({
      accepted: 0,
      rejected: 1,
    });
    expect(
      fixture.getState().patterns["pat-safe-refactor"].rejectionCount,
    ).toBe(1);
  });

  it.each([
    ["stable", "accepted"],
    ["rollback", "rejected"],
  ])("reconciles a durable Pilot %s outcome", async (outcome, counter) => {
    const fixture = await harness();
    const source = createSkillWikiPilotReconciliationSource({
      tenantId: "tenant-a",
      streamId: `pilot-${outcome}:wiki-outcomes`,
      readPilotOutcomes: async () => [pilotOutcome(outcome)],
    });
    const reconciler = createSkillWikiReconciler({
      source,
      maintainer: fixture.maintainer,
      ports: fixture.ports,
    });

    await expect(reconciler.reconcile()).resolves.toMatchObject({
      processed: 1,
      cursor: 9,
    });
    expect(fixture.getState().skillImpact["safe-refactor"][counter]).toBe(1);
    expect(
      fixture.getState().patterns["pat-safe-refactor"].rejectionCount,
    ).toBe(outcome === "rollback" ? 1 : 0);
    if (outcome === "rollback") {
      expect(fixture.getState().patterns["pat-safe-refactor"]).toMatchObject({
        status: "stale",
        actionable: false,
        rollbackCount: 1,
      });
      expect(fixture.getState().index).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ patternId: "pat-safe-refactor" }),
        ]),
      );
    }
  });

  it("fails closed for cross-tenant or forged transition records", () => {
    const crossTenant = createSkillWikiReconciliationSource({
      tenantId: "tenant-a",
      streamId: "registry-main",
      readTransitions: () => [transition({ tenantId: "tenant-b" })],
    });
    expect(() => crossTenant.list()).toThrow(/durably tenant-bound/);

    const forged = createSkillWikiReconciliationSource({
      tenantId: "tenant-a",
      streamId: "registry-main",
      readTransitions: () => [transition({ authenticated: false })],
    });
    expect(() => forged.list()).toThrow(/durably tenant-bound/);
  });
});
