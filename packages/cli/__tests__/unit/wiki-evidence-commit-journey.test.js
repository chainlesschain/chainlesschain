import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createJourneyAuthorities,
  createJourneyFixture,
  NOW,
  digest,
} from "../helpers/evolution-wiki-journey-fixture.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function files(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else
        result[path.relative(root, target)] = digest(fs.readFileSync(target));
    }
  }
  visit(root);
  return result;
}
function setup(configure = () => {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-wiki-lease-"),
  );
  roots.push(root);
  const authorities = createJourneyAuthorities("tenant-journey");
  configure(authorities);
  return createJourneyFixture(root, { authorities });
}
async function baseline(f, count = 2) {
  const refs = [];
  for (let index = 0; index < count; index++) {
    const item = await f.project(
      { summary: `checks-${index}`, result: "passed" },
      {
        principalId: index % 2 ? "tool-b" : "tool-a",
      },
    );
    f.reference(item.result);
    refs.push(item.result.evidenceId);
  }
  f.complete();
  return refs;
}
function upsert(refs) {
  return {
    operations: [
      {
        type: "upsert",
        pattern: {
          patternId: "pat-batch-verified",
          kind: "success",
          summary: "Independent bounded checks agree",
          rootCause: "Observed checks",
          procedure: "Run checks",
          appliesWhen: ["bounded fixture"],
          doesNotApplyWhen: ["unverified environment"],
          positiveEvidence: refs,
          negativeEvidence: [],
          confidence: 0.8,
          skillNames: ["safe-refactor"],
        },
      },
    ],
  };
}

describe("real Wiki publication under a whole-evidence lease", () => {
  it("denies A revoked during final B authorization without writing any Wiki bytes", async () => {
    let refs;
    let reads = 0;
    let acquires = 0;
    const f = setup((authority) => {
      const authorize = authority.readAuthorities.accessPolicy.authorize;
      authority.readAuthorities.accessPolicy.authorize = async (request) => {
        const result = await authorize(request);
        if (++reads === 4) {
          expect(request.evidenceId).toBe(refs[1]);
          authority.revoke(refs[0]);
        }
        return result;
      };
      const acquire = authority.commitCoordinator.acquireCurrentEvidence;
      authority.commitCoordinator.acquireCurrentEvidence = (request) => {
        acquires++;
        expect(request.evidenceBindings.map((item) => item.ref)).toEqual(refs);
        return acquire(request);
      };
    });
    refs = await baseline(f);
    const before = files(f.root);
    const state = f.wikiAdapter.loadWiki().stateDigest;
    await expect(
      f
        .maintainer(() => upsert(refs))
        .maintain({ evidenceRefs: refs, effectiveAt: NOW }),
    ).rejects.toMatchObject({ code: "CC_WIKI_EVIDENCE_COMMIT_DENIED" });
    expect(reads).toBe(4);
    expect(acquires).toBe(1);
    expect(f.wikiAdapter.loadWiki().stateDigest).toBe(state);
    expect(files(f.root)).toEqual(before);
    await expect(f.resolver.resolveEvidence(refs[0])).rejects.toMatchObject({
      code: "CC_EVOLUTION_PROJECTION_ACCESS_DENIED",
    });
  }, 120_000);

  it("holds the same authority state and ACL through actual persistence and releases for later revocation", async () => {
    let refs;
    let assertions = 0;
    let releases = 0;
    const f = setup((authority) => {
      const acquire = authority.commitCoordinator.acquireCurrentEvidence;
      authority.commitCoordinator.acquireCurrentEvidence = (request) => {
        const lease = acquire(request);
        return Object.freeze({
          ...lease,
          assertCurrent() {
            assertions++;
            expect(lease.assertCurrent()).toBe(true);
            for (const mutate of [
              () => authority.revoke(refs[0]),
              () => authority.setAccessAllowed(false),
              () => authority.advance(1),
            ])
              expect(mutate).toThrow("retry after release");
            return true;
          },
          release() {
            releases++;
            lease.release();
          },
        });
      };
    });
    refs = await baseline(f);
    const result = await f
      .maintainer(() => upsert(refs))
      .maintain({ evidenceRefs: refs, effectiveAt: NOW });
    expect(result.state.patterns["pat-batch-verified"].status).toBe(
      "corroborated",
    );
    expect(f.wikiAdapter.loadWiki().stateDigest).toBe(result.stateDigest);
    expect([assertions, releases]).toEqual([1, 1]);
    f.authorities.revoke(refs[0]);
    await expect(f.resolver.resolveEvidence(refs[0])).rejects.toMatchObject({
      code: "CC_EVOLUTION_PROJECTION_ACCESS_DENIED",
    });
  }, 120_000);

  it("fences old-state dependencies absent from the new request while still permitting terminal cleanup", async () => {
    const scopes = [];
    const f = setup((authority) => {
      const acquire = authority.commitCoordinator.acquireCurrentEvidence;
      authority.commitCoordinator.acquireCurrentEvidence = (request) => {
        scopes.push(request.evidenceBindings.map((item) => item.ref));
        return acquire(request);
      };
    });
    const refs = await baseline(f, 3);
    const original = await f
      .maintainer(() => upsert(refs.slice(0, 2)))
      .maintain({ evidenceRefs: refs.slice(0, 2), effectiveAt: NOW });
    expect(original.state.patterns["pat-batch-verified"].status).toBe(
      "corroborated",
    );
    f.authorities.revoke(refs[0]);
    const before = files(f.root);
    await expect(
      f
        .maintainer(() => upsert([refs[0], refs[2]]))
        .maintain({ evidenceRefs: [refs[2]], effectiveAt: NOW }),
    ).rejects.toMatchObject({ code: "CC_WIKI_EVIDENCE_COMMIT_DENIED" });
    expect(scopes.at(-1)).toEqual(refs);
    expect(f.wikiAdapter.loadWiki().stateDigest).toBe(original.stateDigest);
    expect(files(f.root)).toEqual(before);
    const cleaned = await f
      .maintainer(() => ({
        operations: [
          {
            type: "tombstone",
            patternId: "pat-batch-verified",
            reason: "source revoked",
          },
        ],
      }))
      .maintain({ evidenceRefs: [refs[2]], effectiveAt: NOW });
    expect(scopes.at(-1)).toEqual([refs[2]]);
    expect(cleaned.revision).toBe(2);
    expect(cleaned.state.patterns["pat-batch-verified"].status).toBe(
      "tombstoned",
    );
    expect(cleaned.state.index).toEqual([]);
  }, 180_000);
});
