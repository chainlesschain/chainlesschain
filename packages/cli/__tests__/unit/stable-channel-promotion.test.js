import { describe, expect, it } from "vitest";
import { verifyStableChannelPromotion } from "../../scripts/verify-stable-channel-promotion.mjs";

function manifest(version, commit = `commit-${version}`, sha = "a".repeat(64)) {
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
      sbom: {
        url: `https://example.test/${version}/sbom.cdx.json`,
        sha256: "c".repeat(64),
        format: "cyclonedx-json",
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

  it("rejects a downgrade", () => {
    expect(() =>
      verifyStableChannelPromotion(manifest("2.0.0"), manifest("1.9.9")),
    ).toThrow(/refusing stable channel downgrade/);
  });

  it("permits an exact idempotent replay", () => {
    const value = manifest("1.2.3", "same-commit");
    expect(
      verifyStableChannelPromotion(value, structuredClone(value)),
    ).toMatchObject({ action: "idempotent", version: "1.2.3" });
  });

  it("rejects same-version replacement bytes or commit", () => {
    expect(() =>
      verifyStableChannelPromotion(
        manifest("1.2.3", "commit-a"),
        manifest("1.2.3", "commit-b"),
      ),
    ).toThrow(/different signed manifest identity/);
    expect(() =>
      verifyStableChannelPromotion(
        manifest("1.2.3", "commit-a"),
        manifest("1.2.3", "commit-a", "b".repeat(64)),
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
    ["release notes", (value) => (value.latest.releaseNotes += "?changed=1")],
    [
      "publication time",
      (value) => (value.latest.publishedAt = "2026-02-03T04:05:06.000Z"),
    ],
    ["future security field", (value) => (value.latest.securityEpoch = 2)],
  ])("rejects same-version changes to %s", (_label, mutate) => {
    const current = manifest("1.2.3", "same-commit");
    const candidate = structuredClone(current);
    mutate(candidate);
    expect(() => verifyStableChannelPromotion(current, candidate)).toThrow(
      /different signed manifest identity/,
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

  it.each([
    ["artifact bytes", (value) => delete value.latest.artifacts[0].bytes],
    [
      "platform signature",
      (value) => delete value.latest.artifacts[0].platformSignature,
    ],
    ["minimum updater schema", (value) => delete value.minimumUpdaterSchema],
    ["SBOM", (value) => delete value.latest.sbom],
    ["SBOM digest", (value) => delete value.latest.sbom.sha256],
    ["signature envelope", (value) => delete value.signature],
    ["signature algorithm", (value) => delete value.signature.algorithm],
    ["signature key id", (value) => delete value.signature.keyId],
    ["signature value", (value) => delete value.signature.value],
  ])("rejects manifests missing %s", (_label, mutate) => {
    const incomplete = manifest("1.2.3");
    mutate(incomplete);
    expect(() => verifyStableChannelPromotion(null, incomplete)).toThrow(
      /minimumUpdaterSchema|SBOM|signature envelope|incomplete signed artifact/,
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
