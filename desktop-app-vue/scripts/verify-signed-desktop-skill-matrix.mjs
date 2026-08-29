#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PLATFORM_EVIDENCE_SCHEMA =
  "chainlesschain.desktop-signed-skill-platform-evidence/v1";
export const MATRIX_EVIDENCE_SCHEMA =
  "chainlesschain.desktop-signed-skill-matrix-evidence/v1";

const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PLATFORMS = Object.freeze(["linux", "macos", "windows"]);
const PLATFORM_SIGNATURES = Object.freeze({
  linux: "sigstore-keyless",
  macos: "codesign+notarized",
  windows: "authenticode",
});
const REQUIRED_SKILL_AUTHORITIES = Object.freeze({
  "github-manager": Object.freeze(["environment", "network"]),
  "google-workspace": Object.freeze(["environment", "network"]),
  notion: Object.freeze(["environment", "network"]),
  "tavily-search": Object.freeze(["environment", "network"]),
  obsidian: Object.freeze(["environment", "filesystem"]),
  "code-runner": Object.freeze(["environment", "process"]),
  "network-diagnostics": Object.freeze(["network", "process"]),
});
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const RECEIPT_SCHEMAS = Object.freeze({
  install: "chainlesschain.desktop-signed-skill-install/v1",
  journey: "chainlesschain.desktop-signed-skill-journey/v1",
  launch: "chainlesschain.desktop-signed-skill-launch/v1",
});

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

export function evidenceDigest(value) {
  const unsigned = { ...value };
  delete unsigned.evidenceDigest;
  return `sha256:${crypto
    .createHash("sha256")
    .update("cc.desktop-signed-skill-evidence/v1\0", "utf8")
    .update(JSON.stringify(canonicalValue(unsigned)), "utf8")
    .digest("hex")}`;
}

export function receiptDigest(value) {
  const unsigned = { ...value };
  delete unsigned.receiptDigest;
  return `sha256:${crypto
    .createHash("sha256")
    .update("cc.desktop-signed-skill-receipt/v1\0", "utf8")
    .update(JSON.stringify(canonicalValue(unsigned)), "utf8")
    .digest("hex")}`;
}

