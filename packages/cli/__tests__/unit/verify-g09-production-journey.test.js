import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  G09_PRODUCTION_JOURNEY_SCHEMA,
  G09_PRODUCTION_JOURNEY_VERIFICATION_SCHEMA,
  createG09VerificationReceipt,
  g09EvidenceDigest,
  verifyG09ProductionJourneyEvidence,
} from "../../scripts/verify-g09-production-journey.mjs";

const D = (seed) =>
  `sha256:${Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64)}`;
const SCRIPT = fileURLToPath(
  new URL("../../scripts/verify-g09-production-journey.mjs", import.meta.url),
);
const WORKFLOW = fileURLToPath(
  new URL(
    "../../../../.github/workflows/g09-production-journey-attestation.yml",
    import.meta.url,
  ),
);

function validEvidence() {
  const evidence = {
    schema: G09_PRODUCTION_JOURNEY_SCHEMA,
    status: "passed",
    commitSha: "a".repeat(40),
    attestedAt: "2026-09-13T08:00:00.000Z",
    artifact: {
      releaseDigest: D("release"),
      desktopMatrixDigest: D("desktop-matrix"),
      installReceiptDigest: D("install"),
      launchReceiptDigest: D("launch"),
    },
    model: {
      provider: "openai",
      model: "gpt-5.1",
      liveProviderAggregateDigest: D("live-provider"),
      completedCalls: 100,
      fallbackUsed: false,
    },
    skill: {
      skillId: "low-side-effect-formatting",
      baselineDigest: D("baseline"),
      candidateDigest: D("candidate"),
      corpusDigest: D("corpus"),
      permissionDigest: D("permissions"),
    },
    evaluation: {
      decision: "pass",
      matrixReceiptDigest: D("matrix-receipt"),
      cellCount: 3,
      targetEnvironments: ["linux-x64", "macos-arm64", "windows-x64"],
      independentGrader: true,
    },
    deployment: {
      revision: 7,
      configurationDigest: D("deployment-config"),
      activeBeforeDigest: D("baseline"),
      activeAfterRollbackDigest: D("baseline"),
      globalAutoPromotion: "hold",
    },
    journey: {
      taskReceiptDigest: D("task"),
      reviewReceiptDigest: D("review"),
      reconnectReceiptDigest: D("reconnect"),
      exportReceiptDigest: D("export"),
    },
    rollout: {
      cohortId: "g09-opt-in",
      optIn: true,
      maxSubjects: 10,
      transitions: [
        { from: "candidate", to: "shadow", receiptDigest: D("shadow") },
        { from: "shadow", to: "canary", receiptDigest: D("canary") },
        { from: "canary", to: "active", receiptDigest: D("active") },
        { from: "active", to: "rolled-back", receiptDigest: D("rollback") },
      ],
    },
    authorities: [
      authority("model", "provider-account", "provider"),
      authority("evaluation", "independent-grader", "grader"),
      authority("review", "human-review-board", "human"),
      authority("deployment", "deployment-control", "control-plane"),
      authority("storage", "durable-evidence-store", "storage"),
      authority("witness", "external-witness", "witness"),
    ],
  };
  evidence.evidenceDigest = g09EvidenceDigest(evidence);
  return evidence;
}

function authority(role, authorityId, failureDomain) {
  return {
    role,
    authorityId,
    evidenceDigest: D(`${role}-authority`),
    authenticated: true,
    durable: true,
    failureDomain,
  };
}

function resign(evidence) {
  evidence.evidenceDigest = g09EvidenceDigest(evidence);
  return evidence;
}

