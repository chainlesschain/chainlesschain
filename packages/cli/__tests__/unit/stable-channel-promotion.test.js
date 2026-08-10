import { describe, expect, it } from "vitest";
import {
  resolveStableManifestSigningIdentity,
  verifyStableChannelPromotion,
} from "../../scripts/verify-stable-channel-promotion.mjs";
import { nativePackageManagerContract } from "../../scripts/native-release-contract.mjs";

function manifest(version, commit = "f".repeat(40), sha = "a".repeat(64)) {
  return {
    schema: 1,
    minimumUpdaterSchema: 1,
    channel: "stable",
    signature: {
      algorithm: "ed25519",
      keyId: "e".repeat(32),
      value: Buffer.alloc(64, 7).toString("base64"),
    },
    latest: {
      cliVersion: version,
      publishedAt: "2026-01-02T03:04:05.000Z",
      releaseNotes: `https://example.test/${version}/notes`,
      commit,
      packageManager: nativePackageManagerContract(),
      sbom: {
        url: `https://example.test/${version}/sbom.cdx.json`,
        sha256: "c".repeat(64),
        format: "cyclonedx-json",
        lockSha256: "d".repeat(64),
        runtimeRefsSha256: "e".repeat(64),
      },
      artifacts: [
        {
          target: "node20-linux-x64",
          url: `https://example.test/${version}/chainlesschain`,
          sha256: sha,
          bytes: 1234,
          signature: `https://example.test/${version}/chainlesschain.sigstore.json`,
          platformSignature: "sigstore-keyless",
        },
      ],
    },
  };
}

