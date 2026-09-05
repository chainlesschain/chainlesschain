import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_MAX_EVENTS,
} from "./evolution-ledger.js";
import {
  WIKI_PRUNING_JOURNAL_MAX_BYTES,
  assertPruningJournalTransition,
  pruningCanonical,
  pruningOperationCalls,
  verifyWikiPruningJournal,
} from "./governed-wiki-pruning-journal.js";

export const WIKI_PRUNING_JOURNAL_EVENT_TYPE = "wiki.pruning.journal-committed";
export const WIKI_PRUNING_JOURNAL_ARTIFACT_TYPE = "wiki-pruning-journal";
const STORES = new WeakMap();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
function currentContext(head) {
  return Object.freeze({
    mode: "current",
    checkpoint: Object.freeze({
      epoch: head.epoch,
      ledgerId: head.ledgerId,
      identityDigest: head.identityDigest,
      sequence: head.sequence,
      headDigest: head.headDigest,
    }),
  });
}

function historicalContext(event) {
  return Object.freeze({
    mode: "checkpoint",
    checkpoint: Object.freeze({
      epoch: event.epoch,
      ledgerId: event.ledgerId,
      identityDigest: event.identityDigest,
      sequence: event.sequence,
      headDigest: event.eventDigest,
    }),
  });
}

function fail(message) {
  const error = new Error(message);
  error.code = "CC_WIKI_PRUNING_JOURNAL_INVALID";
  throw error;
}
function conflict(message) {
  const error = new Error(message);
  error.code = "CC_WIKI_PRUNING_JOURNAL_CONFLICT";
  throw error;
}
function capture(owner, name) {
  const operation = owner?.[name];
  if (typeof operation !== "function")
    throw new TypeError(`${name} port is required`);
  return (...args) => Reflect.apply(operation, owner, args);
}
function descriptor(input) {
  const value = {};
  for (const key of [
    "tenantId",
    "artifactTenantId",
    "streamId",
    "audience",
    "purpose",
  ]) {
    if (
      typeof input?.[key] !== "string" ||
      !input[key].trim() ||
      input[key].length > 256
    )
      throw new TypeError(`${key} is invalid`);
    value[key] = input[key];
  }
  if (value.purpose !== "evolution-ledger")
    throw new TypeError("pruning journal requires evolution-ledger purpose");
  return Object.freeze(value);
}

