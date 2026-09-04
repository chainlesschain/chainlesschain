import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { createEvolutionReviewStage } from "../../src/lib/evolution/evolution-release-train-domain-stages.js";
import { buildSkillCandidateDraft } from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import { SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA } from "../../src/lib/evolution/skill-evaluated-promotion.js";
import { SkillPromotionReviewLedgerAdapter } from "../../src/lib/evolution/skill-promotion-review-ledger-adapter.js";
import { SKILL_WIKI_REVIEW_DECISION_SCHEMA } from "../../src/lib/evolution/skill-wiki-reconciliation.js";
import {
  SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
  buildSkillPromotionReviewEnvelope,
  buildSkillPromotionReviewPacket,
  createSkillPromotionReviewProvider,
} from "../../src/lib/evolution/skill-promotion-review.js";

const NOW = "2026-09-02T10:00:00.000Z";
const TENANT_ID = "tenant:review-ledger";
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value = domain) {
  const input =
    arguments.length === 1 ? String(value) : `${domain}\0${canonical(value)}`;
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -40_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
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
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function authority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const secret = `test-only-${label}-secret`;
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: { sign: ({ message }) => ({ ...trust, value: sign(message) }) },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    },
  };
}

function packetFixture(content = "Run focused tests.") {
  const dependencyLock = buildSkillDependencyLock({
    tenantId: TENANT_ID,
    lock: { generation: 1, packages: { vitest: "4.1.10" } },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId: TENANT_ID,
    runtimes: [
      {
        runtimeId: "cli",
        descriptor: {
          platform: "linux-x64",
          runtime: "node-22.12.0",
          sandboxPolicyDigest: digest("sandbox"),
        },
      },
    ],
  });
  const cells = [
    {
      cellId: "cli-linux-x64",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:cli-linux-x64",
      environmentDigest: digest("environment"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId: TENANT_ID,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  const candidate = buildSkillCandidateDraft(
    {
      tenantId: TENANT_ID,
      skillName: "repair-unit-tests",
      parentDigest: null,
      sourceEvidenceRefs: [
        { ref: "recording://runs/review-ledger-1", digest: digest("evidence") },
      ],
      derivationMode: "record-replay",
      wikiRevision: null,
      proposerModel: null,
      requestedCapabilities: ["workspace.read", "workspace.write"],
      evalRunId: null,
      content: `---\nname: repair-unit-tests\n---\n\n${content}\n`,
      dependencyLock,
      runtimeManifest,
      targetMatrix,
    },
    {
      expectedEnvironmentBindings: cells,
      expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
    },
  );
  const matrixBinding = {
    schema: SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA,
    tenantId: TENANT_ID,
    skillName: candidate.skillName,
    candidateId: candidate.candidateId,
    candidateContentDigest: candidate.contentDigest,
    expectedActiveContentDigest: `sha256:${createHash("sha256")
      .update("chainlesschain.skill-active/empty/v1\0", "utf8")
      .digest("hex")}`,
    expectedActiveRevision: 0,
    matrixEvalId: "matrix-eval:review-ledger-1",
    matrixReceiptDigest: digest("matrix-receipt"),
    decisionCommitmentDigest: digest("matrix-decision"),
    expiresAt: "2026-09-02T10:10:00.000Z",
    receiptResolution: {
      authorityId: "authority:matrix",
      resolverDescriptorDigest: digest("matrix-resolver"),
      resolverRevision: 1,
      resolvedAt: NOW,
    },
  };
  const state = {
    tenantId: TENANT_ID,
    skillName: candidate.skillName,
    revision: 0,
    activeReleaseDigest: null,
  };
  return {
    candidate,
    matrixBinding,
    state,
    packet: buildSkillPromotionReviewPacket({
      candidate,
      matrixBinding,
      state,
    }),
  };
}

function decisionFor(packet, overrides = {}) {
  const core = {
    schema: SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
    tenantId: TENANT_ID,
    skillName: packet.skillName,
    candidateId: packet.candidateId,
    packetDigest: packet.packetDigest,
    decision: "approved",
    automated: false,
    reviewerIds: ["human:alice", "human:bob"],
    quorum: 2,
    reason: "Reviewed the durable packet and approved this candidate.",
    decidedAt: NOW,
    expiresAt: "2026-09-02T10:10:00.000Z",
    acknowledgedContentRiskDigest: packet.contentRisk.detected
      ? packet.contentRisk.contentRiskDigest
      : null,
    ...overrides,
  };
  return {
    ...core,
    receiptDigest: digest(
      "chainlesschain.skill-promotion-review-decision/v1",
      core,
    ),
    signature: "signed-human-review-decision-value-0001",
  };
}

function backends() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-review-ledger-"),
  );
  roots.push(root);
  const now = Date.parse(NOW);
  const secret = "test-only-review-artifact-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/review-artifacts";
  const policyDigest = digest("artifact-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const ports = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: "artifact-tenant-review",
    now: () => now,
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
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
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-02T10:00:30.000Z",
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
          receiptDigest: digest(
            "chainlesschain.evolution-artifact-authority-decision/v1",
            core,
          ),
        };
      },
    },
  });
  const state = { events: [], failAfterAppend: false };
  const ledger = {
    read: () => structuredClone(state.events),
    verify: () => ({
      epoch: "epoch-review",
      ledgerId: "ledger-review",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    }),
    appendDomainEvent: (input, options) => {
      const head = state.events.at(-1);
      if (
        options.expectedSequence !== state.events.length ||
        options.expectedHeadDigest !== (head?.eventDigest ?? null)
      ) {
        throw new Error("ledger head conflict");
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: digest("ledger-event", input),
      };
      state.events.push(event);
      if (state.failAfterAppend) {
        state.failAfterAppend = false;
        throw new Error("simulated response loss");
      }
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: digest("ledger-receipt", event),
      };
    },
  };
  return {
    artifactPorts: ports,
    ledger,
    resolver: ports.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    }),
    state,
    root,
  };
}

