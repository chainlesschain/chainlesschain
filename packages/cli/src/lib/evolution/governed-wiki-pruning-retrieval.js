import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_MAX_EVENTS,
} from "./evolution-ledger.js";
import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";
import { captureWikiPruningJournalStore } from "./governed-wiki-pruning-ledger-adapter.js";
import { GovernedWikiPruningMaintenance } from "./governed-wiki-pruning-maintenance.js";
import { digestWikiState } from "./evidence-backed-wiki-maintainer.js";
import {
  capturePruningData as snapshot,
  pruningCanonical as canonical,
  pruningDigest,
  pruningOperationCalls,
  verifyPruningJournalPlan,
  WIKI_PRUNING_JOURNAL_MAX_BYTES,
} from "./governed-wiki-pruning-journal.js";

export const WIKI_PRUNING_RETRIEVAL_ARTIFACT_TYPE =
  "wiki-pruning-retrieval-projection";
export const WIKI_PRUNING_RETRIEVAL_EVENT_TYPE =
  "wiki.pruning.retrieval-projection-committed";
export const WIKI_PRUNING_RETRIEVAL_SCHEMA =
  "chainlesschain.wiki-pruning-retrieval-projection/v1";
export const WIKI_PRUNING_RETRIEVAL_RECEIPT_SCHEMA =
  "chainlesschain.wiki-pruning-retrieval-receipt/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HEAD_KEYS = [
  "epoch",
  "ledgerId",
  "identityDigest",
  "sequence",
  "headDigest",
];
const RECORD_KEYS = [
  "schema",
  "tenantId",
  "streamId",
  "evolutionRunId",
  "revision",
  "previousProjectionDigest",
  "call",
  "wikiStateDigest",
  "wikiRevision",
  "authorizationHead",
  "index",
  "projectionDigest",
];
const same = (left, right) => canonical(left) === canonical(right);
const headOf = (value) =>
  Object.fromEntries(HEAD_KEYS.map((key) => [key, value[key]]));