function assertion(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateSignature(record) {
  const { platform, artifact } = record;
  const signature = artifact?.signature;
  assertion(
    signature?.kind === PLATFORM_SIGNATURES[platform],
    `${platform}: signature kind is not trusted`,
  );
  assertion(
    signature.artifactSha256 === artifact.sha256,
    `${platform}: signature is bound to a different installer`,
  );
  assertion(
    signature.verified === true && signature.policyVerified === true,
    `${platform}: platform signature policy was not verified`,
  );

  if (platform === "windows") {
    assertion(
      signature.timestamped === true &&
        /^[a-f0-9]{64}$/u.test(signature.certificateSha256 || "") &&
        nonEmptyString(signature.subject) &&
        nonEmptyString(signature.timestampSubject),
      "windows: Authenticode signer or trusted timestamp policy is incomplete",
    );
  } else if (platform === "macos") {
    assertion(
      signature.notarizationAssessed === true &&
        /^[A-Z0-9]{10}$/u.test(signature.teamIdentifier || "") &&
        nonEmptyString(signature.authority) &&
        nonEmptyString(signature.designatedRequirement),
      "macos: code-signing or notarization policy is incomplete",
    );
  } else {
    assertion(
      signature.transparencyLogVerified === true &&
        nonEmptyString(signature.certificateIdentity) &&
        signature.certificateOidcIssuer ===
          "https://token.actions.githubusercontent.com",
      "linux: keyless Sigstore policy is incomplete",
    );
  }
}

function validateReceiptBinding(receipt, schema, record, label) {
  assertion(
    receipt?.schema === schema,
    `${record.platform}: ${label} schema mismatch`,
  );
  assertion(
    receipt.commitSha === record.commitSha &&
      receipt.platform === record.platform &&
      receipt.artifactSha256 === record.artifact.sha256 &&
      receipt.challengeDigest === record.challengeDigest,
    `${record.platform}: ${label} binding mismatch`,
  );
  assertion(
    SHA256.test(receipt.receiptDigest || "") &&
      receiptDigest(receipt) === receipt.receiptDigest,
    `${record.platform}: ${label} receipt digest mismatch`,
  );
}

function validateSkillJourneys(record) {
  assertion(
    Array.isArray(record.skillJourneys),
    `${record.platform}: Skill journeys are missing`,
  );
  const journeys = new Map();
  for (const journey of record.skillJourneys) {
    assertion(
      nonEmptyString(journey?.skillId) && !journeys.has(journey.skillId),
      `${record.platform}: Skill journey IDs must be unique`,
    );
    journeys.set(journey.skillId, journey);
  }

  for (const [skillId, requiredAuthorities] of Object.entries(
    REQUIRED_SKILL_AUTHORITIES,
  )) {
    const journey = journeys.get(skillId);
    assertion(journey, `${record.platform}: missing ${skillId} journey`);
    validateReceiptBinding(
      journey,
      RECEIPT_SCHEMAS.journey,
      record,
      `${skillId} journey`,
    );
    assertion(
      journey.status === "passed" &&
        journey.approved === true &&
        journey.policyAuthorized === true &&
        journey.handlerSource === "installed-app.asar" &&
        SHA256.test(journey.resultDigest || ""),
      `${record.platform}: ${skillId} did not produce an authorized terminal receipt`,
    );
    const authorities = new Set(journey.authorityKinds || []);
    for (const authority of requiredAuthorities) {
      assertion(
        authorities.has(authority),
        `${record.platform}: ${skillId} is missing ${authority} authority evidence`,
      );
    }
  }
}

export function validatePlatformEvidence(
  record,
  { expectedCommitSha, repository, workflowRef } = {},
) {
  assertion(
    record?.schema === PLATFORM_EVIDENCE_SCHEMA,
    "unexpected Desktop platform evidence schema",
  );
  assertion(
    record.status === "passed",
    "Desktop platform evidence did not pass",
  );
  assertion(
    PLATFORMS.includes(record.platform),
    "unsupported Desktop platform",
  );
  assertion(
    COMMIT_SHA.test(record.commitSha || ""),
    `${record.platform}: invalid commit SHA`,
  );
  if (expectedCommitSha) {
    assertion(
      record.commitSha === expectedCommitSha,
      `${record.platform}: evidence is bound to a different commit`,
    );
  }
  assertion(
    SHA256.test(record.challengeDigest || ""),
    `${record.platform}: qualification challenge is missing`,
  );
  assertion(
    record.provenance?.headSha === record.commitSha &&
      Number.isSafeInteger(record.provenance?.runId) &&
      record.provenance.runId > 0 &&
      Number.isSafeInteger(record.provenance?.runAttempt) &&
      record.provenance.runAttempt > 0,
    `${record.platform}: trusted workflow provenance is incomplete`,
  );
  if (repository) {
    assertion(
      record.provenance.repository === repository,
      `${record.platform}: repository provenance mismatch`,
    );
  }
  if (workflowRef) {
    assertion(
      record.provenance.workflowRef === workflowRef,
      `${record.platform}: workflow provenance mismatch`,
    );
  }
  if (repository) {
    const trustedPrefix = `${repository}/.github/workflows/desktop-signed-skill-platform.yml@`;
    const trustedRef = record.provenance.workflowRef.slice(
      trustedPrefix.length,
    );
    assertion(
      record.provenance.workflowRef.startsWith(trustedPrefix) &&
        (trustedRef === "refs/heads/main" ||
          /^refs\/tags\/v[^\s]+$/u.test(trustedRef)),
      `${record.platform}: evidence was not produced by the protected Desktop platform workflow`,
    );
  }

  assertion(
    nonEmptyString(record.artifact?.name) &&
      Number.isSafeInteger(record.artifact?.bytes) &&
      record.artifact.bytes > 0 &&
      SHA256.test(record.artifact?.sha256 || ""),
    `${record.platform}: installer byte identity is incomplete`,
  );
  validateSignature(record);
  validateReceiptBinding(
    record.install,
    RECEIPT_SCHEMAS.install,
    record,
    "install",
  );
  assertion(
    record.install?.fresh === true &&
      record.install?.installed === true &&
      record.install?.exitCode === 0 &&
      Number.isSafeInteger(record.install?.installedExecutableBytes) &&
      record.install.installedExecutableBytes > 0 &&
      SHA256.test(record.install?.installedExecutableSha256 || ""),
    `${record.platform}: fresh installation did not complete`,
  );
  validateReceiptBinding(
    record.launch,
    RECEIPT_SCHEMAS.launch,
    record,
    "launch",
  );
  assertion(
    record.launch?.started === true &&
      record.launch?.isPackaged === true &&
      record.launch?.asar === true &&
      Number.isSafeInteger(record.launch?.appAsarBytes) &&
      record.launch.appAsarBytes > 0 &&
      SHA256.test(record.launch?.appAsarSha256 || "") &&
      nonEmptyString(record.launch?.electronVersion) &&
      nonEmptyString(record.launch?.appVersion),
    `${record.platform}: packaged Desktop launch evidence is incomplete`,
  );
  validateSkillJourneys(record);
  assertion(
    SHA256.test(record.evidenceDigest || "") &&
      evidenceDigest(record) === record.evidenceDigest,
    `${record.platform}: evidence digest mismatch`,
  );
  return record;
}

export function validateEvidenceMatrix(records, options = {}) {
  assertion(Array.isArray(records), "Desktop evidence matrix must be an array");
  assertion(
    records.length === PLATFORMS.length,
    "Desktop evidence matrix must contain exactly three platforms",
  );
  const byPlatform = new Map();
  for (const record of records) {
    validatePlatformEvidence(record, options);
    assertion(
      !byPlatform.has(record.platform),
      `duplicate Desktop platform evidence: ${record.platform}`,
    );
    byPlatform.set(record.platform, record);
  }
  for (const platform of PLATFORMS) {
    assertion(
      byPlatform.has(platform),
      `missing Desktop platform evidence: ${platform}`,
    );
  }
  const commitShas = new Set(records.map((record) => record.commitSha));
  assertion(commitShas.size === 1, "Desktop evidence matrix mixes commit SHAs");
  assertion(
    new Set(records.map((record) => record.challengeDigest)).size === 1,
    "Desktop evidence matrix mixes qualification challenges",
  );

  const matrix = {
    schema: MATRIX_EVIDENCE_SCHEMA,
    status: "passed",
    commitSha: records[0].commitSha,
    repository: options.repository || records[0].provenance.repository,
    workflowRef: options.workflowRef || records[0].provenance.workflowRef,
    challengeDigest: records[0].challengeDigest,
    platforms: PLATFORMS.map((platform) => {
      const record = byPlatform.get(platform);
      return {
        platform,
        artifactSha256: record.artifact.sha256,
        platformEvidenceDigest: record.evidenceDigest,
        signature: record.artifact.signature.kind,
        runId: record.provenance.runId,
        runAttempt: record.provenance.runAttempt,
      };
    }),
    requiredSkillIds: Object.keys(REQUIRED_SKILL_AUTHORITIES).sort(),
  };
  matrix.evidenceDigest = evidenceDigest(matrix);
  return Object.freeze(matrix);
}

function evidenceFiles(root) {
  const resolvedRoot = path.resolve(root);
  assertion(
    fs.statSync(resolvedRoot).isDirectory(),
    "evidence path must be a directory",
  );
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      assertion(
        !entry.isSymbolicLink(),
        `symbolic evidence path is denied: ${target}`,
      );
      if (entry.isDirectory()) {
        visit(target);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(target);
      }
    }
  };
  visit(resolvedRoot);
  assertion(
    files.length === 3,
    "evidence directory must contain exactly three JSON records",
  );
  return files.sort();
}

