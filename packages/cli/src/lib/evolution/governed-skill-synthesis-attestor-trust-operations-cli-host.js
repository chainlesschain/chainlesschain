import { createHash, createPublicKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "../secure-file-identity.js";
import { readBoundedDescriptor } from "./bounded-descriptor-read.js";
import { isGovernedSkillSynthesisAttestorTrustApprovalClient } from "./governed-skill-synthesis-attestor-trust-approval-client.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_CLIENT_SCHEMA,
  isGovernedSkillSynthesisAttestorTrustOperationsClient,
} from "./governed-skill-synthesis-attestor-trust-operations-client.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA,
  digestGovernedSkillSynthesisAttestorTrustOperationRequest,
} from "./governed-skill-synthesis-attestor-trust-operations.js";
import { validateGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest } from "./governed-skill-synthesis-attestor-trust-operator-registry.js";

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_CLI_HOST_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operations-cli-host/v2";

const HOSTS = new WeakSet();
const MAX_DOCUMENT_BYTES = 256 * 1024;
const MAX_APPROVAL_FILES = 16;
const MAX_REQUEST_TTL_MS = 15 * 60 * 1000;
const FUTURE_SKEW_MS = 30 * 1000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const KEY_ID = /^key:ed25519:[a-f0-9]{64}$/u;
const SERVICE_ID = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+){1,7}$/u;
const REQUEST_KEYS = new Set([
  "expiresAt",
  "keyId",
  "operation",
  "policyDigest",
  "priorKeyId",
  "publicKeySpki",
  "reason",
  "requestDigest",
  "requestedAt",
  "requiredApprovals",
  "schema",
  "serviceId",
  "tenantId",
]);

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

function filePath(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 4096 ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return path.resolve(value);
}

function decodeJson(bytes, label) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must contain one JSON object`);
  }
  return value;
}

function readSecureJson(requestedPath, label) {
  const target = filePath(requestedPath, `${label} path`);
  return withTrustedFileParentSync(
    fs,
    target,
    ({ canonicalPath, parentDevice, parentDescriptor }) => {
      if (
        process.platform !== "win32" &&
        (Number(fs.fstatSync(parentDescriptor).mode) & 0o022) !== 0
      ) {
        throw new Error(`${label} parent must not be group/world writable`);
      }
      let before;
      try {
        before = fs.lstatSync(canonicalPath, { bigint: true });
      } catch (error) {
        if (error?.code === "ENOENT") throw new Error(`${label} was not found`);
        throw error;
      }
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        Number(before.nlink) !== 1
      ) {
        throw new Error(`${label} must be a regular, single-link file`);
      }
      if (process.platform !== "win32" && (Number(before.mode) & 0o077) !== 0) {
        throw new Error(`${label} permissions must be 0600`);
      }
      const size = Number(before.size);
      if (
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > MAX_DOCUMENT_BYTES
      ) {
        throw new Error(
          `${label} must be between 1 and ${MAX_DOCUMENT_BYTES} bytes`,
        );
      }
      let descriptor = null;
      try {
        descriptor = fs.openSync(
          canonicalPath,
          fs.constants.O_RDONLY | Number(fs.constants.O_NOFOLLOW ?? 0),
        );
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error(`${label} identity changed while opening`);
        }
        const bytes = readBoundedDescriptor(
          fs,
          descriptor,
          size,
          MAX_DOCUMENT_BYTES,
        );
        const after = fs.fstatSync(descriptor, { bigint: true });
        if (!sameFileStatIdentity(opened, after)) {
          throw new Error(`${label} changed while being read`);
        }
        return decodeJson(bytes, label);
      } finally {
        if (descriptor !== null) fs.closeSync(descriptor);
      }
    },
  );
}

function writeExclusiveJson(requestedPath, value, label) {
  const target = filePath(requestedPath, `${label} path`);
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_DOCUMENT_BYTES}-byte limit`);
  }
  return withTrustedFileParentSync(
    fs,
    target,
    ({ canonicalPath, parentDescriptor }) => {
      if (
        process.platform !== "win32" &&
        (Number(fs.fstatSync(parentDescriptor).mode) & 0o022) !== 0
      ) {
        throw new Error(`${label} parent must not be group/world writable`);
      }
      let descriptor = null;
      let created = false;
      try {
        descriptor = fs.openSync(canonicalPath, "wx", 0o600);
        created = true;
        fs.writeFileSync(descriptor, contents, "utf8");
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        if (process.platform !== "win32") fs.fsyncSync(parentDescriptor);
        return canonicalPath;
      } catch (error) {
        if (descriptor !== null) {
          try {
            fs.closeSync(descriptor);
          } catch {
            /* Preserve the authoritative write failure. */
          }
        }
        if (created) {
          try {
            fs.unlinkSync(canonicalPath);
          } catch {
            /* Clean only the file exclusively created by this attempt. */
          }
        }
        throw error;
      }
    },
  );
}

