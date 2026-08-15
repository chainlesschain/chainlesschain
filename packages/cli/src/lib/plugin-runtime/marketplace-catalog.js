/**
 * Read-only marketplace governance projection.
 *
 * Registry metadata is publisher-supplied and therefore never presented as
 * verified evidence. This module makes that distinction explicit while still
 * giving humans and policy automation one bounded, versioned shape for
 * comparing candidates before any plugin bytes are cloned or executed.
 */

import crypto from "node:crypto";
import semver from "semver";
import {
  checkPluginDependencies,
  parsePluginDependencies,
} from "./governance.js";
import { describeCapabilities, normalizeCapabilities } from "./capabilities.js";

export const PLUGIN_MARKETPLACE_CATALOG_SCHEMA =
  "cc-plugin-marketplace-catalog/v1";
export const PLUGIN_MARKETPLACE_INSTALL_PREFLIGHT_SCHEMA =
  "cc-plugin-marketplace-install-preflight/v1";
export const PLUGIN_MARKETPLACE_CANDIDATE_SELECTION_SCHEMA =
  "cc-plugin-marketplace-candidate-selection/v1";
export const MAX_MARKETPLACE_CATALOG_SOURCES = 16;
export const MAX_MARKETPLACE_CANDIDATES_PER_SOURCE = 2048;
export const MAX_MARKETPLACE_DEPENDENCIES_PER_CANDIDATE = 128;
export const MAX_MARKETPLACE_GRAPH_EDGES = 65_536;
export const MAX_MARKETPLACE_SELECTION_CANDIDATES = 1024;

const SHA256_RE = /^[a-f0-9]{64}$/i;
const HEALTH_STATES = new Set(["healthy", "degraded", "unhealthy", "unknown"]);
const INSTALL_DEFERRED_BLOCKERS = new Set(["INVALID_VERSION"]);

/**
 * Derive the fail-closed pre-clone authority for one registry-selected entry.
 * A legacy registry may omit version because the fetched plugin manifest is
 * the actual version authority; that one catalog blocker is therefore
 * deferred. Integrity, dependency, compatibility, source, and health blockers
 * are enforced before any clone/process execution.
 */
export function buildPluginMarketplaceInstallPreflight({
  registryUrl,
  entry,
  fromCache = false,
  installed = {},
  hostVersion = null,
  observedAt = new Date().toISOString(),
} = {}) {
  const catalog = buildPluginMarketplaceCatalog({
    sources: [
      {
        url: registryUrl,
        registry: { plugins: [entry] },
        fromCache,
      },
    ],
    installed,
    hostVersion,
    generatedAt: observedAt,
  });
  const candidate = catalog.candidates[0];
  if (!candidate) {
    throw new Error("registry candidate preflight produced no candidate");
  }
  return buildInstallPreflight({ catalog, candidate, observedAt });
}

/**
 * Resolve one exact plugin name across a previously-built multi-registry
 * catalog. Selection is deterministic: the catalog's version-descending,
 * source-priority order is authoritative. An unavailable requested source or
 * a blocked highest-ranked candidate fails closed instead of silently falling
 * back to a lower version/source.
 */
