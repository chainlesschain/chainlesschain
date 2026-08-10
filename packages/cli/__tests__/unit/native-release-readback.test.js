import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signPackUpdateManifest } from "../../src/lib/packer/pack-update-signature.js";
import { createNativeReleaseSbom } from "../../scripts/create-native-release-sbom.mjs";
import {
  generatePackageManagerManifests,
  WINGET_MANIFEST_FILES,
} from "../../scripts/generate-package-manager-manifests.mjs";
import { nativePackageManagerContract } from "../../scripts/native-release-contract.mjs";
import {
  NATIVE_RELEASE_TARGETS,
  NATIVE_STABLE_PRIMARY_ASSETS,
  verifyNativeReleaseReadback,
} from "../../scripts/verify-native-release-readback.mjs";

const directories = [];
const REPOSITORY = "chainlesschain/chainlesschain";
const VERSION = "1.2.3";
const TAG = `cli-v${VERSION}`;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const PUBLISHED_AT = "2026-08-10T00:00:00.000Z";
const COSIGN_ISSUER = "https://token.actions.githubusercontent.com";
const READBACK = Object.freeze({
  workflowRef: `${REPOSITORY}/.github/workflows/cli-native-release-readback.yml@refs/heads/main`,
  workflowSha: COMMIT,
  runId: "123456789",
  runAttempt: "1",
  eventName: "workflow_dispatch",
  callerWorkflowRef: `${REPOSITORY}/.github/workflows/cli-native-release-readback.yml@refs/heads/main`,
  callerWorkflowSha: COMMIT,
});

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeBundle(directory, primary) {
  writeJson(path.join(directory, `${primary}.sigstore.json`), {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: { fixture: true },
  });
}