function canonicalTimestamp(value, label) {
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

function publicKeyBinding(value, label) {
  let publicKey;
  try {
    publicKey = createPublicKey(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError(`${label} must be Ed25519`);
  }
  const spki = publicKey.export({ type: "spki", format: "der" });
  return Object.freeze({
    keyId: `key:ed25519:${createHash("sha256").update(spki).digest("hex")}`,
    publicKeySpki: spki.toString("base64url"),
  });
}

function normalizeOperation(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["register", "rotate", "revoke"].includes(value.operation) ||
    !SERVICE_ID.test(value.serviceId ?? "")
  ) {
    throw new TypeError("attestor trust operation file is invalid");
  }
  if (value.operation === "register") {
    exact(
      value,
      new Set(["operation", "publicKey", "serviceId"]),
      "attestor trust registration operation",
    );
    return Object.freeze({
      input: value,
      expected: {
        operation: value.operation,
        serviceId: value.serviceId,
        priorKeyId: null,
        reason: null,
        ...publicKeyBinding(value.publicKey, "attestor public key"),
      },
    });
  }
  if (value.operation === "rotate") {
    exact(
      value,
      new Set(["operation", "priorKeyId", "publicKey", "reason", "serviceId"]),
      "attestor trust rotation operation",
    );
    const key = publicKeyBinding(value.publicKey, "attestor public key");
    if (
      !KEY_ID.test(value.priorKeyId ?? "") ||
      value.priorKeyId === key.keyId ||
      typeof value.reason !== "string" ||
      value.reason.trim() !== value.reason ||
      value.reason.length < 1 ||
      value.reason.length > 2048
    ) {
      throw new TypeError("attestor trust rotation operation is invalid");
    }
    return Object.freeze({
      input: value,
      expected: {
        operation: value.operation,
        serviceId: value.serviceId,
        priorKeyId: value.priorKeyId,
        reason: value.reason,
        ...key,
      },
    });
  }
  exact(
    value,
    new Set(["keyId", "operation", "reason", "serviceId"]),
    "attestor trust revocation operation",
  );
  if (
    !KEY_ID.test(value.keyId ?? "") ||
    typeof value.reason !== "string" ||
    value.reason.trim() !== value.reason ||
    value.reason.length < 1 ||
    value.reason.length > 2048
  ) {
    throw new TypeError("attestor trust revocation operation is invalid");
  }
  return Object.freeze({
    input: value,
    expected: {
      operation: value.operation,
      serviceId: value.serviceId,
      keyId: value.keyId,
      publicKeySpki: null,
      priorKeyId: null,
      reason: value.reason,
    },
  });
}

function normalizeOperatorChangeOperation(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["register", "rotate", "revoke"].includes(value.operation) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(value.operatorId ?? "")
  ) {
    throw new TypeError("operator registry change operation is invalid");
  }
  if (value.operation === "register") {
    exact(
      value,
      new Set(["operation", "operatorId", "publicKey"]),
      "operator registration operation",
    );
    return Object.freeze({
      input: value,
      expected: {
        operation: value.operation,
        operatorId: value.operatorId,
        priorKeyId: null,
        reason: null,
        ...publicKeyBinding(value.publicKey, "operator public key"),
      },
    });
  }
  if (value.operation === "rotate") {
    exact(
      value,
      new Set(["operation", "operatorId", "priorKeyId", "publicKey", "reason"]),
      "operator rotation operation",
    );
    const key = publicKeyBinding(value.publicKey, "operator public key");
    if (
      !KEY_ID.test(value.priorKeyId ?? "") ||
      value.priorKeyId === key.keyId ||
      typeof value.reason !== "string" ||
      value.reason.trim() !== value.reason ||
      value.reason.length < 1 ||
      value.reason.length > 2048
    ) {
      throw new TypeError("operator rotation operation is invalid");
    }
    return Object.freeze({
      input: value,
      expected: {
        operation: value.operation,
        operatorId: value.operatorId,
        priorKeyId: value.priorKeyId,
        reason: value.reason,
        ...key,
      },
    });
  }
  exact(
    value,
    new Set(["keyId", "operation", "operatorId", "reason"]),
    "operator revocation operation",
  );
  if (
    !KEY_ID.test(value.keyId ?? "") ||
    typeof value.reason !== "string" ||
    value.reason.trim() !== value.reason ||
    value.reason.length < 1 ||
    value.reason.length > 2048
  ) {
    throw new TypeError("operator revocation operation is invalid");
  }
  return Object.freeze({
    input: value,
    expected: {
      operation: value.operation,
      operatorId: value.operatorId,
      keyId: value.keyId,
      publicKeySpki: null,
      priorKeyId: null,
      reason: value.reason,
    },
  });
}

