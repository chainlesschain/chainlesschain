import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const EVOLUTION_DEPLOYMENT_ROOT_ROTATION_SCHEMA =
  "chainlesschain.evolution-deployment-root-rotation/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_ROTATION_BYTES = 64 * 1024;

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

function normalizeRotation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("evolution deployment root rotation must be an object");
  const expected = [
    "fromTrustRootDigest",
    "minimumDescriptorRevision",
    "schema",
    "signature",
    "toTrustRootDigest",
  ];
  if (canonical(Object.keys(value).sort()) !== canonical(expected))
    throw new TypeError(
      "evolution deployment root rotation has unexpected or missing fields",
    );
  if (value.schema !== EVOLUTION_DEPLOYMENT_ROOT_ROTATION_SCHEMA)
    throw new TypeError("evolution deployment root rotation schema is invalid");
  for (const key of ["fromTrustRootDigest", "toTrustRootDigest"]) {
    if (!DIGEST.test(value[key] || ""))
      throw new TypeError(`evolution deployment root rotation ${key} is invalid`);
  }
  if (value.fromTrustRootDigest === value.toTrustRootDigest)
    throw new TypeError("evolution deployment root rotation must change trust root");
  if (
    !Number.isSafeInteger(value.minimumDescriptorRevision) ||
    value.minimumDescriptorRevision < 1
  ) {
    throw new TypeError(
      "evolution deployment root rotation minimumDescriptorRevision is invalid",
    );
  }
  if (
    typeof value.signature !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signature) ||
    value.signature.length === 0
  ) {
    throw new TypeError("evolution deployment root rotation signature is invalid");
  }
  return Object.freeze({ ...value });
}

export function serializeEvolutionDeploymentRootRotationPayload(rotation) {
  const value = normalizeRotation({ ...rotation, signature: "AA==" });
  return canonical({
    schema: value.schema,
    fromTrustRootDigest: value.fromTrustRootDigest,
    toTrustRootDigest: value.toTrustRootDigest,
    minimumDescriptorRevision: value.minimumDescriptorRevision,
  });
}

/**
 * Verify a root transition while the profile lock is held. The old root is
 * authenticated by its exact bytes before it may authorize a new root.
 */
export function verifyEvolutionDeploymentRootRotationSync({
  rotationPath,
  fromTrustRootPath,
  expectedFromTrustRootDigest,
  expectedToTrustRootDigest,
  destinationRevision,
}) {
  if (
    typeof rotationPath !== "string" ||
    !isAbsolute(rotationPath) ||
    typeof fromTrustRootPath !== "string" ||
    !isAbsolute(fromTrustRootPath)
  ) {
    throw new Error("evolution deployment root rotation paths must be absolute");
  }
  if (!DIGEST.test(expectedFromTrustRootDigest || ""))
    throw new Error("evolution deployment root rotation source digest is invalid");
  if (!DIGEST.test(expectedToTrustRootDigest || ""))
    throw new Error("evolution deployment root rotation destination digest is invalid");
  if (!Number.isSafeInteger(destinationRevision) || destinationRevision < 1)
    throw new Error("evolution deployment root rotation destination revision is invalid");

  let rotation;
  let fromTrustRootBytes;
  try {
    const rotationBytes = readFileSync(rotationPath);
    if (
      rotationBytes.byteLength === 0 ||
      rotationBytes.byteLength > MAX_ROTATION_BYTES
    ) {
      throw new Error("evolution deployment root rotation size is invalid");
    }
    rotation = normalizeRotation(JSON.parse(rotationBytes.toString("utf8")));
    fromTrustRootBytes = readFileSync(fromTrustRootPath);
  } catch (error) {
    throw new Error(
      "evolution deployment root rotation could not be read",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (digest(fromTrustRootBytes) !== expectedFromTrustRootDigest)
    throw new Error(
      "evolution deployment root rotation source trust root changed",
    );
  if (rotation.fromTrustRootDigest !== expectedFromTrustRootDigest)
    throw new Error(
      "evolution deployment root rotation source does not match profile",
    );
  if (rotation.toTrustRootDigest !== expectedToTrustRootDigest)
    throw new Error(
      "evolution deployment root rotation destination does not match descriptor",
    );
  if (destinationRevision < rotation.minimumDescriptorRevision)
    throw new Error(
      "evolution deployment root rotation destination revision is below the authorized minimum",
    );
  let publicKey;
  try {
    publicKey = createPublicKey(fromTrustRootBytes);
  } catch {
    throw new Error("evolution deployment root rotation source trust root is invalid");
  }
  if (
    !verify(
      null,
      Buffer.from(
        serializeEvolutionDeploymentRootRotationPayload(rotation),
        "utf8",
      ),
      publicKey,
      Buffer.from(rotation.signature, "base64"),
    )
  ) {
    throw new Error("evolution deployment root rotation signature rejected");
  }
  return rotation;
}
