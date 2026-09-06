import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_LEDGER_CANDIDATE_REVOKED_CODE,
  EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
} from "../../src/lib/evolution/evolution-ledger-ports.js";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";

const PREPARED = "knowledge.revocation-dependencies.prepared";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-candidate-revocation-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, { ...options, seed: true });
}
function revocation(
  h,
  disposition = "reject-candidate",
  digest = h.release.candidateRelease.candidate.candidateId,
) {
  return {
    ...h.knowledge,
    dependencies: [{ kind: "candidate", digest, disposition }],
  };
}
function causes(error) {
  const codes = [];
  while (error) {
    codes.push(error.code);
    error = error.cause;
  }
  return codes;
}
async function expectBlocked(release, operationId) {
  const result = await release.promoteCandidate(operationId).then(
    () => ({ succeeded: true }),
    (error) => error,
  );
  expect(causes(result)).toContain(EVOLUTION_LEDGER_CANDIDATE_REVOKED_CODE);
}
async function prepare(h, input = revocation(h)) {
  // The real rollback-only provider cannot settle a candidate effect. This
  // deliberately leaves the genuine executor's signed preparation outstanding;
  // no test-owned success result is allowed to manufacture candidate rejection.
  await expect(h.makeSync().publish(input)).rejects.toThrow();
  expect(
    h.resources.backend.ledger.read().filter((e) => e.type === PREPARED),
  ).toHaveLength(1);
  expect(
    h.resources.backend.ledger
      .read()
      .filter((e) => e.type === "knowledge.revocation-dependencies.settled"),
  ).toHaveLength(0);
  expect(h.sent).toHaveLength(0);
}

