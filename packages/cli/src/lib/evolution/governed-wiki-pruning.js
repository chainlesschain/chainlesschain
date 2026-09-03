import { createHash } from "node:crypto";

import {
  WIKI_PATTERN_STATUS,
  WIKI_STATE_SCHEMA,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";

export const GOVERNED_WIKI_PRUNING_PLAN_SCHEMA =
  "chainlesschain.governed-wiki-pruning-plan/v1";
export const GOVERNED_WIKI_PRUNING_CONTROL_SCHEMA =
  "chainlesschain.governed-wiki-pruning-control/v1";
export const GOVERNED_ONLINE_ADAPTATION_AUTHORIZATION_SCHEMA =
  "chainlesschain.governed-online-adaptation-authorization/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TERMINAL_PATTERN_STATUSES = new Set([
  WIKI_PATTERN_STATUS.REVOKED,
  WIKI_PATTERN_STATUS.TOMBSTONED,
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function string(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function digest(value, name) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${name} is invalid`);
  return value;
}

function time(value, name) {
  string(value, name);
  if (!Number.isFinite(Date.parse(value)))
    throw new TypeError(`${name} must be an ISO timestamp`);
  return value;
}

function boundedUniqueStrings(value, name, maximum = 256) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  )
    throw new TypeError(`${name} must be a bounded string list`);
  return [...new Set(value)].sort();
}

function normalizeDescriptor(input) {
  const staleGraceDays = Number(input?.staleGraceDays ?? 30);
  const maxActions = Number(input?.maxActions ?? 512);
  if (
    !Number.isInteger(staleGraceDays) ||
    staleGraceDays < 0 ||
    !Number.isInteger(maxActions) ||
    maxActions < 1 ||
    maxActions > 4096
  )
    throw new TypeError("Wiki pruning policy is invalid");
  return freeze({
    tenantId: string(input?.tenantId, "tenantId"),
    staleGraceDays,
    maxActions,
  });
}

function verifyStateEnvelope(envelope, tenantId, expectedStateDigest) {
  const state = envelope?.state;
  if (
    envelope?.trusted !== true ||
    state?.schema !== WIKI_STATE_SCHEMA ||
    state.tenantId !== tenantId ||
    envelope.stateDigest !== expectedStateDigest ||
    digestWikiState(state) !== expectedStateDigest
  )
    throw new Error("Wiki pruning requires an exact trusted Wiki state");
  return clone(state);
}

function verifiedAt(pattern) {
  return pattern.lastVerifiedAt ?? pattern.updatedAt;
}

function assertPlan(plan, tenantId) {
  if (
    plan?.schema !== GOVERNED_WIKI_PRUNING_PLAN_SCHEMA ||
    plan.tenantId !== tenantId ||
    !DIGEST.test(plan?.planDigest ?? "")
  )
    throw new TypeError("Wiki pruning plan is invalid");
  const core = clone(plan);
  delete core.planDigest;
  if (hash(GOVERNED_WIKI_PRUNING_PLAN_SCHEMA, core) !== plan.planDigest)
    throw new Error("Wiki pruning plan digest is invalid");
  return freeze(clone(plan));
}

function operationRequest(plan, operation, payload) {
  const request = freeze({
    tenantId: plan.tenantId,
    planDigest: plan.planDigest,
    wikiStateDigest: plan.wikiStateDigest,
    operation,
    payload: clone(payload),
  });
  return freeze({
    request,
    requestDigest: hash(
      "chainlesschain.governed-wiki-pruning-operation/v1",
      request,
    ),
  });
}

function requireDurableAck(result, requestDigest, label) {
  if (
    result?.authenticated !== true ||
    result.durable !== true ||
    result.requestDigest !== requestDigest ||
    !DIGEST.test(result.receiptDigest ?? "")
  )
    throw new Error(`${label} was not durably acknowledged`);
  return result.receiptDigest;
}

export class GovernedWikiPruning {
  constructor({ descriptor, ports } = {}) {
    this.descriptor = normalizeDescriptor(descriptor);
    for (const name of [
      "loadWikiState",
      "resolveDeletionReceipt",
      "commitControl",
      "applyDependencyDispositions",
      "applyWikiRevision",
      "cryptoShred",
      "publishRetrievalProjection",
      "verifyOfflineClosure",
    ]) {
      if (typeof ports?.[name] !== "function")
        throw new TypeError(`Wiki pruning port ${name} is required`);
      this[`_${name}`] = ports[name].bind(ports);
    }
  }

  async plan({
    expectedStateDigest,
    effectiveAt,
    deletionReceiptDigests = [],
  }) {
    digest(expectedStateDigest, "expectedStateDigest");
    time(effectiveAt, "effectiveAt");
    const receiptDigests = boundedUniqueStrings(
      deletionReceiptDigests,
      "deletionReceiptDigests",
      this.descriptor.maxActions,
    );
    receiptDigests.forEach((value) => digest(value, "deletionReceiptDigest"));
    const state = verifyStateEnvelope(
      await this._loadWikiState({ tenantId: this.descriptor.tenantId }),
      this.descriptor.tenantId,
      expectedStateDigest,
    );
    const cutoff =
      Date.parse(effectiveAt) - this.descriptor.staleGraceDays * 86_400_000;
    const patternActions = [];
    const retrievalRemovals = [];
    for (const pattern of Object.values(state.patterns).sort((a, b) =>
      a.patternId.localeCompare(b.patternId),
    )) {
      if (
        pattern.status === WIKI_PATTERN_STATUS.STALE &&
        Number.isFinite(Date.parse(verifiedAt(pattern))) &&
        Date.parse(verifiedAt(pattern)) <= cutoff
      )
        patternActions.push({
          type: "tombstone",
          patternId: pattern.patternId,
          reason: "stale-grace-elapsed",
        });
      if (
        pattern.status === WIKI_PATTERN_STATUS.STALE ||
        TERMINAL_PATTERN_STATUSES.has(pattern.status)
      )
        retrievalRemovals.push(pattern.patternId);
    }

    const deletions = [];
    const dependencyDispositions = [];
    for (const receiptDigest of receiptDigests) {
      const receipt = await this._resolveDeletionReceipt({
        tenantId: this.descriptor.tenantId,
        receiptDigest,
      });
      const evidence = state.evidence?.[receipt?.evidenceRef];
      if (
        receipt?.authenticated !== true ||
        receipt.tenantId !== this.descriptor.tenantId ||
        receipt.decision !== "delete" ||
        receipt.receiptDigest !== receiptDigest ||
        evidence == null ||
        receipt.sourceDigest !== evidence.sourceDigest ||
        receipt.artifactRef !== evidence.artifactRef ||
        typeof receipt.rawArtifactRef !== "string" ||
        !receipt.rawArtifactRef.startsWith(
          `artifact://${this.descriptor.tenantId}/raw/`,
        ) ||
        !DIGEST.test(receipt.rawCipherDigest ?? "") ||
        typeof receipt.keyRef !== "string" ||
        !receipt.keyRef.startsWith(`kms://${this.descriptor.tenantId}/`)
      )
        throw new Error("privacy deletion receipt is not exactly bound");
      const dependentPatternIds = [
        ...new Set(state.evidenceDependents?.[receipt.evidenceRef] ?? []),
      ].sort();
      for (const patternId of dependentPatternIds) {
        const pattern = state.patterns[patternId];
        if (!pattern) throw new Error("Wiki evidence dependency is corrupt");
        dependencyDispositions.push({
          evidenceRef: receipt.evidenceRef,
          patternId,
          action: pattern.skillNames?.length > 0 ? "rollback" : "tombstone",
          skillNames: [...(pattern.skillNames ?? [])].sort(),
        });
        retrievalRemovals.push(patternId);
      }
      deletions.push({
        evidenceRef: receipt.evidenceRef,
        sourceDigest: evidence.sourceDigest,
        artifactRef: evidence.artifactRef,
        rawArtifactRef: receipt.rawArtifactRef,
        rawCipherDigest: receipt.rawCipherDigest,
        keyRef: receipt.keyRef,
        receiptDigest,
      });
    }
    const actionCount =
      patternActions.length + deletions.length + dependencyDispositions.length;
    if (actionCount > this.descriptor.maxActions)
      throw new Error("Wiki pruning plan exceeds its action budget");
    const core = {
      schema: GOVERNED_WIKI_PRUNING_PLAN_SCHEMA,
      tenantId: this.descriptor.tenantId,
      wikiStateDigest: expectedStateDigest,
      effectiveAt,
      patternActions,
      retrievalRemovals: [...new Set(retrievalRemovals)].sort(),
      dependencyDispositions,
      deletions,
      auditPolicy: {
        retainWikiRevisions: true,
        retainEvolutionLog: true,
        retainDeletionReceipts: true,
        removeDeletedEvidenceFromRetrieval: true,
      },
    };
    return freeze({
      ...core,
      planDigest: hash(GOVERNED_WIKI_PRUNING_PLAN_SCHEMA, core),
    });
  }

  async execute({ plan: input, expectedControlDigest = null }) {
    const plan = assertPlan(input, this.descriptor.tenantId);
    if (expectedControlDigest != null)
      digest(expectedControlDigest, "expectedControlDigest");
    verifyStateEnvelope(
      await this._loadWikiState({ tenantId: this.descriptor.tenantId }),
      this.descriptor.tenantId,
      plan.wikiStateDigest,
    );
    const preparedCore = {
      schema: GOVERNED_WIKI_PRUNING_CONTROL_SCHEMA,
      tenantId: this.descriptor.tenantId,
      planDigest: plan.planDigest,
      wikiStateDigest: plan.wikiStateDigest,
      phase: "prepared",
      operationReceiptDigests: [],
    };
    const prepared = freeze({
      ...preparedCore,
      controlDigest: hash(GOVERNED_WIKI_PRUNING_CONTROL_SCHEMA, preparedCore),
    });
    const preparation = await this._commitControl({
      state: prepared,
      expectedControlDigest,
    });
    if (
      preparation?.authenticated !== true ||
      preparation.durable !== true ||
      preparation.controlDigest !== prepared.controlDigest
    )
      throw new Error("Wiki pruning preparation was not durably committed");

    const receipts = [];
    for (const [operation, payload, invoke] of [
      [
        "dependency-dispositions",
        plan.dependencyDispositions,
        this._applyDependencyDispositions,
      ],
      ["wiki-revision", plan.patternActions, this._applyWikiRevision],
    ]) {
      const call = operationRequest(plan, operation, payload);
      receipts.push(
        requireDurableAck(
          await invoke(call),
          call.requestDigest,
          `Wiki pruning ${operation}`,
        ),
      );
    }
    for (const deletion of plan.deletions) {
      const call = operationRequest(plan, "crypto-shred", deletion);
      receipts.push(
        requireDurableAck(
          await this._cryptoShred(call),
          call.requestDigest,
          "Wiki privacy deletion",
        ),
      );
    }
    const projection = operationRequest(plan, "retrieval-projection", {
      removals: plan.retrievalRemovals,
    });
    receipts.push(
      requireDurableAck(
        await this._publishRetrievalProjection(projection),
        projection.requestDigest,
        "Wiki retrieval projection",
      ),
    );
    const finalCore = {
      ...preparedCore,
      phase: "finalized",
      operationReceiptDigests: receipts,
    };
    const finalized = freeze({
      ...finalCore,
      controlDigest: hash(GOVERNED_WIKI_PRUNING_CONTROL_SCHEMA, finalCore),
    });
    const completion = await this._commitControl({
      state: finalized,
      expectedControlDigest: prepared.controlDigest,
    });
    if (
      completion?.authenticated !== true ||
      completion.durable !== true ||
      completion.controlDigest !== finalized.controlDigest
    )
      throw new Error("Wiki pruning completion was not durably committed");
    return finalized;
  }

  async authorizeOnlineAdaptation(input = {}) {
    const requested = boundedUniqueStrings(
      input.requestedCapabilities ?? [],
      "requestedCapabilities",
      64,
    );
    const baseline = boundedUniqueStrings(
      input.baselineCapabilities ?? [],
      "baselineCapabilities",
      64,
    );
    if (
      input.tenantId !== this.descriptor.tenantId ||
      input.candidateOnly !== true ||
      input.promotionGateRequired !== true ||
      input.crossTenant === true ||
      requested.some((capability) => !baseline.includes(capability))
    )
      throw new Error("online adaptation cannot expand authority");
    const closure = await this._verifyOfflineClosure({
      tenantId: this.descriptor.tenantId,
      receiptDigest: digest(
        input.offlineClosureReceiptDigest,
        "offlineClosureReceiptDigest",
      ),
    });
    if (
      closure?.authenticated !== true ||
      closure.stable !== true ||
      closure.tenantId !== this.descriptor.tenantId ||
      closure.receiptDigest !== input.offlineClosureReceiptDigest
    )
      throw new Error("online adaptation requires stable offline closure");
    const core = {
      schema: GOVERNED_ONLINE_ADAPTATION_AUTHORIZATION_SCHEMA,
      tenantId: this.descriptor.tenantId,
      sessionId: string(input.sessionId, "sessionId"),
      baselineCapabilities: baseline,
      requestedCapabilities: requested,
      candidateOnly: true,
      promotionGateRequired: true,
      offlineClosureReceiptDigest: closure.receiptDigest,
    };
    return freeze({
      ...core,
      authorizationDigest: hash(
        GOVERNED_ONLINE_ADAPTATION_AUTHORIZATION_SCHEMA,
        core,
      ),
    });
  }
}
