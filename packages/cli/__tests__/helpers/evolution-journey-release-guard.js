import fs from "node:fs";
import path from "node:path";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { EvolutionArtifactPorts } from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  createEvolutionLedgerDurableArtifactResolver,
  createEvolutionLedgerPorts,
} from "../../src/lib/evolution/evolution-ledger-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { SkillMutationAuthority } from "../../src/lib/evolution/skill-mutation-authority.js";
import { SkillPromotionController } from "../../src/lib/evolution/skill-promotion-controller.js";
import { SkillPromotionReviewLedgerAdapter } from "../../src/lib/evolution/skill-promotion-review-ledger-adapter.js";
import { SkillReleaseRegistry } from "../../src/lib/evolution/skill-release-registry.js";
import {
  openRevocationReleaseRegistry,
  replicaAuthority,
} from "../fixtures/skill-revocation-release-registry.js";
import { digest, durableFilesystem } from "./evolution-wiki-journey-fixture.js";

const BASELINE_SKILL = "safe-refactor";
const JOURNEY_SKILL = "journey-safe-skill";

function snapshotFiles(root) {
  const files = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("release fixture contains an unexpected symlink");
      if (entry.isDirectory()) visit(target);
      else
        files[path.relative(root, target).replaceAll("\\", "/")] = fs
          .readFileSync(target)
          .toString("base64");
    }
  };
  visit(root);
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function requiredDenial(operation, expectedCode) {
  try {
    await operation();
  } catch (error) {
    if (error.code !== expectedCode) throw error;
    return Object.freeze({ code: error.code, message: error.message });
  }
  throw new Error(`unreviewed release unexpectedly passed ${expectedCode}`);
}

/**
 * Real existing active files and three independent fail-closed boundaries.
 *
 * Historical bootstrap reuses the explicitly TEST-ONLY identity/receipt
 * authorities from the Registry recovery fixture. It establishes existing
 * active bytes, NOT external human approval or a candidate-effectiveness Eval.
 * Those bootstrap capabilities are never used for the journey's candidates.
 * No accepted Matrix receipt, human decision, or release capability is minted
 * for a new candidate. Effectiveness evaluation belongs to a separate gate.
 */
export async function createJourneyPromotionHarness({
  root,
  tenantId,
  candidateRegistry,
  journeyFixture,
}) {
  if (
    candidateRegistry.tenantId !== tenantId ||
    journeyFixture.tenantId !== tenantId
  )
    throw new TypeError("journey release fixture must use one tenant");
  const releaseRoot = path.join(root, "release-guard");
  const fsImpl = durableFilesystem();
  const { authorities } = journeyFixture;
  // Bootstrap history is unrelated to Run/Wiki source evidence. Keep its
  // signed artifact index separate without changing any verification ports.
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(releaseRoot, "artifacts"),
      now: authorities.now,
    }),
    tenantId,
    audience: "evolution-runtime",
    now: authorities.now,
    ...authorities.artifact,
  });
  const durability = replicaAuthority(path.join(releaseRoot, "replica"));
  const resolver = createEvolutionLedgerDurableArtifactResolver({
    artifactPorts,
    artifactDurabilityAuthority: durability,
    artifactTenantId: tenantId,
    purpose: "evolution-ledger",
  });
  fs.mkdirSync(path.join(releaseRoot, "witness"), { recursive: true });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(releaseRoot, "ledger"),
    authorityRootDir: path.join(releaseRoot, "ledger-authority"),
    witnessFilePath: path.join(releaseRoot, "witness", "checkpoint.json"),
    witnessId: `${tenantId}-release-witness`,
    ledgerAuthority: authorities.ledger,
    witnessAuthority: authorities.witness,
    artifactResolver: resolver,
    secure: false,
    clock: authorities.now,
    fsImpl,
  });
  const ports = createEvolutionLedgerPorts({
    artifactPorts,
    artifactDurabilityAuthority: durability,
    artifactTenantId: tenantId,
    audience: "evolution-runtime",
    ledger: backend.ledger,
  });
  const releaseRegistry = new SkillReleaseRegistry({
    tenantId,
    rootDir: path.join(releaseRoot, "skill-releases"),
    transactionLedger: ports.transactionLedger,
    secure: false,
    leaseTtlMs: 60_000,
    fsImpl,
  });
  await openRevocationReleaseRegistry({
    root: releaseRoot,
    tenantId,
    artifactTenantId: tenantId,
    storage: { artifactPorts, backend, resolver, now: authorities.now() },
    openedResources: { ...ports, releaseRegistry },
    seed: true,
    fsImpl,
  });
  const baseline = releaseRegistry.readActive(BASELINE_SKILL);
  if (!baseline || baseline.state.revision !== 2)
    throw new Error(
      "historical Registry fixture did not materialize active state",
    );

  // New candidates have no trusted deployment authorization. Even if a caller
  // supplies arbitrary receipt strings, this authority cannot approve them.
  const denyAuthorization = () => {
    throw new Error(
      "journey candidates have no independent approval authority",
    );
  };
  const authority = new SkillMutationAuthority({
    auditSink: ports.auditSink,
    nonceStore: ports.nonceStore,
    now: () => new Date(authorities.now()),
    principalResolver: { resolve: denyAuthorization },
    receiptVerifier: { verify: denyAuthorization },
  });
  const controller = new SkillPromotionController({
    candidateRegistry,
    releaseRegistry,
    authority,
  });
  const reviewLedger = new SkillPromotionReviewLedgerAdapter({
    descriptor: {
      tenantId,
      artifactTenantId: tenantId,
      streamId: "journey-unapproved-reviews",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
      authorityId: "authority:journey-review",
      revision: 1,
      handlerArtifactDigest: digest("journey-review-denial-v1"),
    },
    artifactPorts,
    ledger: backend.ledger,
    ledgerArtifactResolver: artifactPorts.createEvolutionLedgerArtifactResolver(
      {
        purpose: "evolution-ledger",
      },
    ),
    decisionVerifier: { verify: denyAuthorization },
    now: authorities.now,
  });
  const reviewResolver = reviewLedger.createDecisionResolver();
  return Object.freeze({
    releaseRegistry,
    baselineSkill: BASELINE_SKILL,
    snapshotActive() {
      return {
        baseline: releaseRegistry.readActive(BASELINE_SKILL),
        journeyState: releaseRegistry.readState(JOURNEY_SKILL),
        files: snapshotFiles(releaseRegistry.rootDir),
        releaseLedgerHead: backend.ledger.verify(),
      };
    },
    async attemptUnapproved(candidateId) {
      const candidate = candidateRegistry.read(candidateId);
      if (
        candidate.tenantId !== tenantId ||
        candidate.skillName !== JOURNEY_SKILL
      )
        throw new TypeError("expected a real journey candidate");
      const review = await requiredDenial(
        () =>
          reviewResolver.resolve({
            tenantId,
            receiptDigest: digest(`unissued-review:${candidateId}`),
          }),
        "CC_SKILL_PROMOTION_REVIEW_LEDGER_CORRUPT",
      );
      const evaluation = await requiredDenial(
        () =>
          controller.promoteEvaluated({
            candidateId,
            authorization: null,
            matrixContext: null,
          }),
        "SKILL_PROMOTION_EVALUATION_REQUIRED",
      );
      const registry = await requiredDenial(
        () => releaseRegistry.applyTransition(Object.freeze({ candidateId })),
        "SKILL_PROMOTION_TRANSITION_CAPABILITY_INVALID",
      );
      return Object.freeze({ candidateId, review, evaluation, registry });
    },
  });
}