describe("Knowledge candidate admission fence in real release transactions", () => {
  it.each(["reject-candidate", "quarantine"])(
    "blocks new promotion for %s before settlement and after reopen, without blocking rollback",
    async (disposition) => {
      const h = await setup();
      await prepare(h, revocation(h, disposition));
      await h.release.rollback(h.knowledge.contentDigest);
      await expectBlocked(h.release, `blocked:${disposition}:one`);
      expect(h.release.readActive().release).toEqual(h.release.baseline);
      expect(h.release.readActive().state.revision).toBe(3);
      expect(h.release.inspect().transitions).toHaveLength(3);
      const reopened = await openKnowledgeSkillRollbackStore(h.root);
      await expectBlocked(reopened.release, `blocked:${disposition}:two`);
      expect(reopened.release.readActive().release).toEqual(h.release.baseline);
      expect(reopened.release.inspect().transitions).toHaveLength(3);
    },
    180_000,
  );

  it("does not confuse source content digest with immutable candidate identity", async () => {
    const h = await setup({
      candidateEvidenceRefs: [
        {
          ref: "knowledge://unrelated/source",
          digest: `sha256:${"a".repeat(64)}`,
        },
      ],
    });
    await prepare(
      h,
      revocation(
        h,
        "reject-candidate",
        h.release.candidateRelease.contentDigest,
      ),
    );
    await h.release.rollback(h.knowledge.contentDigest);
    await expect(
      h.release.promoteCandidate("different:candidate-identity"),
    ).resolves.toMatchObject({ state: { revision: 4 } });
    expect(h.release.readActive().release.candidate.candidateId).toBe(
      h.release.candidateRelease.candidate.candidateId,
    );
  }, 180_000);

  it("honors a prepared revocation in another knowledge stream on the same ledger", async () => {
    let h;
    h = await setup({
      beforeDependencyAppend(event) {
        if (event.type !== PREPARED) return;
        h.resources.backend.ledger.appendDomainEvent({
          ...event,
          correlationId: "knowledge-revocations:another-stream",
        });
        throw new Error("test: another stream owns preparation");
      },
    });
    await prepare(h);
    await h.release.rollback(h.knowledge.contentDigest);
    await expectBlocked(h.release, "blocked:another-stream");
    expect(h.release.readActive().release).toEqual(h.release.baseline);
  }, 180_000);

  it.each(["event-id", "artifact-type", "prepared-digest"])(
    "fails closed on authenticated but inconsistent %s evidence",
    async (attack) => {
      let h;
      h = await setup({
        beforeDependencyAppend(event) {
          if (event.type !== PREPARED) return;
          const replacement = structuredClone(event);
          if (attack === "event-id") replacement.eventId += ".substituted";
          if (attack === "artifact-type") {
            replacement.subjectRef = h.resources.backend.ledger
              .read()
              .find((e) => e.type === "skill.release.prepare").subjectRef;
          }
          if (attack === "prepared-digest") {
            const identity = h.resources.backend.ledger.verify();
            const resolved = h.resources.resolver({
              epoch: identity.epoch,
              ledgerId: identity.ledgerId,
              tenantId: h.resources.descriptor.artifactTenantId,
              ref: event.subjectRef,
            });
            const artifact = JSON.parse(resolved.bytes.toString("utf8"));
            artifact.value.recordDigest = h.knowledge.contentDigest;
            replacement.subjectRef = h.resources.artifactPorts.putCanonical(
              "governed-knowledge-dependency-operation",
              artifact.value,
              {
                audience: artifact.audience,
                purpose: artifact.purpose,
                retention: "ledger",
              },
            ).ref;
          }
          h.resources.backend.ledger.appendDomainEvent(replacement);
          throw new Error("test: inconsistent preparation");
        },
      });
      await h.release.rollback(h.knowledge.contentDigest);
      await prepare(h);
      const error = await h.release
        .promoteCandidate(`invalid:${attack}`)
        .catch((cause) => cause);
      expect(causes(error)).toContain(
        attack === "prepared-digest"
          ? "CC_GOVERNED_KNOWLEDGE_DEPENDENCY_LEDGER_CORRUPT"
          : EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      );
      expect(h.release.readActive().release).toEqual(h.release.baseline);
      expect(h.release.inspect().transitions).toHaveLength(3);
    },
    180_000,
  );

  it("closes the read-to-append race when revocation wins the authenticated ledger head", async () => {
    let deferred;
    let armed = false;
    let h;
    h = await setup({
      beforeDependencyAppend(event) {
        if (event.type === PREPARED) {
          deferred = structuredClone(event);
          throw new Error("test: deferred preparation");
        }
      },
      onReleaseRetain(binding) {
        if (armed && binding.type === "skill-release-transition-intent") {
          armed = false;
          h.resources.backend.ledger.appendDomainEvent(deferred);
        }
      },
    });
    await expect(h.makeSync().publish(revocation(h))).rejects.toThrow();
    expect(deferred?.type).toBe(PREPARED);
    expect(
      h.resources.backend.ledger.read().filter((e) => e.type === PREPARED),
    ).toHaveLength(0);
    await h.release.rollback(h.knowledge.contentDigest);
    armed = true;
    await expectBlocked(h.release, "race:revocation-wins");
    expect(armed).toBe(false);
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.release.inspect().transitions).toHaveLength(3);
  }, 180_000);

  it("lets a promotion prepared before revocation finalize without claiming that its active release was rolled back", async () => {
    let armed = false;
    let h;
    h = await setup({
      async onTransition(phase, transaction) {
        if (
          armed &&
          phase === "after-prepare" &&
          transaction.intent.operation === "promote"
        ) {
          armed = false;
          await prepare(h);
        }
      },
    });
    await h.release.rollback(h.knowledge.contentDigest);
    armed = true;
    await expect(
      h.release.promoteCandidate("race:promotion-wins"),
    ).resolves.toMatchObject({ state: { revision: 4 } });
    const events = h.resources.backend.ledger.read();
    const prepared = events.find((e) => e.type === PREPARED);
    expect(
      events.filter((e) => e.type === "skill.release.prepare").at(-1).sequence,
    ).toBeLessThan(prepared.sequence);
    expect(
      events.filter((e) => e.type === "skill.release.finalize").at(-1).sequence,
    ).toBeGreaterThan(prepared.sequence);
    // This is intentionally NOT reported as an active rollback or settled
    // candidate effect: the winning in-flight release remains active.
    expect(h.release.readActive().state.revision).toBe(4);
    expect(h.sent).toHaveLength(0);
  }, 180_000);
});
