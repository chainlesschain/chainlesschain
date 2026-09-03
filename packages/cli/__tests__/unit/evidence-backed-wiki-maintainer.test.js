import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  WIKI_MAINTENANCE_REQUEST_SCHEMA,
  WIKI_PATTERN_STATUS,
  createEmptyWikiState,
  digestWikiState,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";

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

const descriptor = (overrides = {}) => ({
  tenantId: "tenant-a",
  evolutionRunId: "run-1",
  maintainerModel: "provider:maintainer-v1",
  rulesDigest: hash("rules-v1"),
  minCorroboratingSources: 2,
  ...overrides,
});

const policy = {
  trustedProjectionRead: true,
  rawEvidenceRead: false,
  activeSkillWrite: false,
  shell: false,
  network: false,
  secretRead: false,
};

function evidence(ref, overrides = {}) {
  const value = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId: "tenant-a",
    ref,
    sourceDigest: hash(`source:${ref}`),
    projectionDigest: hash(`projection:${ref}`),
    artifactRef: `artifact://${ref}`,
    trustedProjection: true,
    trustDomain: "workspace-a",
    kind: "tool-observation",
    status: "active",
    observedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: null,
    data: { outcome: "verified" },
    ...overrides,
  };
  value.envelopeDigest = hash(value);
  return value;
}

function pattern(overrides = {}) {
  return {
    patternId: "pat-safe-refactor",
    kind: "success",
    summary: "A bounded refactor succeeds with deterministic tests.",
    rootCause: "Small changes preserve observable behavior.",
    procedure: "Apply one bounded change and execute deterministic tests.",
    appliesWhen: ["deterministic tests exist"],
    doesNotApplyWhen: ["persistent data migration is required"],
    positiveEvidence: ["ev-1", "ev-2"],
    negativeEvidence: [],
    contradicts: [],
    supersedes: [],
    confidence: 0.8,
    trustDomains: [],
    lastVerifiedAt: "2026-09-02T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    skillNames: ["safe-refactor"],
    ...overrides,
  };
}

function stateEnvelope(state = createEmptyWikiState("tenant-a")) {
  return { trusted: true, state, stateDigest: digestWikiState(state) };
}

function ports({ state, evidenceByRef, operations = [], overrides = {} } = {}) {
  const initialState = state ?? createEmptyWikiState("tenant-a");
  return {
    loadWiki: vi.fn(async () => stateEnvelope(initialState)),
    resolveEvidence: vi.fn(
      async (ref) => evidenceByRef?.[ref] ?? evidence(ref),
    ),
    derive: vi.fn(async () => ({ operations })),
    commitRevision: vi.fn(async ({ revision }) => ({
      committed: true,
      revisionId: revision.revisionId,
      stateDigest: revision.stateDigest,
      evolutionRunId: revision.evolutionRunId,
    })),
    ...overrides,
  };
}

async function maintain(options = {}) {
  const p = options.ports ?? ports(options);
  const maintainer = new EvidenceBackedWikiMaintainer({
    descriptor: descriptor(),
    policy,
    ports: p,
  });
  const result = await maintainer.maintain({
    evidenceRefs: options.evidenceRefs ?? ["ev-1", "ev-2"],
    effectiveAt: options.effectiveAt ?? "2026-09-02T00:00:00.000Z",
    maintenanceRequest: options.maintenanceRequest,
  });
  return { result, ports: p };
}

