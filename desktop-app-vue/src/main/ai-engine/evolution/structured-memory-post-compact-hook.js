"use strict";

const crypto = require("node:crypto");
const structuredMemory = require("@chainlesschain/session-core/structured-evolution-memory");

const {
  STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA,
  createStructuredMemoryPostCompactVerifier,
} = structuredMemory;

const ATTESTATION_DOMAIN =
  "chainlesschain.desktop-structured-memory-post-compact-hook/v1\0";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function capture(owner, name) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`${name} port is required`);
  }
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function normalizeDescriptor(input) {
  if (!Number.isSafeInteger(input?.authorityRevision) || input.authorityRevision <= 0) {
    throw new TypeError("authorityRevision must be a positive integer");
  }
  if (!DIGEST.test(input?.handlerDigest || "")) {
    throw new TypeError("handlerDigest must be sha256-bound");
  }
  return Object.freeze({
    tenantId: requiredString(input.tenantId, "tenantId"),
    authorityId: requiredString(input.authorityId, "authorityId"),
    authorityRevision: input.authorityRevision,
    handlerDigest: input.handlerDigest,
  });
}

function summarize(outcome) {
  const hookResults = Array.isArray(outcome?.hookResults)
    ? outcome.hookResults
    : [];
  return Object.freeze({
    result: typeof outcome?.result === "string" ? outcome.result : null,
    prevented: outcome?.prevented === true,
    totalHooks: Number.isSafeInteger(outcome?.totalHooks)
      ? outcome.totalHooks
      : 0,
    executedHooks: Number.isSafeInteger(outcome?.executedHooks)
      ? outcome.executedHooks
      : 0,
    results: Object.freeze(
      hookResults
        .map((entry) => String(entry?.result || "unknown"))
        .sort(),
    ),
  });
}

function attestationMessage(result) {
  const core = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "signature"),
  );
  return `${ATTESTATION_DOMAIN}${canonical(core)}`;
}

function createDesktopStructuredMemoryPostCompactVerifier({
  descriptor: input,
  hookSystem,
  attestor,
  clock = Date.now,
} = {}) {
  const identity = normalizeDescriptor(input);
  const trigger = capture(hookSystem, "trigger");
  const sign = capture(attestor, "sign");
  const verify = capture(attestor, "verify");
  if (typeof clock !== "function") {
    throw new TypeError("clock must be a function");
  }

  const hook = {
    run: async (request) => {
      const outcome = await trigger(
        "PostCompact",
        {
          tenantId: identity.tenantId,
          trigger: "structured-memory",
          snapshotDigest: request.snapshotDigest,
          projectionDigest: request.projectionDigest,
          previousSnapshotDigest: request.previousSnapshotDigest,
          candidate: request.candidate,
        },
        { tenantId: identity.tenantId, structuredMemory: true },
      );
      const summary = summarize(outcome);
      const accepted =
        !summary.prevented &&
        summary.result !== "prevent" &&
        summary.totalHooks > 0 &&
        summary.executedHooks === summary.totalHooks &&
        summary.results.length === summary.totalHooks &&
        summary.results.every((result) =>
          ["continue", "modify"].includes(result),
        );
      const unsigned = {
        schema: STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA,
        authenticated: true,
        ...identity,
        snapshotDigest: request.snapshotDigest,
        projectionDigest: request.projectionDigest,
        previousSnapshotDigest: request.previousSnapshotDigest,
        decision: accepted ? "accepted" : "rejected",
        checkedAt: new Date(clock()).toISOString(),
        hookOutcomeDigest: hash(summary),
      };
      const receiptDigest = hash({
        domain: ATTESTATION_DOMAIN,
        result: unsigned,
      });
      const result = { ...unsigned, receiptDigest };
      const signature = await sign({
        message: attestationMessage(result),
        identity,
        result: Object.freeze({ ...result }),
      });
      return Object.freeze({ ...result, signature });
    },
  };

  return createStructuredMemoryPostCompactVerifier({
    descriptor: identity,
    hook,
    verifier: {
      verify: async ({ result }) => {
        const expectedDigest = hash({
          domain: ATTESTATION_DOMAIN,
          result: Object.fromEntries(
            Object.entries(result).filter(
              ([key]) => !["receiptDigest", "signature"].includes(key),
            ),
          ),
        });
        if (result.receiptDigest !== expectedDigest) {
          return false;
        }
        return await verify({
          message: attestationMessage(result),
          identity,
          result,
        });
      },
    },
  });
}

module.exports = { createDesktopStructuredMemoryPostCompactVerifier };
