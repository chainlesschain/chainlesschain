import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signPackUpdateManifest,
  verifyPackUpdateManifest,
} from "../../src/lib/packer/pack-update-signature.js";

function fixture() {
  return {
    schema: 1,
    channel: "stable",
    latest: {
      cliVersion: "1.2.3",
      artifacts: [
        {
          target: "node20-linux-x64",
          url: "https://example.test/cc",
          sha256: "a".repeat(64),
          signature: "https://example.test/cc.sigstore.json",
        },
      ],
    },
  };
}

describe("signed pack update manifest", () => {
  it("verifies a trusted Ed25519 signature independent of object key order", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const signed = signPackUpdateManifest(fixture(), privateKey);
    expect(signed.signature).toMatchObject({ algorithm: "ed25519" });
    expect(verifyPackUpdateManifest(signed, publicKey)).toBe(true);
    const reordered = {
      latest: signed.latest,
      schema: 1,
      channel: "stable",
      signature: signed.signature,
    };
    expect(verifyPackUpdateManifest(reordered, publicKey)).toBe(true);
  });

  it("rejects tampering and a different trusted key", () => {
    const pair = crypto.generateKeyPairSync("ed25519");
    const other = crypto.generateKeyPairSync("ed25519");
    const signed = signPackUpdateManifest(fixture(), pair.privateKey);
    expect(() =>
      verifyPackUpdateManifest(
        { ...signed, latest: { ...signed.latest, cliVersion: "9.9.9" } },
        pair.publicKey,
      ),
    ).toThrow(/verification failed/);
    expect(() => verifyPackUpdateManifest(signed, other.publicKey)).toThrow(
      /key mismatch/,
    );
    const artifact = signed.latest.artifacts[0];
    expect(() =>
      verifyPackUpdateManifest(
        {
          ...signed,
          latest: {
            ...signed.latest,
            artifacts: [
              {
                ...artifact,
                signature: "https://attacker.test/forged.sigstore.json",
              },
            ],
          },
        },
        pair.publicKey,
      ),
    ).toThrow(/verification failed/);
  });
});
