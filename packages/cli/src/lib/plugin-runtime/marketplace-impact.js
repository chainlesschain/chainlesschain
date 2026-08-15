/**
 * Deterministic, read-only update impact for one installed plugin and one
 * registry-selected candidate. No candidate bytes are fetched or executed.
 */

import crypto from "node:crypto";
import semver from "semver";
import { diffCapabilities, normalizeCapabilities } from "./capabilities.js";
import { PLUGIN_MARKETPLACE_INSTALL_PREFLIGHT_SCHEMA } from "./marketplace-catalog.js";

export const PLUGIN_MARKETPLACE_UPDATE_IMPACT_SCHEMA =
  "cc-plugin-marketplace-update-impact/v1";

export function buildPluginMarketplaceUpdateImpact({
  preflight,
  installed = null,
  observedAt = new Date().toISOString(),
} = {}) {
  if (
    !preflight ||
    preflight.schemaVersion !== PLUGIN_MARKETPLACE_INSTALL_PREFLIGHT_SCHEMA
  ) {
    throw new Error(
      `marketplace impact requires ${PLUGIN_MARKETPLACE_INSTALL_PREFLIGHT_SCHEMA}`,
    );
  }
  const current = normalizeInstalled(installed);
  const version = compareVersion(current?.version, preflight.registryVersion);
  const source = compareSource(current?.source, preflight);
  const integrity = compareIntegrity(current?.integrity, preflight.integrity);
  const license = compareScalar(
    current?.license?.expression,
    preflight.license?.expression,
  );
  const capabilities = diffCapabilities(
    current?.capabilities || normalizeCapabilities(null),
    preflight.capabilities?.normalized || normalizeCapabilities(null),
  );
  const dependencies = compareDependencies(
    current?.dependencies || {},
    preflight.dependencies?.declared || {},
  );
  const approvals = [];
  if (source.requiresApproval) {
    approvals.push({
      code: "SOURCE_SWITCH_APPROVAL_REQUIRED",
      detail: source.kind,
    });
  }
  if (version.kind === "downgrade") {
    approvals.push({ code: "VERSION_DOWNGRADE_APPROVAL_REQUIRED" });
  }
  if (capabilities.widened) {
    approvals.push({
      code: "CAPABILITY_WIDENING_CONSENT_REQUIRED",
      detail: capabilities.added.join(", "),
    });
  }

  const changes = {
    version,
    source,
    integrity,
    license,
    capabilities,
    dependencies,
    governance: {
      status: preflight.governance.status,
      missing: preflight.governance.missing,
    },
  };
  const changeCount = countChanges(changes);
  const authority = {
    schemaVersion: PLUGIN_MARKETPLACE_UPDATE_IMPACT_SCHEMA,
    candidateDigest: preflight.candidateDigest,
    catalogDigest: preflight.catalogDigest,
    installed: current,
    changes,
    blockers: preflight.blockers,
    approvals,
  };
  return {
    schemaVersion: PLUGIN_MARKETPLACE_UPDATE_IMPACT_SCHEMA,
    observedAt,
    impactDigest: sha256Canonical(authority),
    status: preflight.blockers.length
      ? "blocked"
      : approvals.length || changeCount
        ? "review-required"
        : "no-change",
    installed: current,
    candidate: {
      candidateId: preflight.candidateId,
      candidateDigest: preflight.candidateDigest,
      catalogDigest: preflight.catalogDigest,
      name: preflight.name,
      version: preflight.registryVersion,
      registry: preflight.registry,
      package: preflight.package,
    },
    changes,
    changeCount,
    blockers: preflight.blockers,
    requiredApprovals: approvals,
    claims: {
      candidateMetadataVerified: false,
      candidateBytesFetched: false,
      candidateCodeExecuted: false,
      installedEvidenceAuthority: "local-immutable-install",
    },
  };
}

function normalizeInstalled(value) {
  if (!value) return null;
  return {
    name: clean(value.name, 256) || null,
    version: clean(value.version, 128) || null,
    scope: clean(value.scope, 32) || null,
    source: normalizeInstalledSource(value.source),
    integrity: normalizeInstalledIntegrity(value.integrity),
    license: {
      expression:
        clean(value.license?.expression ?? value.license, 256) || null,
    },
    capabilities: normalizeCapabilities(value.capabilities),
    dependencies: normalizeDependencyMap(value.dependencies),
  };
}

function normalizeInstalledSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const authority = value.catalogAuthority;
  return {
    type: clean(value.type, 32) || null,
    source: clean(value.source, 4096) || null,
    registry: clean(value.registry, 4096) || null,
    resolvedSource: clean(value.resolvedSource, 4096) || null,
    ref: clean(value.ref, 256) || null,
    offline: value.offline === true,
    catalogAuthority:
      authority && typeof authority === "object"
        ? {
            catalogDigest: clean(authority.catalogDigest, 64) || null,
            candidateDigest: clean(authority.candidateDigest, 64) || null,
            updateImpactDigest: clean(authority.updateImpactDigest, 64) || null,
            governanceStatus: clean(authority.governanceStatus, 32) || null,
          }
        : null,
  };
}

