import {
  EvidenceBackedWikiMaintainer,
  WIKI_MAINTENANCE_REQUEST_SCHEMA,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";
import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";
import { captureWikiPruningJournalStore } from "./governed-wiki-pruning-ledger-adapter.js";
import {
  capturePruningData,
  pruningCanonical,
  pruningDigest,
  pruningOperationCalls,
  verifyPruningJournalPlan,
} from "./governed-wiki-pruning-journal.js";

export const WIKI_PRUNING_MAINTENANCE_RECEIPT_SCHEMA =
  "chainlesschain.wiki-pruning-maintenance-receipt/v1";
export const WIKI_PRUNING_DEPENDENCY_RECEIPT_SCHEMA =
  "chainlesschain.wiki-pruning-dependency-receipt/v1";
const RULES = Object.freeze({
  schema: "chainlesschain.wiki-pruning-maintenance-rules/v1",
  reducer:
    "evidence-backed-wiki-maintainer/v1+target-only-tombstone-projection/v1",
  batchSize: 128,
  evidenceSelection: "first-retained-ref-lexical",
  emptyActions: "no-op",
  nonTargetFacts: "preserve-verbatim",
  minCorroboratingSources: 2,
  decayHalfLifeDays: 30,
  staleConfidenceFloor: 0.2,
});
const RULES_DIGEST = pruningDigest(RULES.schema, RULES);
const MODEL = "deterministic:governed-wiki-pruning/v1";
const DEPENDENCY_RULES = Object.freeze({
  ...RULES,
  schema: "chainlesschain.wiki-pruning-dependency-rules/v1",
  disposition: "tombstone-only-without-skill-dependencies",
  duplicatePatterns: "one-tombstone-per-pattern-lexical",
});
const DEPENDENCY_RULES_DIGEST = pruningDigest(
  DEPENDENCY_RULES.schema,
  DEPENDENCY_RULES,
);
const HEAD_KEYS = [
  "epoch",
  "ledgerId",
  "identityDigest",
  "sequence",
  "headDigest",
];
const POLICY = Object.freeze({
  trustedProjectionRead: true,
  rawEvidenceRead: false,
  activeSkillWrite: false,
  shell: false,
  network: false,
  secretRead: false,
});

function fail(message) {
  const error = new Error(message);
  error.code = "CC_WIKI_PRUNING_MAINTENANCE_INVALID";
  throw error;
}
function same(left, right) {
  return pruningCanonical(left) === pruningCanonical(right);
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function matchHead(expected, actual) {
  return (
    expected &&
    Object.keys(expected).length === HEAD_KEYS.length &&
    HEAD_KEYS.every(
      (key) => Object.hasOwn(expected, key) && expected[key] === actual[key],
    )
  );
}

// Owns Wiki-only dependency tombstones and the later maintenance operation.
// Skill rollback is deliberately unsupported: a Wiki tombstone is NOT proof of
// an active release rollback. Key destruction and retrieval need their own
// independently verified providers. No Raw, shell, network or Skill-write access.
export class GovernedWikiPruningMaintenance {
  #reader;
  #commit;
  #maintainerDescriptor;

  constructor({ descriptor, wikiLedgerAdapter } = {}) {
    this.#reader = captureWikiRevisionReader(wikiLedgerAdapter);
    if (
      descriptor?.tenantId !== this.#reader.descriptor.tenantId ||
      typeof descriptor.streamId !== "string" ||
      !descriptor.streamId.trim() ||
      descriptor.streamId.length > 256
    )
      throw new TypeError("Wiki pruning maintenance scope is invalid");
    this.descriptor = Object.freeze({
      tenantId: descriptor.tenantId,
      streamId: descriptor.streamId,
      evolutionRunId: this.#reader.descriptor.evolutionRunId,
      rulesDigest: RULES_DIGEST,
    });
    // This is an own, frozen arrow function on a branded adapter, not a virtual
    // subclass method or a caller-supplied acknowledgement function.
    this.#commit = wikiLedgerAdapter.commitRevision;
    this.#maintainerDescriptor = Object.freeze({
      tenantId: this.descriptor.tenantId,
      evolutionRunId: this.descriptor.evolutionRunId,
      maintainerModel: MODEL,
      rulesDigest: RULES_DIGEST,
      minCorroboratingSources: RULES.minCorroboratingSources,
      decayHalfLifeDays: RULES.decayHalfLifeDays,
      staleConfidenceFloor: RULES.staleConfidenceFloor,
    });
    Object.freeze(this);
  }

  #plan(input) {
    return verifyPruningJournalPlan(input, this.descriptor.tenantId);
  }
  #dependencyParts(plan) {
    const targets = new Set();
    const evidenceRefs = new Set(
      plan.deletions.map((item) => item.evidenceRef),
    );
    for (const disposition of plan.dependencyDispositions) {
      if (
        !disposition ||
        typeof disposition !== "object" ||
        Array.isArray(disposition) ||
        Object.keys(disposition).length !== 4 ||
        disposition.action !== "tombstone" ||
        !Array.isArray(disposition.skillNames) ||
        disposition.skillNames.length !== 0 ||
        typeof disposition.patternId !== "string" ||
        !disposition.patternId.trim() ||
        !evidenceRefs.has(disposition.evidenceRef)
      )
        fail(
          "Wiki-only dependency disposition cannot authorize Skill rollback or unbound tombstones",
        );
      targets.add(disposition.patternId);
    }
    const operations = [...targets].sort().map((patternId) => ({
      type: "tombstone",
      patternId,
      reason: "privacy-deletion-dependency",
    }));
    return this.#batches(operations, pruningOperationCalls(plan)[0], true);
  }
  #batches(operations, call, dependency = false) {
    const count = Math.ceil(operations.length / RULES.batchSize);
    return Array.from({ length: count }, (_, index) => {
      const batch = operations.slice(
        index * RULES.batchSize,
        (index + 1) * RULES.batchSize,
      );
      return {
        dependency,
        operations: batch,
        requestDigest:
          count === 1
            ? call.requestDigest
            : pruningDigest(
                dependency
                  ? "chainlesschain.wiki-pruning-dependency-batch/v1"
                  : "chainlesschain.wiki-pruning-batch/v1",
                {
                  requestDigest: call.requestDigest,
                  index,
                  count,
                  operations: batch,
                },
              ),
      };
    });
  }
  #parts(plan) {
    for (const action of plan.patternActions) {
      if (
        !action ||
        typeof action !== "object" ||
        Array.isArray(action) ||
        Object.keys(action).length !== 3 ||
        action.type !== "tombstone" ||
        typeof action.patternId !== "string" ||
        typeof action.reason !== "string" ||
        !action.reason.trim()
      )
        fail(
          "Wiki pruning maintenance permits only exact planned tombstone operations",
        );
    }
    return [
      ...this.#dependencyParts(plan),
      ...this.#batches(plan.patternActions, pruningOperationCalls(plan)[1]),
    ];
  }
  authorityPorts() {
    return Object.freeze({
      requestDigests: ({ plan }) =>
        this.#parts(this.#plan(plan)).map((part) => part.requestDigest),
      verifySuccessors: ({ plan, history }) =>
        this.#verifySuccessors(this.#plan(plan), history),
    });
  }
  operationReceiptVerifier() {
    return Object.freeze({ verify: (input) => this.#verifyReceipt(input) });
  }

  async #derive(plan, source, part) {
    const ref = Object.keys(source.state.evidence ?? {}).sort()[0];
    if (!ref)
      fail(
        "Wiki pruning actions require retained authenticated evidence metadata",
      );
    // The source is authenticated immutable Wiki metadata. Reconstruct its
    // existing envelope; do not fabricate a new artifact ref or read Raw bytes.
    const core = source.state.evidence[ref];
    const evidence = { ...core, envelopeDigest: digestWikiState(core) };
    let revision = null;
    const maintainer = new EvidenceBackedWikiMaintainer({
      descriptor: part.dependency
        ? {
            ...this.#maintainerDescriptor,
            maintainerModel:
              "deterministic:governed-wiki-pruning-dependency/v1",
            rulesDigest: DEPENDENCY_RULES_DIGEST,
          }
        : this.#maintainerDescriptor,
      policy: POLICY,
      ports: Object.freeze({
        loadWiki: () => source,
        resolveEvidence: () => evidence,
        derive: () => ({ operations: part.operations }),
        commitRevision: ({ revision: next }) => {
          revision = next;
          return {
            committed: true,
            revisionId: next.revisionId,
            stateDigest: next.stateDigest,
            evolutionRunId: next.evolutionRunId,
          };
        },
      }),
    });
    await maintainer.maintain({
      evidenceRefs: [ref],
      effectiveAt: plan.effectiveAt,
      maintenanceRequest: {
        schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
        tenantId: plan.tenantId,
        requestDigest: part.requestDigest,
        requestId: `wiki-maintenance:${part.requestDigest.slice(7)}`,
      },
    });
    if (!revision)
      fail(
        "Wiki pruning replay unexpectedly reused an existing maintenance request",
      );
    // The general Maintainer also recalculates confidence for unrelated
    // patterns. Pruning has no authority to change their evidence thresholds,
    // lifecycle or actionability. Retain only the requested tombstones, their
    // audit entries and request bookkeeping; preserve all other facts verbatim.
    const scoped = structuredClone(source.state);
    const targets = new Set(
      part.operations.map((operation) => operation.patternId),
    );
    for (const id of targets) scoped.patterns[id] = revision.state.patterns[id];
    if (!Array.isArray(source.state.index))
      fail("Wiki pruning source index is invalid");
    scoped.index = source.state.index.filter(
      (entry) => !targets.has(entry.patternId),
    );
    scoped.revision = revision.revision;
    scoped.revisionId = revision.revisionId;
    scoped.maintenanceRequests = revision.state.maintenanceRequests;
    scoped.evolutionLog = revision.state.evolutionLog;
    return freeze({
      ...revision,
      state: scoped,
      stateDigest: digestWikiState(scoped),
    });
  }

  async #verifySuccessors(plan, history) {
    const parts = this.#parts(plan);
    if (
      history?.authenticated !== true ||
      history.tenantId !== plan.tenantId ||
      history.evolutionRunId !== this.descriptor.evolutionRunId ||
      history.source?.stateDigest !== plan.wikiStateDigest ||
      !Array.isArray(history.successors) ||
      history.successors.length > parts.length
    )
      return false;
    let source = history.source;
    for (const [index, entry] of history.successors.entries()) {
      const expected = await this.#derive(plan, source, parts[index]);
      if (!same(expected, entry.revision)) return false;
      source = {
        trusted: true,
        state: expected.state,
        stateDigest: expected.stateDigest,
      };
    }
    return (
      history.current?.stateDigest === source.stateDigest &&
      same(history.current.state, source.state)
    );
  }

  #history(plan, context = null) {
    const query = {
      tenantId: plan.tenantId,
      stateDigest: plan.wikiStateDigest,
      allowedMaintenanceRequestDigests: this.#parts(plan).map(
        (part) => part.requestDigest,
      ),
    };
    if (context === null) return this.#reader.resolveHistory(query);
    const captured = capturePruningData(context);
    if (
      Object.keys(captured).length !== 2 ||
      !Object.hasOwn(captured, "mode") ||
      !Object.hasOwn(captured, "checkpoint")
    )
      fail("Wiki pruning receipt authorization context is invalid");
    if (captured.mode === "checkpoint")
      return this.#reader.resolveAtCheckpoint({
        ...query,
        checkpoint: captured.checkpoint,
      });
    if (captured.mode !== "current")
      fail("Wiki pruning receipt requires current or checkpoint authorization");
    const history = this.#reader.resolveHistory(query);
    if (!matchHead(captured.checkpoint, history.ledgerHead))
      fail("Wiki pruning receipt ledger head differs from authorization");
    return history;
  }

  #receipt(plan, history, operationIndex) {
    const dependencyCount = this.#dependencyParts(plan).length;
    const start = operationIndex === 0 ? 0 : dependencyCount;
    const end =
      operationIndex === 0 ? dependencyCount : this.#parts(plan).length;
    const sourceStateDigest =
      start === 0
        ? plan.wikiStateDigest
        : history.successors[start - 1].revision.stateDigest;
    const resultStateDigest =
      end === 0
        ? plan.wikiStateDigest
        : history.successors[end - 1].revision.stateDigest;
    const schema =
      operationIndex === 0
        ? WIKI_PRUNING_DEPENDENCY_RECEIPT_SCHEMA
        : WIKI_PRUNING_MAINTENANCE_RECEIPT_SCHEMA;
    const core = {
      schema,
      authenticated: true,
      durable: true,
      tenantId: plan.tenantId,
      streamId: this.descriptor.streamId,
      requestDigest: pruningOperationCalls(plan)[operationIndex].requestDigest,
      planDigest: plan.planDigest,
      rulesDigest:
        operationIndex === 0 ? DEPENDENCY_RULES_DIGEST : RULES_DIGEST,
      sourceStateDigest,
      resultStateDigest,
      mode: start === end ? "noop" : "revisions",
      ledger: Object.fromEntries(
        ["epoch", "ledgerId", "identityDigest"].map((key) => [
          key,
          history.ledgerHead[key],
        ]),
      ),
      revisions: history.successors
        .slice(start, end)
        .map(({ revision, eventDigest, artifactRef }) => ({
          requestDigest: revision.maintenanceRequestDigest,
          revisionId: revision.revisionId,
          stateDigest: revision.stateDigest,
          eventDigest,
          artifactRef,
        })),
    };
    return capturePruningData({
      ...core,
      receiptDigest: pruningDigest(schema, core),
    });
  }

  async #verifyReceipt({
    plan: input,
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
    const plan = this.#plan(input);
    const call = capturePruningData({ request, requestDigest });
    const receipt = capturePruningData(inputReceipt);
    const operationIndex =
      call.request.operation === "dependency-dispositions" ? 0 : 1;
    if (!same(call, pruningOperationCalls(plan)[operationIndex])) return false;
    const history = this.#history(plan, context);
    if (
      (operationIndex === 0
        ? history.successors.length < this.#dependencyParts(plan).length
        : history.successors.length !== this.#parts(plan).length) ||
      !(await this.#verifySuccessors(plan, history))
    )
      return false;
    // Regenerate from authenticated artifacts/events and deterministic replay,
    // not the receipt's flags, self-digest or an in-memory idempotency map.
    return same(receipt, this.#receipt(plan, history, operationIndex));
  }

  createProvider(journalStore) {
    const journal = captureWikiPruningJournalStore(journalStore);
    if (
      journal.descriptor.tenantId !== this.descriptor.tenantId ||
      journal.descriptor.streamId !== this.descriptor.streamId
    )
      throw new TypeError("Wiki pruning provider journal scope is invalid");
    return Object.freeze({
      applyDependencyDispositions: (call) => this.#apply(journal, call, 0),
      applyWikiRevision: (call) => this.#apply(journal, call, 1),
    });
  }

  async #apply(journal, input, operationIndex) {
    const call = capturePruningData(input);
    for (let attempt = 0; attempt <= 4096 / RULES.batchSize; attempt++) {
      const resolution = await journal.load({
        tenantId: this.descriptor.tenantId,
      });
      const state = resolution.state;
      if (!state)
        fail("Wiki pruning must be durably prepared before applying effects");
      const plan = this.#plan(state.plan);
      if (!same(call, pruningOperationCalls(plan)[operationIndex]))
        fail("Wiki pruning call differs from the current journal plan");
      if (state.operationReceipts.length > operationIndex) {
        const receipt = state.operationReceipts[operationIndex];
        if (
          !(await this.#verifyReceipt({
            ...call,
            plan,
            receipt,
            tenantId: this.descriptor.tenantId,
            streamId: this.descriptor.streamId,
            context: { mode: "checkpoint", checkpoint: resolution.checkpoint },
          }))
        )
          fail(
            "Wiki pruning journal contains a substituted maintenance receipt",
          );
        return receipt;
      }
      if (
        state.phase !== (operationIndex === 0 ? "prepared" : "running") ||
        state.operationReceipts.length !== operationIndex
      )
        fail("Wiki pruning dependency disposition must be acknowledged first");
      const history = this.#history(plan);
      if (!matchHead(resolution.ledgerHead, history.ledgerHead))
        fail("Wiki pruning authorization changed before the effect");
      if (!(await this.#verifySuccessors(plan, history)))
        fail("Wiki pruning committed effects differ from deterministic replay");
      const parts = this.#parts(plan);
      const end =
        operationIndex === 0
          ? this.#dependencyParts(plan).length
          : parts.length;
      if (history.successors.length > end)
        fail(
          "Wiki pruning effects advanced beyond the journal dependency frontier",
        );
      if (history.successors.length === end)
        return this.#receipt(plan, history, operationIndex);
      const next = await this.#derive(
        plan,
        history.current,
        parts[history.successors.length],
      );
      // Reconcile after a lost acknowledgement by reopening this same request;
      // never acknowledge a write merely because an append might have happened.
      this.#commit({
        expectedStateDigest: history.current.stateDigest,
        expectedLedgerHead: resolution.ledgerHead,
        revision: next,
      });
    }
    fail("Wiki pruning maintenance exceeded its bounded batch progress");
  }
}
