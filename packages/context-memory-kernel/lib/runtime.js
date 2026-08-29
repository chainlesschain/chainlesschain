"use strict";

const { randomUUID } = require("node:crypto");
const {
  MEMORY_RECEIPT_SCHEMA,
  DELETION_RECEIPT_SCHEMA,
  CONTEXT_ERROR_CODES,
} = require("./constants.js");
const { canonicalDigest, cloneCanonical } = require("./canonical.js");
const { planContext } = require("./planner.js");
const { compactContextWithPorts } = require("./compaction.js");
const {
  createMemoryCandidate,
  applyMemoryCommand,
  rankMemoryRecords,
} = require("./memory-reducer.js");
const {
  boundedString,
  boundedInteger,
  identifier,
  objectValue,
  assertKnownFields,
  assertScope,
} = require("./contracts.js");
const { invalidArgument, kernelError } = require("./errors.js");

function nowIso(clock) {
  const epoch = Number(clock());
  if (!Number.isFinite(epoch)) throw invalidArgument("clock returned an invalid timestamp");
  return new Date(epoch).toISOString();
}

class ContextMemoryKernel {
  constructor({
    sessionPort = null,
    memoryPort = null,
    contentPort = null,
    purgePorts = [],
    reconciliationPort = null,
    authorityRegistry = null,
    writer = null,
    mode = "canonical",
    clock = Date.now,
    randomUUID: uuid = randomUUID,
  } = {}) {
    if (!["shadow", "canonical"].includes(mode)) {
      throw invalidArgument("Kernel mode must be shadow or canonical");
    }
    if (!Array.isArray(purgePorts) || purgePorts.length > 128) {
      throw invalidArgument("purgePorts must be a bounded array");
    }
    this.ports = { session: sessionPort, memory: memoryPort, content: contentPort };
    this.purgePorts = purgePorts;
    this.reconciliationPort =
      reconciliationPort ||
      (memoryPort &&
      typeof memoryPort.getReconciliation === "function" &&
      typeof memoryPort.putReconciliation === "function"
        ? memoryPort
        : null);
    this.authorityRegistry = authorityRegistry;
    this.writer = writer;
    this.mode = mode;
    this.clock = clock;
    this.randomUUID = uuid;
    this.pendingReconciliation = new Map();
  }

  _assertMutationAuthority() {
    if (this.mode !== "canonical") {
      throw kernelError(
        CONTEXT_ERROR_CODES.LEGACY_WRITER_FENCED,
        "shadow Context/Memory Kernel cannot mutate authority state",
      );
    }
    if (this.authorityRegistry) {
      if (!this.writer) throw invalidArgument("writer identity is required when authorityRegistry is configured");
      this.authorityRegistry.assertWriter(this.writer);
    }
  }

  _requireMemoryPort() {
    if (
      !this.ports.memory ||
      typeof this.ports.memory.read !== "function" ||
      typeof this.ports.memory.query !== "function" ||
      typeof this.ports.memory.commit !== "function" ||
      typeof this.ports.memory.getRevision !== "function"
    ) {
      throw invalidArgument("MemoryPort must provide read, query, commit, and getRevision");
    }
    return this.ports.memory;
  }

  async _getReconciliation(requestId) {
    if (this.reconciliationPort) return this.reconciliationPort.getReconciliation(requestId);
    return cloneCanonical(this.pendingReconciliation.get(requestId) || null);
  }

  async _putReconciliation(operation) {
    if (this.reconciliationPort) {
      await this.reconciliationPort.putReconciliation(operation);
      return;
    }
    this.pendingReconciliation.set(operation.requestId, cloneCanonical(operation));
  }

  async planContext(request) {
    return planContext(request);
  }

  async compactContext(request) {
    this._assertMutationAuthority();
    return compactContextWithPorts(request, this.ports, {
      randomUUID: this.randomUUID,
      clock: this.clock,
    });
  }

  async recallMemory(request) {
    const port = this._requireMemoryPort();
    const records = await port.query(request);
    const result = rankMemoryRecords(records, request);
    return { ...result, memoryRevision: await port.getRevision() };
  }

