import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";
import { createWikiPruningPlanner } from "./governed-wiki-pruning.js";
import {
  pruningCanonical,
  verifyPruningJournalPlan,
} from "./governed-wiki-pruning-journal.js";

function capture(owner, name, label) {
  const method = owner?.[name];
  if (typeof method !== "function")
    throw new TypeError(`${label}.${name} is required`);
  return (...args) => Reflect.apply(method, owner, args);
}

function contextSnapshot(context) {
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    Object.keys(context).length !== 2 ||
    !Object.hasOwn(context, "mode") ||
    !Object.hasOwn(context, "checkpoint")
  )
    throw new TypeError("pruning authorization context is invalid");
  if (
    !["current", "checkpoint"].includes(context.mode) ||
    !context.checkpoint ||
    typeof context.checkpoint !== "object" ||
    Array.isArray(context.checkpoint)
  )
    throw new TypeError("pruning authorization checkpoint is required");
  // The branded reader validates all fields and authenticates this exact head
  // against its own ledger. A head from a different domain ledger is not enough.
  return Object.freeze({
    mode: context.mode,
    checkpoint: Object.freeze({ ...context.checkpoint }),
  });
}

// Combines a real immutable Wiki source with the SAME planner used by execute.
// wikiMaintenance must derive the exact ordered request digests from this plan
// and independently verify each successor's operation AND resulting state.
// A matching maintenance request digest or an echoed boolean is not an effect
// proof. The journal separately reauthenticates the individual provider receipts
// and enforces the enclosing ledger head CAS around asynchronous verification.
export class GovernedWikiPruningPlanAuthority {
  #reader;
  #resolveDeletion;
  #requests;
  #verifySuccessors;
  #descriptor;
  #streamId;
  #verify;

  constructor({
    descriptor,
    wikiLedgerAdapter,
    deletionReceipts,
    wikiMaintenance,
  } = {}) {
    this.#reader = captureWikiRevisionReader(wikiLedgerAdapter);
    if (
      typeof descriptor?.streamId !== "string" ||
      !descriptor.streamId.trim() ||
      descriptor.streamId.length > 256 ||
      descriptor.tenantId !== this.#reader.descriptor.tenantId
    )
      throw new TypeError("pruning plan authority scope is invalid");
    this.#streamId = descriptor.streamId;
    this.#resolveDeletion = capture(
      deletionReceipts,
      "resolve",
      "deletionReceipts",
    );
    this.#requests = capture(
      wikiMaintenance,
      "requestDigests",
      "wikiMaintenance",
    );
    this.#verifySuccessors = capture(
      wikiMaintenance,
      "verifySuccessors",
      "wikiMaintenance",
    );
    this.#descriptor = createWikiPruningPlanner({
      descriptor,
      ports: {
        loadWikiState: this.#reader.loadWiki,
        resolveDeletionReceipt: this.#resolveDeletion,
      },
    }).descriptor;
    this.#verify = (input) => this.#verifyPlan(input);
    Object.freeze(this);
  }

  // The returned facade calls the captured private implementation.
  verifier() {
    return Object.freeze({ verify: this.#verify });
  }

  async #verifyPlan({ plan: input, tenantId, streamId, context } = {}) {
    if (tenantId !== this.#descriptor.tenantId || streamId !== this.#streamId)
      throw new TypeError("pruning plan authorization scope is invalid");
    const plan = verifyPruningJournalPlan(input, tenantId);
    const capturedContext = contextSnapshot(context);
    const allowedMaintenanceRequestDigests = await this.#requests({
      plan,
      tenantId,
      streamId,
    });
    const query = {
      tenantId,
      stateDigest: plan.wikiStateDigest,
      allowedMaintenanceRequestDigests,
    };
    const history =
      capturedContext.mode === "current"
        ? this.#reader.resolveHistory(query)
        : this.#reader.resolveAtCheckpoint({
            ...query,
            checkpoint: capturedContext.checkpoint,
          });
    if (capturedContext.mode === "current") {
      const keys = [
        "epoch",
        "ledgerId",
        "identityDigest",
        "sequence",
        "headDigest",
      ];
      if (
        Object.keys(capturedContext.checkpoint).length !== keys.length ||
        keys.some(
          (key) =>
            !Object.hasOwn(capturedContext.checkpoint, key) ||
            capturedContext.checkpoint[key] !== history.ledgerHead[key],
        )
      ) {
        throw new Error(
          "pruning plan current ledger identity or head differs from the Wiki ledger",
        );
      }
    }
    const planner = createWikiPruningPlanner({
      descriptor: this.#descriptor,
      ports: {
        loadWikiState: () => history.source,
        resolveDeletionReceipt: this.#resolveDeletion,
      },
    });
    const rebuilt = await planner.plan({
      expectedStateDigest: plan.wikiStateDigest,
      effectiveAt: plan.effectiveAt,
      deletionReceiptDigests: plan.deletions.map(
        (entry) => entry.receiptDigest,
      ),
    });
    if (pruningCanonical(plan) !== pruningCanonical(rebuilt)) return false;
    return (
      (await this.#verifySuccessors({
        plan,
        history,
        tenantId,
        streamId,
        context: capturedContext,
      })) === true
    );
  }
}
