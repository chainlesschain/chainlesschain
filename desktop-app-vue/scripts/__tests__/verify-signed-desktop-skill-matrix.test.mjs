import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_EVIDENCE_SCHEMA,
  evidenceDigest,
  qualificationChallengeDigest,
  receiptDigest,
  validateEvidenceMatrix,
  verifyEvidenceDirectory,
} from "../verify-signed-desktop-skill-matrix.mjs";

const COMMIT_SHA = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const REPOSITORY = "chainlesschain/chainlesschain";
const RUN_ID = 1234;
const RUN_ATTEMPT = 1;
const CHALLENGE = qualificationChallengeDigest({
  repository: REPOSITORY,
  runId: RUN_ID,
  runAttempt: RUN_ATTEMPT,
  commitSha: COMMIT_SHA,
});
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
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
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
  expectedRunId: RUN_ID,
  expectedRunAttempt: RUN_ATTEMPT,
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

test("generic verifier rejects tag-produced Desktop evidence", () => {
  const tagged = record("linux");
  tagged.provenance.workflowRef = `${REPOSITORY}/.github/workflows/desktop-signed-skill-platform.yml@refs/tags/v1.0.0`;
  tagged.evidenceDigest = evidenceDigest(tagged);
  assert.throws(
    () =>
      validateEvidenceMatrix([tagged, record("macos"), record("windows")], {
        ...options,
        workflowRef: undefined,
      }),
    /protected Desktop platform workflow/u,
  );
});