describe("EvidenceBackedWikiMaintainer", () => {
  it("commits a durable maintenance request exactly once across retries", async () => {
    let state = createEmptyWikiState("tenant-a");
    const requestDigest = hash("session-end-trigger");
    const maintenanceRequest = {
      schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
      tenantId: "tenant-a",
      requestId: `wiki-maintenance:${requestDigest.slice(7)}`,
      requestDigest,
    };
    const p = ports({
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "workspace-a" }),
        "ev-2": evidence("ev-2", { trustDomain: "workspace-b" }),
      },
      operations: [{ type: "upsert", pattern: pattern() }],
      overrides: {
        loadWiki: vi.fn(async () => stateEnvelope(state)),
        commitRevision: vi.fn(async ({ revision }) => {
          state = revision.state;
          return {
            committed: true,
            revisionId: revision.revisionId,
            stateDigest: revision.stateDigest,
            evolutionRunId: revision.evolutionRunId,
          };
        }),
      },
    });
    const maintainer = new EvidenceBackedWikiMaintainer({
      descriptor: descriptor(),
      policy,
      ports: p,
    });
    const input = {
      evidenceRefs: ["ev-1", "ev-2"],
      effectiveAt: "2026-09-02T00:00:00.000Z",
      maintenanceRequest,
    };

    const first = await maintainer.maintain(input);
    const retried = await maintainer.maintain(input);

    expect(first).toMatchObject({
      revision: 1,
      maintenanceRequestId: maintenanceRequest.requestId,
      recovered: false,
    });
    expect(retried).toMatchObject({
      revisionId: first.revisionId,
      revision: 1,
      currentRevision: 1,
      maintenanceRequestId: maintenanceRequest.requestId,
      recovered: true,
    });
    expect(p.derive).toHaveBeenCalledTimes(1);
    expect(p.commitRevision).toHaveBeenCalledTimes(1);
  });

  it("rejects forged or conflicting maintenance request identities", async () => {
    const requestDigest = hash("goal-end-trigger");
    const maintenanceRequest = {
      schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
      tenantId: "tenant-a",
      requestId: `wiki-maintenance:${requestDigest.slice(7)}`,
      requestDigest,
    };
    const first = await maintain({ maintenanceRequest });

    await expect(
      maintain({
        state: first.result.state,
        evidenceRefs: ["ev-1"],
        maintenanceRequest,
      }),
    ).rejects.toMatchObject({ code: "WIKI_MAINTENANCE_REQUEST_CONFLICT" });
    await expect(
      maintain({
        maintenanceRequest: {
          ...maintenanceRequest,
          requestId: `wiki-maintenance:${"0".repeat(64)}`,
        },
      }),
    ).rejects.toThrow(/exact, tenant-scoped, and digest-bound/);
  });

  it("creates a corroborated actionable pattern and atomically binds its revision to EvolutionRun", async () => {
    const evidenceByRef = {
      "ev-1": evidence("ev-1", { trustDomain: "workspace-a" }),
      "ev-2": evidence("ev-2", { trustDomain: "workspace-b" }),
    };
    const { result, ports: p } = await maintain({
      evidenceByRef,
      operations: [{ type: "upsert", pattern: pattern() }],
    });
    expect(result.state.patterns["pat-safe-refactor"]).toMatchObject({
      status: WIKI_PATTERN_STATUS.CORROBORATED,
      actionable: true,
      evidenceCounts: { positive: 2, negative: 0, trustDomains: 2 },
    });
    expect(result.state.index).toHaveLength(1);
    expect(result.state.evidenceDependents["ev-1"]).toEqual([
      "pat-safe-refactor",
    ]);
    expect(p.commitRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStateDigest: digestWikiState(createEmptyWikiState("tenant-a")),
        revision: expect.objectContaining({ evolutionRunId: "run-1" }),
      }),
    );
  });

  it("keeps a single-source model summary as a non-actionable hypothesis", async () => {
    const modelEvidence = evidence("ev-1", {
      kind: "model-inference",
      trustDomain: "model-a",
    });
    const { result } = await maintain({
      evidenceRefs: ["ev-1"],
      evidenceByRef: { "ev-1": modelEvidence },
      operations: [
        { type: "upsert", pattern: pattern({ positiveEvidence: ["ev-1"] }) },
      ],
    });
    expect(result.state.patterns["pat-safe-refactor"]).toMatchObject({
      status: "hypothesis",
      actionable: false,
    });
  });

  it("allows a real grader receipt to corroborate a procedure without pretending it is multi-source", async () => {
    const grader = evidence("ev-1", {
      kind: "grader-receipt",
      trustDomain: "grader-suite",
    });
    const { result } = await maintain({
      evidenceRefs: ["ev-1"],
      evidenceByRef: { "ev-1": grader },
      operations: [
        { type: "upsert", pattern: pattern({ positiveEvidence: ["ev-1"] }) },
      ],
    });
    expect(result.state.patterns["pat-safe-refactor"]).toMatchObject({
      status: "corroborated",
      actionable: true,
    });
  });

  it("deduplicates an equivalent cluster and retains all evidence lineage", async () => {
    const first = await maintain({
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a" }),
        "ev-2": evidence("ev-2", { trustDomain: "b" }),
      },
      operations: [{ type: "upsert", pattern: pattern() }],
    });
    const duplicate = pattern({
      patternId: "pat-duplicate-refactor",
      positiveEvidence: ["ev-3"],
    });
    const second = await maintain({
      state: first.result.state,
      evidenceRefs: ["ev-3"],
      evidenceByRef: { "ev-3": evidence("ev-3", { trustDomain: "c" }) },
      operations: [{ type: "upsert", pattern: duplicate }],
    });
    expect(Object.keys(second.result.state.patterns)).toEqual([
      "pat-safe-refactor",
    ]);
    expect(
      second.result.state.patterns["pat-safe-refactor"].positiveEvidence,
    ).toEqual(["ev-1", "ev-2", "ev-3"]);
    expect(second.result.state.evolutionLog.at(-1).type).toBe(
      "pattern-deduplicated",
    );
  });

  it("maintains counterevidence and contradiction as a fail-closed pattern state", async () => {
    const { result } = await maintain({
      evidenceRefs: ["ev-1", "ev-2", "ev-negative"],
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a" }),
        "ev-2": evidence("ev-2", { trustDomain: "b" }),
        "ev-negative": evidence("ev-negative", {
          trustDomain: "grader-negative",
          kind: "grader-receipt",
        }),
      },
      operations: [
        {
          type: "upsert",
          pattern: pattern({ negativeEvidence: ["ev-negative"] }),
        },
      ],
    });
    expect(result.state.patterns["pat-safe-refactor"]).toMatchObject({
      status: "contradicted",
      actionable: false,
      evidenceCounts: { positive: 2, negative: 1, trustDomains: 2 },
    });
  });

  it("records a rejected proposal as impact without rolling back Wiki history", async () => {
    const first = await maintain({
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a" }),
        "ev-2": evidence("ev-2", { trustDomain: "b" }),
      },
      operations: [{ type: "upsert", pattern: pattern() }],
    });
    const decisionCore = {
      candidateId: "candidate-1",
      skillName: "safe-refactor",
      outcome: "rejected",
      patternRefs: ["pat-safe-refactor"],
      reason: "holdout regression",
    };
    const decision = evidence("decision-1", {
      kind: "proposal-decision",
      trustDomain: "review-board",
      data: { decisionDigest: hash(decisionCore) },
    });
    const second = await maintain({
      state: first.result.state,
      evidenceRefs: ["decision-1"],
      evidenceByRef: { "decision-1": decision },
      operations: [
        {
          type: "proposal-impact",
          decision: { ...decisionCore, receiptRef: "decision-1" },
        },
      ],
    });
    expect(second.result.state.patterns["pat-safe-refactor"]).toMatchObject({
      status: "corroborated",
      rejectionCount: 1,
      actionable: false,
      operationalConfidence: 0.4,
    });
    expect(second.result.state.skillImpact["safe-refactor"]).toMatchObject({
      accepted: 0,
      rejected: 1,
    });
    expect(second.result.state.revision).toBe(2);
  });

  it("rejects proposal-impact field substitution against its authenticated receipt", async () => {
    const first = await maintain({
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a" }),
        "ev-2": evidence("ev-2", { trustDomain: "b" }),
      },
      operations: [{ type: "upsert", pattern: pattern() }],
    });
    const signedDecision = {
      candidateId: "candidate-1",
      skillName: "safe-refactor",
      outcome: "rejected",
      patternRefs: ["pat-safe-refactor"],
      reason: "holdout regression",
    };
    const receipt = evidence("decision-1", {
      kind: "proposal-decision",
      trustDomain: "review-board",
      data: { decisionDigest: hash(signedDecision) },
    });
    const p = ports({
      state: first.result.state,
      evidenceByRef: { "decision-1": receipt },
      operations: [
        {
          type: "proposal-impact",
          decision: {
            ...signedDecision,
            receiptRef: "decision-1",
            reason: "different reason",
          },
        },
      ],
    });
    await expect(
      new EvidenceBackedWikiMaintainer({
        descriptor: descriptor(),
        policy,
        ports: p,
      }).maintain({
        evidenceRefs: ["decision-1"],
        effectiveAt: "2026-09-03T00:00:00.000Z",
      }),
    ).rejects.toThrow(/not bound/);
    expect(p.commitRevision).not.toHaveBeenCalled();
  });

  it("propagates evidence revocation and expiry to dependents and prunes the default index", async () => {
    const first = await maintain({
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a" }),
        "ev-2": evidence("ev-2", { trustDomain: "b" }),
      },
      operations: [{ type: "upsert", pattern: pattern() }],
    });
    const second = await maintain({
      state: first.result.state,
      evidenceRefs: ["ev-1", "ev-2"],
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a", status: "revoked" }),
        "ev-2": evidence("ev-2", {
          trustDomain: "b",
          expiresAt: "2026-09-02T00:00:00.000Z",
        }),
      },
      operations: [],
      effectiveAt: "2026-09-03T00:00:00.000Z",
    });
    expect(second.result.state.patterns["pat-safe-refactor"].status).toBe(
      "stale",
    );
    expect(second.result.state.index).toEqual([]);
    expect(second.result.state.evidenceDependents["ev-2"]).toEqual([
      "pat-safe-refactor",
    ]);
  });

  it("deterministically decays old knowledge to stale without deleting its lineage", async () => {
    const { result } = await maintain({
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a" }),
        "ev-2": evidence("ev-2", { trustDomain: "b" }),
      },
      operations: [{ type: "upsert", pattern: pattern({ expiresAt: null }) }],
      effectiveAt: "2027-01-01T00:00:00.000Z",
    });
    expect(result.state.patterns["pat-safe-refactor"]).toMatchObject({
      status: "stale",
      actionable: false,
    });
    expect(
      result.state.patterns["pat-safe-refactor"].operationalConfidence,
    ).toBeLessThan(0.2);
    expect(result.state.patterns["pat-safe-refactor"].positiveEvidence).toEqual(
      ["ev-1", "ev-2"],
    );
    expect(result.state.index).toEqual([]);
  });

  it("supports explicit merge and tombstone lifecycle operations", async () => {
    const seed = createEmptyWikiState("tenant-a");
    const created = await maintain({
      state: seed,
      evidenceRefs: ["ev-1", "ev-2", "ev-3"],
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a" }),
        "ev-2": evidence("ev-2", { trustDomain: "b" }),
        "ev-3": evidence("ev-3", { trustDomain: "c" }),
      },
      operations: [
        { type: "upsert", pattern: pattern() },
        {
          type: "upsert",
          pattern: pattern({
            patternId: "pat-other-success",
            summary: "A second bounded refactor pattern.",
            rootCause: "A separate small-change cluster.",
            positiveEvidence: ["ev-3"],
          }),
        },
      ],
    });
    const merged = await maintain({
      state: created.result.state,
      evidenceRefs: ["ev-3"],
      evidenceByRef: { "ev-3": evidence("ev-3", { trustDomain: "c" }) },
      operations: [
        {
          type: "merge",
          targetPatternId: "pat-safe-refactor",
          sourcePatternIds: ["pat-other-success"],
        },
      ],
    });
    expect(merged.result.state.patterns["pat-other-success"].status).toBe(
      "revoked",
    );
    const tombstoned = await maintain({
      state: merged.result.state,
      evidenceRefs: ["ev-1"],
      evidenceByRef: { "ev-1": evidence("ev-1", { trustDomain: "a" }) },
      operations: [
        {
          type: "tombstone",
          patternId: "pat-safe-refactor",
          reason: "privacy deletion",
        },
      ],
    });
    expect(tombstoned.result.state.patterns["pat-safe-refactor"].status).toBe(
      "tombstoned",
    );
    expect(tombstoned.result.state.index).toEqual([]);
  });

  it("rejects raw/secret material, cross-tenant evidence, and excessive authority", async () => {
    expect(
      () =>
        new EvidenceBackedWikiMaintainer({
          descriptor: descriptor(),
          policy: { ...policy, activeSkillWrite: true },
          ports: ports(),
        }),
    ).toThrow(/only trusted projection/);

    for (const bad of [
      evidence("ev-1", { tenantId: "tenant-b" }),
      evidence("ev-1", { data: { secret: "do-not-store" } }),
      evidence("ev-1", { content: "raw trajectory" }),
    ]) {
      bad.envelopeDigest = hash(
        Object.fromEntries(
          Object.entries(bad).filter(([key]) => key !== "envelopeDigest"),
        ),
      );
      const p = ports({ evidenceByRef: { "ev-1": bad } });
      await expect(
        new EvidenceBackedWikiMaintainer({
          descriptor: descriptor(),
          policy,
          ports: p,
        }).maintain({
          evidenceRefs: ["ev-1"],
          effectiveAt: "2026-09-02T00:00:00.000Z",
        }),
      ).rejects.toThrow();
      expect(p.derive).not.toHaveBeenCalled();
    }
  });

  it("fails closed when persistence cannot confirm exact revision identity", async () => {
    const p = ports({
      evidenceByRef: { "ev-1": evidence("ev-1") },
      operations: [],
      overrides: {
        commitRevision: vi.fn(async () => ({
          committed: true,
          revisionId: "wiki:substituted",
        })),
      },
    });
    await expect(
      new EvidenceBackedWikiMaintainer({
        descriptor: descriptor(),
        policy,
        ports: p,
      }).maintain({
        evidenceRefs: ["ev-1"],
        effectiveAt: "2026-09-02T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "WIKI_MAINTAINER_COMMIT_UNCONFIRMED" });
  });

  it("produces byte-identical state and revision ids for the same ordered evidence and rules", async () => {
    const options = {
      evidenceByRef: {
        "ev-1": evidence("ev-1", { trustDomain: "a" }),
        "ev-2": evidence("ev-2", { trustDomain: "b" }),
      },
      operations: [{ type: "upsert", pattern: pattern() }],
    };
    const first = await maintain(options);
    const second = await maintain(options);
    expect(second.result).toEqual(first.result);
  });
});
