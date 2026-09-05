import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openKnowledgeSkillRollbackStore,
  source,
} from "../fixtures/governed-knowledge-skill-rollback.js";
import { createGovernedKnowledgeCandidateRejectionAuthority } from "../../src/lib/evolution/governed-knowledge-candidate-rejection.js";
import { createGovernedKnowledgeDependencyRouter } from "../../src/lib/evolution/governed-knowledge-dependency-authority.js";
import {
  captureSkillCandidateRegistryReader,
  SkillCandidateRegistry,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import { captureSkillReleaseOperationReader } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { GovernedKnowledgeDependencyLedgerExecutor } from "../../src/lib/evolution/governed-knowledge-dependency-ledger-executor.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-candidate-rejection-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, {
    candidateRejection: true,
    ...options,
    seed: true,
  });
}
function events(h, type) {
  return h.resources.backend.ledger
    .read()
    .filter((event) => event.type === type);
}
function executorFor(h, dependencyAuthority) {
  return new GovernedKnowledgeDependencyLedgerExecutor({
    descriptor: h.descriptor,
    artifactPorts: h.resources.artifactPorts,
    ledger: h.resources.backend.ledger,
    ledgerArtifactResolver: h.resources.resolver,
    dependencyAuthority,
    now: h.resources.clock,
  });
}
function errorCodes(error) {
  const result = [];
  while (error) {
    result.push(error.code);
    error = error.cause;
  }
  return result;
}
async function blocked(
  h,
  candidateId = h.release.candidateRelease.candidate.candidateId,
) {
  const error = await h.release
    .promoteCandidate("rejected:candidate:attempt", candidateId)
    .catch((cause) => cause);
  expect(errorCodes(error)).toContain("CC_EVOLUTION_LEDGER_CANDIDATE_REVOKED");
}
function unpublished(h, overrides = {}) {
  const original = h.release.candidateRelease.candidate;
  const input = Object.fromEntries(
    [
      "tenantId",
      "skillName",
      "content",
      "dependencyLock",
      "runtimeManifest",
      "targetMatrix",
      "derivationMode",
      "evalRunId",
      "proposerModel",
      "requestedCapabilities",
      "sourceEvidenceRefs",
      "wikiRevision",
    ].map((key) => [key, original[key]]),
  );
  return h.release.candidateRegistry.create({
    ...input,
    parentDigest: h.release.readActive().release.contentDigest,
    content: `${original.content}\nA distinct unpublished candidate.\n`,
    ...overrides,
  }).candidate;
}

