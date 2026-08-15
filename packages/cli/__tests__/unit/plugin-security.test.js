import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enforcePluginPolicy,
  verifyPluginManifest,
} from "../../src/lib/plugin-security.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-plugin-security-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("managed plugin policy", () => {
  it("denies blocked plugins before installation", () => {
    expect(() =>
      enforcePluginPolicy(
        { name: "evil", source: "official", action: "install" },
        { deniedPlugins: ["evil"] },
      ),
    ).toThrow(/denied by managed settings/);
  });

  it("requires both an allowed plugin and source when allowlists exist", () => {
    const policy = {
      allowedPlugins: ["review"],
      allowedPluginSources: ["company"],
    };
    expect(() =>
      enforcePluginPolicy({ name: "review", action: "install" }, policy),
    ).toThrow(/require --source/);
    expect(() =>
      enforcePluginPolicy(
        { name: "review", source: "public", action: "install" },
        policy,
      ),
    ).toThrow(/source.*not in/);
    expect(
      enforcePluginPolicy(
        { name: "review", source: "company", action: "install" },
        policy,
      ).allowed,
    ).toBe(true);
  });

  it("treats blocked marketplaces as blocked sources", () => {
    expect(() =>
      enforcePluginPolicy(
        { name: "x", source: "public", action: "install" },
        { blockedMarketplaces: ["public"] },
      ),
    ).toThrow(/source.*blocked/);
  });
});

describe("plugin manifest integrity", () => {
  it("verifies SHA-256 and rejects a mismatch", () => {
    const manifest = join(dir, "plugin.json");
    writeFileSync(manifest, '{"name":"review"}');
    const result = verifyPluginManifest({ manifestFile: manifest });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        expectedSha256: "0".repeat(64),
      }),
    ).toThrow(/SHA-256 mismatch/);
  });

  it("verifies a detached Ed25519 signature", () => {
    const manifest = join(dir, "plugin.json");
    const signatureFile = join(dir, "plugin.sig");
    const publicKeyFile = join(dir, "plugin.pub.pem");
    const bytes = Buffer.from('{"name":"signed"}');
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(manifest, bytes);
    writeFileSync(signatureFile, sign(null, bytes, privateKey));
    writeFileSync(
      publicKeyFile,
      publicKey.export({ type: "spki", format: "pem" }),
    );
    const result = verifyPluginManifest({
      manifestFile: manifest,
      signatureFile,
      publicKeyFile,
      requireSignature: true,
    });
    expect(result.signatureVerified).toBe(true);
  });

  it("binds the exact signature document and public-key bytes before verification", () => {
    const manifest = join(dir, "plugin.json");
    const signatureFile = join(dir, "plugin.sig");
    const publicKeyFile = join(dir, "plugin.pub.pem");
    const bytes = Buffer.from('{"name":"remote-signed"}');
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    const signature = sign(null, bytes, first.privateKey);
    const publicKeyDocument = Buffer.from(
      first.publicKey.export({ type: "spki", format: "pem" }),
    );
    const signatureSha256 = sha256(signature);
    const publicKeyDocumentSha256 = sha256(publicKeyDocument);
    const publicKeySha256 = sha256(
      first.publicKey.export({ type: "spki", format: "der" }),
    );
    writeFileSync(manifest, bytes);
    writeFileSync(signatureFile, signature);
    writeFileSync(publicKeyFile, publicKeyDocument);

    expect(
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        expectedSignatureSha256: signatureSha256,
        expectedPublicKeyDocumentSha256: publicKeyDocumentSha256,
        expectedPublicKeySha256: publicKeySha256,
        requireSignature: true,
      }),
    ).toMatchObject({
      signatureVerified: true,
      signatureSha256,
      publicKeyDocumentSha256,
      publicKeySha256,
    });

    writeFileSync(signatureFile, sign(null, bytes, second.privateKey));
    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        expectedSignatureSha256: signatureSha256,
        expectedPublicKeyDocumentSha256: publicKeyDocumentSha256,
        expectedPublicKeySha256: publicKeySha256,
      }),
    ).toThrow(/detached signature SHA-256 mismatch/);

    writeFileSync(signatureFile, signature);
    writeFileSync(
      publicKeyFile,
      second.publicKey.export({ type: "spki", format: "pem" }),
    );
    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        expectedSignatureSha256: signatureSha256,
        expectedPublicKeyDocumentSha256: publicKeyDocumentSha256,
        expectedPublicKeySha256: publicKeySha256,
      }),
    ).toThrow(/public-key document SHA-256 mismatch/);
  });

  it("rejects a private-key container passed as a public key", () => {
    const manifest = join(dir, "plugin.json");
    const signatureFile = join(dir, "plugin.sig");
    const publicKeyFile = join(dir, "plugin.pub.pem");
    const bytes = Buffer.from('{"name":"no-private-key-persistence"}');
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(manifest, bytes);
    writeFileSync(signatureFile, sign(null, bytes, privateKey));
    writeFileSync(
      publicKeyFile,
      privateKey.export({ type: "pkcs8", format: "pem" }),
    );

    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        requireSignature: true,
      }),
    ).toThrow(/PEM SPKI PUBLIC KEY container/);
  });

  it("fails closed when managed policy requires a signature", () => {
    expect(() => verifyPluginManifest({ requireSignature: true })).toThrow(
      /require a signed plugin manifest/,
    );
  });

  it("rejects a valid signature from an untrusted key", () => {
    const manifest = join(dir, "plugin.json");
    const signatureFile = join(dir, "plugin.sig");
    const publicKeyFile = join(dir, "plugin.pub.pem");
    const bytes = Buffer.from('{"name":"self-signed"}');
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(manifest, bytes);
    writeFileSync(signatureFile, sign(null, bytes, privateKey));
    writeFileSync(
      publicKeyFile,
      publicKey.export({ type: "spki", format: "pem" }),
    );
    expect(() =>
      verifyPluginManifest({
        manifestFile: manifest,
        signatureFile,
        publicKeyFile,
        requireSignature: true,
        requireTrustedKey: true,
        trustedKeySha256: ["0".repeat(64)],
      }),
    ).toThrow(/signing key is not trusted/);
  });
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
