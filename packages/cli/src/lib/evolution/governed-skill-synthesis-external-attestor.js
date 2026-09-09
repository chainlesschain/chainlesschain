import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import net from "node:net";
import { types as utilTypes } from "node:util";

import { isGovernedSkillSynthesisAttestorIpcEndpoint } from "./governed-skill-synthesis-attestor-ipc-endpoint.js";

export const GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_SCHEMA =
  "chainlesschain.governed-skill-synthesis-external-attestor/v1";
export const GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTATION_SCHEMA =
  "chainlesschain.skill-synthesis-evaluation-external-attestation/v1";
export const GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_REQUEST_SCHEMA =
  "chainlesschain.skill-synthesis-external-attestor-request/v1";

const AUTHORITIES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SERVICE_ID = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+){1,7}$/u;
const OPTION_KEYS = new Set([
  "capabilityToken",
  "endpoint",
  "publicKeyPem",
  "serviceId",
  "timeoutMs",
]);
const REQUEST_KEYS = new Set([
  "candidateDigest",
  "descriptor",
  "receiptDigest",
]);
const ATTESTATION_KEYS = new Set([
  "algorithm",
  "attestorSchema",
  "endpointDigest",
  "isolation",
  "keyId",
  "publicKeyDigest",
  "requestId",
  "requestTimeoutMs",
  "schema",
  "serviceId",
  "signature",
  "transport",
]);
const MAX_FRAME_BYTES = 32 * 1024;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function record(value, label, allowedKeys, exact = true) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    (exact && Reflect.ownKeys(descriptors).length !== allowedKeys.size) ||
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== "string" ||
        !allowedKeys.has(key) ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    throw new TypeError(`${label} has unexpected fields`);
  }
  return value;
}

function text(value, label, maximum = 256, trim = true) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    value.includes("\0") ||
    (trim && value.trim() !== value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function normalizeEndpoint(value) {
  const endpoint = text(value, "external attestor endpoint", 1024);
  if (
    !isGovernedSkillSynthesisAttestorIpcEndpoint(endpoint, {
      kind: "external",
    })
  ) {
    throw new TypeError(
      "external attestor endpoint must be a dedicated local IPC path",
    );
  }
  return endpoint;
}

function normalizeEvaluatorDescriptor(value) {
  record(
    value,
    "external attestor evaluator descriptor",
    new Set(["authorityId", "handlerArtifactDigest", "revision"]),
  );
  if (
    !DIGEST.test(value.handlerArtifactDigest ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  ) {
    throw new TypeError("external attestor evaluator descriptor is invalid");
  }
  return Object.freeze({
    authorityId: text(value.authorityId, "external attestor authorityId"),
    handlerArtifactDigest: value.handlerArtifactDigest,
    revision: value.revision,
  });
}

function normalizeRequest(value) {
  record(value, "external attestor request", REQUEST_KEYS);
  if (
    !DIGEST.test(value.receiptDigest ?? "") ||
    !DIGEST.test(value.candidateDigest ?? "")
  ) {
    throw new TypeError("external attestor request digests are invalid");
  }
  return Object.freeze({
    receiptDigest: value.receiptDigest,
    candidateDigest: value.candidateDigest,
    descriptor: normalizeEvaluatorDescriptor(value.descriptor),
  });
}

function signingMessage(request, attestor, requestId) {
  return Buffer.from(
    `${GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTATION_SCHEMA}\0${canonical({
      receiptDigest: request.receiptDigest,
      candidateDigest: request.candidateDigest,
      evaluatorDescriptor: request.descriptor,
      attestor,
      requestId,
    })}`,
    "utf8",
  );
}

function requestSignature({
  endpoint,
  capabilityToken,
  request,
  descriptor,
  requestId,
  timeoutMs,
}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint);
    let settled = false;
    let carry = "";
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      const error = new Error(
        `external evaluation attestor timed out after ${timeoutMs}ms`,
      );
      error.code = "LEARNING_SYNTHESIS_EXTERNAL_ATTESTOR_TIMEOUT";
      finish(error);
    }, timeoutMs);
    timer.unref?.();
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({
          schema: GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_REQUEST_SCHEMA,
          serviceId: descriptor.serviceId,
          capabilityToken,
          requestId,
          receiptDigest: request.receiptDigest,
          candidateDigest: request.candidateDigest,
          evaluatorDescriptor: request.descriptor,
          attestor: descriptor,
        })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      carry += chunk.toString("utf8");
      if (Buffer.byteLength(carry, "utf8") > MAX_FRAME_BYTES) {
        finish(new Error("external attestor response exceeded its byte limit"));
        return;
      }
      const newline = carry.indexOf("\n");
      if (newline === -1) return;
      if (carry.slice(newline + 1).trim().length > 0) {
        finish(new Error("external attestor returned multiple records"));
        return;
      }
      try {
        const response = JSON.parse(
          carry.slice(0, newline).replace(/\r$/u, ""),
        );
        record(
          response,
          "external attestor response",
          new Set(["ok", "requestId", "signature"]),
        );
        if (
          response.ok !== true ||
          response.requestId !== requestId ||
          typeof response.signature !== "string" ||
          response.signature.length === 0 ||
          response.signature.length > 1024
        ) {
          throw new Error("external attestor response binding is invalid");
        }
        finish(null, response.signature);
      } catch (error) {
        finish(error);
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled) {
        finish(new Error("external attestor closed without a response"));
      }
    });
  });
}

