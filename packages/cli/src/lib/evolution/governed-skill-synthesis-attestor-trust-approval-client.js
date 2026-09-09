import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import net from "node:net";
import { types as utilTypes } from "node:util";

import { isGovernedSkillSynthesisAttestorIpcEndpoint } from "./governed-skill-synthesis-attestor-ipc-endpoint.js";

import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SCHEMA,
  digestGovernedSkillSynthesisAttestorTrustApproval,
  governedSkillSynthesisAttestorTrustApprovalMessage,
} from "./governed-skill-synthesis-attestor-trust-operations.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_APPROVAL_SCHEMA,
  digestGovernedSkillSynthesisAttestorTrustOperatorRegistryApproval,
  governedSkillSynthesisAttestorTrustOperatorRegistryApprovalMessage,
} from "./governed-skill-synthesis-attestor-trust-operator-registry.js";
import {
  createGovernedSkillSynthesisAttestorTrustIpcAuthorization,
  normalizeGovernedSkillSynthesisAttestorTrustIpcCapability,
} from "./governed-skill-synthesis-attestor-trust-ipc-capability.js";

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_CLIENT_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-approval-client/v4";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_IPC_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-approval-ipc/v3";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SERVICE_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-approval-service/v4";

const CLIENTS = new WeakSet();
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const KEY_ID = /^key:ed25519:[a-f0-9]{64}$/u;
const MAX_FRAME_BYTES = 256 * 1024;
const FUTURE_SKEW_MS = 30 * 1000;
const MAX_REQUESTS = 256;
const CAPABILITY_SERVICE = "attestor-trust-approval";
const OPTION_KEYS = new Set([
  "capabilityToken",
  "descriptor",
  "endpoint",
  "now",
  "timeoutMs",
]);
const DESCRIPTOR_KEYS = new Set([
  "capability",
  "keyId",
  "operatorId",
  "policyDigest",
  "policyId",
  "publicKeySpki",
  "revision",
  "schema",
  "signerId",
  "tenantId",
  "transportSecurity",
]);
const TRANSPORT_SECURITY_KEYS = new Set([
  "acl",
  "aclDigest",
  "peerIdentity",
  "principalDigest",
  "remoteClients",
]);
const APPROVAL_KEYS = new Set([
  "approvedAt",
  "attestation",
  "automated",
  "expiresAt",
  "operatorId",
  "policyDigest",
  "receiptDigest",
  "requestDigest",
  "schema",
  "tenantId",
]);
const ATTESTATION_KEYS = new Set(["algorithm", "keyId", "value"]);

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.size ||
    Reflect.ownKeys(value).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.has(key) ||
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      );
    })
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function text(value, label, maximum = 4096) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function timestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return milliseconds;
}

function endpoint(value) {
  const normalized = text(value, "approval endpoint", 1024);
  if (
    !isGovernedSkillSynthesisAttestorIpcEndpoint(normalized, {
      kind: "trust-approval",
    })
  ) {
    throw new TypeError("approval endpoint is not a dedicated local IPC path");
  }
  return normalized;
}