function adapter(storage, verifier = vi.fn(async () => true)) {
  return {
    adapter: new SkillPromotionReviewLedgerAdapter({
      descriptor: {
        tenantId: TENANT_ID,
        artifactTenantId: "artifact-tenant-review",
        streamId: "review-stream:one",
        audience: "evolution-runtime",
        purpose: "evolution-ledger",
        authorityId: "authority:human-review",
        revision: 1,
        handlerArtifactDigest: digest("review-handler"),
      },
      artifactPorts: storage.artifactPorts,
      ledger: storage.ledger,
      ledgerArtifactResolver: storage.resolver,
      decisionVerifier: { verify: verifier },
      now: () => Date.parse(NOW),
    }),
    verifier,
  };
}

describe("SkillPromotionReviewLedgerAdapter", () => {
  it("reopens packet and decision through real Ledger files and witness", async () => {
    const storage = backends();
    const fixture = packetFixture("Persist through a real ledger reopen.");
    const witnessDirectory = path.join(storage.root, "witness");
    fs.mkdirSync(witnessDirectory, { mode: 0o700 });
    const options = {
      rootDir: path.join(storage.root, "ledger-events"),
      authorityRootDir: path.join(storage.root, "ledger-authority"),
      witnessFilePath: path.join(witnessDirectory, "checkpoint.json"),
      witnessId: "witness-review-ledger",
      ledgerAuthority: authority("review-ledger"),
      witnessAuthority: authority("review-witness"),
      artifactResolver: storage.resolver,
      clock: () => Date.parse(NOW),
      fsImpl: durableFilesystem(),
      secure: false,
    };
    const firstBackend = createEvolutionLedgerFileBackend(options);
    const first = adapter({ ...storage, ledger: firstBackend.ledger }).adapter;
    await first.submitPacket(fixture.packet);
    const decision = decisionFor(fixture.packet);
    await first.retainDecision({
      packetDigest: fixture.packet.packetDigest,
      decision,
    });
    expect(firstBackend.ledger.verify()).toMatchObject({ sequence: 2 });

    const reopenedBackend = createEvolutionLedgerFileBackend(options);
    const reopened = adapter({
      ...storage,
      ledger: reopenedBackend.ledger,
    }).adapter;
    await expect(reopened.listReviews()).resolves.toMatchObject([
      {
        status: "approved",
        packet: { packetDigest: fixture.packet.packetDigest },
        decision: { receiptDigest: decision.receiptDigest },
      },
    ]);
    expect(reopenedBackend.ledger.verify()).toMatchObject({ sequence: 2 });
  });

  it("persists a packet and approved decision across adapter instances", async () => {
    const storage = backends();
    const fixture = packetFixture();
    const first = adapter(storage);
    await expect(
      first.adapter.submitPacket(fixture.packet),
    ).resolves.toMatchObject({
      persisted: true,
      packetDigest: fixture.packet.packetDigest,
    });
    await expect(first.adapter.listReviews()).resolves.toMatchObject([
      { status: "pending", decision: null },
    ]);

    const decision = decisionFor(fixture.packet);
    await expect(
      first.adapter.retainDecision({
        packetDigest: fixture.packet.packetDigest,
        decision,
      }),
    ).resolves.toMatchObject({
      persisted: true,
      receiptDigest: decision.receiptDigest,
    });

    const reopened = adapter(storage);
    await expect(reopened.adapter.listReviews()).resolves.toMatchObject([
      {
        status: "approved",
        packet: { packetDigest: fixture.packet.packetDigest },
        decision: { receiptDigest: decision.receiptDigest },
      },
    ]);
    const provider = createSkillPromotionReviewProvider({
      tenantId: TENANT_ID,
      authorityId: "authority:human-review",
      handlerArtifactDigest: digest("review-handler"),
      revision: 1,
      decisionResolver: reopened.adapter.createDecisionResolver(),
      decisionVerifier: { verify: async () => true },
      now: () => Date.parse(NOW),
    });
    await expect(
      provider.verify({
        candidate: fixture.candidate,
        activeRelease: null,
        matrixBinding: fixture.matrixBinding,
        state: fixture.state,
        authorization: {
          request: {
            receipts: {
              policyReceipt: buildSkillPromotionReviewEnvelope(
                decision.receiptDigest,
              ),
            },
          },
        },
      }),
    ).resolves.toMatchObject({ reviewReceiptDigest: decision.receiptDigest });
  });

  it("executes the ReleaseTrain Review adapter against the durable human-review ledger", async () => {
    const storage = backends();
    const fixture = packetFixture(
      "Review through the production train adapter.",
    );
    const review = adapter(storage).adapter;
    await review.submitPacket(fixture.packet);
    const decision = decisionFor(fixture.packet);
    await review.retainDecision({
      packetDigest: fixture.packet.packetDigest,
      decision,
    });

    let stored = null;
    const outputLedger = {
      load: vi.fn(() => stored),
      commit: vi.fn((input) => {
        stored = {
          ...structuredClone(input),
          valueDigest: digest("release-train-review-output", input.value),
        };
        return { committed: true };
      }),
    };
    const plan = Object.freeze({
      tenantId: TENANT_ID,
      skillId: fixture.candidate.skillName,
      planDigest: digest("release-train-review-plan"),
      candidateId: fixture.candidate.candidateId,
      candidateDigest: fixture.candidate.contentDigest,
      baselineReleaseDigest: null,
      baselineRevision: fixture.state.revision,
    });
    const stage = createEvolutionReviewStage({
      reviewLedger: review,
      packetInput: {
        candidate: fixture.candidate,
        matrixBinding: fixture.matrixBinding,
        state: fixture.state,
      },
      outputLedger,
      usage: { tokens: 0, cost: 0, timeMs: 1, turns: 1 },
    });

    await expect(
      stage({
        plan,
        stage: "review",
        operationKey: digest("release-train-review-operation"),
        inputDigest: fixture.matrixBinding.matrixReceiptDigest,
      }),
    ).resolves.toMatchObject({
      stage: "review",
      inputDigest: fixture.matrixBinding.matrixReceiptDigest,
      outputDigest: decision.receiptDigest,
      durable: true,
    });
    expect(stored).toMatchObject({
      value: {
        packet: { packetDigest: fixture.packet.packetDigest },
        decision: { receiptDigest: decision.receiptDigest },
      },
    });
    expect(storage.state.events).toHaveLength(2);
    expect(outputLedger.commit).toHaveBeenCalledTimes(1);
  });

  it("recovers packet submission after a lost append response", async () => {
    const storage = backends();
    const fixture = packetFixture("Recover the same immutable packet.");
    const review = adapter(storage).adapter;
    storage.state.failAfterAppend = true;
    await expect(review.submitPacket(fixture.packet)).rejects.toThrow(
      "simulated response loss",
    );
    await expect(review.submitPacket(fixture.packet)).resolves.toMatchObject({
      persisted: true,
      recovered: true,
      packetDigest: fixture.packet.packetDigest,
    });
    expect(storage.state.events).toHaveLength(1);
  });

  it("durably records a signed rejection without creating an approval", async () => {
    const storage = backends();
    const fixture = packetFixture("Do not promote this candidate.");
    const review = adapter(storage).adapter;
    await review.submitPacket(fixture.packet);
    const rejection = decisionFor(fixture.packet, {
      decision: "rejected",
      reviewerIds: ["human:alice"],
      quorum: 1,
      reason: "The candidate does not satisfy the review policy.",
      acknowledgedContentRiskDigest: null,
    });
    await expect(
      review.retainDecision({
        packetDigest: fixture.packet.packetDigest,
        decision: rejection,
      }),
    ).resolves.toMatchObject({
      persisted: true,
      receiptDigest: rejection.receiptDigest,
    });
    await expect(review.listReviews()).resolves.toMatchObject([
      {
        status: "rejected",
        decision: { receiptDigest: rejection.receiptDigest },
      },
    ]);
    await expect(
      review.createWikiRejectionReconciliationSource().list(),
    ).resolves.toMatchObject([
      {
        schema: SKILL_WIKI_REVIEW_DECISION_SCHEMA,
        authenticated: true,
        durable: true,
        tenantId: TENANT_ID,
        candidateId: fixture.candidate.candidateId,
        skillName: fixture.candidate.skillName,
        decision: "rejected",
        decisionReceiptDigest: rejection.receiptDigest,
        transitionDigest: expect.stringMatching(/^sha256:/u),
      },
    ]);
  });

  it("rejects forged packets and unauthenticated decisions before ledger mutation", async () => {
    const storage = backends();
    const fixture = packetFixture("Require a real signature.");
    const signatureVerifier = vi.fn(async () => false);
    const review = adapter(storage, signatureVerifier).adapter;
    await expect(
      review.submitPacket(structuredClone(fixture.packet)),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_REVIEW_INVALID" });
    expect(storage.state.events).toHaveLength(0);

    await review.submitPacket(fixture.packet);
    await expect(
      review.retainDecision({
        packetDigest: fixture.packet.packetDigest,
        decision: decisionFor(fixture.packet),
      }),
    ).rejects.toThrow("signature verification failed");
    expect(storage.state.events).toHaveLength(1);
  });

  it("fails closed when decision-to-packet ledger lineage is substituted", async () => {
    const storage = backends();
    const fixture = packetFixture("Preserve exact decision lineage.");
    const review = adapter(storage).adapter;
    await review.submitPacket(fixture.packet);
    await review.retainDecision({
      packetDigest: fixture.packet.packetDigest,
      decision: decisionFor(fixture.packet),
    });
    storage.state.events[1].sourceRefs = [
      {
        schema: "chainlesschain.evolution-artifact-ref/v1",
        ref: "forged",
        digest: digest("forged"),
      },
    ];

    await expect(review.listReviews()).rejects.toMatchObject({
      code: "CC_SKILL_PROMOTION_REVIEW_LEDGER_CORRUPT",
    });
  });
});