export function buildPluginMarketplaceCandidateSelection({
  catalog,
  name,
  observedAt = new Date().toISOString(),
} = {}) {
  if (catalog?.schemaVersion !== PLUGIN_MARKETPLACE_CATALOG_SCHEMA) {
    throw new Error("candidate selection requires a marketplace catalog/v1");
  }
  const requestedName = boundedString(name, 256);
  if (!requestedName) throw new Error("candidate selection requires a name");

  const matching = catalog.candidates.filter(
    (candidate) => candidate.name === requestedName,
  );
  const selected = matching[0] || null;
  const blockers = [];
  const unavailableSourceIds = catalog.sources
    .filter((source) => source.status === "unavailable")
    .map((source) => source.sourceId)
    .sort();
  if (unavailableSourceIds.length) {
    blockers.push(
      issue("REGISTRY_SET_INCOMPLETE", unavailableSourceIds.join(", ")),
    );
  }
  if (matching.length === 0) blockers.push(issue("PLUGIN_NOT_FOUND"));
  if (matching.length > MAX_MARKETPLACE_SELECTION_CANDIDATES) {
    blockers.push(
      issue(
        "SELECTION_CANDIDATE_LIMIT",
        `${matching.length} > ${MAX_MARKETPLACE_SELECTION_CANDIDATES}`,
      ),
    );
  }
  if (selected) {
    for (const blocker of effectiveInstallBlockers(selected)) {
      blockers.push({
        code: blocker.code,
        ...(blocker.detail ? { detail: blocker.detail } : {}),
      });
    }
  }
  const uniqueBlockers = dedupeIssues(blockers);
  const alternatives = matching
    .slice(0, MAX_MARKETPLACE_SELECTION_CANDIDATES)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateDigest: candidate.candidateDigest,
      contentDigest: candidate.contentDigest,
      version: candidate.version,
      registry: candidate.registry,
      installability: candidate.installability.status,
      selected: candidate.candidateId === selected?.candidateId,
    }));
  const authority = {
    schemaVersion: PLUGIN_MARKETPLACE_CANDIDATE_SELECTION_SCHEMA,
    algorithm: "highest-version-then-registry-priority/v1",
    name: requestedName,
    catalogDigest: catalog.catalogDigest,
    sourceIds: catalog.sources.map((source) => source.sourceId),
    selectedCandidateId: selected?.candidateId || null,
    selectedCandidateDigest: selected?.candidateDigest || null,
    alternatives: alternatives.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateDigest: candidate.candidateDigest,
    })),
  };
  return {
    schemaVersion: PLUGIN_MARKETPLACE_CANDIDATE_SELECTION_SCHEMA,
    observedAt,
    status: uniqueBlockers.length ? "blocked" : "allowed",
    algorithm: authority.algorithm,
    name: requestedName,
    catalogSchemaVersion: catalog.schemaVersion,
    catalogDigest: catalog.catalogDigest,
    selectionDigest: sha256Canonical(authority),
    sourceCount: catalog.sources.length,
    candidateCount: matching.length,
    selected,
    alternatives,
    blockers: uniqueBlockers,
    claims: {
      registryMetadataVerified: false,
      candidateBytesFetched: false,
      candidateCodeExecuted: false,
      unavailableRequestedSourcesIgnored: false,
      lowerRankedFallbackAllowed: false,
    },
  };
}

/** Bind a multi-registry selection to the existing pre-clone authority. */
export function buildPluginMarketplaceInstallPreflightFromSelection({
  catalog,
  selection,
  observedAt = new Date().toISOString(),
} = {}) {
  if (
    selection?.schemaVersion !==
      PLUGIN_MARKETPLACE_CANDIDATE_SELECTION_SCHEMA ||
    selection.catalogDigest !== catalog?.catalogDigest
  ) {
    throw new Error("install preflight selection/catalog authority mismatch");
  }
  if (!selection.selected) {
    throw new Error("install preflight selection produced no candidate");
  }
  return buildInstallPreflight({
    catalog,
    candidate: selection.selected,
    observedAt,
    selection,
  });
}

function buildInstallPreflight({ catalog, candidate, observedAt, selection }) {
  const deferred = candidate.installability.blockers.filter(
    (blocker) =>
      INSTALL_DEFERRED_BLOCKERS.has(blocker.code) && !candidate.version,
  );
  const blockers = candidate.installability.blockers.filter(
    (blocker) =>
      !INSTALL_DEFERRED_BLOCKERS.has(blocker.code) ||
      Boolean(candidate.version),
  );
  const selectionBlockers = selection?.blockers || [];
  const effectiveBlockers = selection
    ? dedupeIssues([...blockers, ...selectionBlockers])
    : blockers;
  const preflight = {
    schemaVersion: PLUGIN_MARKETPLACE_INSTALL_PREFLIGHT_SCHEMA,
    observedAt,
    status: effectiveBlockers.length ? "blocked" : "allowed",
    catalogSchemaVersion: catalog.schemaVersion,
    catalogDigest: catalog.catalogDigest,
    ...(selection
      ? {
          selectionSchemaVersion: selection.schemaVersion,
          selectionDigest: selection.selectionDigest,
          selectionAlgorithm: selection.algorithm,
          selectionSourceCount: selection.sourceCount,
        }
      : {}),
    candidateId: candidate.candidateId,
    candidateDigest: candidate.candidateDigest,
    contentDigest: candidate.contentDigest,
    name: candidate.name,
    registry: candidate.registry,
    package: candidate.package,
    registryVersion: candidate.version,
    versionAuthority: candidate.version
      ? "registry-declared-unverified"
      : "deferred-to-plugin-manifest",
    governance: candidate.governance,
    integrity: candidate.integrity,
    license: candidate.license,
    capabilities: candidate.capabilities,
    compatibility: candidate.compatibility,
    dependencies: candidate.dependencies,
    health: candidate.health,
    blockers: effectiveBlockers,
    deferred,
    warnings: candidate.warnings,
    claims: catalog.claims,
  };
  return { catalog, candidate, preflight };
}

