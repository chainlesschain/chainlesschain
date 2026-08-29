import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_EVIDENCE_SCHEMA,
  evidenceDigest,
  receiptDigest,
  validateEvidenceMatrix,
  verifyEvidenceDirectory,
} from "../verify-signed-desktop-skill-matrix.mjs";

const COMMIT_SHA = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const CHALLENGE = `sha256:${"e".repeat(64)}`;
const REPOSITORY = "chainlesschain/chainlesschain";
const WORKFLOW_REF =
  "chainlesschain/chainlesschain/.github/workflows/desktop-signed-skill-platform.yml@refs/heads/main";
const SKILLS = {
  "github-manager": ["environment", "network"],
  "google-workspace": ["environment", "network"],
  notion: ["environment", "network"],
  "tavily-search": ["environment", "network"],
  obsidian: ["environment", "filesystem"],
  "code-runner": ["environment", "process"],
  "network-diagnostics": ["network", "process"],
};
const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function signature(platform) {
  if (platform === "windows") {
    return {
      artifactSha256: DIGEST,
      kind: "authenticode",
      verified: true,
      policyVerified: true,
      timestamped: true,
      certificateSha256: "c".repeat(64),
      subject: "CN=ChainlessChain",
      timestampSubject: "CN=Trusted Timestamp",
    };
  }
  if (platform === "macos") {
    return {
      artifactSha256: DIGEST,
      kind: "codesign+notarized",
      verified: true,
      policyVerified: true,
      notarizationAssessed: true,
      teamIdentifier: "ABCDEFGHIJ",
      authority: "Developer ID Application: ChainlessChain",
      designatedRequirement: "identifier com.chainlesschain.desktop",
    };
  }
  return {
    artifactSha256: DIGEST,
    kind: "sigstore-keyless",
    verified: true,
    policyVerified: true,
    transparencyLogVerified: true,
    certificateIdentity: WORKFLOW_REF,
    certificateOidcIssuer: "https://token.actions.githubusercontent.com",
  };
}

function boundReceipt(schema, values = {}) {
  const value = {
    schema,
    commitSha: COMMIT_SHA,
    artifactSha256: DIGEST,
    challengeDigest: CHALLENGE,
    ...values,
  };
  value.receiptDigest = receiptDigest(value);
  return value;
}

function record(platform, overrides = {}) {
  const value = {
    schema: PLATFORM_EVIDENCE_SCHEMA,
    status: "passed",
    commitSha: COMMIT_SHA,
    challengeDigest: CHALLENGE,
    platform,
    arch: "x64",
    artifact: {
      name: `chainlesschain-${platform}.installer`,
      bytes: 1024,
      sha256: DIGEST,
      signature: signature(platform),
    },
    install: boundReceipt("chainlesschain.desktop-signed-skill-install/v1", {
      platform,
      fresh: true,
      installed: true,
      exitCode: 0,
      installedExecutableBytes: 4096,
      installedExecutableSha256: DIGEST,
    }),
    launch: boundReceipt("chainlesschain.desktop-signed-skill-launch/v1", {
      platform,
      started: true,
      isPackaged: true,
      asar: true,
      appAsarBytes: 8192,
      appAsarSha256: DIGEST,
      electronVersion: "39.2.7",
      appVersion: "5.0.3-test",
    }),
    skillJourneys: Object.entries(SKILLS).map(([skillId, authorityKinds]) =>
      boundReceipt("chainlesschain.desktop-signed-skill-journey/v1", {
        platform,
        skillId,
        status: "passed",
        approved: true,
        policyAuthorized: true,
        authorityKinds,
        handlerSource: "installed-app.asar",
        resultDigest: DIGEST,
      }),
    ),
    provenance: {
      repository: REPOSITORY,
      workflowRef: WORKFLOW_REF,
      headSha: COMMIT_SHA,
      runId: 1234,
      runAttempt: 1,
    },
    ...overrides,
  };
  value.evidenceDigest = evidenceDigest(value);
  return value;
}

const options = {
  expectedCommitSha: COMMIT_SHA,
  repository: REPOSITORY,
  workflowRef: WORKFLOW_REF,
};

