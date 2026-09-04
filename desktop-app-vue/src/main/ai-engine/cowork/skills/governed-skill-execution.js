"use strict";

const crypto = require("node:crypto");
const {
  digestEvolvableArtifactValue,
} = require("@chainlesschain/session-core/evolvable-artifact");
const {
  MANIFEST_SCHEMA,
  canonicalJson,
  normalizeCapabilities,
} = require("./skill-execution-security");

const authorityBrands = new WeakSet();
const handlerSources = new WeakMap();
const LOCK_KEYS = new Set([
  "lockVersion",
  "algorithm",
  "manifest",
  "signatureBase64",
  "publicKeyPem",
]);
const MANIFEST_KEYS = new Set([
  "schema",
  "skillId",
  "version",
  "handler",
  "executionCapabilities",
  "files",
]);
const MAX_HANDLER_BYTES = 1024 * 1024;
const MAX_LOCK_BYTES = 64 * 1024;

function exactKeys(value, keys) {
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

function rawSha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function createGovernedSkillExecutionAuthority({
  definition,
  packageContent,
  artifact,
}) {
  const handlerSource = packageContent?.handler;
  const signatureLock = packageContent?.signatureLock;
  const capabilities = normalizeCapabilities(definition?.executionCapabilities);
  if (
    definition?.handler !== "./handler.js" ||
    typeof handlerSource !== "string" ||
    handlerSource.length === 0 ||
    Buffer.byteLength(handlerSource, "utf8") > MAX_HANDLER_BYTES ||
    Buffer.byteLength(JSON.stringify(signatureLock || null), "utf8") >
      MAX_LOCK_BYTES ||
    !capabilities.valid ||
    !exactKeys(signatureLock, LOCK_KEYS) ||
    signatureLock.lockVersion !== 1 ||
    signatureLock.algorithm !== "ed25519" ||
    !exactKeys(signatureLock.manifest, MANIFEST_KEYS)
  ) {
    throw new Error("Governed Skill executable package is invalid");
  }

  const expectedManifest = {
    schema: MANIFEST_SCHEMA,
    skillId: definition.name,
    version: definition.version,
    handler: "handler.js",
    executionCapabilities: capabilities.capabilities,
    files: [
      {
        path: "SKILL.md",
        bytes: Buffer.byteLength(packageContent.body, "utf8"),
        sha256: rawSha256(packageContent.body),
      },
      {
        path: "handler.js",
        bytes: Buffer.byteLength(handlerSource, "utf8"),
        sha256: rawSha256(handlerSource),
      },
    ],
  };
  if (
    canonicalJson(signatureLock.manifest) !== canonicalJson(expectedManifest)
  ) {
    throw new Error(
      "Governed Skill signature lock does not bind package bytes",
    );
  }

  let publicKey;
  let signature;
  try {
    publicKey = crypto.createPublicKey(signatureLock.publicKeyPem);
    signature = Buffer.from(signatureLock.signatureBase64, "base64");
  } catch {
    throw new Error("Governed Skill signature lock is invalid");
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
    throw new Error("Governed Skill signature verification failed");
  }

  const runtime = artifact?.runtimeManifest;
  const permission = artifact?.permissionManifest;
  if (
    runtime?.executable !== true ||
    runtime.handlerDigest !== digestEvolvableArtifactValue(handlerSource) ||
    runtime.signatureLockDigest !==
      digestEvolvableArtifactValue(signatureLock) ||
    canonicalJson(permission?.capabilities) !==
      canonicalJson(capabilities.capabilities)
  ) {
    throw new Error("Governed Skill runtime manifest does not bind executable");
  }

  const publicKeySha256 = crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const authority = Object.freeze({
    mode: "governed-content-addressed",
    executable: true,
    packageOwned: false,
    signed: true,
    trusted: true,
    capabilityManifestValid: true,
    handlerRelativePath: "handler.js",
    contentDigest: artifact.contentDigest,
    executorContentDigest: artifact.contentDigest.slice("sha256:".length),
    publicKeySha256,
    executionCapabilities: Object.freeze([...capabilities.capabilities]),
  });
  authorityBrands.add(authority);
  handlerSources.set(authority, handlerSource);
  return authority;
}

function isGovernedSkillExecutionAuthority(value) {
  return authorityBrands.has(value);
}

function captureGovernedSkillHandlerSource(authority) {
  if (!authorityBrands.has(authority)) {
    throw new TypeError("a governed Skill execution authority is required");
  }
  return handlerSources.get(authority);
}

module.exports = {
  createGovernedSkillExecutionAuthority,
  isGovernedSkillExecutionAuthority,
  captureGovernedSkillHandlerSource,
};
