import { describe, expect, it, vi } from "vitest";
import protocol from "../lib/evolvable-artifact.js";

const {
  ARTIFACT_TYPE,
  EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
  EVOLVABLE_ARTIFACT_TRANSITION_RECEIPT_SCHEMA,
  EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactCandidateGate,
  createEvolvableArtifactReleaseGate,
  createEvolvableArtifactActiveReleaseReader,
  isEvolvableArtifactActiveReleaseReader,
  createEvolvableArtifactRuntimeComposition,
  isEvolvableArtifactRuntimeComposition,
  getEvolvableArtifactRuntimeDependencies,
  isEvolvableArtifactReleaseGate,
  isEvolvableArtifactCandidateGate,
  createEvolvableArtifactReceipt,
  digestEvolvableArtifactValue: digest,
  projectEvolvableArtifactDependencyChange,
} = protocol;

function manifest(body) {
  return { ...body, digest: digest(body) };
}

function dependencyLock(dependencies = []) {
  const ordered = [...dependencies].sort((a, b) =>
    a.artifactId.localeCompare(b.artifactId),
  );
  return { dependencies: ordered, digest: digest({ dependencies: ordered }) };
}

function policy(type, revision = `${type}-policy-v1`) {
  const allow = vi.fn(() => ({ decision: "allow", policyRevision: revision }));
  return {
    value: createEvolvableArtifactPolicy({
      type,
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
    allow,
  };
}

function candidate(type, overrides = {}) {
  const contentDigest = overrides.contentDigest ?? digest(`${type}-content`);
  const runtimeBody =
    type === ARTIFACT_TYPE.HOOK
      ? {
          executable: true,
          codeSignatureDigest: digest("hook-signature"),
          sbomDigest: digest("hook-sbom"),
          sandboxDigest: digest("hook-sandbox"),
          networkEgressPolicyDigest: digest("hook-network"),
        }
      : type === ARTIFACT_TYPE.PROMPT
        ? { executable: false, dataPolicyDigest: digest("prompt-data-policy") }
        : { executable: type === ARTIFACT_TYPE.SKILL };
  return {
    tenantId: "tenant-a",
    artifactId: `${type}-a`,
    candidateId: `${type}-candidate-a`,
    type,
    contentDigest,
    parent: null,
    lineage: [contentDigest],
    dependencyLock: dependencyLock(),
    runtimeManifest: manifest(runtimeBody),
    permissionManifest: manifest({ capabilities: [] }),
    ...overrides,
  };
}

function receipt(artifact, kind, claims = {}) {
  return createEvolvableArtifactReceipt({
    kind,
    tenantId: artifact.tenantId,
    artifactId: artifact.artifactId,
    candidateId: artifact.candidate.candidateId,
    contentDigest: artifact.contentDigest,
    dependencyLockDigest: artifact.dependencyLock.digest,
    issuerId: `${kind}-authority`,
    issuerRevision: `${kind}-v1`,
    issuedAt: "2026-09-04T00:00:00.000Z",
    decision: "allow",
    claims,
  });
}

function candidatePersistenceReceipt(artifact) {
  return {
    schema: EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
    tenantId: artifact.tenantId,
    type: artifact.type,
    artifactId: artifact.artifactId,
    candidateId: artifact.candidate.candidateId,
    contentDigest: artifact.contentDigest,
    artifactDigest: artifact.artifactDigest,
    status: "candidate",
    persisted: true,
  };
}

function transitionStore({ loseResponse = false, mutateReadback = null } = {}) {
  const records = new Map();
  return {
    writer: {
      commitTransition: vi.fn(async ({ request, artifact }) => {
        const body = {
          schema: EVOLVABLE_ARTIFACT_TRANSITION_RECEIPT_SCHEMA,
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          kind: request.kind,
          tenantId: request.tenantId,
          type: request.type,
          artifactId: request.artifactId,
          candidateId: request.candidateId,
          releaseId: request.releaseId,
          artifactDigest: request.nextArtifactDigest,
          persisted: true,
          durable: true,
          revision: 1,
        };
        const transitionReceipt = {
          ...body,
          receiptDigest: digest(body),
        };
        records.set(request.operationId, {
          request,
          artifact,
          receipt: transitionReceipt,
        });
        if (loseResponse) throw new Error("response lost after commit");
        return transitionReceipt;
      }),
    },
    reader: {
      async readTransition({ operationId }) {
        const record = records.get(operationId) || null;
        return record && mutateReadback ? mutateReadback(record) : record;
      },
    },
  };
}

describe("EvolvableArtifact protocol", () => {
  it("assembles branded, tenant-scoped runtime dependencies by artifact type", () => {
    const allow = (revision) => () => ({
      decision: "allow",
      policyRevision: revision,
    });
    const config = (revision) => ({
      policy: {
        revision,
        admission: allow(revision),
        evaluator: allow(revision),
        activation: allow(revision),
        rollback: allow(revision),
      },
      candidateWriter: { persistCandidate: async () => null },
      transitionWriter: { commitTransition: async () => null },
      transitionReader: { readTransition: async () => null },
      activeProvider: {
        listActive: async () => [],
        readActive: async () => null,
      },
    });
    const composition = createEvolvableArtifactRuntimeComposition({
      tenantId: "tenant-runtime",
      artifacts: {
        [ARTIFACT_TYPE.SKILL]: config("skill-policy-v1"),
        [ARTIFACT_TYPE.PROMPT]: config("prompt-policy-v1"),
        [ARTIFACT_TYPE.HOOK]: config("hook-policy-v1"),
      },
    });
    const deps = getEvolvableArtifactRuntimeDependencies(composition);

    expect(isEvolvableArtifactRuntimeComposition(composition)).toBe(true);
    expect(isEvolvableArtifactRuntimeComposition({ ...composition })).toBe(
      false,
    );
    expect(
      isEvolvableArtifactActiveReleaseReader(
        deps.evolvableArtifactSkillActiveReleaseReader,
        ARTIFACT_TYPE.SKILL,
      ),
    ).toBe(true);
    expect(
      isEvolvableArtifactActiveReleaseReader(
        deps.evolvableArtifactPromptActiveReleaseReader,
        ARTIFACT_TYPE.PROMPT,
      ),
    ).toBe(true);
    expect(
      isEvolvableArtifactActiveReleaseReader(
        deps.evolvableArtifactHookActiveReleaseReader,
        ARTIFACT_TYPE.HOOK,
      ),
    ).toBe(true);
    expect(() =>
      getEvolvableArtifactRuntimeDependencies({ ...composition }),
    ).toThrow("branded EvolvableArtifact runtime composition");
    expect(() =>
      createEvolvableArtifactRuntimeComposition({
        tenantId: "tenant-runtime",
        artifacts: {
          [ARTIFACT_TYPE.SKILL]: {
            ...config("skill-policy-v1"),
            misspelledProvider: {},
          },
        },
      }),
    ).toThrow("unexpected or missing fields");
  });

  it("requires independently branded type policies and isolates their authority", () => {
    const promptPolicy = policy(ARTIFACT_TYPE.PROMPT);
    const knowledgePolicy = policy(ARTIFACT_TYPE.KNOWLEDGE);
    const promptAuthority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: promptPolicy.value,
    });
    const knowledgeAuthority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: knowledgePolicy.value,
    });
    const prompt = promptAuthority.stageCandidate(
      candidate(ARTIFACT_TYPE.PROMPT),
    );

    expect(prompt.candidate.status).toBe("candidate");
    expect(prompt.release).toBeNull();
    expect(prompt.activeReleaseId).toBeNull();
    expect(() =>
      knowledgeAuthority.recordEvaluation(prompt, receipt(prompt, "eval")),
    ).toThrow(/outside this authority scope/);
    expect(() =>
      createEvolvableArtifactAuthority({ tenantId: "tenant-a", policy: {} }),
    ).toThrow(/branded/);
  });

  it("persists only a candidate through a branded, digest-bound writer gate", async () => {
    const promptAuthority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.PROMPT).value,
    });
    const writer = {
      persistCandidate: vi.fn(async (artifact) => ({
        schema: EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
        tenantId: artifact.tenantId,
        type: artifact.type,
        artifactId: artifact.artifactId,
        candidateId: artifact.candidate.candidateId,
        contentDigest: artifact.contentDigest,
        artifactDigest: artifact.artifactDigest,
        status: "candidate",
        persisted: true,
      })),
    };
    const gate = createEvolvableArtifactCandidateGate({
      authority: promptAuthority,
      candidateWriter: writer,
    });
    const input = candidate(ARTIFACT_TYPE.PROMPT);
    const result = await gate.stageCandidate(input, "prompt-content");

    expect(isEvolvableArtifactCandidateGate(gate, ARTIFACT_TYPE.PROMPT)).toBe(
      true,
    );
    expect(gate.authorityScope).toBe(promptAuthority.authorityScope);
    expect(result.artifact.candidate.status).toBe("candidate");
    expect(result.artifact.release).toBeNull();
    expect(writer.persistCandidate).toHaveBeenCalledOnce();

    const badGate = createEvolvableArtifactCandidateGate({
      authority: promptAuthority,
      candidateWriter: {
        persistCandidate: async (artifact) => ({
          schema: EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
          tenantId: artifact.tenantId,
          type: artifact.type,
          artifactId: artifact.artifactId,
          candidateId: artifact.candidate.candidateId,
          contentDigest: artifact.contentDigest,
          artifactDigest: digest("substituted"),
          status: "candidate",
          persisted: true,
        }),
      },
    });
    await expect(
      badGate.stageCandidate(candidate(ARTIFACT_TYPE.PROMPT)),
    ).rejects.toThrow(/persistence receipt is invalid/);
  });

  it("brands only a type-scoped active release reader with exact content", async () => {
    const promptAuthority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.PROMPT).value,
    });
    const releaseGate = createEvolvableArtifactReleaseGate({
      authority: promptAuthority,
      transitionWriter: { commitTransition: vi.fn() },
      transitionReader: { readTransition: vi.fn() },
    });
    let artifact = promptAuthority.stageCandidate(
      candidate(ARTIFACT_TYPE.PROMPT),
    );
    artifact = promptAuthority.recordEvaluation(
      artifact,
      receipt(artifact, "eval"),
    );
    artifact = promptAuthority.activateCandidate(artifact, {
      reviewReceipt: receipt(artifact, "review"),
      promotionReceipt: receipt(artifact, "promotion"),
      releaseId: "prompt-release-a",
    });
    const active = {
      schema: EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA,
      authenticated: true,
      durable: true,
      tenantId: "tenant-a",
      type: ARTIFACT_TYPE.PROMPT,
      artifactId: "prompt-a",
      releaseId: "prompt-release-a",
      contentDigest: digest("prompt-content"),
      artifactDigest: artifact.artifactDigest,
      artifact,
      contentAvailable: true,
      content: "prompt-content",
    };
    const provider = {
      listActive: vi.fn(async () => [active]),
      readActive: vi.fn(async () => active),
    };
    const reader = createEvolvableArtifactActiveReleaseReader({
      releaseGate,
      provider,
    });
    expect(
      isEvolvableArtifactActiveReleaseReader(reader, ARTIFACT_TYPE.PROMPT),
    ).toBe(true);
    expect(isEvolvableArtifactActiveReleaseReader({ ...reader })).toBe(false);
    await expect(reader.listActive()).resolves.toEqual([active]);
    await expect(
      reader.readActive({ artifactId: "prompt-a" }),
    ).resolves.toEqual(active);
    provider.readActive.mockResolvedValueOnce({
      ...active,
      content: "substituted",
    });
    await expect(reader.readActive({ artifactId: "prompt-a" })).rejects.toThrow(
      "active artifact release is invalid",
    );
  });

  it("enforces signed executable metadata and a two-human high-risk Hook quorum", () => {
    const authority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.HOOK).value,
    });
    const missingSbom = candidate(ARTIFACT_TYPE.HOOK);
    const runtimeBody = { ...missingSbom.runtimeManifest };
    delete runtimeBody.digest;
    delete runtimeBody.sbomDigest;
    missingSbom.runtimeManifest = manifest(runtimeBody);
    expect(() => authority.stageCandidate(missingSbom)).toThrow(/sbomDigest/);

    let hook = authority.stageCandidate(candidate(ARTIFACT_TYPE.HOOK));
    hook = authority.recordEvaluation(hook, receipt(hook, "eval"));
    const promotion = receipt(hook, "promotion");
    const onePersonReview = receipt(hook, "review", {
      riskTier: "high",
      approvers: [
        { identityId: "alice", signatureDigest: digest("alice-signature") },
      ],
    });
    expect(() =>
      authority.activateCandidate(hook, {
        reviewReceipt: onePersonReview,
        promotionReceipt: promotion,
        releaseId: "hook-release-1",
      }),
    ).toThrow(/two distinct signed human approvers/);

    const twoPersonReview = receipt(hook, "review", {
      riskTier: "high",
      approvers: [
        { identityId: "alice", signatureDigest: digest("alice-signature") },
        { identityId: "bob", signatureDigest: digest("bob-signature") },
      ],
    });
    const active = authority.activateCandidate(hook, {
      reviewReceipt: twoPersonReview,
      promotionReceipt: promotion,
      releaseId: "hook-release-1",
    });
    expect(active.activeReleaseId).toBe("hook-release-1");
    expect(active.candidate.status).toBe("promoted");
  });

  it("durably promotes and recovers a lost transition response by operationId", async () => {
    const authority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.PROMPT).value,
    });
    const store = transitionStore({ loseResponse: true });
    const releaseGate = createEvolvableArtifactReleaseGate({
      authority,
      transitionWriter: store.writer,
      transitionReader: store.reader,
    });
    const prompt = authority.stageCandidate(
      candidate(ARTIFACT_TYPE.PROMPT, {
        activeReleaseId: "prompt-release-0",
        lastKnownGoodReleaseId: "prompt-release-minus-1",
      }),
    );
    const promoted = await releaseGate.promote({
      artifact: prompt,
      candidatePersistenceReceipt: candidatePersistenceReceipt(prompt),
      evaluationReceipt: receipt(prompt, "eval"),
      reviewReceipt: receipt(prompt, "review"),
      promotionReceipt: receipt(prompt, "promotion"),
      releaseId: "prompt-release-1",
    });

    expect(
      isEvolvableArtifactReleaseGate(releaseGate, ARTIFACT_TYPE.PROMPT),
    ).toBe(true);
    expect(promoted.recovered).toBe(true);
    expect(promoted.artifact).toMatchObject({
      activeReleaseId: "prompt-release-1",
      lastKnownGoodReleaseId: "prompt-release-0",
      release: { releaseId: "prompt-release-1", status: "active" },
    });
    expect(promoted.receipt).toMatchObject({
      kind: "promote",
      persisted: true,
      durable: true,
    });
  });

  it("prepares policy-authorized promotion before committing active state", async () => {
    const authority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.KNOWLEDGE).value,
    });
    const store = transitionStore();
    const releaseGate = createEvolvableArtifactReleaseGate({
      authority,
      transitionWriter: store.writer,
      transitionReader: store.reader,
    });
    const knowledge = authority.stageCandidate(
      candidate(ARTIFACT_TYPE.KNOWLEDGE),
    );
    const prepared = releaseGate.preparePromotion({
      artifact: knowledge,
      candidatePersistenceReceipt: candidatePersistenceReceipt(knowledge),
      evaluationReceipt: receipt(knowledge, "eval"),
      reviewReceipt: receipt(knowledge, "review"),
      promotionReceipt: receipt(knowledge, "promotion"),
      releaseId: "knowledge-release-1",
    });

    expect(prepared.artifact.activeReleaseId).toBe("knowledge-release-1");
    expect(store.writer.commitTransition).not.toHaveBeenCalled();
    await expect(
      releaseGate.commitPreparedPromotion({ ...prepared }),
    ).rejects.toThrow(/prepared by this release gate/);
    await expect(
      releaseGate.commitPreparedPromotion(prepared),
    ).resolves.toMatchObject({
      artifact: { activeReleaseId: "knowledge-release-1" },
      receipt: { durable: true },
    });
    expect(store.writer.commitTransition).toHaveBeenCalledOnce();
  });

  it("rejects a substituted durable transition readback", async () => {
    const authority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.KNOWLEDGE).value,
    });
    const store = transitionStore({
      mutateReadback: (record) => ({
        ...record,
        artifact: { ...record.artifact, activeReleaseId: "substituted" },
      }),
    });
    const releaseGate = createEvolvableArtifactReleaseGate({
      authority,
      transitionWriter: store.writer,
      transitionReader: store.reader,
    });
    const knowledge = authority.stageCandidate(
      candidate(ARTIFACT_TYPE.KNOWLEDGE),
    );

    await expect(
      releaseGate.promote({
        artifact: knowledge,
        candidatePersistenceReceipt: candidatePersistenceReceipt(knowledge),
        evaluationReceipt: receipt(knowledge, "eval"),
        reviewReceipt: receipt(knowledge, "review"),
        promotionReceipt: receipt(knowledge, "promotion"),
        releaseId: "knowledge-release-1",
      }),
    ).rejects.toThrow(/durable readback is invalid/);
  });

  it("cascades dependency drift and persists revalidation through the candidate gate", async () => {
    const skillAuthority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.SKILL).value,
    });
    const promptAuthority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.PROMPT).value,
    });
    const knowledgeAuthority = createEvolvableArtifactAuthority({
      tenantId: "tenant-a",
      policy: policy(ARTIFACT_TYPE.KNOWLEDGE).value,
    });
    const skill = skillAuthority.stageCandidate(candidate(ARTIFACT_TYPE.SKILL));
    const promptInput = candidate(ARTIFACT_TYPE.PROMPT, {
      dependencyLock: dependencyLock([
        {
          artifactId: skill.artifactId,
          type: skill.type,
          releaseId: "skill-release-1",
          contentDigest: skill.contentDigest,
        },
      ]),
    });
    const prompt = promptAuthority.stageCandidate(promptInput);
    const knowledge = knowledgeAuthority.stageCandidate(
      candidate(ARTIFACT_TYPE.KNOWLEDGE, {
        dependencyLock: dependencyLock([
          {
            artifactId: prompt.artifactId,
            type: prompt.type,
            releaseId: "prompt-release-1",
            contentDigest: prompt.contentDigest,
          },
        ]),
      }),
    );
    const projection = projectEvolvableArtifactDependencyChange(
      [skill, prompt, knowledge],
      {
        artifactId: skill.artifactId,
        releaseId: "skill-release-2",
        contentDigest: digest("skill-content-v2"),
      },
    );

    expect(projection.staleArtifactIds).toEqual(["knowledge-a", "prompt-a"]);
    const stalePrompt = projection.artifacts.find(
      (item) => item.artifactId === "prompt-a",
    );
    expect(stalePrompt.staleReasons).toEqual(["dependency:skill-a"]);
    expect(() =>
      promptAuthority.recordEvaluation(
        stalePrompt,
        receipt(stalePrompt, "eval"),
      ),
    ).toThrow(/must be revalidated/);

    const newDependencyLock = dependencyLock([
      {
        artifactId: skill.artifactId,
        type: skill.type,
        releaseId: "skill-release-2",
        contentDigest: digest("skill-content-v2"),
      },
    ]);
    const revalidationShape = {
      ...stalePrompt,
      candidate: {
        candidateId: "prompt-revalidation-2",
        status: "candidate",
      },
      dependencyLock: newDependencyLock,
    };
    const revalidationReceipt = receipt(revalidationShape, "revalidation", {
      resolvedReleaseIds: ["skill-release-2"],
    });
    const persistCandidate = vi.fn(async (artifact) =>
      candidatePersistenceReceipt(artifact),
    );
    const revalidationGate = createEvolvableArtifactCandidateGate({
      authority: promptAuthority,
      candidateWriter: { persistCandidate },
    });
    const stagedRevalidation =
      await revalidationGate.stageRevalidationCandidate(stalePrompt, {
        candidateId: "prompt-revalidation-2",
        dependencyLock: newDependencyLock,
        revalidationReceipt,
      });
    const revalidation = stagedRevalidation.artifact;
    expect(revalidation).toMatchObject({
      stale: false,
      staleReasons: [],
      release: null,
      activeReleaseId: stalePrompt.activeReleaseId,
      lastKnownGoodReleaseId: stalePrompt.lastKnownGoodReleaseId,
      candidate: {
        candidateId: "prompt-revalidation-2",
        status: "candidate",
      },
    });
    expect(revalidation.receipts.revalidation.kind).toBe("revalidation");
    expect(stagedRevalidation.receipt).toEqual(
      candidatePersistenceReceipt(revalidation),
    );
    expect(persistCandidate).toHaveBeenCalledOnce();
    expect(() =>
      promptAuthority.createRevalidationCandidate(revalidation, {
        candidateId: "another",
        dependencyLock: newDependencyLock,
        revalidationReceipt,
      }),
    ).toThrow(/only a stale artifact/);
  });
});
