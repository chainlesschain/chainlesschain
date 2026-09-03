const crypto = require("node:crypto");
const {
  verifySkillInvocationReceipt,
} = require("./skill-invocation-receipt.js");

const DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA =
  "chainlesschain.desktop-skill-outcome-db-authority/v1";
const MAX_DESKTOP_OUTCOME_ROWS = 10_000;
const MAX_CONTEXT_JSON_BYTES = 64 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(
  message,
  code = "CC_DESKTOP_SKILL_OUTCOME_AUTHORITY_UNAVAILABLE",
) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function inspectReceipt(receipt) {
  verifySkillInvocationReceipt(receipt);
  if (
    !Array.isArray(receipt.selectedSkillDigests) ||
    receipt.selectedSkillDigests.length !== 1 ||
    !DIGEST.test(receipt.selectedSkillDigests[0] || "") ||
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
    throw fail("Desktop Skill outcome receipt is invalid");
  }
  return receipt;
}

async function buildDesktopSkillOutcomeAuthority({
  database,
  maxRows = MAX_DESKTOP_OUTCOME_ROWS,
} = {}) {
  if (
    !database ||
    typeof database.all !== "function" ||
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > MAX_DESKTOP_OUTCOME_ROWS
  ) {
    throw new TypeError("Desktop Skill outcome database authority is required");
  }
  const rows = await database.all(
    `SELECT id, context_json
       FROM skill_execution_metrics
      WHERE context_json IS NOT NULL
      ORDER BY completed_at DESC, id DESC
      LIMIT ?`,
    [maxRows + 1],
  );
  if (!Array.isArray(rows)) {
    throw fail("Desktop Skill outcome database returned an invalid result");
  }
  if (rows.length > maxRows) {
    throw fail(
      "Desktop Skill outcome row capacity exceeded",
      "CC_DESKTOP_SKILL_OUTCOME_AUTHORITY_CAPACITY",
    );
  }

  const sourceRows = [];
  const receipts = [];
  const rowIds = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== "string" ||
      row.id.length < 1 ||
      row.id.length > 256 ||
      rowIds.has(row.id) ||
      typeof row.context_json !== "string" ||
      Buffer.byteLength(row.context_json, "utf8") > MAX_CONTEXT_JSON_BYTES
    ) {
      throw fail("Desktop Skill outcome row is invalid or unbounded");
    }
    rowIds.add(row.id);
    sourceRows.push({
      id: row.id,
      contextDigest: `sha256:${crypto
        .createHash("sha256")
        .update(row.context_json)
        .digest("hex")}`,
    });
    let context;
    try {
      context = JSON.parse(row.context_json);
    } catch {
      throw fail("Desktop Skill outcome context JSON is invalid");
    }
    if (
      !Object.prototype.hasOwnProperty.call(context || {}, "invocationReceipt")
    ) {
      continue;
    }
    receipts.push(inspectReceipt(context.invocationReceipt));
  }

  const uniqueReceipts = new Map();
  let duplicateReceiptCount = 0;
  for (const receipt of receipts) {
    if (uniqueReceipts.has(receipt.receiptDigest)) {
      duplicateReceiptCount += 1;
    } else {
      uniqueReceipts.set(receipt.receiptDigest, receipt);
    }
  }
  const totals = new Map();
  let attributionEligibleReceiptCount = 0;
  let outcomeEligibleReceiptCount = 0;
  for (const receipt of uniqueReceipts.values()) {
    if (receipt.attributionEligible !== true) {
      continue;
    }
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
    const total = totals.get(digest) || {
      samples: 0,
      successes: 0,
      corrections: 0,
    };
    total.samples += 1;
    if (receipt.executionStatus === "completed") {
      total.successes += 1;
    }
    if (receipt.userCorrectionRef !== null) {
      total.corrections += 1;
    }
    totals.set(digest, total);
  }
  const metrics = Object.fromEntries(
    [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([digest, total]) => [
        digest,
        Object.freeze({
          samples: total.samples,
          successRate: total.successes / total.samples,
          correctionRate: total.corrections / total.samples,
        }),
      ]),
  );
  const sourceDigest = `sha256:${crypto
    .createHash("sha256")
    .update(
      `${DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA}\0${canonicalJson(sourceRows)}`,
    )
    .digest("hex")}`;
  return Object.freeze({
    schema: DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
    status: "verified-local-db",
    metrics: Object.freeze(metrics),
    evidence: Object.freeze({
      schema: DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
      status: "verified-local-db",
      sourceDigest,
      rowCount: rows.length,
      receiptCount: receipts.length,
      uniqueReceiptCount: uniqueReceipts.size,
      attributionEligibleReceiptCount,
      outcomeEligibleReceiptCount,
      duplicateReceiptCount,
      maxRows,
      antiRollbackWitness: false,
    }),
  });
}

function unavailableDesktopSkillOutcomeAuthority(error) {
  return Object.freeze({
    schema: DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
    status: "unavailable",
    metrics: null,
    evidence: Object.freeze({
      schema: DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
      status: "unavailable",
      code:
        typeof error?.code === "string" &&
        error.code.startsWith("CC_DESKTOP_SKILL_")
          ? error.code
          : "CC_DESKTOP_SKILL_OUTCOME_AUTHORITY_UNAVAILABLE",
      antiRollbackWitness: false,
    }),
  });
}

module.exports = {
  DESKTOP_SKILL_OUTCOME_AUTHORITY_SCHEMA,
  MAX_DESKTOP_OUTCOME_ROWS,
  buildDesktopSkillOutcomeAuthority,
  unavailableDesktopSkillOutcomeAuthority,
};
