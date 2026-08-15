/**
 * Truthful, local readback of marketplace artifact expectations.
 *
 * Registry metadata remains an unverified assertion. This projection compares
 * only fields whose semantics are exact: manifest bytes, manifest license,
 * the cryptographically verified signing key, and the repository-defined
 * payload SBOM format. External SBOM documents are not fetched and therefore
 * remain explicitly non-comparable here.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parsePluginManifest } from "./manifest.js";
import {
  LOCK_FILENAME,
  readPluginLock,
  verifyInstalledSignature,
} from "./signature.js";

export const PLUGIN_MARKETPLACE_ARTIFACT_READBACK_SCHEMA =
  "cc-plugin-marketplace-artifact-readback/v1";
export const PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA =
  "cc-plugin-marketplace-payload-sbom/v1";
export const MAX_MARKETPLACE_READBACK_FILES = 10_000;
export const MAX_MARKETPLACE_READBACK_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_MARKETPLACE_READBACK_TOTAL_BYTES = 1024 * 1024 * 1024;

const SOURCE_METADATA_FILENAME = ".plugin-source.json";
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMPARABLE_SBOM_FORMATS = new Set([
  "cc-plugin-marketplace-payload-sbom/v1",
  "cc-plugin-payload-sbom/v1",
]);

export function buildPluginMarketplaceArtifactReadback({
  root,
  scope = null,
  source = null,
  observedAt = new Date().toISOString(),
} = {}) {
  const resolvedRoot = path.resolve(String(root || ""));
  if (!root || !fs.existsSync(resolvedRoot)) {
    throw new Error("marketplace artifact readback root does not exist");
  }
  const manifest = parsePluginManifest(resolvedRoot);
  if (!manifest.ok || !manifest.manifestPath) {
    throw new Error(
      `marketplace artifact readback manifest is invalid: ${manifest.errors.join("; ")}`,
    );
  }
  const manifestBytes = fs.readFileSync(manifest.manifestPath);
  const manifestSha256 = sha256(manifestBytes);
  const signature = verifyInstalledSignature({ root: resolvedRoot });
  const lock = readPluginLock(resolvedRoot);
  const payloadSbom = buildMarketplacePayloadSbom(resolvedRoot);
  const expectations = normalizeExpectations(
    source?.catalogAuthority?.artifactExpectations,
  );
  const actual = {
    manifest: {
      relativePath: path
        .relative(resolvedRoot, manifest.manifestPath)
        .replace(/\\/g, "/"),
      sha256: manifestSha256,
    },
    license: {
      expression: manifest.metadata.license || null,
      authority: "installed-plugin-manifest",
    },
    signature: {
      present: Boolean(lock?.signatureBase64 && lock?.publicKeyPem),
      verified: signature.signed === true,
      algorithm: signature.signed ? "ed25519" : null,
      publicKeySha256: signature.publicKeySha256 || null,
      reason: signature.signed ? null : signature.reason || "unsigned",
    },
    signatureBoundComponentSbom: {
      present: Boolean(lock?.sbom),
      digest: cleanDigest(lock?.sbom?.digest),
      verified:
        signature.signed === true &&
        Boolean(lock?.sbom) &&
        cleanDigest(lock?.sbom?.digest) != null,
    },
    payloadSbom,
  };
  const comparisons = {
    manifest: compareScalarExpectation(
      expectations.manifest.status,
      expectations.manifest.sha256,
      actual.manifest.sha256,
    ),
    license: compareScalarExpectation(
      expectations.license.status,
      expectations.license.expression,
      actual.license.expression,
    ),
    signature: compareSignature(expectations.signature, actual.signature),
    sbom: compareSbom(expectations.sbom, actual.payloadSbom),
  };
  const blockers = [];
  if (comparisons.manifest.status === "mismatch") {
    blockers.push(issue("MANIFEST_DIGEST_MISMATCH"));
  }
  if (comparisons.license.status === "mismatch") {
    blockers.push(issue("LICENSE_MISMATCH"));
  }
  if (comparisons.signature.status === "mismatch") {
    blockers.push(
      issue("SIGNATURE_NOT_VERIFIED", actual.signature.reason || null),
    );
  }
  if (comparisons.sbom.status === "mismatch") {
    blockers.push(issue("PAYLOAD_SBOM_DIGEST_MISMATCH"));
  }
  const comparisonStatuses = Object.values(comparisons).map(
    (comparison) => comparison.status,
  );
  const status = blockers.length
    ? "failed"
    : comparisonStatuses.every((candidate) => candidate === "matched")
      ? "matched"
      : "partial";
  const authority = {
    schemaVersion: PLUGIN_MARKETPLACE_ARTIFACT_READBACK_SCHEMA,
    plugin: {
      name: manifest.metadata.name,
      version: manifest.metadata.version,
      scope: clean(scope, 32),
    },
    catalogAuthority: normalizeCatalogAuthority(source?.catalogAuthority),
    expectations,
    actual,
    comparisons,
    blockers,
  };
  return {
    schemaVersion: PLUGIN_MARKETPLACE_ARTIFACT_READBACK_SCHEMA,
    observedAt,
    evidenceDigest: sha256Canonical(authority),
    status,
    ...authority,
    claims: {
      registryPublisherIdentityVerified: false,
      remoteSignatureFetched: false,
      remoteSbomFetched: false,
      manifestBytesReadFromImmutableInstall: true,
      licenseReadFromInstalledManifest: true,
      signatureCryptographicallyReverified: actual.signature.verified,
      payloadSbomComputedFromImmutableInstall: true,
      externalSbomDigestComparable: comparisons.sbom.comparable,
    },
  };
}

export function buildMarketplacePayloadSbom(root) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  let totalBytes = 0;
  const walk = (dir) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => stableCompare(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path
        .relative(resolvedRoot, absolute)
        .replace(/\\/g, "/");
      if (relative === LOCK_FILENAME || relative === SOURCE_METADATA_FILENAME) {
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_MARKETPLACE_READBACK_FILES) {
        throw new Error(
          `marketplace artifact readback exceeds ${MAX_MARKETPLACE_READBACK_FILES} files`,
        );
      }
      const stat = fs.statSync(absolute);
      if (stat.size > MAX_MARKETPLACE_READBACK_FILE_BYTES) {
        throw new Error(
          `marketplace artifact readback file exceeds ${MAX_MARKETPLACE_READBACK_FILE_BYTES} bytes: ${relative}`,
        );
      }
      totalBytes += stat.size;
      if (totalBytes > MAX_MARKETPLACE_READBACK_TOTAL_BYTES) {
        throw new Error(
          `marketplace artifact readback exceeds ${MAX_MARKETPLACE_READBACK_TOTAL_BYTES} total bytes`,
        );
      }
      const bytes = fs.readFileSync(absolute);
      files.push({
        path: relative,
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
  };
  walk(resolvedRoot);
  files.sort((a, b) => stableCompare(a.path, b.path));
  return {
    schemaVersion: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
    digest: sha256(
      files
        .map((file) => `${file.path}\0${file.sha256}\0${file.bytes}\n`)
        .join(""),
    ),
    fileCount: files.length,
    totalBytes,
    files,
    exclusions: [LOCK_FILENAME, SOURCE_METADATA_FILENAME],
  };
}

function normalizeExpectations(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    manifest: {
      status: expectationStatus(raw.manifest?.status),
      sha256: cleanDigest(raw.manifest?.sha256),
    },
    signature: {
      status: expectationStatus(raw.signature?.status),
      algorithm: clean(raw.signature?.algorithm, 64),
      publicKeySha256: cleanDigest(raw.signature?.publicKeySha256),
    },
    sbom: {
      status: expectationStatus(raw.sbom?.status),
      format: clean(raw.sbom?.format, 128),
      sha256: cleanDigest(raw.sbom?.sha256),
    },
    license: {
      status: expectationStatus(raw.license?.status),
      expression: clean(raw.license?.expression, 256),
    },
  };
}

function normalizeCatalogAuthority(value) {
  if (!value || typeof value !== "object") return null;
  return {
    catalogDigest: cleanDigest(value.catalogDigest),
    candidateId: clean(value.candidateId, 64),
    candidateDigest: cleanDigest(value.candidateDigest),
    selectionDigest: cleanDigest(value.selectionDigest),
    updateImpactDigest: cleanDigest(value.updateImpactDigest),
  };
}

function compareScalarExpectation(status, expected, actual) {
  if (status !== "declared") {
    return { status: "not-declared", comparable: false, expected, actual };
  }
  if (expected == null) {
    return { status: "unbound", comparable: false, expected, actual };
  }
  return {
    status: expected === actual ? "matched" : "mismatch",
    comparable: true,
    expected,
    actual,
  };
}

function compareSignature(expected, actual) {
  if (expected.status !== "declared") {
    return {
      status: "not-declared",
      comparable: false,
      expected,
      actual,
    };
  }
  if (!actual.verified) {
    return { status: "mismatch", comparable: true, expected, actual };
  }
  if (!expected.publicKeySha256) {
    return { status: "unbound", comparable: false, expected, actual };
  }
  const algorithmMatches =
    !expected.algorithm ||
    expected.algorithm.toLowerCase() === actual.algorithm;
  return {
    status:
      algorithmMatches && expected.publicKeySha256 === actual.publicKeySha256
        ? "matched"
        : "mismatch",
    comparable: true,
    expected,
    actual,
  };
}

function compareSbom(expected, actual) {
  if (expected.status !== "declared") {
    return {
      status: "not-declared",
      comparable: false,
      expected,
      actual: summarizeSbom(actual),
    };
  }
  if (!expected.sha256) {
    return {
      status: "unbound",
      comparable: false,
      expected,
      actual: summarizeSbom(actual),
    };
  }
  if (!COMPARABLE_SBOM_FORMATS.has(expected.format)) {
    return {
      status: "not-comparable",
      comparable: false,
      expected,
      actual: summarizeSbom(actual),
    };
  }
  return {
    status: expected.sha256 === actual.digest ? "matched" : "mismatch",
    comparable: true,
    expected,
    actual: summarizeSbom(actual),
  };
}

function summarizeSbom(value) {
  return {
    schemaVersion: value.schemaVersion,
    digest: value.digest,
    fileCount: value.fileCount,
    totalBytes: value.totalBytes,
  };
}

function expectationStatus(value) {
  return value === "declared" ? "declared" : "missing";
}

function cleanDigest(value) {
  const candidate = clean(value, 64)?.toLowerCase() || null;
  return candidate && SHA256_RE.test(candidate) ? candidate : null;
}

function clean(value, max) {
  if (value == null) return null;
  const candidate = String(value)
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, max);
  return candidate || null;
}

function issue(code, detail = null) {
  return { code, ...(detail ? { detail: clean(detail, 512) } : {}) };
}

function stableCompare(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value) {
  return sha256(canonicalJson(value));
}

function canonicalJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}