function validatePreparedRequest(value, service, currentTime) {
  if (!Number.isFinite(currentTime)) {
    throw new TypeError("attestor trust operations CLI clock is invalid");
  }
  exact(value, REQUEST_KEYS, "prepared attestor trust request");
  const requestedAt = canonicalTimestamp(value.requestedAt, "requestedAt");
  const expiresAt = canonicalTimestamp(value.expiresAt, "expiresAt");
  if (
    value.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA ||
    value.tenantId !== service.tenantId ||
    value.policyDigest !== service.policyDigest ||
    value.requiredApprovals !== service.requiredApprovals ||
    !DIGEST.test(value.requestDigest ?? "") ||
    !SERVICE_ID.test(value.serviceId ?? "") ||
    !KEY_ID.test(value.keyId ?? "") ||
    !["register", "rotate", "revoke"].includes(value.operation) ||
    requestedAt > currentTime + FUTURE_SKEW_MS ||
    expiresAt <= currentTime ||
    expiresAt <= requestedAt ||
    expiresAt > requestedAt + MAX_REQUEST_TTL_MS ||
    value.requestDigest !==
      digestGovernedSkillSynthesisAttestorTrustOperationRequest(value)
  ) {
    throw new Error("prepared attestor trust request is not policy-bound");
  }
  if (value.operation === "register" || value.operation === "rotate") {
    if (typeof value.publicKeySpki !== "string") {
      throw new Error("prepared attestor trust public key is missing");
    }
    let publicKey;
    try {
      const bytes = Buffer.from(value.publicKeySpki, "base64url");
      if (bytes.toString("base64url") !== value.publicKeySpki)
        throw new Error();
      publicKey = createPublicKey({ key: bytes, type: "spki", format: "der" });
    } catch {
      throw new Error("prepared attestor trust public key is invalid");
    }
    const keyId = `key:ed25519:${createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex")}`;
    if (publicKey.asymmetricKeyType !== "ed25519" || keyId !== value.keyId) {
      throw new Error("prepared attestor trust public key binding is invalid");
    }
    if (
      (value.operation === "register" &&
        (value.priorKeyId !== null || value.reason !== null)) ||
      (value.operation === "rotate" &&
        (!KEY_ID.test(value.priorKeyId ?? "") ||
          value.priorKeyId === value.keyId ||
          typeof value.reason !== "string" ||
          value.reason.trim() !== value.reason ||
          value.reason.length < 1 ||
          value.reason.length > 2048))
    ) {
      throw new Error("prepared attestor trust operation fields are invalid");
    }
  } else if (
    value.publicKeySpki !== null ||
    value.priorKeyId !== null ||
    typeof value.reason !== "string" ||
    value.reason.trim() !== value.reason ||
    value.reason.length < 1 ||
    value.reason.length > 2048
  ) {
    throw new Error("prepared attestor trust revocation fields are invalid");
  }
  return Object.freeze(structuredClone(value));
}

