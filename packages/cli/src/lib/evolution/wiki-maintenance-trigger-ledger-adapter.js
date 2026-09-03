import { createHash } from "node:crypto";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  WIKI_MAINTENANCE_REQUEST_SCHEMA,
  WIKI_REVISION_SCHEMA,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";
import { WIKI_LEDGER_EVENT_TYPE } from "./wiki-maintainer-ledger-adapter.js";

export const WIKI_MAINTENANCE_TRIGGER_SCHEMA =
  "chainlesschain.evolution-wiki-maintenance-trigger/v1";
export const WIKI_MAINTENANCE_SETTLEMENT_SCHEMA =
  "chainlesschain.evolution-wiki-maintenance-settlement/v1";
export const WIKI_MAINTENANCE_REQUEST_EVENT_TYPE = "wiki.maintenance.requested";
export const WIKI_MAINTENANCE_SETTLED_EVENT_TYPE = "wiki.maintenance.settled";
export const WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE =
  "CC_EVOLUTION_WIKI_MAINTENANCE_TRIGGER_CORRUPT";
export const WIKI_MAINTENANCE_TRIGGER_CONFLICT_CODE =
  "CC_EVOLUTION_WIKI_MAINTENANCE_TRIGGER_CONFLICT";

export const WIKI_MAINTENANCE_TRIGGER_KIND = Object.freeze({
  SESSION_END: "session-end",
  GOAL_END: "goal-end",
  SCHEDULED_BATCH: "scheduled-batch",
});

const REQUEST_TYPE = "wiki-maintenance-request";
const SETTLEMENT_TYPE = "wiki-maintenance-settlement";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION_ID = /^wiki:[a-f0-9]{64}$/u;
const REQUEST_ID = /^wiki-maintenance:[a-f0-9]{64}$/u;
const KINDS = new Set(Object.values(WIKI_MAINTENANCE_TRIGGER_KIND));

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

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  if (Buffer.byteLength(value, "utf8") > 256) {
    throw new TypeError(`${label} is too long`);
  }
  return value;
}

function timestamp(value, label) {
  requiredString(value, label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical timestamp`);
  }
  return value;
}

function evidenceRefs(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 256 ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new TypeError("evidenceRefs must be a non-empty bounded string list");
  }
  return [...new Set(value)].sort();
}

function fail(code, message, options) {
  const error = new Error(message, options);
  error.code = code;
  throw error;
}

function capture(owner, method, label = method) {
  if (typeof owner?.[method] !== "function") {
    throw new TypeError(`${label} port is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: requiredString(input?.tenantId, "tenantId"),
    artifactTenantId: requiredString(
      input?.artifactTenantId,
      "artifactTenantId",
    ),
    streamId: requiredString(input?.streamId, "streamId"),
    audience: requiredString(input?.audience, "audience"),
    purpose: requiredString(input?.purpose, "purpose"),
  });
}

function normalizeTrigger(input, descriptor) {
  const kind = requiredString(input?.kind, "trigger.kind");
  if (!KINDS.has(kind)) throw new TypeError("trigger.kind is invalid");
  const core = {
    schema: WIKI_MAINTENANCE_TRIGGER_SCHEMA,
    tenantId: descriptor.tenantId,
    streamId: descriptor.streamId,
    kind,
    sourceId: requiredString(input?.sourceId, "trigger.sourceId"),
    sourceReceiptDigest: DIGEST.test(input?.sourceReceiptDigest ?? "")
      ? input.sourceReceiptDigest
      : (() => {
          throw new TypeError(
            "trigger.sourceReceiptDigest must be sha256-bound",
          );
        })(),
    evidenceRefs: evidenceRefs(input?.evidenceRefs),
    effectiveAt: timestamp(input?.effectiveAt, "trigger.effectiveAt"),
  };
  const requestDigest = hash(core);
  return deepFreeze({
    ...core,
    requestId: `wiki-maintenance:${requestDigest.slice("sha256:".length)}`,
    requestDigest,
  });
}

function verifyTrigger(value, descriptor) {
  const expected = normalizeTrigger(value, descriptor);
  if (!same(value, expected)) {
    fail(
      WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
      "stored Wiki maintenance request contains unsupported or substituted fields",
    );
  }
  return expected;
}

