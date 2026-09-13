import crypto from "node:crypto";
import { types } from "node:util";
import evolutionRun from "@chainlesschain/session-core/evolution-run";

import { EvolutionEvidenceArtifactAdapter } from "./evolution-evidence-artifact-adapter.js";
import {
  EVOLUTION_AGENT_MODEL_PROJECTION_RULESET_DIGEST,
  EVOLUTION_PROJECTION_RULESET_DIGEST,
} from "./evolution-evidence-projector.js";
import { EvolutionRunLedgerAdapter } from "./evolution-run-ledger-adapter.js";
import { captureEvolutionRunWikiMaintenanceProducer } from "./evolution-run-wiki-maintenance-source.js";
import { WIKI_MAINTENANCE_TRIGGER_KIND } from "./wiki-maintenance-trigger-ledger-adapter.js";
import { captureEvolutionReleaseTrain } from "./evolution-release-train.js";
import {
  snapshotAgentModelRequest,
  buildAgentModelRequest,
} from "./agent-model-projection.js";

const { EVOLUTION_RUN_EVENT_SCHEMA, EVENT_TYPES } = evolutionRun;

export const AGENT_EVOLUTION_INGRESS_SCHEMA =
  "chainlesschain.agent-evolution-ingress/v1";
export const AGENT_EVOLUTION_INGRESS_FAILED_CODE =
  "CC_AGENT_EVOLUTION_INGRESS_FAILED";

const RESPONSE_CACHE_RECORD_SCHEMA =
  "chainlesschain.model-response-cache/v2";
const LEGACY_RESPONSE_CACHE_RECORD_SCHEMA =
  "chainlesschain.model-response-cache/v1";
const RESPONSE_CACHE_IDENTIFIER_BINDING_SCHEMA =
  "chainlesschain.model-response-cache-identifier-binding/v1";
const HEX_ALPHA = "abcdefghijklmnop";

const INGRESSES = new WeakSet();
const CORE_EVENT_KINDS = new Map([
  ["tool-executing", "tool-requested"],
  ["tool-result", "tool-completed"],
  ["tool-error", "tool-failed"],
  ["response-complete", "response-completed"],
  ["run-ended", "goal-ended"],
]);

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function canonical(value, seen = new Set()) {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Agent evolution evidence must be finite JSON");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (!value || typeof value !== "object") {
    throw new TypeError("Agent evolution evidence must be JSON-compatible");
  }
  if (types.isProxy(value) || seen.has(value)) {
    throw new TypeError("Agent evolution evidence must be acyclic plain data");
  }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Agent evolution evidence must use plain objects");
  }
  const keys = Reflect.ownKeys(value).filter(
    (key) => !(array && key === "length"),
  );
  if (
    array &&
    (keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)))
  ) {
    throw new TypeError("Agent evolution evidence arrays must be dense data");
  }
  seen.add(value);
  try {
    const entries = (array ? keys : keys.sort()).map((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        !property?.enumerable ||
        !("value" in property)
      ) {
        throw new TypeError(
          "Agent evolution evidence cannot contain accessors or symbols",
        );
      }
      const encoded = canonical(property.value, seen);
      return array ? encoded : `${JSON.stringify(key)}:${encoded}`;
    });
    return array ? `[${entries.join(",")}]` : `{${entries.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function clone(value) {
  return JSON.parse(canonical(value));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function cacheIdentifierBinding(kind, value) {
  const input = requiredString(value, `Cache ${kind}`);
  const bytes = crypto
    .createHash("sha256")
    .update(
      `${RESPONSE_CACHE_IDENTIFIER_BINDING_SCHEMA}\0${kind}\0${input}`,
      "utf8",
    )
    .digest();
  let encoded = "";
  for (const byte of bytes) {
    encoded += HEX_ALPHA[byte >>> 4] + HEX_ALPHA[byte & 0x0f];
  }
  return encoded;
}

function timestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical timestamp`);
  }
  return value;
}

function normalizeId(value, label) {
  const result = requiredString(value, label);
  if (Buffer.byteLength(result, "utf8") > 256) {
    throw new TypeError(`${label} is too long`);
  }
  return result;
}

