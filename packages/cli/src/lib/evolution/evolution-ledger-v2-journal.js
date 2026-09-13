import { createHash } from "node:crypto";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { withFileLock } from "../with-file-lock.js";
import { EvolutionArtifactPorts } from "./evolution-artifact-ports.js";
import {
  captureEvolutionLedgerMigrationSource,
  EVOLUTION_LEDGER_MAX_EVENTS,
  EVOLUTION_LEDGER_V2_MIGRATION_INTENT,
  EVOLUTION_LEDGER_V2_CUTOVER_COMPLETED,
} from "./evolution-ledger.js";
import { captureEvolutionLedgerV2ManifestBackend } from "./evolution-ledger-v2-manifest-backend.js";

export const EVOLUTION_LEDGER_V2_JOURNAL_SCHEMA =
  "chainlesschain.evolution-ledger-v2-journal/v2";
export const EVOLUTION_LEDGER_V2_FINALIZATION_SCHEMA =
  "chainlesschain.evolution-ledger-v2-finalization/v2";
const JOURNALS = new WeakSet();
const RESERVED = new Set([
  EVOLUTION_LEDGER_V2_MIGRATION_INTENT,
  EVOLUTION_LEDGER_V2_CUTOVER_COMPLETED,
]);

function fail(message, cause, code = "CC_EVOLUTION_LEDGER_V2_JOURNAL_INVALID") {
  throw Object.assign(new Error(message, cause ? { cause } : undefined), {
    code,
    ...(code.endsWith("COMMIT_UNKNOWN")
      ? {
          commitState: "unknown",
          details: Object.freeze({ ...cause?.details, commitState: "unknown" }),
        }
      : {}),
  });
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
function record(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("journal configuration must be a plain data record");
  const keys = Reflect.ownKeys(value);
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => ![...required, ...optional].includes(key))
  )
    fail("journal configuration fields differ");
  const result = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!("value" in field))
      fail("journal configuration requires own data properties");
    result[key] = field.value;
  }
  return result;
}
function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value)
  )
    fail("journal scope identifier is invalid");
  return value;
}

/**
 * Authenticated, restartable cutover. V1 remains a signed write-ahead journal
 * and the authority for legacy receipts; every consumer success additionally
 * requires the complete payload to be read back from witnessed v2 storage.
 * No file-backed WORM authority or key material is synthesized here.
 */
