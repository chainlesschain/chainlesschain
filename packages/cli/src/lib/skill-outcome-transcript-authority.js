import { createHash } from "node:crypto";
import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";

import {
  listSessionAuthoritySummaries,
  readVerifiedProjection,
} from "../harness/jsonl-session-store.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

const { verifySkillInvocationReceipt } = skillInvocationReceipt;

export const SKILL_OUTCOME_AUTHORITY_SCHEMA =
  "chainlesschain.skill-outcome-transcript-authority/v1";
export const MAX_OUTCOME_AUTHORITY_SESSIONS = 128;
export const MAX_OUTCOME_AUTHORITY_RECEIPTS = 10_000;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TRANSCRIPT_HASH = /^[a-f0-9]{64}$/u;

function unavailable(message, code = "CC_SKILL_OUTCOME_AUTHORITY_UNAVAILABLE") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function verifiedReceipt(receipt) {
  verifySkillInvocationReceipt(receipt);
  if (
    !Array.isArray(receipt.selectedSkillDigests) ||
    receipt.selectedSkillDigests.length !== 1 ||
    !DIGEST.test(receipt.selectedSkillDigests[0] || "")
  ) {
    throw unavailable("Skill outcome receipt has an invalid selection binding");
  }
  if (
    !Array.isArray(receipt.graderReceipts) ||
    receipt.graderReceipts.length > 64 ||
    receipt.graderReceipts.some((digest) => !DIGEST.test(digest || "")) ||
    (receipt.userCorrectionRef !== null &&
      (typeof receipt.userCorrectionRef !== "string" ||
        receipt.userCorrectionRef.length < 1 ||
        receipt.userCorrectionRef.length > 256)) ||
    (receipt.attributionEligible === true &&
      (receipt.attributionStatus !== "complete" ||
        !Array.isArray(receipt.missingAttribution) ||
        receipt.missingAttribution.length !== 0))
  ) {
    throw unavailable("Skill outcome receipt has an invalid attribution state");
  }
  return receipt;
}

function transcriptReceiptProjection(receipts, capacity) {
  return {
    accept(event) {
      const receipt = event?.data?.skill_invocation_receipt;
      if (receipt === undefined) return;
      if (event.type !== "tool_call" || event.data?.tool !== "run_skill") {
        throw unavailable(
          "Skill outcome receipt is bound to a non-Skill event",
        );
      }
      if (receipts.length >= capacity) {
        throw unavailable(
          "Skill outcome receipt capacity exceeded",
          "CC_SKILL_OUTCOME_AUTHORITY_CAPACITY",
        );
      }
      receipts.push(verifiedReceipt(receipt));
    },
    finish(authority) {
      if (
        !authority ||
        !Number.isSafeInteger(authority.eventCount) ||
        authority.eventCount < 0 ||
        (authority.headHash !== null &&
          !TRANSCRIPT_HASH.test(authority.headHash || ""))
      ) {
        throw unavailable("Verified transcript returned invalid authority");
      }
      return Object.freeze({
        headHash: authority.headHash,
        eventCount: authority.eventCount,
      });
    },
  };
}

/**
 * Build bounded outcome metrics only from fully verified canonical transcripts.
 * Any damaged/blocked selected session or projection failure disables the whole
 * sample instead of silently ranking from a favorable partial subset.
 */
