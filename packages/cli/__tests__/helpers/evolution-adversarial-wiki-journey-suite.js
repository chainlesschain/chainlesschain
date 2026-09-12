import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceBackedWikiMaintainer } from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  createJourneyFixture,
  digest,
} from "./evolution-wiki-journey-fixture.js";
import {
  adversarialJourney,
  createJourneyCandidateRegistry,
  derivedPattern,
  JOURNEY_FAMILIES,
  NOW,
  proposerFromPersistedWiki,
  readerForJourney,
  retainAdversarialJourney,
  snapshotFiles,
} from "./evolution-adversarial-wiki-journey.js";
import { createJourneyPromotionHarness } from "./evolution-journey-release-guard.js";

const SHARDS = 8;
const BATCHES = 100;
const CASES_PER_BATCH = 10;
const journeys = Array.from({ length: BATCHES * CASES_PER_BATCH }, (_, index) =>
  adversarialJourney(index),
);
const batchesForShard = (shard) =>
  Array.from({ length: BATCHES }, (_, batch) => batch).filter(
    (batch) => batch % SHARDS === shard,
  );

function assertCompleteCatalog() {
  expect(new Set(journeys.map((trace) => trace.id)).size).toBe(1000);
  expect(
    new Set(journeys.map((trace) => JSON.stringify(trace.payload))).size,
  ).toBe(1000);
  expect(new Set(journeys.map((trace) => trace.family)).size).toBe(
    JOURNEY_FAMILIES.length,
  );
  const scheduledBatches = Array.from({ length: SHARDS }, (_, shard) =>
    batchesForShard(shard),
  ).flat();
  expect(scheduledBatches).toHaveLength(BATCHES);
  expect(new Set(scheduledBatches).size).toBe(BATCHES);
  expect(
    scheduledBatches.flatMap((batch) =>
      journeys.slice(batch * 10, batch * 10 + 10),
    ),
  ).toHaveLength(1000);

  // Check the real file-based CI entrypoints too: missing/duplicated wrappers
  // must not silently reduce the 1000-case catalog to a partial shard run.
  const directory = new URL("../integration/", import.meta.url);
  const wrappers = fs
    .readdirSync(directory)
    .filter((file) =>
      /^evolution-adversarial-wiki-journey-shard-\d+\.test\.js$/.test(file),
    );
  expect(wrappers).toHaveLength(SHARDS);
  for (let shard = 0; shard < SHARDS; shard += 1) {
    const file = `evolution-adversarial-wiki-journey-shard-${shard}.test.js`;
    expect(wrappers).toContain(file);
    expect(fs.readFileSync(new URL(file, directory), "utf8")).toMatch(
      new RegExp(`registerAdversarialJourneyShard\\(${shard}\\);`),
    );
  }
}

