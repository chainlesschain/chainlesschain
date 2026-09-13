#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const G09_PRODUCTION_JOURNEY_SCHEMA =
  "chainlesschain.g09-production-journey-evidence/v1";
export const G09_PRODUCTION_JOURNEY_VERIFICATION_SCHEMA =
  "chainlesschain.g09-production-journey-verification/v1";

const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u;
const MAX_BYTES = 1024 * 1024;
const REQUIRED_STAGES = Object.freeze([
  ["candidate", "shadow"],
  ["shadow", "canary"],
  ["canary", "active"],
  ["active", "rolled-back"],
]);
const REQUIRED_AUTHORITIES = Object.freeze([
  "model",
  "evaluation",
  "review",
  "deployment",
  "storage",
  "witness",
]);
const SENSITIVE_KEY =
  /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|private[_-]?key|credential)([_-]|$)/iu;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactObject(value, keys, label) {
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} fields are not exact`,
  );
  return value;
}

function safeId(value, label) {
  assert(
    typeof value === "string" && SAFE_ID.test(value),
    `${label} is invalid`,
  );
  return value;
}

function digest(value, label) {
  assert(
    typeof value === "string" && DIGEST.test(value),
    `${label} is invalid`,
  );
  return value;
}

function positive(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be positive`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

export function g09EvidenceDigest(value) {
  const unsigned = { ...value };
  delete unsigned.evidenceDigest;
  return `sha256:${crypto
    .createHash("sha256")
    .update("cc.g09-production-journey-evidence/v1\0", "utf8")
    .update(JSON.stringify(canonical(unsigned)), "utf8")
    .digest("hex")}`;
}

function rejectSensitiveFields(value, trail = "evidence", seen = new Set()) {
  if (!value || typeof value !== "object") return;
  assert(!seen.has(value), `${trail} contains a cycle`);
  seen.add(value);
  if (!Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      assert(
        !SENSITIVE_KEY.test(key),
        `${trail}.${key} may contain secret material`,
      );
      rejectSensitiveFields(value[key], `${trail}.${key}`, seen);
    }
  } else {
    value.forEach((entry, index) =>
      rejectSensitiveFields(entry, `${trail}[${index}]`, seen),
    );
  }
  seen.delete(value);
}

function verifyAuthority(authority, role) {
  exactObject(
    authority,
    [
      "role",
      "authorityId",
      "evidenceDigest",
      "authenticated",
      "durable",
      "failureDomain",
    ],
    `authority ${role}`,
  );
  assert(authority.role === role, `authority ${role} role mismatch`);
  safeId(authority.authorityId, `authority ${role} ID`);
  digest(authority.evidenceDigest, `authority ${role} evidence digest`);
  assert(
    authority.authenticated === true && authority.durable === true,
    `authority ${role} is not authenticated and durable`,
  );
  safeId(authority.failureDomain, `authority ${role} failure domain`);
}

