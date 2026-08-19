import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

export const EXECUTION_LOCATION_RESULT_BUNDLE_SCHEMA =
  "cc-execution-location-result-bundle/v1";
export const EXECUTION_LOCATION_RESULT_VERIFICATION_SCHEMA =
  "cc-execution-location-result-verification/v1";
export const MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES = 24 * 1024 * 1024;

const MAX_RESULT_CONTENT_BYTES = 16 * 1024 * 1024;
const MAX_SUMMARY_BYTES = 256 * 1024;
const MAX_DIFF_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_ITEMS = 64;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const HEAD_RE = /^[a-f0-9]{64}$/u;
const RESULT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const AUTHORITY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const MEDIA_TYPE_RE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationResult"), "utf8")
    .digest("hex")}`;
}

function bytesDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} has an invalid schema`);
  }
  return value;
}

function safeResultId(value) {
  const resultId = String(value || "");
  if (!RESULT_ID_RE.test(resultId)) {
    throw new TypeError("execution location result id is invalid");
  }
  return resultId;
}

function safeMediaType(value, label) {
  const mediaType = String(value || "").toLowerCase();
  if (!MEDIA_TYPE_RE.test(mediaType)) {
    throw new TypeError(`${label} media type is invalid`);
  }
  return mediaType;
}

function normalizePositiveEventCount(value, label) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new TypeError(`${label} event count is invalid`);
  }
  return count;
}

function normalizeSessionAuthority(authority) {
  if (
    authority?.authority !== "verified-session-location-handoff" ||
    !AUTHORITY_ID_RE.test(String(authority.sessionId || "")) ||
    !HEAD_RE.test(String(authority.headHash || "")) ||
    !HEAD_RE.test(String(authority.bindingEventHash || "")) ||
    !SHA256_RE.test(String(authority.locationHandoff?.handoffId || "")) ||
    !HEAD_RE.test(String(authority.locationHandoff?.source?.headHash || "")) ||
    !SHA256_RE.test(
      String(authority.locationHandoff?.source?.transcriptDigest || ""),
    ) ||
    !SHA256_RE.test(
      String(authority.locationHandoff?.target?.profileDigest || ""),
    ) ||
    !SHA256_RE.test(
      String(authority.locationHandoff?.target?.targetFactsDigest || ""),
    ) ||
    !SHA256_RE.test(
      String(authority.locationHandoff?.target?.attestationDigest || ""),
    )
  ) {
    throw new TypeError(
      "execution location result requires a verified location-handoff session",
    );
  }
  const targetEventCount = normalizePositiveEventCount(
    authority.eventCount,
    "target session",
  );
  const bindingEventCount = normalizePositiveEventCount(
    authority.bindingEventCount,
    "target binding",
  );
  const sourceEventCount = normalizePositiveEventCount(
    authority.locationHandoff.source.eventCount,
    "source session",
  );
  if (
    authority.locationHandoff.source.sessionId !== authority.sessionId ||
    authority.bindingEventHash !== authority.locationHandoff.eventHash ||
    authority.bindingEventCount !== authority.locationHandoff.eventCount ||
    bindingEventCount !== sourceEventCount + 1 ||
    targetEventCount < bindingEventCount
  ) {
    throw new TypeError(
      "execution location result handoff authority is inconsistent",
    );
  }
  return {
    sessionId: authority.sessionId,
    handoffId: authority.locationHandoff.handoffId,
    source: {
      headHash: authority.locationHandoff.source.headHash,
      eventCount: sourceEventCount,
      transcriptDigest: authority.locationHandoff.source.transcriptDigest,
    },
    target: {
      headHash: authority.headHash,
      eventCount: targetEventCount,
      bindingEventHash: authority.bindingEventHash,
      bindingEventCount,
      profileDigest: authority.locationHandoff.target.profileDigest,
      targetEvidenceId: String(
        authority.locationHandoff.target.targetEvidenceId || "",
      ),
      targetFactsDigest: authority.locationHandoff.target.targetFactsDigest,
      attestationDigest: authority.locationHandoff.target.attestationDigest,
    },
  };
}

function contentRecord(bytesInput, mediaType, label, maxBytes) {
  const bytes = Buffer.isBuffer(bytesInput)
    ? Buffer.from(bytesInput)
    : Buffer.from(bytesInput || "");
  if (bytes.length > maxBytes) {
    throw new TypeError(`${label} exceeds ${maxBytes} bytes`);
  }
  return {
    mediaType: safeMediaType(mediaType, label),
    byteLength: bytes.length,
    digest: bytesDigest(bytes),
    contentBase64: bytes.toString("base64"),
  };
}

