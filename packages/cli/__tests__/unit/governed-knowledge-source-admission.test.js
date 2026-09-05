import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_LEDGER_SOURCE_REVOKED_CODE,
  EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
  EVOLUTION_LEDGER_PORTS_INVALID_CODE,
} from "../../src/lib/evolution/evolution-ledger-ports.js";
import {
  openKnowledgeSkillRollbackStore,
  source,
} from "../fixtures/governed-knowledge-skill-rollback.js";

const PREPARED = "knowledge.revocation-dependencies.prepared";
const safe = {
  ref: "knowledge://unrelated/source",
  digest: `sha256:${"a".repeat(64)}`,
};
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-source-admission-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, { ...options, seed: true });
}
function codes(error) {
  const result = [];
  while (error) {
    result.push(error.code);
    error = error.cause;
  }
  return result;
}
async function revoke(h) {
  // Deliberately unresolved candidate disposition; a durable preparation is
  // sufficient for source admission and does not imply a completed rollback.
  await expect(
    h.makeSync().publish({
      ...h.knowledge,
      dependencies: [
        {
          kind: "candidate",
          digest: h.release.candidateRelease.candidateId,
          disposition: "reject-candidate",
        },
      ],
    }),
  ).rejects.toThrow();
  expect(
    h.resources.backend.ledger.read().filter((e) => e.type === PREPARED),
  ).toHaveLength(1);
}
async function blocked(
  h,
  candidate,
  code = EVOLUTION_LEDGER_SOURCE_REVOKED_CODE,
) {
  const before = h.release.readActive();
  const transitions = h.release.inspect().transitions.length;
  const error = await h.release
    .promoteCandidate(`source:${candidate.candidateId}`, candidate.candidateId)
    .catch((cause) => cause);
  expect(codes(error)).toContain(code);
  expect(h.release.readActive()).toEqual(before);
  expect(h.release.inspect().transitions).toHaveLength(transitions);
}

