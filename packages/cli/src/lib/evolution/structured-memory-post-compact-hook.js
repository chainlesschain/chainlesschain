import { createHash } from "node:crypto";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import { executeHooksV2Event } from "../hooks-v2-producers.js";

const {
  STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA,
  createStructuredMemoryPostCompactVerifier,
} = structuredMemory;

const ATTESTATION_DOMAIN = "chainlesschain.structured-memory-post-compact-hook/v1\0";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function capture(owner, name) {
  if (typeof owner?.[name] !== "function") throw new TypeError(`${name} port is required`);
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function descriptor(input) {
  if (!Number.isSafeInteger(input?.authorityRevision) || input.authorityRevision <= 0) {
    throw new TypeError("authorityRevision must be a positive integer");
  }
  if (!DIGEST.test(input?.handlerDigest || "")) throw new TypeError("handlerDigest must be sha256-bound");
  return Object.freeze({ tenantId: requiredString(input.tenantId, "tenantId"),
    authorityId: requiredString(input.authorityId, "authorityId"), authorityRevision: input.authorityRevision,
    handlerDigest: input.handlerDigest });
}

function outcomeSummary(outcome) {
  const results = Array.isArray(outcome?.results) ? outcome.results : [];
  return Object.freeze({ success: outcome?.success === true, blocked: outcome?.blocked === true,
    decision: typeof outcome?.decision === "string" ? outcome.decision : null,
    resultCount: results.length,
    statuses: Object.freeze(results.map((result) => String(result?.status || "unknown")).sort()) });
}

function attestationMessage(result) {
  const core = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "signature"));
  return `${ATTESTATION_DOMAIN}${canonical(core)}`;
}

export function createCliStructuredMemoryPostCompactVerifier({ descriptor: input,
  hookExecutor = executeHooksV2Event, attestor, clock = Date.now } = {}) {
  const identity = descriptor(input);
  if (typeof hookExecutor !== "function") throw new TypeError("hookExecutor must be a function");
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const sign = capture(attestor, "sign");
  const verify = capture(attestor, "verify");
  const hook = { run: async (request) => {
    const outcome = await hookExecutor("PostCompact", { schema_version: 1, trigger: "structured-memory",
      tenant_id: identity.tenantId, snapshot_digest: request.snapshotDigest,
      projection_digest: request.projectionDigest, previous_snapshot_digest: request.previousSnapshotDigest,
      candidate: request.candidate }, { failClosed: true });
    const summary = outcomeSummary(outcome);
    const accepted = summary.success && !summary.blocked && summary.decision !== "block" &&
      summary.resultCount > 0 && summary.statuses.every((status) => status === "success");
    const unsigned = { schema: STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA, authenticated: true,
      ...identity, snapshotDigest: request.snapshotDigest, projectionDigest: request.projectionDigest,
      previousSnapshotDigest: request.previousSnapshotDigest, decision: accepted ? "accepted" : "rejected",
      checkedAt: new Date(clock()).toISOString(), hookOutcomeDigest: hash(summary) };
    const receiptDigest = hash({ domain: ATTESTATION_DOMAIN, result: unsigned });
    const result = { ...unsigned, receiptDigest };
    const signature = await sign({ message: attestationMessage(result), identity, result: Object.freeze({ ...result }) });
    return Object.freeze({ ...result, signature });
  } };
  return createStructuredMemoryPostCompactVerifier({ descriptor: identity, hook,
    verifier: { verify: async ({ result }) => {
      const expectedDigest = hash({ domain: ATTESTATION_DOMAIN,
        result: Object.fromEntries(Object.entries(result).filter(([key]) => !["receiptDigest", "signature"].includes(key))) });
      if (result.receiptDigest !== expectedDigest) return false;
      return await verify({ message: attestationMessage(result), identity, result });
    } } });
}
