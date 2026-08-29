import {
  canonicalDigest,
  cloneCanonical,
} from "@chainlesschain/context-memory-kernel";
import {
  appendAuthorityEventIfHead,
  readVerifiedProjection,
} from "../../harness/jsonl-session-store.js";
import {
  contextItemsToMessages,
  messagesToContextItems,
} from "./message-adapter.js";

const COMPACTION_EVENT_TYPE = "compact";
const RECONCILIATION_EVENT_TYPE = "context_memory_reconciliation";

function receiptFromCompactionEvent(event) {
  const canonical = event?.data?.canonical;
  if (!canonical?.receiptTemplate || !canonical?.digest || !event?.hash) {
    return null;
  }
  const receipt = {
    ...cloneCanonical(canonical.receiptTemplate),
    newHead: event.hash,
    eventDigest: canonical.digest,
  };
  receipt.digest = canonicalDigest(
    receipt,
    "chainlesschain.compaction-receipt/v1",
  );
  return receipt;
}

function compactStats(event, messages) {
  const inputCount = Number(event?.metadata?.inputMessageCount || 0);
  const outputCount = messages.length;
  const originalTokens = Number(event?.metadata?.originalTokens || 0);
  const compressedTokens = event.outputItems.reduce(
    (total, item) => total + Number(item.tokenEstimate || 0),
    0,
  );
  return {
    strategy: event.strategy,
    originalMessages: inputCount,
    compressedMessages: outputCount,
    originalTokens,
    compressedTokens,
    saved: Math.max(0, originalTokens - compressedTokens),
    degraded: event.status === "degraded",
  };
}

/** SessionContextPort backed by the CLI's verified, anchored JSONL transcript. */
export class JsonlSessionContextPort {
  constructor({ sessionId, allowedSinks = ["*"] } = {}) {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new TypeError("JsonlSessionContextPort requires sessionId");
    }
    this.sessionId = sessionId.trim();
    this.allowedSinks = [...allowedSinks];
    this.ownedHeadAdvances = new Map();
  }

  _assertSession(sessionId) {
    if (sessionId !== this.sessionId) {
      throw new TypeError(
        `SessionContextPort is bound to ${this.sessionId}, not ${sessionId}`,
      );
    }
  }

  async readSnapshot(sessionId) {
    this._assertSession(sessionId);
    return readVerifiedProjection(sessionId, () => {
      let memoryRevision = 0;
      return {
        accept(event) {
          const revision = event?.data?.canonical?.memoryRevision;
          if (Number.isSafeInteger(revision) && revision >= memoryRevision) {
            memoryRevision = revision;
          }
        },
        finish: (authority) => ({
          sessionId,
          head: authority.headHash,
          memoryRevision,
          items: messagesToContextItems(authority.readMessages(), {
            sessionId,
            allowedSinks: this.allowedSinks,
          }),
        }),
      };
    });
  }

  async readCompactionOperation(operationId) {
    const sessionId = this.sessionId;
    return readVerifiedProjection(sessionId, () => {
      let receipt = null;
      let semanticUsageStart = null;
      return {
        accept(event) {
          if (
            event?.type === COMPACTION_EVENT_TYPE &&
            event?.data?.canonical?.operationId === operationId
          ) {
            receipt = receiptFromCompactionEvent(event);
          } else if (
            event?.type === RECONCILIATION_EVENT_TYPE &&
            event?.data?.receipt?.operationId === operationId
          ) {
            receipt = cloneCanonical(event.data.receipt);
          } else if (
            event?.type === "model_usage_started" &&
            event?.data?.source === "semantic-compaction" &&
            event?.data?.operationId === operationId
          ) {
            semanticUsageStart = event;
          }
        },
        finish(authority) {
          if (receipt || !semanticUsageStart) return receipt;
          const pending = {
            schema: "chainlesschain.context-compaction/v1",
            schemaVersion: 1,
            operationId,
            sessionId,
            status: "reconciliation_required",
            inputHead: semanticUsageStart.prevHash || null,
            currentHead: authority.headHash,
            startedAt: new Date(
              Number(semanticUsageStart.timestamp || Date.now()),
            ).toISOString(),
            lifecycle: [
              {
                state: "reconciliation_required",
                at: new Date(
                  Number(semanticUsageStart.timestamp || Date.now()),
                ).toISOString(),
                details: { code: "semantic_usage_without_compaction_commit" },
              },
            ],
          };
          pending.digest = canonicalDigest(
            pending,
            "chainlesschain.compaction-receipt/v1",
          );
          return pending;
        },
      };
    });
  }

  registerOwnedHeadAdvance({ operationId, fromHead, toHead }) {
    if (!operationId || !fromHead || !toHead) {
      throw new TypeError(
        "owned head advancement requires operation and heads",
      );
    }
    const existing = this.ownedHeadAdvances.get(operationId);
    if (
      existing &&
      (existing.fromHead !== fromHead || existing.toHead !== toHead)
    ) {
      throw new Error(
        "semantic compaction head advancement changed unexpectedly",
      );
    }
    this.ownedHeadAdvances.set(operationId, { fromHead, toHead });
  }

  _appendHead(operationId, expectedHead) {
    const advancement = this.ownedHeadAdvances.get(operationId);
    if (!advancement) return expectedHead;
    if (advancement.fromHead !== expectedHead) {
      throw new Error(
        "semantic compaction head advancement does not match input head",
      );
    }
    return advancement.toHead;
  }

  async appendCompaction(event, expectedHead) {
    this._assertSession(event.sessionId);
    const messages = contextItemsToMessages(event.outputItems);
    const stats = compactStats(event, messages);
    const appendHead = this._appendHead(event.operationId, expectedHead);
    try {
      const appended = appendAuthorityEventIfHead(
        this.sessionId,
        COMPACTION_EVENT_TYPE,
        {
          ...stats,
          messages,
          canonical: cloneCanonical(event),
        },
        appendHead,
      );
      this.ownedHeadAdvances.delete(event.operationId);
      return { ok: true, newHead: appended.hash };
    } catch (error) {
      if (error?.code !== "SESSION_REVISION_STALE") throw error;
      const snapshot = await this.readSnapshot(this.sessionId);
      return { ok: false, currentHead: snapshot?.head || null };
    }
  }

  async appendReconciliation(receipt, expectedHead) {
    this._assertSession(receipt.sessionId);
    const appendHead = this._appendHead(receipt.operationId, expectedHead);
    try {
      const appended = appendAuthorityEventIfHead(
        this.sessionId,
        RECONCILIATION_EVENT_TYPE,
        { receipt: cloneCanonical(receipt) },
        appendHead,
      );
      this.ownedHeadAdvances.delete(receipt.operationId);
      return { ok: true, newHead: appended.hash };
    } catch (error) {
      if (error?.code !== "SESSION_REVISION_STALE") throw error;
      const snapshot = await this.readSnapshot(this.sessionId);
      return { ok: false, currentHead: snapshot?.head || null };
    }
  }
}

export {
  COMPACTION_EVENT_TYPE,
  RECONCILIATION_EVENT_TYPE,
  receiptFromCompactionEvent,
};