describe("Knowledge source admission on actual release activation", () => {
  it.each([
    ["same source", source],
    [
      "aliased address",
      { ...source, ref: "recording://alias/revoked-content" },
    ],
    ["changed digest", { ...source, digest: safe.digest }],
  ])(
    "blocks a new candidate ID with %s before settlement",
    async (_name, evidence) => {
      const h = await setup();
      await h.release.rollback(h.knowledge.contentDigest);
      await revoke(h);
      const candidate = h.release.createDerivedCandidate({
        sourceEvidenceRefs: [evidence],
      });
      expect(candidate.candidateId).not.toBe(
        h.release.candidateRelease.candidateId,
      );
      await blocked(h, candidate);
    },
    180_000,
  );

  it("allows a genuinely unrelated candidate after revocation", async () => {
    const h = await setup();
    await h.release.rollback(h.knowledge.contentDigest);
    await revoke(h);
    const candidate = h.release.createDerivedCandidate({
      sourceEvidenceRefs: [safe],
    });
    await expect(
      h.release.promoteCandidate("source:unrelated", candidate.candidateId),
    ).resolves.toMatchObject({ state: { revision: 4 } });
  }, 180_000);

  it("blocks new Wiki candidates from the original context despite later tombstones", async () => {
    const h = await setup({ wikiProvenance: true });
    await h.release.rollback(h.knowledge.contentDigest);
    await revoke(h);
    await h.wiki.write(true, { tombstone: true });
    const candidate = h.release.createDerivedCandidate();
    expect(candidate.sourceEvidenceRefs).not.toContainEqual(source);
    await blocked(h, candidate);
  }, 180_000);

  it("allows an unrelated pinned Wiki revision instead of consulting the current tainted Wiki", async () => {
    const h = await setup({ wikiProvenance: true });
    await h.release.rollback(h.knowledge.contentDigest);
    await revoke(h);
    const candidate = h.release.createDerivedCandidate({
      wikiRevision: h.release.baseline.candidate.wikiRevision,
      sourceEvidenceRefs: h.release.baseline.candidate.sourceEvidenceRefs,
    });
    await expect(
      h.release.promoteCandidate("source:safe-wiki", candidate.candidateId),
    ).resolves.toMatchObject({ state: { revision: 4 } });
  }, 180_000);

  it("fails closed when a declared original Wiki revision is absent", async () => {
    const h = await setup({ wikiProvenance: true });
    await h.release.rollback(h.knowledge.contentDigest);
    await revoke(h);
    const candidate = h.release.createDerivedCandidate({
      wikiRevision: `wiki:${"b".repeat(64)}`,
    });
    await blocked(h, candidate, EVOLUTION_LEDGER_PORTS_CORRUPT_CODE);
  }, 180_000);

  it("blocks rollback to a derived release not listed in the revocation dependencies", async () => {
    const h = await setup();
    const derived = h.release.createDerivedCandidate();
    const promoted = await h.release.promoteCandidate(
      "source:derived-before-revoke",
      derived.candidateId,
    );
    const successor = h.release.createDerivedCandidate({
      sourceEvidenceRefs: [safe],
    });
    await h.release.promoteCandidate(
      "source:safe-successor",
      successor.candidateId,
    );
    await revoke(h);
    const before = h.release.readActive();
    const error = await h.release
      .rollbackTo(promoted.release.releaseDigest, "source:unsafe-rollback")
      .catch((cause) => cause);
    expect(codes(error)).toContain(EVOLUTION_LEDGER_SOURCE_REVOKED_CODE);
    expect(h.release.readActive()).toEqual(before);
    expect(h.release.inspect().transitions).toHaveLength(4);
  }, 180_000);

  it("rechecks sources when a revocation wins the prepare CAS", async () => {
    let h;
    let deferred;
    let armed = false;
    h = await setup({
      beforeDependencyAppend(event) {
        if (event.type === PREPARED) {
          deferred = structuredClone(event);
          throw new Error("test: delay revocation");
        }
      },
      onReleaseRetain(binding) {
        if (armed && binding.type === "skill-release-transition-intent") {
          armed = false;
          h.resources.backend.ledger.appendDomainEvent(deferred);
        }
      },
    });
    await h.release.rollback(h.knowledge.contentDigest);
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow();
    expect(deferred?.type).toBe(PREPARED);
    const candidate = h.release.createDerivedCandidate();
    armed = true;
    await blocked(h, candidate);
    expect(armed).toBe(false);
  }, 180_000);

  it("rejects omitted, substituted and executable target evidence at the genuine ledger port", async () => {
    let h;
    let armed = false;
    let checked = false;
    h = await setup({
      async onTransition(phase, transaction) {
        if (!armed || phase !== "after-journal") return;
        armed = false;
        const port = h.release.pruningRollbackOptions.transactionLedger;
        const release =
          h.release.pruningRollbackOptions.releaseRegistry.readRelease(
            transaction.intent.targetReleaseDigest,
          );
        let reads = 0;
        const accessor = { ...release };
        Object.defineProperty(accessor, "candidate", {
          enumerable: true,
          get() {
            reads += 1;
            throw new Error("getter executed");
          },
        });
        const proxy = new Proxy(release, {
          getPrototypeOf() {
            reads += 1;
            throw new Error("proxy executed");
          },
        });
        for (const input of [undefined, h.release.baseline, accessor, proxy]) {
          expect(() => port.prepare(transaction.intent, input)).toThrowError(
            expect.objectContaining({
              code: EVOLUTION_LEDGER_PORTS_INVALID_CODE,
            }),
          );
        }
        expect(reads).toBe(0);
        expect(port.query(transaction.intent.transactionId).status).toBe(
          "absent",
        );
        checked = true;
      },
    });
    await h.release.rollback(h.knowledge.contentDigest);
    await revoke(h);
    const candidate = h.release.createDerivedCandidate({
      sourceEvidenceRefs: [safe],
    });
    armed = true;
    await h.release.promoteCandidate(
      "source:strict-target",
      candidate.candidateId,
    );
    expect(checked).toBe(true);
  }, 180_000);
});