function ingressFailure(cause) {
  if (cause?.code === AGENT_EVOLUTION_INGRESS_FAILED_CODE) return cause;
  const error = new Error(
    `Agent evolution ingress failed: ${cause?.message || String(cause)}`,
    { cause },
  );
  error.code = AGENT_EVOLUTION_INGRESS_FAILED_CODE;
  return error;
}

function guardIngress(operation) {
  return Promise.resolve(operation).catch((cause) => {
    throw ingressFailure(cause);
  });
}

export function createAgentEvolutionIngress({
  evidenceAdapter,
  runAdapter,
  sourceEnvelopeAuthority,
  openCacheSourceRun = null,
  wikiMaintenanceProducer = null,
  releaseTrain = null,
  completionTriggerKind = WIKI_MAINTENANCE_TRIGGER_KIND.SESSION_END,
  now = () => new Date(),
  idGenerator = () => crypto.randomUUID(),
} = {}) {
  if (!(evidenceAdapter instanceof EvolutionEvidenceArtifactAdapter)) {
    throw new TypeError("an EvolutionEvidenceArtifactAdapter is required");
  }
  if (!(runAdapter instanceof EvolutionRunLedgerAdapter)) {
    throw new TypeError("an EvolutionRunLedgerAdapter is required");
  }
  if (typeof sourceEnvelopeAuthority?.issue !== "function") {
    throw new TypeError("sourceEnvelopeAuthority.issue is required");
  }
  if (typeof now !== "function" || typeof idGenerator !== "function") {
    throw new TypeError("ingress clock and idGenerator must be functions");
  }
  const maintenanceProducer =
    wikiMaintenanceProducer === null
      ? null
      : captureEvolutionRunWikiMaintenanceProducer(wikiMaintenanceProducer);
  const completionReleaseTrain =
    releaseTrain === null ? null : captureEvolutionReleaseTrain(releaseTrain);
  if (
    ![
      WIKI_MAINTENANCE_TRIGGER_KIND.SESSION_END,
      WIKI_MAINTENANCE_TRIGGER_KIND.GOAL_END,
    ].includes(completionTriggerKind)
  ) {
    throw new TypeError(
      "Agent completion trigger kind must be session-end or goal-end",
    );
  }
  const issueSourceEnvelope = sourceEnvelopeAuthority.issue.bind(
    sourceEnvelopeAuthority,
  );
  const descriptor = runAdapter.descriptor;
  if (openCacheSourceRun !== null && typeof openCacheSourceRun !== "function")
    throw new TypeError("cache source Run opener must be a function");
  let tail = Promise.resolve();
  let admissionFailure = null;
  let lastModelResponse = null;
  let modelAdmissionPending = false;

  const serialize = (operation) => {
    const invoke = async () => {
      if (admissionFailure !== null) throw admissionFailure;
      try {
        return await operation();
      } catch (cause) {
        // Every evidence boundary is fail-stop, not just model admission.
        // Latch before releasing queued requests or completion operations.
        admissionFailure ??= ingressFailure(cause);
        throw admissionFailure;
      }
    };
    const pending = tail.then(invoke, invoke);
    tail = pending.catch(() => undefined);
    return pending;
  };

  const cloneEvidence = (value) => {
    if (admissionFailure !== null) throw admissionFailure;
    try {
      return clone(value);
    } catch (cause) {
      admissionFailure = ingressFailure(cause);
      throw admissionFailure;
    }
  };

  const currentTimestamp = () => {
    const value = now();
    const iso = value instanceof Date ? value.toISOString() : value;
    return timestamp(iso, "ingress timestamp");
  };

  const appendStarted = () => {
    const loaded = runAdapter.load();
    if (loaded.events.length > 0) return loaded.projection;
    const occurredAt = currentTimestamp();
    return runAdapter.appendEvent({
      schema: EVOLUTION_RUN_EVENT_SCHEMA,
      tenantId: descriptor.tenantId,
      runId: descriptor.runId,
      eventId: `${descriptor.runId}:started`,
      sequence: 1,
      type: EVENT_TYPES.RUN_STARTED,
      subjectId: descriptor.runId,
      payloadDigest: digest({ occurredAt, runtime: "agent" }),
      artifactRef: null,
      keyRef: null,
      data: { occurredAt, runtime: "agent" },
    }).projection;
  };

  const ingest = (
    kind,
    evidence,
    options = {},
    modelRequest = null,
    cacheRecord = false,
  ) =>
    guardIngress(
      serialize(async () => {
        if (admissionFailure !== null) throw admissionFailure;
        const projection = appendStarted();
        if (projection.status === "completed") {
          throw new Error(
            "completed EvolutionRun cannot accept Agent evidence",
          );
        }
        const eventId = normalizeId(
          options.eventId ?? `agent:${idGenerator()}`,
          "Agent evidence eventId",
        );
        const occurredAt = timestamp(
          options.occurredAt ?? currentTimestamp(),
          "Agent evidence occurredAt",
        );
        if (cacheRecord && lastModelResponse === null)
          throw new Error("Cache receipt requires a recorded model response");
        const payload = cacheRecord
          ? {
              schema: RESPONSE_CACHE_RECORD_SCHEMA,
              identifierBindingSchema:
                RESPONSE_CACHE_IDENTIFIER_BINDING_SCHEMA,
              requestKeyBinding: cacheIdentifierBinding(
                "request key",
                evidence.requestKey,
              ),
              sourceRunIdBinding: cacheIdentifierBinding(
                "source Run ID",
                descriptor.runId,
              ),
              sourceEventIdBinding: cacheIdentifierBinding(
                "source event ID",
                lastModelResponse.eventId,
              ),
              responseEvent: clone(lastModelResponse.event),
            }
          : (modelRequest ?? clone(evidence));
        const sourceEnvelope = await issueSourceEnvelope(
          Object.freeze({
            schema: AGENT_EVOLUTION_INGRESS_SCHEMA,
            tenantId: descriptor.tenantId,
            runId: descriptor.runId,
            eventId,
            kind,
            occurredAt,
            evidence: payload,
          }),
        );
        const projectionInput = {
          sourceEnvelope,
          payload,
        };
        const persisted =
          modelRequest === null
            ? await evidenceAdapter.projectAndPersist(projectionInput)
            : await EvolutionEvidenceArtifactAdapter.prototype.projectAndPersistAgentModelRequest.call(
                evidenceAdapter,
                projectionInput,
              );
        if (
          persisted?.tenantId !== descriptor.tenantId ||
          persisted.evidenceId == null ||
          persisted.manifest?.type !== "evidence" ||
          typeof persisted.manifest.ref?.ref !== "string"
        ) {
          throw new Error(
            "Agent evidence persistence returned an unbound result",
          );
        }
        const current = runAdapter.load();
        const appended = runAdapter.appendEvent({
          schema: EVOLUTION_RUN_EVENT_SCHEMA,
          tenantId: descriptor.tenantId,
          runId: descriptor.runId,
          eventId,
          sequence: current.events.length + 1,
          type: EVENT_TYPES.RAW_EVENT_REFERENCED,
          subjectId: persisted.evidenceId,
          payloadDigest: persisted.manifest.digest,
          artifactRef: persisted.manifest.ref.ref,
          keyRef: null,
          data: {
            evidenceKind: kind,
            occurredAt,
            derivationManifestDigest: persisted.manifest.digest,
          },
        });
        if (kind === "model-input") {
          lastModelResponse = null;
          modelAdmissionPending = true;
        } else if (kind === "response-completed" && modelAdmissionPending) {
          lastModelResponse = { eventId, event: clone(payload.event) };
          modelAdmissionPending = false;
        }
        if (cacheRecord)
          return clone({
            schema: "chainlesschain.model-response-cache-receipt/v1",
            tenantId: descriptor.tenantId,
            runId: descriptor.runId,
            eventId,
            artifact: persisted,
          });
        if (modelRequest === null) return appended;
        // Resolve the published manifest and every attested component afresh.
        // The prototype call requires the real adapter's private state; an
        // instance-shaped facade cannot mint model-visible input.
        const resolved =
          await EvolutionEvidenceArtifactAdapter.prototype.resolve.call(
            evidenceAdapter,
            persisted,
          );
        if (
          resolved.verification.verified !== true ||
          resolved.verification.tenantId !== descriptor.tenantId ||
          resolved.bundle.modelProjection.rulesetDigest !==
            EVOLUTION_AGENT_MODEL_PROJECTION_RULESET_DIGEST ||
          resolved.bundle.modelProjection.evidenceId !== persisted.evidenceId
        ) {
          throw new Error("Agent model projection readback is unbound");
        }
        // A concurrent writer/completion must not make this stale admission
        // authoritative. Reauthenticate the exact committed Run frontier.
        if (
          digest(runAdapter.load().projection) !== digest(appended.projection)
        ) {
          throw new Error("Agent model projection Run frontier changed");
        }
        if (admissionFailure !== null) throw admissionFailure;
        return buildAgentModelRequest(
          modelRequest,
          resolved.bundle.modelProjection,
        );
      }),
    );

  const ingress = Object.freeze({
    schema: AGENT_EVOLUTION_INGRESS_SCHEMA,
    tenantId: descriptor.tenantId,
    runId: descriptor.runId,
    createResponseCacheReceipt: async (input) => {
      const snapshot = cloneEvidence(input);
      const requestKey = snapshot?.requestKey;
      if (
        typeof requestKey !== "string" ||
        !/^[a-f0-9]{64}$/.test(requestKey)
      ) {
        admissionFailure ??= ingressFailure(
          new TypeError("Cache request key must be SHA-256"),
        );
        throw admissionFailure;
      }
      return ingest("model-response-cache", { requestKey }, {}, null, true);
    },
    replayResponseCache: async (input) => {
      const snapshot = cloneEvidence(input);
      const response = await guardIngress(
        serialize(async () => {
          const { receipt, requestKey } = snapshot;
          if (
            typeof requestKey !== "string" ||
            !/^[a-f0-9]{64}$/.test(requestKey) ||
            !receipt ||
            receipt.schema !==
              "chainlesschain.model-response-cache-receipt/v1" ||
            receipt.tenantId !== descriptor.tenantId ||
            !openCacheSourceRun
          )
            throw new Error("Invalid or cross-tenant response cache receipt");
          const opened = openCacheSourceRun(receipt.runId);
          const source = opened?.runAdapter;
          if (
            !(source instanceof EvolutionRunLedgerAdapter) ||
            !(
              opened.evidenceAdapter instanceof EvolutionEvidenceArtifactAdapter
            ) ||
            source.descriptor.tenantId !== descriptor.tenantId ||
            source.descriptor.runId !== receipt.runId
          )
            throw new Error("Unbound response cache source Run");
          const loaded = source.load();
          const event = loaded.events.find(
            (item) => item.eventId === receipt.eventId,
          );
          if (
            loaded.projection?.status !== "completed" ||
            event?.data?.evidenceKind !== "model-response-cache" ||
            event.subjectId !== receipt.artifact?.evidenceId ||
            event.artifactRef !== receipt.artifact?.manifest?.ref?.ref ||
            event.payloadDigest !== receipt.artifact?.manifest?.digest
          )
            throw new Error(
              "Cache receipt is not committed in a completed Run",
            );
          const resolved =
            await EvolutionEvidenceArtifactAdapter.prototype.resolve.call(
              opened.evidenceAdapter,
              receipt.artifact,
            );
          const projection = resolved.bundle.modelProjection;
          const record = projection.content;
          const legacyRecord =
            record?.schema === LEGACY_RESPONSE_CACHE_RECORD_SCHEMA;
          const currentRecord =
            record?.schema === RESPONSE_CACHE_RECORD_SCHEMA &&
            record.identifierBindingSchema ===
              RESPONSE_CACHE_IDENTIFIER_BINDING_SCHEMA &&
            record.requestKeyBinding ===
              cacheIdentifierBinding("request key", requestKey) &&
            record.sourceRunIdBinding ===
              cacheIdentifierBinding("source Run ID", receipt.runId) &&
            typeof record.sourceEventIdBinding === "string" &&
            /^[a-p]{64}$/u.test(record.sourceEventIdBinding);
          if (
            resolved.verification.verified !== true ||
            resolved.verification.tenantId !== descriptor.tenantId ||
            projection.rulesetDigest !== EVOLUTION_PROJECTION_RULESET_DIGEST ||
            projection.visibility !== "model-visible" ||
            projection.truncated ||
            projection.injectionFindings.length !== 0 ||
            (!currentRecord &&
              (!legacyRecord ||
                record.requestKey !== requestKey ||
                record.sourceRunId !== receipt.runId)) ||
            record.responseEvent?.type !== "response-complete"
          )
            throw new Error(
              "Cache response projection is not safe or request-bound",
            );
          const responseEvent = loaded.events.find(
            (item) =>
              legacyRecord
                ? item.eventId === record.sourceEventId
                : cacheIdentifierBinding("source event ID", item.eventId) ===
                  record.sourceEventIdBinding,
          );
          if (
            responseEvent?.data?.evidenceKind !== "response-completed" ||
            responseEvent.sequence >= event.sequence
          )
            throw new Error("Cache receipt lacks its preceding model response");
          // Reopen after asynchronous attestation checks; no cached Run authority.
          if (digest(source.load()) !== digest(loaded))
            throw new Error("Cache source Run changed during verification");
          return clone(record.responseEvent);
        }),
      );
      await ingest("model-response-cache-replayed", {
        requestKey: snapshot.requestKey,
        sourceReceipt: snapshot.receipt,
        responseEvent: response,
      });
      return response;
    },
    start: () => guardIngress(serialize(() => appendStarted())),
    prepareModelRequest: (request) => {
      if (admissionFailure !== null) return Promise.reject(admissionFailure);
      let snapshot;
      try {
        snapshot = snapshotAgentModelRequest(request);
      } catch (error) {
        admissionFailure = ingressFailure(error);
        return Promise.reject(admissionFailure);
      }
      return ingest("model-input", snapshot, {}, snapshot);
    },
    ingestUserPrompt: async (input, options) =>
      ingest("user-prompt", { input: cloneEvidence(input) }, options),
    ingestAgentEvent: async (event, options) => {
      if (admissionFailure !== null) throw admissionFailure;
      let type;
      try {
        if (types.isProxy(event))
          throw new TypeError("Agent event cannot be a Proxy");
        const property =
          event && typeof event === "object"
            ? Object.getOwnPropertyDescriptor(event, "type")
            : null;
        if (property && !("value" in property))
          throw new TypeError("Agent event type cannot be an accessor");
        type = property?.value;
      } catch (cause) {
        admissionFailure = ingressFailure(cause);
        throw admissionFailure;
      }
      const baseKind = CORE_EVENT_KINDS.get(type);
      if (!baseKind) {
        return Promise.resolve(Object.freeze({ ignored: true }));
      }
      const snapshot = cloneEvidence(event);
      const kind =
        type === "tool-result" &&
        Boolean(
          snapshot.error || snapshot.result?.error || snapshot.result?.isError,
        )
          ? "tool-failed"
          : baseKind;
      return ingest(kind, { event: snapshot }, options);
    },
    complete: (options = {}) =>
      guardIngress(
        serialize(async () => {
          if (admissionFailure !== null) throw admissionFailure;
          const loaded = runAdapter.load();
          let projection;
          if (loaded.projection?.status === "completed") {
            projection = loaded.projection;
          } else {
            if (loaded.events.length === 0) appendStarted();
            const current = runAdapter.load();
            const occurredAt = timestamp(
              options.occurredAt ?? currentTimestamp(),
              "Agent completion occurredAt",
            );
            projection = runAdapter.appendEvent({
              schema: EVOLUTION_RUN_EVENT_SCHEMA,
              tenantId: descriptor.tenantId,
              runId: descriptor.runId,
              eventId: `${descriptor.runId}:completed`,
              sequence: current.events.length + 1,
              type: EVENT_TYPES.RUN_COMPLETED,
              subjectId: descriptor.runId,
              payloadDigest: digest({ occurredAt, status: "completed" }),
              artifactRef: null,
              keyRef: null,
              data: { occurredAt, status: "completed" },
            }).projection;
          }
          if (maintenanceProducer !== null) {
            await maintenanceProducer.enqueueCompletedRun({
              kind: completionTriggerKind,
              runId: descriptor.runId,
            });
          }
          if (completionReleaseTrain !== null) {
            await completionReleaseTrain.run();
          }
          return projection;
        }),
      ),
  });
  INGRESSES.add(ingress);
  return ingress;
}

export function captureAgentEvolutionIngress(value, options = {}) {
  if (!INGRESSES.has(value)) {
    throw new TypeError("a branded Agent evolution ingress is required");
  }
  if (options.tenantId != null && value.tenantId !== options.tenantId) {
    throw new TypeError("Agent evolution ingress belongs to another tenant");
  }
  return value;
}