function assertStrictUtf8Content(record, label) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(record.contentBase64, "base64"),
    );
  } catch {
    throw new TypeError(`${label} must contain strict UTF-8`);
  }
}

function normalizeContentRecord(value, label, maxBytes) {
  const input = exactObject(
    value,
    ["mediaType", "byteLength", "digest", "contentBase64"],
    label,
  );
  if (
    typeof input.contentBase64 !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      input.contentBase64,
    )
  ) {
    throw new TypeError(`${label} base64 is invalid`);
  }
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (
    bytes.toString("base64") !== input.contentBase64 ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength !== bytes.length ||
    bytes.length > maxBytes ||
    input.digest !== bytesDigest(bytes)
  ) {
    throw new TypeError(`${label} bytes or digest are invalid`);
  }
  return contentRecord(bytes, input.mediaType, label, maxBytes);
}

function normalizeItemList(value, label) {
  if (!Array.isArray(value) || value.length > MAX_RESULT_ITEMS) {
    throw new TypeError(`${label} list is invalid`);
  }
  const items = value
    .map((entry, index) =>
      normalizeContentRecord(
        entry,
        `${label} ${index}`,
        MAX_RESULT_CONTENT_BYTES,
      ),
    )
    .sort((left, right) =>
      canonicalJson(left, "executionLocationResultItem").localeCompare(
        canonicalJson(right, "executionLocationResultItem"),
      ),
    );
  if (
    new Set(items.map((entry) => `${entry.mediaType}\0${entry.digest}`)).size !==
    items.length
  ) {
    throw new TypeError(`${label} contains duplicate content`);
  }
  return items;
}

function normalizeBundleSession(value) {
  const input = exactObject(
    value,
    ["sessionId", "handoffId", "source", "target"],
    "execution location result session",
  );
  const source = exactObject(
    input.source,
    ["headHash", "eventCount", "transcriptDigest"],
    "execution location result source",
  );
  const target = exactObject(
    input.target,
    [
      "headHash",
      "eventCount",
      "bindingEventHash",
      "bindingEventCount",
      "profileDigest",
      "targetEvidenceId",
      "targetFactsDigest",
      "attestationDigest",
    ],
    "execution location result target",
  );
  const normalized = {
    sessionId: String(input.sessionId || ""),
    handoffId: String(input.handoffId || ""),
    source: {
      headHash: String(source.headHash || ""),
      eventCount: normalizePositiveEventCount(source.eventCount, "source"),
      transcriptDigest: String(source.transcriptDigest || ""),
    },
    target: {
      headHash: String(target.headHash || ""),
      eventCount: normalizePositiveEventCount(target.eventCount, "target"),
      bindingEventHash: String(target.bindingEventHash || ""),
      bindingEventCount: normalizePositiveEventCount(
        target.bindingEventCount,
        "target binding",
      ),
      profileDigest: String(target.profileDigest || ""),
      targetEvidenceId: String(target.targetEvidenceId || ""),
      targetFactsDigest: String(target.targetFactsDigest || ""),
      attestationDigest: String(target.attestationDigest || ""),
    },
  };
  if (
    !AUTHORITY_ID_RE.test(normalized.sessionId) ||
    !SHA256_RE.test(normalized.handoffId) ||
    !HEAD_RE.test(normalized.source.headHash) ||
    !SHA256_RE.test(normalized.source.transcriptDigest) ||
    !HEAD_RE.test(normalized.target.headHash) ||
    !HEAD_RE.test(normalized.target.bindingEventHash) ||
    !SHA256_RE.test(normalized.target.profileDigest) ||
    !AUTHORITY_ID_RE.test(normalized.target.targetEvidenceId) ||
    !SHA256_RE.test(normalized.target.targetFactsDigest) ||
    !SHA256_RE.test(normalized.target.attestationDigest) ||
    normalized.target.bindingEventCount !==
      normalized.source.eventCount + 1 ||
    normalized.target.eventCount < normalized.target.bindingEventCount
  ) {
    throw new TypeError("execution location result session is invalid");
  }
  return normalized;
}