test("rejects missing platforms and mixed commits", () => {
  assert.throws(
    () => validateEvidenceMatrix([record("linux"), record("macos")], options),
    /exactly three platforms/u,
  );
  const windows = record("windows");
  windows.commitSha = "d".repeat(40);
  windows.provenance.headSha = windows.commitSha;
  windows.challengeDigest = qualificationChallengeDigest({
    repository: REPOSITORY,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    commitSha: windows.commitSha,
  });
  for (const receipt of [
    windows.install,
    windows.launch,
    ...windows.skillJourneys,
  ]) {
    receipt.commitSha = windows.commitSha;
    receipt.challengeDigest = windows.challengeDigest;
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

test("rejects mixed producer runs and a replayed producer challenge", () => {
  const macos = record("macos", {
    provenance: {
      ...record("macos").provenance,
      runAttempt: 2,
    },
  });
  macos.challengeDigest = qualificationChallengeDigest({
    repository: REPOSITORY,
    runId: RUN_ID,
    runAttempt: 2,
    commitSha: COMMIT_SHA,
  });
  for (const receipt of [macos.install, macos.launch, ...macos.skillJourneys]) {
    receipt.challengeDigest = macos.challengeDigest;
    receipt.receiptDigest = receiptDigest(receipt);
  }
  macos.evidenceDigest = evidenceDigest(macos);
  assert.throws(
    () =>
      validateEvidenceMatrix([record("linux"), macos, record("windows")], {
        ...options,
        expectedRunAttempt: undefined,
      }),
    /mixes producer run attempts/u,
  );

  const linux = record("linux");
  linux.challengeDigest = `sha256:${"e".repeat(64)}`;
  for (const receipt of [linux.install, linux.launch, ...linux.skillJourneys]) {
    receipt.challengeDigest = linux.challengeDigest;
    receipt.receiptDigest = receiptDigest(receipt);
  }
  linux.evidenceDigest = evidenceDigest(linux);
  assert.throws(
    () =>
      validateEvidenceMatrix(
        [linux, record("macos"), record("windows")],
        options,
      ),
    /challenge does not bind producer identity/u,
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
    /actions\/runs\/\$\{SOURCE_RUN_ID\}\/attempts\/\$\{SOURCE_RUN_ATTEMPT\}/u,
  );
  assert.match(workflow, /verify-signed-desktop-workflow-trust\.mjs/u);
  assert.match(workflow, /verify-run --run "\$run_file"/u);
  assert.match(workflow, /gh attestation verify/u);
  assert.match(workflow, /--signer-workflow/u);
  assert.match(workflow, /--signer-digest "\$EXPECTED_SHA"/u);
  assert.match(workflow, /--source-ref refs\/heads\/main/u);
  assert.match(workflow, /--source-digest/u);
  assert.match(workflow, /--cert-oidc-issuer/u);
  assert.match(workflow, /--format json/u);
  assert.match(workflow, /verify-attestation --attestation/u);
  assert.match(workflow, /--run-id "\$SOURCE_RUN_ID"/u);
  assert.match(workflow, /--run-attempt "\$SOURCE_RUN_ATTEMPT"/u);
  assert.match(
    workflow,
    /desktop-signed-skill-platform\.yml@refs\/heads\/main/u,
  );
  assert.doesNotMatch(workflow, /refs\/tags\/v/u);
  assert.match(
    workflow,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/u,
  );
  assert.match(
    workflow,
    /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a/u,
  );
  assert.match(
    workflow,
    /desktop-signed-skill-evidence-\*-\$\{\{ inputs\.evidence_run_attempt \|\| github\.run_attempt \}\}-\$\{\{ inputs\.commit_sha \}\}/u,
  );
  assert.match(workflow, /REF_PROTECTED: \$\{\{ github\.ref_protected \}\}/u);
  assert.match(workflow, /git\/ref\/heads\/main/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(
    workflow,
    /Revalidate protected live main before aggregate attestation/u,
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
  assert.match(producer, /test "\$SOURCE_REF" = "refs\/heads\/main"/u);
  assert.match(producer, /test "\$REF_PROTECTED" = "true"/u);
  assert.match(producer, /git\/ref\/heads\/main/u);
  assert.doesNotMatch(producer, /refs\/tags\/v/u);
  assert.match(producer, /cancel-in-progress: true/u);
  assert.match(
    producer,
    /^    environment: desktop-signed-qualification-v2$/mu,
  );
  assert.match(producer, /cosign verify-blob/u);
  assert.match(producer, /Get-AuthenticodeSignature/u);
  assert.match(producer, /xcrun stapler validate/u);
  assert.match(producer, /--fresh-install/u);
  assert.match(producer, /signed-desktop-skill-journey\.mjs/u);
  assert.match(producer, /Attest exact platform evidence/u);
  assert.match(producer, /Attest exact signed installer bytes/u);
  assert.match(
    producer,
    /Revalidate protected live main before platform evidence attestation/u,
  );
  assert.match(
    producer,
    /Revalidate protected live main before installer attestation/u,
  );
  assert.match(
    producer,
    /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a/u,
  );
  assert.match(
    producer,
    /uses: \.\/\.github\/workflows\/desktop-signed-skill-qualification\.yml/u,
  );
  assert.doesNotMatch(
    `${workflow}\n${producer}`,
    /actions\/(?:checkout|setup-node|download-artifact|upload-artifact|attest-build-provenance)@v\d/u,
  );
  assert.doesNotMatch(producer, /continue-on-error:\s*true/u);

  const platformJobEnv = producer.match(
    /\n    env:\r?\n([\s\S]*?)\n    steps:/u,
  );
  assert.ok(platformJobEnv, "platform job env block must exist");
  assert.doesNotMatch(
    platformJobEnv[1],
    /CC_SKILL_|DESKTOP_(?:SKILL|WINDOWS|MAC)/u,
  );
  const producerStep = (name) => {
    const marker = `      - name: ${name}`;
    const start = producer.indexOf(marker);
    assert.notEqual(start, -1, `${name} step must exist`);
    const next = producer.indexOf("\n      - ", start + marker.length);
    return producer.slice(start, next === -1 ? producer.length : next);
  };
  const commonPreflight = producerStep("Require common live Skill credentials");
  const windowsPreflight = producerStep("Require Windows signing credentials");
  const macosPreflight = producerStep(
    "Require macOS signing and notarization credentials",
  );
  assert.match(commonPreflight, /CC_SKILL_GOOGLE_CLIENT_ID/u);
  assert.doesNotMatch(
    commonPreflight,
    /WINDOWS_CSC|MAC_(?:CSC|APPLE|TEAM)|DESKTOP_(?:WINDOWS|MAC|APPLE)/u,
  );
  assert.match(windowsPreflight, /if: matrix\.platform == 'windows'/u);
  assert.match(windowsPreflight, /DESKTOP_WINDOWS_CSC_LINK/u);
  assert.match(windowsPreflight, /DESKTOP_WINDOWS_CSC_KEY_PASSWORD/u);
  assert.doesNotMatch(
    windowsPreflight,
    /MAC_(?:CSC|APPLE|TEAM)|DESKTOP_(?:MAC|APPLE)/u,
  );
  assert.match(macosPreflight, /if: matrix\.platform == 'macos'/u);
  assert.match(macosPreflight, /DESKTOP_MAC_CSC_LINK/u);
  assert.match(macosPreflight, /DESKTOP_APPLE_TEAM_ID/u);
  assert.doesNotMatch(macosPreflight, /WINDOWS_CSC|DESKTOP_WINDOWS/u);
  for (const secret of [
    "DESKTOP_WINDOWS_CSC_LINK",
    "DESKTOP_WINDOWS_CSC_KEY_PASSWORD",
    "DESKTOP_MAC_CSC_LINK",
    "DESKTOP_MAC_CSC_KEY_PASSWORD",
    "DESKTOP_APPLE_ID",
    "DESKTOP_APPLE_APP_SPECIFIC_PASSWORD",
    "DESKTOP_APPLE_TEAM_ID",
    "DESKTOP_SKILL_GOOGLE_CLIENT_ID",
    "DESKTOP_SKILL_GOOGLE_CLIENT_SECRET",
    "DESKTOP_SKILL_GOOGLE_REFRESH_TOKEN",
    "DESKTOP_SKILL_NOTION_API_KEY",
    "DESKTOP_SKILL_TAVILY_API_KEY",
  ]) {
    assert.equal(
      producer.split(secret).length - 1,
      2,
      `${secret} must be scoped only to its preflight and consuming step`,
    );
  }
  assert.doesNotMatch(producer, /secrets\.GITHUB_TOKEN/u);
  assert.match(
    producer,
    /steps:\r?\n      - name: Require protected live main before environment access/u,
  );
});