async function executeBatch(batch, root) {
  const phases = {};
  const started = performance.now();
  let previous = started;
  let completed = 0;
  const checkpoint = (phase) => {
    const now = performance.now();
    phases[phase] = (phases[phase] ?? 0) + now - previous;
    previous = now;
  };
  try {
    const fixture = createJourneyFixture(root, {
      tenantId: `tenant-journey-${batch}`,
      runId: `run-journey-${batch}`,
    });
    const candidates = createJourneyCandidateRegistry(root, fixture.tenantId);
    const promotion = await createJourneyPromotionHarness({
      root,
      tenantId: fixture.tenantId,
      candidateRegistry: candidates.registry,
      journeyFixture: fixture,
    });
    const { releaseRegistry } = promotion;
    const consumer = { ...candidates, releaseRegistry };
    checkpoint("setup-and-existing-active-baseline");

    const safe = [];
    for (const [principalId, summary] of [
      ["tool-a", "focused-checks"],
      ["tool-b", "independent-checks"],
    ]) {
      const projected = await fixture.project(
        { summary, result: "passed" },
        { principalId },
      );
      expect(projected.bundle.trustedProjection.status).toBe("trusted");
      fixture.reference(projected.result);
      safe.push(projected.result.evidenceId);
    }
    const traces = [];
    for (let offset = 0; offset < CASES_PER_BATCH; offset += 1)
      traces.push(
        await retainAdversarialJourney(
          fixture,
          journeys[batch * CASES_PER_BATCH + offset],
        ),
      );
    expect(new Set(traces.map((trace) => trace.id)).size).toBe(CASES_PER_BATCH);
    expect(new Set(traces.map((trace) => trace.family)).size).toBe(
      CASES_PER_BATCH,
    );
    for (const trace of traces) {
      if (
        [
          "unknown-source-schema",
          "undeclared-metadata",
          "revoked-evidence",
          "deleted-evidence",
          "duplicate-run-reference",
          "unreferenced-evidence",
          "cross-tenant-reader",
          "expired-reader",
        ].includes(trace.family)
      ) {
        // Later provenance/current-authority cases must really reach that
        // boundary; detector rejection cannot accidentally satisfy the test.
        expect(
          trace.projected.bundle.trustedProjection.status,
          trace.family,
        ).toBe("trusted");
      }
      if (
        ["altered-source-signature", "substituted-signed-payload"].includes(
          trace.family,
        )
      )
        expect(trace.rejectedAtSource, trace.family).toBe(true);
    }
    fixture.complete();
    checkpoint("signed-raw-run-retention");

    const priorArtifacts = new Set(
      fixture.artifactStore.list().map((entry) => entry.id),
    );
    const maintained = await fixture
      .maintainer(({ evidence }) => ({
        operations: [{ type: "upsert", pattern: derivedPattern(evidence) }],
      }))
      .maintain({ evidenceRefs: safe, effectiveAt: NOW });
    expect(maintained.state.patterns["pat-journey-checks"]).toMatchObject({
      status: "corroborated",
      actionable: true,
    });
    const wikiFiles = fixture.artifactStore
      .list()
      .filter((entry) => !priorArtifacts.has(entry.id))
      .map((entry) => fixture.artifactStore.storedPath(entry));
    expect(wikiFiles.length).toBeGreaterThan(0);
    const wikiBytes = wikiFiles.map((file) => fs.readFileSync(file));
    checkpoint("positive-authenticated-wiki-commit");

    const { wiki: wikiBaseline, proposer } = proposerFromPersistedWiki(
      fixture,
      consumer,
    );
    const firstProposal = await proposer.propose();
    expect(firstProposal.status).toBe("proposal");
    const candidate = candidates.registry.read(firstProposal.candidateId);
    expect(candidate).toMatchObject({
      status: "draft",
      derivationMode: "wiki",
      wikiRevision: maintained.revisionId,
    });
    expect(candidate.content).toContain("focused-checks");
    expect(candidate.content).toContain("independent-checks");
    expect(candidates.registry.list()).toHaveLength(1);
    const candidateBytes = snapshotFiles(candidates.registry.rootDir);
    const activeSnapshot = promotion.snapshotActive();
    expect(activeSnapshot.journeyState.activeReleaseDigest).toBeNull();
    expect(activeSnapshot.baseline.state.revision).toBe(2);
    checkpoint("positive-persisted-candidate");

    for (const trace of traces) {
      const context = `${batch}/${trace.id}/${trace.family}`;
      const resolver = readerForJourney(fixture, trace);
      await expect(
        resolver.resolveEvidence(trace.ref),
        context,
      ).rejects.toThrow();
      let derived = 0;
      const maintainer = new EvidenceBackedWikiMaintainer({
        descriptor: {
          tenantId: fixture.tenantId,
          evolutionRunId: fixture.runId,
          maintainerModel: "schema-deriver",
          rulesDigest: digest("adversarial-journey-rules"),
        },
        policy: {
          trustedProjectionRead: true,
          rawEvidenceRead: false,
          activeSkillWrite: false,
          shell: false,
          network: false,
          secretRead: false,
        },
        ports: fixture.maintainerPorts({
          resolveEvidence: resolver.resolveEvidence,
          derive: ({ evidence }) => {
            derived += 1;
            return {
              operations: [
                {
                  type: "upsert",
                  pattern: derivedPattern(evidence, `pat-attack-${trace.id}`),
                },
              ],
            };
          },
        }),
      });
      await expect(
        maintainer.maintain({
          evidenceRefs: [trace.ref, safe[0]],
          effectiveAt: NOW,
        }),
        context,
      ).rejects.toThrow();
      expect(derived, context).toBe(0);
      checkpoint("denied-reader-and-maintainer");

      // A fresh authenticated disk view for THIS trajectory is checked before
      // being supplied to the actual proposer. No view/authorization is reused
      // across trajectories, and the view is immutable.
      const current = proposerFromPersistedWiki(fixture, consumer);
      expect(current.wiki, context).toEqual(wikiBaseline);
      const proposed = await current.proposer.propose();
      expect(proposed.candidateId, context).toBe(candidate.candidateId);
      checkpoint("post-denial-fresh-wiki-and-proposer");

      // Real Review, Eval and private Registry-capability boundaries all deny
      // this exact persisted candidate. The active snapshot below reloads the
      // real states, files and independent authenticated release ledger head.
      await promotion.attemptUnapproved(proposed.candidateId);
      const currentActive = promotion.snapshotActive();
      expect(currentActive, context).toEqual(activeSnapshot);
      checkpoint("unapproved-release-and-active-readback");

      expect(snapshotFiles(candidates.registry.rootDir), context).toEqual(
        candidateBytes,
      );
      const currentWikiBytes = wikiFiles.map((file) => fs.readFileSync(file));
      expect(currentWikiBytes, context).toEqual(wikiBytes);
      const plaintext = [
        JSON.stringify(current.wiki),
        candidates.registry.read(candidate.candidateId).content,
        ...currentWikiBytes.map((bytes) => bytes.toString("utf8")),
        ...Object.values(currentActive.files).map((bytes) =>
          Buffer.from(bytes, "base64").toString("utf8"),
        ),
      ].join("\n");
      for (const canary of trace.canaries)
        expect(plaintext, context).not.toContain(canary);
      completed += 1;
      checkpoint("final-persisted-bytes-and-canaries");
    }
    // Final storage reload occurs after every downstream operation, not from a
    // previously checked view. Per-trajectory artifact bytes were also reread.
    expect(fixture.wikiAdapter.loadWiki()).toEqual(wikiBaseline);
    expect(fixture.runAdapter.load().projection.status).toBe("completed");
    expect(fixture.backend.ledger.verify().sequence).toBeGreaterThan(2);
    checkpoint("final-authenticated-ledger-and-wiki");
  } finally {
    console.info(
      "[adversarial-wiki-journey]",
      JSON.stringify({
        batch,
        completed,
        totalMs: Math.round(performance.now() - started),
        phasesMs: Object.fromEntries(
          Object.entries(phases).map(([phase, ms]) => [phase, Math.round(ms)]),
        ),
      }),
    );
  }
}