  async proposeMemory(request) {
    this._assertMutationAuthority();
    const port = this._requireMemoryPort();
    const record = createMemoryCandidate(request, {
      clock: this.clock,
      randomUUID: this.randomUUID,
    });
    const at = record.createdAt;
    const event = {
      schema: "chainlesschain.memory-event/v1",
      eventId: `memory-event-${this.randomUUID()}`,
      type: record.state === "active" ? "memory.activated" : "memory.candidate.created",
      memoryId: record.memoryId,
      fromState: null,
      toState: record.state,
      previousRevision: 0,
      revision: record.revision,
      recordDigest: record.digest,
      at,
    };
    event.digest = canonicalDigest(event, "chainlesschain.memory-event/v1");
    const committed = await port.commit({ record, event }, 0);
    if (!committed?.ok) {
      throw kernelError(CONTEXT_ERROR_CODES.REVISION_CONFLICT, "memory ID already exists", {
        memoryId: record.memoryId,
        currentRevision: committed?.currentRevision,
      });
    }
    const receipt = {
      schema: MEMORY_RECEIPT_SCHEMA,
      operation: "propose",
      status: "committed",
      memoryId: record.memoryId,
      previousRevision: 0,
      revision: record.revision,
      storeRevision: committed.storeRevision,
      recordDigest: record.digest,
      eventDigest: event.digest,
      at,
    };
    receipt.digest = canonicalDigest(receipt, "chainlesschain.memory-receipt/v1");
    return { record, event, receipt };
  }

  async decideMemory(input) {
    this._assertMutationAuthority();
    const value = objectValue(input, "MemoryDecisionCommand");
    const memoryId = identifier(value.memoryId, "memoryId");
    const command = { ...value };
    delete command.memoryId;
    const port = this._requireMemoryPort();
    const current = await port.read(memoryId);
    if (!current) throw invalidArgument("memory record does not exist", { memoryId });
    const mutation = applyMemoryCommand(current, command, {
      clock: this.clock,
      randomUUID: this.randomUUID,
    });
    const committed = await port.commit(
      { record: mutation.record, event: mutation.event },
      current.revision,
    );
    if (!committed?.ok) {
      throw kernelError(CONTEXT_ERROR_CODES.REVISION_CONFLICT, "memory changed before command commit", {
        memoryId,
        expectedRevision: current.revision,
        currentRevision: committed?.currentRevision,
      });
    }
    mutation.receipt.storeRevision = committed.storeRevision;
    delete mutation.receipt.digest;
    mutation.receipt.digest = canonicalDigest(mutation.receipt, "chainlesschain.memory-receipt/v1");
    return mutation;
  }

  async _runPurgeTargets(operation) {
    const targets = [];
    if (operation.contentRef) {
      targets.push({
        store: operation.contentRef.store,
        run: () => {
          if (!this.ports.content || typeof this.ports.content.purge !== "function") {
            throw invalidArgument("ContentPort is required to purge memory contentRef");
          }
          return this.ports.content.purge(operation.contentRef, operation.fence);
        },
      });
    }
    for (const [index, port] of this.purgePorts.entries()) {
      if (!port || typeof port.purge !== "function") {
        throw invalidArgument("each purge port must provide purge()");
      }
      targets.push({
        store: port.name || `projection-${index}`,
        run: () => port.purge({ memoryId: operation.memoryId, fence: operation.fence }),
      });
    }
    const settled = await Promise.allSettled(targets.map((target) => target.run()));
    return settled.map((result, index) =>
      result.status === "fulfilled"
        ? { store: targets[index].store, status: "purged", receipt: cloneCanonical(result.value) }
        : {
            store: targets[index].store,
            status: "pending",
            error: {
              code: String(result.reason?.code || "purge_failed").slice(0, 128),
            },
          },
    );
  }

  _deletionReceipt(operation, status, record, stores) {
    const receipt = {
      schema: DELETION_RECEIPT_SCHEMA,
      schemaVersion: 1,
      requestId: operation.requestId,
      subject: operation.subject,
      selector: operation.selector,
      scope: operation.scope,
      ...(operation.scopeId ? { scopeId: operation.scopeId } : {}),
      memoryId: operation.memoryId,
      fence: operation.fence,
      authority: operation.authority,
      status,
      revision: record.revision,
      recordState: record.state,
      recordDigest: record.digest,
      stores: [
        {
          store: this.ports.memory?.name || "memory-authority",
          status: status === "purged" ? "purged" : "tombstoned",
          revision: record.revision,
        },
        ...stores,
      ],
      startedAt: operation.startedAt,
      completedAt: nowIso(this.clock),
    };
    receipt.digest = canonicalDigest(receipt, "chainlesschain.memory-deletion-receipt/v1");
    return receipt;
  }

