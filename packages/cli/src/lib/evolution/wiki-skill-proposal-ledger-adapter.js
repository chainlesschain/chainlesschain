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
  WIKI_PROPOSAL_STATUS,
  WIKI_SKILL_PROPOSAL_SCHEMA,
  computeWikiSkillProposalDigest,
} from "./wiki-informed-skill-proposer.js";

export const WIKI_SKILL_PROPOSAL_RECORD_SCHEMA =
  "chainlesschain.wiki-skill-proposal-record/v1";
export const WIKI_SKILL_PROPOSAL_LEDGER_EVENT =
  "evolution.wiki-skill-proposal.committed";
export const WIKI_SKILL_PROPOSAL_CONFLICT_CODE =
  "CC_EVOLUTION_WIKI_SKILL_PROPOSAL_CONFLICT";
export const WIKI_SKILL_PROPOSAL_CORRUPT_CODE =
  "CC_EVOLUTION_WIKI_SKILL_PROPOSAL_CORRUPT";

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
    .update(WIKI_SKILL_PROPOSAL_RECORD_SCHEMA)
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

function normalizeDescriptor(input) {
  const descriptor = Object.freeze({
    tenantId: text(input?.tenantId, "tenantId"),
    artifactTenantId: text(input?.artifactTenantId, "artifactTenantId"),
    evolutionRunId: text(input?.evolutionRunId, "evolutionRunId"),
    skillName: text(input?.skillName, "skillName"),
    audience: text(input?.audience, "audience"),
    purpose: text(input?.purpose, "purpose"),
  });
  if (descriptor.purpose !== "evolution-ledger")
    throw new TypeError("proposal adapter purpose must be evolution-ledger");
  return descriptor;
}

function verifyRecord(record, descriptor) {
  const proposal = record?.drafted?.proposal;
  if (
    record?.schema !== WIKI_SKILL_PROPOSAL_RECORD_SCHEMA ||
    record.tenantId !== descriptor.tenantId ||
    record.evolutionRunId !== descriptor.evolutionRunId ||
    record.skillName !== descriptor.skillName ||
    !DIGEST.test(record.planDigest ?? "") ||
    !DIGEST.test(record.operationKey ?? "") ||
    !DIGEST.test(record.inputDigest ?? "") ||
    !DIGEST.test(record.outputDigest ?? "") ||
    record.drafted?.status !== WIKI_PROPOSAL_STATUS.PROPOSAL ||
    proposal?.schema !== WIKI_SKILL_PROPOSAL_SCHEMA ||
    proposal.tenantId !== descriptor.tenantId ||
    proposal.evolutionRunId !== descriptor.evolutionRunId ||
    proposal.skillName !== descriptor.skillName ||
    record.drafted.proposalDigest !==
      computeWikiSkillProposalDigest(proposal) ||
    record.outputDigest !== record.drafted.proposalDigest ||
    !Number.isFinite(Date.parse(record.effectiveAt ?? "")) ||
    !DIGEST.test(record.recordDigest ?? "")
  ) {
    fail(
      WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
      "Wiki Skill proposal record binding is invalid",
    );
  }
  const core = structuredClone(record);
  delete core.recordDigest;
  if (hash(core) !== record.recordDigest)
    fail(
      WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
      "Wiki Skill proposal record digest mismatch",
    );
  return Object.freeze(structuredClone(record));
}

export class WikiSkillProposalLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
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

  _events(planDigest) {
    digest(planDigest, "planDigest");
    const events = this._read();
    if (!Array.isArray(events))
      fail(WIKI_SKILL_PROPOSAL_CORRUPT_CODE, "proposal ledger read is invalid");
    const selected = events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === WIKI_SKILL_PROPOSAL_LEDGER_EVENT &&
        event.tenantId === this.descriptor.tenantId &&
        event.skillName === this.descriptor.skillName &&
        event.correlationId === planDigest,
    );
    if (selected.length > 1)
      fail(
        WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
        "a release plan has multiple committed Wiki Skill proposals",
      );
    return selected;
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
        WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
        "proposal artifact resolution is invalid",
      );
    let durable;
    try {
      durable = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      fail(
        WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
        "proposal artifact is not canonical JSON",
      );
    }
    if (
      durable?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      durable.tenantId !== this.descriptor.artifactTenantId ||
      durable.audience !== this.descriptor.audience ||
      durable.purpose !== this.descriptor.purpose ||
      durable.retention !== "ledger" ||
      durable.type !== "wiki-skill-proposal"
    )
      fail(
        WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
        "proposal durable artifact binding is invalid",
      );
    return verifyRecord(durable.value, this.descriptor);
  }

  load(planDigest) {
    const event = this._events(planDigest)[0];
    return event ? this._resolveEvent(event) : null;
  }

  commit({ planDigest, operationKey, inputDigest, drafted, effectiveAt } = {}) {
    digest(planDigest, "planDigest");
    digest(operationKey, "operationKey");
    digest(inputDigest, "inputDigest");
    const timestamp = new Date(effectiveAt).toISOString();
    const core = {
      schema: WIKI_SKILL_PROPOSAL_RECORD_SCHEMA,
      tenantId: this.descriptor.tenantId,
      evolutionRunId: this.descriptor.evolutionRunId,
      skillName: this.descriptor.skillName,
      planDigest,
      operationKey,
      inputDigest,
      outputDigest: drafted?.proposalDigest,
      drafted: structuredClone(drafted),
      effectiveAt: timestamp,
    };
    const proposalRecord = verifyRecord(
      { ...core, recordDigest: hash(core) },
      this.descriptor,
    );
    const existing = this.load(planDigest);
    if (existing) {
      if (existing.recordDigest === proposalRecord.recordDigest)
        return Object.freeze({
          committed: true,
          recovered: true,
          outputDigest: existing.outputDigest,
          recordDigest: existing.recordDigest,
        });
      fail(
        WIKI_SKILL_PROPOSAL_CONFLICT_CODE,
        "release plan is already bound to a different Wiki Skill proposal",
      );
    }
    const head = this._verify();
    const published = this._put("wiki-skill-proposal", proposalRecord, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    )
      fail(
        WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
        "proposal artifact was not durably read back",
      );
    const eventId = `wiki-skill-proposal.${proposalRecord.recordDigest.slice("sha256:".length)}`;
    const receipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: planDigest,
        decision: "committed",
        eventId,
        reason: "Wiki-informed Skill proposal committed",
        skillName: this.descriptor.skillName,
        sourceRefs: [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp,
        type: WIKI_SKILL_PROPOSAL_LEDGER_EVENT,
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
        WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
        "proposal ledger append was not durably confirmed",
      );
    const stored = this.load(planDigest);
    if (stored?.recordDigest !== proposalRecord.recordDigest)
      fail(
        WIKI_SKILL_PROPOSAL_CORRUPT_CODE,
        "proposal readback differs after ledger commit",
      );
    return Object.freeze({
      committed: true,
      recovered: false,
      outputDigest: proposalRecord.outputDigest,
      recordDigest: proposalRecord.recordDigest,
      ledgerReceiptDigest: receipt.receiptDigest,
    });
  }
}

export function createWikiSkillProposalLedgerAdapter(options) {
  return new WikiSkillProposalLedgerAdapter(options);
}