export function createExecutionLocationResultBundle(input = {}) {
  const session = normalizeSessionAuthority(input.sessionAuthority);
  const summary = contentRecord(
    input.summaryBytes,
    "text/plain",
    "execution location result summary",
    MAX_SUMMARY_BYTES,
  );
  if (summary.byteLength === 0) {
    throw new TypeError("execution location result summary is empty");
  }
  assertStrictUtf8Content(summary, "execution location result summary");
  const diff = contentRecord(
    input.diffBytes,
    "text/x-diff",
    "execution location result diff",
    MAX_DIFF_BYTES,
  );
  const normalizeInputItems = (items, label) => {
    if (!Array.isArray(items) || items.length > MAX_RESULT_ITEMS) {
      throw new TypeError(`${label} list is invalid`);
    }
    return items
      .map((entry, index) =>
        contentRecord(
          entry?.bytes,
          entry?.mediaType,
          `${label} ${index}`,
          MAX_RESULT_CONTENT_BYTES,
        ),
      )
      .sort((left, right) =>
        canonicalJson(left, "executionLocationResultItem").localeCompare(
          canonicalJson(right, "executionLocationResultItem"),
        ),
      );
  };
  const artifacts = normalizeInputItems(input.artifacts || [], "artifact");
  const evidence = normalizeInputItems(input.evidence || [], "evidence");
  const contentIdentities = [...artifacts, ...evidence].map(
    (entry) => `${entry.mediaType}\0${entry.digest}`,
  );
  if (artifacts.length + evidence.length > MAX_RESULT_ITEMS) {
    throw new TypeError("execution location result item count is invalid");
  }
  if (new Set(contentIdentities).size !== contentIdentities.length) {
    throw new TypeError("execution location result contains duplicate content");
  }
  const totalBytes = [summary, diff, ...artifacts, ...evidence].reduce(
    (total, entry) => total + entry.byteLength,
    0,
  );
  if (totalBytes > MAX_RESULT_CONTENT_BYTES) {
    throw new TypeError(
      `execution location result content exceeds ${MAX_RESULT_CONTENT_BYTES} bytes`,
    );
  }
  const material = {
    schema: EXECUTION_LOCATION_RESULT_BUNDLE_SCHEMA,
    resultId: safeResultId(input.resultId),
    session,
    summary,
    diff,
    artifacts,
    evidence,
    totalBytes,
  };
  return Object.freeze({
    ...material,
    bundleDigest: digest(
      "chainlesschain.execution-location.result-bundle.v1\0",
      material,
    ),
  });
}

export function normalizeExecutionLocationResultBundle(value) {
  const input = exactObject(
    value,
    [
      "schema",
      "resultId",
      "session",
      "summary",
      "diff",
      "artifacts",
      "evidence",
      "totalBytes",
      "bundleDigest",
    ],
    "execution location result bundle",
  );
  if (input.schema !== EXECUTION_LOCATION_RESULT_BUNDLE_SCHEMA) {
    throw new TypeError("execution location result bundle schema is invalid");
  }
  const material = {
    schema: EXECUTION_LOCATION_RESULT_BUNDLE_SCHEMA,
    resultId: safeResultId(input.resultId),
    session: normalizeBundleSession(input.session),
    summary: normalizeContentRecord(
      input.summary,
      "execution location result summary",
      MAX_SUMMARY_BYTES,
    ),
    diff: normalizeContentRecord(
      input.diff,
      "execution location result diff",
      MAX_DIFF_BYTES,
    ),
    artifacts: normalizeItemList(input.artifacts, "artifact"),
    evidence: normalizeItemList(input.evidence, "evidence"),
    totalBytes: Number(input.totalBytes),
  };
  if (material.summary.byteLength === 0) {
    throw new TypeError("execution location result summary is empty");
  }
  if (
    material.summary.mediaType !== "text/plain" ||
    material.diff.mediaType !== "text/x-diff"
  ) {
    throw new TypeError("execution location result core media type is invalid");
  }
  assertStrictUtf8Content(
    material.summary,
    "execution location result summary",
  );
  const contentIdentities = [
    ...material.artifacts,
    ...material.evidence,
  ].map((entry) => `${entry.mediaType}\0${entry.digest}`);
  const calculatedBytes = [
    material.summary,
    material.diff,
    ...material.artifacts,
    ...material.evidence,
  ].reduce((total, entry) => total + entry.byteLength, 0);
  if (
    material.artifacts.length + material.evidence.length > MAX_RESULT_ITEMS ||
    new Set(contentIdentities).size !== contentIdentities.length ||
    !Number.isSafeInteger(material.totalBytes) ||
    material.totalBytes !== calculatedBytes ||
    material.totalBytes > MAX_RESULT_CONTENT_BYTES
  ) {
    throw new TypeError("execution location result total bytes are invalid");
  }
  const bundleDigest = digest(
    "chainlesschain.execution-location.result-bundle.v1\0",
    material,
  );
  if (input.bundleDigest !== bundleDigest) {
    throw new TypeError("execution location result bundle digest is invalid");
  }
  return { ...material, bundleDigest };
}

