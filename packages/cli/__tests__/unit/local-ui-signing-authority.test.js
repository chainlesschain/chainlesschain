import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLocalUiSigningAuthority } from "../../src/lib/evolution/local-ui-signing-authority.js";

function privateKey() {
  return generateKeyPairSync("ed25519").privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
}

describe("immutable local UI signing authority", () => {
  it("authenticates original messages and rejects content, key, and trust substitution", () => {
    const key = privateKey();
    const authority = createLocalUiSigningAuthority(
      "witness",
      "tenant-test",
      key,
    );
    const message = Buffer.from("authenticated checkpoint");
    const signature = authority.signer.sign({ message });
    expect(authority.verifier.verify({ message, signature })).toBe(true);
    expect(
      authority.verifier.verify({ message: Buffer.from("changed"), signature }),
    ).toBe(false);
    expect(
      createLocalUiSigningAuthority(
        "witness",
        "tenant-test",
        privateKey(),
      ).verifier.verify({ message, signature }),
    ).toBe(false);
    expect(
      authority.verifier.verify({
        message,
        signature: { ...signature, keyId: "local://other/witness" },
      }),
    ).toBe(false);
    expect(
      authority.verifier.verify({
        message,
        signature: {
          ...signature,
          trustPolicyDigest: `sha256:${"0".repeat(64)}`,
        },
      }),
    ).toBe(false);
  });

  it("binds the verifier epoch to the complete fixed public key and trust policy", () => {
    const key = privateKey();
    const create = (
      label = "witness",
      tenant = "tenant-test",
      selectedKey = key,
    ) => createLocalUiSigningAuthority(label, tenant, selectedKey);
    const first = create();
    const epoch = first.verifier.getTrustEpoch();
    expect(epoch).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.verifier.getTrustEpoch()).toBe(epoch);
    expect(create().verifier.getTrustEpoch()).toBe(epoch);
    expect(create("ledger").verifier.getTrustEpoch()).not.toBe(epoch);
    expect(create("witness", "tenant-other").verifier.getTrustEpoch()).not.toBe(
      epoch,
    );
    expect(
      create("witness", "tenant-test", privateKey()).verifier.getTrustEpoch(),
    ).not.toBe(epoch);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.trust)).toBe(true);
    expect(Object.isFrozen(first.verifier)).toBe(true);
    expect(() => {
      first.verifier.getTrustEpoch = () => "forged";
    }).toThrow(TypeError);
    expect(() => {
      first.trust.keyId = "forged";
    }).toThrow(TypeError);
  });
});