function releaseMetadata(directory, tag, targetCommitish = COMMIT) {
  const base = `https://github.com/${REPOSITORY}/releases/download/${tag}`;
  const assets = fs
    .readdirSync(directory)
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(directory, name));
      return {
        name,
        size: bytes.length,
        digest: `sha256:${sha256(bytes)}`,
        browser_download_url: `${base}/${encodeURIComponent(name)}`,
      };
    });
  return {
    tag_name: tag,
    target_commitish: targetCommitish,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/${REPOSITORY}/releases/tag/${tag}`,
    assets,
  };
}

function rewriteChecksums(directory) {
  const names = fs
    .readdirSync(directory)
    .filter(
      (name) => name !== "SHA256SUMS" && name !== "SHA256SUMS.sigstore.json",
    )
    .sort();
  const lines = names.map((name) => {
    const bytes = fs.readFileSync(path.join(directory, name));
    return `${sha256(bytes)}  ./${name}`;
  });
  fs.writeFileSync(path.join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

function signedPrimaries(directory) {
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".sigstore.json"))
    .map((name) => name.slice(0, -".sigstore.json".length))
    .sort();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-readback-"));
  directories.push(root);
  const versionedDir = path.join(root, "versioned");
  const stableDir = path.join(root, "stable");
  fs.mkdirSync(versionedDir);
  fs.mkdirSync(stableDir);
  const releaseBase = `https://github.com/${REPOSITORY}/releases/download/${TAG}`;
  const artifacts = [];

  for (const [target, expected] of Object.entries(NATIVE_RELEASE_TARGETS)) {
    const bytes = Buffer.from(`signed native fixture for ${target}`);
    fs.writeFileSync(path.join(versionedDir, expected.artifact), bytes);
    writeBundle(versionedDir, expected.artifact);
    writeJson(
      path.join(versionedDir, `${expected.artifact}.pack-manifest.json`),
      {
        schema: 1,
        cliVersion: VERSION,
        gitCommit: COMMIT,
        gitDirty: false,
        targets: [target],
        target,
        artifact: expected.artifact,
        bytes: bytes.length,
        sha256: sha256(bytes),
        signed: true,
        signature: {
          type: "sigstore-bundle",
          file: `${expected.artifact}.sigstore.json`,
          platform: expected.platformSignature,
        },
      },
    );
    if (target.includes("macos")) {
      const id = target.endsWith("x64")
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222";
      writeJson(
        path.join(versionedDir, `${expected.artifact}.notarization.json`),
        {
          id,
          status: "Accepted",
        },
      );
      writeJson(
        path.join(versionedDir, `${expected.artifact}.notarization-log.json`),
        { jobId: id, status: "Accepted", issues: [] },
      );
    }
    artifacts.push({
      target,
      url: `${releaseBase}/${encodeURIComponent(expected.artifact)}`,
      sha256: sha256(bytes),
      bytes: bytes.length,
      signature: `${releaseBase}/${encodeURIComponent(`${expected.artifact}.sigstore.json`)}`,
      platformSignature: expected.platformSignature,
    });
  }
  artifacts.sort((left, right) => left.target.localeCompare(right.target));

  const packageJson = {
    name: "chainlesschain",
    version: VERSION,
    dependencies: { fixture: "1.0.0" },
  };
  const lock = {
    name: "repository-root",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "repository-root", version: "1.0.0" },
      "packages/cli": {
        name: "chainlesschain",
        version: VERSION,
        dependencies: { fixture: "1.0.0" },
      },
      "node_modules/fixture": {
        version: "1.0.0",
        integrity: `sha512-${Buffer.alloc(64, 5).toString("base64")}`,
      },
    },
  };
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  writeJson(packagePath, packageJson);
  writeJson(lockPath, lock);
  const sbom = createNativeReleaseSbom({
    packagePath,
    lockPath,
    commit: COMMIT,
    timestamp: PUBLISHED_AT,
  });
  const sbomName = "chainlesschain-cli-sbom.cdx.json";
  writeJson(path.join(versionedDir, sbomName), sbom);
  const rebuiltSbomPath = path.join(root, "rebuilt-sbom.cdx.json");
  writeJson(rebuiltSbomPath, sbom);
  const expectedLockSha256 = sha256(fs.readFileSync(lockPath));
  const rootProperties = Object.fromEntries(
    sbom.metadata.component.properties.map((item) => [item.name, item.value]),
  );
  const sbomBytes = fs.readFileSync(path.join(versionedDir, sbomName));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  fs.writeFileSync(
    path.join(versionedDir, "cli-update-public-key.pem"),
    publicKeyPem,
  );
  const manifest = signPackUpdateManifest(
    {
      schema: 1,
      minimumUpdaterSchema: 1,
      channel: "stable",
      latest: {
        cliVersion: VERSION,
        publishedAt: PUBLISHED_AT,
        releaseNotes: `https://github.com/${REPOSITORY}/releases/tag/${TAG}`,
        commit: COMMIT,
        packageManager: nativePackageManagerContract(),
        sbom: {
          url: `${releaseBase}/${sbomName}`,
          sha256: sha256(sbomBytes),
          format: "cyclonedx-json",
          lockSha256: expectedLockSha256,
          runtimeRefsSha256:
            rootProperties["chainlesschain:runtime.refs.sha256"],
        },
        artifacts,
      },
    },
    privateKey,
  );
  writeJson(path.join(versionedDir, "chainlesschain-update.json"), manifest);
  fs.writeFileSync(
    path.join(versionedDir, "install.sh"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.writeFileSync(
    path.join(versionedDir, "install.ps1"),
    "Set-StrictMode -Version Latest\n",
  );
  const packageManager = generatePackageManagerManifests(manifest);
  fs.writeFileSync(
    path.join(versionedDir, "chainlesschain.rb"),
    packageManager.homebrew,
  );
  fs.writeFileSync(
    path.join(versionedDir, WINGET_MANIFEST_FILES.version),
    packageManager.wingetVersion,
  );
  fs.writeFileSync(
    path.join(versionedDir, WINGET_MANIFEST_FILES.defaultLocale),
    packageManager.wingetDefaultLocale,
  );
  fs.writeFileSync(
    path.join(versionedDir, WINGET_MANIFEST_FILES.installer),
    packageManager.wingetInstaller,
  );
  for (const primary of NATIVE_STABLE_PRIMARY_ASSETS) {
    writeBundle(versionedDir, primary);
  }
  rewriteChecksums(versionedDir);
  writeBundle(versionedDir, "SHA256SUMS");

  for (const primary of NATIVE_STABLE_PRIMARY_ASSETS) {
    for (const name of [primary, `${primary}.sigstore.json`]) {
      fs.copyFileSync(
        path.join(versionedDir, name),
        path.join(stableDir, name),
      );
    }
  }
  const value = {
    versionedDir,
    stableDir,
    release: releaseMetadata(versionedDir, TAG),
    stableRelease: releaseMetadata(stableDir, "cli-stable"),
    cosignEvidence: {
      schema: "chainlesschain.cli-native-cosign-readback.v1",
      repository: REPOSITORY,
      ref: `refs/tags/${TAG}`,
      workflowRepository: REPOSITORY,
      workflowRef: `refs/tags/${TAG}`,
      workflowSha: COMMIT,
      workflowTrigger: "push",
      issuer: COSIGN_ISSUER,
      identity: `https://github.com/${REPOSITORY}/.github/workflows/cli-native-release.yml@refs/tags/${TAG}`,
      versioned: signedPrimaries(versionedDir),
      stable: signedPrimaries(stableDir),
      readbackExecution: { ...READBACK },
    },
    repository: REPOSITORY,
    tag: TAG,
    commit: COMMIT,
    expectedLockSha256,
    rebuiltSbomPath,
    readbackWorkflowRef: READBACK.workflowRef,
    readbackWorkflowSha: READBACK.workflowSha,
    readbackRunId: READBACK.runId,
    readbackRunAttempt: READBACK.runAttempt,
    readbackEventName: READBACK.eventName,
    callerWorkflowRef: READBACK.callerWorkflowRef,
    callerWorkflowSha: READBACK.callerWorkflowSha,
  };
  return value;
}

describe("native public release readback", () => {
  it("verifies exact release identity, six targets, signatures, SBOM, and package metadata", () => {
    const value = fixture();
    expect(verifyNativeReleaseReadback(value)).toMatchObject({
      schema: "chainlesschain.cli-native-public-readback.v1",
      repository: REPOSITORY,
      tag: TAG,
      version: VERSION,
      commit: COMMIT,
      stableChannelVerified: true,
      updateManifestEd25519Verified: true,
      sbomVerified: true,
      publicReadbackVerified: true,
      releaseEligible: false,
      packageManagerMetadataVerified: {
        homebrewFormula: true,
        wingetManifestSet: true,
        publicCatalogPublication: false,
      },
      targets: expect.arrayContaining([
        expect.objectContaining({ target: "node22-linux-x64" }),
        expect.objectContaining({ target: "node22-win-arm64" }),
        expect.objectContaining({ target: "node22-macos-arm64" }),
      ]),
    });
  });

  it("accepts only the same-tag release workflow as the reusable readback caller", () => {
    const value = fixture();
    const execution = {
      workflowRef: `${REPOSITORY}/.github/workflows/cli-native-release-readback.yml@refs/tags/${TAG}`,
      workflowSha: COMMIT,
      runId: "987654321",
      runAttempt: "1",
      eventName: "push",
      callerWorkflowRef: `${REPOSITORY}/.github/workflows/cli-native-release.yml@refs/tags/${TAG}`,
      callerWorkflowSha: COMMIT,
    };
    Object.assign(value, {
      readbackWorkflowRef: execution.workflowRef,
      readbackWorkflowSha: execution.workflowSha,
      readbackRunId: execution.runId,
      readbackRunAttempt: execution.runAttempt,
      readbackEventName: execution.eventName,
      callerWorkflowRef: execution.callerWorkflowRef,
      callerWorkflowSha: execution.callerWorkflowSha,
    });
    value.cosignEvidence.readbackExecution = execution;
    expect(verifyNativeReleaseReadback(value)).toMatchObject({
      readbackWorkflow: execution,
      publicReadbackVerified: true,
      releaseEligible: false,
    });

    value.callerWorkflowRef = `${REPOSITORY}/.github/workflows/other.yml@refs/tags/${TAG}`;
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /readback workflow execution identity is invalid/,
    );
  });

  it("writes the same fail-closed evidence through the standalone CLI", () => {
    const value = fixture();
    const root = path.dirname(value.versionedDir);
    const releasePath = path.join(root, "release.json");
    const stableReleasePath = path.join(root, "stable-release.json");
    const cosignPath = path.join(root, "cosign.json");
    const output = path.join(root, "readback.json");
    writeJson(releasePath, value.release);
    writeJson(stableReleasePath, value.stableRelease);
    writeJson(cosignPath, value.cosignEvidence);
    const script = path.resolve(
      import.meta.dirname,
      "../../scripts/verify-native-release-readback.mjs",
    );
    const result = spawnSync(
      process.execPath,
      [
        script,
        value.versionedDir,
        value.stableDir,
        releasePath,
        stableReleasePath,
        cosignPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CC_NATIVE_RELEASE_REPOSITORY: REPOSITORY,
          CC_NATIVE_RELEASE_TAG: TAG,
          CC_NATIVE_RELEASE_COMMIT: COMMIT,
          CC_NATIVE_RELEASE_LOCK_SHA256: value.expectedLockSha256,
          CC_NATIVE_RELEASE_REBUILT_SBOM: value.rebuiltSbomPath,
          CC_NATIVE_READBACK_WORKFLOW_REF: READBACK.workflowRef,
          CC_NATIVE_READBACK_WORKFLOW_SHA: READBACK.workflowSha,
          CC_NATIVE_READBACK_RUN_ID: READBACK.runId,
          CC_NATIVE_READBACK_RUN_ATTEMPT: READBACK.runAttempt,
          CC_NATIVE_READBACK_EVENT_NAME: READBACK.eventName,
          CC_NATIVE_CALLER_WORKFLOW_REF: READBACK.callerWorkflowRef,
          CC_NATIVE_CALLER_WORKFLOW_SHA: READBACK.callerWorkflowSha,
          CC_NATIVE_READBACK_OUTPUT: output,
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
      tag: TAG,
      commit: COMMIT,
      publicReadbackVerified: true,
      releaseEligible: false,
    });
  });

  it("rejects changed public artifact bytes before trusting the manifest", () => {
    const value = fixture();
    fs.appendFileSync(
      path.join(value.versionedDir, "chainlesschain-node22-linux-x64"),
      "tampered",
    );
    expect(() => verifyNativeReleaseReadback(value)).toThrow(/byte length/);
  });

  it("rejects a release whose public tag metadata targets another commit", () => {
    const value = fixture();
    value.release.target_commitish = "f".repeat(40);
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /versioned release target commit mismatch/,
    );
  });

  it("rejects a missing asset even if forged metadata omits it too", () => {
    const value = fixture();
    const missing = "chainlesschain-node22-linux-arm64.sigstore.json";
    fs.unlinkSync(path.join(value.versionedDir, missing));
    value.release.assets = value.release.assets.filter(
      (asset) => asset.name !== missing,
    );
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /versioned native release asset set mismatch/,
    );
  });

  it("rejects duplicate public release asset metadata", () => {
    const value = fixture();
    value.release.assets.push({ ...value.release.assets[0] });
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /downloaded asset set actual set contains duplicates/,
    );
  });

  it("rejects a wrong signed-checksum entry", () => {
    const value = fixture();
    const checksums = path.join(value.versionedDir, "SHA256SUMS");
    const text = fs.readFileSync(checksums, "utf8");
    fs.writeFileSync(checksums, text.replace(/^[0-9a-f]{64}/u, "f".repeat(64)));
    value.release = releaseMetadata(value.versionedDir, TAG);
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /SHA256SUMS .* mismatch/,
    );
  });

  it("rejects incomplete workflow-identity Sigstore evidence", () => {
    const value = fixture();
    value.cosignEvidence.versioned = value.cosignEvidence.versioned.filter(
      (name) => name !== "chainlesschain-node22-win-arm64.exe",
    );
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /Cosign versioned verification set mismatch/,
    );
  });

  it("rejects Sigstore evidence from another workflow SHA or trigger", () => {
    const wrongRepository = fixture();
    wrongRepository.cosignEvidence.workflowRepository = "attacker/repository";
    expect(() => verifyNativeReleaseReadback(wrongRepository)).toThrow(
      /Cosign workflow repository mismatch/,
    );

    const wrongRef = fixture();
    wrongRef.cosignEvidence.workflowRef = "refs/heads/main";
    expect(() => verifyNativeReleaseReadback(wrongRef)).toThrow(
      /Cosign workflow ref mismatch/,
    );

    const wrongSha = fixture();
    wrongSha.cosignEvidence.workflowSha = "f".repeat(40);
    expect(() => verifyNativeReleaseReadback(wrongSha)).toThrow(
      /Cosign workflow SHA mismatch/,
    );

    const wrongTrigger = fixture();
    wrongTrigger.cosignEvidence.workflowTrigger = "workflow_dispatch";
    expect(() => verifyNativeReleaseReadback(wrongTrigger)).toThrow(
      /Cosign workflow trigger mismatch/,
    );
  });

  it("rejects forged readback-run identity evidence", () => {
    const value = fixture();
    value.cosignEvidence.readbackExecution.runAttempt = "2";
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /readback execution runAttempt mismatch/,
    );
  });

  it("rejects a public SBOM that does not match the exact-lock rebuild", () => {
    const value = fixture();
    fs.appendFileSync(value.rebuiltSbomPath, " ");
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /exact-lock rebuild/,
    );
  });

  it("rejects an invalid Ed25519 update signature even when checksums are refreshed", () => {
    const value = fixture();
    const manifestPath = path.join(
      value.versionedDir,
      "chainlesschain-update.json",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.signature.value = Buffer.alloc(64, 7).toString("base64");
    writeJson(manifestPath, manifest);
    rewriteChecksums(value.versionedDir);
    value.release = releaseMetadata(value.versionedDir, TAG);
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /signature verification failed/,
    );
  });

  it("rejects a stable channel that is not byte-identical to the versioned release", () => {
    const value = fixture();
    fs.appendFileSync(path.join(value.stableDir, "install.sh"), "# changed\n");
    value.stableRelease = releaseMetadata(value.stableDir, "cli-stable");
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /stable channel bytes differ from versioned asset: install.sh/,
    );
  });

  it("rejects forged stable-channel release metadata", () => {
    const value = fixture();
    value.stableRelease.html_url = "https://attacker.invalid/cli-stable";
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /stable release public URL mismatch/,
    );
  });

  it("does not accept an external expected SHA that disagrees with signed content", () => {
    const value = fixture();
    value.commit = "f".repeat(40);
    value.release.target_commitish = value.commit;
    value.cosignEvidence.workflowSha = value.commit;
    expect(() => verifyNativeReleaseReadback(value)).toThrow(
      /native update manifest commit mismatch/,
    );
  });

  it("can verify an immutable historical version without claiming current stable", () => {
    const value = fixture();
    expect(
      verifyNativeReleaseReadback({
        ...value,
        stableDir: null,
        stableRelease: null,
        cosignEvidence: { ...value.cosignEvidence, stable: [] },
      }),
    ).toMatchObject({
      stableChannelVerified: false,
      releaseEligible: false,
    });
  });
});