export function buildSkillOutcomeTranscriptAuthority(
  options = {},
  dependencies = {},
) {
  const maxSessions =
    options.maxSessions === undefined
      ? MAX_OUTCOME_AUTHORITY_SESSIONS
      : Number(options.maxSessions);
  const maxReceipts =
    options.maxReceipts === undefined
      ? MAX_OUTCOME_AUTHORITY_RECEIPTS
      : Number(options.maxReceipts);
  if (
    !Number.isSafeInteger(maxSessions) ||
    maxSessions < 1 ||
    maxSessions > MAX_OUTCOME_AUTHORITY_SESSIONS ||
    !Number.isSafeInteger(maxReceipts) ||
    maxReceipts < 1 ||
    maxReceipts > MAX_OUTCOME_AUTHORITY_RECEIPTS
  ) {
    throw new TypeError("Skill outcome authority bounds are invalid");
  }
  const list =
    dependencies.listSessionAuthoritySummaries || listSessionAuthoritySummaries;
  const read = dependencies.readVerifiedProjection || readVerifiedProjection;
  if (typeof list !== "function" || typeof read !== "function") {
    throw new TypeError(
      "Skill outcome transcript authority ports are required",
    );
  }
  const rows = list({ limit: maxSessions });
  if (!Array.isArray(rows) || rows.length > maxSessions) {
    throw unavailable(
      "Skill outcome session authority is invalid or unbounded",
    );
  }
  const sessionIds = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== "string" ||
      row.id.length < 1 ||
      row.id.length > 256 ||
      sessionIds.has(row.id) ||
      row._store !== "jsonl" ||
      row._presence !== "present" ||
      row._blocked !== false
    ) {
      throw unavailable(
        "Skill outcome session authority contains a blocked row",
      );
    }
    sessionIds.add(row.id);
  }

  const receipts = [];
  const sessions = rows.map((row) => {
    const authority = read(row.id, () =>
      transcriptReceiptProjection(receipts, maxReceipts),
    );
    return Object.freeze({
      sessionId: row.id,
      headHash: authority.headHash,
      eventCount: authority.eventCount,
    });
  });
  const uniqueReceipts = new Map();
  let duplicateReceiptCount = 0;
  for (const receipt of receipts) {
    if (uniqueReceipts.has(receipt.receiptDigest)) {
      duplicateReceiptCount += 1;
      continue;
    }
    uniqueReceipts.set(receipt.receiptDigest, receipt);
  }

  const totals = new Map();
  let attributionEligibleReceiptCount = 0;
  let outcomeEligibleReceiptCount = 0;
  for (const receipt of uniqueReceipts.values()) {
    if (receipt.attributionEligible !== true) continue;
    attributionEligibleReceiptCount += 1;
    const hasOutcomeEvidence =
      receipt.graderReceipts.length > 0 || receipt.userCorrectionRef !== null;
    if (
      !hasOutcomeEvidence ||
      !["completed", "failed"].includes(receipt.executionStatus)
    ) {
      continue;
    }
    outcomeEligibleReceiptCount += 1;
    const digest = receipt.selectedSkillDigests[0];
    const prior = totals.get(digest) || {
      samples: 0,
      successes: 0,
      corrections: 0,
    };
    prior.samples += 1;
    if (receipt.executionStatus === "completed") prior.successes += 1;
    if (receipt.userCorrectionRef !== null) prior.corrections += 1;
    totals.set(digest, prior);
  }
  const metrics = Object.fromEntries(
    [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([digest, value]) => [
        digest,
        Object.freeze({
          samples: value.samples,
          successRate: value.successes / value.samples,
          correctionRate: value.corrections / value.samples,
        }),
      ]),
  );
  const source = sessions
    .map(({ sessionId, headHash, eventCount }) => ({
      sessionId,
      headHash,
      eventCount,
    }))
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const sourceDigest = `sha256:${createHash("sha256")
    .update(`${SKILL_OUTCOME_AUTHORITY_SCHEMA}\0${canonicalJson(source)}`)
    .digest("hex")}`;
  return Object.freeze({
    schema: SKILL_OUTCOME_AUTHORITY_SCHEMA,
    status: "verified",
    metrics: Object.freeze(metrics),
    evidence: Object.freeze({
      schema: SKILL_OUTCOME_AUTHORITY_SCHEMA,
      status: "verified",
      sourceDigest,
      selectedSessionCount: sessions.length,
      receiptCount: receipts.length,
      uniqueReceiptCount: uniqueReceipts.size,
      attributionEligibleReceiptCount,
      outcomeEligibleReceiptCount,
      duplicateReceiptCount,
      maxSessions,
      maxReceipts,
    }),
  });
}

export function unavailableSkillOutcomeTranscriptAuthority(error) {
  return Object.freeze({
    schema: SKILL_OUTCOME_AUTHORITY_SCHEMA,
    status: "unavailable",
    metrics: null,
    evidence: Object.freeze({
      schema: SKILL_OUTCOME_AUTHORITY_SCHEMA,
      status: "unavailable",
      code:
        typeof error?.code === "string" && error.code.startsWith("CC_SKILL_")
          ? error.code
          : "CC_SKILL_OUTCOME_AUTHORITY_UNAVAILABLE",
    }),
  });
}
