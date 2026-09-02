import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  WIKI_REVISION_SCHEMA,
  WIKI_STATE_SCHEMA,
  createEmptyWikiState,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";

export const WIKI_LEDGER_EVENT_TYPE = "wiki.revision.committed";
export const WIKI_LEDGER_CONFLICT_CODE = "CC_EVOLUTION_WIKI_REVISION_CONFLICT";
export const WIKI_LEDGER_CORRUPT_CODE = "CC_EVOLUTION_WIKI_LEDGER_CORRUPT";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION_ID = /^wiki:[a-f0-9]{64}$/u;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function captureMethod(owner, name, label) {
  const method = owner?.[name];
  if (typeof method !== "function") throw new TypeError(`${label}.${name} is required`);
  return (...args) => Reflect.apply(method, owner, args);
}

function parseRecord(resolution, descriptor) {
  if (resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA || resolution.authenticated !== true ||
      resolution.found !== true || !DIGEST.test(resolution.digest ?? "") ||
      !DIGEST.test(resolution.receiptDigest ?? "") || !Buffer.isBuffer(resolution.bytes)) {
    fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki artifact resolution is not authenticated and complete");
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki artifact is not canonical JSON");
  }
  const revision = record?.value;
  if (record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA || record.tenantId !== descriptor.artifactTenantId ||
      record.audience !== descriptor.audience || record.purpose !== descriptor.purpose || record.retention !== "ledger" ||
      record.type !== "wiki-revision" || revision?.schema !== WIKI_REVISION_SCHEMA ||
      revision.tenantId !== descriptor.tenantId || revision.evolutionRunId !== descriptor.evolutionRunId ||
      revision.state?.schema !== WIKI_STATE_SCHEMA || revision.state.tenantId !== descriptor.tenantId ||
      revision.stateDigest !== digestWikiState(revision.state) || revision.state.revisionId !== revision.revisionId ||
      !REVISION_ID.test(revision.revisionId ?? "")) {
    fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki artifact record or revision binding is invalid");
  }
  return revision;
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: requiredString(input?.tenantId, "tenantId"),
    artifactTenantId: requiredString(input?.artifactTenantId, "artifactTenantId"),
    evolutionRunId: requiredString(input?.evolutionRunId, "evolutionRunId"),
    audience: requiredString(input?.audience, "audience"),
    purpose: requiredString(input?.purpose, "purpose"),
  });
}

export class WikiMaintainerLedgerAdapter {
  constructor({ descriptor, artifactPorts, ledger, ledgerArtifactResolver } = {}) {
    this.descriptor = normalizeDescriptor(descriptor);
    this._putCanonical = captureMethod(artifactPorts, "putCanonical", "artifactPorts");
    this._readLedger = captureMethod(ledger, "read", "ledger");
    this._verifyLedger = captureMethod(ledger, "verify", "ledger");
    this._appendDomainEvent = captureMethod(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError("a branded EvolutionArtifactPorts ledger resolver is required");
    }
    this._resolveArtifact = ledgerArtifactResolver;
    Object.freeze(this);
  }

  _matchingEvents() {
    const events = this._readLedger();
    if (!Array.isArray(events)) fail(WIKI_LEDGER_CORRUPT_CODE, "EvolutionLedger read did not return events");
    return events.filter((event) => event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
      event.type === WIKI_LEDGER_EVENT_TYPE && event.tenantId === this.descriptor.tenantId &&
      event.correlationId === this.descriptor.evolutionRunId);
  }

  _resolveEvent(event) {
    const authority = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: authority.epoch,
      ledgerId: authority.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (resolution?.ref !== event.subjectRef.ref || resolution.digest !== event.subjectRef.digest) {
      fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki ledger event resolved a substituted artifact");
    }
    return parseRecord(resolution, this.descriptor);
  }

  _latest() {
    const matches = this._matchingEvents();
    if (matches.length === 0) return null;
    for (let index = 1; index < matches.length; index += 1) {
      if (matches[index].sequence <= matches[index - 1].sequence) {
        fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki ledger revisions are not strictly ordered");
      }
    }
    const event = matches.at(-1);
    const revision = this._resolveEvent(event);
    if (revision.revision !== matches.length) {
      fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki revision sequence has a gap or duplicate");
    }
    return { event, revision };
  }