function verifyInput(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = new Set([
    "attestation",
    "candidateDigest",
    "descriptor",
    "receiptDigest",
  ]);
  if (
    Reflect.ownKeys(descriptors).length !== keys.size ||
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== "string" ||
        !keys.has(key) ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    return null;
  }
  try {
    return {
      request: normalizeRequest({
        receiptDigest: descriptors.receiptDigest.value,
        candidateDigest: descriptors.candidateDigest.value,
        descriptor: descriptors.descriptor.value,
      }),
      attestation: descriptors.attestation.value,
    };
  } catch {
    return null;
  }
}

function attestationData(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== ATTESTATION_KEYS.size ||
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== "string" ||
        !ATTESTATION_KEYS.has(key) ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, entry]) => [key, entry.value]),
  );
}

export function getGovernedSkillSynthesisExternalAttestationIdentity(value) {
  const data = attestationData(value);
  if (
    !data ||
    data.schema !== GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTATION_SCHEMA ||
    data.attestorSchema !== GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_SCHEMA ||
    !/^key:ed25519:[a-f0-9]{64}$/u.test(data.keyId ?? "") ||
    !SERVICE_ID.test(data.serviceId ?? "")
  ) {
    return null;
  }
  return Object.freeze({ keyId: data.keyId, serviceId: data.serviceId });
}

