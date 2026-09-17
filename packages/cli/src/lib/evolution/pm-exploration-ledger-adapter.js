import { createHash } from "node:crypto";
import { isPromise, isProxy } from "node:util/types";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  EvolutionArtifactPorts,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EvolutionLedger,
} from "./evolution-ledger.js";
import {
  EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA,
  captureEvolutionLedgerDurableArtifactResolver,
} from "./evolution-ledger-ports.js";
import {
  exportPmExplorationRecoverySnapshot,
  restorePmExplorationJournal,
  verifyPmExplorationPlan,
} from "./pm-exploration-rounds.js";

export const PM_EXPLORATION_LEDGER_RECORD_SCHEMA =
  "chainlesschain.pm-exploration-ledger-record/v1";
export const PM_EXPLORATION_LEDGER_EVENT_TYPE =
  "pm.exploration.snapshot-committed";
export const PM_EXPLORATION_LEDGER_RESTORE_SCHEMA =
  "chainlesschain.pm-exploration-ledger-restore/v1";
export const PM_EXPLORATION_LEDGER_ACK_SCHEMA =
  "chainlesschain.pm-exploration-ledger-ack/v1";
export const PM_EXPLORATION_LEDGER_CORRUPT_CODE =
  "CC_PM_EXPLORATION_LEDGER_CORRUPT";
export const PM_EXPLORATION_LEDGER_CONFLICT_CODE =
  "CC_PM_EXPLORATION_LEDGER_CONFLICT";

const ARTIFACT_TYPE = "pm-exploration-recovery-snapshot";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DESCRIPTOR_KEYS = new Set([
  "tenantId",
  "artifactTenantId",
  "audience",
  "purpose",
  "planDigest",
  "durabilityAuthorityId",
]);
const RECORD_KEYS = new Set([
  "schema",
  "descriptorDigest",
  "revision",
  "priorSnapshotDigest",
  "snapshotDigest",
  "snapshot",
  "committedAt",
]);
const DURABILITY_AUTHORITY_KEYS = new Set(["id", "retain", "resolve"]);
const DURABILITY_RECEIPT_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "authorityId",
  "artifactTenantId",
  "digest",
  "purpose",
  "ref",
  "retention",
  "type",
  "receiptDigest",
]);
const STORE_PORTS = new WeakMap();

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

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      throw new TypeError(`${label}.${String(key)} must be an own data field`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function fail(code, message, options) {
  const error = new Error(message, options);
  error.code = code;
  throw error;
}

function corrupt(message, options) {
  fail(PM_EXPLORATION_LEDGER_CORRUPT_CODE, message, options);
}

function conflict(message, options) {
  fail(PM_EXPLORATION_LEDGER_CONFLICT_CODE, message, options);
}

function requireExactInstance(value, prototype, label) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== prototype
  ) {
    throw new TypeError(`${label} exact instance is required`);
  }
  return value;
}

function normalizeDescriptor(input) {
  exact(input, DESCRIPTOR_KEYS, "PM exploration ledger descriptor");
  const core = {
    tenantId: identifier(input.tenantId, "tenantId"),
    artifactTenantId: identifier(input.artifactTenantId, "artifactTenantId"),
    audience: identifier(input.audience, "audience"),
    purpose: identifier(input.purpose, "purpose"),
    planDigest: digest(input.planDigest, "planDigest"),
    durabilityAuthorityId: identifier(
      input.durabilityAuthorityId,
      "durabilityAuthorityId",
    ),
  };
  return deepFreeze({
    ...core,
    descriptorDigest: hash(
      "chainlesschain.pm-exploration-ledger-descriptor/v1",
      core,
    ),
  });
}

