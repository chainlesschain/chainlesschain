/**
 * Truthful, local readback of marketplace artifact expectations.
 *
 * Registry metadata remains an unverified assertion. This projection compares
 * only fields whose semantics are exact: manifest bytes, manifest license,
 * the cryptographically verified signing key, and the repository-defined
 * payload SBOM format. Persisted remote-artifact evidence is checked for
 * internal consistency and bound back to the installed signature lock;
 * external SBOM bytes are not persisted or re-fetched, so their install-time
 * digest record remains explicitly distinct from a current payload comparison.
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
  const expectedRegistryOrigin = registryOriginFromSource(source);
  const remoteArtifactEvidence = validateRemoteArtifactEvidence(
    source?.catalogAuthority?.remoteArtifactEvidence,
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
      publicKeyDocumentSha256: hashLockedPublicKeyDocument(lock),
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
  actual.remoteArtifacts = summarizeRemoteArtifacts({
    evidence: remoteArtifactEvidence,
    lock,
    signature: actual.signature,
    expectedRegistryOrigin,
  });
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
    remoteSignature: compareRemoteSignature(
      expectations.signature,
      actual.remoteArtifacts.signature,
    ),
    remoteSbom: compareRemoteSbom(
      expectations.sbom,
      actual.remoteArtifacts.sbom,
    ),
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
  if (remoteArtifactEvidence.present && !remoteArtifactEvidence.valid) {
    blockers.push(issue("REMOTE_ARTIFACT_EVIDENCE_INVALID"));
  }
  if (
    actual.remoteArtifacts.registryOriginComparable &&
    !actual.remoteArtifacts.registryOriginMatches
  ) {
    blockers.push(issue("REMOTE_ARTIFACT_REGISTRY_ORIGIN_MISMATCH"));
  }
  if (comparisons.remoteSignature.status === "mismatch") {
    blockers.push(issue("REMOTE_SIGNATURE_EVIDENCE_MISMATCH"));
  }
  if (comparisons.remoteSbom.status === "mismatch") {
    blockers.push(issue("REMOTE_SBOM_EVIDENCE_MISMATCH"));
  }
  const comparisonStatuses = [
    comparisons.manifest.status,
    comparisons.license.status,
    comparisons.signature.status,
    comparisons.sbom.status,
    ...(expectations.signature.url || actual.remoteArtifacts.signature.fetched
      ? [comparisons.remoteSignature.status]
      : []),
    ...(expectations.sbom.url || actual.remoteArtifacts.sbom.fetched
      ? [comparisons.remoteSbom.status]
      : []),
  ];
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
    remoteArtifactEvidence,
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
      remoteSignatureFetched: actual.remoteArtifacts.signature.fetched === true,
      remoteSignatureBoundToInstalledLock:
        remoteArtifactEvidence.valid === true &&
        actual.signature.verified === true &&
        actual.remoteArtifacts.registryOriginMatches === true &&
        comparisons.remoteSignature.status === "matched" &&
        actual.remoteArtifacts.signature.boundToInstalledLock === true,
      remoteSbomFetched: actual.remoteArtifacts.sbom.fetched === true,
      remoteArtifactEvidenceSelfConsistent:
        remoteArtifactEvidence.valid === true,
      manifestBytesReadFromImmutableInstall: true,
      licenseReadFromInstalledManifest: true,
      signatureCryptographicallyReverified: actual.signature.verified,
      payloadSbomComputedFromImmutableInstall: true,
      externalSbomDigestComparable: comparisons.sbom.comparable,
      remoteSbomDigestVerifiedAtInstallRecorded:
        remoteArtifactEvidence.valid === true &&
        actual.remoteArtifacts.registryOriginMatches === true &&
        comparisons.remoteSbom.status === "matched" &&
        actual.remoteArtifacts.sbom.digestVerifiedAtInstallRecorded === true,
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
      documentSha256: cleanDigest(raw.signature?.documentSha256),
      publicKeyDocumentSha256: cleanDigest(
        raw.signature?.publicKeyDocumentSha256,
      ),
      url: cleanUrl(raw.signature?.url),
      publicKeyUrl: cleanUrl(raw.signature?.publicKeyUrl),
    },
    sbom: {
      status: expectationStatus(raw.sbom?.status),
      format: clean(raw.sbom?.format, 128),
      sha256: cleanDigest(raw.sbom?.payloadSha256 ?? raw.sbom?.sha256),
      payloadSha256: cleanDigest(raw.sbom?.payloadSha256 ?? raw.sbom?.sha256),
      documentSha256: cleanDigest(raw.sbom?.documentSha256),
      url: cleanUrl(raw.sbom?.url),
    },
    license: {
      status: expectationStatus(raw.license?.status),
      expression: clean(raw.license?.expression, 256),
    },
  };
}

function validateRemoteArtifactEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      present: false,
      valid: false,
      evidenceDigest: null,
      authority: null,
    };
  }
  const rawAuthority = {
    schemaVersion: value.schemaVersion,
    status: value.status,
    registryOrigin: value.registryOrigin,
    signature: value.signature ?? null,
    sbom: value.sbom ?? null,
    claims: value.claims ?? null,
  };
  const evidenceDigest = cleanDigest(value.evidenceDigest);
  const authority = normalizeRemoteArtifactAuthority(rawAuthority);
  const valid =
    authority != null &&
    canonicalJson(authority) === canonicalJson(rawAuthority) &&
    evidenceDigest != null &&
    evidenceDigest === sha256Canonical(rawAuthority);
  return {
    present: true,
    valid,
    evidenceDigest,
    authority: valid ? authority : null,
  };
}

function normalizeRemoteArtifactAuthority(value) {
  if (
    value.schemaVersion !==
      "cc-plugin-marketplace-remote-artifact-evidence/v1" ||
    value.status !== "verified"
  ) {
    return null;
  }
  const registryOrigin = cleanRegistryOrigin(value.registryOrigin);
  const signature = normalizeRemoteSignatureEvidence(value.signature);
  const sbom = normalizeRemoteSbomEvidence(value.sbom);
  if (!registryOrigin || (!signature && !sbom)) return null;
  if (value.signature != null && !signature) return null;
  if (value.sbom != null && !sbom) return null;
  const claims = normalizeRemoteArtifactClaims(value.claims);
  if (!claims) return null;
  if (
    claims.publisherIdentityVerified ||
    claims.manifestSignatureVerified ||
    claims.sbomPayloadCompared ||
    claims.signatureBytesFetched !== Boolean(signature) ||
    claims.publicKeyFingerprintVerified !== Boolean(signature) ||
    claims.sbomDocumentDigestVerified !== Boolean(sbom)
  ) {
    return null;
  }
  return {
    schemaVersion: "cc-plugin-marketplace-remote-artifact-evidence/v1",
    status: "verified",
    registryOrigin,
    signature,
    sbom,
    claims,
  };
}

function normalizeRemoteSignatureEvidence(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = cleanEvidenceUrl(value.url);
  const signatureSha256 = exactDigest(value.signatureSha256);
  const bytes = boundedEvidenceBytes(value.bytes, 16 * 1024);
  const publicKey = value.publicKey;
  if (
    value.status !== "fetched" ||
    !url ||
    !signatureSha256 ||
    bytes == null ||
    !publicKey ||
    typeof publicKey !== "object" ||
    Array.isArray(publicKey)
  ) {
    return null;
  }
  const publicKeyUrl = cleanEvidenceUrl(publicKey.url);
  const documentSha256 = exactDigest(publicKey.documentSha256);
  const spkiSha256 = exactDigest(publicKey.spkiSha256);
  const publicKeyBytes = boundedEvidenceBytes(publicKey.bytes, 64 * 1024);
  if (
    !publicKeyUrl ||
    !documentSha256 ||
    !spkiSha256 ||
    publicKeyBytes == null
  ) {
    return null;
  }
  return {
    status: "fetched",
    url,
    signatureSha256,
    bytes,
    fromCache: value.fromCache === true,
    publicKey: {
      url: publicKeyUrl,
      documentSha256,
      spkiSha256,
      bytes: publicKeyBytes,
      fromCache: publicKey.fromCache === true,
    },
  };
}

function normalizeRemoteSbomEvidence(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = cleanEvidenceUrl(value.url);
  const format = exactClean(value.format, 128, { optional: true });
  const expectedDocumentSha256 = exactDigest(value.expectedDocumentSha256);
  const documentSha256 = exactDigest(value.documentSha256);
  const bytes = boundedEvidenceBytes(value.bytes, 16 * 1024 * 1024);
  if (
    value.status !== "digest-verified" ||
    !url ||
    format === undefined ||
    !expectedDocumentSha256 ||
    !documentSha256 ||
    expectedDocumentSha256 !== documentSha256 ||
    bytes == null
  ) {
    return null;
  }
  return {
    status: "digest-verified",
    url,
    format,
    expectedDocumentSha256,
    documentSha256,
    bytes,
    fromCache: value.fromCache === true,
  };
}

function normalizeRemoteArtifactClaims(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    publisherIdentityVerified: value.publisherIdentityVerified === true,
    signatureBytesFetched: value.signatureBytesFetched === true,
    publicKeyFingerprintVerified: value.publicKeyFingerprintVerified === true,
    manifestSignatureVerified: value.manifestSignatureVerified === true,
    sbomDocumentDigestVerified: value.sbomDocumentDigestVerified === true,
    sbomPayloadCompared: value.sbomPayloadCompared === true,
  };
}

function summarizeRemoteArtifacts({
  evidence,
  lock,
  signature,
  expectedRegistryOrigin,
}) {
  const authority = evidence.valid ? evidence.authority : null;
  let installedSignatureSha256 = null;
  if (signature.verified && lock?.signatureBase64) {
    try {
      installedSignatureSha256 = sha256(
        Buffer.from(lock.signatureBase64, "base64"),
      );
    } catch {
      installedSignatureSha256 = null;
    }
  }
  const remoteSignature = authority?.signature;
  const signatureFetched =
    remoteSignature?.status === "fetched" &&
    authority.claims?.signatureBytesFetched === true &&
    authority.claims?.publicKeyFingerprintVerified === true;
  const signatureDigestMatches =
    signatureFetched &&
    installedSignatureSha256 != null &&
    cleanDigest(remoteSignature.signatureSha256) === installedSignatureSha256;
  const publicKeyMatches =
    signatureFetched &&
    signature.publicKeySha256 != null &&
    cleanDigest(remoteSignature.publicKey?.spkiSha256) ===
      signature.publicKeySha256;
  const publicKeyDocumentMatches =
    signatureFetched &&
    signature.publicKeyDocumentSha256 != null &&
    cleanDigest(remoteSignature.publicKey?.documentSha256) ===
      signature.publicKeyDocumentSha256;
  const remoteSbom = authority?.sbom;
  const sbomFetched =
    remoteSbom?.status === "digest-verified" &&
    authority.claims?.sbomDocumentDigestVerified === true;
  const sbomDigestVerified =
    sbomFetched &&
    cleanDigest(remoteSbom.expectedDocumentSha256) != null &&
    cleanDigest(remoteSbom.expectedDocumentSha256) ===
      cleanDigest(remoteSbom.documentSha256);
  const registryOrigin = cleanRegistryOrigin(authority?.registryOrigin);
  const registryOriginComparable =
    evidence.valid && expectedRegistryOrigin != null;
  const registryOriginMatches =
    registryOriginComparable && registryOrigin === expectedRegistryOrigin;
  return {
    evidencePresent: evidence.present,
    evidenceValid: evidence.valid,
    registryOrigin,
    expectedRegistryOrigin,
    registryOriginComparable,
    registryOriginMatches,
    signature: {
      evidencePresent: evidence.present,
      evidenceValid: evidence.valid,
      fetched: signatureFetched,
      url: cleanUrl(remoteSignature?.url),
      publicKeyUrl: cleanUrl(remoteSignature?.publicKey?.url),
      signatureSha256: cleanDigest(remoteSignature?.signatureSha256),
      installedSignatureSha256,
      publicKeySha256: cleanDigest(remoteSignature?.publicKey?.spkiSha256),
      publicKeyDocumentSha256: cleanDigest(
        remoteSignature?.publicKey?.documentSha256,
      ),
      installedPublicKeyDocumentSha256: signature.publicKeyDocumentSha256,
      signatureDigestMatches,
      publicKeyMatches,
      publicKeyDocumentMatches,
      boundToInstalledLock:
        signatureFetched &&
        signatureDigestMatches &&
        publicKeyMatches &&
        publicKeyDocumentMatches,
      registryOriginComparable,
      registryOriginMatches,
      fromCache:
        remoteSignature?.fromCache === true ||
        remoteSignature?.publicKey?.fromCache === true,
    },
    sbom: {
      evidencePresent: evidence.present,
      evidenceValid: evidence.valid,
      fetched: sbomFetched,
      url: cleanUrl(remoteSbom?.url),
      format: clean(remoteSbom?.format, 128),
      documentSha256: cleanDigest(remoteSbom?.documentSha256),
      expectedDocumentSha256: cleanDigest(remoteSbom?.expectedDocumentSha256),
      digestVerifiedAtInstallRecorded: sbomDigestVerified,
      currentDocumentBytesAvailable: false,
      currentDocumentRehashed: false,
      registryOriginComparable,
      registryOriginMatches,
      fromCache: remoteSbom?.fromCache === true,
    },
  };
}

function compareRemoteSignature(expected, actual) {
  if (!expected.url) {
    return { status: "not-declared", comparable: false, expected, actual };
  }
  if (actual.evidencePresent && !actual.evidenceValid) {
    return { status: "mismatch", comparable: true, expected, actual };
  }
  if (!actual.fetched) {
    return { status: "not-observed", comparable: false, expected, actual };
  }
  if (!actual.registryOriginComparable) {
    return { status: "unbound", comparable: false, expected, actual };
  }
  const documentDigestMatches =
    !expected.documentSha256 ||
    expected.documentSha256 === actual.signatureSha256;
  const publicKeyMatchesExpectation =
    expected.publicKeySha256 != null &&
    expected.publicKeySha256 === actual.publicKeySha256;
  const publicKeyDocumentMatches =
    !expected.publicKeyDocumentSha256 ||
    expected.publicKeyDocumentSha256 === actual.publicKeyDocumentSha256;
  const urlsMatch =
    expected.url === actual.url &&
    expected.publicKeyUrl === actual.publicKeyUrl;
  return {
    status:
      actual.boundToInstalledLock &&
      documentDigestMatches &&
      publicKeyMatchesExpectation &&
      publicKeyDocumentMatches &&
      urlsMatch &&
      actual.registryOriginMatches
        ? "matched"
        : "mismatch",
    comparable: true,
    expected: {
      url: expected.url,
      publicKeyUrl: expected.publicKeyUrl,
      publicKeySha256: expected.publicKeySha256,
      documentSha256: expected.documentSha256,
      publicKeyDocumentSha256: expected.publicKeyDocumentSha256,
    },
    actual,
  };
}

function compareRemoteSbom(expected, actual) {
  if (!expected.url) {
    return { status: "not-declared", comparable: false, expected, actual };
  }
  if (actual.evidencePresent && !actual.evidenceValid) {
    return { status: "mismatch", comparable: true, expected, actual };
  }
  if (!actual.fetched) {
    return { status: "not-observed", comparable: false, expected, actual };
  }
  if (!actual.registryOriginComparable) {
    return { status: "unbound", comparable: false, expected, actual };
  }
  const documentDigestMatches =
    expected.documentSha256 != null &&
    expected.documentSha256 === actual.documentSha256;
  const urlMatches = expected.url === actual.url;
  const formatMatches = expected.format === actual.format;
  return {
    status:
      actual.digestVerifiedAtInstallRecorded &&
      documentDigestMatches &&
      urlMatches &&
      formatMatches &&
      actual.registryOriginMatches
        ? "matched"
        : "mismatch",
    comparable: true,
    expected: {
      url: expected.url,
      format: expected.format,
      documentSha256: expected.documentSha256,
    },
    actual,
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

function hashLockedPublicKeyDocument(lock) {
  if (typeof lock?.publicKeyPem !== "string" || !lock.publicKeyPem) return null;
  return sha256(Buffer.from(lock.publicKeyPem, "utf8"));
}

function registryOriginFromSource(source) {
  for (const candidate of [source?.registry, source?.source]) {
    const origin = cleanRegistryOriginFromUrl(candidate);
    if (origin) return origin;
  }
  return null;
}

function cleanRegistryOriginFromUrl(value) {
  const candidate = clean(value, 4096);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function cleanRegistryOrigin(value) {
  const candidate = clean(value, 4096);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/" ||
      parsed.origin !== candidate
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function cleanEvidenceUrl(value) {
  const candidate = clean(value, 4096);
  if (!candidate || candidate !== value) return null;
  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.toString() !== candidate
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function exactDigest(value) {
  return typeof value === "string" && SHA256_RE.test(value) ? value : null;
}

function boundedEvidenceBytes(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function exactClean(value, max, { optional = false } = {}) {
  if (value == null) return optional ? null : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = clean(value, max);
  return normalized === value ? normalized : undefined;
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

function cleanUrl(value) {
  const candidate = clean(value, 4096);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
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