export function verifyEvidenceDirectory(root, options = {}) {
  const records = evidenceFiles(root).map((file) => {
    const stat = fs.statSync(file);
    assertion(
      stat.size > 0 && stat.size <= MAX_EVIDENCE_BYTES,
      `evidence file size is invalid: ${file}`,
    );
    return JSON.parse(fs.readFileSync(file, "utf8"));
  });
  return validateEvidenceMatrix(records, options);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const evidenceRoot = argument("--verify-evidence-dir");
  const expectedCommitSha = argument("--expected-sha");
  const repository = argument("--repository");
  const workflowRef = argument("--workflow-ref");
  const output = argument("--output");
  assertion(evidenceRoot, "--verify-evidence-dir is required");
  assertion(
    COMMIT_SHA.test(expectedCommitSha || ""),
    "--expected-sha must be a full commit SHA",
  );
  assertion(nonEmptyString(repository), "--repository is required");
  assertion(nonEmptyString(workflowRef), "--workflow-ref is required");
  assertion(output, "--output is required");
  const matrix = verifyEvidenceDirectory(evidenceRoot, {
    expectedCommitSha,
    repository,
    workflowRef,
  });
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Desktop signed Skill matrix verified: ${matrix.commitSha} (${PLATFORMS.join(", ")})\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
