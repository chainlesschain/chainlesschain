import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { createPlatformEvidence } from "../create-signed-desktop-skill-evidence.mjs";
import { createInstallReceipt } from "../record-signed-desktop-install.mjs";
import { createSignatureEvidence } from "../record-signed-desktop-signature.mjs";
import { createJourneyReceipt } from "../signed-desktop-skill-journey.mjs";
import { receiptDigest } from "../verify-signed-desktop-skill-matrix.mjs";

const COMMIT = "a".repeat(40);
const CHALLENGE = `sha256:${"b".repeat(64)}`;
const REPOSITORY = "chainlesschain/chainlesschain";
const WORKFLOW_REF =
  "chainlesschain/chainlesschain/.github/workflows/desktop-signed-skill-platform.yml@refs/heads/main";
const require = createRequire(import.meta.url);
const SKILLS = {
  "github-manager": ["environment", "network"],
  "google-workspace": ["environment", "network"],
  notion: ["environment", "network"],
  "tavily-search": ["environment", "network"],
  obsidian: ["environment", "filesystem"],
  "code-runner": ["environment", "process"],
  "network-diagnostics": ["network", "process"],
};

function sha256(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-platform-evidence-"));
  const artifact = path.join(root, "chainlesschain.deb");
  const executable = path.join(root, "chainlesschain");
  fs.writeFileSync(artifact, "signed installer bytes");
  fs.writeFileSync(executable, "installed executable bytes");
  const artifactSha256 = sha256(artifact);
  const install = createInstallReceipt({
    platform: "linux",
    commitSha: COMMIT,
    challengeDigest: CHALLENGE,
    artifact,
    executable,
    fresh: true,
    exitCode: 0,
    installationMethod: "dpkg --install",
  });
  const launch = {
    schema: "chainlesschain.desktop-signed-skill-launch/v1",
    status: "passed",
    platform: "linux",
    commitSha: COMMIT,
    artifactSha256,
    challengeDigest: CHALLENGE,
    started: true,
    isPackaged: true,
    asar: true,
    appAsarBytes: 1024,
    appAsarSha256: `sha256:${"c".repeat(64)}`,
    electronVersion: "39.2.7",
    appVersion: "5.0.3-test",
  };
  launch.receiptDigest = receiptDigest(launch);
  const journeys = Object.entries(SKILLS).map(([skillId, authorityKinds]) =>
    createJourneyReceipt({
      platform: "linux",
      commitSha: COMMIT,
      artifactSha256,
      challengeDigest: CHALLENGE,
      skillId,
      authorityKinds,
      resultDigest: `sha256:${"d".repeat(64)}`,
    }),
  );
  const signature = {
    kind: "sigstore-keyless",
    artifactSha256,
    verified: true,
    policyVerified: true,
    transparencyLogVerified: true,
    certificateIdentity: WORKFLOW_REF,
    certificateOidcIssuer: "https://token.actions.githubusercontent.com",
  };
  return { root, artifact, install, launch, journeys, signature };
}

test("composes exact-artifact platform evidence from bound receipts", () => {
  const value = fixture();
  try {
    const record = createPlatformEvidence({
      platform: "linux",
      arch: "x64",
      commitSha: COMMIT,
      challengeDigest: CHALLENGE,
      artifact: value.artifact,
      signature: value.signature,
      install: value.install,
      launch: value.launch,
      journeys: value.journeys,
      repository: REPOSITORY,
      workflowRef: WORKFLOW_REF,
      runId: 123,
      runAttempt: 1,
    });
    assert.equal(record.status, "passed");
    assert.equal(record.skillJourneys.length, 7);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects a signature copied from another installer", () => {
  const value = fixture();
  try {
    assert.throws(
      () =>
        createPlatformEvidence({
          platform: "linux",
          arch: "x64",
          commitSha: COMMIT,
          challengeDigest: CHALLENGE,
          artifact: value.artifact,
          signature: {
            ...value.signature,
            artifactSha256: `sha256:${"e".repeat(64)}`,
          },
          install: value.install,
          launch: value.launch,
          journeys: value.journeys,
          repository: REPOSITORY,
          workflowRef: WORKFLOW_REF,
          runId: 123,
          runAttempt: 1,
        }),
      /signature is bound to a different installer/u,
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("records only complete platform signature identities", () => {
  const value = fixture();
  try {
    assert.throws(
      () =>
        createSignatureEvidence({
          platform: "windows",
          artifact: value.artifact,
          timestamped: true,
          certificateSha256: "not-a-certificate-digest",
          subject: "CN=ChainlessChain",
          timestampSubject: "CN=Timestamp",
        }),
      /certificate SHA-256 is invalid/u,
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("macOS notarization hook fails closed when qualification credentials are absent", async () => {
  const notarize = require("../notarize.js");
  const names = [
    "CC_REQUIRE_DESKTOP_NOTARIZATION",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    process.env.CC_REQUIRE_DESKTOP_NOTARIZATION = "1";
    delete process.env.APPLE_ID;
    delete process.env.APPLE_APP_SPECIFIC_PASSWORD;
    delete process.env.APPLE_TEAM_ID;
    await assert.rejects(
      notarize({ electronPlatformName: "darwin" }),
      /requires APPLE_ID/u,
    );
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
