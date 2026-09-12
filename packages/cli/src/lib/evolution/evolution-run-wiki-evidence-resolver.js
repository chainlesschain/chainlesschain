import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { EvolutionEvidenceArtifactAdapter } from "./evolution-evidence-artifact-adapter.js";
import { EvolutionEvidenceReader } from "./evolution-evidence-projector.js";
import { captureEvolutionRunEvidenceReader } from "./evolution-run-ledger-adapter.js";
import { WIKI_EVIDENCE_SCHEMA } from "./evidence-backed-wiki-maintainer.js";

export const EVOLUTION_RUN_WIKI_EVIDENCE_DENIED_CODE =
  "CC_EVOLUTION_RUN_WIKI_EVIDENCE_DENIED";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const KINDS = Object.freeze({
  "tool-observation": "tool-observation",
  "verified-outcome": "grader-receipt",
});
const FORBIDDEN = new Set([
  "content",
  "output",
  "payload",
  "prompt",
  "secret",
  "token",
  "__proto__",
  "constructor",
  "prototype",
]);
const RESERVED = new Set([
  "sourceCommitment",
  "rawRecordDigest",
  "manifestDigest",
  "projectionReceiptDigest",
  "schemaDigest",
]);

function denied(message) {
  const error = new Error(message);
  error.code = EVOLUTION_RUN_WIKI_EVIDENCE_DENIED_CODE;
  return error;
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function record(value, label) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw denied(`${label} must be plain data`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    )
      throw denied(`${label} must contain data fields`);
  }
  return value;
}
function metadata(value, depth = 0) {
  if (depth > 8) throw denied("Wiki evidence metadata is too deep");
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (Array.isArray(value)) {
    denseArray(value, 64);
    return value.map((entry) => metadata(entry, depth + 1));
  }
  record(value, "Wiki evidence metadata");
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (FORBIDDEN.has(key.toLowerCase()))
        throw denied("Wiki evidence contains forbidden metadata fields");
      return [key, metadata(child, depth + 1)];
    }),
  );
}
function denseArray(value, max) {
  if (
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw denied("Wiki metadata arrays must be bounded plain data");
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw denied("Wiki metadata arrays must be dense data");
  }
}

/**
 * Host configuration, never per-request trust claims. Only a captured real Run
 * capability can select evidence; both downstream calls use production private
 * state, so instance-shaped facades cannot supply bundles or read decisions.
 */