/**
 * Build a deterministic governance projection from already-fetched registries.
 * A source is `{ url, registry, fromCache?, error? }`.
 */
export function buildPluginMarketplaceCatalog({
  sources,
  installed = {},
  hostVersion = null,
  query = "",
  strict = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("at least one marketplace registry source is required");
  }
  if (sources.length > MAX_MARKETPLACE_CATALOG_SOURCES) {
    throw new Error(
      `marketplace catalog accepts at most ${MAX_MARKETPLACE_CATALOG_SOURCES} sources`,
    );
  }

  const needle = boundedString(query, 256).toLowerCase();
  const installedVersions =
    installed && typeof installed === "object" && !Array.isArray(installed)
      ? installed
      : {};
  const sourceRows = [];
  const candidates = [];
  const seenSourceIds = new Set();

  for (const [sourceIndex, input] of sources.entries()) {
    const source = normalizeCatalogSource(input, sourceIndex);
    sourceRows.push(source.projection);
    if (seenSourceIds.has(source.projection.sourceId)) {
      source.registry = null;
      source.projection.status = "unavailable";
      source.projection.error = {
        code: "DUPLICATE_REGISTRY_SOURCE",
        message: "the same sanitized registry URL was supplied more than once",
      };
    }
    seenSourceIds.add(source.projection.sourceId);
    if (!source.registry) continue;

    const entries = source.registry.plugins;
    if (!Array.isArray(entries)) {
      source.projection.status = "unavailable";
      source.projection.error = {
        code: "INVALID_REGISTRY_DOCUMENT",
        message: "registry document does not contain a plugins array",
      };
      continue;
    }
    if (entries.length > MAX_MARKETPLACE_CANDIDATES_PER_SOURCE) {
      source.projection.status = "unavailable";
      source.projection.error = {
        code: "REGISTRY_CANDIDATE_LIMIT",
        message: `registry exceeds the ${MAX_MARKETPLACE_CANDIDATES_PER_SOURCE}-candidate limit`,
      };
      continue;
    }

    for (const [entryIndex, entry] of entries.entries()) {
      const candidate = normalizeCandidate(entry, {
        source: source.projection,
        entryIndex,
        installed: installedVersions,
        hostVersion,
        strict,
      });
      if (
        needle &&
        !`${candidate.name} ${candidate.description}`
          .toLowerCase()
          .includes(needle)
      ) {
        continue;
      }
      candidates.push(candidate);
    }
    source.projection.candidateCount = candidates.filter(
      (candidate) => candidate.registry.sourceId === source.projection.sourceId,
    ).length;
  }

  applySourceConflicts(candidates);
  candidates.sort(compareCandidates);
  sourceRows.sort((a, b) => a.priority - b.priority);
  const dependencyGraph = buildDependencyGraph(candidates, installedVersions);

  const summary = {
    sourceCount: sourceRows.length,
    availableSourceCount: sourceRows.filter(
      (source) => source.status !== "unavailable",
    ).length,
    unavailableSourceCount: sourceRows.filter(
      (source) => source.status === "unavailable",
    ).length,
    cachedSourceCount: sourceRows.filter((source) => source.status === "cached")
      .length,
    candidateCount: candidates.length,
    installableCandidateCount: candidates.filter(
      (candidate) => candidate.installability.status === "allowed",
    ).length,
    blockedCandidateCount: candidates.filter(
      (candidate) => candidate.installability.status === "blocked",
    ).length,
    incompleteCandidateCount: candidates.filter(
      (candidate) => candidate.governance.status !== "complete",
    ).length,
    conflictCount: candidates.filter((candidate) => candidate.conflict).length,
  };

  const authority = {
    schemaVersion: PLUGIN_MARKETPLACE_CATALOG_SCHEMA,
    strict: strict === true,
    hostVersion: boundedString(hostVersion, 128) || null,
    sources: sourceRows.map(({ error: _error, ...source }) => source),
    candidates,
    dependencyGraph,
  };

  return {
    schemaVersion: PLUGIN_MARKETPLACE_CATALOG_SCHEMA,
    generatedAt,
    catalogDigest: sha256Canonical(authority),
    mode: strict ? "strict" : "advisory",
    host: { version: boundedString(hostVersion, 128) || null },
    sources: sourceRows,
    candidates,
    dependencyGraph,
    summary,
    claims: {
      registryMetadataVerified: false,
      pluginBytesFetched: false,
      pluginCodeExecuted: false,
      signatureVerificationStage: "install/load",
    },
  };
}

