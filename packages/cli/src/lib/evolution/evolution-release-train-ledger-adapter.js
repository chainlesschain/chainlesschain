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
  createEvolutionReleaseTrainStateStore,
  verifyEvolutionReleaseTrainState,
  verifyEvolutionTrainStageReceipt,
} from "./evolution-release-train.js";

export const EVOLUTION_RELEASE_TRAIN_CHECKPOINT_SCHEMA =
  "chainlesschain.evolution-release-train-checkpoint/v1";
export const EVOLUTION_RELEASE_TRAIN_LEDGER_EVENT =
  "evolution.release-train.checkpoint.committed";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(EVOLUTION_RELEASE_TRAIN_CHECKPOINT_SCHEMA)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function text(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function capture(owner, method, name) {
  if (!owner || typeof owner[method] !== "function")
    throw new TypeError(`${name}.${method}() is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function verifyCheckpoint(value, descriptor) {
  if (
    value?.schema !== EVOLUTION_RELEASE_TRAIN_CHECKPOINT_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    value.skillName !== descriptor.skillName ||
    !DIGEST.test(value.planDigest ?? "") ||
    (value.priorStateDigest !== null &&
      !DIGEST.test(value.priorStateDigest ?? "")) ||
    !DIGEST.test(value.checkpointDigest ?? "")
  )
    throw new Error("release train checkpoint is invalid");
  const state = verifyEvolutionReleaseTrainState(value.state, {
    planDigest: value.planDigest,
  });
  const receipt = verifyEvolutionTrainStageReceipt(value.receipt);
  if (
    receipt.planDigest !== value.planDigest ||
    state.receiptDigests.at(-1) !== receipt.receiptDigest ||
    state.outputDigests.at(-1) !== receipt.outputDigest
  )
    throw new Error("release train checkpoint receipt binding is invalid");
  const core = structuredClone(value);
  delete core.checkpointDigest;
  if (hash(core) !== value.checkpointDigest)
    throw new Error("release train checkpoint digest mismatch");
  return Object.freeze(structuredClone(value));
}

export class EvolutionReleaseTrainLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    clock = () => new Date().toISOString(),
  } = {}) {
    this.descriptor = Object.freeze({
      tenantId: text(input?.tenantId, "tenantId"),
      artifactTenantId: text(input?.artifactTenantId, "artifactTenantId"),
      skillName: text(input?.skillName, "skillName"),
      audience: text(input?.audience, "audience"),
      purpose: text(input?.purpose, "purpose"),
    });
    if (this.descriptor.purpose !== "evolution-ledger")
      throw new TypeError(
        "release train adapter purpose must be evolution-ledger",
      );
    this._putCanonical = capture(
      artifactPorts,
      "putCanonical",
      "artifactPorts",
    );
    this._readLedger = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._appendDomainEvent = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver))
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    this._resolveArtifact = ledgerArtifactResolver;
    if (typeof clock !== "function") throw new TypeError("clock is required");
    this._clock = clock;
  }

  _events(planDigest) {
    if (!DIGEST.test(planDigest ?? ""))
      throw new TypeError("planDigest is invalid");
    const events = this._readLedger();
    if (!Array.isArray(events))
      throw new Error("release train ledger read is invalid");
    const selected = events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === EVOLUTION_RELEASE_TRAIN_LEDGER_EVENT &&
        event.tenantId === this.descriptor.tenantId &&
        event.skillName === this.descriptor.skillName &&
        event.correlationId === planDigest,
    );
    for (let index = 1; index < selected.length; index += 1) {
      if (selected[index].sequence <= selected[index - 1].sequence)
        throw new Error("release train ledger order is invalid");
    }
    return selected;
  }

  _resolve(event) {
    const authority = this._verifyLedger();
    const resolution = this._resolveArtifact({
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
      throw new Error("release train checkpoint resolution is invalid");
    let record;
    try {
      record = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      throw new Error("release train checkpoint is not canonical JSON");
    }
    if (
      record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      record.tenantId !== this.descriptor.artifactTenantId ||
      record.audience !== this.descriptor.audience ||
      record.purpose !== this.descriptor.purpose ||
      record.retention !== "ledger" ||
      record.type !== "evolution-release-train-checkpoint"
    )
      throw new Error("release train durable artifact binding is invalid");
    return verifyCheckpoint(record.value, this.descriptor);
  }

  _chain(planDigest) {
    const events = this._events(planDigest);
    const chain = [];
    let priorStateDigest = null;
    let priorSubjectRef = null;
    for (const event of events) {
      const checkpoint = this._resolve(event);
      if (
        checkpoint.priorStateDigest !== priorStateDigest ||
        checkpoint.state.stageIndex !== chain.length + 1 ||
        (priorSubjectRef !== null &&
          !event.sourceRefs.some(
            (ref) =>
              ref.ref === priorSubjectRef.ref &&
              ref.digest === priorSubjectRef.digest,
          ))
      )
        throw new Error("release train checkpoint lineage is discontinuous");
      chain.push({ event, checkpoint });
      priorStateDigest = checkpoint.state.stateDigest;
      priorSubjectRef = event.subjectRef;
    }
    return chain;
  }

  createStateStore() {
    return createEvolutionReleaseTrainStateStore({
      load: async (planDigest) =>
        this._chain(planDigest).at(-1)?.checkpoint.state ?? null,
      loadReceipt: async (receiptDigest) => {
        if (!DIGEST.test(receiptDigest ?? ""))
          throw new TypeError("receiptDigest is invalid");
        for (const event of this._readLedger()) {
          if (
            event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
            event.type !== EVOLUTION_RELEASE_TRAIN_LEDGER_EVENT ||
            event.tenantId !== this.descriptor.tenantId ||
            event.skillName !== this.descriptor.skillName
          )
            continue;
          const checkpoint = this._resolve(event);
          if (checkpoint.receipt.receiptDigest === receiptDigest)
            return checkpoint.receipt;
        }
        return null;
      },
      compareAndSet: async (request) => this._compareAndSet(request),
    });
  }

  _compareAndSet({
    planDigest,
    expectedStateDigest,
    receipt: receiptInput,
    nextState: stateInput,
  } = {}) {
    if (!DIGEST.test(planDigest ?? ""))
      throw new TypeError("planDigest is invalid");
    const receipt = verifyEvolutionTrainStageReceipt(receiptInput);
    const nextState = verifyEvolutionReleaseTrainState(stateInput, {
      planDigest,
    });
    if (
      receipt.planDigest !== planDigest ||
      nextState.receiptDigests.at(-1) !== receipt.receiptDigest ||
      nextState.outputDigests.at(-1) !== receipt.outputDigest
    )
      throw new Error("release train CAS receipt binding is invalid");
    const chain = this._chain(planDigest);
    const latest = chain.at(-1) ?? null;
    const currentStateDigest = latest?.checkpoint.state.stateDigest ?? null;
    if (currentStateDigest !== expectedStateDigest) {
      if (
        currentStateDigest === nextState.stateDigest &&
        latest?.checkpoint.receipt.receiptDigest === receipt.receiptDigest
      )
        return Object.freeze({
          durable: true,
          recovered: true,
          stateDigest: nextState.stateDigest,
          receiptDigest: receipt.receiptDigest,
        });
      throw new Error("release train checkpoint CAS conflict");
    }
    if (
      nextState.stageIndex !== chain.length + 1 ||
      nextState.receiptDigests.length !== nextState.stageIndex
    )
      throw new Error("release train checkpoint progression is invalid");
    const checkpointCore = {
      schema: EVOLUTION_RELEASE_TRAIN_CHECKPOINT_SCHEMA,
      tenantId: this.descriptor.tenantId,
      skillName: this.descriptor.skillName,
      planDigest,
      priorStateDigest: currentStateDigest,
      state: nextState,
      receipt,
    };
    const checkpoint = Object.freeze({
      ...checkpointCore,
      checkpointDigest: hash(checkpointCore),
    });
    const head = this._verifyLedger();
    const published = this._putCanonical(
      "evolution-release-train-checkpoint",
      checkpoint,
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
      throw new Error("release train checkpoint was not durably read back");
    const timestamp = this._clock();
    if (
      typeof timestamp !== "string" ||
      !Number.isFinite(Date.parse(timestamp))
    )
      throw new Error("release train checkpoint clock is invalid");
    const eventId = `release-train.${checkpoint.checkpointDigest.slice("sha256:".length)}`;
    const ledgerReceipt = this._appendDomainEvent(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: planDigest,
        decision: "committed",
        eventId,
        reason: `${receipt.stage} checkpoint committed`,
        skillName: this.descriptor.skillName,
        sourceRefs: latest ? [latest.event.subjectRef] : [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp,
        type: EVOLUTION_RELEASE_TRAIN_LEDGER_EVENT,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      ledgerReceipt?.authenticated !== true ||
      ledgerReceipt.committed !== true ||
      ledgerReceipt.durable !== true ||
      ledgerReceipt.eventId !== eventId ||
      !DIGEST.test(ledgerReceipt.receiptDigest ?? "")
    )
      throw new Error("release train checkpoint ledger append was not durable");
    const stored = this._chain(planDigest).at(-1)?.checkpoint;
    if (stored?.checkpointDigest !== checkpoint.checkpointDigest)
      throw new Error("release train checkpoint readback differs after commit");
    return Object.freeze({
      durable: true,
      recovered: false,
      stateDigest: nextState.stateDigest,
      receiptDigest: receipt.receiptDigest,
      ledgerReceiptDigest: ledgerReceipt.receiptDigest,
    });
  }
}
