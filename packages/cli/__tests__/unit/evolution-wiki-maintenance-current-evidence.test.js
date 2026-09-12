import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createJourneyAuthorities,
  createJourneyFixture,
  NOW,
} from "../helpers/evolution-wiki-journey-fixture.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

it.each(["revoked", "deleted", "expired", "access-denied"])(
  "does not persist Wiki work when real evidence becomes %s during derive",
  async (change) => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-wiki-current-read-"),
    );
    roots.push(root);
    const tenantId = "tenant-current-evidence";
    const authorities = createJourneyAuthorities(tenantId);
    const accessPolicy = authorities.readAuthorities.accessPolicy;
    const authorize = accessPolicy.authorize.bind(accessPolicy);
    let denyAccess = false;
    accessPolicy.authorize = (request) => {
      if (denyAccess) throw new Error("Wiki read access has been revoked");
      return authorize(request);
    };
    const f = createJourneyFixture(root, { tenantId, authorities });
    const item = await f.project({
      summary: "focused-checks",
      result: "passed",
    });
    f.reference(item.result);
    f.complete();
    await expect(
      f.resolver.resolveEvidence(item.result.evidenceId),
    ).resolves.toMatchObject({ trustedProjection: true });
    const baseline = f.wikiAdapter.loadWiki();
    const ledgerHead = f.backend.ledger.verify();
    let derived = 0;
    const maintainer = f.maintainer(async () => {
      derived += 1;
      // These are current authority state changes, not patched resolver/Reader
      // methods or caller-supplied trusted evidence. effectiveAt stays old.
      if (change === "expired") authorities.advance(366 * 24 * 60 * 60 * 1000);
      else if (change === "access-denied") denyAccess = true;
      else authorities.revoke(item.result.evidenceId, change);
      return { operations: [] };
    });
    await expect(
      maintainer.maintain({
        evidenceRefs: [item.result.evidenceId],
        effectiveAt: NOW,
      }),
    ).rejects.toThrow();
    expect(derived).toBe(1);
    expect(f.wikiAdapter.loadWiki()).toEqual(baseline);
    expect(f.backend.ledger.verify()).toEqual({
      ...ledgerHead,
      // verify's observation time changes, not the authenticated head/state.
      verifiedAt: new Date(authorities.now()).toISOString(),
    });
  },
  120_000,
);

it("does not corroborate duplicated real signed content under two principals", async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-wiki-repeat-source-"),
  );
  roots.push(root);
  const f = createJourneyFixture(root);
  const refs = [];
  for (const principalId of ["tool-a", "tool-b"]) {
    const item = await f.project(
      { summary: "focused-checks", result: "passed" },
      { principalId, sourceRef: `rollout://${f.tenantId}/${principalId}` },
    );
    f.reference(item.result);
    refs.push(item.result.evidenceId);
  }
  f.complete();
  const evidence = await Promise.all(
    refs.map((ref) => f.resolver.resolveEvidence(ref)),
  );
  expect(evidence[0].sourceDigest).toBe(evidence[1].sourceDigest);
  expect(evidence[0].trustDomain).not.toBe(evidence[1].trustDomain);
  const result = await f
    .maintainer(() => ({
      operations: [
        {
          type: "upsert",
          pattern: {
            patternId: "pat-repeated-source",
            kind: "success",
            summary: "Repeated identical observation",
            rootCause: "The same content was signed twice",
            procedure: "Run focused checks",
            appliesWhen: ["deterministic tests exist"],
            doesNotApplyWhen: ["data migration required"],
            positiveEvidence: refs,
            confidence: 0.8,
            skillNames: ["safe-refactor"],
          },
        },
      ],
    }))
    .maintain({ evidenceRefs: refs, effectiveAt: NOW });
  expect(result.state.patterns["pat-repeated-source"]).toMatchObject({
    status: "hypothesis",
    actionable: false,
  });
  expect(f.wikiAdapter.loadWiki().stateDigest).toBe(result.stateDigest);
}, 120_000);

it("rejects a derived secret before any real Wiki artifact or ledger write", async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-wiki-derived-secret-"),
  );
  roots.push(root);
  const f = createJourneyFixture(root);
  const item = await f.project({ summary: "focused-checks", result: "passed" });
  f.reference(item.result);
  f.complete();
  const baseline = f.wikiAdapter.loadWiki();
  const entries = f.artifactStore
    .list()
    .map((entry) => entry.id)
    .sort();
  const ledgerHead = f.backend.ledger.verify();
  const canary = "sk-derived-wiki-abcdefghijklmnopqrstuvwxyz0123456789";
  let derived = 0;
  const maintainer = f.maintainer(({ evidence }) => {
    derived += 1;
    expect(evidence[0].data.summary).toBe("focused-checks");
    return {
      operations: [
        {
          type: "upsert",
          pattern: {
            patternId: "pat-derived-secret",
            kind: "success",
            summary: canary,
            rootCause:
              "A derived output is not trusted merely because inputs are",
            procedure: "Run focused checks",
            appliesWhen: ["deterministic tests exist"],
            doesNotApplyWhen: [],
            positiveEvidence: [item.result.evidenceId],
            confidence: 0.8,
            skillNames: ["safe-refactor"],
          },
        },
      ],
    };
  });
  await expect(
    maintainer.maintain({
      evidenceRefs: [item.result.evidenceId],
      effectiveAt: NOW,
    }),
  ).rejects.toMatchObject({ code: "WIKI_MAINTAINER_SECRET_LEAK" });
  expect(derived).toBe(1);
  expect(f.wikiAdapter.loadWiki()).toEqual(baseline);
  expect(f.backend.ledger.verify()).toEqual(ledgerHead);
  expect(
    f.artifactStore
      .list()
      .map((entry) => entry.id)
      .sort(),
  ).toEqual(entries);
  for (const entry of f.artifactStore.list())
    expect(
      fs.readFileSync(f.artifactStore.storedPath(entry), "utf8"),
    ).not.toContain(canary);
}, 120_000);