  async deleteMemory(input) {
    this._assertMutationAuthority();
    const request = objectValue(input, "DeletionRequest");
    assertKnownFields(
      request,
      new Set([
        "requestId",
        "subject",
        "scope",
        "scopeId",
        "selector",
        "memoryId",
        "expectedRevision",
        "fence",
        "authority",
        "reason",
      ]),
      "DeletionRequest",
    );
    const memoryId = identifier(request.memoryId, "memoryId");
    const requestId = identifier(request.requestId, "requestId");
    const subject = identifier(request.subject, "subject");
    const selector = boundedString(request.selector, "selector", { min: 1, max: 512 });
    if (selector !== `memory:${memoryId}`) {
      throw invalidArgument("deletion selector must exactly bind the target memory ID");
    }
    const requestedScope = assertScope(request.scope, request.scopeId);
    const fence = identifier(request.fence, "fence");
    const expectedRevision = boundedInteger(request.expectedRevision, "expectedRevision", { min: 1 });
    const authority = identifier(request.authority, "authority");
    const port = this._requireMemoryPort();
    const existingOperation = await this._getReconciliation(requestId);
    if (existingOperation) {
      if (
        existingOperation.memoryId !== memoryId ||
        existingOperation.fence !== fence ||
        existingOperation.authority !== authority ||
        existingOperation.subject !== subject ||
        existingOperation.selector !== selector
      ) {
        throw kernelError(
          CONTEXT_ERROR_CODES.REVISION_CONFLICT,
          "deletion request ID was reused with different authority binding",
          { requestId },
        );
      }
      if (existingOperation.receipt) return cloneCanonical(existingOperation.receipt);
      return this.reconcile(requestId);
    }
    const current = await port.read(memoryId);
    if (!current) throw invalidArgument("memory record does not exist", { memoryId });
    if (current.scope !== requestedScope.scope || current.scopeId !== requestedScope.scopeId) {
      throw kernelError(CONTEXT_ERROR_CODES.SCOPE_DENIED, "deletion scope does not match memory authority", {
        memoryId,
      });
    }
    if (current.retentionPolicy.mode === "legal_hold") {
      throw kernelError(CONTEXT_ERROR_CODES.SCOPE_DENIED, "memory is under legal hold", {
        memoryId,
        legalHoldId: current.retentionPolicy.legalHoldId,
      });
    }
    const operation = {
      requestId,
      subject,
      selector,
      ...requestedScope,
      memoryId,
      fence,
      authority,
      expectedRevision,
      ...(request.reason ? { reason: request.reason } : {}),
      contentRef: current.contentRef || null,
      state: "prepared",
      stores: [],
      startedAt: nowIso(this.clock),
    };
    const deletion = applyMemoryCommand(
      current,
      {
        type: "delete",
        expectedRevision,
        deletionFence: fence,
        authority,
        ...(request.reason ? { reason: request.reason } : {}),
      },
      { clock: this.clock, randomUUID: this.randomUUID },
    );
    const tombstoneCommit = await port.commit(
      {
        record: deletion.record,
        event: deletion.event,
        reconciliation: { ...operation, state: "tombstoned" },
      },
      current.revision,
    );
    if (!tombstoneCommit?.ok) {
      throw kernelError(CONTEXT_ERROR_CODES.REVISION_CONFLICT, "memory changed before deletion tombstone commit", {
        memoryId,
        expectedRevision: current.revision,
        currentRevision: tombstoneCommit?.currentRevision,
      });
    }
    operation.state = "tombstoned";
    operation.tombstoneRevision = deletion.record.revision;
    await this._putReconciliation(operation);
    const stores = await this._runPurgeTargets(operation);
    operation.stores = stores;
    if (stores.some((entry) => entry.status !== "purged")) {
      operation.state = "purge_pending";
      await this._putReconciliation(operation);
      return this._deletionReceipt(operation, "partial", deletion.record, stores);
    }
    const purged = applyMemoryCommand(
      deletion.record,
      {
        type: "purge",
        expectedRevision: deletion.record.revision,
        deletionFence: fence,
        authority,
      },
      { clock: this.clock, randomUUID: this.randomUUID },
    );
    const purgeCommit = await port.commit(
      {
        record: purged.record,
        event: purged.event,
        reconciliation: { ...operation, state: "purged" },
      },
      deletion.record.revision,
    );
    if (!purgeCommit?.ok) {
      operation.state = "commit_pending";
      await this._putReconciliation(operation);
      return this._deletionReceipt(
        operation,
        "reconciliation_required",
        deletion.record,
        stores,
      );
    }
    const receipt = this._deletionReceipt(operation, "purged", purged.record, stores);
    operation.state = "purged";
    operation.receipt = receipt;
    await this._putReconciliation(operation);
    return receipt;
  }