export function createEvolutionLedgerV2Journal(options) {
  const config = record(
    options,
    [
      "sourceLedger",
      "backend",
      "artifactPorts",
      "descriptor",
      "minimumRetainedUntil",
    ],
    ["lock", "lockTimeoutMs"],
  );
  const scope = record(config.descriptor, [
    "tenantId",
    "artifactTenantId",
    "audience",
  ]);
  for (const key of Object.keys(scope)) identifier(scope[key]);
  const descriptor = Object.freeze({
    ...scope,
    schema: EVOLUTION_LEDGER_V2_JOURNAL_SCHEMA,
  });
  const source = captureEvolutionLedgerMigrationSource(config.sourceLedger);
  const ledger = source.ledger;
  const backend = captureEvolutionLedgerV2ManifestBackend(config.backend);
  const retention = config.minimumRetainedUntil;
  if (
    typeof retention !== "string" ||
    !Number.isFinite(Date.parse(retention)) ||
    new Date(retention).toISOString() !== retention
  )
    fail("canonical minimumRetainedUntil is required");
  const artifactPorts = config.artifactPorts;
  if (
    utilTypes.isProxy(artifactPorts) ||
    Object.getPrototypeOf(artifactPorts) !== EvolutionArtifactPorts.prototype
  )
    fail("constructed EvolutionArtifactPorts are required");
  // Calling the original private-field method also rejects prototype forgeries.
  const put = EvolutionArtifactPorts.prototype.putCanonical.bind(artifactPorts);
  const lock = config.lock ?? withFileLock;
  if (typeof lock !== "function" || utilTypes.isProxy(lock))
    fail("synchronous journal lock is required");
  const lockTimeoutMs = config.lockTimeoutMs ?? 10_000;
  if (
    !Number.isSafeInteger(lockTimeoutMs) ||
    lockTimeoutMs < 1 ||
    lockTimeoutMs > 60_000
  )
    fail("journal lock timeout is invalid");
  const locked = (operation) => {
    let calls = 0;
    const result = lock(
      path.join(ledger.authorityRootDir, "manifest-cutover-v2"),
      (context) => {
        if (++calls !== 1)
          fail("journal lock callback must execute exactly once");
        if (context?.locked !== true)
          fail("exclusive journal lock unavailable");
        return operation();
      },
      { failIfUnavailable: true, timeoutMs: lockTimeoutMs },
    );
    if (calls !== 1 || utilTypes.isPromise(result))
      fail("journal lock must complete synchronously");
    return result;
  };
  const sourceEvents = () =>
    ledger.read({ limit: EVOLUTION_LEDGER_MAX_EVENTS });

  function binding(authority) {
    if (
      backend.descriptor.epoch !== authority.epoch ||
      backend.descriptor.ledgerId !== authority.ledgerId ||
      backend.descriptor.tenantId !== scope.tenantId
    )
      fail("manifest backend and source ledger scope differ");
    return Object.freeze({
      authorityRootDigest: backend.descriptor.authorityRootDigest,
      epoch: authority.epoch,
      identityDigest: authority.identityDigest,
      ledgerId: authority.ledgerId,
      maximumEventsPerSegment: backend.descriptor.maximumEventsPerSegment,
      minimumRetainedUntil: retention,
      schema: EVOLUTION_LEDGER_V2_JOURNAL_SCHEMA,
      storeMarkerDigest: authority.storeMarkerDigest,
      storeMarkerEntryDigest: authority.storeMarkerEntryDigest,
      tenantId: scope.tenantId,
    });
  }
  function writeMarker(type, payload, before) {
    const reason = canonical(payload);
    const published = put("evolution-ledger-v2-journal", payload, {
      audience: scope.audience,
      purpose: "evolution-ledger",
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    )
      fail("migration journal artifact is not authenticated and durable");
    source.appendDomainEvent(
      {
        artifactTenantId: scope.artifactTenantId,
        correlationId: null,
        decision: "committed",
        eventId: `ledger-v2-${digest({ type, payload }).slice(7)}`,
        reason,
        skillName: null,
        sourceRefs: [],
        subjectRef: published.ref,
        tenantId: scope.tenantId,
        type,
      },
      {
        expectedSequence: before.length,
        expectedHeadDigest: before.at(-1)?.eventDigest ?? null,
      },
    );
  }
  function payload(marker) {
    try {
      return JSON.parse(marker.reason);
    } catch (cause) {
      fail("signed migration journal payload is invalid", cause);
    }
  }
  function prefix(events) {
    const persisted = backend.readEvents();
    if (
      persisted.length > events.length ||
      persisted.some(
        (event, index) => canonical(event) !== canonical(events[index]),
      )
    )
      fail("v2 payload is not the exact authenticated v1 prefix");
    return persisted;
  }
  function copySuffix(events, persisted) {
    let receipt = null;
    for (
      let offset = persisted.length;
      offset < events.length;
      offset += backend.descriptor.maximumEventsPerSegment
    ) {
      const current = backend.read();
      receipt = backend.appendSegment({
        events: events.slice(
          offset,
          offset + backend.descriptor.maximumEventsPerSegment,
        ),
        expectedHeadDigest: current.head?.headDigest ?? null,
        expectedWitnessDigest: current.witness.witnessDigest,
        minimumRetainedUntil: retention,
      });
      if (receipt.conflict === true)
        fail(
          "v2 journal finalize conflicted; reopen before retrying",
          undefined,
          "CC_EVOLUTION_LEDGER_V2_JOURNAL_COMMIT_UNKNOWN",
        );
    }
    if (prefix(events).length !== events.length)
      fail("v2 journal readback is incomplete");
    return receipt;
  }
  function recover() {
    const authority = ledger.verify();
    const expectedBinding = binding(authority);
    let events = sourceEvents();
    let intents = events.filter(
      (event) => event.type === EVOLUTION_LEDGER_V2_MIGRATION_INTENT,
    );
    let completed = events.filter(
      (event) => event.type === EVOLUTION_LEDGER_V2_CUTOVER_COMPLETED,
    );
    if (
      intents.length > 1 ||
      completed.length > 1 ||
      (!intents.length && completed.length)
    )
      fail("migration journal markers are incoherent");
    if (!intents.length) {
      if (backend.read().head !== null)
        fail("an unbound manifest backend cannot be adopted");
      if (events.length + 2 > EVOLUTION_LEDGER_MAX_EVENTS)
        fail("ledger lacks capacity for migration journal markers");
      writeMarker(
        EVOLUTION_LEDGER_V2_MIGRATION_INTENT,
        {
          binding: expectedBinding,
          sourceEventDigest: events.at(-1)?.eventDigest ?? null,
          sourceSequence: events.length,
        },
        events,
      );
      events = sourceEvents();
      intents = events.filter(
        (event) => event.type === EVOLUTION_LEDGER_V2_MIGRATION_INTENT,
      );
    }
    const intent = intents[0];
    const intentPayload = payload(intent);
    if (
      canonical(intentPayload.binding) !== canonical(expectedBinding) ||
      intentPayload.sourceSequence !== intent.sequence - 1 ||
      intentPayload.sourceEventDigest !==
        (events[intent.sequence - 2]?.eventDigest ?? null)
    )
      fail("migration journal authority or source prefix binding differs");
    let persisted = prefix(events);
    if (completed.length) {
      const complete = completed[0];
      const completion = payload(complete);
      if (
        complete.sequence <= intent.sequence ||
        canonical(completion.binding) !== canonical(expectedBinding) ||
        completion.intentDigest !== intent.eventDigest ||
        completion.sourceSequence !== complete.sequence - 1 ||
        completion.sourceEventDigest !==
          events[complete.sequence - 2]?.eventDigest ||
        persisted.length < completion.sourceSequence
      )
        fail("completed v2 cutover was rolled back or rebound");
    }
    copySuffix(events, persisted);
    if (!completed.length) {
      writeMarker(
        EVOLUTION_LEDGER_V2_CUTOVER_COMPLETED,
        {
          binding: expectedBinding,
          intentDigest: intent.eventDigest,
          sourceEventDigest: events.at(-1).eventDigest,
          sourceSequence: events.length,
        },
        events,
      );
      persisted = events;
      events = sourceEvents();
      copySuffix(events, persisted);
      completed = events.filter(
        (event) => event.type === EVOLUTION_LEDGER_V2_CUTOVER_COMPLETED,
      );
    }
    return {
      events: backend.readEvents(),
      checkpoint: backend.read(),
      intent: intents[0],
      completed: completed[0],
    };
  }
  function readOperation(operation) {
    return locked(() => {
      const current = recover();
      return operation(current);
    });
  }
  function append(method, inputs, options, batch, finalized) {
    return locked(() => {
      const before = recover().events;
      const entries = batch ? inputs : [inputs];
      if (
        !Array.isArray(entries) ||
        utilTypes.isProxy(entries) ||
        entries.length < 1 ||
        entries.length > backend.descriptor.maximumEventsPerSegment
      )
        fail("live batch must fit one manifest segment");
      for (let index = 0; index < entries.length; index++) {
        const entry = Object.getOwnPropertyDescriptor(entries, String(index));
        if (
          !entry ||
          !("value" in entry) ||
          !entry.value ||
          utilTypes.isProxy(entry.value)
        )
          fail("live batch requires dense data events");
        const type = Object.getOwnPropertyDescriptor(entry.value, "type");
        const tenant = Object.getOwnPropertyDescriptor(entry.value, "tenantId");
        if (
          !type ||
          !("value" in type) ||
          RESERVED.has(type.value) ||
          !tenant ||
          !("value" in tenant) ||
          tenant.value !== scope.tenantId
        )
          fail("live event type or tenant is invalid");
      }
      let receipt;
      try {
        receipt = source[method](inputs, options);
      } catch (cause) {
        let changed = true;
        try {
          changed = sourceEvents().length !== before.length;
        } catch {
          /* Unknown WAL state remains fail-closed. */
        }
        if (changed)
          fail(
            "v1 batch may have partially committed; reopen the v2 journal before retrying",
            cause,
            "CC_EVOLUTION_LEDGER_V2_JOURNAL_COMMIT_UNKNOWN",
          );
        throw cause;
      }
      let checkpoint;
      try {
        const events = sourceEvents();
        if (events.length !== before.length + entries.length)
          fail("v1 batch readback differs");
        checkpoint = copySuffix(events, before);
      } catch (cause) {
        fail(
          "v1 WAL committed; v2 finalization must be recovered before success",
          cause,
          "CC_EVOLUTION_LEDGER_V2_JOURNAL_COMMIT_UNKNOWN",
        );
      }
      return finalized
        ? Object.freeze({
            schema: EVOLUTION_LEDGER_V2_FINALIZATION_SCHEMA,
            receipt,
            checkpoint,
          })
        : receipt;
    });
  }
  const journal = Object.freeze({
    descriptor,
    rootDir: ledger.rootDir,
    authorityRootDir: ledger.authorityRootDir,
    append: (input, options = {}) =>
      append("append", input, options, false, false),
    appendBatch: (inputs, options = {}) =>
      append("appendBatch", inputs, options, true, false),
    appendDomainEvent: (input, options = {}) =>
      append("appendDomainEvent", input, options, false, false),
    appendDomainEventBatch: (inputs, options = {}) =>
      append("appendDomainEventBatch", inputs, options, true, false),
    finalizeBatch: (inputs, options = {}) =>
      append("appendBatch", inputs, options, true, true),
    finalizeDomainEventBatch: (inputs, options = {}) =>
      append("appendDomainEventBatch", inputs, options, true, true),
    read: (options = {}) =>
      readOperation(({ events }) => {
        // Preserve exact v1 read validation and return events recovered from v2.
        const selected = ledger.read(options);
        return Object.freeze(
          selected.map((event) => events[event.sequence - 1]),
        );
      }),
    query: (selector, options = {}) =>
      readOperation(({ events }) => {
        const result = ledger.query(selector, options);
        return result
          ? Object.freeze({
              ...result,
              event: events[result.event.sequence - 1],
            })
          : null;
      }),
    queryMany: (selectors, options = {}) =>
      readOperation(({ events }) =>
        Object.freeze(
          ledger.queryMany(selectors, options).map((result) =>
            result
              ? Object.freeze({
                  ...result,
                  event: events[result.event.sequence - 1],
                })
              : null,
          ),
        ),
      ),
    findByEventId: (eventId) =>
      readOperation(({ events }) => {
        const event = ledger.findByEventId(eventId);
        return event ? events[event.sequence - 1] : null;
      }),
    recoverReceipt: (selector) =>
      readOperation(() => ledger.recoverReceipt(selector)),
    verifyReceipt: (receipt, options = {}) =>
      readOperation(() => ledger.verifyReceipt(receipt, options)),
    verify: () => readOperation(() => ledger.verify()),
    getAuthority: () => readOperation(() => ledger.getAuthority()),
    checkpointState: () => readOperation(() => ledger.checkpointState()),
    exportAuditBundle: () => readOperation(() => ledger.exportAuditBundle()),
    recover: () =>
      readOperation(({ checkpoint, intent, completed }) =>
        Object.freeze({ checkpoint, intent, completed }),
      ),
  });
  locked(recover);
  JOURNALS.add(journal);
  return journal;
}

export function isEvolutionLedgerV2Journal(value) {
  return JOURNALS.has(value);
}

// Production factory receives authenticated scope, not a structural ledger or a
// capability to bypass cutover. Capturing the result enforces the backend brand.
export function createEvolutionLedgerV2JournalFromFactory(
  sourceLedger,
  configuration,
  options = {},
) {
  const config = record(configuration, [
    "createBackend",
    "artifactPorts",
    "descriptor",
    "minimumRetainedUntil",
  ]);
  if (
    typeof config.createBackend !== "function" ||
    utilTypes.isProxy(config.createBackend)
  )
    fail("explicit manifest backend construction authority is required");
  const authority =
    captureEvolutionLedgerMigrationSource(sourceLedger).ledger.getAuthority();
  const scope = Object.freeze({
    ...record(config.descriptor, ["tenantId", "artifactTenantId", "audience"]),
  });
  const backend = config.createBackend(
    Object.freeze({ authority, descriptor: scope }),
  );
  return createEvolutionLedgerV2Journal({
    sourceLedger,
    backend,
    artifactPorts: config.artifactPorts,
    descriptor: scope,
    minimumRetainedUntil: config.minimumRetainedUntil,
    ...options,
  });
}