export function createEvolutionRunWikiEvidenceResolver({
  runAdapter,
  evidenceAdapter,
  evidenceReader,
  principalEnvelope,
  schemaPolicies,
} = {}) {
  const run = captureEvolutionRunEvidenceReader(runAdapter);
  if (
    utilTypes.isProxy(evidenceAdapter) ||
    Object.getPrototypeOf(evidenceAdapter ?? {}) !==
      EvolutionEvidenceArtifactAdapter.prototype ||
    utilTypes.isProxy(evidenceReader) ||
    Object.getPrototypeOf(evidenceReader ?? {}) !==
      EvolutionEvidenceReader.prototype
  ) {
    throw new TypeError(
      "real evidence adapter and trusted reader are required",
    );
  }
  if (
    typeof principalEnvelope !== "string" ||
    !principalEnvelope ||
    principalEnvelope.length > 8192
  ) {
    throw new TypeError("Wiki reader principal envelope is required");
  }
  record(schemaPolicies, "Wiki schema policies");
  const policies = new Map();
  for (const [schemaDigest, input] of Object.entries(schemaPolicies)) {
    record(input, "Wiki schema policy");
    denseArray(input.metadataKeys, 32);
    if (
      !DIGEST.test(schemaDigest) ||
      Object.keys(input).sort().join(",") !== "metadataKeys,sourceKind" ||
      !Object.hasOwn(KINDS, input.sourceKind) ||
      !Array.isArray(input.metadataKeys) ||
      !input.metadataKeys.length ||
      input.metadataKeys.length > 32 ||
      input.metadataKeys.some(
        (key) =>
          typeof key !== "string" ||
          !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(key) ||
          FORBIDDEN.has(key.toLowerCase()) ||
          RESERVED.has(key),
      ) ||
      new Set(input.metadataKeys).size !== input.metadataKeys.length
    ) {
      throw denied("Wiki schema policy is invalid");
    }
    policies.set(
      schemaDigest,
      freeze({
        sourceKind: input.sourceKind,
        metadataKeys: [...input.metadataKeys],
      }),
    );
  }
  if (!policies.size || policies.size > 32)
    throw denied("Wiki schema policy set must be bounded and nonempty");
  const resolve = EvolutionEvidenceArtifactAdapter.prototype.resolveRunEvidence;
  const readTrusted = EvolutionEvidenceReader.prototype.readTrusted;
  const tenantId = run.descriptor.tenantId;
  return Object.freeze({
    tenantId,
    async resolveEvidence(evidenceId) {
      const checkpoint = run.readEvidence(evidenceId);
      const event = checkpoint.event;
      if (event.tenantId !== tenantId || event.runId !== run.descriptor.runId)
        throw denied("Wiki evidence belongs to another Run");
      const resolved = await Reflect.apply(resolve, evidenceAdapter, [
        {
          event,
          ledgerId: checkpoint.ledgerHead.ledgerId,
          epoch: checkpoint.ledgerHead.epoch,
        },
      ]);
      const { bundle } = resolved;
      const raw = bundle.rawRecord;
      const trusted = await Reflect.apply(readTrusted, evidenceReader, [
        bundle,
        principalEnvelope,
        "wiki-maintenance",
      ]);
      const policy = policies.get(raw.schemaDigest);
      if (
        raw.tenantId !== tenantId ||
        raw.evidenceId !== evidenceId ||
        trusted.tenantId !== tenantId ||
        trusted.evidenceId !== evidenceId ||
        resolved.verification.verified !== true ||
        trusted.status !== "trusted" ||
        !raw.authenticated ||
        raw.trust !== "trusted" ||
        !raw.compilable ||
        !policy ||
        policy.sourceKind !== raw.sourceKind ||
        !Object.hasOwn(KINDS, raw.sourceKind)
      ) {
        throw denied(
          "Wiki evidence has no admitted authenticated source schema",
        );
      }
      const content = record(trusted.content, "trusted Wiki metadata");
      if (
        Object.keys(content).some((key) => !policy.metadataKeys.includes(key))
      )
        throw denied("trusted Wiki metadata exceeds its schema allowlist");
      const data = metadata(content);
      if (Buffer.byteLength(canonical(data), "utf8") > 16_384)
        throw denied("trusted Wiki metadata exceeds its budget");
      const core = {
        schema: WIKI_EVIDENCE_SCHEMA,
        tenantId,
        ref: evidenceId,
        sourceDigest: hash({
          domain: "chainlesschain.wiki-source-commitment/v1",
          tenantId,
          sourceCommitment: raw.sourceCommitment,
        }),
        projectionDigest: trusted.projectionDigest,
        artifactRef: event.artifactRef,
        trustedProjection: true,
        trustDomain: `evolution-principal:${tenantId}:${raw.principalId}`,
        kind: KINDS[raw.sourceKind],
        status: "active",
        observedAt: bundle.receipt.createdAt,
        expiresAt: raw.retention.expiresAt,
        data: {
          ...data,
          rawRecordDigest: raw.rawRecordDigest,
          manifestDigest: event.payloadDigest,
          projectionReceiptDigest: bundle.receipt.receiptDigest,
          schemaDigest: raw.schemaDigest,
        },
      };
      run.assertCurrent(checkpoint);
      return freeze({ ...core, envelopeDigest: hash(core) });
    },
  });
}