describe("real Knowledge candidate rejection authority", () => {
  it.each([false, true])(
    "rolls back then independently settles candidate rejection (Wiki=%s), and reopens without duplicate effects",
    async (wikiProvenance) => {
      const h = await setup({ candidateRejection: "combined", wikiProvenance });
      if (wikiProvenance) await h.wiki.write(true, { tombstone: true });
      await expect(h.makeSync().publish(h.knowledge)).resolves.toMatchObject({
        action: "revoke",
      });
      expect(h.release.readActive().release).toEqual(h.release.baseline);
      expect(h.release.readActive().state.revision).toBe(3);
      expect(
        events(h, "knowledge.revocation-dependencies.settled"),
      ).toHaveLength(1);
      expect(events(h, "knowledge.sync.committed")).toHaveLength(1);
      const result = await h.executor.execute(h.knowledge);
      expect(result).toMatchObject({ recovered: true, durable: true });
      await blocked(h);
      const reopened = await openKnowledgeSkillRollbackStore(h.root, {
        candidateRejection: "combined",
        wikiProvenance,
      });
      expect(await reopened.executor.execute(h.knowledge)).toEqual(result);
      expect(reopened.release.inspect().transitions).toHaveLength(3);
      expect(
        events(reopened, "knowledge.revocation-dependencies.settled"),
      ).toHaveLength(1);
    },
    300_000,
  );

  it("rejects a never-promoted immutable draft without modifying its bytes or the unrelated active pointer", async () => {
    const h = await setup();
    const candidate = unpublished(h);
    const knowledge = {
      ...h.knowledge,
      dependencies: [
        {
          kind: "candidate",
          digest: candidate.candidateId,
          disposition: "reject-candidate",
        },
      ],
    };
    const before = h.release.readActive();
    await expect(h.makeSync().publish(knowledge)).resolves.toMatchObject({
      action: "revoke",
    });
    expect(h.release.readActive()).toEqual(before);
    expect(h.release.candidateRegistry.read(candidate.candidateId)).toEqual(
      candidate,
    );
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      1,
    );
    await blocked(h, candidate.candidateId);
    expect(h.release.readActive()).toEqual(before);
  }, 300_000);

  it("will not certify rejection while the same candidate remains active", async () => {
    const h = await setup();
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /real release rollback first/,
    );
    expect(h.release.readActive().release).toEqual(h.release.candidateRelease);
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      0,
    );
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("requires exact Knowledge provenance before certifying a candidate effect", async () => {
    const h = await setup({
      candidateEvidenceRefs: [
        { ref: "knowledge://other/unrelated", digest: source.digest },
      ],
    });
    await h.release.rollback(h.knowledge.contentDigest);
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /source lineage/,
    );
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      0,
    );
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("does not settle rejection if an inactive candidate remains eligible for rollback", async () => {
    const h = await setup();
    const safe = unpublished(h, {
      sourceEvidenceRefs: [
        {
          ref: "recording://safe/unrelated",
          digest: h.release.baseline.contentDigest,
        },
      ],
    });
    await h.release.promoteCandidate(
      "promote:safe-successor",
      safe.candidateId,
    );
    expect(h.release.readActive().state.lastKnownGoodReleaseDigest).toBe(
      h.release.candidateRelease.releaseDigest,
    );
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /rollback-eligible/,
    );
    expect(h.release.readActive().release.candidate.candidateId).toBe(
      safe.candidateId,
    );
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      0,
    );
  }, 180_000);

  it("requires an in-flight promotion to finish or recover before certifying rejection", async () => {
    let armed = false;
    let signal;
    let resume;
    const prepared = new Promise((resolve) => {
      signal = resolve;
    });
    const pause = new Promise((resolve) => {
      resume = resolve;
    });
    const h = await setup({
      onTransition: async (phase, transaction) => {
        if (
          armed &&
          phase === "after-prepare" &&
          transaction.intent.operation === "promote"
        ) {
          armed = false;
          signal();
          await pause;
        }
      },
    });
    await h.release.rollback(h.knowledge.contentDigest);
    armed = true;
    const promotion = h.release.promoteCandidate("promotion:in-flight");
    try {
      await prepared;
      await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
        /in-flight release transition/,
      );
      expect(
        events(h, "knowledge.revocation-dependencies.settled"),
      ).toHaveLength(0);
      expect(h.sent).toHaveLength(0);
    } finally {
      resume();
      await promotion;
    }
    expect(h.release.readActive().state.revision).toBe(4);
  }, 180_000);

  it("does not use a Wiki revision committed after the candidate's original promotion", async () => {
    const h = await setup({ wikiProvenance: true, lateWikiProvenance: true });
    await h.release.rollback(h.knowledge.contentDigest);
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /must precede/,
    );
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      0,
    );
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("will not reinterpret quarantine as candidate rejection", async () => {
    const h = await setup();
    await h.release.rollback(h.knowledge.contentDigest);
    const knowledge = {
      ...h.knowledge,
      dependencies: [
        { ...h.knowledge.dependencies[0], disposition: "quarantine" },
      ],
    };
    await expect(h.makeSync().publish(knowledge)).rejects.toThrow(
      /candidate \/ reject-candidate/,
    );
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      0,
    );
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("has no generic-success fallback for missing or incorrectly configured routes", async () => {
    const h = await setup();
    const router = createGovernedKnowledgeDependencyRouter({
      tenantId: h.knowledge.tenantId,
      deviceId: h.descriptor.deviceId,
      routes: { "active-skill/rollback-active": h.authority },
    });
    const sync = h.makeSync(executorFor(h, router));
    await expect(sync.publish(h.knowledge)).rejects.toThrow(
      /no real authority/,
    );
    await expect(
      sync.publish({
        ...h.knowledge,
        dependencies: [
          {
            kind: "active-skill",
            digest: h.release.candidateRelease.releaseDigest,
            disposition: "rollback-active",
          },
        ],
      }),
    ).rejects.toThrow(/candidate \/ reject-candidate/);
    expect(h.release.inspect().transitions).toHaveLength(2);
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      0,
    );
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("requires genuine independent readers and cannot route a caller-built request", async () => {
    const h = await setup();
    expect(() =>
      captureSkillCandidateRegistryReader({ ...h.release.candidateRegistry }),
    ).toThrow(/genuine/);
    expect(() =>
      captureSkillCandidateRegistryReader(
        Object.create(SkillCandidateRegistry.prototype),
      ),
    ).toThrow(/genuine/);
    expect(() =>
      createGovernedKnowledgeCandidateRejectionAuthority({
        ...h.rejectionOptions,
        verifierCandidateRegistry: h.release.candidateRegistry,
      }),
    ).toThrow(/independent/);
    expect(() =>
      createGovernedKnowledgeCandidateRejectionAuthority({
        ...h.rejectionOptions,
        verifierTransactionLedger: h.options.transactionLedger,
      }),
    ).toThrow(/independent/);
    const router = createGovernedKnowledgeDependencyRouter({
      tenantId: h.knowledge.tenantId,
      deviceId: h.descriptor.deviceId,
      routes: { "candidate/reject-candidate": h.authority },
    });
    await expect(
      router.apply({ tenantId: h.knowledge.tenantId }),
    ).rejects.toThrow(/prepared executor request/);
    expect(() =>
      createGovernedKnowledgeDependencyRouter({
        tenantId: h.knowledge.tenantId,
        deviceId: h.descriptor.deviceId,
        routes: { "candidate/reject-candidate": { ...h.authority } },
      }),
    ).toThrow(/genuine/);
    const reader = captureSkillReleaseOperationReader(
      h.options.transactionLedger,
    );
    expect(() =>
      reader.resolveCandidateRevocation({
        tenantId: h.knowledge.tenantId,
        skillName: "safe-refactor",
        candidateId: h.knowledge.dependencies[0].digest,
        operationDigest: h.knowledge.contentDigest,
        context: { ...reader.currentContext(), mode: "checkpoint" },
      }),
    ).toThrow(/current context/);
  }, 180_000);
});