export function verifyExecutionLocationResultBundle(input = {}) {
  const bundle = normalizeExecutionLocationResultBundle(input.bundle);
  const source = input.sourceAuthority;
  const expectedHandoffId = String(input.expectedHandoffId || "");
  if (
    source?.sessionId !== bundle.session.sessionId ||
    source?.headHash !== bundle.session.source.headHash ||
    source?.eventCount !== bundle.session.source.eventCount ||
    !SHA256_RE.test(expectedHandoffId) ||
    expectedHandoffId !== bundle.session.handoffId
  ) {
    throw new Error(
      "execution location result source authority or handoff changed",
    );
  }
  const material = {
    schema: EXECUTION_LOCATION_RESULT_VERIFICATION_SCHEMA,
    resultId: bundle.resultId,
    sessionId: bundle.session.sessionId,
    handoffId: bundle.session.handoffId,
    sourceHeadHash: bundle.session.source.headHash,
    sourceEventCount: bundle.session.source.eventCount,
    targetHeadHash: bundle.session.target.headHash,
    targetEventCount: bundle.session.target.eventCount,
    bundleDigest: bundle.bundleDigest,
    summary: {
      byteLength: bundle.summary.byteLength,
      digest: bundle.summary.digest,
    },
    diff: {
      byteLength: bundle.diff.byteLength,
      digest: bundle.diff.digest,
    },
    artifacts: bundle.artifacts.map(({ mediaType, byteLength, digest }) => ({
      mediaType,
      byteLength,
      digest,
    })),
    evidence: bundle.evidence.map(({ mediaType, byteLength, digest }) => ({
      mediaType,
      byteLength,
      digest,
    })),
    totalBytes: bundle.totalBytes,
    applied: false,
  };
  return Object.freeze({
    ...material,
    verificationDigest: digest(
      "chainlesschain.execution-location.result-verification.v1\0",
      material,
    ),
  });
}

function assertWithinBoundary(filePath, boundaryRoot, label) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(boundaryRoot);
  const relative = path.relative(root, resolved);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return resolved;
  }
  throw new Error(`${label} escapes the execution location data boundary`);
}

export function readExecutionLocationResultFile(
  filePath,
  {
    boundaryRoot,
    maxBytes = MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES,
    allowEmpty = false,
    fs: runtimeFs = fs,
    withTrustedFileParentSync: trustedParent = withTrustedFileParentSync,
    samePathHandleFileIdentity: samePathHandle = samePathHandleFileIdentity,
    sameFileStatIdentity: sameStat = sameFileStatIdentity,
    runtime,
  } = {},
) {
  if (!boundaryRoot) {
    throw new Error("execution location result data boundary is required");
  }
  const resolved = assertWithinBoundary(
    filePath,
    boundaryRoot,
    "execution location result file",
  );
  return trustedParent(
    runtimeFs,
    resolved,
    ({ canonicalPath, parentDevice }) => {
      const before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        Number(before.nlink) !== 1
      ) {
        throw new Error(
          "execution location result file must be regular and single-link",
        );
      }
      const size = Number(before.size);
      if ((!allowEmpty && size === 0) || size < 0 || size > maxBytes) {
        throw new Error(
          `execution location result file must be ${allowEmpty ? "0" : "1"}..${maxBytes} bytes`,
        );
      }
      let descriptor = null;
      try {
        descriptor = runtimeFs.openSync(
          canonicalPath,
          runtimeFs.constants.O_RDONLY |
            Number(runtimeFs.constants.O_NOFOLLOW || 0),
        );
        const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandle(before, opened, parentDevice, runtime)
        ) {
          throw new Error(
            "execution location result file identity changed while opening",
          );
        }
        const output = Buffer.allocUnsafe(size);
        let offset = 0;
        while (offset < size) {
          const count = runtimeFs.readSync(
            descriptor,
            output,
            offset,
            size - offset,
            null,
          );
          if (count === 0) break;
          offset += count;
        }
        const after = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (offset !== size || !sameStat(opened, after)) {
          throw new Error(
            "execution location result file changed while being read",
          );
        }
        return output;
      } finally {
        if (descriptor !== null) runtimeFs.closeSync(descriptor);
      }
    },
    { runtime },
  );
}

export function readExecutionLocationResultBundle(filePath, options = {}) {
  const bytes = readExecutionLocationResultFile(filePath, options);
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(
      `execution location result bundle is not strict JSON: ${error.message}`,
    );
  }
  return normalizeExecutionLocationResultBundle(value);
}