function fail(message) {
  const error = new Error(message);
  error.code = "CC_WIKI_PRUNING_RETRIEVAL_INVALID";
  throw error;
}
function capture(owner, name) {
  const method = owner?.[name];
  if (typeof method !== "function")
    throw new TypeError(`${name} port is required`);
  return (...args) => Reflect.apply(method, owner, args);
}
function exact(value, keys) {
  return (
    value &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

// A real materialized Wiki index, not the Skill-content revocation index. Only
// the current authenticated journal authorizes publication. Receipts can be
// checked historically; the proposer can read only the finalized CURRENT view.
export class GovernedWikiPruningRetrieval {
  #wiki;
  #maintenance;
  #put;
  #read;
  #verifyLedger;
  #append;
  #resolve;
  #clock;

  constructor({
    descriptor,
    wikiLedgerAdapter,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    clock = Date.now,
  } = {}) {
    const input = snapshot(descriptor);
    const normalized = {};
    for (const key of [
      "tenantId",
      "artifactTenantId",
      "streamId",
      "audience",
      "purpose",
    ]) {
      if (
        typeof input[key] !== "string" ||
        !input[key].trim() ||
        input[key].length > 256
      )
        throw new TypeError(`retrieval ${key} is invalid`);
      normalized[key] = input[key];
    }
    if (normalized.purpose !== "evolution-ledger")
      throw new TypeError("Wiki retrieval requires evolution-ledger purpose");
    this.#wiki = captureWikiRevisionReader(wikiLedgerAdapter);
    if (normalized.tenantId !== this.#wiki.descriptor.tenantId)
      throw new TypeError("Wiki retrieval tenant mismatch");
    this.descriptor = Object.freeze({
      ...normalized,
      evolutionRunId: this.#wiki.descriptor.evolutionRunId,
    });
    // Fixed product reducer, never a caller-supplied success flag.
    this.#maintenance = new GovernedWikiPruningMaintenance({
      descriptor: normalized,
      wikiLedgerAdapter,
    }).authorityPorts();
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver))
      throw new TypeError("a branded artifact resolver is required");
    this.#resolve = ledgerArtifactResolver;
    this.#put = capture(artifactPorts, "putCanonical");
    this.#read = capture(ledger, "read");
    this.#verifyLedger = capture(ledger, "verify");
    this.#append = capture(ledger, "appendDomainEvent");
    if (typeof clock !== "function") throw new TypeError("clock is required");
    this.#clock = clock;
    Object.freeze(this);
  }

  #record(value) {
    const record = snapshot(value);
    if (
      !exact(record, RECORD_KEYS) ||
      record.schema !== WIKI_PRUNING_RETRIEVAL_SCHEMA ||
      record.tenantId !== this.descriptor.tenantId ||
      record.streamId !== this.descriptor.streamId ||
      record.evolutionRunId !== this.descriptor.evolutionRunId ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 1 ||
      (record.previousProjectionDigest !== null &&
        !DIGEST.test(record.previousProjectionDigest)) ||
      !DIGEST.test(record.wikiStateDigest) ||
      (record.wikiRevision !== null &&
        !/^wiki:[a-f0-9]{64}$/u.test(record.wikiRevision)) ||
      !Array.isArray(record.index) ||
      !exact(record.call, ["request", "requestDigest"]) ||
      !DIGEST.test(record.call.requestDigest) ||
      record.call.request?.operation !== "retrieval-projection" ||
      record.call.request.tenantId !== this.descriptor.tenantId ||
      !exact(record.authorizationHead, HEAD_KEYS)
    )
      fail("Wiki retrieval projection is invalid");
    const { projectionDigest, ...core } = record;
    if (projectionDigest !== pruningDigest(WIKI_PRUNING_RETRIEVAL_SCHEMA, core))
      fail("Wiki retrieval projection digest mismatch");
    return record;
  }

  #checkpoint(head, events, checkpoint) {
    if (
      !exact(checkpoint, HEAD_KEYS) ||
      !Number.isSafeInteger(checkpoint.sequence) ||
      checkpoint.sequence < 0 ||
      checkpoint.sequence > events.length ||
      HEAD_KEYS.slice(0, 3).some((key) => checkpoint[key] !== head[key]) ||
      checkpoint.headDigest !==
        (events[checkpoint.sequence - 1]?.eventDigest ?? null)
    )
      fail("Wiki retrieval checkpoint is not in this authenticated ledger");
    return checkpoint.sequence;
  }

  #history(requestDigest = null, context = null) {
    const events = this.#read({ limit: EVOLUTION_LEDGER_MAX_EVENTS });
    if (!Array.isArray(events))
      fail("Wiki retrieval ledger did not return events");
    // read() authenticates the complete snapshot. Use its identity for each
    // immutable artifact, then authenticate the current head again at the end.
    // This is not an authorization cache and never skips artifact validation.
    const tail = events.at(-1);
    const head = tail
      ? { ...headOf(tail), headDigest: tail.eventDigest }
      : headOf(this.#verifyLedger());
    if (
      !Array.isArray(events) ||
      events.length !== head.sequence ||
      (events.at(-1)?.eventDigest ?? null) !== head.headDigest ||
      events.some(
        (event, index) =>
          event.sequence !== index + 1 ||
          HEAD_KEYS.slice(0, 3).some((key) => event[key] !== head[key]),
      )
    )
      fail("Wiki retrieval ledger is incomplete or changed");
    let boundary = head.sequence;
    if (context !== null) {
      const captured = snapshot(context);
      if (
        !exact(captured, ["mode", "checkpoint"]) ||
        !["current", "checkpoint"].includes(captured.mode)
      )
        fail("Wiki retrieval context is invalid");
      boundary = this.#checkpoint(head, events, captured.checkpoint);
      if (captured.mode === "current" && !same(captured.checkpoint, head))
        fail("Wiki retrieval current authorization head changed");
    }
    let latest = null;
    let target = null;
    const requests = new Set();
    for (const event of events) {
      if (
        event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
        event.type !== WIKI_PRUNING_RETRIEVAL_EVENT_TYPE ||
        event.tenantId !== this.descriptor.tenantId ||
        event.correlationId !== this.descriptor.streamId
      )
        continue;
      if (
        event.artifactTenantId !== this.descriptor.artifactTenantId ||
        event.decision !== "committed" ||
        event.skillName !== null ||
        !same(event.sourceRefs, latest ? [latest.event.subjectRef] : [])
      )
        fail("Wiki retrieval event lineage is invalid");
      const resolution = this.#resolve({
        epoch: head.epoch,
        ledgerId: head.ledgerId,
        tenantId: this.descriptor.artifactTenantId,
        ref: event.subjectRef,
      });
      if (
        resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
        resolution.authenticated !== true ||
        resolution.found !== true ||
        resolution.ref !== event.subjectRef.ref ||
        resolution.digest !== event.subjectRef.digest ||
        !DIGEST.test(resolution.receiptDigest) ||
        !Buffer.isBuffer(resolution.bytes) ||
        resolution.bytes.length > WIKI_PRUNING_JOURNAL_MAX_BYTES
      )
        fail("Wiki retrieval artifact resolution is invalid");
      const envelope = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(resolution.bytes),
      );
      if (
        envelope.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
        envelope.type !== WIKI_PRUNING_RETRIEVAL_ARTIFACT_TYPE ||
        envelope.retention !== "ledger" ||
        envelope.tenantId !== this.descriptor.artifactTenantId ||
        envelope.audience !== this.descriptor.audience ||
        envelope.purpose !== this.descriptor.purpose
      )
        fail("Wiki retrieval artifact scope is invalid");
      const record = this.#record(envelope.value);
      if (
        record.revision !== (latest?.record.revision ?? 0) + 1 ||
        record.previousProjectionDigest !==
          (latest?.record.projectionDigest ?? null) ||
        event.eventId !==
          `${WIKI_PRUNING_RETRIEVAL_EVENT_TYPE}.${record.projectionDigest.slice(7)}` ||
        this.#checkpoint(head, events, record.authorizationHead) !==
          event.sequence - 1 ||
        requests.has(record.call.requestDigest)
      )
        fail("Wiki retrieval history or authorization lineage is invalid");
      requests.add(record.call.requestDigest);
      latest = { record, event };
      if (
        record.call.requestDigest === requestDigest &&
        event.sequence <= boundary
      )
        target = latest;
    }
    if (!same(headOf(this.#verifyLedger()), head))
      fail("Wiki retrieval ledger changed during read");
    return { head, latest, target };
  }

  async #expected(plan, checkpoint = null) {
    const requests = this.#maintenance.requestDigests({ plan });
    const query = {
      tenantId: plan.tenantId,
      stateDigest: plan.wikiStateDigest,
      allowedMaintenanceRequestDigests: requests,
    };
    const history =
      checkpoint === null
        ? this.#wiki.resolveHistory(query)
        : this.#wiki.resolveAtCheckpoint({ ...query, checkpoint });
    if (
      history.successors.length !== requests.length ||
      !(await this.#maintenance.verifySuccessors({ plan, history }))
    )
      fail("Wiki retrieval requires all exact Wiki maintenance effects");
    const removals = new Set(plan.retrievalRemovals);
    if (!Array.isArray(history.current.state.index))
      fail("Wiki index is invalid");
    return {
      history,
      index: history.current.state.index.filter(
        (entry) => !removals.has(entry.patternId),
      ),
    };
  }

  #receipt(entry) {
    const { record, event } = entry;
    const core = {
      schema: WIKI_PRUNING_RETRIEVAL_RECEIPT_SCHEMA,
      authenticated: true,
      durable: true,
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      requestDigest: record.call.requestDigest,
      projectionDigest: record.projectionDigest,
      wikiStateDigest: record.wikiStateDigest,
      eventDigest: event.eventDigest,
      artifactRef: event.subjectRef,
    };
    return snapshot({
      ...core,
      receiptDigest: pruningDigest(WIKI_PRUNING_RETRIEVAL_RECEIPT_SCHEMA, core),
    });
  }

  async #verifyEntry(plan, entry) {
    if (!entry || !same(entry.record.call, pruningOperationCalls(plan).at(-1)))
      return false;
    const expected = await this.#expected(plan, entry.record.authorizationHead);
    return (
      entry.record.wikiStateDigest === expected.history.current.stateDigest &&
      entry.record.wikiRevision === expected.history.current.state.revisionId &&
      same(entry.record.index, expected.index)
    );
  }

  operationReceiptVerifier() {
    return Object.freeze({ verify: (input) => this.#verifyReceipt(input) });
  }
  async #verifyReceipt({
    plan: inputPlan,
    request,
    requestDigest,
    receipt,
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
    const call = snapshot({ request, requestDigest });
    if (!same(call, pruningOperationCalls(plan).at(-1))) return false;
    const { target } = this.#history(requestDigest, context ?? null);
    return (
      (await this.#verifyEntry(plan, target)) &&
      same(snapshot(receipt), this.#receipt(target))
    );
  }

  #journal(input) {
    const journal = captureWikiPruningJournalStore(input);
    if (
      journal.descriptor.tenantId !== this.descriptor.tenantId ||
      journal.descriptor.streamId !== this.descriptor.streamId
    )
      throw new TypeError("Wiki retrieval journal scope mismatch");
    return journal;
  }
  createProvider(journalStore) {
    const journal = this.#journal(journalStore);
    return Object.freeze({
      publishRetrievalProjection: (input) => this.#publish(journal, input),
    });
  }

  async #publish(journal, input) {
    const call = snapshot(input);
    const resolution = await journal.load({
      tenantId: this.descriptor.tenantId,
    });
    const state = resolution.state;
    if (!state) fail("Wiki retrieval requires a prepared journal");
    const plan = verifyPruningJournalPlan(state.plan, this.descriptor.tenantId);
    const calls = pruningOperationCalls(plan);
    if (!same(call, calls.at(-1)))
      fail("Wiki retrieval call differs from the current plan");
    if (state.operationReceipts.length === calls.length) {
      const receipt = state.operationReceipts.at(-1);
      if (
        !(await this.#verifyReceipt({
          ...call,
          receipt,
          plan,
          ...this.descriptor,
          context: { mode: "checkpoint", checkpoint: resolution.checkpoint },
        }))
      )
        fail("Wiki retrieval saved receipt differs");
      return receipt;
    }
    if (
      state.phase !== "running" ||
      state.operationReceipts.length !== calls.length - 1
    )
      fail("Wiki retrieval requires the Wiki and deletion receipt frontier");
    const persisted = this.#history(call.requestDigest);
    if (!same(persisted.head, resolution.ledgerHead))
      fail("Wiki retrieval journal authorization changed");
    if (persisted.target) {
      if (!(await this.#verifyEntry(plan, persisted.target)))
        fail("Wiki retrieval persisted effect was substituted");
      return this.#receipt(persisted.target);
    }
    const expected = await this.#expected(plan);
    if (
      !same(headOf(expected.history.ledgerHead), resolution.ledgerHead) ||
      !same(headOf(this.#verifyLedger()), resolution.ledgerHead)
    )
      fail("Wiki retrieval authorization changed before publish");
    const core = {
      schema: WIKI_PRUNING_RETRIEVAL_SCHEMA,
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      evolutionRunId: this.descriptor.evolutionRunId,
      revision: (persisted.latest?.record.revision ?? 0) + 1,
      previousProjectionDigest:
        persisted.latest?.record.projectionDigest ?? null,
      call,
      wikiStateDigest: expected.history.current.stateDigest,
      wikiRevision: expected.history.current.state.revisionId,
      authorizationHead: resolution.ledgerHead,
      index: expected.index,
    };
    const record = this.#record({
      ...core,
      projectionDigest: pruningDigest(WIKI_PRUNING_RETRIEVAL_SCHEMA, core),
    });
    const timestamp = new Date(this.#clock()).toISOString();
    const published = this.#put(WIKI_PRUNING_RETRIEVAL_ARTIFACT_TYPE, record, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      published?.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    )
      fail("Wiki retrieval persistence was not confirmed");
    // Do not turn an uncertain write into an acknowledgement. A fresh instance
    // can authenticate the committed record and reconcile the same request.
    this.#append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: "committed",
        eventId: `${WIKI_PRUNING_RETRIEVAL_EVENT_TYPE}.${record.projectionDigest.slice(7)}`,
        reason: `Wiki retrieval projection ${record.revision} committed`,
        skillName: null,
        sourceRefs: persisted.latest ? [persisted.latest.event.subjectRef] : [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp,
        type: WIKI_PRUNING_RETRIEVAL_EVENT_TYPE,
      },
      {
        expectedHeadDigest: resolution.ledgerHead.headDigest,
        expectedSequence: resolution.ledgerHead.sequence,
      },
    );
    const recovered = this.#history(call.requestDigest);
    if (!recovered.target || !same(recovered.target.record, record))
      fail("Wiki retrieval readback differs from publication");
    return this.#receipt(recovered.target);
  }

  createProposerReader({ journalStore, policy } = {}) {
    if (
      policy?.proposerWikiRead !== true ||
      policy?.executionAgentWikiRead !== false
    )
      throw new TypeError("Wiki retrieval is isolated to the proposer");
    const journal = this.#journal(journalStore);
    return Object.freeze({
      readIndex: (input) => this.#readCurrent(journal, input, false),
      readPattern: (input) => this.#readCurrent(journal, input, true),
    });
  }

  async #readCurrent(journal, input, patternMode) {
    const query = snapshot(input);
    const patternId = patternMode ? query.patternId : null;
    if (
      !exact(
        query,
        patternId === null
          ? ["tenantId", "wikiRevision"]
          : ["tenantId", "wikiRevision", "patternId"],
      ) ||
      query.tenantId !== this.descriptor.tenantId ||
      (patternId !== null &&
        (typeof patternId !== "string" || !patternId.trim()))
    )
      fail("Wiki retrieval read scope is invalid");
    const resolution = await journal.load({ tenantId: query.tenantId });
    const state = resolution.state;
    if (state?.phase !== "finalized")
      fail("Wiki retrieval has no finalized current projection");
    const requestDigest = pruningOperationCalls(state.plan).at(
      -1,
    ).requestDigest;
    const persisted = this.#history(requestDigest);
    if (
      !same(persisted.head, resolution.ledgerHead) ||
      !persisted.target ||
      persisted.target !== persisted.latest ||
      !same(state.operationReceipts.at(-1), this.#receipt(persisted.target))
    )
      fail("Wiki retrieval projection is not the current journal effect");
    const record = persisted.target.record;
    // A later normal Wiki edit requires projection refresh, never silent reuse
    // of a historical index. No historical-checkpoint option is exposed here.
    const current = this.#wiki.resolveHistory({
      tenantId: query.tenantId,
      stateDigest: record.wikiStateDigest,
      allowedMaintenanceRequestDigests: [],
    });
    if (
      !same(headOf(current.ledgerHead), persisted.head) ||
      query.wikiRevision !== record.wikiRevision ||
      current.current.stateDigest !== record.wikiStateDigest
    )
      fail("Wiki retrieval projection is stale");
    let data;
    let kind;
    if (patternId === null) {
      kind = "wiki-index";
      data = {
        tenantId: query.tenantId,
        wikiRevision: record.wikiRevision,
        wikiStateDigest: record.wikiStateDigest,
        projectionDigest: record.projectionDigest,
        entries: record.index,
        contradictionRefs: record.index
          .filter((entry) => entry.status === "contradicted")
          .map((entry) => entry.patternId),
      };
    } else {
      if (!record.index.some((entry) => entry.patternId === patternId))
        fail("Wiki pattern is excluded from the current retrieval projection");
      kind = "pattern";
      data = current.current.state.patterns[patternId];
      if (!data) fail("Wiki projection references an absent pattern");
    }
    return snapshot({
      kind,
      trusted: true,
      ref: `${persisted.target.event.subjectRef.ref}${patternId === null ? "" : `#pattern=${encodeURIComponent(patternId)}`}`,
      digest: digestWikiState(data),
      data,
    });
  }
}
