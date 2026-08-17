import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildManagedPublisherAuthority,
  normalizePublisherAuthority,
  verifyInstalledManagedPublisherAuthority,
} from "../../src/lib/plugin-runtime/publisher-trust.js";
import { writePluginLock } from "../../src/lib/plugin-runtime/signature.js";

let root;
let keys;
let fingerprint;
let managed;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-publisher-trust-"));
  keys = crypto.generateKeyPairSync("ed25519");
  fingerprint = crypto
    .createHash("sha256")
    .update(keys.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  managed = {
    requireTrustedPluginPublishers: true,
    trustedPluginPublishers: [
      {
        trustRootId: "org-root-2026",
        publisherId: "publisher-one",
        organizationId: "org-one",
        pluginNames: ["trusted-plugin"],
        registryOrigins: ["https://registry.example"],
        signingKeySha256: [fingerprint],
        notBefore: "2026-01-01T00:00:00.000Z",
        notAfter: "2027-01-01T00:00:00.000Z",
      },
    ],
    revokedPluginPublisherKeys: [],
  };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function buildAuthority(policy = managed) {
  return buildManagedPublisherAuthority({
    name: "trusted-plugin",
    registryUrl: "https://registry.example/plugins.json",
    declaration: { id: "publisher-one", organizationId: "org-one" },
    signingKeySha256: fingerprint,
    managed: policy,
    verifiedAt: "2026-08-18T00:00:00.000Z",
  });
}

function writeInstalled(authority) {
  const manifest = path.join(root, "plugin.json");
  const bytes = Buffer.from(
    JSON.stringify({ name: "trusted-plugin", version: "1.0.0" }),
    "utf8",
  );
  fs.writeFileSync(manifest, bytes);
  const signature = crypto.sign(null, bytes, keys.privateKey);
  writePluginLock(root, {
    manifestFile: manifest,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    publicKeySha256: fingerprint,
    signatureVerified: true,
    signatureBase64: signature.toString("base64"),
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }),
  });
  fs.writeFileSync(
    path.join(root, ".plugin-source.json"),
    JSON.stringify({
      version: 1,
      type: "registry",
      source: "https://registry.example/plugins.json",
      registry: "https://registry.example/plugins.json",
      catalogAuthority: {
        publisherDeclaration: {
          id: "publisher-one",
          organizationId: "org-one",
        },
        publisherAuthority: authority,
      },
    }),
    "utf8",
  );
}

describe("managed plugin publisher identity", () => {
  it("binds publisher, organization, plugin, registry origin and signing key", () => {
    const authority = buildAuthority();
    expect(authority).toMatchObject({
      status: "verified",
      publisher: { id: "publisher-one", organizationId: "org-one" },
      subject: {
        name: "trusted-plugin",
        registryOrigin: "https://registry.example",
        signingKeySha256: fingerprint,
      },
      claims: {
        publisherIdentityVerified: true,
        organizationTrustRootMatched: true,
        signingKeyNotRevoked: true,
        manifestSignatureVerified: true,
      },
    });
    expect(normalizePublisherAuthority(authority)).toEqual(authority);
  });

  it("rejects mismatched identity, expired roots, and revoked keys", () => {
    expect(() =>
      buildManagedPublisherAuthority({
        name: "other-plugin",
        registryUrl: "https://registry.example",
        declaration: { id: "publisher-one", organizationId: "org-one" },
        signingKeySha256: fingerprint,
        managed,
        verifiedAt: "2026-08-18T00:00:00.000Z",
      }),
    ).toThrow(/TRUST_MISMATCH/u);
    expect(() =>
      buildManagedPublisherAuthority({
        name: "trusted-plugin",
        registryUrl: "https://registry.example",
        declaration: { id: "publisher-one", organizationId: "org-one" },
        signingKeySha256: fingerprint,
        managed,
        verifiedAt: "2028-08-18T00:00:00.000Z",
      }),
    ).toThrow(/TRUST_MISMATCH/u);
    expect(() =>
      buildAuthority({
        ...managed,
        revokedPluginPublisherKeys: [
          { sha256: fingerprint, revokedAt: "2026-08-17T00:00:00.000Z" },
        ],
      }),
    ).toThrow(/KEY_REVOKED/u);
  });

  it("re-verifies installed manifest bytes and current revocation policy", () => {
    const authority = buildAuthority();
    writeInstalled(authority);
    expect(
      verifyInstalledManagedPublisherAuthority(
        { root, name: "trusted-plugin" },
        managed,
      ),
    ).toMatchObject({ verified: true, present: true });

    expect(
      verifyInstalledManagedPublisherAuthority(
        { root, name: "trusted-plugin" },
        { ...managed, revokedPluginPublisherKeys: [fingerprint] },
      ),
    ).toMatchObject({
      verified: false,
      present: true,
      reason: expect.stringMatching(/KEY_REVOKED/u),
    });
  });
});
