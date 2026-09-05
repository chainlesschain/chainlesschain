import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";
import { createGovernedKnowledgeSkillRollbackAuthority } from "../../src/lib/evolution/governed-knowledge-skill-rollback.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-knowledge-wiki-rollback-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, {
    seed: true,
    wikiProvenance: true,
    ...options,
  });
}

describe("Knowledge revocation through historical Wiki provenance", () => {
  it("uses the original Wiki revision despite later removal and restores the actual safe LKG", async () => {
    const h = await setup();
    expect(h.release.candidateRelease.candidate.derivationMode).toBe("wiki");
    expect(
      h.release.candidateRelease.candidate.sourceEvidenceRefs,
    ).not.toContainEqual({
      ref: expect.stringMatching(/^knowledge:/),
      digest: h.knowledge.contentDigest,
    });
    const revisionId = h.release.candidateRelease.candidate.wikiRevision;
    const original = h.wiki.reader.readRevision({
      tenantId: h.descriptor.tenantId,
      revisionId,
    });
    await h.wiki.write(true, { tombstone: true });
    expect(
      h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status,
    ).toBe("tombstoned");
    const historical = h.wiki.reader.readRevision({
      tenantId: h.descriptor.tenantId,
      revisionId,
    });
    expect(historical.state).toEqual(original.state);
    expect(historical.checkpoint).toEqual(original.checkpoint);
    expect(historical.ledgerHead.sequence).toBeGreaterThan(
      original.ledgerHead.sequence,
    );
    await expect(h.makeSync().publish(h.knowledge)).resolves.toMatchObject({
      action: "revoke",
    });
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.independent.readActive().release).toEqual(h.release.baseline);
    expect(h.release.inspect().transitions).toHaveLength(3);
    const reopened = await openKnowledgeSkillRollbackStore(h.root, {
      wikiProvenance: true,
    });
    await expect(reopened.executor.execute(h.knowledge)).resolves.toMatchObject(
      { recovered: true, durable: true },
    );
    expect(reopened.release.readActive().release).toEqual(h.release.baseline);
    expect(reopened.release.inspect().transitions).toHaveLength(3);
  }, 180_000);

  it("rejects an LKG indirectly dependent on the revoked Knowledge", async () => {
    const h = await setup({ unsafeWikiBaseline: true });
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /last-known-good Wiki revision still depends/,
    );
    expect(h.release.readActive().release).toEqual(h.release.candidateRelease);
    expect(h.release.inspect().transitions).toHaveLength(2);
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("rejects retroactive Wiki provenance committed after the original promotion", async () => {
    const h = await setup({ lateWikiProvenance: true });
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /precede the original release preparation/,
    );
    expect(h.release.readActive().release).toEqual(h.release.candidateRelease);
    expect(h.release.inspect().transitions).toHaveLength(2);
    expect(h.sent).toHaveLength(0);
  }, 180_000);

  it("rejects forged or shared Wiki readers and unknown historical revisions", async () => {
    const h = await setup();
    expect(() =>
      createGovernedKnowledgeSkillRollbackAuthority({
        ...h.options,
        verifierWikiLedgerAdapter: h.options.wikiLedgerAdapter,
      }),
    ).toThrow(/independent paired/);
    expect(() =>
      createGovernedKnowledgeSkillRollbackAuthority({
        ...h.options,
        verifierWikiLedgerAdapter: { ...h.options.verifierWikiLedgerAdapter },
      }),
    ).toThrow(/branded/);
    expect(() =>
      h.wiki.reader.readRevision({
        tenantId: h.descriptor.tenantId,
        revisionId: `wiki:${"0".repeat(64)}`,
      }),
    ).toThrow(/not in authenticated history/);
    expect(() =>
      h.wiki.reader.readRevision({
        tenantId: "other-tenant",
        revisionId: h.release.candidateRelease.candidate.wikiRevision,
      }),
    ).toThrow(/exact tenant/);
    await expect(
      h.makeSync().publish({
        ...h.knowledge,
        contentDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).rejects.toThrow(/no exact Knowledge source lineage/);
    expect(h.release.inspect().transitions).toHaveLength(2);
    expect(h.sent).toHaveLength(0);
  }, 180_000);
});
