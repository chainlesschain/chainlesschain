import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
  SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA,
  captureSkillPromotionReviewPacket,
  verifySkillPromotionReviewDecision,
  verifySkillPromotionReviewPacketArtifact,
} from "./skill-promotion-review.js";
import {
  SKILL_WIKI_REVIEW_DECISION_SCHEMA,
  createSkillWikiReviewReconciliationSource,
} from "./skill-wiki-reconciliation.js";

export const SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE =
  "skill.promotion-review.requested";
export const SKILL_PROMOTION_REVIEW_DECISION_EVENT_TYPE =
  "skill.promotion-review.decided";
export const SKILL_PROMOTION_REVIEW_LEDGER_CORRUPT_CODE =
  "CC_SKILL_PROMOTION_REVIEW_LEDGER_CORRUPT";

const PACKET_TYPE = "skill-promotion-review-packet";
const DECISION_TYPE = "skill-promotion-review-decision";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function capture(owner, method, label = method) {
  if (typeof owner?.[method] !== "function") {
    throw new TypeError(`${label} port is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function corrupt(message) {
  const error = new Error(message);
  error.code = SKILL_PROMOTION_REVIEW_LEDGER_CORRUPT_CODE;
  throw error;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function normalizeDescriptor(input) {
  if (!Number.isSafeInteger(input?.revision) || input.revision < 1) {
    throw new TypeError("revision must be a positive integer");
  }
  if (!DIGEST.test(input?.handlerArtifactDigest || "")) {
    throw new TypeError("handlerArtifactDigest must be sha256-bound");
  }
  return Object.freeze({
    tenantId: requiredString(input.tenantId, "tenantId"),
    artifactTenantId: requiredString(
      input.artifactTenantId,
      "artifactTenantId",
    ),
    streamId: requiredString(input.streamId, "streamId"),
    audience: requiredString(input.audience, "audience"),
    purpose: requiredString(input.purpose, "purpose"),
    authorityId: requiredString(input.authorityId, "authorityId"),
    revision: input.revision,
    handlerArtifactDigest: input.handlerArtifactDigest,
  });
}

function parseRecord(resolution, descriptor, expectedType) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("review artifact resolution is unauthenticated or incomplete");
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("review artifact is not JSON");
  }
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== expectedType
  ) {
    corrupt("review artifact durable binding is invalid");
  }
  return record.value;
}

export class SkillPromotionReviewLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    decisionVerifier,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical");
    this._read = capture(ledger, "read");
    this._verifyLedger = capture(ledger, "verify");
    this._append = capture(ledger, "appendDomainEvent");
    this._verifyDecisionSignature = capture(
      decisionVerifier,
      "verify",
      "decision verifier",
    );
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    this._resolveArtifact = ledgerArtifactResolver;
    this._now = now;
    Object.freeze(this);
  }

  _events(type) {
    const events = this._read();
    if (!Array.isArray(events))
      corrupt("EvolutionLedger did not return events");
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
    const resolution = this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest
    ) {
      corrupt("review ledger subject was substituted");
    }
    return parseRecord(resolution, this.descriptor, expectedType);
  }

  _packetByDigest(packetDigest) {
    const expectedEventId = `${SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE}.${packetDigest.slice(7)}`;
    const matches = this._events(
      SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE,
    ).filter((event) => event.eventId === expectedEventId);
    if (matches.length !== 1) corrupt("review packet is missing or ambiguous");
    const packet = verifySkillPromotionReviewPacketArtifact(
      this._resolveEvent(matches[0], PACKET_TYPE),
    );
    if (packet.packetDigest !== packetDigest)
      corrupt("review packet was substituted");
    return { event: matches[0], packet };
  }

  _decisionEntries() {
    return this._events(SKILL_PROMOTION_REVIEW_DECISION_EVENT_TYPE).map(
      (event) => {
        const decision = this._resolveEvent(event, DECISION_TYPE);
        if (
          decision?.schema !== SKILL_PROMOTION_REVIEW_DECISION_SCHEMA ||
          !DIGEST.test(decision.receiptDigest || "") ||
          event.eventId !==
            `${SKILL_PROMOTION_REVIEW_DECISION_EVENT_TYPE}.${decision.receiptDigest.slice(7)}`
        ) {
          corrupt("review decision artifact is invalid");
        }
        const packetEventId = `${SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE}.${decision.packetDigest.slice(7)}`;
        const packetEvents = this._events(
          SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE,
        ).filter((candidate) => candidate.eventId === packetEventId);
        if (
          packetEvents.length !== 1 ||
          !Array.isArray(event.sourceRefs) ||
          event.sourceRefs.length !== 1 ||
          canonical(event.sourceRefs[0]) !==
            canonical(packetEvents[0].subjectRef)
        ) {
          corrupt("review decision packet lineage is invalid");
        }
        return { event, decision };
      },
    );
  }

  async submitPacket(input) {
    const packet = captureSkillPromotionReviewPacket(input);
    if (packet.tenantId !== this.descriptor.tenantId) {
      throw new TypeError("review packet belongs to another tenant");
    }
    const eventId = `${SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE}.${packet.packetDigest.slice(7)}`;
    const existing = this._events(
      SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE,
    ).filter((event) => event.eventId === eventId);
    if (existing.length > 1)
      corrupt("review packet has duplicate ledger events");
    if (existing.length === 1) {
      const recovered = verifySkillPromotionReviewPacketArtifact(
        this._resolveEvent(existing[0], PACKET_TYPE),
      );
      if (canonical(recovered) !== canonical(packet)) {
        corrupt("review packet id resolved substituted content");
      }
      return Object.freeze({
        persisted: true,
        recovered: true,
        packetDigest: packet.packetDigest,
      });
    }
    const head = this._verifyLedger();
    const nowMs = Number(this._now());
    if (!Number.isFinite(nowMs)) throw new TypeError("review clock is invalid");
    const published = this._put(PACKET_TYPE, packet, {
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
      corrupt("review packet persistence was not durably confirmed");
    }
    const timestamp = new Date(nowMs).toISOString();
    const receipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: "proposed",
        eventId,
        reason: "skill promotion review requested",
        skillName: packet.skillName,
        sourceRefs: [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp,
        type: SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (receipt?.authenticated !== true || receipt.durable !== true) {
      corrupt("review packet ledger append was not durable");
    }
    return Object.freeze({
      persisted: true,
      packetDigest: packet.packetDigest,
      ledgerReceiptDigest: receipt.receiptDigest,
    });
  }

  async retainDecision(input) {
    if (!DIGEST.test(input?.packetDigest || "")) {
      throw new TypeError("packetDigest is required");
    }
    const { event: packetEvent, packet } = this._packetByDigest(
      input.packetDigest,
    );
    const nowMs = Number(this._now());
    const decision = verifySkillPromotionReviewDecision(
      input.decision,
      packet,
      nowMs,
    );
    if (
      (await this._verifyDecisionSignature({
        decision,
        packet,
        source: "retain",
      })) !== true
    ) {
      throw new Error("review decision signature verification failed");
    }
    const decisionsForPacket = this._decisionEntries().filter(
      ({ decision: stored }) => stored.packetDigest === packet.packetDigest,
    );
    if (decisionsForPacket.length > 1)
      corrupt("review packet has conflicting decisions");
    if (decisionsForPacket.length === 1) {
      if (canonical(decisionsForPacket[0].decision) !== canonical(decision)) {
        corrupt("review packet already has a different decision");
      }
      return Object.freeze({
        persisted: true,
        recovered: true,
        receiptDigest: decision.receiptDigest,
      });
    }
    const head = this._verifyLedger();
    const published = this._put(DECISION_TYPE, decision, {
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
      corrupt("review decision persistence was not durably confirmed");
    }
    const eventId = `${SKILL_PROMOTION_REVIEW_DECISION_EVENT_TYPE}.${decision.receiptDigest.slice(7)}`;
    const receipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: decision.decision === "approved" ? "accepted" : "rejected",
        eventId,
        reason: decision.reason,
        skillName: packet.skillName,
        sourceRefs: [packetEvent.subjectRef],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: decision.decidedAt,
        type: SKILL_PROMOTION_REVIEW_DECISION_EVENT_TYPE,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (receipt?.authenticated !== true || receipt.durable !== true) {
      corrupt("review decision ledger append was not durable");
    }
    return Object.freeze({
      persisted: true,
      receiptDigest: decision.receiptDigest,
      ledgerReceiptDigest: receipt.receiptDigest,
    });
  }

  async listReviews() {
    const decisions = this._decisionEntries();
    const output = [];
    for (const event of this._events(
      SKILL_PROMOTION_REVIEW_REQUEST_EVENT_TYPE,
    )) {
      const packet = verifySkillPromotionReviewPacketArtifact(
        this._resolveEvent(event, PACKET_TYPE),
      );
      const matches = decisions.filter(
        ({ decision }) => decision.packetDigest === packet.packetDigest,
      );
      if (matches.length > 1)
        corrupt("review packet has conflicting decisions");
      if (matches.length === 1) {
        const decision = verifySkillPromotionReviewDecision(
          matches[0].decision,
          packet,
          Date.parse(matches[0].decision.decidedAt),
        );
        if (
          (await this._verifyDecisionSignature({
            decision,
            packet,
            source: "list",
            ledgerEventDigest: matches[0].event.eventDigest,
          })) !== true
        ) {
          throw new Error("review decision signature verification failed");
        }
      }
      output.push(
        Object.freeze({
          packet,
          decision: matches[0]?.decision || null,
          status:
            matches.length === 1 &&
            Date.parse(matches[0].decision.expiresAt) <= Number(this._now())
              ? "expired"
              : matches[0]?.decision.decision || "pending",
        }),
      );
    }
    return Object.freeze(output);
  }

  createDecisionResolver() {
    return Object.freeze({
      resolve: async (request) => {
        if (
          request?.tenantId !== this.descriptor.tenantId ||
          !DIGEST.test(request.receiptDigest || "")
        ) {
          corrupt("review decision request is invalid");
        }
        const matches = this._decisionEntries().filter(
          ({ decision }) => decision.receiptDigest === request.receiptDigest,
        );
        if (matches.length !== 1)
          corrupt("review decision is missing or ambiguous");
        const { decision, event } = matches[0];
        const { packet } = this._packetByDigest(decision.packetDigest);
        verifySkillPromotionReviewDecision(
          decision,
          packet,
          Number(this._now()),
        );
        if (
          (await this._verifyDecisionSignature({
            decision,
            packet,
            source: "resolve",
            ledgerEventDigest: event.eventDigest,
          })) !== true
        ) {
          throw new Error("review decision signature verification failed");
        }
        return Object.freeze({
          schema: SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA,
          authorityId: this.descriptor.authorityId,
          handlerArtifactDigest: this.descriptor.handlerArtifactDigest,
          revision: this.descriptor.revision,
          tenantId: this.descriptor.tenantId,
          receiptDigest: decision.receiptDigest,
          decision,
          resolvedAt: new Date(Number(this._now())).toISOString(),
        });
      },
    });
  }

  createWikiRejectionReconciliationSource() {
    return createSkillWikiReviewReconciliationSource({
      tenantId: this.descriptor.tenantId,
      streamId: `${this.descriptor.streamId}:wiki-rejections`,
      readReviewDecisions: async () => {
        await this.listReviews();
        return this._decisionEntries()
          .filter(({ decision }) => decision.decision === "rejected")
          .map(({ decision, event }) => {
            const { packet } = this._packetByDigest(decision.packetDigest);
            return {
              schema: SKILL_WIKI_REVIEW_DECISION_SCHEMA,
              authenticated: true,
              durable: true,
              tenantId: this.descriptor.tenantId,
              streamId: `${this.descriptor.streamId}:wiki-rejections`,
              sequence: event.sequence,
              candidateId: packet.candidateId,
              skillName: packet.skillName,
              decision: decision.decision,
              reason: decision.reason,
              occurredAt: decision.decidedAt,
              packetDigest: decision.packetDigest,
              decisionReceiptDigest: decision.receiptDigest,
              sourceEvidenceRefs: packet.evidenceSummary,
              sourceReceiptDigest: event.eventDigest,
            };
          });
      },
    });
  }
}

export function createSkillPromotionReviewLedgerAdapter(options) {
  return new SkillPromotionReviewLedgerAdapter(options);
}
