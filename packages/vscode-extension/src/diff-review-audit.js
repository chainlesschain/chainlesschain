const { createHash } = require("crypto");

const DIFF_REVIEW_AUDIT_SCHEMA = "cc-diff-review/v1";
const MAX_AUDIT_COMMENTS = 64;
const MAX_AUDIT_HUNKS = 128;

function fingerprintText(value) {
  if (typeof value !== "string") return null;
  return {
    sha256: createHash("sha256").update(value, "utf8").digest("hex"),
    chars: value.length,
    lines: value === "" ? 0 : value.split(/\r?\n/).length,
  };
}

function normalizeAuditComments(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => value && typeof value === "object")
    .map((value) => {
      const lineText = bounded(value.lineText, 1000);
      return {
        line: positive(value.line),
        endLine: positive(value.endLine),
        lineFingerprint: lineText ? fingerprintText(lineText) : null,
        note: bounded(value.note, 2000),
      };
    })
    .filter((value) => value.note)
    .slice(0, MAX_AUDIT_COMMENTS);
}

function buildDiffReviewAudit({
  path,
  originalText,
  proposedText,
  result = {},
  host = "ide",
  actor = "local-user",
  now = new Date(),
} = {}) {
  const reviewedText =
    typeof result.reviewedText === "string"
      ? result.reviewedText
      : typeof result.finalText === "string"
        ? result.finalText
        : proposedText;
  const selectedHunks = [
    ...new Set(
      (Array.isArray(result.selectedHunks) ? result.selectedHunks : []).filter(
        (value) => Number.isInteger(value) && value >= 0,
      ),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, MAX_AUDIT_HUNKS);
  const outcome = bounded(result.outcome, 64) || "rejected";
  const written = outcome === "accepted" || outcome === "partial";
  const createdAt = formatDate(now);
  const proposed = fingerprintText(proposedText);
  const reviewed = fingerprintText(reviewedText);
  const finalText = written
    ? typeof result.finalText === "string"
      ? result.finalText
      : reviewedText
    : null;
  const source = selectedHunks.length
    ? "hunk-selection"
    : proposed?.sha256 && reviewed?.sha256 !== proposed.sha256
      ? "user-edited"
      : "agent-proposed";
  const identity = [
    bounded(path, 2048),
    proposed?.sha256 || "",
    createdAt,
    outcome,
  ].join("\0");
  return {
    schema: DIFF_REVIEW_AUDIT_SCHEMA,
    reviewId: `drev_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
    createdAt,
    actor: bounded(actor, 128) || "local-user",
    host: bounded(host, 64) || "ide",
    path: bounded(path, 2048),
    outcome,
    source,
    written,
    baseline: fingerprintText(originalText),
    proposed,
    reviewed,
    final: fingerprintText(finalText),
    selectedHunks,
    appliedHunks: positive(result.appliedHunks),
    totalHunks: positive(result.totalHunks),
    comments: normalizeAuditComments(result.comments),
    reason: bounded(result.reason, 512) || null,
  };
}

function bounded(value, limit) {
  return String(value == null ? "" : value).slice(0, limit);
}

function positive(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function formatDate(value) {
  try {
    return (value instanceof Date ? value : new Date(value)).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

module.exports = {
  DIFF_REVIEW_AUDIT_SCHEMA,
  buildDiffReviewAudit,
  fingerprintText,
  normalizeAuditComments,
};
