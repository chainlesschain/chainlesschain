"use strict";

const { createHash } = require("node:crypto");
const { canonicalDigest, cloneCanonical } = require("./canonical.js");
const { normalizeContextItem, normalizeMemoryRecord } = require("./contracts.js");
const { CONTEXT_ERROR_CODES } = require("./constants.js");
const { kernelError } = require("./errors.js");

class InMemorySessionContextPort {
  constructor(seed = []) {
    this.sessions = new Map();
    this.operations = new Map();
    for (const entry of seed) this.seed(entry);
  }

  seed({ sessionId, head = "head:0", memoryRevision = 0, items = [] }) {
    this.sessions.set(sessionId, {
      sessionId,
      head,
      memoryRevision,
      items: items.map(normalizeContextItem),
      events: [],
      reconciliations: [],
    });
  }

  async readSnapshot(sessionId) {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    return cloneCanonical({
      sessionId: state.sessionId,
      head: state.head,
      memoryRevision: state.memoryRevision,
      items: state.items,
    });
  }

  async readCompactionOperation(operationId) {
    return cloneCanonical(this.operations.get(operationId) || null);
  }

  async appendCompaction(event, expectedHead) {
    const duplicate = this.operations.get(event.operationId);
    if (duplicate) return { ok: true, newHead: duplicate.newHead, idempotent: true };
    const state = this.sessions.get(event.sessionId);
    if (!state || state.head !== expectedHead) return { ok: false, currentHead: state?.head || null };
    state.events.push(cloneCanonical(event));
    if (Array.isArray(event.outputItems)) state.items = event.outputItems.map(normalizeContextItem);
    state.head = canonicalDigest(
      { previous: expectedHead, event: event.digest },
      "chainlesschain.session-head/v1",
    );
    const receipt = {
      ...cloneCanonical(event.receiptTemplate),
      newHead: state.head,
      eventDigest: event.digest,
    };
    receipt.digest = canonicalDigest(
      receipt,
      "chainlesschain.compaction-receipt/v1",
    );
    this.operations.set(event.operationId, receipt);
    return { ok: true, newHead: state.head };
  }

  async appendReconciliation(receipt, expectedHead) {
    const state = this.sessions.get(receipt.sessionId);
    if (!state || state.head !== expectedHead) return { ok: false, currentHead: state?.head || null };
    state.reconciliations.push(cloneCanonical(receipt));
    this.operations.set(receipt.operationId, cloneCanonical(receipt));
    return { ok: true, operationId: receipt.operationId };
  }

  events(sessionId) {
    return cloneCanonical(this.sessions.get(sessionId)?.events || []);
  }
}

class InMemoryMemoryPort {
  constructor(seed = []) {
    this.name = "in-memory-authority";
    this.records = new Map();
    this.events = [];
    this.reconciliations = new Map();
    this.revision = 0;
    for (const record of seed) {
      const normalized = normalizeMemoryRecord(record);
      this.records.set(normalized.memoryId, normalized);
      this.revision += 1;
    }
  }

  async read(memoryId) {
    return cloneCanonical(this.records.get(memoryId) || null);
  }

  async query() {
    return [...this.records.values()].map((record) => cloneCanonical(record));
  }

  async commit({ record, event, reconciliation }, expectedRevision = 0) {
    const normalized = normalizeMemoryRecord(record);
    const current = this.records.get(normalized.memoryId);
    const actualRevision = current?.revision || 0;
    if (actualRevision !== expectedRevision) {
      return { ok: false, currentRevision: actualRevision, storeRevision: this.revision };
    }
    this.records.set(normalized.memoryId, normalized);
    this.events.push(cloneCanonical(event));
    if (reconciliation) {
      this.reconciliations.set(reconciliation.requestId, cloneCanonical(reconciliation));
    }
    this.revision += 1;
    return {
      ok: true,
      revision: normalized.revision,
      storeRevision: this.revision,
      reconciliationStored: Boolean(reconciliation),
    };
  }

  async getRevision() {
    return this.revision;
  }

  async getReconciliation(requestId) {
    return cloneCanonical(this.reconciliations.get(requestId) || null);
  }

  async putReconciliation(operation) {
    this.reconciliations.set(operation.requestId, cloneCanonical(operation));
  }
}

class InMemoryContentPort {
  constructor() {
    this.objects = new Map();
  }

  async put(content, policy = {}) {
    const bytes = Buffer.from(content);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const objectId = policy.objectId || digest.slice(7, 39);
    const ref = {
      store: "in-memory-content",
      objectId,
      digest,
      byteLength: bytes.length,
      ...(policy.mimeType ? { mimeType: policy.mimeType } : {}),
      summary: policy.summary || "Stored content",
      recoverable: true,
      ...(policy.accessPolicy ? { accessPolicy: policy.accessPolicy } : {}),
    };
    this.objects.set(objectId, { bytes, policy: cloneCanonical(policy), ref });
    return cloneCanonical(ref);
  }

  async get(ref) {
    const entry = this.objects.get(ref.objectId);
    if (!entry) {
      throw kernelError(CONTEXT_ERROR_CODES.CONTENT_UNAVAILABLE, "content reference is unavailable", {
        objectId: ref.objectId,
      });
    }
    const digest = `sha256:${createHash("sha256").update(entry.bytes).digest("hex")}`;
    if (digest !== ref.digest) {
      throw kernelError(CONTEXT_ERROR_CODES.DIGEST_MISMATCH, "content digest mismatch", {
        objectId: ref.objectId,
      });
    }
    return Buffer.from(entry.bytes);
  }

  async purge(ref, fence) {
    const existed = this.objects.delete(ref.objectId);
    return { store: "in-memory-content", status: "purged", objectId: ref.objectId, fence, existed };
  }
}

class InMemoryProjectionPurgePort {
  constructor(name) {
    this.name = name;
    this.purged = new Map();
    this.failure = null;
  }

  failWith(error) {
    this.failure = error;
  }

  async purge({ memoryId, fence }) {
    if (this.failure) {
      const error = this.failure;
      this.failure = null;
      throw error;
    }
    this.purged.set(memoryId, fence);
    return { store: this.name, status: "purged", memoryId, fence };
  }
}

module.exports = {
  InMemorySessionContextPort,
  InMemoryMemoryPort,
  InMemoryContentPort,
  InMemoryProjectionPurgePort,
};