function normalizeDescriptor(value, capabilityToken, now) {
  exact(value, DESCRIPTOR_KEYS, "approval service descriptor");
  if (
    value.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SERVICE_SCHEMA ||
    !ID.test(value.tenantId ?? "") ||
    !ID.test(value.operatorId ?? "") ||
    !ID.test(value.policyId ?? "") ||
    !ID.test(value.signerId ?? "") ||
    !KEY_ID.test(value.keyId ?? "") ||
    !DIGEST.test(value.policyDigest ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.publicKeySpki !== "string"
  ) {
    throw new TypeError("approval service descriptor is invalid");
  }
  exact(
    value.transportSecurity,
    TRANSPORT_SECURITY_KEYS,
    "approval transport security",
  );
  const expectedAcl =
    process.platform === "win32"
      ? "protected-current-logon-dacl"
      : "unix-owner-mode-0600";
  const expectedPeerIdentity =
    process.platform === "win32"
      ? "client-process-token-user-and-logon-sid"
      : "capability-authenticated-client";
  if (
    value.transportSecurity.acl !== expectedAcl ||
    value.transportSecurity.peerIdentity !== expectedPeerIdentity ||
    value.transportSecurity.remoteClients !== false ||
    !DIGEST.test(value.transportSecurity.aclDigest ?? "") ||
    !DIGEST.test(value.transportSecurity.principalDigest ?? "")
  ) {
    throw new TypeError("approval transport security is invalid");
  }
  let publicKey;
  try {
    const bytes = Buffer.from(value.publicKeySpki, "base64url");
    if (bytes.toString("base64url") !== value.publicKeySpki) throw new Error();
    publicKey = createPublicKey({ key: bytes, type: "spki", format: "der" });
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error();
    const keyId = `key:ed25519:${createHash("sha256")
      .update(bytes)
      .digest("hex")}`;
    if (keyId !== value.keyId) throw new Error();
  } catch {
    throw new TypeError("approval service public key is invalid");
  }
  const capability = normalizeGovernedSkillSynthesisAttestorTrustIpcCapability({
    capability: value.capability,
    maxUsesLimit: MAX_REQUESTS,
    now,
    service: CAPABILITY_SERVICE,
    token: capabilityToken,
  });
  const descriptor = structuredClone(value);
  descriptor.capability = capability;
  descriptor.transportSecurity = Object.freeze({
    ...descriptor.transportSecurity,
  });
  return {
    descriptor: Object.freeze(descriptor),
    publicKey,
  };
}

function validateApproval({
  value,
  request,
  service,
  publicKey,
  currentTime,
  schema,
  digestApproval,
  approvalMessage,
  policyFieldsRequired,
}) {
  exact(value, APPROVAL_KEYS, "approval service result");
  const attestation = exact(
    value.attestation,
    ATTESTATION_KEYS,
    "approval service attestation",
  );
  const approvedAt = timestamp(value.approvedAt, "approval approvedAt");
  const expiresAt = timestamp(value.expiresAt, "approval expiresAt");
  if (
    value.schema !== schema ||
    value.tenantId !== service.tenantId ||
    value.tenantId !== request?.tenantId ||
    value.operatorId !== service.operatorId ||
    value.policyDigest !== service.policyDigest ||
    value.automated !== false ||
    !DIGEST.test(value.requestDigest ?? "") ||
    value.requestDigest !== request?.requestDigest ||
    value.policyDigest !== request?.policyDigest ||
    (policyFieldsRequired &&
      (request?.policyId !== service.policyId ||
        request?.revision !== service.revision)) ||
    approvedAt <
      timestamp(request?.requestedAt, "request requestedAt") - FUTURE_SKEW_MS ||
    approvedAt > currentTime + FUTURE_SKEW_MS ||
    approvedAt >= expiresAt ||
    expiresAt !== timestamp(request?.expiresAt, "request expiresAt") ||
    expiresAt <= currentTime ||
    value.receiptDigest !== digestApproval(value) ||
    attestation.algorithm !== "Ed25519" ||
    attestation.keyId !== service.keyId ||
    typeof attestation.value !== "string"
  ) {
    throw new Error("approval service result is not exactly request-bound");
  }
  const signature = Buffer.from(attestation.value, "base64url");
  if (
    signature.length !== 64 ||
    signature.toString("base64url") !== attestation.value ||
    !verify(null, approvalMessage(value.receiptDigest), publicKey, signature)
  ) {
    throw new Error("approval service result signature is invalid");
  }
  return Object.freeze(structuredClone(value));
}

function callService({
  target,
  capability,
  capabilityToken,
  timeoutMs,
  action,
  payload,
  now,
}) {
  return new Promise((resolve, reject) => {
    const currentTime = Number(now());
    if (
      !Number.isFinite(currentTime) ||
      currentTime >= Date.parse(capability.expiresAt)
    ) {
      const error = new Error("attestor trust approval capability expired");
      error.code = "CC_ATTESTOR_TRUST_APPROVAL_CAPABILITY_EXPIRED";
      reject(error);
      return;
    }
    const socket = net.connect(target);
    const requestId = randomBytes(16).toString("hex");
    const authorization =
      createGovernedSkillSynthesisAttestorTrustIpcAuthorization({
        action,
        capabilityId: capability.id,
        clientProcessId: process.pid,
        payload,
        requestId,
        schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_IPC_SCHEMA,
        token: capabilityToken,
      });
    let carry = "";
    let settled = false;
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
        `attestor trust approval service timed out after ${timeoutMs}ms`,
      );
      error.code = "CC_ATTESTOR_TRUST_APPROVAL_TIMEOUT";
      finish(error);
    }, timeoutMs);
    timer.unref?.();
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({
          schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_IPC_SCHEMA,
          requestId,
          capabilityId: capability.id,
          clientProcessId: process.pid,
          authorization,
          action,
          payload,
        })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      carry += chunk.toString("utf8");
      if (Buffer.byteLength(carry, "utf8") > MAX_FRAME_BYTES) {
        finish(new Error("approval service response exceeded its byte limit"));
        return;
      }
      const newline = carry.indexOf("\n");
      if (newline === -1) return;
      if (carry.slice(newline + 1).trim().length > 0) {
        finish(new Error("approval service returned multiple records"));
        return;
      }
      try {
        const response = JSON.parse(
          carry.slice(0, newline).replace(/\r$/u, ""),
        );
        exact(
          response,
          response?.ok === true
            ? new Set(["ok", "requestId", "result"])
            : new Set(["code", "ok", "requestId"]),
          "approval service response",
        );
        if (
          response.requestId !== requestId ||
          typeof response.ok !== "boolean"
        ) {
          throw new Error("approval service response binding is invalid");
        }
        if (response.ok !== true) {
          const error = new Error(
            `attestor trust approval request denied: ${String(response.code ?? "unknown")}`,
          );
          error.code = "CC_ATTESTOR_TRUST_APPROVAL_DENIED";
          throw error;
        }
        finish(null, response.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled)
        finish(new Error("approval service closed without a response"));
    });
  });
}