function bindPreparedRequest(request, expected) {
  for (const field of [
    "operation",
    "serviceId",
    "keyId",
    "publicKeySpki",
    "priorKeyId",
    "reason",
  ]) {
    if (request[field] !== expected[field]) {
      throw new Error(
        "prepared attestor trust request substituted its operation",
      );
    }
  }
  return request;
}

function bindPreparedOperatorChangeRequest(request, expected) {
  for (const field of [
    "operation",
    "operatorId",
    "keyId",
    "publicKeySpki",
    "priorKeyId",
    "reason",
  ]) {
    if (request[field] !== expected[field]) {
      throw new Error("prepared operator change substituted its operation");
    }
  }
  return request;
}

function readApprovalFiles(approvalPaths, requiredApprovals) {
  if (
    !Array.isArray(approvalPaths) ||
    approvalPaths.length !== requiredApprovals ||
    approvalPaths.length > MAX_APPROVAL_FILES
  ) {
    throw new Error(
      `exactly ${requiredApprovals} approval file(s) are required`,
    );
  }
  const normalizedPaths = approvalPaths.map((entry) =>
    filePath(entry, "approval file path"),
  );
  const comparablePaths = normalizedPaths.map((entry) =>
    process.platform === "win32" ? entry.toLowerCase() : entry,
  );
  if (new Set(comparablePaths).size !== comparablePaths.length) {
    throw new Error("approval file paths must be distinct");
  }
  return normalizedPaths.map((entry) => readSecureJson(entry, "approval file"));
}

