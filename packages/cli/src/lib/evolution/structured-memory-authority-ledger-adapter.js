import { createHash } from "node:crypto";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";

const {
  STRUCTURED_MEMORY_RECEIPT_SCHEMA,
  STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA,
  createStructuredMemoryAuthorityReceipt,
  createStructuredMemoryReceiptProvider,
} = structuredMemory;

export const STRUCTURED_MEMORY_AUTHORITY_RECEIPT_EVENT_TYPE =
  "memory.authority-receipt.persisted";
export const STRUCTURED_MEMORY_AUTHORITY_LEDGER_CORRUPT_CODE =
  "CC_STRUCTURED_MEMORY_AUTHORITY_LEDGER_CORRUPT";

const ARTIFACT_TYPE = "structured-memory-authority-receipt";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function capture(owner, name) {
  if (typeof owner?.[name] !== "function")
    throw new TypeError(`${name} port is required`);
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function corrupt(message) {
  const error = new Error(message);
  error.code = STRUCTURED_MEMORY_AUTHORITY_LEDGER_CORRUPT_CODE;
  throw error;
}

function normalizeDescriptor(input) {
  if (
    !Number.isSafeInteger(input?.authorityRevision) ||
    input.authorityRevision <= 0
  ) {
    throw new TypeError("authorityRevision must be a positive integer");
  }
  if (!DIGEST.test(input?.handlerDigest || ""))
    throw new TypeError("handlerDigest must be sha256-bound");
  return Object.freeze({
    tenantId: requiredString(input.tenantId, "tenantId"),
    artifactTenantId: requiredString(
      input.artifactTenantId,
      "artifactTenantId",
    ),
    streamId: requiredString(input.streamId, "streamId"),
    audience: requiredString(input.audience, "audience"),
    purpose: requiredString(input.purpose, "purpose"),
    authorityId: requiredString(input.authorityId, "authorityId"),
    authorityRevision: input.authorityRevision,
    handlerDigest: input.handlerDigest,
  });
}

function validateCanonicalReceipt(receipt, tenantId) {
  if (
    receipt?.schema !== STRUCTURED_MEMORY_RECEIPT_SCHEMA ||
    receipt.tenantId !== tenantId ||
    !DIGEST.test(receipt.receiptDigest || "")
  )
    throw new TypeError("structured memory authority receipt is invalid");
  const normalized = createStructuredMemoryAuthorityReceipt(receipt);
  if (normalized.receiptDigest !== receipt.receiptDigest) {
    corrupt("structured memory authority receipt digest is invalid");
  }
  return receipt;
}

function parseResolution(resolution, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest || "") ||
    !DIGEST.test(resolution.receiptDigest || "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt(
      "structured memory receipt artifact resolution is unauthenticated or incomplete",
    );
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("structured memory receipt artifact is not JSON");
  }
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== ARTIFACT_TYPE
  )
    corrupt("structured memory receipt durable record binding is invalid");
  return validateCanonicalReceipt(record.value, descriptor.tenantId);
}

export class StructuredMemoryAuthorityLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    receiptVerifier,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical");
    this._read = capture(ledger, "read");
    this._verifyLedger = capture(ledger, "verify");
    this._append = capture(ledger, "appendDomainEvent");
    this._verifyReceipt = capture(receiptVerifier, "verify");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    this._resolveArtifact = ledgerArtifactResolver;
    Object.freeze(this);
  }

  _events() {
    const events = this._read();
    if (!Array.isArray(events))
      corrupt("EvolutionLedger did not return an event array");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === STRUCTURED_MEMORY_AUTHORITY_RECEIPT_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  _resolveEvent(event) {
    const identity = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest
    ) {
      corrupt("structured memory receipt ledger subject was substituted");
    }
    return parseResolution(resolution, this.descriptor);
  }

  async retainReceipt(receipt) {
    validateCanonicalReceipt(receipt, this.descriptor.tenantId);
    if (
      (await this._verifyReceipt({
        receipt,
        source: "retain",
        ledgerEvent: null,
      })) !== true
    ) {
      throw new Error(
        "structured memory authority receipt authentication failed",
      );
    }
    const eventId = `${STRUCTURED_MEMORY_AUTHORITY_RECEIPT_EVENT_TYPE}.${receipt.receiptDigest.slice(7)}`;
    const matching = this._events().filter(
      (event) => event.eventId === eventId,
    );
    if (matching.length > 1)
      corrupt("structured memory receipt has duplicate ledger events");
    if (matching.length === 1) {
      if (canonical(this._resolveEvent(matching[0])) !== canonical(receipt)) {
        corrupt("structured memory receipt id resolved substituted content");
      }
      return Object.freeze({
        persisted: true,
        recovered: true,
        receiptDigest: receipt.receiptDigest,
      });
    }
    const head = this._verifyLedger();
    const published = this._put(ARTIFACT_TYPE, receipt, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      published?.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    ) {
      corrupt(
        "structured memory receipt persistence was not durably confirmed",
      );
    }
    const previous = this._events().at(-1);
    const ledgerReceipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: "committed",
        eventId,
        reason: `${receipt.kind} structured memory authority receipt committed`,
        skillName: null,
        sourceRefs: previous ? [previous.subjectRef] : [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: receipt.issuedAt,
        type: STRUCTURED_MEMORY_AUTHORITY_RECEIPT_EVENT_TYPE,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      ledgerReceipt?.authenticated !== true ||
      ledgerReceipt.committed !== true ||
      ledgerReceipt.durable !== true ||
      ledgerReceipt.eventId !== eventId ||
      !DIGEST.test(ledgerReceipt.receiptDigest || "")
    ) {
      corrupt(
        "structured memory receipt ledger append was not durably confirmed",
      );
    }
    return Object.freeze({
      persisted: true,
      receiptDigest: receipt.receiptDigest,
      ledgerReceiptDigest: ledgerReceipt.receiptDigest,
    });
  }

  async listReceipts(kind) {
    if (
      !["critic", "evaluator", "promotion", "revocation", "policy"].includes(
        kind,
      )
    ) {
      throw new TypeError(
        "a structured memory authority receipt kind is required",
      );
    }
    const receipts = [];
    const seen = new Set();
    for (const event of this._events()) {
      const receipt = this._resolveEvent(event);
      if (receipt.kind !== kind) continue;
      if (seen.has(receipt.receiptDigest)) {
        corrupt("structured memory receipt digest is duplicated");
      }
      if (
        (await this._verifyReceipt({
          receipt,
          source: "resolve",
          ledgerEvent: event.eventDigest,
        })) !== true
      ) {
        throw new Error(
          "structured memory authority receipt authentication failed",
        );
      }
      seen.add(receipt.receiptDigest);
      receipts.push(Object.freeze(structuredClone(receipt)));
    }
    return Object.freeze(receipts);
  }

  createReceiptProvider() {
    const providerDescriptor = {
      tenantId: this.descriptor.tenantId,
      authorityId: this.descriptor.authorityId,
      authorityRevision: this.descriptor.authorityRevision,
      handlerDigest: this.descriptor.handlerDigest,
    };
    return createStructuredMemoryReceiptProvider({
      descriptor: providerDescriptor,
      resolver: {
        resolve: async (request) => {
          const eventId = `${STRUCTURED_MEMORY_AUTHORITY_RECEIPT_EVENT_TYPE}.${request.receiptDigest.slice(7)}`;
          const matches = this._events().filter(
            (event) => event.eventId === eventId,
          );
          if (matches.length !== 1)
            corrupt(
              "structured memory receipt ledger resolution is missing or ambiguous",
            );
          const receipt = this._resolveEvent(matches[0]);
          return Object.freeze({
            schema: STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA,
            authenticated: true,
            ...providerDescriptor,
            kind: request.kind,
            receiptDigest: request.receiptDigest,
            receipt,
            ledgerEventDigest: matches[0].eventDigest,
            resolutionReceiptDigest: hash({
              eventDigest: matches[0].eventDigest,
              receiptDigest: request.receiptDigest,
              subjectRef: matches[0].subjectRef,
            }),
          });
        },
      },
      verifier: {
        verify: async ({ request, resolution }) => {
          const eventId = `${STRUCTURED_MEMORY_AUTHORITY_RECEIPT_EVENT_TYPE}.${request.receiptDigest.slice(7)}`;
          const matches = this._events().filter(
            (event) => event.eventId === eventId,
          );
          if (
            matches.length !== 1 ||
            resolution.ledgerEventDigest !== matches[0].eventDigest
          )
            return false;
          return await this._verifyReceipt({
            receipt: resolution.receipt,
            source: "resolve",
            ledgerEvent: resolution.ledgerEventDigest,
          });
        },
      },
    });
  }
}

export function createStructuredMemoryAuthorityLedgerAdapter(options) {
  return new StructuredMemoryAuthorityLedgerAdapter(options);
}