function normalizeCatalogSource(input, priority) {
  const raw = input && typeof input === "object" ? input : {};
  const sanitizedUrl = sanitizeUrl(raw.url);
  const url = sanitizedUrl || `invalid-source-${priority + 1}`;
  const error = raw.error
    ? {
        code: boundedString(raw.error.code, 64) || "REGISTRY_FETCH_FAILED",
        message: scrubError(raw.error.message || raw.error),
      }
    : !sanitizedUrl
      ? {
          code: "INVALID_REGISTRY_URL",
          message: "registry source URL is missing or invalid",
        }
      : null;
  const registry =
    raw.registry && typeof raw.registry === "object" ? raw.registry : null;
  return {
    registry: error ? null : registry,
    projection: {
      sourceId: `registry-${sha256(url).slice(0, 16)}`,
      priority,
      url,
      name: boundedString(registry?.name, 256) || null,
      status: error ? "unavailable" : raw.fromCache ? "cached" : "online",
      candidateCount: 0,
      ...(error ? { error } : {}),
    },
  };
}

function normalizeCandidate(entry, context) {
  const raw = entry && typeof entry === "object" ? entry : {};
  const rawName =
    typeof raw.name === "string" ? boundedString(raw.name, 256) : "";
  const name = rawName || "(invalid-name)";
  const version =
    typeof raw.version === "string"
      ? boundedString(raw.version, 128) || null
      : null;
  const description = boundedString(raw.description, 2048);
  const sourceValue =
    typeof raw.source === "string" ? boundedString(raw.source, 4096) : "";
  const sourceUrl = sanitizeUrl(sourceValue) || sourceValue || null;
  const ref = boundedString(raw.ref, 256) || null;
  const blockers = [];
  const warnings = [];

  if (!rawName || !/^[a-zA-Z0-9._@/-]+$/.test(rawName)) {
    blockers.push(issue("INVALID_NAME"));
  }
  if (!version || !semver.valid(version))
    blockers.push(issue("INVALID_VERSION"));
  if (!sourceValue) blockers.push(issue("MISSING_PACKAGE_SOURCE"));
  if (hasUrlCredentials(sourceValue)) {
    blockers.push(issue("SOURCE_CREDENTIALS_EMBEDDED"));
  }

  const integrity = normalizeIntegrity(raw, blockers);
  const license = normalizeLicense(raw.license);
  const capabilitiesDeclared = hasCapabilityDeclaration(raw);
  const capabilities = normalizeCapabilities(
    raw.permissions ?? raw.capabilities ?? null,
  );
  const capabilitySummary = describeCapabilities(capabilities);

  const compatibilityRange =
    boundedString(raw.compatibility?.cc, 256) ||
    boundedString(raw.engines?.cc, 256) ||
    null;
  const dependencyObject =
    raw.dependencies &&
    typeof raw.dependencies === "object" &&
    !Array.isArray(raw.dependencies)
      ? raw.dependencies
      : null;
  const dependencyEntries = dependencyObject
    ? Object.entries(dependencyObject).sort(([a], [b]) => a.localeCompare(b))
    : [];
  if (dependencyEntries.length > MAX_MARKETPLACE_DEPENDENCIES_PER_CANDIDATE) {
    blockers.push(issue("DEPENDENCY_LIMIT_EXCEEDED"));
  }
  const dependencyManifest = {
    dependencies: dependencyObject
      ? Object.fromEntries(
          dependencyEntries.slice(
            0,
            MAX_MARKETPLACE_DEPENDENCIES_PER_CANDIDATE,
          ),
        )
      : raw.dependencies,
  };
  if (compatibilityRange && dependencyManifest.dependencies) {
    dependencyManifest.dependencies = {
      ...dependencyManifest.dependencies,
      host: compatibilityRange,
    };
  } else if (compatibilityRange) {
    dependencyManifest.dependencies = { host: compatibilityRange };
  }
  const parsedDependencies = parsePluginDependencies(dependencyManifest);
  const dependencyCheck = checkPluginDependencies(dependencyManifest, {
    installed: context.installed,
    hostVersion: context.hostVersion,
  });
  if (parsedDependencies.errors.length) {
    blockers.push(
      issue("INVALID_DEPENDENCIES", parsedDependencies.errors.join("; ")),
    );
  }
  if (dependencyCheck.missing.length)
    blockers.push(issue("MISSING_DEPENDENCY"));
  if (dependencyCheck.mismatched.length) {
    blockers.push(issue("DEPENDENCY_VERSION_MISMATCH"));
  }
  if (dependencyCheck.hostMismatch) blockers.push(issue("HOST_INCOMPATIBLE"));
  if (compatibilityRange && !semver.validRange(compatibilityRange)) {
    blockers.push(issue("INVALID_HOST_COMPATIBILITY"));
  }

  const publisherHealth = normalizePublisherHealth(raw.health);
  if (publisherHealth.status === "unhealthy") {
    blockers.push(issue("PUBLISHER_HEALTH_UNHEALTHY"));
  }

  const missingGovernance = [];
  if (integrity.digest.status !== "declared") missingGovernance.push("digest");
  if (integrity.signature.status !== "declared") {
    missingGovernance.push("signature");
  }
  if (integrity.sbom.status !== "declared") missingGovernance.push("sbom");
  if (license.status !== "declared") missingGovernance.push("license");
  if (!capabilitiesDeclared) missingGovernance.push("capabilities");
  if (missingGovernance.length) {
    warnings.push(
      issue("GOVERNANCE_METADATA_INCOMPLETE", missingGovernance.join(", ")),
    );
    if (context.strict) {
      blockers.push(
        issue(
          "STRICT_GOVERNANCE_METADATA_REQUIRED",
          missingGovernance.join(", "),
        ),
      );
    }
  }

  const identity = `${name}@${version || "unknown"}`;
  const candidateId = `candidate-${sha256(
    `${context.source.sourceId}\0${identity}\0${context.entryIndex}`,
  ).slice(0, 20)}`;
  const candidate = {
    candidateId,
    name,
    version,
    description,
    registry: {
      sourceId: context.source.sourceId,
      priority: context.source.priority,
      url: context.source.url,
      status: context.source.status,
    },
    package: { source: sourceUrl, ref },
    integrity,
    license,
    capabilities: {
      declared: capabilitiesDeclared,
      summary: capabilitySummary,
      normalized: capabilities,
    },
    compatibility: {
      hostVersion: context.hostVersion || null,
      range: parsedDependencies.hostRange || compatibilityRange,
      status: parsedDependencies.errors.some((message) =>
        message.includes("host"),
      )
        ? "invalid"
        : dependencyCheck.hostMismatch
          ? "incompatible"
          : parsedDependencies.hostRange || compatibilityRange
            ? context.hostVersion
              ? "compatible"
              : "unknown"
            : "unknown",
    },
    dependencies: {
      declared: parsedDependencies.deps,
      status: parsedDependencies.errors.length
        ? "invalid"
        : dependencyCheck.missing.length || dependencyCheck.mismatched.length
          ? "unsatisfied"
          : Object.keys(parsedDependencies.deps).length
            ? "satisfied"
            : "none",
      missing: dependencyCheck.missing,
      mismatched: dependencyCheck.mismatched,
      errors: parsedDependencies.errors,
    },
    health: {
      registry: context.source.status,
      publisher: publisherHealth,
      status:
        publisherHealth.status === "unhealthy"
          ? "unhealthy"
          : context.source.status === "cached"
            ? "cached"
            : publisherHealth.status,
    },
    governance: {
      status: missingGovernance.length ? "incomplete" : "complete",
      missing: missingGovernance,
      metadataAuthority: "unverified-registry-assertion",
    },
    conflict: null,
    warnings,
    installability: { status: "allowed", blockers },
  };
  candidate.installability.status = blockers.length ? "blocked" : "allowed";
  const contentAuthority = {
    schemaVersion: PLUGIN_MARKETPLACE_CATALOG_SCHEMA,
    name: candidate.name,
    version: candidate.version,
    package: candidate.package,
    integrity: candidate.integrity,
    license: candidate.license,
    capabilities: candidate.capabilities,
    compatibility: {
      range: candidate.compatibility.range,
    },
    dependencies: {
      declared: candidate.dependencies.declared,
      errors: candidate.dependencies.errors,
    },
    publisherHealth: candidate.health.publisher,
    governance: candidate.governance,
  };
  candidate.contentDigest = sha256Canonical(contentAuthority);
  candidate.candidateDigest = sha256Canonical({
    schemaVersion: PLUGIN_MARKETPLACE_CATALOG_SCHEMA,
    sourceId: candidate.registry.sourceId,
    registryUrl: candidate.registry.url,
    contentDigest: candidate.contentDigest,
  });
  Object.defineProperty(candidate.registry, "entryIndex", {
    value: context.entryIndex,
    enumerable: false,
  });
  Object.defineProperty(candidate, "_identity", {
    value: identity,
    enumerable: false,
  });
  Object.defineProperty(candidate, "_fingerprint", {
    value: candidate.contentDigest,
    enumerable: false,
  });
  return candidate;
}

