import { createHash } from "node:crypto";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import { EVOLUTION_RELEASE_TRAIN_STAGES } from "./evolution-release-train.js";

export const EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_SCHEMA =
  "chainlesschain.evolution-release-train-stage-output/v1";
export const EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_EVENT =
  "evolution.release-train.stage-output.committed";
export const EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CONFLICT_CODE =
  "CC_EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CONFLICT";
export const EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE =
  "CC_EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

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

function text(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function digest(value, name) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${name} is invalid`);
  return value;
}

function stage(value) {
  if (!EVOLUTION_RELEASE_TRAIN_STAGES.includes(value))
    throw new TypeError("stage is invalid");
  return value;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function capture(owner, method, name) {
  if (!owner || typeof owner[method] !== "function")
    throw new TypeError(`${name}.${method}() is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function descriptor(input) {
  const value = Object.freeze({
    tenantId: text(input?.tenantId, "tenantId"),
    artifactTenantId: text(input?.artifactTenantId, "artifactTenantId"),
    skillName: text(input?.skillName, "skillName"),
    audience: text(input?.audience, "audience"),
    purpose: text(input?.purpose, "purpose"),
  });
  if (value.purpose !== "evolution-ledger")
    throw new TypeError("stage output purpose must be evolution-ledger");
  return value;
}

function verifyRecord(value, expected) {
  if (
    value?.schema !== EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_SCHEMA ||
    value.tenantId !== expected.tenantId ||
    value.skillName !== expected.skillName ||
    !DIGEST.test(value.planDigest ?? "") ||
    !EVOLUTION_RELEASE_TRAIN_STAGES.includes(value.stage) ||
    !DIGEST.test(value.operationKey ?? "") ||
    !DIGEST.test(value.inputDigest ?? "") ||
    !DIGEST.test(value.outputDigest ?? "") ||
    !DIGEST.test(value.valueDigest ?? "") ||
    value.valueDigest !==
      hash(
        "chainlesschain.evolution-release-train-stage-value/v1",
        value.value,
      ) ||
    !Number.isFinite(Date.parse(value.effectiveAt ?? "")) ||
    !DIGEST.test(value.recordDigest ?? "")
  )
    fail(
      EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
      "release train stage output binding is invalid",
    );
  const core = structuredClone(value);
  delete core.recordDigest;
  if (
    value.recordDigest !==
    hash(EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_SCHEMA, core)
  )
    fail(
      EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
      "release train stage output digest mismatch",
    );
  return Object.freeze(structuredClone(value));
}

export class EvolutionReleaseTrainStageOutputLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
  } = {}) {
    this.descriptor = descriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verify = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver))
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    this._resolve = ledgerArtifactResolver;
    Object.freeze(this);
  }

  _events(planDigest, stageName) {
    digest(planDigest, "planDigest");
    stage(stageName);
    const events = this._read();
    if (!Array.isArray(events))
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
        "release train stage output ledger read is invalid",
      );
    const matches = events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_EVENT &&
        event.tenantId === this.descriptor.tenantId &&
        event.skillName === this.descriptor.skillName &&
        event.correlationId === `${planDigest}:${stageName}`,
    );
    if (matches.length > 1)
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
        "release train stage has multiple durable outputs",
      );
    return matches;
  }

  _resolveEvent(event) {
    const authority = this._verify();
    const resolution = this._resolve({
      epoch: authority.epoch,
      ledgerId: authority.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.found !== true ||
      resolution.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest ||
      !Buffer.isBuffer(resolution.bytes)
    )
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
        "release train stage output resolution is invalid",
      );
    let durable;
    try {
      durable = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
        "release train stage output is not canonical JSON",
      );
    }
    if (
      durable?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      durable.tenantId !== this.descriptor.artifactTenantId ||
      durable.audience !== this.descriptor.audience ||
      durable.purpose !== this.descriptor.purpose ||
      durable.retention !== "ledger" ||
      durable.type !== "evolution-release-train-stage-output"
    )
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
        "release train stage output durable record is invalid",
      );
    return verifyRecord(durable.value, this.descriptor);
  }

  load({ planDigest, stage: stageName } = {}) {
    const event = this._events(planDigest, stageName)[0];
    return event ? this._resolveEvent(event) : null;
  }

  commit({
    planDigest,
    stage: stageName,
    operationKey,
    inputDigest,
    outputDigest,
    value,
    effectiveAt,
  } = {}) {
    digest(planDigest, "planDigest");
    stage(stageName);
    digest(operationKey, "operationKey");
    digest(inputDigest, "inputDigest");
    digest(outputDigest, "outputDigest");
    const core = {
      schema: EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_SCHEMA,
      tenantId: this.descriptor.tenantId,
      skillName: this.descriptor.skillName,
      planDigest,
      stage: stageName,
      operationKey,
      inputDigest,
      outputDigest,
      valueDigest: hash(
        "chainlesschain.evolution-release-train-stage-value/v1",
        value,
      ),
      value: structuredClone(value),
      effectiveAt: new Date(effectiveAt).toISOString(),
    };
    const record = verifyRecord(
      {
        ...core,
        recordDigest: hash(EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_SCHEMA, core),
      },
      this.descriptor,
    );
    const existing = this.load({ planDigest, stage: stageName });
    if (existing) {
      if (existing.recordDigest === record.recordDigest)
        return Object.freeze({
          committed: true,
          recovered: true,
          outputDigest: record.outputDigest,
          recordDigest: record.recordDigest,
        });
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CONFLICT_CODE,
        "release train stage already has a different durable output",
      );
    }
    const head = this._verify();
    const published = this._put(
      "evolution-release-train-stage-output",
      record,
      {
        audience: this.descriptor.audience,
        purpose: this.descriptor.purpose,
        retention: "ledger",
      },
    );
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    )
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
        "release train stage output was not durably read back",
      );
    const eventId = `release-train-stage-output.${record.recordDigest.slice("sha256:".length)}`;
    const receipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: `${planDigest}:${stageName}`,
        decision: "committed",
        eventId,
        reason: `${stageName} output committed`,
        skillName: this.descriptor.skillName,
        sourceRefs: [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: record.effectiveAt,
        type: EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_EVENT,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      receipt?.authenticated !== true ||
      receipt.committed !== true ||
      receipt.durable !== true ||
      receipt.eventId !== eventId ||
      !DIGEST.test(receipt.receiptDigest ?? "")
    )
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
        "release train stage output ledger append was not durable",
      );
    if (
      this.load({ planDigest, stage: stageName })?.recordDigest !==
      record.recordDigest
    )
      fail(
        EVOLUTION_RELEASE_TRAIN_STAGE_OUTPUT_CORRUPT_CODE,
        "release train stage output readback differs after commit",
      );
    return Object.freeze({
      committed: true,
      recovered: false,
      outputDigest: record.outputDigest,
      recordDigest: record.recordDigest,
      ledgerReceiptDigest: receipt.receiptDigest,
    });
  }
}

export function createEvolutionReleaseTrainStageOutputLedgerAdapter(options) {
  return new EvolutionReleaseTrainStageOutputLedgerAdapter(options);
}
