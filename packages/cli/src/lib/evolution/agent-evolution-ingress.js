import crypto from "node:crypto";
import evolutionRun from "@chainlesschain/session-core/evolution-run";

import { EvolutionEvidenceArtifactAdapter } from "./evolution-evidence-artifact-adapter.js";
import { EvolutionRunLedgerAdapter } from "./evolution-run-ledger-adapter.js";
import { captureEvolutionRunWikiMaintenanceProducer } from "./evolution-run-wiki-maintenance-source.js";
import { WIKI_MAINTENANCE_TRIGGER_KIND } from "./wiki-maintenance-trigger-ledger-adapter.js";
import { captureEvolutionReleaseTrain } from "./evolution-release-train.js";

const { EVOLUTION_RUN_EVENT_SCHEMA, EVENT_TYPES } = evolutionRun;

export const AGENT_EVOLUTION_INGRESS_SCHEMA =
  "chainlesschain.agent-evolution-ingress/v1";
export const AGENT_EVOLUTION_INGRESS_FAILED_CODE =
  "CC_AGENT_EVOLUTION_INGRESS_FAILED";

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

function canonical(value) {
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
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Agent evolution evidence must use plain objects");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function clone(value) {
  return JSON.parse(canonical(value));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
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

function guardIngress(operation) {
  return Promise.resolve(operation).catch((cause) => {
    if (cause?.code === AGENT_EVOLUTION_INGRESS_FAILED_CODE) throw cause;
    const error = new Error(
      `Agent evolution ingress failed: ${cause?.message || String(cause)}`,
      { cause },
    );
    error.code = AGENT_EVOLUTION_INGRESS_FAILED_CODE;
    throw error;
  });
}

export function createAgentEvolutionIngress({
  evidenceAdapter,
  runAdapter,
  sourceEnvelopeAuthority,
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
  let tail = Promise.resolve();

  const serialize = (operation) => {
    const pending = tail.then(operation, operation);
    tail = pending.catch(() => undefined);
    return pending;
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

  const ingest = (kind, evidence, options = {}) =>
    guardIngress(
      serialize(async () => {
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
        const payload = clone(evidence);
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
        const persisted = await evidenceAdapter.projectAndPersist({
          sourceEnvelope,
          payload,
        });
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
        return runAdapter.appendEvent({
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
      }),
    );

  const ingress = Object.freeze({
    schema: AGENT_EVOLUTION_INGRESS_SCHEMA,
    tenantId: descriptor.tenantId,
    runId: descriptor.runId,
    start: () => guardIngress(serialize(() => appendStarted())),
    ingestUserPrompt: (input, options) =>
      ingest("user-prompt", { input: clone(input) }, options),
    ingestAgentEvent: (event, options) => {
      const baseKind = CORE_EVENT_KINDS.get(event?.type);
      if (!baseKind) {
        return Promise.resolve(Object.freeze({ ignored: true }));
      }
      const kind =
        event.type === "tool-result" &&
        Boolean(event.error || event.result?.error || event.result?.isError)
          ? "tool-failed"
          : baseKind;
      return ingest(kind, { event: clone(event) }, options);
    },
    complete: (options = {}) =>
      guardIngress(
        serialize(async () => {
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
