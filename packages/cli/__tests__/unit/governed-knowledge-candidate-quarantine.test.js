import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  openKnowledgeSkillRollbackStore,
  source,
} from "../fixtures/governed-knowledge-skill-rollback.js";
import { captureSkillReleaseOperationReader } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { createGovernedKnowledgeCandidateQuarantineAuthority } from "../../src/lib/evolution/governed-knowledge-candidate-rejection.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-candidate-quarantine-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, {
    candidateQuarantine: true,
    ...options,
    seed: true,
  });
}
function events(h, type) {
  return h.resources.backend.ledger
    .read()
    .filter((event) => event.type === type);
}
async function blocked(
  h,
  candidateId = h.release.candidateRelease.candidate.candidateId,
) {
  const error = await h.release
    .promoteCandidate(
      `quarantined:candidate:attempt:${randomUUID()}`,
      candidateId,
    )
    .catch((cause) => cause);
  const codes = [];
  for (let cause = error; cause; cause = cause.cause) codes.push(cause.code);
  expect(codes).toContain("CC_EVOLUTION_LEDGER_CANDIDATE_REVOKED");
}
function notSettled(h) {
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    0,
  );
  expect(h.sent).toHaveLength(0);
}

it.each([false, true])(
  "settles actual quarantine after rollback and reopens without relabelling it as rejection (Wiki=%s)",
  async (wikiProvenance) => {
    const h = await setup({ candidateQuarantine: "combined", wikiProvenance });
    const candidate = h.release.candidateRegistry.read(
      h.release.candidateRelease.candidate.candidateId,
    );
    const published = await h.makeSync().publish(h.knowledge);
    expect(published).toMatchObject({ action: "revoke" });
    const committed = await h.persisted.load({
      knowledgeId: h.knowledge.knowledgeId,
    });
    expect(committed.dependencies).toContainEqual({
      kind: "candidate",
      digest: candidate.candidateId,
      disposition: "quarantine",
    });
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    const result = await h.executor.execute(h.knowledge);
    expect(result).toMatchObject({ recovered: true, durable: true });
    expect(result.resultDigests).toHaveLength(2);
    const reader = captureSkillReleaseOperationReader(
      h.options.transactionLedger,
    );
    const query = {
      tenantId: h.knowledge.tenantId,
      skillName: candidate.skillName,
      candidateId: candidate.candidateId,
      operationDigest: result.operationDigest,
      context: reader.currentContext(),
    };
    expect(reader.resolveCandidateRevocation(query).fence).toBeNull();
    expect(
      reader.resolveCandidateQuarantine(query).fence.record.knowledge
        .dependencies,
    ).toContainEqual({
      kind: "candidate",
      digest: candidate.candidateId,
      disposition: "quarantine",
    });
    await blocked(h);
    const reopened = await openKnowledgeSkillRollbackStore(h.root, {
      candidateQuarantine: "combined",
      wikiProvenance,
    });
    expect(await reopened.executor.execute(h.knowledge)).toEqual(result);
    expect(
      await reopened.persisted.load({ knowledgeId: h.knowledge.knowledgeId }),
    ).toEqual(committed);
    expect(
      reopened.release.candidateRegistry.read(candidate.candidateId),
    ).toEqual(candidate);
    expect(reopened.release.inspect().transitions).toHaveLength(3);
    expect(
      events(reopened, "knowledge.revocation-dependencies.settled"),
    ).toHaveLength(1);
    expect(events(reopened, "knowledge.sync.committed")).toHaveLength(1);
    await blocked(reopened);
  },
  300_000,
);

it("quarantines a never-promoted draft without rewriting its bytes or an unrelated active pointer", async () => {
  const h = await setup();
  const candidate = h.release.createDerivedCandidate();
  const knowledge = {
    ...h.knowledge,
    dependencies: [
      {
        kind: "candidate",
        digest: candidate.candidateId,
        disposition: "quarantine",
      },
    ],
  };
  const before = h.release.readActive();
  await h.makeSync().publish(knowledge);
  expect(h.release.readActive()).toEqual(before);
  expect(h.release.candidateRegistry.read(candidate.candidateId)).toEqual(
    candidate,
  );
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    1,
  );
  await blocked(h, candidate.candidateId);
  expect(h.release.readActive()).toEqual(before);
}, 180_000);

it.each(["active", "last-known-good"])(
  "refuses to certify isolation while the candidate remains %s",
  async (mode) => {
    const h = await setup();
    if (mode === "last-known-good") {
      const safe = h.release.createDerivedCandidate({
        sourceEvidenceRefs: [
          {
            ref: "recording://safe/unrelated",
            digest: h.release.baseline.contentDigest,
          },
        ],
      });
      await h.release.promoteCandidate(
        "quarantine:safe-successor",
        safe.candidateId,
      );
      expect(h.release.readActive().state.lastKnownGoodReleaseDigest).toBe(
        h.release.candidateRelease.releaseDigest,
      );
    }
    const before = h.release.readActive();
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /real release rollback first/,
    );
    expect(h.release.readActive()).toEqual(before);
    notSettled(h);
  },
  180_000,
);

it("rejects unrelated provenance without claiming a completed quarantine", async () => {
  const h = await setup({
    candidateEvidenceRefs: [
      { ref: "knowledge://other/unrelated", digest: source.digest },
    ],
  });
  await h.release.rollback(h.knowledge.contentDigest);
  await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
    /source lineage/,
  );
  notSettled(h);
}, 180_000);

it("never treats rejection as quarantine and rejects borrowed or fabricated authority", async () => {
  const h = await setup();
  expect(() =>
    createGovernedKnowledgeCandidateQuarantineAuthority({
      ...h.quarantineOptions,
      verifierCandidateRegistry: h.release.candidateRegistry,
    }),
  ).toThrow(/independent/);
  expect(() =>
    createGovernedKnowledgeCandidateQuarantineAuthority({
      ...h.quarantineOptions,
      candidateRegistry: { ...h.release.candidateRegistry },
    }),
  ).toThrow(/genuine/);
  await expect(
    h.authority.apply({ tenantId: h.knowledge.tenantId }),
  ).rejects.toThrow(/prepared executor request/);
  await h.release.rollback(h.knowledge.contentDigest);
  const knowledge = {
    ...h.knowledge,
    dependencies: [
      { ...h.knowledge.dependencies[0], disposition: "reject-candidate" },
    ],
  };
  await expect(h.makeSync().publish(knowledge)).rejects.toThrow(
    /candidate \/ quarantine/,
  );
  notSettled(h);
}, 180_000);

it("does not settle quarantine while a pre-existing release transaction is still in flight", async () => {
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
  const promotion = h.release.promoteCandidate("quarantine:in-flight");
  try {
    await prepared;
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /in-flight release transition/,
    );
    notSettled(h);
  } finally {
    resume();
    await promotion;
  }
  expect(h.release.readActive().state.revision).toBe(4);
}, 180_000);
