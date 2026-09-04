import { createHash } from "node:crypto";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  WIKISKILL_BENCHMARK_ENVELOPE_SCHEMA,
  verifyWikiSkillBenchmarkPlan,
  verifyWikiSkillBenchmarkReport,
} from "./wikiskill-benchmark.js";
import {
  verifyWikiSkillBenchmarkExecutionBinding,
  verifyWikiSkillBenchmarkExecutionManifest,
} from "./wikiskill-benchmark-execution-host.js";

export const WIKISKILL_BENCHMARK_BUNDLE_SCHEMA =
  "chainlesschain.wikiskill-benchmark-bundle/v1";
export const WIKISKILL_BENCHMARK_REPORT_CHUNK_SCHEMA =
  "chainlesschain.wikiskill-benchmark-report-chunk/v1";
export const WIKISKILL_BENCHMARK_LEDGER_EVENT =
  "evolution.wikiskill-benchmark.committed";
export const WIKISKILL_BENCHMARK_LEDGER_CONFLICT_CODE =
  "CC_WIKISKILL_BENCHMARK_LEDGER_CONFLICT";
export const WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE =
  "CC_WIKISKILL_BENCHMARK_LEDGER_CORRUPT";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REPORT_CHUNK_BYTES = 512 * 1024;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_CHUNKS = MAX_REPORT_BYTES / REPORT_CHUNK_BYTES;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function domainDigest(schema, value) {
  return sha(`${schema}\0${canonical(value)}`);
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${label} is required`);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    fail(
      WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
      `${label} has unexpected or missing fields`,
    );
  }
}

function fail(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  throw error;
}

function capture(owner, method, label) {
  if (!owner || typeof owner[method] !== "function")
    throw new TypeError(`${label}.${method}() is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function descriptor(input) {
  const value = Object.freeze({
    tenantId: text(input?.tenantId, "tenantId"),
    artifactTenantId: text(input?.artifactTenantId, "artifactTenantId"),
    skillName: text(input?.skillName, "skillName"),
    audience: text(input?.audience, "audience"),
    purpose: text(input?.purpose, "purpose"),
  });
  if (value.purpose !== "evolution-ledger")
    throw new TypeError("benchmark adapter purpose must be evolution-ledger");
  return value;
}

function jsonData(value, label, maxBytes = 16 * 1024) {
  let encoded;
  let cloned;
  try {
    encoded = JSON.stringify(value);
    cloned = JSON.parse(encoded);
  } catch (cause) {
    throw new TypeError(`${label} must be JSON data`, { cause });
  }
  if (!encoded || Buffer.byteLength(encoded) > maxBytes)
    throw new TypeError(`${label} is outside its size bound`);
  if (canonical(cloned) !== canonical(value))
    throw new TypeError(`${label} must not contain non-JSON values`);
  return Object.freeze(cloned);
}

function publish(put, type, value, descriptorValue) {
  const result = put(type, value, {
    audience: descriptorValue.audience,
    purpose: descriptorValue.purpose,
    retention: "ledger",
  });
  if (
    !result?.ref ||
    result.receipt?.persisted !== true ||
    result.receipt?.readbackVerified !== true ||
    result.receipt?.integrityVerified !== true ||
    result.receipt?.retention !== "ledger"
  ) {
    fail(
      WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
      `${type} was not durably read back`,
    );
  }
  return result.ref;
}

export class WikiSkillBenchmarkLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    verifyAttestation,
  } = {}) {
    this.descriptor = descriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver))
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    if (typeof verifyAttestation !== "function")
      throw new TypeError("verifyAttestation is required");
    this._resolve = ledgerArtifactResolver;
    this._verifyAttestation = verifyAttestation;
    Object.freeze(this);
  }

  _events(reportDigest) {
    digest(reportDigest, "reportDigest");
    const events = this._read();
    if (!Array.isArray(events))
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark ledger read is invalid",
      );
    const selected = events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === WIKISKILL_BENCHMARK_LEDGER_EVENT &&
        event.tenantId === this.descriptor.tenantId &&
        event.skillName === this.descriptor.skillName &&
        event.correlationId === reportDigest,
    );
    if (selected.length > 1)
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark report has multiple committed manifests",
      );
    return selected;
  }

  _artifact(ref, expectedType) {
    const authority = this._verifyLedger();
    const resolution = this._resolve({
      epoch: authority.epoch,
      ledgerId: authority.ledgerId,
      ref,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.found !== true ||
      resolution.ref !== ref.ref ||
      resolution.digest !== ref.digest ||
      !Buffer.isBuffer(resolution.bytes)
    ) {
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        `${expectedType} resolution is invalid`,
      );
    }
    let durable;
    try {
      durable = JSON.parse(resolution.bytes.toString("utf8"));
    } catch (cause) {
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        `${expectedType} is not canonical JSON`,
        cause,
      );
    }
    if (
      durable?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      durable.tenantId !== this.descriptor.artifactTenantId ||
      durable.audience !== this.descriptor.audience ||
      durable.purpose !== this.descriptor.purpose ||
      durable.retention !== "ledger" ||
      durable.type !== expectedType
    ) {
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        `${expectedType} durable binding is invalid`,
      );
    }
    return durable.value;
  }

  async _verifyEnvelope(plan, envelope) {
    if (
      !envelope ||
      envelope.schema !== WIKISKILL_BENCHMARK_ENVELOPE_SCHEMA ||
      Object.keys(envelope).length !== 3 ||
      !Object.hasOwn(envelope, "report") ||
      !Object.hasOwn(envelope, "attestation")
    ) {
      throw new TypeError("signed benchmark envelope is invalid");
    }
    const report = verifyWikiSkillBenchmarkReport({
      plan,
      report: envelope.report,
    });
    const attestation = jsonData(envelope.attestation, "benchmark attestation");
    if (
      (await this._verifyAttestation({
        digest: report.reportDigest,
        attestation,
      })) !== true
    ) {
      throw new Error("benchmark report attestation rejected");
    }
    return Object.freeze({
      schema: WIKISKILL_BENCHMARK_ENVELOPE_SCHEMA,
      report,
      attestation,
    });
  }

  async load(reportDigest) {
    const event = this._events(reportDigest)[0];
    if (!event) return null;
    const manifest = this._artifact(
      event.subjectRef,
      "wikiskill-benchmark-envelope-manifest",
    );
    exact(
      manifest,
      [
        "schema",
        "tenantId",
        "skillName",
        "planDigest",
        "executionManifestDigest",
        "reportDigest",
        "planRef",
        "executionManifestRef",
        "chunks",
        "reportBytes",
        "reportBytesDigest",
        "envelopeSchema",
        "attestation",
        "effectiveAt",
        "manifestDigest",
      ],
      "benchmark manifest",
    );
    if (
      manifest?.schema !== WIKISKILL_BENCHMARK_BUNDLE_SCHEMA ||
      manifest.tenantId !== this.descriptor.tenantId ||
      manifest.skillName !== this.descriptor.skillName ||
      manifest.reportDigest !== reportDigest ||
      !DIGEST.test(manifest.planDigest ?? "") ||
      !DIGEST.test(manifest.executionManifestDigest ?? "") ||
      !DIGEST.test(manifest.reportBytesDigest ?? "") ||
      !DIGEST.test(manifest.manifestDigest ?? "") ||
      !Number.isSafeInteger(manifest.reportBytes) ||
      manifest.reportBytes < 1 ||
      manifest.reportBytes > MAX_REPORT_BYTES ||
      !Array.isArray(manifest.chunks) ||
      manifest.chunks.length < 1 ||
      manifest.chunks.length > MAX_CHUNKS ||
      manifest.envelopeSchema !== WIKISKILL_BENCHMARK_ENVELOPE_SCHEMA ||
      !Number.isFinite(Date.parse(manifest.effectiveAt ?? ""))
    ) {
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark manifest binding is invalid",
      );
    }
    const core = structuredClone(manifest);
    delete core.manifestDigest;
    if (
      domainDigest(WIKISKILL_BENCHMARK_BUNDLE_SCHEMA, core) !==
      manifest.manifestDigest
    )
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark manifest digest mismatch",
      );
    const plan = verifyWikiSkillBenchmarkPlan(
      this._artifact(manifest.planRef, "wikiskill-benchmark-plan"),
    );
    if (plan.planDigest !== manifest.planDigest)
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark plan differs from its manifest",
      );
    const executionManifest = verifyWikiSkillBenchmarkExecutionManifest(
      this._artifact(
        manifest.executionManifestRef,
        "wikiskill-benchmark-execution-manifest",
      ),
    );
    if (
      executionManifest.manifestDigest !== manifest.executionManifestDigest ||
      plan.executionManifestDigest !== executionManifest.manifestDigest
    )
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark execution manifest differs from its plan",
      );
    verifyWikiSkillBenchmarkExecutionBinding({ plan, executionManifest });
    const buffers = manifest.chunks.map((entry, index) => {
      exact(
        entry,
        ["index", "size", "byteDigest", "ref"],
        "benchmark chunk manifest entry",
      );
      if (
        entry?.index !== index ||
        !DIGEST.test(entry.byteDigest ?? "") ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 1 ||
        entry.size > REPORT_CHUNK_BYTES
      ) {
        fail(
          WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
          "benchmark chunk manifest is invalid",
        );
      }
      const chunk = this._artifact(
        entry.ref,
        "wikiskill-benchmark-report-chunk",
      );
      exact(
        chunk,
        [
          "schema",
          "reportDigest",
          "index",
          "count",
          "encoding",
          "size",
          "byteDigest",
          "bytes",
        ],
        "benchmark report chunk",
      );
      if (
        chunk?.schema !== WIKISKILL_BENCHMARK_REPORT_CHUNK_SCHEMA ||
        chunk.reportDigest !== reportDigest ||
        chunk.index !== index ||
        chunk.count !== manifest.chunks.length ||
        chunk.encoding !== "base64" ||
        chunk.byteDigest !== entry.byteDigest ||
        chunk.size !== entry.size ||
        typeof chunk.bytes !== "string"
      ) {
        fail(
          WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
          "benchmark report chunk binding is invalid",
        );
      }
      const bytes = Buffer.from(chunk.bytes, "base64");
      if (bytes.length !== entry.size || sha(bytes) !== entry.byteDigest)
        fail(
          WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
          "benchmark report chunk bytes are corrupt",
        );
      return bytes;
    });
    const reportBytes = Buffer.concat(buffers);
    if (
      reportBytes.length !== manifest.reportBytes ||
      sha(reportBytes) !== manifest.reportBytesDigest
    ) {
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark report byte manifest is corrupt",
      );
    }
    let report;
    try {
      report = JSON.parse(reportBytes.toString("utf8"));
    } catch (cause) {
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark report is not JSON",
        cause,
      );
    }
    const envelope = await this._verifyEnvelope(plan, {
      schema: manifest.envelopeSchema,
      report,
      attestation: manifest.attestation,
    });
    if (envelope.report.reportDigest !== manifest.reportDigest)
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark report differs from its manifest",
      );
    return Object.freeze({
      plan,
      executionManifest,
      envelope,
      effectiveAt: manifest.effectiveAt,
      manifestDigest: manifest.manifestDigest,
    });
  }

  async commit({
    plan: planInput,
    executionManifest: executionManifestInput,
    envelope: envelopeInput,
    effectiveAt,
  } = {}) {
    const plan = verifyWikiSkillBenchmarkPlan(planInput);
    const executionManifest = verifyWikiSkillBenchmarkExecutionManifest(
      executionManifestInput,
    );
    verifyWikiSkillBenchmarkExecutionBinding({ plan, executionManifest });
    const envelope = await this._verifyEnvelope(plan, envelopeInput);
    const timestamp = new Date(effectiveAt).toISOString();
    const existing = await this.load(envelope.report.reportDigest);
    if (existing) {
      if (
        existing.plan.planDigest === plan.planDigest &&
        existing.executionManifest.manifestDigest ===
          executionManifest.manifestDigest &&
        canonical(existing.envelope) === canonical(envelope)
      ) {
        return Object.freeze({
          committed: true,
          recovered: true,
          reportDigest: envelope.report.reportDigest,
          manifestDigest: existing.manifestDigest,
        });
      }
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CONFLICT_CODE,
        "benchmark report digest is already bound to another envelope",
      );
    }
    const reportBytes = Buffer.from(JSON.stringify(envelope.report), "utf8");
    if (reportBytes.length < 1 || reportBytes.length > MAX_REPORT_BYTES)
      throw new TypeError("benchmark report is outside its size bound");
    const planRef = publish(
      this._put,
      "wikiskill-benchmark-plan",
      plan,
      this.descriptor,
    );
    const executionManifestRef = publish(
      this._put,
      "wikiskill-benchmark-execution-manifest",
      executionManifest,
      this.descriptor,
    );
    const count = Math.ceil(reportBytes.length / REPORT_CHUNK_BYTES);
    const chunks = [];
    for (let index = 0; index < count; index += 1) {
      const bytes = reportBytes.subarray(
        index * REPORT_CHUNK_BYTES,
        Math.min((index + 1) * REPORT_CHUNK_BYTES, reportBytes.length),
      );
      const byteDigest = sha(bytes);
      const ref = publish(
        this._put,
        "wikiskill-benchmark-report-chunk",
        {
          schema: WIKISKILL_BENCHMARK_REPORT_CHUNK_SCHEMA,
          reportDigest: envelope.report.reportDigest,
          index,
          count,
          encoding: "base64",
          size: bytes.length,
          byteDigest,
          bytes: bytes.toString("base64"),
        },
        this.descriptor,
      );
      chunks.push({ index, size: bytes.length, byteDigest, ref });
    }
    const core = {
      schema: WIKISKILL_BENCHMARK_BUNDLE_SCHEMA,
      tenantId: this.descriptor.tenantId,
      skillName: this.descriptor.skillName,
      planDigest: plan.planDigest,
      executionManifestDigest: executionManifest.manifestDigest,
      reportDigest: envelope.report.reportDigest,
      planRef,
      executionManifestRef,
      chunks,
      reportBytes: reportBytes.length,
      reportBytesDigest: sha(reportBytes),
      envelopeSchema: envelope.schema,
      attestation: envelope.attestation,
      effectiveAt: timestamp,
    };
    const manifest = Object.freeze({
      ...core,
      manifestDigest: domainDigest(WIKISKILL_BENCHMARK_BUNDLE_SCHEMA, core),
    });
    const manifestRef = publish(
      this._put,
      "wikiskill-benchmark-envelope-manifest",
      manifest,
      this.descriptor,
    );
    const head = this._verifyLedger();
    const eventId = `wikiskill-benchmark.${manifest.manifestDigest.slice(7)}`;
    let appendError = null;
    let receipt = null;
    try {
      receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: envelope.report.reportDigest,
          decision: "committed",
          eventId,
          reason: "Signed WikiSkill benchmark bundle committed",
          skillName: this.descriptor.skillName,
          sourceRefs: [planRef, executionManifestRef],
          subjectRef: manifestRef,
          tenantId: this.descriptor.tenantId,
          timestamp,
          type: WIKISKILL_BENCHMARK_LEDGER_EVENT,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
    } catch (cause) {
      appendError = cause;
    }
    const stored = await this.load(envelope.report.reportDigest);
    if (stored?.manifestDigest !== manifest.manifestDigest)
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark ledger commit could not be recovered",
        appendError,
      );
    if (
      !appendError &&
      (receipt?.authenticated !== true ||
        receipt.committed !== true ||
        receipt.durable !== true ||
        receipt.eventId !== eventId ||
        !DIGEST.test(receipt.receiptDigest ?? ""))
    ) {
      fail(
        WIKISKILL_BENCHMARK_LEDGER_CORRUPT_CODE,
        "benchmark ledger append was not durably confirmed",
      );
    }
    return Object.freeze({
      committed: true,
      recovered: Boolean(appendError),
      reportDigest: envelope.report.reportDigest,
      manifestDigest: manifest.manifestDigest,
      ledgerReceiptDigest: receipt?.receiptDigest ?? null,
    });
  }
}

export function createWikiSkillBenchmarkLedgerAdapter(options) {
  return new WikiSkillBenchmarkLedgerAdapter(options);
}
