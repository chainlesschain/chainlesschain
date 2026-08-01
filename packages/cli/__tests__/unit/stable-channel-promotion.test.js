import { describe, expect, it } from "vitest";
import { verifyStableChannelPromotion } from "../../scripts/verify-stable-channel-promotion.mjs";

function manifest(version, commit = `commit-${version}`, sha = "a".repeat(64)) {
  return {
    schema: 1,
    channel: "stable",
    latest: {
      cliVersion: version,
      commit,
      artifacts: [
        {
          target: "node20-linux-x64",
          url: `https://example.test/${version}/chainlesschain`,
          sha256: sha,
          signature: `https://example.test/${version}/chainlesschain.sigstore.json`,
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
    ).toThrow(/different release bytes/);
    expect(() =>
      verifyStableChannelPromotion(
        manifest("1.2.3", "commit-a"),
        manifest("1.2.3", "commit-a", "b".repeat(64)),
      ),
    ).toThrow(/different release bytes/);
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
});