export function createGovernedSkillSynthesisAttestorTrustApprovalClient(
  options = {},
) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    utilTypes.isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError("approval client options are invalid");
  }
  const normalizedOptions = Object.hasOwn(options, "now")
    ? options
    : { ...options, now: Date.now };
  exact(normalizedOptions, OPTION_KEYS, "approval client options");
  const target = endpoint(normalizedOptions.endpoint);
  const capabilityToken = text(
    normalizedOptions.capabilityToken,
    "approval capabilityToken",
  );
  if (capabilityToken.length < 32) {
    throw new TypeError("approval capabilityToken is invalid");
  }
  if (
    typeof normalizedOptions.now !== "function" ||
    utilTypes.isProxy(normalizedOptions.now)
  ) {
    throw new TypeError("approval client clock is invalid");
  }
  const currentTime = Number(normalizedOptions.now());
  if (!Number.isFinite(currentTime)) {
    throw new TypeError("approval client clock is invalid");
  }
  const normalized = normalizeDescriptor(
    normalizedOptions.descriptor,
    capabilityToken,
    currentTime,
  );
  const timeoutMs = Number(normalizedOptions.timeoutMs);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 30_000
  ) {
    throw new TypeError("approval client timeoutMs is invalid");
  }
  const descriptor = Object.freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_CLIENT_SCHEMA,
    isolation: "external-service",
    transport: "local-ipc-v3",
    endpointDigest: `sha256:${createHash("sha256")
      .update(target, "utf8")
      .digest("hex")}`,
    requestTimeoutMs: timeoutMs,
    service: normalized.descriptor,
  });
  const approve = async (action, request, approval) => {
    const result = await callService({
      target,
      capabilityToken,
      capability: normalized.descriptor.capability,
      timeoutMs,
      action,
      payload: request,
      now: normalizedOptions.now,
    });
    const currentTime = Number(normalizedOptions.now());
    if (!Number.isFinite(currentTime)) {
      throw new TypeError("approval client clock is invalid");
    }
    return validateApproval({
      value: result,
      request,
      service: normalized.descriptor,
      publicKey: normalized.publicKey,
      currentTime,
      ...approval,
    });
  };
  const client = Object.freeze({
    descriptor,
    approve(request) {
      return approve("approve", request, {
        schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SCHEMA,
        digestApproval: digestGovernedSkillSynthesisAttestorTrustApproval,
        approvalMessage: governedSkillSynthesisAttestorTrustApprovalMessage,
        policyFieldsRequired: false,
      });
    },
    approveOperatorChange(request) {
      return approve("operator-approve", request, {
        schema:
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_APPROVAL_SCHEMA,
        digestApproval:
          digestGovernedSkillSynthesisAttestorTrustOperatorRegistryApproval,
        approvalMessage:
          governedSkillSynthesisAttestorTrustOperatorRegistryApprovalMessage,
        policyFieldsRequired: true,
      });
    },
  });
  CLIENTS.add(client);
  return client;
}

export function isGovernedSkillSynthesisAttestorTrustApprovalClient(value) {
  return CLIENTS.has(value);
}