function normalizeIntegrity(raw, blockers) {
  const digestValue = boundedString(raw.sha256 ?? raw.digest?.sha256, 128);
  const digestStatus = !digestValue
    ? "missing"
    : SHA256_RE.test(digestValue)
      ? "declared"
      : "invalid";
  if (digestStatus === "invalid") blockers.push(issue("INVALID_DIGEST"));

  const signatureRaw = raw.signature;
  const signatureObject =
    signatureRaw &&
    typeof signatureRaw === "object" &&
    !Array.isArray(signatureRaw);
  const signatureAlgorithm = boundedString(signatureRaw?.algorithm, 64) || null;
  const signatureKeyId = boundedString(signatureRaw?.keyId, 256) || null;
  const signatureKeyDigest =
    boundedString(signatureRaw?.publicKeySha256, 128) || null;
  const signatureUrl = sanitizeUrl(signatureRaw?.url) || null;
  const signatureDeclared = Boolean(
    signatureObject &&
    signatureAlgorithm &&
    (signatureKeyId || signatureKeyDigest || signatureUrl),
  );
  const signature = {
    status: signatureDeclared ? "declared" : "missing",
    verification: "not-verified-at-catalog-time",
    subject: "plugin-manifest",
    algorithm: signatureAlgorithm,
    keyId: signatureKeyId,
    publicKeySha256: signatureKeyDigest,
    url: signatureUrl,
  };
  if (signature.publicKeySha256 && !SHA256_RE.test(signature.publicKeySha256)) {
    signature.status = "invalid";
    blockers.push(issue("INVALID_SIGNATURE_KEY_DIGEST"));
  }
  if (signatureDeclared && signature.algorithm.toLowerCase() !== "ed25519") {
    signature.status = "invalid";
    blockers.push(issue("UNSUPPORTED_SIGNATURE_ALGORITHM"));
  }

  const sbomRaw = raw.sbom;
  const sbomObject =
    sbomRaw && typeof sbomRaw === "object" && !Array.isArray(sbomRaw);
  const sbomDigest = boundedString(sbomRaw?.digest ?? sbomRaw?.sha256, 128);
  const sbomFormat = boundedString(sbomRaw?.format, 128) || null;
  const sbomUrl = sanitizeUrl(sbomRaw?.url) || null;
  const sbomDeclared = Boolean(sbomObject && (sbomDigest || sbomUrl));
  const sbom = {
    status: sbomDeclared ? "declared" : "missing",
    verification: "not-verified-at-catalog-time",
    subject: "plugin-files",
    format: sbomFormat,
    digest: sbomDigest || null,
    url: sbomUrl,
  };
  if (sbomDigest && !SHA256_RE.test(sbomDigest)) {
    sbom.status = "invalid";
    blockers.push(issue("INVALID_SBOM_DIGEST"));
  }

  return {
    digest: {
      status: digestStatus,
      algorithm: "sha256",
      subject: "plugin-manifest",
      value: digestStatus === "declared" ? digestValue.toLowerCase() : null,
      authority: "registry-declared",
    },
    signature,
    sbom,
  };
}

