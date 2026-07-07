import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadManagedSettings } from "./settings-loader.cjs";

function stringSet(value) {
  return Array.isArray(value)
    ? new Set(
        value
          .map((v) =>
            typeof v === "string" ? v : v?.name || v?.source || v?.url || null,
          )
          .map((v) => String(v || "").trim())
          .filter(Boolean),
      )
    : null;
}

export function enforcePluginPolicy(
  { name, source = null, action = "install" },
  managed,
) {
  if (!managed) return { allowed: true };
  const denied = stringSet(managed.deniedPlugins) || new Set();
  const allowed = stringSet(managed.allowedPlugins);
  if (denied.has(name)) {
    throw new Error(`plugin "${name}" is denied by managed settings`);
  }
  if (allowed && !allowed.has(name)) {
    throw new Error(`plugin "${name}" is not in the managed allowlist`);
  }

  const blockedSources = new Set([
    ...(stringSet(managed.blockedPluginSources) || []),
    ...(stringSet(managed.blockedMarketplaces) || []),
  ]);
  const allowedSources = stringSet(managed.allowedPluginSources);
  if (source && blockedSources.has(source)) {
    throw new Error(`plugin source "${source}" is blocked by managed settings`);
  }
  if (action === "install" && allowedSources) {
    if (!source) {
      throw new Error(
        "managed settings require --source for plugin installation",
      );
    }
    if (!allowedSources.has(source)) {
      throw new Error(
        `plugin source "${source}" is not in the managed allowlist`,
      );
    }
  }
  return { allowed: true };
}

export function verifyPluginManifest({
  manifestFile,
  expectedSha256,
  signatureFile,
  publicKeyFile,
  requireSignature = false,
  trustedKeySha256 = null,
  requireTrustedKey = false,
}) {
  if (!manifestFile) {
    if (requireSignature) {
      throw new Error("managed settings require a signed plugin manifest");
    }
    return null;
  }
  const bytes = readFileSync(manifestFile);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    expectedSha256 &&
    sha256.toLowerCase() !== String(expectedSha256).toLowerCase()
  ) {
    throw new Error(
      `plugin manifest SHA-256 mismatch (expected ${expectedSha256}, got ${sha256})`,
    );
  }

  const wantsSignature = requireSignature || signatureFile || publicKeyFile;
  let signatureVerified = false;
  let signature = null;
  let publicKeyPem = null;
  let publicKeySha256 = null;
  if (wantsSignature) {
    if (!signatureFile || !publicKeyFile) {
      throw new Error(
        "plugin signature verification requires --signature and --public-key",
      );
    }
    signature = readFileSync(signatureFile);
    publicKeyPem = readFileSync(publicKeyFile, "utf8");
    const keyObject = createPublicKey(publicKeyPem);
    publicKeySha256 = createHash("sha256")
      .update(keyObject.export({ type: "spki", format: "der" }))
      .digest("hex");
    const trusted = stringSet(trustedKeySha256);
    if (requireTrustedKey && (!trusted || trusted.size === 0)) {
      throw new Error(
        "managed settings require trustedPluginKeySha256 fingerprints",
      );
    }
    if (trusted && !trusted.has(publicKeySha256)) {
      throw new Error(`plugin signing key is not trusted (${publicKeySha256})`);
    }
    signatureVerified = verify(null, bytes, keyObject, signature);
    if (!signatureVerified) {
      throw new Error("plugin manifest signature verification failed");
    }
  }
  return {
    bytes,
    sha256,
    signatureVerified,
    publicKeySha256: signatureVerified ? publicKeySha256 : null,
    // The raw signature material, so the installer can persist it and load-time
    // enforcement can CRYPTOGRAPHICALLY re-verify (not merely trust a recorded
    // boolean, which a hand-written lock file could forge).
    signatureBase64: signatureVerified ? signature.toString("base64") : null,
    publicKeyPem: signatureVerified ? publicKeyPem : null,
  };
}

export function loadPluginManagedPolicy(options = {}) {
  return loadManagedSettings(options).settings;
}
