const MANAGED_EVENT_TYPES = new Set([
  "managed-checkpoint",
  "managed-checkpoint-settled",
  "managed-checkpoint-error",
]);

function token(value, maxLength = 96) {
  if (value == null) return null;
  const normalized = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N}._:/@+-]+/gu, "_")
    .slice(0, maxLength);
  return normalized || null;
}

function shortDigest(value) {
  const normalized = token(value, 96);
  if (!normalized) return null;
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

/**
 * Render only bounded checkpoint metadata. Tool arguments, file contents,
 * arbitrary event fields and raw failure messages are intentionally omitted.
 */
export function formatManagedCheckpointEvent(event) {
  if (!event || !MANAGED_EVENT_TYPES.has(event.type)) return null;

  const parts = ["[managed checkpoint]"];
  if (event.type === "managed-checkpoint-error") {
    parts.push(
      event.recovery_required === true
        ? "recovery required"
        : event.phase === "prepare"
          ? "preparation blocked"
          : "settlement failed",
    );
  } else {
    parts.push(token(event.phase, 32) || "status");
  }

  const tool = token(event.tool, 96);
  const coverage = token(event.coverage, 16);
  const fileCoverage = token(event.file_coverage, 16);
  const reason = token(event.reason, 128);
  const code = token(event.code, 96);
  const transactionId = token(event.transaction_id, 96);
  const checkpointId = token(event.id || event.checkpoint_id, 96);
  const evidenceDigest = shortDigest(event.evidence_digest);

  if (tool) parts.push(`tool=${tool}`);
  if (coverage) parts.push(`coverage=${coverage}`);
  if (fileCoverage) parts.push(`files=${fileCoverage}`);
  if (reason) parts.push(`reason=${reason}`);
  if (code) parts.push(`code=${code}`);
  if (transactionId) parts.push(`transaction=${transactionId}`);
  if (checkpointId) parts.push(`checkpoint=${checkpointId}`);
  if (evidenceDigest) parts.push(`evidence=${evidenceDigest}`);
  return `  ${parts.join(" ")}`;
}