function normalizeLicense(value) {
  const expression = boundedString(value, 256) || null;
  return {
    status: expression ? "declared" : "missing",
    expression,
    verification: "not-verified-at-catalog-time",
  };
}

function normalizePublisherHealth(value) {
  const raw = value && typeof value === "object" ? value : {};
  const stated = boundedString(raw.status ?? value, 32).toLowerCase();
  return {
    status: HEALTH_STATES.has(stated) ? stated : "unknown",
    checkedAt: boundedString(raw.checkedAt, 64) || null,
    authority: "registry-declared",
  };
}

function buildDependencyGraph(candidates, installed) {
  const nodes = candidates.map((candidate) => ({
    nodeId: candidate.candidateId,
    type: "candidate",
    name: candidate.name,
    version: candidate.version,
    sourceId: candidate.registry.sourceId,
  }));
  const candidatesByName = new Map();
  for (const candidate of candidates) {
    const rows = candidatesByName.get(candidate.name) || [];
    rows.push(candidate);
    candidatesByName.set(candidate.name, rows);
  }

  const installedNodes = new Map();
  const edges = [];
  let truncated = false;
  outer: for (const candidate of candidates) {
    for (const [dependencyName, range] of Object.entries(
      candidate.dependencies.declared,
    )) {
      if (edges.length >= MAX_MARKETPLACE_GRAPH_EDGES) {
        truncated = true;
        break outer;
      }
      const targetCandidateIds = (candidatesByName.get(dependencyName) || [])
        .filter(
          (target) =>
            semver.valid(target.version) &&
            semver.satisfies(target.version, range, {
              includePrerelease: true,
            }),
        )
        .map((target) => target.candidateId)
        .sort();
      const installedVersion =
        boundedString(installed[dependencyName], 128) || null;
      const installedSatisfied = Boolean(
        installedVersion &&
        (semver.valid(installedVersion) || semver.coerce(installedVersion)) &&
        semver.satisfies(
          semver.valid(installedVersion) ||
            semver.coerce(installedVersion).version,
          range,
          { includePrerelease: true },
        ),
      );
      let installedNodeId = null;
      if (installedVersion) {
        installedNodeId = `installed-${sha256(
          `${dependencyName}\0${installedVersion}`,
        ).slice(0, 20)}`;
        if (!installedNodes.has(installedNodeId)) {
          installedNodes.set(installedNodeId, {
            nodeId: installedNodeId,
            type: "installed",
            name: dependencyName,
            version: installedVersion,
          });
        }
      }
      edges.push({
        from: candidate.candidateId,
        dependency: dependencyName,
        range,
        installedNodeId,
        targetCandidateIds,
        status: installedSatisfied
          ? "installed-satisfied"
          : targetCandidateIds.length
            ? "catalog-available"
            : installedVersion
              ? "installed-mismatch"
              : "unresolved",
      });
    }
  }
  nodes.push(...installedNodes.values());
  nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  edges.sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.dependency.localeCompare(b.dependency),
  );

  return {
    nodes,
    edges,
    cycles: findDependencyCycles(candidates, edges),
    truncated,
    maxEdges: MAX_MARKETPLACE_GRAPH_EDGES,
  };
}