describe("G09 production journey verifier", () => {
  it("binds the target journey to exact release, model, Skill, rollout, and authorities", () => {
    const evidence = validEvidence();
    expect(
      verifyG09ProductionJourneyEvidence(evidence, {
        expectedCommit: "a".repeat(40),
      }),
    ).toBe(evidence);

    expect(createG09VerificationReceipt(evidence)).toMatchObject({
      schema: G09_PRODUCTION_JOURNEY_VERIFICATION_SCHEMA,
      status: "passed",
      commitSha: "a".repeat(40),
      skillId: "low-side-effect-formatting",
      deploymentRevision: 7,
      terminalStage: "rolled-back",
      globalAutoPromotion: "hold",
      authorityEvidenceDigests: {
        evaluation: D("evaluation-authority"),
        witness: D("witness-authority"),
      },
      receiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it.each([
    [
      "wrong commit",
      (value) => (value.commitSha = "b".repeat(40)),
      /another commit/u,
    ],
    ["fallback", (value) => (value.model.fallbackUsed = true), /fallback/u],
    [
      "same arm",
      (value) => (value.skill.candidateDigest = value.skill.baselineDigest),
      /differ/u,
    ],
    [
      "test failure",
      (value) => (value.evaluation.decision = "fail"),
      /did not pass/u,
    ],
    [
      "automatic promotion",
      (value) => (value.deployment.globalAutoPromotion = "enabled"),
      /remain on hold/u,
    ],
    [
      "wrong rollback",
      (value) => (value.deployment.activeAfterRollbackDigest = D("candidate")),
      /restore/u,
    ],
    [
      "implicit cohort",
      (value) => (value.rollout.optIn = false),
      /explicitly opt in/u,
    ],
    [
      "missing rollback",
      (value) => value.rollout.transitions.pop(),
      /incomplete/u,
    ],
    [
      "shared authority",
      (value) =>
        (value.authorities[5].authorityId = value.authorities[3].authorityId),
      /distinct/u,
    ],
    [
      "shared witness domain",
      (value) => (value.authorities[5].failureDomain = "control-plane"),
      /independent/u,
    ],
  ])("fails closed for %s", (_label, mutate, error) => {
    const evidence = validEvidence();
    mutate(evidence);
    resign(evidence);
    expect(() =>
      verifyG09ProductionJourneyEvidence(evidence, {
        expectedCommit: "a".repeat(40),
      }),
    ).toThrow(error);
  });

  it("rejects forged digests, extra fields, and secret-shaped payloads", () => {
    const forged = validEvidence();
    forged.model.completedCalls = 101;
    expect(() => verifyG09ProductionJourneyEvidence(forged)).toThrow(
      /digest mismatch/u,
    );

    const extra = validEvidence();
    extra.claim = "production-ready";
    resign(extra);
    expect(() => verifyG09ProductionJourneyEvidence(extra)).toThrow(
      /fields are not exact/u,
    );

    const sensitive = validEvidence();
    sensitive.model.apiKey = "must-never-enter-evidence";
    resign(sensitive);
    expect(() => verifyG09ProductionJourneyEvidence(sensitive)).toThrow(
      /secret material/u,
    );
  });

  it("executes the file-to-receipt CLI without overwriting an existing receipt", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-g09-verifier-"));
    const input = path.join(root, "evidence.json");
    const output = path.join(root, "receipt.json");
    try {
      fs.writeFileSync(input, JSON.stringify(validEvidence()), "utf8");
      expect(
        execFileSync(
          process.execPath,
          [
            SCRIPT,
            "--input",
            input,
            "--expected-commit",
            "a".repeat(40),
            "--output",
            output,
          ],
          { encoding: "utf8", windowsHide: true },
        ),
      ).toMatch(/global auto-promotion remains hold/u);
      expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
        schema: G09_PRODUCTION_JOURNEY_VERIFICATION_SCHEMA,
        status: "passed",
      });
      expect(() =>
        execFileSync(
          process.execPath,
          [
            SCRIPT,
            "--input",
            input,
            "--expected-commit",
            "a".repeat(40),
            "--output",
            output,
          ],
          { encoding: "utf8", windowsHide: true, stdio: "pipe" },
        ),
      ).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the manual workflow protected, consumer-only, and attested", () => {
    const workflow = fs.readFileSync(WORKFLOW, "utf8");
    expect(workflow).toMatch(/environment: g09-production-journey/u);
    expect(workflow).toMatch(/test "\$REF_PROTECTED" = true/u);
    expect(workflow).toMatch(/G09_TARGET_PRODUCER_WORKFLOW/u);
    expect(workflow).toMatch(/gh attestation verify/u);
    expect(workflow).toMatch(/--deny-self-hosted-runners/u);
    expect(workflow).toMatch(/verify-g09-production-journey\.mjs/u);
    expect(workflow).toMatch(/actions\/attest-build-provenance@977bb373/u);
    expect(workflow).not.toMatch(/CC_LLM_API_KEY|OPENAI_API_KEY/u);
  });
});
