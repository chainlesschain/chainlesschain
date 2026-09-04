"use strict";

const crypto = require("node:crypto");
const {
  digestEvolvableArtifactValue,
} = require("@chainlesschain/session-core/evolvable-artifact");
const {
  canonicalJson,
  normalizeCapabilities,
} = require("../ai-engine/cowork/skills/skill-execution-security");

const HOOK_EXECUTABLE_FORMAT = "chainlesschain-hook-executable/v1";
const HOOK_EXECUTION_MANIFEST_SCHEMA =
  "chainlesschain.hook-execution-manifest/v1";
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_LOCK_BYTES = 64 * 1024;
const executableBrands = new WeakSet();
const executableSources = new WeakMap();
const SCRIPT_KEYS = new Set(["format", "fileName", "source", "signatureLock"]);
const LOCK_KEYS = new Set([
  "lockVersion",
  "algorithm",
  "manifest",
  "signatureBase64",
  "publicKeyPem",
]);
const MANIFEST_KEYS = new Set([
  "schema",
  "hookId",
  "event",
  "runtime",
  "fileName",
  "sourceBytes",
  "sourceSha256",
  "capabilities",
  "sbomDigest",
  "sandboxDigest",
  "networkEgressPolicyDigest",
]);

function exactObject(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.size &&
    Reflect.ownKeys(value).every(
      (key) => typeof key === "string" && keys.has(key),
    )
  );
}

function digest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function createGovernedHookExecutionAuthority({
  hookId,
  event,
  script,
  runtimeManifest,
  permissionManifest,
}) {
  const signatureLock = script?.signatureLock;
  const source = script?.source;
  const capabilities = normalizeCapabilities(permissionManifest?.capabilities);
  if (
    typeof hookId !== "string" ||
    hookId.length === 0 ||
    typeof event !== "string" ||
    event.length === 0 ||
    !exactObject(script, SCRIPT_KEYS) ||
    script.format !== HOOK_EXECUTABLE_FORMAT ||
    script.fileName !== "hook.js" ||
    typeof source !== "string" ||
    source.length === 0 ||
    Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES ||
    Buffer.byteLength(JSON.stringify(signatureLock || null), "utf8") >
      MAX_LOCK_BYTES ||
    !capabilities.valid ||
    !exactObject(signatureLock, LOCK_KEYS) ||
    signatureLock.lockVersion !== 1 ||
    signatureLock.algorithm !== "ed25519" ||
    !exactObject(signatureLock.manifest, MANIFEST_KEYS)
  ) {
    throw new Error("Governed Hook executable package is invalid");
  }
  if (
    runtimeManifest?.executable !== true ||
    runtimeManifest.codeSignatureDigest !==
      digestEvolvableArtifactValue(signatureLock)
  ) {
    throw new Error("Governed Hook runtime manifest does not bind signature");
  }

  const expectedManifest = {
    schema: HOOK_EXECUTION_MANIFEST_SCHEMA,
    hookId,
    event,
    runtime: "node-isolated",
    fileName: "hook.js",
    sourceBytes: Buffer.byteLength(source, "utf8"),
    sourceSha256: digest(source),
    capabilities: capabilities.capabilities,
    sbomDigest: runtimeManifest.sbomDigest,
    sandboxDigest: runtimeManifest.sandboxDigest,
    networkEgressPolicyDigest: runtimeManifest.networkEgressPolicyDigest,
  };
  if (
    canonicalJson(signatureLock.manifest) !== canonicalJson(expectedManifest)
  ) {
    throw new Error("Governed Hook signature lock does not bind executable");
  }

  let publicKey;
  let signature;
  try {
    publicKey = crypto.createPublicKey(signatureLock.publicKeyPem);
    signature = Buffer.from(signatureLock.signatureBase64, "base64");
  } catch {
    throw new Error("Governed Hook signature lock is invalid");
  }
  if (
    publicKey.asymmetricKeyType !== "ed25519" ||
    signature.length !== 64 ||
    !crypto.verify(
      null,
      Buffer.from(canonicalJson(expectedManifest), "utf8"),
      publicKey,
      signature,
    )
  ) {
    throw new Error("Governed Hook signature verification failed");
  }

  const authority = Object.freeze({
    mode: "governed-content-addressed",
    hookId,
    event,
    fileName: "hook.js",
    sourceSha256: expectedManifest.sourceSha256,
    publicKeySha256: crypto
      .createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
    capabilities: Object.freeze([...capabilities.capabilities]),
  });
  executableBrands.add(authority);
  executableSources.set(authority, source);
  return authority;
}

function captureGovernedHookSource(authority) {
  if (!executableBrands.has(authority)) {
    throw new TypeError("a governed Hook execution authority is required");
  }
  return executableSources.get(authority);
}

module.exports = {
  HOOK_EXECUTABLE_FORMAT,
  HOOK_EXECUTION_MANIFEST_SCHEMA,
  createGovernedHookExecutionAuthority,
  captureGovernedHookSource,
};
