import { createHash } from "node:crypto";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";

const { createStructuredMemoryAuthorityReceipt } = structuredMemory;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HOST_DIGEST = /^[a-f0-9]{64}$/u;
const WRITERS = new WeakSet();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function requiredDigest(value, name) {
  if (!DIGEST.test(value || "")) {
    throw new TypeError(`${name} must be sha256-bound`);
  }
  return value;
}

function capture(owner, name) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`${name} port is required`);
  }
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function normalizeDescriptor(input) {
  if (
    !Number.isSafeInteger(input?.issuerRevision) ||
    input.issuerRevision < 1
  ) {
    throw new TypeError("issuerRevision must be a positive integer");
  }
  return Object.freeze({
    tenantId: requiredString(input.tenantId, "tenantId"),
    issuerId: requiredString(input.issuerId, "issuerId"),
    issuerRevision: input.issuerRevision,
    issuerHandlerDigest: requiredDigest(
      input.issuerHandlerDigest,
      "issuerHandlerDigest",
    ),
  });
}

function verifyConsumedApproval(adopted, operation) {
  const payload = adopted?.payload;
  if (
    !(
      (adopted?.adopted === true && adopted.replayed === false) ||
      (adopted?.adopted === false && adopted.replayed === true)
    ) ||
    !HOST_DIGEST.test(adopted.statementDigest || "") ||
    !HOST_DIGEST.test(adopted.receiptHash || "") ||
    payload?.status !== "consumed" ||
    payload.requestId !== operation.requestId ||
    payload.fingerprint !== operation.fingerprint ||
    payload.binding !== operation.binding
  ) {
    throw new Error(
      "policy receipt requires a durably adopted consumed approval",
    );
  }
  return payload;
}

export function createStructuredMemoryPolicyReceiptWriter({
  descriptor: input,
  authorityStore,
  attestor,
  clock = () => new Date().toISOString(),
} = {}) {
  const descriptor = normalizeDescriptor(input);
  const retainReceipt = capture(authorityStore, "retainReceipt");
  const attest = capture(attestor, "attest");
  if (typeof clock !== "function")
    throw new TypeError("clock must be a function");

  const writer = Object.freeze({
    descriptor,
    async retainConsumedApproval({ adopted, operation } = {}) {
      const payload = verifyConsumedApproval(adopted, operation || {});
      const issuedAt = requiredString(clock(), "issuedAt");
      if (!Number.isFinite(Date.parse(issuedAt))) {
        throw new TypeError("issuedAt must be an ISO timestamp");
      }
      const operationCore = Object.freeze({
        requestId: payload.requestId,
        fingerprint: payload.fingerprint,
        binding: payload.binding,
        toolName: operation.toolName ?? null,
        action: operation.action ?? null,
        workspace: operation.workspace ?? null,
        session: operation.session ?? null,
        targetEnv: operation.targetEnv ?? null,
        policyVersion: operation.policyVersion ?? null,
      });
      const receipt = createStructuredMemoryAuthorityReceipt({
        tenantId: descriptor.tenantId,
        kind: "policy",
        decision: "accepted",
        memoryId: `remote-approval:${payload.requestId}:${adopted.statementDigest}`,
        layer: "policy",
        action: "accept",
        contentDigest: hash(canonical(operationCore)),
        artifactRef: adopted.statementDigest,
        evidenceRefs: [adopted.receiptHash, adopted.statementDigest].sort(),
        issuerId: descriptor.issuerId,
        issuerRevision: descriptor.issuerRevision,
        issuerHandlerDigest: descriptor.issuerHandlerDigest,
        issuedAt,
      });
      const attestation = await attest({
        purpose: "structured-memory-policy-receipt",
        payloadDigest: receipt.receiptDigest,
        receipt,
        operation: operationCore,
      });
      if (attestation === null || attestation === undefined) {
        throw new Error("policy receipt attestor returned no attestation");
      }
      const signed = Object.freeze({ ...receipt, attestation });
      const retained = await retainReceipt(signed);
      if (
        retained?.persisted !== true ||
        retained.receiptDigest !== receipt.receiptDigest
      ) {
        throw new Error("policy receipt was not durably acknowledged");
      }
      return signed;
    },
  });
  WRITERS.add(writer);
  return writer;
}

export function captureStructuredMemoryPolicyReceiptWriter(value) {
  if (!WRITERS.has(value)) {
    throw new TypeError(
      "a branded structured memory policy writer is required",
    );
  }
  const captured = Object.freeze({
    descriptor: value.descriptor,
    retainConsumedApproval: capture(value, "retainConsumedApproval"),
  });
  WRITERS.add(captured);
  return captured;
}
