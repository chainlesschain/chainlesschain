import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
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