  async reconcile(operationId) {
    this._assertMutationAuthority();
    const requestId = identifier(operationId, "operationId");
    if (typeof this.ports.session?.readCompactionOperation === "function") {
      const compaction = await this.ports.session.readCompactionOperation(requestId);
      if (compaction) return compaction;
    }
    const operation = await this._getReconciliation(requestId);
    if (!operation) return { operationId: requestId, status: "not_found" };
    if (operation.receipt) return cloneCanonical(operation.receipt);
    const port = this._requireMemoryPort();
    let current = await port.read(operation.memoryId);
    if (!current) {
      return { operationId: requestId, status: "reconciliation_required", reason: "tombstone_missing" };
    }
    if (current.state === "purged") {
      const receipt = this._deletionReceipt(operation, "purged", current, operation.stores || []);
      operation.state = "purged";
      operation.receipt = receipt;
      await this._putReconciliation(operation);
      return receipt;
    }
    if (current.state !== "deleted" && current.revision === operation.expectedRevision) {
      const deletion = applyMemoryCommand(
        current,
        {
          type: "delete",
          expectedRevision: operation.expectedRevision,
          deletionFence: operation.fence,
          authority: operation.authority,
          ...(operation.reason ? { reason: operation.reason } : {}),
        },
        { clock: this.clock, randomUUID: this.randomUUID },
      );
      const committed = await port.commit(
        {
          record: deletion.record,
          event: deletion.event,
          reconciliation: { ...operation, state: "tombstoned" },
        },
        current.revision,
      );
      if (!committed?.ok) {
        return {
          operationId: requestId,
          status: "reconciliation_required",
          reason: "tombstone_commit_conflict",
        };
      }
      current = deletion.record;
    }
    if (current.state !== "deleted" || current.deletionFence !== operation.fence) {
      return {
        operationId: requestId,
        status: "reconciliation_required",
        reason: "tombstone_fence_mismatch",
      };
    }
    const stores = await this._runPurgeTargets(operation);
    operation.stores = stores;
    if (stores.some((entry) => entry.status !== "purged")) {
      operation.state = "purge_pending";
      await this._putReconciliation(operation);
      return this._deletionReceipt(operation, "partial", current, stores);
    }
    const purged = applyMemoryCommand(
      current,
      {
        type: "purge",
        expectedRevision: current.revision,
        deletionFence: operation.fence,
        authority: operation.authority,
      },
      { clock: this.clock, randomUUID: this.randomUUID },
    );
    const committed = await port.commit(
      {
        record: purged.record,
        event: purged.event,
        reconciliation: { ...operation, state: "purged" },
      },
      current.revision,
    );
    if (!committed?.ok) {
      operation.state = "commit_pending";
      await this._putReconciliation(operation);
      return this._deletionReceipt(operation, "reconciliation_required", current, stores);
    }
    const receipt = this._deletionReceipt(operation, "purged", purged.record, stores);
    operation.state = "purged";
    operation.receipt = receipt;
    await this._putReconciliation(operation);
    return receipt;
  }

  async close() {
    await this.ports.session?.close?.();
    await this.ports.memory?.close?.();
    await this.ports.content?.close?.();
    if (this.reconciliationPort !== this.ports.memory) {
      await this.reconciliationPort?.close?.();
    }
    await this.authorityRegistry?.releaseWriter?.(this.writer);
  }
}

module.exports = { ContextMemoryKernel };
