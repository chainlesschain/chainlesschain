import { createHash } from "node:crypto";
import { ArtifactStore, publicArtifactMetadata } from "./artifact-store.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

export const EXECUTION_LOCATION_RESULT_ARTIFACT_IMPORT_SCHEMA =
  "cc-execution-location-result-artifact-import/v1";
export const EXECUTION_LOCATION_RESULT_ARTIFACT_LINEAGE_SCHEMA =
  "cc-execution-location-result-artifact-lineage/v1";

const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const AUTHORITY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationResultArtifact"), "utf8")
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

function normalizeLineage(input) {
  const value = exactObject(
    input,
    [
      "schema",
      "sessionId",
      "requestId",
      "reviewDigest",
      "item",
      "kind",
      "mediaType",
      "byteLength",
      "sourceDigest",
    ],
    "execution-location result artifact lineage",
  );
  const sessionId = String(value.sessionId || "");
  const requestId = String(value.requestId || "");
  const reviewDigest = String(value.reviewDigest || "");
  const item = String(value.item || "");
  const kind = String(value.kind || "");
  const mediaType = String(value.mediaType || "");
  const sourceDigest = String(value.sourceDigest || "");
  const byteLength = Number(value.byteLength);
  const selectorMatches =
    (kind === "summary" && item === "summary") ||
    (kind === "diff" && item === "diff") ||
    ((kind === "artifact" || kind === "evidence") &&
      item === `${kind}:${sourceDigest}`);
  if (
    value.schema !== EXECUTION_LOCATION_RESULT_ARTIFACT_LINEAGE_SCHEMA ||
    !AUTHORITY_ID_RE.test(sessionId) ||
    !AUTHORITY_ID_RE.test(requestId) ||
    !SHA256_RE.test(reviewDigest) ||
    !SHA256_RE.test(sourceDigest) ||
    !selectorMatches ||
    mediaType.length < 1 ||
    mediaType.length > 256 ||
    Array.from(mediaType).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    }) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    throw new TypeError(
      "execution-location result artifact lineage is invalid",
    );
  }
  return Object.freeze({
    schema: value.schema,
    sessionId,
    requestId,
    reviewDigest,
    item,
    kind,
    mediaType,
    byteLength,
    sourceDigest,
  });
}

function artifactKind(kind) {
  if (kind === "summary") return "report";
  if (kind === "diff") return "patch";
  if (kind === "evidence") return "data";
  return "other";
}

function extensionFor(lineage) {
  if (lineage.kind === "diff") return ".patch";
  const exact = {
    "application/json": ".json",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "text/csv": ".csv",
    "text/html": ".html",
    "text/markdown": ".md",
    "text/plain": ".txt",
  };
  return exact[lineage.mediaType.toLowerCase()] || ".bin";
}

function expectedArtifactMetadata(lineage, importDigest) {
  const suffix = importDigest.slice("sha256:".length, "sha256:".length + 16);
  return Object.freeze({
    title: `Returned ${lineage.kind} ${suffix}`,
    kind: artifactKind(lineage.kind),
    mime: lineage.mediaType,
    size: lineage.byteLength,
    sha256: lineage.sourceDigest.slice("sha256:".length),
    sessionId: lineage.sessionId,
    immutable: true,
    recordDigest: importDigest,
    fileName: `execution-result-${lineage.kind}-${suffix}${extensionFor(lineage)}`,
  });
}

function createReceipt(entry, lineage, importDigest) {
  const metadata = publicArtifactMetadata(entry);
  const artifact = { ...metadata };
  delete artifact.lineage;
  const material = {
    schema: EXECUTION_LOCATION_RESULT_ARTIFACT_IMPORT_SCHEMA,
    importDigest,
    source: lineage,
    artifact,
    retention: "artifact-store-ttl-explicit-delete-not-worm",
  };
  return Object.freeze({
    ...material,
    receiptDigest: digest(
      "chainlesschain.execution-location.result-artifact-import-receipt.v1\0",
      material,
    ),
  });
}

export function readExecutionLocationResultArtifactImport(
  importDigestInput,
  options = {},
) {
  const importDigest = String(importDigestInput || "");
  if (!SHA256_RE.test(importDigest)) {
    throw new TypeError(
      "execution-location result artifact import digest is invalid",
    );
  }
  const store = options.artifactStore || new ArtifactStore();
  const matches = store
    .list()
    .filter((entry) => entry.recordDigest === importDigest);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "execution-location result artifact import was not found"
        : "execution-location result artifact import is ambiguous",
    );
  }
  const entry = matches[0];
  const lineage = normalizeLineage(entry.lineage);
  const expectedImportDigest = digest(
    "chainlesschain.execution-location.result-artifact-import.v1\0",
    lineage,
  );
  const expected = expectedArtifactMetadata(lineage, expectedImportDigest);
  const integrity = store.verifyIntegrity(entry);
  if (
    expectedImportDigest !== importDigest ||
    entry.title !== expected.title ||
    entry.kind !== expected.kind ||
    entry.mime !== expected.mime ||
    entry.size !== expected.size ||
    entry.sha256 !== expected.sha256 ||
    entry.sessionId !== expected.sessionId ||
    entry.immutable !== true ||
    entry.recordDigest !== expected.recordDigest ||
    integrity.ok !== true ||
    integrity.actualSha256 !== expected.sha256
  ) {
    throw new Error(
      "execution-location result ArtifactStore readback does not match import authority",
    );
  }
  return Object.freeze({
    receipt: createReceipt(entry, lineage, importDigest),
    entry,
    integrity: Object.freeze({ ...integrity }),
  });
}

export function importExecutionLocationResultArtifact(preview, options = {}) {
  const bytes = Buffer.isBuffer(preview?.bytes)
    ? Buffer.from(preview.bytes)
    : null;
  const lineage = normalizeLineage({
    schema: EXECUTION_LOCATION_RESULT_ARTIFACT_LINEAGE_SCHEMA,
    sessionId: preview?.sessionId,
    requestId: preview?.requestId,
    reviewDigest: preview?.reviewDigest,
    item: preview?.item,
    kind: preview?.kind,
    mediaType: preview?.mediaType,
    byteLength: preview?.byteLength,
    sourceDigest: preview?.digest,
  });
  if (
    bytes === null ||
    bytes.byteLength !== lineage.byteLength ||
    bytesDigest(bytes) !== lineage.sourceDigest
  ) {
    throw new Error(
      "execution-location result content does not match import authority",
    );
  }
  const importDigest = digest(
    "chainlesschain.execution-location.result-artifact-import.v1\0",
    lineage,
  );
  const expected = expectedArtifactMetadata(lineage, importDigest);
  const store = options.artifactStore || new ArtifactStore();
  if (typeof store.publishDataOnce !== "function") {
    throw new Error("ArtifactStore idempotent import is unavailable");
  }
  const publication = store.publishDataOnce({
    data: bytes,
    fileName: expected.fileName,
    title: expected.title,
    kind: expected.kind,
    mime: expected.mime,
    sessionId: expected.sessionId,
    immutable: true,
    recordDigest: importDigest,
    lineage,
  });
  const readback = readExecutionLocationResultArtifactImport(importDigest, {
    artifactStore: store,
  });
  if (
    canonicalJson(readback.entry.lineage, "resultArtifactStoredLineage") !==
    canonicalJson(lineage, "resultArtifactExpectedLineage")
  ) {
    throw new Error(
      "execution-location result ArtifactStore lineage does not match reviewed item",
    );
  }
  return Object.freeze({
    ...readback.receipt,
    imported: publication.published === true,
  });
}