function normalizeInstalledIntegrity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    signature: {
      present: value.signature?.present === true,
      verified: value.signature?.verified === true,
      manifestSha256: clean(value.signature?.manifestSha256, 128) || null,
      publicKeySha256: clean(value.signature?.publicKeySha256, 128) || null,
    },
    sbom: {
      present: value.sbom?.present === true,
      digest: clean(value.sbom?.digest, 128) || null,
      fileCount: Number.isSafeInteger(value.sbom?.fileCount)
        ? value.sbom.fileCount
        : null,
      totalBytes: Number.isSafeInteger(value.sbom?.totalBytes)
        ? value.sbom.totalBytes
        : null,
    },
  };
}

function compareVersion(from, to) {
  if (!from && !to) return { kind: "unknown", from: null, to: null };
  if (!from) return { kind: "new-install", from: null, to };
  if (!to) {
    return {
      kind: "candidate-version-deferred",
      from,
      to: null,
    };
  }
  const a = semver.valid(from);
  const b = semver.valid(to);
  if (!a || !b) return { kind: "unknown", from, to };
  if (a === b) return { kind: "same", from, to };
  if (semver.gt(a, b)) return { kind: "downgrade", from, to };
  const diff = semver.diff(a, b) || "update";
  return { kind: `${diff}-upgrade`, from, to };
}

function compareSource(current, preflight) {
  const to = {
    type: "registry",
    registry: preflight.registry.url,
    source: preflight.package.source,
    ref: preflight.package.ref,
  };
  if (!current) {
    return {
      kind: "new-install",
      from: null,
      to,
      changed: true,
      requiresApproval: false,
    };
  }
  const from = {
    type: clean(current.type, 32) || "unknown",
    registry: clean(current.registry, 4096) || null,
    source: clean(current.resolvedSource ?? current.source, 4096) || null,
    ref: clean(current.ref, 256) || null,
  };
  const currentRegistry =
    from.registry ||
    (from.type === "registry" ? clean(current.source, 4096) : null);
  if (currentRegistry && currentRegistry === to.registry) {
    const changed = from.source !== to.source || from.ref !== to.ref;
    return {
      kind: changed ? "same-registry-update" : "same-source",
      from,
      to,
      changed,
      requiresApproval: false,
    };
  }
  if (from.source === to.source && from.ref === to.ref) {
    return {
      kind: "authority-switch",
      from,
      to,
      changed: true,
      requiresApproval: true,
    };
  }
  return {
    kind: "source-switch",
    from,
    to,
    changed: true,
    requiresApproval: true,
  };
}

function compareIntegrity(current, candidate) {
  const installedManifest = clean(current?.signature?.manifestSha256, 128);
  const candidateManifest = clean(candidate?.digest?.value, 128);
  const installedSbom = clean(current?.sbom?.digest, 128);
  const candidateSbom = clean(candidate?.sbom?.digest, 128);
  const signingKey = compareScalar(
    current?.signature?.publicKeySha256,
    candidate?.signature?.publicKeySha256,
  );
  return {
    manifestDigest: compareScalar(installedManifest, candidateManifest),
    signature: {
      installed:
        current?.signature?.verified === true ? "verified" : "unverified",
      candidate: candidate?.signature?.status || "missing",
      candidateVerification:
        candidate?.signature?.verification || "not-verified-at-impact-time",
      changed:
        signingKey.changed ||
        current?.signature?.verified !== true ||
        candidate?.signature?.status !== "declared",
    },
    signingKey,
    sbomDigest: compareScalar(installedSbom, candidateSbom),
  };
}

function compareScalar(fromValue, toValue) {
  const from = clean(fromValue, 4096) || null;
  const to = clean(toValue, 4096) || null;
  return {
    from,
    to,
    status: !from || !to ? "unknown" : from === to ? "same" : "changed",
    changed: Boolean(from && to && from !== to),
  };
}

function compareDependencies(current, candidate) {
  const from = normalizeDependencyMap(current);
  const to = normalizeDependencyMap(candidate);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [name, range] of Object.entries(to)) {
    if (!(name in from)) added.push({ name, range });
    else if (from[name] !== range) {
      changed.push({ name, from: from[name], to: range });
    }
  }
  for (const [name, range] of Object.entries(from)) {
    if (!(name in to)) removed.push({ name, range });
  }
  return {
    from,
    to,
    added,
    removed,
    changed,
    hasChanges: Boolean(added.length || removed.length || changed.length),
  };
}

function normalizeDependencyMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, range]) => typeof range === "string")
      .map(([name, range]) => [clean(name, 256), clean(range, 256)])
      .filter(([name, range]) => name && range)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function countChanges(changes) {
  let count = 0;
  if (!new Set(["same", "unknown"]).has(changes.version.kind)) count += 1;
  if (changes.source.changed) count += 1;
  if (changes.integrity.manifestDigest.changed) count += 1;
  if (changes.integrity.signature.changed) count += 1;
  if (changes.integrity.signingKey.changed) count += 1;
  if (changes.integrity.sbomDigest.changed) count += 1;
  if (changes.license.changed) count += 1;
  count +=
    changes.capabilities.added.length + changes.capabilities.removed.length;
  count +=
    changes.dependencies.added.length +
    changes.dependencies.removed.length +
    changes.dependencies.changed.length;
  return count;
}

function clean(value, max) {
  if (value == null) return "";
  return String(value)
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, max);
}

function sha256Canonical(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(sortCanonical(value)))
    .digest("hex");
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortCanonical(value[key])]),
  );
}