function captureDurabilityAuthority(value) {
  exact(value, DURABILITY_AUTHORITY_KEYS, "artifact durability authority");
  const retain = Object.getOwnPropertyDescriptor(value, "retain").value;
  const resolve = Object.getOwnPropertyDescriptor(value, "resolve").value;
  if (
    typeof retain !== "function" ||
    typeof resolve !== "function" ||
    isProxy(retain) ||
    isProxy(resolve)
  ) {
    throw new TypeError(
      "artifact durability authority requires direct retain and resolve methods",
    );
  }
  return Object.freeze({
    id: identifier(value.id, "artifact durability authority id"),
    retain: retain.bind(value),
  });
}

function snapshotPlan(plan) {
  verifyPmExplorationPlan(plan);
  return deepFreeze(structuredClone(plan));
}

function normalizeSnapshot(plan, snapshot) {
  const restored = restorePmExplorationJournal(plan, snapshot);
  return exportPmExplorationRecoverySnapshot(restored);
}

function parseRecord(resolution, descriptor, plan) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("PM exploration artifact resolution is unauthenticated");
  }
  let durable;
  const encoded = resolution.bytes.toString("utf8");
  try {
    durable = JSON.parse(encoded);
  } catch (cause) {
    corrupt("PM exploration artifact is not JSON", { cause });
  }
  if (
    durable?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    durable.tenantId !== descriptor.artifactTenantId ||
    durable.audience !== descriptor.audience ||
    durable.purpose !== descriptor.purpose ||
    durable.retention !== "ledger" ||
    durable.type !== ARTIFACT_TYPE
  ) {
    corrupt("PM exploration durable artifact binding is invalid");
  }
  try {
    exact(durable.value, RECORD_KEYS, "PM exploration ledger record");
  } catch (cause) {
    corrupt("PM exploration ledger record shape is invalid", { cause });
  }
  const record = durable.value;
  if (
    record.schema !== PM_EXPLORATION_LEDGER_RECORD_SCHEMA ||
    record.descriptorDigest !== descriptor.descriptorDigest ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1 ||
    (record.priorSnapshotDigest !== null &&
      !DIGEST.test(record.priorSnapshotDigest ?? "")) ||
    !DIGEST.test(record.snapshotDigest ?? "") ||
    !Number.isSafeInteger(record.committedAt) ||
    record.committedAt < 0
  ) {
    corrupt("PM exploration ledger record fields are invalid");
  }
  let snapshot;
  try {
    snapshot = normalizeSnapshot(plan, record.snapshot);
  } catch (cause) {
    corrupt("PM exploration recovery snapshot is invalid", { cause });
  }
  if (
    snapshot.snapshotDigest !== record.snapshotDigest ||
    !same(snapshot, record.snapshot)
  ) {
    corrupt("PM exploration recovery snapshot readback differs");
  }
  return deepFreeze({ ...record, snapshot });
}

function assertSnapshotExtension(previous, next) {
  if (!previous) return;
  if (previous.frozen !== null)
    conflict("frozen PM exploration state cannot be extended");
  if (next.checkpoints.length < previous.checkpoints.length)
    conflict("PM exploration snapshot would roll back checkpoints");
  if (
    !same(
      next.checkpoints.slice(0, previous.checkpoints.length),
      previous.checkpoints,
    )
  ) {
    conflict("PM exploration checkpoint history is not append-only");
  }
  const rank = { broad: 0, "broad-complete": 1, deep: 2, frozen: 3 };
  if (rank[next.stage] < rank[previous.stage])
    conflict("PM exploration stage would move backwards");
  if (previous.merge !== null && !same(previous.merge, next.merge))
    conflict("PM exploration merge evidence changed after commit");
}

function sameHead(left, right) {
  return [
    "epoch",
    "ledgerId",
    "identityDigest",
    "sequence",
    "headDigest",
  ].every((key) => left?.[key] === right?.[key]);
}