export function verifyG09ProductionJourneyEvidence(
  evidence,
  { expectedCommit } = {},
) {
  rejectSensitiveFields(evidence);
  exactObject(
    evidence,
    [
      "schema",
      "status",
      "commitSha",
      "attestedAt",
      "artifact",
      "model",
      "skill",
      "evaluation",
      "deployment",
      "journey",
      "rollout",
      "authorities",
      "evidenceDigest",
    ],
    "G09 evidence",
  );
  assert(
    evidence.schema === G09_PRODUCTION_JOURNEY_SCHEMA,
    "G09 evidence schema mismatch",
  );
  assert(evidence.status === "passed", "G09 journey did not pass");
  assert(COMMIT.test(evidence.commitSha || ""), "G09 commit is not exact");
  if (expectedCommit) {
    assert(COMMIT.test(expectedCommit), "expected commit is invalid");
    assert(
      evidence.commitSha === expectedCommit,
      "G09 evidence is bound to another commit",
    );
  }
  assert(
    Number.isFinite(Date.parse(evidence.attestedAt)),
    "G09 attestedAt is invalid",
  );

  exactObject(
    evidence.artifact,
    [
      "releaseDigest",
      "desktopMatrixDigest",
      "installReceiptDigest",
      "launchReceiptDigest",
    ],
    "artifact",
  );
  for (const [key, value] of Object.entries(evidence.artifact))
    digest(value, `artifact.${key}`);

  exactObject(
    evidence.model,
    [
      "provider",
      "model",
      "liveProviderAggregateDigest",
      "completedCalls",
      "fallbackUsed",
    ],
    "model",
  );
  safeId(evidence.model.provider, "model.provider");
  safeId(evidence.model.model, "model.model");
  digest(
    evidence.model.liveProviderAggregateDigest,
    "model.liveProviderAggregateDigest",
  );
  positive(evidence.model.completedCalls, "model.completedCalls");
  assert(evidence.model.fallbackUsed === false, "model fallback is forbidden");

  exactObject(
    evidence.skill,
    [
      "skillId",
      "baselineDigest",
      "candidateDigest",
      "corpusDigest",
      "permissionDigest",
    ],
    "skill",
  );
  safeId(evidence.skill.skillId, "skill.skillId");
  for (const key of [
    "baselineDigest",
    "candidateDigest",
    "corpusDigest",
    "permissionDigest",
  ]) {
    digest(evidence.skill[key], `skill.${key}`);
  }
  assert(
    evidence.skill.baselineDigest !== evidence.skill.candidateDigest,
    "candidate must differ from baseline",
  );

  exactObject(
    evidence.evaluation,
    [
      "decision",
      "matrixReceiptDigest",
      "cellCount",
      "targetEnvironments",
      "independentGrader",
    ],
    "evaluation",
  );
  assert(
    evidence.evaluation.decision === "pass",
    "paired evaluation did not pass",
  );
  digest(
    evidence.evaluation.matrixReceiptDigest,
    "evaluation.matrixReceiptDigest",
  );
  positive(evidence.evaluation.cellCount, "evaluation.cellCount");
  assert(
    Array.isArray(evidence.evaluation.targetEnvironments) &&
      evidence.evaluation.targetEnvironments.length ===
        evidence.evaluation.cellCount,
    "evaluation target matrix is incomplete",
  );
  const environments = evidence.evaluation.targetEnvironments.map(
    (value, index) => safeId(value, `evaluation.targetEnvironments[${index}]`),
  );
  assert(
    new Set(environments).size === environments.length,
    "evaluation target cells are duplicated",
  );
  assert(
    evidence.evaluation.independentGrader === true,
    "independent grader is required",
  );

  exactObject(
    evidence.deployment,
    [
      "revision",
      "configurationDigest",
      "activeBeforeDigest",
      "activeAfterRollbackDigest",
      "globalAutoPromotion",
    ],
    "deployment",
  );
  positive(evidence.deployment.revision, "deployment.revision");
  for (const key of [
    "configurationDigest",
    "activeBeforeDigest",
    "activeAfterRollbackDigest",
  ]) {
    digest(evidence.deployment[key], `deployment.${key}`);
  }
  assert(
    evidence.deployment.globalAutoPromotion === "hold",
    "global automatic promotion must remain on hold",
  );
  assert(
    evidence.deployment.activeBeforeDigest === evidence.skill.baselineDigest &&
      evidence.deployment.activeAfterRollbackDigest ===
        evidence.skill.baselineDigest,
    "rollback did not restore the exact baseline",
  );

  exactObject(
    evidence.journey,
    [
      "taskReceiptDigest",
      "reviewReceiptDigest",
      "reconnectReceiptDigest",
      "exportReceiptDigest",
    ],
    "journey",
  );
  for (const [key, value] of Object.entries(evidence.journey))
    digest(value, `journey.${key}`);

  exactObject(
    evidence.rollout,
    ["cohortId", "optIn", "maxSubjects", "transitions"],
    "rollout",
  );
  safeId(evidence.rollout.cohortId, "rollout.cohortId");
  assert(
    evidence.rollout.optIn === true,
    "pilot cohort must explicitly opt in",
  );
  assert(
    Number.isSafeInteger(evidence.rollout.maxSubjects) &&
      evidence.rollout.maxSubjects > 0 &&
      evidence.rollout.maxSubjects <= 10_000,
    "pilot cohort is unbounded",
  );
  assert(
    Array.isArray(evidence.rollout.transitions) &&
      evidence.rollout.transitions.length === REQUIRED_STAGES.length,
    "promotion and rollback transition evidence is incomplete",
  );
  evidence.rollout.transitions.forEach((transition, index) => {
    exactObject(
      transition,
      ["from", "to", "receiptDigest"],
      `rollout transition ${index}`,
    );
    const [from, to] = REQUIRED_STAGES[index];
    assert(
      transition.from === from && transition.to === to,
      `rollout transition ${index} is out of order`,
    );
    digest(transition.receiptDigest, `rollout transition ${index} receipt`);
  });

  assert(Array.isArray(evidence.authorities), "authorities must be an array");
  assert(
    evidence.authorities.length === REQUIRED_AUTHORITIES.length,
    "authority set is incomplete",
  );
  const byRole = new Map();
  for (const authority of evidence.authorities) {
    assert(!byRole.has(authority?.role), "authority roles are duplicated");
    byRole.set(authority?.role, authority);
  }
  for (const role of REQUIRED_AUTHORITIES)
    verifyAuthority(byRole.get(role), role);
  assert(
    new Set(evidence.authorities.map(({ authorityId }) => authorityId)).size ===
      REQUIRED_AUTHORITIES.length,
    "production authority identities must be distinct",
  );
  assert(
    byRole.get("witness").failureDomain !==
      byRole.get("deployment").failureDomain &&
      byRole.get("evaluation").failureDomain !==
        byRole.get("model").failureDomain,
    "witness and grader must use independent failure domains",
  );

  assert(
    digest(evidence.evidenceDigest, "evidence.evidenceDigest") ===
      g09EvidenceDigest(evidence),
    "G09 evidence digest mismatch",
  );
  return evidence;
}

