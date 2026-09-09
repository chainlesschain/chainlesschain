import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";

import { resolveCredentialEnvironmentValue } from "../process-execution-broker/credential-transport.js";

const REQUEST_SCHEMA =
  "chainlesschain.skill-synthesis-process-attestor-request/v1";
const ATTESTATION_SCHEMA =
  "chainlesschain.skill-synthesis-evaluation-attestation/v1";
const MAX_INPUT_BYTES = 32 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function fail(message) {
  throw new Error(message);
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  ) {
    fail(`${label} schema is invalid`);
  }
  return value;
}

function boundedString(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function boundedSecret(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function signingMessage(request) {
  return Buffer.from(
    `${ATTESTATION_SCHEMA}\0${canonical({
      receiptDigest: request.receiptDigest,
      candidateDigest: request.candidateDigest,
      evaluatorDescriptor: request.evaluatorDescriptor,
      attestor: request.attestor,
    })}`,
    "utf8",
  );
}

let input = "";
for await (const chunk of process.stdin) {
  input += chunk.toString("utf8");
  if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    fail("attestor input exceeds its byte limit");
  }
}

let request;
try {
  request = JSON.parse(input);
} catch {
  fail("attestor input is not JSON");
}
exactObject(
  request,
  [
    "attestor",
    "candidateDigest",
    "evaluatorDescriptor",
    "receiptDigest",
    "schema",
  ],
  "attestor request",
);
if (
  request.schema !== REQUEST_SCHEMA ||
  !DIGEST.test(request.receiptDigest ?? "") ||
  !DIGEST.test(request.candidateDigest ?? "")
) {
  fail("attestor request binding is invalid");
}
exactObject(
  request.evaluatorDescriptor,
  ["authorityId", "handlerArtifactDigest", "revision"],
  "evaluator descriptor",
);
boundedString(request.evaluatorDescriptor.authorityId, "evaluator authority");
if (
  !DIGEST.test(request.evaluatorDescriptor.handlerArtifactDigest ?? "") ||
  !Number.isSafeInteger(request.evaluatorDescriptor.revision) ||
  request.evaluatorDescriptor.revision < 1
) {
  fail("evaluator descriptor binding is invalid");
}
exactObject(
  request.attestor,
  [
    "algorithm",
    "credentialDelivery",
    "credentialMaxUses",
    "credentialResolverArtifactDigest",
    "credentialTarget",
    "credentialTtlMs",
    "hardDeadlineEnforced",
    "isolation",
    "keyId",
    "persistentProcessAuditRequired",
    "publicKeyDigest",
    "requiredSandboxBoundaries",
    "sandboxProfile",
    "schema",
    "workerArtifactDigest",
  ],
  "attestor descriptor",
);
if (
  request.attestor.schema !==
    "chainlesschain.governed-skill-synthesis-process-attestor/v1" ||
  request.attestor.algorithm !== "Ed25519" ||
  request.attestor.isolation !== "process" ||
  request.attestor.credentialDelivery !== "single-use-broker-reference" ||
  request.attestor.credentialMaxUses !== 1 ||
  request.attestor.credentialTarget !== "governed-skill-attestor.local" ||
  !Number.isSafeInteger(request.attestor.credentialTtlMs) ||
  request.attestor.credentialTtlMs < 6_000 ||
  request.attestor.credentialTtlMs > 35_000 ||
  request.attestor.hardDeadlineEnforced !== true ||
  request.attestor.persistentProcessAuditRequired !== true ||
  request.attestor.sandboxProfile !== "network-only" ||
  canonical(request.attestor.requiredSandboxBoundaries) !==
    canonical(["privilege-reduction", "process-tree", "resource-limits"]) ||
  !DIGEST.test(request.attestor.publicKeyDigest ?? "") ||
  !DIGEST.test(request.attestor.workerArtifactDigest ?? "") ||
  !DIGEST.test(request.attestor.credentialResolverArtifactDigest ?? "")
) {
  fail("attestor execution descriptor is invalid");
}

if (Object.hasOwn(process.env, "CC_EVOLUTION_ATTESTOR_PRIVATE_KEY")) {
  fail("attestor refuses plaintext environment credentials");
}
const privateKeyPem = boundedSecret(
  await resolveCredentialEnvironmentValue("CC_EVOLUTION_ATTESTOR_PRIVATE_KEY", {
    env: process.env,
  }),
  "attestor private key",
  16 * 1024,
);
const privateKey = createPrivateKey(privateKeyPem);
if (privateKey.asymmetricKeyType !== "ed25519") {
  fail("attestor private key is not Ed25519");
}
const publicKey = createPublicKey(privateKey);
const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
const publicKeyDigest = `sha256:${createHash("sha256")
  .update(publicKeyDer)
  .digest("hex")}`;
if (
  request.attestor.publicKeyDigest !== publicKeyDigest ||
  request.attestor.keyId !== `key:ed25519:${publicKeyDigest.slice(7)}`
) {
  fail("attestor key identity mismatch");
}

const signature = sign(null, signingMessage(request), privateKey).toString(
  "base64",
);
const { schema: attestorSchema, ...attestorExecution } = request.attestor;
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    attestation: {
      schema: ATTESTATION_SCHEMA,
      attestorSchema,
      ...attestorExecution,
      signature,
    },
  })}\n`,
);