export function verifyGovernedSkillSynthesisExternalAttestation(
  value,
  { publicKey: publicKeyInput, expectedDescriptor = null } = {},
) {
  const input = verifyInput(value);
  if (!input) return false;
  const data = attestationData(input.attestation);
  if (!data) return false;
  let publicKey;
  try {
    if (
      utilTypes.isKeyObject(publicKeyInput) &&
      publicKeyInput.type !== "public"
    ) {
      return false;
    }
    publicKey = utilTypes.isKeyObject(publicKeyInput)
      ? publicKeyInput
      : createPublicKey(publicKeyInput);
  } catch {
    return false;
  }
  if (publicKey.asymmetricKeyType !== "ed25519") return false;
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const publicKeyDigest = sha256(publicDer);
  const {
    attestorSchema,
    requestId,
    signature,
    schema: attestationSchema,
    ...execution
  } = data;
  const attestor = { schema: attestorSchema, ...execution };
  if (
    attestationSchema !==
      GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTATION_SCHEMA ||
    attestorSchema !== GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_SCHEMA ||
    execution.algorithm !== "Ed25519" ||
    execution.keyId !== `key:ed25519:${publicKeyDigest.slice(7)}` ||
    execution.publicKeyDigest !== publicKeyDigest ||
    execution.isolation !== "external-service" ||
    !SERVICE_ID.test(execution.serviceId ?? "") ||
    execution.transport !== "local-ipc-v1" ||
    !DIGEST.test(execution.endpointDigest ?? "") ||
    !Number.isSafeInteger(execution.requestTimeoutMs) ||
    execution.requestTimeoutMs < 1_000 ||
    execution.requestTimeoutMs > 30_000 ||
    !/^[a-f0-9]{32}$/u.test(requestId ?? "") ||
    typeof signature !== "string" ||
    signature.length === 0 ||
    signature.length > 1024 ||
    (expectedDescriptor !== null &&
      canonical(attestor) !== canonical(expectedDescriptor))
  ) {
    return false;
  }
  try {
    const signatureBytes = Buffer.from(signature, "base64");
    return (
      signatureBytes.length === 64 &&
      signatureBytes.toString("base64") === signature &&
      verify(
        null,
        signingMessage(input.request, attestor, requestId),
        publicKey,
        signatureBytes,
      )
    );
  } catch {
    return false;
  }
}

export function createGovernedSkillSynthesisExternalAttestationAuthority(
  options = {},
) {
  record(options, "external attestor options", OPTION_KEYS, false);
  const endpoint = normalizeEndpoint(options.endpoint);
  const capabilityToken = text(
    options.capabilityToken,
    "external attestor capabilityToken",
    4096,
  );
  if (capabilityToken.length < 32) {
    throw new TypeError("external attestor capabilityToken is invalid");
  }
  const serviceId = text(options.serviceId, "external attestor serviceId", 128);
  if (!SERVICE_ID.test(serviceId)) {
    throw new TypeError("external attestor serviceId is invalid");
  }
  const publicKeyPem = text(
    options.publicKeyPem,
    "external attestor publicKeyPem",
    16 * 1024,
    false,
  );
  if (/PRIVATE KEY/u.test(publicKeyPem)) {
    throw new TypeError(
      "external attestor publicKeyPem must not contain a private key",
    );
  }
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("external attestor public key must be Ed25519");
  }
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const publicKeyDigest = sha256(publicDer);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 30_000
  ) {
    throw new TypeError("external attestor timeoutMs is invalid");
  }
  const descriptor = Object.freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_SCHEMA,
    algorithm: "Ed25519",
    keyId: `key:ed25519:${publicKeyDigest.slice(7)}`,
    publicKeyDigest,
    isolation: "external-service",
    serviceId,
    transport: "local-ipc-v1",
    endpointDigest: sha256(Buffer.from(endpoint, "utf8")),
    requestTimeoutMs: timeoutMs,
  });
  const attestReceipt = async (value) => {
    const request = normalizeRequest(value);
    const requestId = randomBytes(16).toString("hex");
    const signature = await requestSignature({
      endpoint,
      capabilityToken,
      request,
      descriptor,
      requestId,
      timeoutMs,
    });
    const message = signingMessage(request, descriptor, requestId);
    if (!verify(null, message, publicKey, Buffer.from(signature, "base64"))) {
      throw new Error("external attestor returned an invalid signature");
    }
    const { schema: attestorSchema, ...execution } = descriptor;
    return Object.freeze({
      schema: GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTATION_SCHEMA,
      attestorSchema,
      ...execution,
      requestId,
      signature,
    });
  };
  const verifyAttestation = async (value) => {
    return verifyGovernedSkillSynthesisExternalAttestation(value, {
      publicKey,
      expectedDescriptor: descriptor,
    });
  };
  Object.freeze(attestReceipt);
  Object.freeze(verifyAttestation);
  const authority = Object.freeze({
    descriptor,
    attestReceipt,
    verifyAttestation,
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function isGovernedSkillSynthesisExternalAttestationAuthority(value) {
  return AUTHORITIES.has(value);
}