describe("stable native CLI channel promotion", () => {
  it("initializes an empty channel", () => {
    expect(verifyStableChannelPromotion(null, manifest("1.2.3"))).toMatchObject(
      {
        action: "initialize",
        version: "1.2.3",
      },
    );
  });

  it("allows a strictly newer stable version", () => {
    expect(
      verifyStableChannelPromotion(manifest("1.2.3"), manifest("1.3.0")),
    ).toMatchObject({
      action: "promote",
      fromVersion: "1.2.3",
      version: "1.3.0",
    });
  });

  it("derives the existing stable bundle identity from its old version and exact commit", () => {
    const oldCommit = "1".repeat(40);
    const newCommit = "2".repeat(40);
    const current = manifest("1.2.3", oldCommit);
    const candidate = manifest("1.2.4", newCommit);

    expect(resolveStableManifestSigningIdentity(current)).toEqual({
      repository: "chainlesschain/chainlesschain",
      version: "1.2.3",
      tag: "cli-v1.2.3",
      ref: "refs/tags/cli-v1.2.3",
      commit: oldCommit,
      identity:
        "https://github.com/chainlesschain/chainlesschain/.github/workflows/cli-native-release.yml@refs/tags/cli-v1.2.3",
    });
    expect(resolveStableManifestSigningIdentity(candidate)).toMatchObject({
      tag: "cli-v1.2.4",
      commit: newCommit,
    });
    expect(verifyStableChannelPromotion(current, candidate)).toEqual({
      action: "promote",
      fromVersion: "1.2.3",
      version: "1.2.4",
    });
  });

  it("rejects a downgrade", () => {
    expect(() =>
      verifyStableChannelPromotion(manifest("2.0.0"), manifest("1.9.9")),
    ).toThrow(/refusing stable channel downgrade/);
  });

  it("permits an exact idempotent replay", () => {
    const value = manifest("1.2.3", "1".repeat(40));
    expect(
      verifyStableChannelPromotion(value, structuredClone(value)),
    ).toMatchObject({ action: "idempotent", version: "1.2.3" });
  });

  it("rejects same-version replacement bytes or commit", () => {
    expect(() =>
      verifyStableChannelPromotion(
        manifest("1.2.3", "a".repeat(40)),
        manifest("1.2.3", "b".repeat(40)),
      ),
    ).toThrow(/different signed manifest identity/);
    expect(() =>
      verifyStableChannelPromotion(
        manifest("1.2.3", "a".repeat(40)),
        manifest("1.2.3", "a".repeat(40), "b".repeat(64)),
      ),
    ).toThrow(/different signed manifest identity/);
  });

  it.each([
    ["artifact byte length", (value) => (value.latest.artifacts[0].bytes += 1)],
    [
      "platform signature",
      (value) =>
        (value.latest.artifacts[0].platformSignature = "codesign+sigstore"),
    ],
    ["minimum updater schema", (value) => (value.minimumUpdaterSchema = 2)],
    ["SBOM digest", (value) => (value.latest.sbom.sha256 = "d".repeat(64))],
    ["SBOM URL", (value) => (value.latest.sbom.url += ".replacement")],
    ["SBOM format", (value) => (value.latest.sbom.format = "spdx-json")],
    ["SBOM lock", (value) => (value.latest.sbom.lockSha256 = "f".repeat(64))],
    [
      "package-manager generator",
      (value) => (value.latest.packageManager.generator += ".replacement"),
    ],
    ["release notes", (value) => (value.latest.releaseNotes += "?changed=1")],
    [
      "publication time",
      (value) => (value.latest.publishedAt = "2026-02-03T04:05:06.000Z"),
    ],
    ["future security field", (value) => (value.latest.securityEpoch = 2)],
  ])("rejects same-version changes to %s", (_label, mutate) => {
    const current = manifest("1.2.3", "1".repeat(40));
    const candidate = structuredClone(current);
    mutate(candidate);
    expect(() => verifyStableChannelPromotion(current, candidate)).toThrow(
      /package-manager generator mismatch|different signed manifest identity/,
    );
  });

  it("rejects prerelease and incomplete manifests", () => {
    expect(() =>
      verifyStableChannelPromotion(null, manifest("1.2.3-rc.1")),
    ).toThrow(/stable x\.y\.z/);
    const incomplete = manifest("1.2.3");
    incomplete.latest.artifacts[0].signature = null;
    expect(() => verifyStableChannelPromotion(null, incomplete)).toThrow(
      /incomplete signed artifact/,
    );
  });

  it("rejects a signing identity selector without an exact lowercase commit", () => {
    expect(() =>
      resolveStableManifestSigningIdentity(manifest("1.2.3", "ABC")),
    ).toThrow(/exact lowercase 40-character commit/);
  });

  it.each([
    ["artifact bytes", (value) => delete value.latest.artifacts[0].bytes],
    [
      "platform signature",
      (value) => delete value.latest.artifacts[0].platformSignature,
    ],
    ["minimum updater schema", (value) => delete value.minimumUpdaterSchema],
    ["SBOM", (value) => delete value.latest.sbom],
    ["SBOM digest", (value) => delete value.latest.sbom.sha256],
    ["SBOM lock digest", (value) => delete value.latest.sbom.lockSha256],
    ["package manager", (value) => delete value.latest.packageManager],
    ["signature envelope", (value) => delete value.signature],
    ["signature algorithm", (value) => delete value.signature.algorithm],
    ["signature key id", (value) => delete value.signature.keyId],
    ["signature value", (value) => delete value.signature.value],
  ])("rejects manifests missing %s", (_label, mutate) => {
    const incomplete = manifest("1.2.3");
    mutate(incomplete);
    expect(() => verifyStableChannelPromotion(null, incomplete)).toThrow(
      /minimumUpdaterSchema|SBOM|signature envelope|incomplete signed artifact|package-manager contract/,
    );
  });

  it("rejects duplicate artifact targets", () => {
    const duplicate = manifest("1.2.3");
    duplicate.latest.artifacts.push({
      ...duplicate.latest.artifacts[0],
      url: `${duplicate.latest.artifacts[0].url}-duplicate`,
    });
    expect(() => verifyStableChannelPromotion(null, duplicate)).toThrow(
      /duplicate artifact targets/,
    );
  });
});
