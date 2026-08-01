import crypto from "node:crypto";

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortValue(value[key]);
  }
  return out;
}

export function canonicalPackManifestBytes(manifest) {
  // Only the envelope's signature is excluded. Artifact-level `signature`
  // fields (Sigstore bundle URLs) are part of the signed update contract and
  // must not be removable or redirected without invalidating the manifest.
  const unsigned = { ...(manifest || {}) };
  delete unsigned.signature;
  return Buffer.from(JSON.stringify(sortValue(unsigned)), "utf8");
}

export function packUpdateKeyId(publicKey) {
  const key =
    publicKey?.type === "public"
      ? publicKey
      : crypto.createPublicKey(publicKey);
  const der = key.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
}

export function signPackUpdateManifest(manifest, privateKey) {
  const privateObject =
    privateKey?.type === "private"
      ? privateKey
      : crypto.createPrivateKey(privateKey);
  if (privateObject.asymmetricKeyType !== "ed25519") {
    throw new Error("pack update signing key must be Ed25519");
  }
  const publicObject = crypto.createPublicKey(privateObject);
  const value = crypto
    .sign(null, canonicalPackManifestBytes(manifest), privateObject)
    .toString("base64");
  return {
    ...manifest,
    signature: {
      algorithm: "ed25519",
      keyId: packUpdateKeyId(publicObject),
      value,
    },
  };
}

export function verifyPackUpdateManifest(manifest, publicKey) {
  if (!manifest?.signature) {
    throw new Error("pack update manifest is unsigned");
  }
  if (manifest.signature.algorithm !== "ed25519") {
    throw new Error(
      `unsupported pack update signature: ${manifest.signature.algorithm}`,
    );
  }
  const key =
    publicKey?.type === "public"
      ? publicKey
      : crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("trusted pack update key must be Ed25519");
  }
  const expectedKeyId = packUpdateKeyId(key);
  if (manifest.signature.keyId !== expectedKeyId) {
    throw new Error(
      `pack update signing key mismatch: expected ${expectedKeyId}, got ${manifest.signature.keyId}`,
    );
  }
  const signature = Buffer.from(
    String(manifest.signature.value || ""),
    "base64",
  );
  if (
    signature.length !== 64 ||
    !crypto.verify(null, canonicalPackManifestBytes(manifest), key, signature)
  ) {
    throw new Error("pack update manifest signature verification failed");
  }
  return true;
}
