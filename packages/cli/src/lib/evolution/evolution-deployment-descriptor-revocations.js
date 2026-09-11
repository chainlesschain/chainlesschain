import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const EVOLUTION_DEPLOYMENT_DESCRIPTOR_REVOCATIONS_SCHEMA =
  "chainlesschain.evolution-deployment-descriptor-revocations/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_BYTES = 64 * 1024;
const MAX_REVOKED_REVISIONS = 1024;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalize(value) {
  const expected = [
    "revision",
    "revokedDescriptorRevisions",
    "schema",
    "signature",
    "trustRootDigest",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("evolution deployment revocations must be an object");
  if (canonical(Object.keys(value).sort()) !== canonical(expected))
    throw new TypeError("evolution deployment revocations fields are invalid");
  if (value.schema !== EVOLUTION_DEPLOYMENT_DESCRIPTOR_REVOCATIONS_SCHEMA)
    throw new TypeError("evolution deployment revocations schema is invalid");
  if (!DIGEST.test(value.trustRootDigest || ""))
    throw new TypeError("evolution deployment revocations trust root is invalid");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new TypeError("evolution deployment revocations revision is invalid");
  if (
    !Array.isArray(value.revokedDescriptorRevisions) ||
    value.revokedDescriptorRevisions.length > MAX_REVOKED_REVISIONS ||
    value.revokedDescriptorRevisions.some(
      (revision) => !Number.isSafeInteger(revision) || revision < 1,
    ) ||
    new Set(value.revokedDescriptorRevisions).size !==
      value.revokedDescriptorRevisions.length
  ) {
    throw new TypeError("evolution deployment revoked revisions are invalid");
  }
  if (
    typeof value.signature !== "string" ||
    value.signature.length === 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signature)
  ) {
    throw new TypeError("evolution deployment revocations signature is invalid");
  }
  return Object.freeze({
    ...value,
    revokedDescriptorRevisions: Object.freeze(
      [...value.revokedDescriptorRevisions].sort((left, right) => left - right),
    ),
  });
}

export function serializeEvolutionDeploymentDescriptorRevocationsPayload(value) {
  const revocations = normalize({ ...value, signature: "AA==" });
  return canonical({
    schema: revocations.schema,
    revision: revocations.revision,
    trustRootDigest: revocations.trustRootDigest,
    revokedDescriptorRevisions: revocations.revokedDescriptorRevisions,
  });
}

export function verifyEvolutionDeploymentDescriptorRevocationsSync({
  revocationPath,
  trustRootPath,
  expectedTrustRootDigest,
}) {
  if (
    typeof revocationPath !== "string" ||
    !isAbsolute(revocationPath) ||
    typeof trustRootPath !== "string" ||
    !isAbsolute(trustRootPath) ||
    !DIGEST.test(expectedTrustRootDigest || "")
  ) {
    throw new Error("evolution deployment revocation inputs are invalid");
  }
  let record;
  let trustRootBytes;
  try {
    const bytes = readFileSync(revocationPath);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES)
      throw new Error("evolution deployment revocations size is invalid");
    record = normalize(JSON.parse(bytes.toString("utf8")));
    trustRootBytes = readFileSync(trustRootPath);
  } catch (error) {
    throw new Error(
      "evolution deployment revocations could not be read",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (digest(trustRootBytes) !== expectedTrustRootDigest)
    throw new Error("evolution deployment revocation trust root changed");
  if (record.trustRootDigest !== expectedTrustRootDigest)
    throw new Error("evolution deployment revocation trust root does not match");
  let publicKey;
  try {
    publicKey = createPublicKey(trustRootBytes);
  } catch {
    throw new Error("evolution deployment revocation trust root is invalid");
  }
  if (
    !verify(
      null,
      Buffer.from(
        serializeEvolutionDeploymentDescriptorRevocationsPayload(record),
        "utf8",
      ),
      publicKey,
      Buffer.from(record.signature, "base64"),
    )
  ) {
    throw new Error("evolution deployment revocation signature rejected");
  }
  return record;
}
