import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createJourneyFixture,
  digest,
} from "../helpers/evolution-wiki-journey-fixture.js";
import {
  createJourneyCandidateRegistry,
  JOURNEY_SKILL,
} from "../helpers/evolution-adversarial-wiki-journey.js";
import { createJourneyPromotionHarness } from "../helpers/evolution-journey-release-guard.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

it("keeps existing active bytes and pointers unchanged when a real candidate has no review or release authority", async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-journey-release-guard-"),
  );
  roots.push(root);
  const f = createJourneyFixture(root);
  const candidates = createJourneyCandidateRegistry(root, f.tenantId);
  const sourceArtifacts = f.artifactStore.list();
  const harness = await createJourneyPromotionHarness({
    root,
    tenantId: f.tenantId,
    candidateRegistry: candidates.registry,
    journeyFixture: f,
  });
  const before = harness.snapshotActive();
  expect(f.artifactStore.list()).toEqual(sourceArtifacts);
  expect(before.baseline.state.revision).toBe(2);
  expect(before.baseline.release.skillName).toBe(harness.baselineSkill);
  expect(before.journeyState.activeReleaseDigest).toBeNull();
  expect(
    Object.keys(before.files).some((name) => name.includes("active")),
  ).toBe(true);
  expect(
    Object.values(before.files).some((bytes) =>
      Buffer.from(bytes, "base64")
        .toString("utf8")
        .includes("Apply the candidate procedure"),
    ),
  ).toBe(true);
  const { candidate } = candidates.registry.create({
    tenantId: f.tenantId,
    skillName: JOURNEY_SKILL,
    content: `---\nname: ${JOURNEY_SKILL}\n---\n\nRun focused checks.\n`,
    parentDigest: null,
    sourceEvidenceRefs: [
      {
        ref: "recording://journey/helper-check",
        digest: digest("helper-check"),
      },
    ],
    derivationMode: "record-replay",
    wikiRevision: null,
    proposerModel: null,
    requestedCapabilities: ["workspace.read"],
    evalRunId: null,
    ...candidates.execution,
  });
  expect(candidate.candidateId).toMatch(/^sha256:/);
  const result = await harness.attemptUnapproved(candidate.candidateId);
  expect(result).toMatchObject({
    candidateId: candidate.candidateId,
    review: { code: "CC_SKILL_PROMOTION_REVIEW_LEDGER_CORRUPT" },
    evaluation: { code: "SKILL_PROMOTION_EVALUATION_REQUIRED" },
    registry: { code: "SKILL_PROMOTION_TRANSITION_CAPABILITY_INVALID" },
  });
  expect(harness.snapshotActive()).toEqual(before);
}, 120_000);