test("accepts an exact-SHA trusted three-platform matrix", () => {
  const matrix = validateEvidenceMatrix(
    [record("linux"), record("macos"), record("windows")],
    options,
  );
  assert.equal(matrix.status, "passed");
  assert.equal(matrix.commitSha, COMMIT_SHA);
  assert.deepEqual(
    matrix.platforms.map(({ platform }) => platform),
    ["linux", "macos", "windows"],
  );
  assert.match(matrix.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("rejects missing platforms and mixed commits", () => {
  assert.throws(
    () => validateEvidenceMatrix([record("linux"), record("macos")], options),
    /exactly three platforms/u,
  );
  const windows = record("windows");
  windows.commitSha = "d".repeat(40);
  windows.provenance.headSha = windows.commitSha;
  for (const receipt of [
    windows.install,
    windows.launch,
    ...windows.skillJourneys,
  ]) {
    receipt.commitSha = windows.commitSha;
    receipt.receiptDigest = receiptDigest(receipt);
  }
  windows.evidenceDigest = evidenceDigest(windows);
  assert.throws(
    () =>
      validateEvidenceMatrix([record("linux"), record("macos"), windows], {
        ...options,
        expectedCommitSha: undefined,
      }),
    /mixes commit SHAs/u,
  );
});

test("rejects replayed launch and journey receipts", () => {
  const linux = record("linux");
  linux.launch.challengeDigest = `sha256:${"f".repeat(64)}`;
  linux.launch.receiptDigest = receiptDigest(linux.launch);
  linux.evidenceDigest = evidenceDigest(linux);
  assert.throws(
    () =>
      validateEvidenceMatrix(
        [linux, record("macos"), record("windows")],
        options,
      ),
    /launch binding mismatch/u,
  );
});

test("rejects forged evidence digests", () => {
  const windows = record("windows");
  windows.artifact.name = "forged-installer.exe";
  assert.throws(
    () =>
      validateEvidenceMatrix(
        [record("linux"), record("macos"), windows],
        options,
      ),
    /evidence digest mismatch/u,
  );
});

test("rejects an untrusted platform signature policy", () => {
  const macos = record("macos");
  macos.artifact.signature.notarizationAssessed = false;
  macos.evidenceDigest = evidenceDigest(macos);
  assert.throws(
    () =>
      validateEvidenceMatrix(
        [record("linux"), macos, record("windows")],
        options,
      ),
    /notarization policy is incomplete/u,
  );
});

test("rejects a missing Skill authority journey", () => {
  const linux = record("linux");
  linux.skillJourneys = linux.skillJourneys.filter(
    ({ skillId }) => skillId !== "code-runner",
  );
  linux.evidenceDigest = evidenceDigest(linux);
  assert.throws(
    () =>
      validateEvidenceMatrix(
        [linux, record("macos"), record("windows")],
        options,
      ),
    /missing code-runner journey/u,
  );
});

test("loads only three bounded non-symlink JSON records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-desktop-matrix-"));
  try {
    for (const platform of ["linux", "macos", "windows"]) {
      fs.writeFileSync(
        path.join(root, `${platform}.json`),
        `${JSON.stringify(record(platform))}\n`,
      );
    }
    assert.equal(verifyEvidenceDirectory(root, options).status, "passed");
    fs.writeFileSync(path.join(root, "extra.json"), "{}\n");
    assert.throws(
      () => verifyEvidenceDirectory(root, options),
      /exactly three JSON records/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("qualification workflow keeps producer identity and aggregate attestation fail closed", () => {
  const workflow = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      ".github",
      "workflows",
      "desktop-signed-skill-qualification.yml",
    ),
    "utf8",
  );
  assert.match(
    workflow,
    /test "\$source_path" = "\.github\/workflows\/desktop-signed-skill-platform\.yml"/u,
  );
  assert.match(workflow, /actions\/download-artifact@v7/u);
  assert.match(workflow, /actions\/attest-build-provenance@v3/u);
  assert.match(
    workflow,
    /desktop-signed-skill-evidence-\*-\$\{\{ inputs\.commit_sha \}\}/u,
  );
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/u);

  const producer = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      ".github",
      "workflows",
      "desktop-signed-skill-platform.yml",
    ),
    "utf8",
  );
  assert.match(producer, /test "\$EXPECTED_SHA" = "\$SOURCE_SHA"/u);
  assert.match(producer, /environment: desktop-signed-qualification/u);
  assert.match(producer, /cosign verify-blob/u);
  assert.match(producer, /Get-AuthenticodeSignature/u);
  assert.match(producer, /xcrun stapler validate/u);
  assert.match(producer, /--fresh-install/u);
  assert.match(producer, /signed-desktop-skill-journey\.mjs/u);
  assert.match(producer, /Attest exact signed installer bytes/u);
  assert.match(producer, /actions\/attest-build-provenance@v3/u);
  assert.match(
    producer,
    /uses: \.\/\.github\/workflows\/desktop-signed-skill-qualification\.yml/u,
  );
  assert.doesNotMatch(producer, /continue-on-error:\s*true/u);
});