// This adapter authenticates persistence, not business authorization by itself.
// Plan and operation verifiers are mandatory and reconsulted on every restore.
// Historical entries are verified at their authenticated checkpoint, NOT
// against an arbitrarily newer Wiki. The current unfinished execution and all
// proposed writes additionally require current authorization. A completed
// record is never treated as permission to perform more effects. Plan verifiers
// must bind checkpoint context to the Wiki ledger identity and ordered effects.
// The operation verifier must independently authenticate the exact provider
// receipt, not merely echo its authenticated/durable flags. Effect providers
// must reconcile duplicate requestDigest values across process boundaries.
export class GovernedWikiPruningLedgerAdapter {
  #put;
  #read;
  #verifyLedger;
  #append;
  #resolve;
  #verifyPlan;
  #verifyOperation;
  #clock;

  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    planVerifier,
    operationReceiptVerifier,
    clock = Date.now,
  } = {}) {
    this.descriptor = descriptor(input);
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver))
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    this.#put = capture(artifactPorts, "putCanonical");
    this.#read = capture(ledger, "read");
    this.#verifyLedger = capture(ledger, "verify");
    this.#append = capture(ledger, "appendDomainEvent");
    this.#resolve = ledgerArtifactResolver;
    this.#verifyPlan = capture(planVerifier, "verify");
    this.#verifyOperation = capture(operationReceiptVerifier, "verify");
    if (typeof clock !== "function")
      throw new TypeError("clock port is required");
    this.#clock = clock;
    Object.freeze(this);
    STORES.set(
      this,
      Object.freeze({
        descriptor: this.descriptor,
        load: (input) => this.#load(input),
        commit: (input) => this.#commit(input),
      }),
    );
  }

  async #authenticate(state, context) {
    if (
      (await this.#verifyPlan({
        plan: state.plan,
        tenantId: this.descriptor.tenantId,
        streamId: this.descriptor.streamId,
        context,
      })) !== true
    )
      fail("pruning plan authorization is unavailable or revoked");
    const calls = pruningOperationCalls(state.plan);
    for (const [index, receipt] of state.operationReceipts.entries()) {
      if (
        (await this.#verifyOperation({
          ...calls[index],
          plan: state.plan,
          receipt,
          tenantId: this.descriptor.tenantId,
          streamId: this.descriptor.streamId,
          context,
        })) !== true
      )
        fail("pruning operation receipt authentication failed");
    }
  }

  async #history() {
    const all = this.#read({ limit: EVOLUTION_LEDGER_MAX_EVENTS });
    if (!Array.isArray(all))
      fail("pruning journal ledger did not return events");
    // read() already authenticates this snapshot. Resolve its artifacts using
    // the same identity and compare to a freshly authenticated head after ALL
    // transition/business checks; no cached authorization crosses calls.
    const tail = all.at(-1);
    const head = tail
      ? {
          epoch: tail.epoch,
          ledgerId: tail.ledgerId,
          identityDigest: tail.identityDigest,
          sequence: tail.sequence,
          headDigest: tail.eventDigest,
        }
      : this.#verifyLedger();
    if (
      all.length !== head.sequence ||
      (all.at(-1)?.eventDigest ?? null) !== head.headDigest ||
      all.some(
        (event, index) =>
          event.sequence !== index + 1 ||
          ["epoch", "ledgerId", "identityDigest"].some(
            (key) => event[key] !== head[key],
          ),
      )
    ) {
      conflict("pruning journal ledger range is incomplete or changed");
    }
    const events = all.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === WIKI_PRUNING_JOURNAL_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
    const history = [];
    const plans = new Set();
    for (const event of events) {
      const previous = history.at(-1) ?? null;
      if (
        event.artifactTenantId !== this.descriptor.artifactTenantId ||
        event.decision !== "committed" ||
        event.skillName !== null ||
        !Array.isArray(event.sourceRefs) ||
        event.sourceRefs.length !== (previous ? 1 : 0) ||
        (previous &&
          pruningCanonical(event.sourceRefs[0]) !==
            pruningCanonical(previous.event.subjectRef))
      )
        fail("pruning journal event lineage is invalid");
      const resolution = this.#resolve({
        epoch: head.epoch,
        ledgerId: head.ledgerId,
        ref: event.subjectRef,
        tenantId: this.descriptor.artifactTenantId,
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
        fail("pruning journal artifact resolution is invalid");
      const record = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(resolution.bytes),
      );
      if (
        record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
        record.tenantId !== this.descriptor.artifactTenantId ||
        record.audience !== this.descriptor.audience ||
        record.purpose !== this.descriptor.purpose ||
        record.retention !== "ledger" ||
        record.type !== WIKI_PRUNING_JOURNAL_ARTIFACT_TYPE
      )
        fail("pruning journal durable artifact binding is invalid");
      const state = verifyWikiPruningJournal(
        record.value,
        this.descriptor.tenantId,
      );
      if (
        event.eventId !==
        `${WIKI_PRUNING_JOURNAL_EVENT_TYPE}.${state.journalDigest.slice(7)}`
      )
        fail("pruning journal event identity is invalid");
      assertPruningJournalTransition(previous?.state ?? null, state);
      if (previous?.state.plan.planDigest !== state.plan.planDigest) {
        if (plans.has(state.plan.planDigest))
          fail("pruning journal restarted a historical plan");
        plans.add(state.plan.planDigest);
      }
      const samePlan =
        previous?.state.plan.planDigest === state.plan.planDigest;
      const entry = {
        event,
        state,
        prepared: samePlan ? previous.prepared : { event, state },
      };
      if (samePlan) history[history.length - 1] = entry;
      else history.push(entry);
    }
    // Every immutable event/transition above is checked. Per plan, authenticate
    // its source at preparation and its full retained receipt prefix at the
    // latest checkpoint. Intermediate states retain the exact same plan and
    // immutable receipt prefixes, so need no duplicate business verification.
    for (const entry of history) {
      await this.#authenticate(
        entry.prepared.state,
        historicalContext(entry.prepared.event),
      );
      if (entry.state.journalDigest !== entry.prepared.state.journalDigest)
        await this.#authenticate(entry.state, historicalContext(entry.event));
    }
    const latest = history.at(-1)?.state;
    if (latest && latest.phase !== "finalized")
      await this.#authenticate(latest, currentContext(head));
    const after = this.#verifyLedger();
    if (
      after.headDigest !== head.headDigest ||
      after.sequence !== head.sequence ||
      after.identityDigest !== head.identityDigest ||
      after.epoch !== head.epoch ||
      after.ledgerId !== head.ledgerId
    )
      conflict("pruning journal ledger changed while restoring");
    return { head, history };
  }

  #resolution(entry, head) {
    return Object.freeze({
      authenticated: true,
      durable: true,
      found: !!entry,
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      state: entry?.state ?? null,
      receiptDigest: entry?.event.eventDigest ?? null,
      ledgerHead: currentContext(head).checkpoint,
      checkpoint: entry ? historicalContext(entry.event).checkpoint : null,
    });
  }

  load(input) {
    return this.#load(input);
  }

  async #load({ tenantId, planDigest = null } = {}) {
    if (
      tenantId !== this.descriptor.tenantId ||
      (planDigest !== null && !DIGEST.test(planDigest))
    )
      throw new TypeError("pruning journal load scope is invalid");
    const { history, head } = await this.#history();
    return this.#resolution(
      (planDigest === null
        ? history
        : history.filter((entry) => entry.state.plan.planDigest === planDigest)
      ).at(-1),
      head,
    );
  }

  commit(input) {
    return this.#commit(input);
  }

  async #commit({ state: input, expectedJournalDigest } = {}) {
    const state = verifyWikiPruningJournal(input, this.descriptor.tenantId);
    if (expectedJournalDigest !== null && !DIGEST.test(expectedJournalDigest))
      throw new TypeError("expectedJournalDigest is invalid");
    const { history, head } = await this.#history();
    const previous = history.at(-1) ?? null;
    if (previous?.state.journalDigest === state.journalDigest)
      return this.#resolution(previous, head);
    if ((previous?.state.journalDigest ?? null) !== expectedJournalDigest)
      conflict("pruning journal changed before commit");
    assertPruningJournalTransition(previous?.state ?? null, state);
    if (
      previous?.state.plan.planDigest !== state.plan.planDigest &&
      history.some(
        (entry) => entry.state.plan.planDigest === state.plan.planDigest,
      )
    )
      fail("pruning journal cannot restart a historical plan");
    await this.#authenticate(state, currentContext(head));
    const now = Number(this.#clock());
    if (!Number.isFinite(now))
      throw new TypeError("pruning journal clock is invalid");
    const published = this.#put(WIKI_PRUNING_JOURNAL_ARTIFACT_TYPE, state, {
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
      fail("pruning journal artifact was not durably confirmed");
    const eventId = `${WIKI_PRUNING_JOURNAL_EVENT_TYPE}.${state.journalDigest.slice(7)}`;
    let appendError = null;
    try {
      const receipt = this.#append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: `Wiki pruning ${state.phase} checkpoint ${state.revision}`,
          skillName: null,
          sourceRefs: previous ? [previous.event.subjectRef] : [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: new Date(now).toISOString(),
          type: WIKI_PRUNING_JOURNAL_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (
        receipt?.authenticated !== true ||
        receipt.durable !== true ||
        receipt.committed !== true ||
        receipt.eventId !== eventId
      )
        fail("pruning journal append was not confirmed");
    } catch (error) {
      // Only authenticated readback may turn response loss into success.
      appendError = error;
    }
    const restored = await this.#history();
    const recovered = restored.history.at(-1);
    if (recovered?.state.journalDigest !== state.journalDigest) {
      if (appendError) throw appendError;
      fail("pruning journal readback did not match commit");
    }
    return this.#resolution(recovered, restored.head);
  }
}

export function captureWikiPruningJournalStore(value) {
  const ports = STORES.get(value);
  if (!ports)
    throw new TypeError("a branded Wiki pruning journal store is required");
  return ports;
}