export function createG09VerificationReceipt(evidence) {
  verifyG09ProductionJourneyEvidence(evidence, {
    expectedCommit: evidence.commitSha,
  });
  const receipt = {
    schema: G09_PRODUCTION_JOURNEY_VERIFICATION_SCHEMA,
    status: "passed",
    commitSha: evidence.commitSha,
    evidenceDigest: evidence.evidenceDigest,
    releaseDigest: evidence.artifact.releaseDigest,
    desktopMatrixDigest: evidence.artifact.desktopMatrixDigest,
    liveProviderAggregateDigest: evidence.model.liveProviderAggregateDigest,
    skillId: evidence.skill.skillId,
    baselineDigest: evidence.skill.baselineDigest,
    candidateDigest: evidence.skill.candidateDigest,
    corpusDigest: evidence.skill.corpusDigest,
    permissionDigest: evidence.skill.permissionDigest,
    matrixReceiptDigest: evidence.evaluation.matrixReceiptDigest,
    deploymentRevision: evidence.deployment.revision,
    terminalStage: "rolled-back",
    globalAutoPromotion: "hold",
    authorityEvidenceDigests: Object.fromEntries(
      [...evidence.authorities]
        .sort((left, right) => left.role.localeCompare(right.role))
        .map(({ role, evidenceDigest }) => [role, evidenceDigest]),
    ),
  };
  receipt.receiptDigest = g09EvidenceDigest(receipt);
  return Object.freeze(receipt);
}

function readEvidence(file) {
  const target = path.resolve(file);
  const stat = fs.lstatSync(target);
  assert(
    stat.isFile() && !stat.isSymbolicLink(),
    "input must be a regular non-symbolic file",
  );
  assert(
    stat.size > 0 && stat.size <= MAX_BYTES,
    "input evidence size is invalid",
  );
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  assert(value && !value.startsWith("--"), `${name} is required`);
  return value;
}

async function main() {
  const input = argument("--input");
  const expectedCommit = argument("--expected-commit");
  const output = path.resolve(argument("--output"));
  const evidence = verifyG09ProductionJourneyEvidence(readEvidence(input), {
    expectedCommit,
  });
  const receipt = createG09VerificationReceipt(evidence);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(
    `G09 target journey verified for ${receipt.commitSha}; global auto-promotion remains hold\n`,
  );
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