export function createGovernedSkillSynthesisAttestorTrustOperationsCliHost({
  approvalClient = null,
  client,
  now = Date.now,
} = {}) {
  if (!isGovernedSkillSynthesisAttestorTrustOperationsClient(client)) {
    throw new TypeError(
      "a branded attestor trust operations client is required",
    );
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("attestor trust operations CLI clock is invalid");
  }
  if (
    approvalClient !== null &&
    !isGovernedSkillSynthesisAttestorTrustApprovalClient(approvalClient)
  ) {
    throw new TypeError("approvalClient must be a branded approval client");
  }
  const prepareRemote = client.prepare.bind(client);
  const executeRemote = client.execute.bind(client);
  const prepareOperatorChangeRemote = client.prepareOperatorChange.bind(client);
  const executeOperatorChangeRemote = client.executeOperatorChange.bind(client);
  const service = client.descriptor.service;
  const approvalService = approvalClient?.descriptor.service ?? null;
  if (approvalService && approvalService.tenantId !== service.tenantId) {
    throw new Error("approval signer crossed the operations tenant boundary");
  }
  const approveRemote = approvalClient?.approve.bind(approvalClient) ?? null;
  const approveOperatorChangeRemote =
    approvalClient?.approveOperatorChange.bind(approvalClient) ?? null;
  const descriptor = Object.freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_CLI_HOST_SCHEMA,
    clientSchema:
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_CLIENT_SCHEMA,
    isolation: client.descriptor.isolation,
    transport: client.descriptor.transport,
    endpointDigest: client.descriptor.endpointDigest,
    approvalSigner:
      approvalService === null
        ? null
        : Object.freeze({
            isolation: approvalClient.descriptor.isolation,
            transport: approvalClient.descriptor.transport,
            endpointDigest: approvalClient.descriptor.endpointDigest,
            signerId: approvalService.signerId,
            operatorId: approvalService.operatorId,
            keyId: approvalService.keyId,
          }),
    service: Object.freeze(structuredClone(service)),
  });
  const host = Object.freeze({
    descriptor,
    async prepare(input) {
      exact(
        input,
        new Set(["operationPath", "outputPath"]),
        "attestor trust prepare CLI input",
      );
      const operation = normalizeOperation(
        readSecureJson(input.operationPath, "operation file"),
      );
      const request = bindPreparedRequest(
        validatePreparedRequest(
          await prepareRemote(operation.input),
          service,
          Number(now()),
        ),
        operation.expected,
      );
      const outputPath = writeExclusiveJson(
        input.outputPath,
        request,
        "request plan",
      );
      return Object.freeze({
        created: true,
        outputPath,
        requestDigest: request.requestDigest,
        operation: request.operation,
        serviceId: request.serviceId,
        requiredApprovals: request.requiredApprovals,
        expiresAt: request.expiresAt,
      });
    },
    async execute(input) {
      exact(
        input,
        new Set(["approvalPaths", "requestPath"]),
        "attestor trust execute CLI input",
      );
      const approvals = readApprovalFiles(
        input.approvalPaths,
        service.requiredApprovals,
      );
      const request = validatePreparedRequest(
        readSecureJson(input.requestPath, "request plan"),
        service,
        Number(now()),
      );
      return executeRemote({ request, approvals });
    },
    async approve(input) {
      exact(
        input,
        new Set(["outputPath", "requestPath"]),
        "attestor trust approve CLI input",
      );
      if (!approveRemote) {
        throw new Error("attestor trust approval signer is unavailable");
      }
      const request = validatePreparedRequest(
        readSecureJson(input.requestPath, "request plan"),
        service,
        Number(now()),
      );
      const approval = await approveRemote(request);
      const outputPath = writeExclusiveJson(
        input.outputPath,
        approval,
        "approval receipt",
      );
      return Object.freeze({
        created: true,
        outputPath,
        requestDigest: request.requestDigest,
        receiptDigest: approval.receiptDigest,
        operatorId: approval.operatorId,
        keyId: approval.attestation.keyId,
        expiresAt: approval.expiresAt,
      });
    },
    async prepareOperatorChange(input) {
      exact(
        input,
        new Set(["operationPath", "outputPath"]),
        "operator change prepare CLI input",
      );
      const operation = normalizeOperatorChangeOperation(
        readSecureJson(input.operationPath, "operator change operation file"),
      );
      const request = bindPreparedOperatorChangeRequest(
        validateGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
          await prepareOperatorChangeRemote(operation.input),
          {
            tenantId: service.tenantId,
            policyId: service.policyId,
            revision: service.revision,
            policyDigest: service.policyDigest,
            requiredApprovals: service.requiredApprovals,
          },
          Number(now()),
        ),
        operation.expected,
      );
      const outputPath = writeExclusiveJson(
        input.outputPath,
        request,
        "operator change request plan",
      );
      return Object.freeze({
        created: true,
        outputPath,
        requestDigest: request.requestDigest,
        operation: request.operation,
        operatorId: request.operatorId,
        requiredApprovals: request.requiredApprovals,
        revision: request.revision,
        expiresAt: request.expiresAt,
      });
    },
    async executeOperatorChange(input) {
      exact(
        input,
        new Set(["approvalPaths", "requestPath"]),
        "operator change execute CLI input",
      );
      const approvals = readApprovalFiles(
        input.approvalPaths,
        service.requiredApprovals,
      );
      const request =
        validateGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
          readSecureJson(input.requestPath, "operator change request plan"),
          {
            tenantId: service.tenantId,
            policyId: service.policyId,
            revision: service.revision,
            policyDigest: service.policyDigest,
            requiredApprovals: service.requiredApprovals,
          },
          Number(now()),
        );
      return executeOperatorChangeRemote({ request, approvals });
    },
    async approveOperatorChange(input) {
      exact(
        input,
        new Set(["outputPath", "requestPath"]),
        "operator change approve CLI input",
      );
      if (!approveOperatorChangeRemote) {
        throw new Error("attestor trust approval signer is unavailable");
      }
      const request =
        validateGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
          readSecureJson(input.requestPath, "operator change request plan"),
          {
            tenantId: service.tenantId,
            policyId: service.policyId,
            revision: service.revision,
            policyDigest: service.policyDigest,
            requiredApprovals: service.requiredApprovals,
          },
          Number(now()),
        );
      const approval = await approveOperatorChangeRemote(request);
      const outputPath = writeExclusiveJson(
        input.outputPath,
        approval,
        "operator change approval receipt",
      );
      return Object.freeze({
        created: true,
        outputPath,
        requestDigest: request.requestDigest,
        receiptDigest: approval.receiptDigest,
        operatorId: approval.operatorId,
        keyId: approval.attestation.keyId,
        expiresAt: approval.expiresAt,
      });
    },
  });
  HOSTS.add(host);
  return host;
}

export function isGovernedSkillSynthesisAttestorTrustOperationsCliHost(value) {
  return HOSTS.has(value);
}
