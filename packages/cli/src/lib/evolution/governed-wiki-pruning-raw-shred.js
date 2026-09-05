import { captureRawDeletionLedgerReader } from "./evolution-raw-deletion-ledger-adapter.js";
import {
  EvolutionRawCryptoShred,
  buildEvolutionRawCryptoShredRequest,
} from "./evolution-raw-crypto-shred.js";
import { captureWikiPruningJournalStore } from "./governed-wiki-pruning-ledger-adapter.js";
import {
  capturePruningData,
  pruningCanonical,
  pruningOperationCalls,
  verifyPruningJournalPlan,
} from "./governed-wiki-pruning-journal.js";

export const WIKI_PRUNING_KMS_PROOF_SCHEMA =
  "chainlesschain.wiki-pruning-kms-destruction-proof/v1";
const HEAD_KEYS = [
  "epoch",
  "ledgerId",
  "identityDigest",
  "sequence",
  "headDigest",
];
const headOf = (head) =>
  Object.fromEntries(HEAD_KEYS.map((key) => [key, head[key]]));
const same = (left, right) =>
  pruningCanonical(left) === pruningCanonical(right);
function fail(message) {
  const error = new Error(message);
  error.code = "CC_WIKI_PRUNING_RAW_SHRED_INVALID";
  throw error;
}
function capture(owner, name) {
  const method = owner?.[name];
  if (typeof method !== "function")
    throw new TypeError(`KMS ${name} is required`);
  return (...args) => Reflect.apply(method, owner, args);
}

// The deployment owns KMS/HSM authority. The repository owns plan/frontier
// authorization, actual shredder + retained tombstone integration, independent
// KMS proof resolution, historical causality and exact response-loss recovery.
export class GovernedWikiPruningRawShred {
  #reader;
  #shred;
  #resolveDestruction;
  constructor({ descriptor, deletionLedgerAdapter, keyAuthority } = {}) {
    this.descriptor = capturePruningData(descriptor);
    this.#reader = captureRawDeletionLedgerReader(
      deletionLedgerAdapter,
      descriptor.tenantId,
      descriptor.streamId,
    );
    const shredder = new EvolutionRawCryptoShred({
      tenantId: descriptor.tenantId,
      ports: this.#reader.cryptoShredPorts({
        destroyKey: capture(keyAuthority, "destroyKey"),
        confirmKeyDestroyed: capture(keyAuthority, "confirmKeyDestroyed"),
      }),
    });
    this.#shred = shredder.shred.bind(shredder);
    // Not an echoed destroy acknowledgement: this independently resolves the
    // original persisted destruction/confirmation evidence and key status.
    this.#resolveDestruction = capture(keyAuthority, "resolveDestruction");
    Object.freeze(this);
  }
  operationReceiptVerifier() {
    return Object.freeze({ verify: (input) => this.#verify(input) });
  }
  #call(plan, input) {
    const call = capturePruningData(input);
    const index = pruningOperationCalls(plan).findIndex((item) =>
      same(item, call),
    );
    if (
      index < 2 ||
      index >= 2 + plan.deletions.length ||
      call.request.operation !== "crypto-shred"
    )
      fail("Raw shred call differs from the exact planned deletion");
    return { call, index };
  }
  async #verify({
    plan: inputPlan,
    request,
    requestDigest,
    receipt: inputReceipt,
    tenantId,
    streamId,
    context,
  } = {}) {
    if (
      tenantId !== this.descriptor.tenantId ||
      streamId !== this.descriptor.streamId
    )
      return false;
    const plan = verifyPruningJournalPlan(inputPlan, tenantId);
    const { call } = this.#call(plan, { request, requestDigest });
    const receipt = capturePruningData(inputReceipt);
    const resolved = await this.#reader.resolveTombstone({
      tenantId,
      tombstoneDigest: receipt.tombstoneDigest,
      context: context ?? {
        mode: "current",
        checkpoint: headOf(this.#reader.head()),
      },
    });
    const verificationHead = resolved.ledgerHead;
    const destruction = buildEvolutionRawCryptoShredRequest(call, tenantId);
    const tombstone = resolved.tombstone;
    if (
      tombstone.pruningRequestDigest !== call.requestDigest ||
      tombstone.destructionRequestDigest !== destruction.requestDigest ||
      tombstone.evidenceRef !== destruction.evidenceRef ||
      tombstone.rawArtifactRef !== destruction.rawArtifactRef ||
      tombstone.rawCipherDigest !== destruction.rawCipherDigest ||
      tombstone.deletionReceiptDigest !== destruction.deletionReceiptDigest
    )
      return false;
    const proof = capturePruningData(
      await this.#resolveDestruction({
        request: destruction,
        destructionReceiptDigest: tombstone.destructionReceiptDigest,
        confirmationReceiptDigest: tombstone.confirmationReceiptDigest,
      }),
    );
    if (
      !same(proof, {
        schema: WIKI_PRUNING_KMS_PROOF_SCHEMA,
        authenticated: true,
        durable: true,
        destroyed: true,
        tenantId,
        keyRef: destruction.keyRef,
        requestDigest: destruction.requestDigest,
        destructionReceiptDigest: tombstone.destructionReceiptDigest,
        confirmationReceiptDigest: tombstone.confirmationReceiptDigest,
      })
    )
      return false;
    if (!same(headOf(this.#reader.head()), verificationHead))
      fail("Raw deletion authority changed during KMS proof resolution");
    return same(receipt, {
      authenticated: true,
      durable: true,
      requestDigest: call.requestDigest,
      receiptDigest: resolved.ledgerEventDigest,
      tombstoneDigest: resolved.tombstoneDigest,
    });
  }
  createProvider(journalStore) {
    const journal = captureWikiPruningJournalStore(journalStore);
    if (
      journal.descriptor.tenantId !== this.descriptor.tenantId ||
      journal.descriptor.streamId !== this.descriptor.streamId
    )
      throw new TypeError("Raw shred journal scope differs");
    return Object.freeze({
      cryptoShred: (input) => this.#apply(journal, input),
    });
  }
  async #apply(journal, input) {
    const captured = capturePruningData(input);
    const resolution = await journal.load({
      tenantId: this.descriptor.tenantId,
    });
    if (!resolution.state)
      fail("Raw shred requires a durably prepared pruning plan");
    const plan = verifyPruningJournalPlan(
      resolution.state.plan,
      this.descriptor.tenantId,
    );
    const { call, index } = this.#call(plan, captured);
    const verification = (receipt, context) =>
      this.#verify({ ...call, ...this.descriptor, plan, receipt, context });
    if (resolution.state.operationReceipts.length > index) {
      const receipt = resolution.state.operationReceipts[index];
      if (
        !(await verification(receipt, {
          mode: "checkpoint",
          checkpoint: resolution.checkpoint,
        }))
      )
        fail("saved Raw shred receipt was substituted");
      return receipt;
    }
    if (
      resolution.state.phase !== "running" ||
      resolution.state.operationReceipts.length !== index
    )
      fail(
        "Raw shred requires the complete dependency/Wiki and prior deletion frontier",
      );
    if (!same(headOf(this.#reader.head()), resolution.ledgerHead))
      fail("Raw shred authorization is not on the current deletion ledger");
    // Repeated delivery uses the SAME deterministic KMS request. The provider
    // must reconcile its durable evidence, not issue another key destruction.
    const receipt = await this.#shred(call);
    if (
      !(await verification(receipt, {
        mode: "current",
        checkpoint: headOf(this.#reader.head()),
      }))
    )
      fail("Raw shred has no independently verified durable destruction proof");
    return receipt;
  }
}
