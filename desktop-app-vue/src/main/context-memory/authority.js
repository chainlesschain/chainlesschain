const { createHash } = require("node:crypto");

const DESKTOP_STAGE_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE";
const DESKTOP_OPT_IN_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_OPT_IN";
const DESKTOP_CANARY_PERCENT_ENV =
  "CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_CANARY_PERCENT";
const CONTEXT_MEMORY_STAGES = Object.freeze([
  "shadow",
  "internal_canary",
  "opt_in_canary",
  "canonical_default",
  "legacy_read_only",
  "retired",
]);

function cohortBucket(scopeKey) {
  return (
    createHash("sha256").update(String(scopeKey)).digest().readUInt32BE(0) %
    10_000
  );
}

function boundedPercent(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

function resolveDesktopContextMemoryCutover({
  env = process.env,
  scopeKey = "desktop:global",
} = {}) {
  const stage = String(env[DESKTOP_STAGE_ENV] || "shadow")
    .trim()
    .toLowerCase();
  if (!CONTEXT_MEMORY_STAGES.includes(stage)) {
    const error = new Error(`Unsupported Desktop Context/Memory stage: ${stage}`);
    error.code = "CONTEXT_MEMORY_STAGE_INVALID";
    throw error;
  }
  let canonical = false;
  if (stage === "internal_canary") {
    canonical =
      cohortBucket(scopeKey) <
      boundedPercent(env[DESKTOP_CANARY_PERCENT_ENV], 1) * 100;
  } else if (stage === "opt_in_canary") {
    canonical = env[DESKTOP_OPT_IN_ENV] === "1";
  } else if (
    ["canonical_default", "legacy_read_only", "retired"].includes(stage)
  ) {
    canonical = true;
  }
  return Object.freeze({
    stage,
    scopeKey,
    canonical,
    shadow: stage === "shadow",
    legacyWritable: !canonical,
    legacyReadable: stage !== "retired",
    cohortBucket: cohortBucket(scopeKey),
  });
}

function legacyWriterFencedResult(decision, replacement) {
  return {
    success: false,
    code: "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    error: `Legacy Desktop Context/Memory writer is fenced at ${decision.stage}`,
    replacement,
  };
}

function assertDesktopLegacyMutationAllowed({
  env = process.env,
  scopeKey,
  replacement,
} = {}) {
  const decision = resolveDesktopContextMemoryCutover({ env, scopeKey });
  if (decision.legacyWritable) return decision;
  const error = new Error(
    `Legacy Desktop Context/Memory writer is fenced at ${decision.stage}`,
  );
  error.code = "CONTEXT_MEMORY_LEGACY_WRITER_FENCED";
  error.replacement = replacement;
  throw error;
}

module.exports = {
  CONTEXT_MEMORY_STAGES,
  DESKTOP_CANARY_PERCENT_ENV,
  DESKTOP_OPT_IN_ENV,
  DESKTOP_STAGE_ENV,
  assertDesktopLegacyMutationAllowed,
  legacyWriterFencedResult,
  resolveDesktopContextMemoryCutover,
};