function acknowledgement(descriptor, entry, recovered) {
  return deepFreeze({
    schema: PM_EXPLORATION_LEDGER_ACK_SCHEMA,
    authenticated: true,
    durable: true,
    ledgerAuthenticated: true,
    ledgerDurable: true,
    artifactPersisted: true,
    artifactReadbackVerified: true,
    durabilityAuthorityId: descriptor.durabilityAuthorityId,
    authorityDurable: true,
    powerLossDurabilityTested: false,
    descriptorDigest: descriptor.descriptorDigest,
    revision: entry.record.revision,
    snapshotDigest: entry.record.snapshotDigest,
    ledgerEventDigest: entry.event.eventDigest,
    recovered,
    snapshotAuthenticated: false,
    qualifiesForPromotion: false,
  });
}

export class PmExplorationLedgerAdapter {
  #append;
  #clock;
  #plan;
  #put;
  #read;
  #resolve;
  #retain;
  #verify;

  constructor({
    descriptor: input,
    plan,
    artifactPorts,
    artifactDurabilityAuthority,
    ledger,
    ledgerArtifactResolver,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this.#plan = snapshotPlan(plan);
    if (this.#plan.planDigest !== this.descriptor.planDigest)
      throw new TypeError("PM exploration plan differs from ledger descriptor");
    const trustedArtifactPorts = requireExactInstance(
      artifactPorts,
      EvolutionArtifactPorts.prototype,
      "EvolutionArtifactPorts",
    );
    const trustedLedger = requireExactInstance(
      ledger,
      EvolutionLedger.prototype,
      "EvolutionLedger",
    );
    this.#put =
      EvolutionArtifactPorts.prototype.putCanonical.bind(trustedArtifactPorts);
    this.#read = EvolutionLedger.prototype.read.bind(trustedLedger);
    this.#verify = EvolutionLedger.prototype.verify.bind(trustedLedger);
    this.#append =
      EvolutionLedger.prototype.appendDomainEvent.bind(trustedLedger);
    const durabilityAuthority = captureDurabilityAuthority(
      artifactDurabilityAuthority,
    );
    if (durabilityAuthority.id !== this.descriptor.durabilityAuthorityId)
      throw new TypeError(
        "artifact durability authority differs from ledger descriptor",
      );
    const resolverBinding = captureEvolutionLedgerDurableArtifactResolver(
      ledgerArtifactResolver,
    );
    if (
      resolverBinding.authorityId !== durabilityAuthority.id ||
      resolverBinding.artifactTenantId !== this.descriptor.artifactTenantId ||
      resolverBinding.purpose !== this.descriptor.purpose ||
      !resolverBinding.matchesArtifactPorts(trustedArtifactPorts) ||
      !resolverBinding.matchesDurabilityAuthority(artifactDurabilityAuthority)
    ) {
      throw new TypeError(
        "durable artifact resolver differs from PM ledger authorities",
      );
    }
    if (typeof now !== "function" || isProxy(now))
      throw new TypeError("now must be a direct function");
    this.#resolve = ledgerArtifactResolver;
    this.#retain = durabilityAuthority.retain;
    this.#clock = now;
    STORE_PORTS.set(
      this,
      Object.freeze({
        load: () => this.load(),
        commitJournal: (journal) => this.commitJournal(journal),
        restoreLatestJournal: () => this.restoreLatestJournal(),
      }),
    );
    Object.freeze(this);
  }

  #events() {
    const events = this.#read();
    if (!Array.isArray(events))
      corrupt("EvolutionLedger did not return an event array");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === PM_EXPLORATION_LEDGER_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.planDigest,
    );
  }