function findDependencyCycles(candidates, edges) {
  const candidateIds = new Set(
    candidates.map((candidate) => candidate.candidateId),
  );
  const adjacency = new Map();
  for (const edge of edges) {
    const targets = adjacency.get(edge.from) || [];
    for (const target of edge.targetCandidateIds) {
      if (candidateIds.has(target)) targets.push(target);
    }
    adjacency.set(edge.from, [...new Set(targets)].sort());
  }

  const state = new Map();
  const found = new Map();
  for (const candidate of candidates) {
    const root = candidate.candidateId;
    if (state.has(root)) continue;
    const path = [root];
    const pathIndex = new Map([[root, 0]]);
    const stack = [
      { nodeId: root, targets: adjacency.get(root) || [], nextTarget: 0 },
    ];
    state.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.nextTarget >= frame.targets.length) {
        state.set(frame.nodeId, 2);
        stack.pop();
        pathIndex.delete(frame.nodeId);
        path.pop();
        continue;
      }
      const target = frame.targets[frame.nextTarget++];
      if (!state.has(target)) {
        state.set(target, 1);
        pathIndex.set(target, path.length);
        path.push(target);
        stack.push({
          nodeId: target,
          targets: adjacency.get(target) || [],
          nextTarget: 0,
        });
      } else if (state.get(target) === 1 && pathIndex.has(target)) {
        const cycle = canonicalCycle(path.slice(pathIndex.get(target)));
        found.set(cycle.join("\0"), cycle);
      }
    }
  }
  return [...found.values()].sort((a, b) =>
    a.join("\0").localeCompare(b.join("\0")),
  );
}

