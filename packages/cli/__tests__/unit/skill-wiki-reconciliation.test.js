import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  createEmptyWikiState,
  digestWikiState,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  createEvolutionProposalStage,
  createEvolutionWikiImpactStage,
} from "../../src/lib/evolution/evolution-release-train-domain-stages.js";
import { WikiInformedSkillProposer } from "../../src/lib/evolution/wiki-informed-skill-proposer.js";
import {
  SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA,
  SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA,
  SKILL_WIKI_PILOT_OUTCOME_SCHEMA,
  SKILL_WIKI_REVIEW_DECISION_SCHEMA,
  SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA,
  SKILL_WIKI_TRANSITION_SCHEMA,
  createSkillWikiReconciliationSource,
  createSkillWikiPilotReconciliationSource,
  createSkillWikiReviewReconciliationSource,
  createSkillWikiRevocationReconciliationSource,
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
  return {
    getEvidence: (ref) => evidenceByRef.get(ref),
    getState: () => state,
    maintainer,
    ports,
    reconciler,
    source,
  };
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

  it("carries a ReleaseTrain Wiki impact into the subsequent Wiki-informed proposal", async () => {
    const fixture = await harness();
    const promoted = transition();
    const [sourceTransition] = await fixture.source.list({
      afterSequence: 0,
      limit: 64,
    });
    const plan = Object.freeze({
      tenantId: promoted.tenantId,
      skillId: promoted.skillName,
      planDigest: hash("release-train-wiki-impact-plan"),
      candidateId: promoted.candidateId,
    });
    const entries = new Map([
      [
        "promotion",
        {
          outputDigest: promoted.activeReleaseDigest,
          valueDigest: hash("release-train-promotion-value"),
          value: {
            release: { releaseDigest: promoted.activeReleaseDigest },
          },
        },
      ],
    ]);
    const outputLedger = {
      load: vi.fn(({ stage }) => entries.get(stage) ?? null),
      commit: vi.fn((input) => {
        entries.set(input.stage, {
          ...structuredClone(input),
          valueDigest: hash(input.value),
        });
        return { committed: true };
      }),
    };
    const stage = createEvolutionWikiImpactStage({
      reconciler: fixture.reconciler,
      outputLedger,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      usage: { tokens: 0, cost: 0, timeMs: 1, turns: 1 },
    });

    const impactReceipt = await stage({
      plan,
      stage: "wiki-impact",
      operationKey: hash("release-train-wiki-impact-operation"),
      inputDigest: promoted.activeReleaseDigest,
    });
    expect(impactReceipt).toMatchObject({
      stage: "wiki-impact",
      inputDigest: promoted.activeReleaseDigest,
      outputDigest: expect.stringMatching(/^sha256:/u),
      durable: true,
    });
    expect(entries.get("wiki-impact")).toMatchObject({
      value: {
        releaseDigest: promoted.activeReleaseDigest,
        transitionDigest: sourceTransition.transitionDigest,
        transitionSequence: sourceTransition.sequence,
        checkpointCursor: sourceTransition.sequence,
      },
    });
    expect(fixture.getState().skillImpact[plan.skillId]).toMatchObject({
      accepted: 1,
      rejected: 0,
    });
    expect(outputLedger.commit).toHaveBeenCalledTimes(1);

    const wikiState = fixture.getState();
    const evidenceEnvelope = (kind, data) => ({
      kind,
      ref: `wiki://${kind}/${digestWikiState(wikiState).slice(7)}`,
      data,
      trusted: true,
      digest: hash(data),
    });
    const initial = {
      "wiki-index": evidenceEnvelope("wiki-index", {
        contradictionRefs: [],
      }),
      "skill-impact": evidenceEnvelope(
        "skill-impact",
        wikiState.skillImpact[plan.skillId],
      ),
      "active-skill": evidenceEnvelope("active-skill", {
        skillName: plan.skillId,
        releaseDigest: promoted.activeReleaseDigest,
      }),
      "training-summary": evidenceEnvelope("training-summary", {
        sampleCount: 4,
        passed: 4,
      }),
    };
    const proposer = new WikiInformedSkillProposer({
      descriptor: {
        tenantId: plan.tenantId,
        evolutionRunId: "run-after-release",
        targetSkillName: plan.skillId,
        wikiRevision: `wiki:${digestWikiState(wikiState).slice(7)}`,
        proposerModel: "provider:lineage-test",
        minEvidenceSamples: 3,
        maxSelectiveEvidence: 1,
      },
      policy: { proposerWikiRead: true, executionAgentWikiRead: false },
      ports: {
        readInitial: vi.fn(async (kind) => initial[kind]),
        readSelective: vi.fn(),
        generate: vi.fn(async ({ evidence: proposalEvidence }) => {
          const impact = proposalEvidence.find(
            (item) => item.kind === "skill-impact",
          );
          const priorDecision = impact.data.decisions[0];
          expect(priorDecision.candidateId).toBe(promoted.candidateId);
          const retained = fixture.getEvidence(priorDecision.receiptRef);
          expect(retained.data).toMatchObject({
            activeReleaseDigest: promoted.activeReleaseDigest,
            transitionDigest: sourceTransition.transitionDigest,
          });
          const refs = proposalEvidence.map((item) => item.ref);
          return {
            status: "proposal",
            skillName: plan.skillId,
            purpose: {
              summary: "Improve the Skill using its verified release impact.",
              patternRefs: [refs[0]],
              sourceEvidenceRefs: refs,
            },
            applicableWhen: ["the prior release impact remains accepted"],
            notApplicableWhen: ["the prior release has been revoked"],
            failureCounterexamples: ["the accepted impact is no longer valid"],
            rollbackSteps: ["retain the currently active release"],
            validationMethods: ["rerun the fixed target matrix"],
            requestedCapabilities: [],
            targetRuntimes: ["node22-test"],
            contextCost: { maxTokens: 800, maxBytes: 4_096 },
            machineDiff: [
              {
                op: "replace",
                path: "SKILL.md",
                beforeDigest: promoted.activeReleaseDigest,
                afterDigest: hash("next-skill-content"),
              },
            ],
          };
        }),
        createCandidate: vi.fn(),
      },
    });
    let proposalRecord = null;
    const proposalStage = createEvolutionProposalStage({
      proposer,
      proposalLedger: {
        load: vi.fn(() => proposalRecord),
        commit: vi.fn((input) => {
          proposalRecord = {
            ...structuredClone(input),
            outputDigest: input.drafted.proposalDigest,
          };
          return { committed: true };
        }),
      },
      effectiveAt: "2026-09-05T00:01:00.000Z",
      usage: { tokens: 20, cost: 0, timeMs: 2, turns: 1 },
    });
    const nextPlan = Object.freeze({
      planDigest: hash("release-train-next-plan"),
      wikiRevisionDigest: digestWikiState(wikiState),
    });
    await expect(
      proposalStage({
        plan: nextPlan,
        stage: "propose",
        operationKey: hash("release-train-next-proposal-operation"),
        inputDigest: nextPlan.wikiRevisionDigest,
      }),
    ).resolves.toMatchObject({
      stage: "propose",
      inputDigest: nextPlan.wikiRevisionDigest,
      outputDigest: expect.stringMatching(/^sha256:/u),
      durable: true,
    });
    expect(proposalRecord.drafted.proposal.sourceEvidenceRefs).toContainEqual({
      ref: initial["skill-impact"].ref,
      digest: initial["skill-impact"].digest,
    });
    expect(proposalRecord.drafted.proposal.wikiRevision).toBe(
      `wiki:${digestWikiState(wikiState).slice(7)}`,
    );
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

  it("reconciles an independent revoke as rejected impact", async () => {
    const fixture = await harness();
    const source = createSkillWikiRevocationReconciliationSource({
      tenantId: "tenant-a",
      streamId: "security-revocations",
      readRevocations: async () => [
        {
          schema: SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA,
          authenticated: true,
          durable: true,
          tenantId: "tenant-a",
          streamId: "security-revocations",
          sequence: 3,
          revocationId: "security-incident-3",
          candidateId: hash("revoked-candidate"),
          skillName: "safe-refactor",
          outcome: "revoke",
          reason: "Independent security authority revoked the Skill.",
          occurredAt: "2026-09-05T02:00:00.000Z",
          activeStateDigest: hash("revoked-active-state"),
          evidenceReceiptDigests: [hash("security-incident")],
          sourceReceiptDigest: hash("security-verification"),
        },
      ],
    });
    const reconciler = createSkillWikiReconciler({
      source,
      maintainer: fixture.maintainer,
      ports: fixture.ports,
    });

    await expect(reconciler.reconcile()).resolves.toMatchObject({
      processed: 1,
      cursor: 3,
    });
    expect(fixture.getState().skillImpact["safe-refactor"]).toMatchObject({
      accepted: 0,
      rejected: 1,
    });
    expect(fixture.getState().patterns["pat-safe-refactor"]).toMatchObject({
      status: "stale",
      actionable: false,
    });
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
