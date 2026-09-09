import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { types as utilTypes } from "node:util";

import {
  createGovernedSkillSynthesisAttestorTrustIpcAuthorization,
  normalizeGovernedSkillSynthesisAttestorTrustIpcCapability,
} from "./governed-skill-synthesis-attestor-trust-ipc-capability.js";

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_CLIENT_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operations-client/v6";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_IPC_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operations-ipc/v3";

const CLIENTS = new WeakSet();
const WINDOWS_PIPE =
  /^\\\\\.\\pipe\\cc-evolution-attestor-trust-ops-[a-f0-9]{16,64}$/u;
const SOCKET_NAME = /^cc-evolution-attestor-trust-ops-[a-f0-9]{16,64}\.sock$/u;
const MAX_FRAME_BYTES = 256 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const KEY_ID = /^key:ed25519:[a-f0-9]{64}$/u;
const MAX_REQUESTS = 64;
const CAPABILITY_SERVICE = "attestor-trust-operations";
const OPTION_KEYS = new Set([
  "capabilityToken",
  "descriptor",
  "endpoint",
  "now",
  "timeoutMs",
]);
const DESCRIPTOR_KEYS = new Set([
  "approvalMode",
  "authorizationStreamId",
  "capability",
  "operatorCount",
  "operators",
  "operatorRegistryRecordDigest",
  "operatorRegistryRecovered",
  "operatorRegistryStreamId",
  "policyDigest",
  "policyId",
  "requiredApprovals",
  "revision",
  "schema",
  "tenantId",
  "transportSecurity",
]);
const OPERATOR_KEYS = new Set(["keyId", "operatorId"]);
const TRANSPORT_SECURITY_KEYS = new Set([
  "acl",
  "aclDigest",
  "peerIdentity",
  "principalDigest",
  "remoteClients",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

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

function endpoint(value) {
  const normalized = text(value, "operations endpoint", 1024);
  if (
    (process.platform === "win32" && !WINDOWS_PIPE.test(normalized)) ||
    (process.platform !== "win32" &&
      (!path.isAbsolute(normalized) ||
        !SOCKET_NAME.test(path.basename(normalized))))
  ) {
    throw new TypeError(
      "operations endpoint is not a dedicated local IPC path",
    );
  }
  return normalized;
}

function normalizeDescriptor(value, capabilityToken, now) {
  exact(value, DESCRIPTOR_KEYS, "operations service descriptor");
  if (
    value.schema !==
      "chainlesschain.governed-skill-synthesis-attestor-trust-operations-service/v6" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.policyDigest ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isSafeInteger(value.requiredApprovals) ||
    value.requiredApprovals < 1 ||
    !Number.isSafeInteger(value.operatorCount) ||
    value.operatorCount < value.requiredApprovals ||
    value.approvalMode !==
      (value.requiredApprovals === 1 ? "single-operator" : "multi-operator") ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.operatorRegistryRecordDigest ?? "") ||
    typeof value.operatorRegistryRecovered !== "boolean"
  ) {
    throw new TypeError("operations service descriptor is invalid");
  }
  exact(
    value.transportSecurity,
    TRANSPORT_SECURITY_KEYS,
    "operations transport security",
  );
  const expectedAcl =
    process.platform === "win32"
      ? "protected-current-user-dacl"
      : "unix-owner-mode-0600";
  const expectedPeerIdentity =
    process.platform === "win32"
      ? "client-process-token-user-sid"
      : "capability-authenticated-client";
  if (
    value.transportSecurity.acl !== expectedAcl ||
    value.transportSecurity.peerIdentity !== expectedPeerIdentity ||
    value.transportSecurity.remoteClients !== false ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.transportSecurity.aclDigest ?? "") ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      value.transportSecurity.principalDigest ?? "",
    )
  ) {
    throw new TypeError("operations transport security is invalid");
  }
  for (const [field, maximum] of [
    ["tenantId", 256],
    ["authorizationStreamId", 256],
    ["policyId", 256],
    ["operatorRegistryStreamId", 256],
  ]) {
    text(value[field], `operations descriptor ${field}`, maximum);
  }
  if (
    !Array.isArray(value.operators) ||
    utilTypes.isProxy(value.operators) ||
    Object.getPrototypeOf(value.operators) !== Array.prototype ||
    value.operators.length !== value.operatorCount ||
    Reflect.ownKeys(value.operators).length !== value.operators.length + 1
  ) {
    throw new TypeError("operations descriptor operators are invalid");
  }
  const operatorIds = new Set();
  const keyIds = new Set();
  let previous = null;
  for (const operator of value.operators) {
    exact(operator, OPERATOR_KEYS, "operations descriptor operator");
    if (
      !ID.test(operator.operatorId ?? "") ||
      !KEY_ID.test(operator.keyId ?? "") ||
      operatorIds.has(operator.operatorId) ||
      keyIds.has(operator.keyId) ||
      (previous !== null && previous.localeCompare(operator.operatorId) >= 0)
    ) {
      throw new TypeError("operations descriptor operators are invalid");
    }
    operatorIds.add(operator.operatorId);
    keyIds.add(operator.keyId);
    previous = operator.operatorId;
  }
  const policyCore = {
    tenantId: value.tenantId,
    policyId: value.policyId,
    revision: value.revision,
    requiredApprovals: value.requiredApprovals,
    operators: value.operators,
  };
  const expectedPolicyDigest = `sha256:${createHash("sha256")
    .update("chainlesschain.attestor-trust-operations-policy/v1")
    .update("\0")
    .update(canonical(policyCore))
    .digest("hex")}`;
  if (value.policyDigest !== expectedPolicyDigest) {
    throw new TypeError("operations descriptor policy digest is invalid");
  }
  const capability = normalizeGovernedSkillSynthesisAttestorTrustIpcCapability({
    capability: value.capability,
    maxUsesLimit: MAX_REQUESTS,
    now,
    service: CAPABILITY_SERVICE,
    token: capabilityToken,
  });
  const cloned = structuredClone(value);
  for (const operator of cloned.operators) Object.freeze(operator);
  Object.freeze(cloned.operators);
  cloned.capability = capability;
  cloned.transportSecurity = Object.freeze({ ...cloned.transportSecurity });
  return Object.freeze(cloned);
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
      const error = new Error("attestor trust operations capability expired");
      error.code = "CC_ATTESTOR_TRUST_OPERATIONS_CAPABILITY_EXPIRED";
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
        schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_IPC_SCHEMA,
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
        `attestor trust operations service timed out after ${timeoutMs}ms`,
      );
      error.code = "CC_ATTESTOR_TRUST_OPERATIONS_TIMEOUT";
      finish(error);
    }, timeoutMs);
    timer.unref?.();
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({
          schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_IPC_SCHEMA,
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
        finish(
          new Error("operations service response exceeded its byte limit"),
        );
        return;
      }
      const newline = carry.indexOf("\n");
      if (newline === -1) return;
      if (carry.slice(newline + 1).trim().length > 0) {
        finish(new Error("operations service returned multiple records"));
        return;
      }
      try {
        const response = JSON.parse(
          carry.slice(0, newline).replace(/\r$/u, ""),
        );
        if (
          !response ||
          typeof response !== "object" ||
          Array.isArray(response) ||
          response.requestId !== requestId ||
          typeof response.ok !== "boolean"
        ) {
          throw new Error("operations service response binding is invalid");
        }
        exact(
          response,
          response.ok === true
            ? new Set(["ok", "requestId", "result"])
            : new Set(["code", "ok", "requestId"]),
          "operations service response",
        );
        if (response.ok !== true) {
          const error = new Error(
            `attestor trust operations request denied: ${String(response.code ?? "unknown")}`,
          );
          error.code = "CC_ATTESTOR_TRUST_OPERATIONS_DENIED";
          throw error;
        }
        if (!Object.hasOwn(response, "result")) {
          throw new Error("operations service response omitted its result");
        }
        finish(null, response.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled)
        finish(new Error("operations service closed without a response"));
    });
  });
}