function normalizeSettlement(input, descriptor) {
  if (
    !REQUEST_ID.test(input?.requestId ?? "") ||
    !DIGEST.test(input?.requestDigest ?? "") ||
    input.requestId !==
      `wiki-maintenance:${input.requestDigest.slice("sha256:".length)}` ||
    !REVISION_ID.test(input?.revisionId ?? "") ||
    !Number.isSafeInteger(input?.revision) ||
    input.revision < 1 ||
    !DIGEST.test(input?.stateDigest ?? "")
  ) {
    throw new TypeError("Wiki maintenance settlement identity is invalid");
  }
  const core = {
    schema: WIKI_MAINTENANCE_SETTLEMENT_SCHEMA,
    tenantId: descriptor.tenantId,
    streamId: descriptor.streamId,
    requestId: input.requestId,
    requestDigest: input.requestDigest,
    status: "committed",
    revisionId: input.revisionId,
    revision: input.revision,
    stateDigest: input.stateDigest,
    settledAt: timestamp(input.settledAt, "settlement.settledAt"),
  };
  return deepFreeze({ ...core, settlementDigest: hash(core) });
}

function verifySettlement(value, descriptor) {
  const expected = normalizeSettlement(value, descriptor);
  if (!same(value, expected)) {
    fail(
      WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
      "stored Wiki maintenance settlement contains substituted fields",
    );
  }
  return expected;
}

function parseRecord(resolution, descriptor, expectedType) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    fail(
      WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
      "Wiki maintenance artifact resolution is unauthenticated or incomplete",
    );
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    fail(
      WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
      "Wiki maintenance artifact is not canonical JSON",
    );
  }
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== expectedType
  ) {
    fail(
      WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
      "Wiki maintenance durable artifact binding is invalid",
    );
  }
  return record.value;
}

export class WikiMaintenanceTriggerLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    sourceVerifier,
    maintainer,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    this._verifySource = capture(sourceVerifier, "verify", "sourceVerifier");
    this._maintain = capture(maintainer, "maintain", "maintainer");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    this._resolve = ledgerArtifactResolver;
    this._now = now;
    Object.freeze(this);
  }

  _events(type) {
    const events = this._read();
    if (!Array.isArray(events)) {
      fail(
        WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
        "EvolutionLedger did not return events",
      );
    }
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === type &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  _resolveEvent(event, expectedType) {
    const identity = this._verifyLedger();
    const resolution = this._resolve({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest
    ) {
      fail(
        WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
        "Wiki maintenance ledger subject was substituted",
      );
    }
    return parseRecord(resolution, this.descriptor, expectedType);
  }

  _requests() {
    return this._events(WIKI_MAINTENANCE_REQUEST_EVENT_TYPE).map((event) => {
      const request = verifyTrigger(
        this._resolveEvent(event, REQUEST_TYPE),
        this.descriptor,
      );
      if (
        event.eventId !==
          `${WIKI_MAINTENANCE_REQUEST_EVENT_TYPE}.${request.requestDigest.slice(7)}` ||
        event.decision !== "proposed" ||
        event.skillName !== null ||
        !Array.isArray(event.sourceRefs) ||
        event.sourceRefs.length !== 0
      ) {
        fail(
          WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
          "Wiki maintenance request event binding is invalid",
        );
      }
      return { event, request };
    });
  }

  _verifyCommittedRevision(settlement) {
    const revisionEvents = this._read().filter(
      (candidate) =>
        candidate.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        candidate.type === WIKI_LEDGER_EVENT_TYPE &&
        candidate.tenantId === this.descriptor.tenantId &&
        candidate.eventId ===
          `wiki.revision.${settlement.revisionId.slice("wiki:".length)}`,
    );
    if (revisionEvents.length !== 1) {
      fail(
        WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
        "Wiki maintenance settlement has no unique committed revision",
      );
    }
    const revision = this._resolveEvent(revisionEvents[0], "wiki-revision");
    if (
      revision?.schema !== WIKI_REVISION_SCHEMA ||
      revision.tenantId !== this.descriptor.tenantId ||
      revision.revisionId !== settlement.revisionId ||
      revision.revision !== settlement.revision ||
      revision.stateDigest !== settlement.stateDigest ||
      revision.stateDigest !== digestWikiState(revision.state)
    ) {
      fail(
        WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
        "Wiki maintenance settlement does not match its committed revision",
      );
    }
    return revision;
  }

  _settlements() {
    const requests = this._requests();
    return this._events(WIKI_MAINTENANCE_SETTLED_EVENT_TYPE).map((event) => {
      const settlement = verifySettlement(
        this._resolveEvent(event, SETTLEMENT_TYPE),
        this.descriptor,
      );
      this._verifyCommittedRevision(settlement);
      const request = requests.find(
        (entry) => entry.request.requestId === settlement.requestId,
      );
      if (
        !request ||
        settlement.requestDigest !== request.request.requestDigest ||
        event.eventId !==
          `${WIKI_MAINTENANCE_SETTLED_EVENT_TYPE}.${settlement.settlementDigest.slice(7)}` ||
        event.decision !== "committed" ||
        event.skillName !== null ||
        !Array.isArray(event.sourceRefs) ||
        event.sourceRefs.length !== 1 ||
        !same(event.sourceRefs[0], request.event.subjectRef)
      ) {
        fail(
          WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
          "Wiki maintenance settlement lineage is invalid",
        );
      }
      return { event, settlement };
    });
  }

  async _assertSource(request) {
    const verified = await this._verifySource(
      deepFreeze({
        tenantId: request.tenantId,
        kind: request.kind,
        sourceId: request.sourceId,
        sourceReceiptDigest: request.sourceReceiptDigest,
        evidenceRefs: request.evidenceRefs,
        effectiveAt: request.effectiveAt,
      }),
    );
    if (
      verified?.authenticated !== true ||
      verified.durable !== true ||
      verified.tenantId !== request.tenantId ||
      verified.kind !== request.kind ||
      verified.sourceId !== request.sourceId ||
      verified.receiptDigest !== request.sourceReceiptDigest ||
      !same(verified.evidenceRefs, request.evidenceRefs) ||
      verified.effectiveAt !== request.effectiveAt
    ) {
      throw new Error(
        "Wiki maintenance trigger source was not durably authenticated",
      );
    }
  }

  async enqueue(input) {
    const request = normalizeTrigger(input, this.descriptor);
    await this._assertSource(request);
    const eventId = `${WIKI_MAINTENANCE_REQUEST_EVENT_TYPE}.${request.requestDigest.slice(7)}`;
    const existing = this._requests().filter(
      (entry) => entry.event.eventId === eventId,
    );
    if (existing.length > 1) {
      fail(
        WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
        "Wiki maintenance request is duplicated in the ledger",
      );
    }
    if (existing.length === 1) {
      if (!same(existing[0].request, request)) {
        fail(
          WIKI_MAINTENANCE_TRIGGER_CONFLICT_CODE,
          "Wiki maintenance request id binds different content",
        );
      }
      return deepFreeze({
        queued: true,
        recovered: true,
        requestId: request.requestId,
        requestDigest: request.requestDigest,
      });
    }
    const head = this._verifyLedger();
    const published = this._put(REQUEST_TYPE, request, {
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
      fail(
        WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
        "Wiki maintenance request was not durably read back",
      );
    }
    try {
      const receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "proposed",
          eventId,
          reason: `${request.kind} requested Wiki maintenance`,
          skillName: null,
          sourceRefs: [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: request.effectiveAt,
          type: WIKI_MAINTENANCE_REQUEST_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (
        receipt?.authenticated !== true ||
        receipt.committed !== true ||
        receipt.durable !== true ||
        receipt.eventId !== eventId ||
        !DIGEST.test(receipt.receiptDigest ?? "")
      ) {
        fail(
          WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
          "Wiki maintenance request ledger append was not authenticated",
        );
      }
    } catch (cause) {
      const recovered = this._requests().find(
        (entry) => entry.event.eventId === eventId,
      );
      if (!recovered || !same(recovered.request, request)) throw cause;
      return deepFreeze({
        queued: true,
        recovered: true,
        requestId: request.requestId,
        requestDigest: request.requestDigest,
      });
    }
    return deepFreeze({
      queued: true,
      recovered: false,
      requestId: request.requestId,
      requestDigest: request.requestDigest,
    });
  }

  list() {
    const settlements = this._settlements();
    return deepFreeze(
      this._requests()
        .map(({ event, request }) => {
          const matches = settlements.filter(
            ({ settlement }) => settlement.requestId === request.requestId,
          );
          if (matches.length > 1) {
            fail(
              WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
              "Wiki maintenance request has conflicting settlements",
            );
          }
          return {
            request,
            requestEventDigest: event.eventDigest,
            requestEventSequence: event.sequence,
            status: matches.length === 1 ? "committed" : "pending",
            settlement: matches[0]?.settlement ?? null,
          };
        })
        .sort(
          (left, right) =>
            left.requestEventSequence - right.requestEventSequence,
        ),
    );
  }

  async _settle(request, result) {
    if (
      result?.maintenanceRequestId !== request.requestId ||
      !REVISION_ID.test(result?.revisionId ?? "") ||
      !Number.isSafeInteger(result?.revision) ||
      result.revision < 1 ||
      !DIGEST.test(result?.stateDigest ?? "")
    ) {
      throw new Error(
        "Maintainer did not confirm the exact durable request and revision",
      );
    }
    const existing = this.list().find(
      (entry) => entry.request.requestId === request.requestId,
    );
    if (existing?.settlement) {
      if (
        existing.settlement.revisionId !== result.revisionId ||
        existing.settlement.revision !== result.revision
      ) {
        fail(
          WIKI_MAINTENANCE_TRIGGER_CONFLICT_CODE,
          "Wiki maintenance request already settled to another revision",
        );
      }
      return deepFreeze({
        committed: true,
        recovered: true,
        settlement: existing.settlement,
      });
    }
    const nowMs = Number(this._now());
    if (!Number.isFinite(nowMs))
      throw new TypeError("trigger clock is invalid");
    const settlement = normalizeSettlement(
      {
        requestId: request.requestId,
        requestDigest: request.requestDigest,
        revisionId: result.revisionId,
        revision: result.revision,
        stateDigest: result.stateDigest,
        settledAt: new Date(nowMs).toISOString(),
      },
      this.descriptor,
    );
    this._verifyCommittedRevision(settlement);
    const requestEntry = this._requests().find(
      (entry) => entry.request.requestId === request.requestId,
    );
    if (!requestEntry) {
      fail(
        WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
        "Wiki maintenance request disappeared before settlement",
      );
    }
    const head = this._verifyLedger();
    const published = this._put(SETTLEMENT_TYPE, settlement, {
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
      fail(
        WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
        "Wiki maintenance settlement was not durably read back",
      );
    }
    const eventId = `${WIKI_MAINTENANCE_SETTLED_EVENT_TYPE}.${settlement.settlementDigest.slice(7)}`;
    try {
      const receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: `Wiki revision ${settlement.revision} committed for maintenance request`,
          skillName: null,
          sourceRefs: [requestEntry.event.subjectRef],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: settlement.settledAt,
          type: WIKI_MAINTENANCE_SETTLED_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (
        receipt?.authenticated !== true ||
        receipt.committed !== true ||
        receipt.durable !== true ||
        receipt.eventId !== eventId
      ) {
        fail(
          WIKI_MAINTENANCE_TRIGGER_CORRUPT_CODE,
          "Wiki maintenance settlement append was not authenticated",
        );
      }
    } catch (cause) {
      const recovered = this._settlements().find(
        (entry) => entry.settlement.requestId === request.requestId,
      );
      if (!recovered || !same(recovered.settlement, settlement)) throw cause;
      return deepFreeze({
        committed: true,
        recovered: true,
        settlement,
      });
    }
    return deepFreeze({ committed: true, recovered: false, settlement });
  }

  async processNext() {
    const pending = this.list().find((entry) => entry.status === "pending");
    if (!pending) return deepFreeze({ processed: false });
    const request = pending.request;
    await this._assertSource(request);
    const result = await this._maintain({
      evidenceRefs: request.evidenceRefs,
      effectiveAt: request.effectiveAt,
      maintenanceRequest: deepFreeze({
        schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
        tenantId: request.tenantId,
        requestId: request.requestId,
        requestDigest: request.requestDigest,
      }),
    });
    const settled = await this._settle(request, result);
    return deepFreeze({
      processed: true,
      requestId: request.requestId,
      revisionId: settled.settlement.revisionId,
      recovered: result.recovered === true || settled.recovered === true,
    });
  }
}

export function createWikiMaintenanceTriggerLedgerAdapter(options) {
  return new WikiMaintenanceTriggerLedgerAdapter(options);
}