  #resolveEvent(event, identity) {
    const resolution = this.#resolve({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef?.ref ||
      resolution?.digest !== event.subjectRef?.digest
    ) {
      corrupt("PM exploration ledger subject was substituted");
    }
    return parseRecord(resolution, this.descriptor, this.#plan);
  }

  #historyWithIdentity() {
    const before = this.#verify();
    const events = this.#events();
    const history = [];
    for (const [index, event] of events.entries()) {
      const previous = history.at(-1) ?? null;
      const record = this.#resolveEvent(event, before);
      if (
        record.revision !== index + 1 ||
        record.priorSnapshotDigest !==
          (previous?.record.snapshotDigest ?? null) ||
        event.artifactTenantId !== this.descriptor.artifactTenantId ||
        event.decision !== "committed" ||
        event.skillName !== null ||
        event.eventId !==
          `${PM_EXPLORATION_LEDGER_EVENT_TYPE}.${record.snapshotDigest.slice(7)}` ||
        event.reason !==
          `PM exploration recovery snapshot revision ${record.revision} committed` ||
        event.timestamp !== new Date(record.committedAt).toISOString() ||
        !DIGEST.test(event.eventDigest ?? "") ||
        !Array.isArray(event.sourceRefs) ||
        event.sourceRefs.length !== (previous ? 1 : 0) ||
        (previous && !same(event.sourceRefs[0], previous.event.subjectRef))
      ) {
        corrupt("PM exploration ledger history is invalid");
      }
      try {
        assertSnapshotExtension(
          previous?.record.snapshot ?? null,
          record.snapshot,
        );
      } catch (cause) {
        corrupt("PM exploration ledger snapshot history is discontinuous", {
          cause,
        });
      }
      history.push(deepFreeze({ event, record }));
    }
    const after = this.#verify();
    if (!sameHead(before, after))
      conflict("PM exploration ledger changed during authenticated read");
    return deepFreeze({ history, identity: after });
  }

  load() {
    const latest = this.#historyWithIdentity().history.at(-1) ?? null;
    if (!latest) return null;
    return deepFreeze({
      schema: PM_EXPLORATION_LEDGER_RESTORE_SCHEMA,
      authenticated: true,
      durable: true,
      ledgerAuthenticated: true,
      ledgerDurable: true,
      artifactPersisted: true,
      artifactReadbackVerified: true,
      durabilityAuthorityId: this.descriptor.durabilityAuthorityId,
      authorityDurable: true,
      powerLossDurabilityTested: false,
      descriptorDigest: this.descriptor.descriptorDigest,
      revision: latest.record.revision,
      snapshotDigest: latest.record.snapshotDigest,
      ledgerEventDigest: latest.event.eventDigest,
      snapshot: latest.record.snapshot,
      snapshotAuthenticated: false,
      qualifiesForPromotion: false,
    });
  }

  restoreLatestJournal() {
    const evidence = this.load();
    if (evidence === null) return null;
    const journal = restorePmExplorationJournal(this.#plan, evidence.snapshot);
    return Object.freeze({ journal, evidence });
  }

  commitJournal(journal) {
    let snapshot;
    try {
      snapshot = exportPmExplorationRecoverySnapshot(journal);
    } catch (cause) {
      if (cause?.message?.includes("Active rounds")) throw cause;
      corrupt("PM exploration journal cannot produce a recovery snapshot", {
        cause,
      });
    }
    if (snapshot.planDigest !== this.descriptor.planDigest)
      conflict("PM exploration journal belongs to another plan");
    const { history, identity } = this.#historyWithIdentity();
    const latest = history.at(-1) ?? null;
    if (latest?.record.snapshotDigest === snapshot.snapshotDigest)
      return acknowledgement(this.descriptor, latest, true);
    assertSnapshotExtension(latest?.record.snapshot ?? null, snapshot);

    const revision = history.length + 1;
    const committedAt = Number(this.#clock());
    if (!Number.isSafeInteger(committedAt) || committedAt < 0)
      throw new TypeError("PM exploration ledger clock is invalid");
    const record = deepFreeze({
      schema: PM_EXPLORATION_LEDGER_RECORD_SCHEMA,
      descriptorDigest: this.descriptor.descriptorDigest,
      revision,
      priorSnapshotDigest: latest?.record.snapshotDigest ?? null,
      snapshotDigest: snapshot.snapshotDigest,
      snapshot,
      committedAt,
    });
    const published = this.#put(ARTIFACT_TYPE, record, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.digest !== published.ref.digest ||
      published.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    ) {
      corrupt("PM exploration snapshot persistence was not confirmed");
    }
    const durableRecord = deepFreeze({
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
      schema: EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
      tenantId: this.descriptor.artifactTenantId,
      type: ARTIFACT_TYPE,
      value: record,
    });
    const durableBytes = Buffer.from(canonical(durableRecord), "utf8");
    if (sha256Bytes(durableBytes) !== published.digest)
      corrupt("PM exploration canonical artifact bytes differ after publish");
    const durabilityBinding = deepFreeze({
      artifactTenantId: this.descriptor.artifactTenantId,
      digest: published.digest,
      purpose: this.descriptor.purpose,
      ref: published.ref.ref,
      retention: "ledger",
      schema: EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
      type: ARTIFACT_TYPE,
    });
    const durabilityReceipt = this.#retain(
      Object.freeze({
        binding: durabilityBinding,
        bytes: Buffer.from(durableBytes),
        schema: EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA,
      }),
    );
    if (isPromise(durabilityReceipt))
      corrupt("PM exploration durability retain must be synchronous");
    try {
      exact(
        durabilityReceipt,
        DURABILITY_RECEIPT_KEYS,
        "PM exploration durability receipt",
      );
    } catch (cause) {
      corrupt("PM exploration durability receipt shape is invalid", { cause });
    }
    if (
      durabilityReceipt.schema !==
        EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA ||
      durabilityReceipt.authenticated !== true ||
      durabilityReceipt.durable !== true ||
      durabilityReceipt.authorityId !== this.descriptor.durabilityAuthorityId ||
      durabilityReceipt.artifactTenantId !==
        durabilityBinding.artifactTenantId ||
      durabilityReceipt.digest !== durabilityBinding.digest ||
      durabilityReceipt.purpose !== durabilityBinding.purpose ||
      durabilityReceipt.ref !== durabilityBinding.ref ||
      durabilityReceipt.retention !== durabilityBinding.retention ||
      durabilityReceipt.type !== durabilityBinding.type ||
      !DIGEST.test(durabilityReceipt.receiptDigest ?? "")
    ) {
      corrupt("PM exploration artifact was not durably retained");
    }
    const eventId = `${PM_EXPLORATION_LEDGER_EVENT_TYPE}.${snapshot.snapshotDigest.slice(7)}`;
    try {
      const receipt = this.#append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.planDigest,
          decision: "committed",
          eventId,
          reason: `PM exploration recovery snapshot revision ${revision} committed`,
          skillName: null,
          sourceRefs: latest ? [latest.event.subjectRef] : [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: new Date(committedAt).toISOString(),
          type: PM_EXPLORATION_LEDGER_EVENT_TYPE,
        },
        {
          expectedHeadDigest: identity.headDigest,
          expectedSequence: identity.sequence,
        },
      );
      if (
        receipt?.authenticated !== true ||
        receipt.committed !== true ||
        receipt.durable !== true ||
        receipt.eventId !== eventId ||
        !DIGEST.test(receipt.receiptDigest ?? "")
      ) {
        corrupt("PM exploration ledger append was not durably authenticated");
      }
    } catch (cause) {
      const recovered = this.#historyWithIdentity().history.at(-1) ?? null;
      if (recovered?.record.snapshotDigest !== snapshot.snapshotDigest)
        throw cause;
      return acknowledgement(this.descriptor, recovered, true);
    }
    const stored = this.#historyWithIdentity().history.at(-1) ?? null;
    if (
      stored?.record.revision !== revision ||
      stored.record.snapshotDigest !== snapshot.snapshotDigest
    ) {
      corrupt("PM exploration snapshot readback differs after commit");
    }
    return acknowledgement(this.descriptor, stored, false);
  }
}

export function capturePmExplorationLedgerStore(adapter) {
  const ports = STORE_PORTS.get(adapter);
  if (!ports)
    throw new TypeError("a real PmExplorationLedgerAdapter is required");
  return ports;
}