export function createGovernedSkillSynthesisAttestorTrustOperationsClient(
  options = {},
) {
  const normalizedOptions = Object.hasOwn(options, "now")
    ? options
    : { ...options, now: Date.now };
  exact(normalizedOptions, OPTION_KEYS, "operations client options");
  const target = endpoint(normalizedOptions.endpoint);
  const capabilityToken = text(
    normalizedOptions.capabilityToken,
    "operations capabilityToken",
  );
  if (capabilityToken.length < 32) {
    throw new TypeError("operations capabilityToken is invalid");
  }
  if (
    typeof normalizedOptions.now !== "function" ||
    utilTypes.isProxy(normalizedOptions.now)
  ) {
    throw new TypeError("operations client clock is invalid");
  }
  const currentTime = Number(normalizedOptions.now());
  if (!Number.isFinite(currentTime)) {
    throw new TypeError("operations client clock is invalid");
  }
  const serviceDescriptor = normalizeDescriptor(
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
    throw new TypeError("operations client timeoutMs is invalid");
  }
  const descriptor = Object.freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_CLIENT_SCHEMA,
    isolation: "external-service",
    transport: "local-ipc-v3",
    endpointDigest: `sha256:${createHash("sha256")
      .update(target, "utf8")
      .digest("hex")}`,
    requestTimeoutMs: timeoutMs,
    service: serviceDescriptor,
  });
  const client = Object.freeze({
    descriptor,
    prepare(input) {
      return callService({
        target,
        capability: serviceDescriptor.capability,
        capabilityToken,
        timeoutMs,
        action: "prepare",
        payload: input,
        now: normalizedOptions.now,
      });
    },
    execute({ request, approvals } = {}) {
      return callService({
        target,
        capability: serviceDescriptor.capability,
        capabilityToken,
        timeoutMs,
        action: "execute",
        payload: { request, approvals },
        now: normalizedOptions.now,
      });
    },
    prepareOperatorChange(input) {
      return callService({
        target,
        capability: serviceDescriptor.capability,
        capabilityToken,
        timeoutMs,
        action: "operator-prepare",
        payload: input,
        now: normalizedOptions.now,
      });
    },
    executeOperatorChange({ request, approvals } = {}) {
      return callService({
        target,
        capability: serviceDescriptor.capability,
        capabilityToken,
        timeoutMs,
        action: "operator-execute",
        payload: { request, approvals },
        now: normalizedOptions.now,
      });
    },
  });
  CLIENTS.add(client);
  return client;
}

export function isGovernedSkillSynthesisAttestorTrustOperationsClient(value) {
  return CLIENTS.has(value);
}