  loadWiki = () => {
    const latest = this._latest();
    const state = latest?.revision.state ?? createEmptyWikiState(this.descriptor.tenantId);
    return Object.freeze({ trusted: true, state, stateDigest: digestWikiState(state) });
  };

  commitRevision = ({ expectedStateDigest, revision } = {}) => {
    if (!DIGEST.test(expectedStateDigest ?? "") || revision?.schema !== WIKI_REVISION_SCHEMA ||
        revision.tenantId !== this.descriptor.tenantId || revision.evolutionRunId !== this.descriptor.evolutionRunId ||
        revision.stateDigest !== digestWikiState(revision.state) || revision.state.revisionId !== revision.revisionId ||
        !REVISION_ID.test(revision.revisionId ?? "")) {
      throw new TypeError("Wiki revision commit request is invalid");
    }
    const latest = this._latest();
    const currentState = latest?.revision.state ?? createEmptyWikiState(this.descriptor.tenantId);
    const currentDigest = digestWikiState(currentState);
    if (currentDigest !== expectedStateDigest) {
      if (latest?.revision.revisionId === revision.revisionId && currentDigest === revision.stateDigest) {
        return Object.freeze({ committed: true, recovered: true, revisionId: revision.revisionId,
          stateDigest: revision.stateDigest, evolutionRunId: this.descriptor.evolutionRunId });
      }
      fail(WIKI_LEDGER_CONFLICT_CODE, "Wiki state changed before revision commit");
    }
    if (revision.revision !== currentState.revision + 1 || revision.priorStateDigest !== currentDigest) {
      fail(WIKI_LEDGER_CONFLICT_CODE, "Wiki revision does not extend the current state");
    }
    const head = this._verifyLedger();
    const published = this._putCanonical("wiki-revision", revision, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (!published?.ref || published.receipt?.persisted !== true || published.receipt?.readbackVerified !== true ||
        published.receipt?.integrityVerified !== true || published.receipt?.retention !== "ledger") {
      fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki revision artifact was not durably read back");
    }
    const eventId = `wiki.revision.${revision.revisionId.slice("wiki:".length)}`;
    const receipt = this._appendDomainEvent({
      artifactTenantId: this.descriptor.artifactTenantId,
      correlationId: this.descriptor.evolutionRunId,
      decision: "committed",
      eventId,
      reason: `wiki revision ${revision.revision} committed`,
      skillName: null,
      sourceRefs: latest ? [latest.event.subjectRef] : [],
      subjectRef: published.ref,
      tenantId: this.descriptor.tenantId,
      timestamp: revision.effectiveAt,
      type: WIKI_LEDGER_EVENT_TYPE,
    }, { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence });
    if (receipt?.authenticated !== true || receipt?.committed !== true || receipt?.durable !== true ||
        receipt.eventId !== eventId || !DIGEST.test(receipt.receiptDigest ?? "")) {
      fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki ledger did not confirm a durable authenticated append");
    }
    const stored = this._latest();
    if (stored?.revision.revisionId !== revision.revisionId || stored.revision.stateDigest !== revision.stateDigest) {
      fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki revision readback differs after ledger commit");
    }
    return Object.freeze({ committed: true, recovered: false, revisionId: revision.revisionId,
      stateDigest: revision.stateDigest, evolutionRunId: this.descriptor.evolutionRunId,
      ledgerReceiptDigest: receipt.receiptDigest });
  };

  maintainerPorts({ resolveEvidence, derive } = {}) {
    if (typeof resolveEvidence !== "function" || typeof derive !== "function") {
      throw new TypeError("resolveEvidence and derive ports are required");
    }
    return Object.freeze({ loadWiki: this.loadWiki, commitRevision: this.commitRevision, resolveEvidence, derive });
  }
}

export function createWikiMaintainerLedgerAdapter(options) {
  return new WikiMaintainerLedgerAdapter(options);
}
