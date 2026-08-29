import { createHash } from "node:crypto";
import {
  ContextMemoryAuthorityRegistry,
  CUTOVER_STAGES,
} from "@chainlesschain/context-memory-kernel";

const STAGE_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE";
const OPT_IN_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_OPT_IN";
const CANARY_PERCENT_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_CANARY_PERCENT";

function boundedPercent(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

function cohortBucket(scopeKey) {
  const digest = createHash("sha256").update(scopeKey).digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function resolveCliContextMemoryCutover({
  env = process.env,
  scopeKey = "cli:global",
} = {}) {
  const stage = env[STAGE_ENV] || "shadow";
  if (!CUTOVER_STAGES.includes(stage)) {
    const error = new Error(`Unsupported CLI Context/Memory stage: ${stage}`);
    error.code = "CONTEXT_MEMORY_STAGE_INVALID";
    throw error;
  }
  let canonical = false;
  let reason = stage;
  if (stage === "internal_canary") {
    const percent = boundedPercent(env[CANARY_PERCENT_ENV], 1);
    canonical = cohortBucket(scopeKey) < percent * 100;
    reason = canonical ? "internal_canary_selected" : "internal_canary_control";
  } else if (stage === "opt_in_canary") {
    canonical = env[OPT_IN_ENV] === "1";
    reason = canonical ? "explicit_opt_in" : "not_opted_in";
  } else if (
    ["canonical_default", "legacy_read_only", "retired"].includes(stage)
  ) {
    canonical = true;
  }
  return Object.freeze({
    stage,
    scopeKey,
    mode: canonical ? "canonical" : "legacy",
    canonical,
    shadow: stage === "shadow",
    // A selected canonical cohort must never run a second legacy writer. This
    // also covers canonical_default; legacy_read_only/retired only tighten the
    // corresponding read capability.
    legacyWritable: !canonical,
    legacyReadable: stage !== "retired",
    reason,
    cohortBucket: cohortBucket(scopeKey),
  });
}

export function createCliAuthority({ decision, now = Date.now } = {}) {
  if (!decision?.canonical) return { registry: null, writer: null };
  const registry = new ContextMemoryAuthorityRegistry({ clock: now });
  const writer = Object.freeze({
    scopeKey: decision.scopeKey,
    surface: "cli",
    mode: "canonical",
    writerId: "cli-context-memory-kernel",
    generation: 1,
  });
  registry.bind({
    ...writer,
    stage: decision.stage,
    leaseExpiresAt: new Date(Number(now()) + 5 * 60_000).toISOString(),
  });
  registry.assertWriter(writer);
  return { registry, writer };
}

export function assertLegacyMutationAllowed(decision) {
  if (decision?.legacyWritable) return;
  const error = new Error(
    `Legacy CLI Context/Memory mutations are fenced at ${decision?.stage || "unknown"}`,
  );
  error.code = "legacy_writer_fenced";
  throw error;
}

export {
  CANARY_PERCENT_ENV,
  OPT_IN_ENV,
  STAGE_ENV,
  cohortBucket,
};
