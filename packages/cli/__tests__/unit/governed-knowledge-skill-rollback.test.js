import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGovernedKnowledgeSkillRollbackAuthority } from "../../src/lib/evolution/governed-knowledge-skill-rollback.js";
import {
  openKnowledgeSkillRollbackStore,
  source,
  knowledgeId,
} from "../fixtures/governed-knowledge-skill-rollback.js";
import { GovernedKnowledgeDependencyLedgerExecutor } from "../../src/lib/evolution/governed-knowledge-dependency-ledger-executor.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options) {
  const root = fs.mkdtempSync(
    path.join(
      fs.realpathSync.native(os.tmpdir()),
      "cc-knowledge-real-rollback-",
    ),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, { ...options, seed: true });
}

describe("governed Knowledge real Skill rollback", () => {
  it("switches the actual active release before sync publication and reopens without repeating the effect", async () => {
    const h = await setup();
    await expect(h.makeSync().publish(h.knowledge)).resolves.toMatchObject({
      action: "revoke",
    });
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.independent.readActive().release).toEqual(h.release.baseline);
    expect(h.release.readActive().state.revision).toBe(3);
    const events = h.resources.backend.ledger.read();
    const finalize = events
      .filter((event) => event.type === "skill.release.finalize")
      .at(-1);
    const settled = events.find(
      (event) => event.type === "knowledge.revocation-dependencies.settled",
    );
    const published = events.find(
      (event) => event.type === "knowledge.sync.committed",
    );
    expect(finalize.sequence).toBeLessThan(settled.sequence);
    expect(settled.sequence).toBeLessThan(published.sequence);
    expect(h.sent).toHaveLength(1);
    const reopened = await openKnowledgeSkillRollbackStore(h.root);
    expect(reopened.release.readActive()).toEqual(h.release.readActive());
    expect(await reopened.persisted.load({ knowledgeId })).toMatchObject({
      action: "revoke",
    });
    await expect(reopened.executor.execute(h.knowledge)).resolves.toMatchObject(
      { recovered: true, durable: true },
    );
    expect(reopened.release.inspect().transitions).toHaveLength(3);
  }, 180_000);

  it("quarantines an active release by rolling back and durably blocking reactivation", async () => {
    const h = await setup({ activeQuarantine: true });

    await h.makeSync().publish(h.knowledge);

    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.knowledge.dependencies).toEqual([
      {
        kind: "active-skill",
        digest: h.release.candidateRelease.releaseDigest,
        disposition: "quarantine",
      },
    ]);
    await expect(
      h.release.promoteCandidate("reactivate-quarantined-release"),
    ).rejects.toMatchObject({
      code: "SKILL_RELEASE_LEDGER_PREPARE_FAILED",
      cause: { code: "CC_EVOLUTION_LEDGER_SOURCE_REVOKED" },
    });
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    await expect(h.executor.execute(h.knowledge)).resolves.toMatchObject({
      recovered: true,
      durable: true,
    });
    expect(h.release.inspect().transitions).toHaveLength(3);
  }, 180_000);

  it.each([
    [
      "unrelated candidate",
      {
        candidateEvidenceRefs: [
          { ref: "knowledge://elsewhere/unrelated", digest: source.digest },
        ],
      },
      /source lineage/,
    ],
    [
      "unsafe last-known-good",
      { baselineEvidenceRefs: [source] },
      /still depends/,
    ],
  ])(
    "rejects %s before a release mutation or transport",
    async (_label, options, error) => {
      const h = await setup(options);
      await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(error);
      expect(h.release.readActive().release).toEqual(
        h.release.candidateRelease,
      );
      expect(h.release.inspect().transitions).toHaveLength(2);
      expect(h.sent).toHaveLength(0);
    },
    180_000,
  );

  it("rejects a content digest in place of an immutable release identity", async () => {
    const h = await setup();
    const input = {
      ...h.knowledge,
      dependencies: [
        {
          ...h.knowledge.dependencies[0],
          digest: h.release.candidateRelease.contentDigest,
        },
      ],
    };
    await expect(h.makeSync().publish(input)).rejects.toThrow();
    expect(h.release.inspect().transitions).toHaveLength(2);
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("requires genuine independent registry and operation readers", async () => {
    const h = await setup();
    expect(() =>
      createGovernedKnowledgeSkillRollbackAuthority({
        ...h.options,
        verifierReleaseRegistry: h.options.releaseRegistry,
      }),
    ).toThrow(/independent/);
    expect(() =>
      createGovernedKnowledgeSkillRollbackAuthority({
        ...h.options,
        verifierTransactionLedger: { ...h.options.verifierTransactionLedger },
      }),
    ).toThrow();
    expect(() =>
      createGovernedKnowledgeSkillRollbackAuthority({
        ...h.options,
        rollbackProvider: {},
      }),
    ).toThrow(/branded/);
    let accessed = false;
    expect(() =>
      createGovernedKnowledgeSkillRollbackAuthority({
        ...h.options,
        authorizationProvider: {
          get authorizeRollback() {
            accessed = true;
            throw new Error("getter executed");
          },
        },
      }),
    ).toThrow(/fixed rollback authorization/);
    expect(accessed).toBe(false);
  }, 180_000);

  it("does not silently substitute rollback for quarantine", async () => {
    const h = await setup();
    const input = {
      ...h.knowledge,
      dependencies: [
        { ...h.knowledge.dependencies[0], disposition: "quarantine" },
      ],
    };
    await expect(h.makeSync().publish(input)).rejects.toThrow(
      /rollback-active dependency/,
    );
    expect(h.release.inspect().transitions).toHaveLength(2);
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("does not claim an unrelated rollback as this revocation's durable effect", async () => {
    const h = await setup();
    await h.release.rollback(source.digest);
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /not currently active/,
    );
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.release.inspect().transitions).toHaveLength(3);
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("rejects authority approval for another operation before switching a release", async () => {
    const h = await setup();
    const original = h.options.authorizationProvider.authorizeRollback;
    const authority = createGovernedKnowledgeSkillRollbackAuthority({
      ...h.options,
      authorizationProvider: {
        authorizeRollback: (expected) =>
          original({
            ...expected,
            operationId: "unrelated-authorized-operation",
          }),
      },
    });
    const executor = new GovernedKnowledgeDependencyLedgerExecutor({
      descriptor: h.descriptor,
      artifactPorts: h.resources.artifactPorts,
      ledger: h.resources.backend.ledger,
      ledgerArtifactResolver: h.resources.resolver,
      dependencyAuthority: authority,
      now: h.resources.clock,
    });
    await expect(h.makeSync(executor).publish(h.knowledge)).rejects.toThrow(
      /different transition/,
    );
    expect(h.release.readActive().release).toEqual(h.release.candidateRelease);
    expect(h.release.inspect().transitions).toHaveLength(2);
    expect(h.sent).toHaveLength(0);
  }, 180_000);
});