export function registerAdversarialJourneyShard(shard) {
  if (!Number.isInteger(shard) || shard < 0 || shard >= SHARDS)
    throw new RangeError("invalid adversarial journey shard");
  describe(`1000 signed Raw-to-Wiki-to-Skill journeys: shard ${shard}/${SHARDS}`, () => {
    // Scope cleanup to this registered suite; parallel files must never share
    // mutable temp-root lists or remove another batch's live durable storage.
    const roots = [];
    afterEach(({ task }) => {
      const completedRoots = roots.splice(0);
      if (task.result?.state !== "pass") {
        console.error(
          "[adversarial-wiki-journey] failed fixtures retained",
          JSON.stringify(completedRoots),
        );
        return;
      }
      for (const root of completedRoots)
        fs.rmSync(root, { recursive: true, force: true });
    });
    if (shard === 0)
      it(
        "covers exactly 1000 unique traces, 16 families and all 8 physical CI wrappers",
        assertCompleteCatalog,
      );
    it.each(batchesForShard(shard))(
      "batch %i: 10 unique attacks cannot contaminate persisted Wiki, candidates or active state",
      async (batch) => {
        const root = fs.mkdtempSync(
          path.join(
            fs.realpathSync.native(os.tmpdir()),
            "cc-adversarial-wiki-",
          ),
        );
        roots.push(root);
        await executeBatch(batch, root);
      },
      600_000,
    );
  });
}
