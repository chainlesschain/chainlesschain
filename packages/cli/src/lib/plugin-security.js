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
  expectedSignatureSha256 = null,
  expectedPublicKeyDocumentSha256 = null,
  expectedPublicKeySha256 = null,
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

  const wantsSignature =
    requireSignature ||
    signatureFile ||
    publicKeyFile ||
    expectedSignatureSha256 ||
    expectedPublicKeyDocumentSha256 ||
    expectedPublicKeySha256;
  let signatureVerified = false;
  let signature = null;
  let publicKeyPem = null;
  let publicKeySha256 = null;
  let signatureSha256 = null;
  let publicKeyDocumentSha256 = null;
  if (wantsSignature) {
    if (!signatureFile || !publicKeyFile) {
      throw new Error(
        "plugin signature verification requires --signature and --public-key",
      );
    }
    signature = readFileSync(signatureFile);
    const publicKeyDocument = readFileSync(publicKeyFile);
    signatureSha256 = createHash("sha256").update(signature).digest("hex");
    publicKeyDocumentSha256 = createHash("sha256")
      .update(publicKeyDocument)
      .digest("hex");
    assertExpectedDigest(
      signatureSha256,
      expectedSignatureSha256,
      "plugin detached signature",
    );
    assertExpectedDigest(
      publicKeyDocumentSha256,
      expectedPublicKeyDocumentSha256,
      "plugin public-key document",
    );
    const publicKeyDocumentText = publicKeyDocument.toString("utf8");
    const publicKeyContainer = publicKeyDocumentText.trim();
    if (
      !/^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PUBLIC KEY-----$/.test(
        publicKeyContainer,
      )
    ) {
      throw new Error(
        "plugin public-key document must be a PEM SPKI PUBLIC KEY container",
      );
    }
    const keyObject = createPublicKey(publicKeyContainer);
    publicKeySha256 = createHash("sha256")
      .update(keyObject.export({ type: "spki", format: "der" }))
      .digest("hex");
    assertExpectedDigest(
      publicKeySha256,
      expectedPublicKeySha256,
      "plugin public-key SPKI",
    );
    publicKeyPem = publicKeyDocumentText;
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
    signatureSha256: signatureVerified ? signatureSha256 : null,
    publicKeyDocumentSha256: signatureVerified ? publicKeyDocumentSha256 : null,
    // The raw signature material, so the installer can persist it and load-time
    // enforcement can CRYPTOGRAPHICALLY re-verify (not merely trust a recorded
    // boolean, which a hand-written lock file could forge).
    signatureBase64: signatureVerified ? signature.toString("base64") : null,
    publicKeyPem: signatureVerified ? publicKeyPem : null,
  };
}

function assertExpectedDigest(actual, expected, label) {
  if (expected == null || String(expected).trim() === "") return;
  const normalized = String(expected).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} expected SHA-256 is invalid`);
  }
  if (actual !== normalized) {
    throw new Error(
      `${label} SHA-256 mismatch (expected ${normalized}, got ${actual})`,
    );
  }
}

export function loadPluginManagedPolicy(options = {}) {
  return loadManagedSettings(options).settings;
}