function canonicalCycle(cycle) {
  if (cycle.length < 2) return cycle;
  const rotations = cycle.map((_, index) => [
    ...cycle.slice(index),
    ...cycle.slice(0, index),
  ]);
  rotations.sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
  return rotations[0];
}

function applySourceConflicts(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const group = groups.get(candidate._identity) || [];
    group.push(candidate);
    groups.set(candidate._identity, group);
  }
  for (const group of groups.values()) {
    const fingerprints = new Set(
      group.map((candidate) => candidate._fingerprint),
    );
    if (fingerprints.size <= 1) continue;
    const sourceIds = group
      .map((candidate) => candidate.registry.sourceId)
      .sort();
    for (const candidate of group) {
      candidate.conflict = {
        code: "SOURCE_CONFLICT",
        sourceIds,
        message:
          "same name/version resolves to different package or integrity metadata",
      };
      candidate.installability.blockers.push(issue("SOURCE_CONFLICT"));
      candidate.installability.status = "blocked";
    }
  }
}

function hasCapabilityDeclaration(raw) {
  const value = raw.permissions ?? raw.capabilities;
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compareCandidates(a, b) {
  const name = a.name.localeCompare(b.name);
  if (name) return name;
  const av = semver.valid(a.version);
  const bv = semver.valid(b.version);
  if (av && bv && av !== bv) return semver.rcompare(av, bv);
  const version = String(b.version || "").localeCompare(
    String(a.version || ""),
  );
  return version || a.registry.priority - b.registry.priority;
}

function effectiveInstallBlockers(candidate) {
  return candidate.installability.blockers.filter(
    (blocker) =>
      !INSTALL_DEFERRED_BLOCKERS.has(blocker.code) ||
      Boolean(candidate.version),
  );
}

function dedupeIssues(issues) {
  const seen = new Set();
  const result = [];
  for (const candidate of issues) {
    const normalized = issue(candidate.code, candidate.detail);
    const key = `${normalized.code}\0${normalized.detail || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result.sort((a, b) =>
    `${a.code}\0${a.detail || ""}`.localeCompare(
      `${b.code}\0${b.detail || ""}`,
    ),
  );
}

function issue(code, detail = null) {
  return { code, ...(detail ? { detail: boundedString(detail, 2048) } : {}) };
}

function boundedString(value, max) {
  if (value == null) return "";
  const clean = String(value)
    .replace(/\p{Cc}/gu, "")
    .trim();
  return clean.slice(0, max);
}

function sanitizeUrl(value) {
  const raw = boundedString(value, 4096);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function hasUrlCredentials(value) {
  try {
    const parsed = new URL(String(value));
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}

function scrubError(value) {
  const text = boundedString(value, 1024).replace(
    /Bearer\s+\S+/gi,
    "Bearer [REDACTED]",
  );
  return text.replace(
    /https?:\/\/[^\s)]+/gi,
    (match) => sanitizeUrl(match) || "[URL]",
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256Canonical(value) {
  return sha256(JSON.stringify(sortCanonical(value)));
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
