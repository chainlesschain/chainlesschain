/**
 * Privacy-preserving command lifecycle telemetry aggregation.
 *
 * Version 2 treats a lifecycle decision as an auditable evidence bundle. The
 * observation window, public releases, raw Collector exports, coverage
 * statement and human approval are all bound to the report. OTLP delta points
 * are de-duplicated by their exact point identity; cumulative streams are
 * reduced to their latest monotonic value instead of summing snapshots.
 * Missing or ambiguous evidence can only retain a compatibility alias.
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { verifyPackUpdateManifest } from "./packer/pack-update-signature.js";
import executionBroker from "./process-execution-broker/index.js";

export const COMMAND_LIFECYCLE_REPORT_SCHEMA =
  "chainlesschain.command-lifecycle-report.v2";
export const COMMAND_LIFECYCLE_COVERAGE_SCHEMA =
  "chainlesschain.command-lifecycle-coverage.v2";
export const COMMAND_LIFECYCLE_APPROVAL_SCHEMA =
  "chainlesschain.command-lifecycle-approval.v2";
export const COMMAND_LIFECYCLE_EXPORT_MANIFEST_SCHEMA =
  "chainlesschain.command-lifecycle-export-manifest.v1";
export const COMMAND_LIFECYCLE_INVOCATION_METRIC =
  "chainlesschain.cli.command.lifecycle.invocations";

export const COMMAND_ALIAS_DECISION_POLICY = Object.freeze({
  minimumObservedMinorCycles: 2,
  minimumEligibleInstallations: 50,
  minimumReportingInstallations: 30,
  minimumCollectorCoverageRatio: 0.5,
  minimumSampleRate: 0.1,
  minimumCommandInvocations: 200,
  minimumReplacementInvocations: 100,
  maximumLegacyShareForRemoval: 0.01,
  requiredPlatforms: Object.freeze(["linux", "macos", "windows"]),
});

// This repository-owned anchor intentionally remains unconfigured until the
// first public release containing the DELTA lifecycle exporter is published.
// Updating it requires a reviewed code change with all three exact values.
export const COMMAND_LIFECYCLE_DELTA_RELEASE_POLICY = Object.freeze({
  schema: "chainlesschain.command-lifecycle-delta-release-policy.v1",
  firstPublicRelease: null,
  incompatibleReleases: Object.freeze(["0.162.198", "0.163.3"]),
});

const REQUIRED_ATTRIBUTES = Object.freeze([
  "command.name",
  "command.route",
  "command.outcome",
  "cli.version",
  "command.deprecated_since",
  "command.removal_not_before",
]);
const ALLOWED_ATTRIBUTES = new Set(REQUIRED_ATTRIBUTES);
const EXACT_RELEASE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const COMMAND_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EVIDENCE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const SIGNING_KEY_ID = /^[0-9a-f]{32}$/;
const APPROVAL_SCOPE = "collector-coverage-and-command-lifecycle-metrics";
const REPOSITORY_TRUST_SOURCE = "repository-pinned";
// Repository authority only. Do not accept keys from report data, CLI flags,
// environment variables, or buildCommandLifecycleReport callers.
const REPOSITORY_APPROVAL_PUBLIC_KEYS = Object.freeze({});
const generatorVerificationCache = new Map();

const COVERAGE_FIELDS = new Set([
  "schema",
  "reportSchema",
  "decisionVersion",
  "observation",
  "publicReleases",
  "collector",
]);
const OBSERVATION_FIELDS = new Set([
  "id",
  "startedAt",
  "endedAt",
  "startRelease",
  "endRelease",
]);
const PUBLIC_RELEASE_FIELDS = new Set([
  "version",
  "commitSha",
  "tag",
  "tagPublishedAt",
  "npmPublishedAt",
]);
const DELTA_RELEASE_FIELDS = new Set([
  "version",
  "commitSha",
  "npmPublishedAt",
]);
const COLLECTOR_FIELDS = new Set([
  "eligibleInstallations",
  "reportingInstallations",
  "sampleRate",
  "platforms",
  "knownBiases",
]);
const BIAS_FIELDS = new Set(["id", "description", "blocking"]);
const EXPORT_MANIFEST_FIELDS = new Set([
  "schema",
  "reportSchema",
  "observationId",
  "generatorSha",
  "policySha256",
  "partitions",
]);
const EXPORT_PARTITION_FIELDS = new Set([
  "sequence",
  "id",
  "sha256",
  "startedAt",
  "endedAt",
  "temporality",
]);
const TELEMETRY_EXPORT_FIELDS = new Set(["id", "sha256", "documents"]);
const APPROVAL_FIELDS = new Set([
  "schema",
  "reportSchema",
  "scope",
  "status",
  "attestationId",
  "observationId",
  "decisionVersion",
  "coverageSha256",
  "exportManifestSha256",
  "policySha256",
  "generatorSha",
  "approvedAt",
  "approvedBy",
  "signature",
]);
const APPROVED_BY_FIELDS = new Set(["id", "role"]);
const SIGNATURE_FIELDS = new Set(["algorithm", "keyId", "value"]);

function parseRelease(value) {
  if (typeof value !== "string") return null;
  const match = EXACT_RELEASE.exec(value);
  if (!match) return null;
  return {
    value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

function compareReleases(left, right) {
  const a = typeof left === "string" ? parseRelease(left) : left;
  const b = typeof right === "string" ? parseRelease(right) : right;
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function minorForRelease(value) {
  const release = parseRelease(value);
  return release ? `${release.major}.${release.minor}` : null;
}

function canonicalIso(value) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const normalized = new Date(milliseconds).toISOString();
  return normalized === value ? { value: normalized, milliseconds } : null;
}

function parseNano(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  if (!/^\d+$/.test(String(value))) return null;
  try {
    const nanoseconds = BigInt(value);
    if (nanoseconds <= 0n) return null;
    return {
      nanoseconds,
      milliseconds: Number(nanoseconds / 1_000_000n),
    };
  } catch {
    return null;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function sha256Json(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

export const COMMAND_ALIAS_DECISION_POLICY_SHA256 = sha256Json({
  aliasDecision: COMMAND_ALIAS_DECISION_POLICY,
  deltaRelease: COMMAND_LIFECYCLE_DELTA_RELEASE_POLICY,
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(value, fields) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === fields.size &&
    Object.keys(value).every((key) => fields.has(key)) &&
    [...fields].every((key) => Object.hasOwn(value, key))
  );
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function repositoryPathIdentity(value) {
  const resolved = realpathSync.native(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function runRepositoryGit(args, cwd) {
  try {
    return executionBroker.spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      origin: "command-lifecycle-report:generator-verification",
      policy: "allow",
      scope: "telemetry",
      shell: false,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return { status: null, stdout: "", stderr: "" };
  }
}

function verifyRepositoryGenerator(expectedSha) {
  if (!COMMIT_SHA.test(expectedSha || "")) {
    return { source: null, actualSha: null, verified: false };
  }
  if (generatorVerificationCache.has(expectedSha)) {
    return generatorVerificationCache.get(expectedSha);
  }
  const unavailable = { source: null, actualSha: null, verified: false };
  const packageRoot = path.resolve(import.meta.dirname, "../..");
  const repository = runRepositoryGit(
    ["rev-parse", "--show-toplevel"],
    packageRoot,
  );
  if (repository.status !== 0) return unavailable;
  const repositoryRoot = String(repository.stdout || "").trim();
  try {
    if (
      repositoryPathIdentity(packageRoot) !==
      repositoryPathIdentity(path.join(repositoryRoot, "packages", "cli"))
    ) {
      return unavailable;
    }
  } catch {
    return unavailable;
  }
  const head = runRepositoryGit(["rev-parse", "HEAD"], repositoryRoot);
  if (head.status !== 0) return unavailable;
  const actualSha = String(head.stdout || "")
    .trim()
    .toLowerCase();
  const status = runRepositoryGit(
    [
      "status",
      "--porcelain",
      "--untracked-files=normal",
      "--",
      "packages/cli",
      "docs/cli/COMMAND_LIFECYCLE_TELEMETRY.md",
    ],
    repositoryRoot,
  );
  const verified =
    status.status === 0 &&
    String(status.stdout || "").trim().length === 0 &&
    actualSha === expectedSha;
  const result = {
    source: verified ? "git-head-clean" : null,
    actualSha: COMMIT_SHA.test(actualSha) ? actualSha : null,
    verified,
  };
  // Cache only failures. A successful clean-tree check is an authority fact
  // that must be re-established for every report in a long-lived process.
  if (!verified) generatorVerificationCache.set(expectedSha, result);
  return result;
}

function otlpValue(value) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (Object.hasOwn(value, key)) return value[key];
  }
  if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
    return value.arrayValue.values.map(otlpValue);
  }
  if (value.kvlistValue && Array.isArray(value.kvlistValue.values)) {
    return Object.fromEntries(
      value.kvlistValue.values
        .filter((entry) => typeof entry?.key === "string")
        .map((entry) => [entry.key, otlpValue(entry.value)]),
    );
  }
  if (typeof value.bytesValue === "string") return value.bytesValue;
  return undefined;
}

function attributeMap(items, { lifecycle = false } = {}) {
  if (!Array.isArray(items)) return lifecycle ? null : {};
  const attributes = {};
  for (const item of items) {
    if (
      !item ||
      typeof item.key !== "string" ||
      (lifecycle && !ALLOWED_ATTRIBUTES.has(item.key)) ||
      Object.hasOwn(attributes, item.key)
    ) {
      return null;
    }
    const value = otlpValue(item.value);
    if (value === undefined) return null;
    attributes[item.key] = value;
  }
  return attributes;
}

function pointCount(point, { allowZero = false } = {}) {
  const hasInt = Object.hasOwn(point || {}, "asInt");
  const hasDouble = Object.hasOwn(point || {}, "asDouble");
  if (hasInt === hasDouble) return null;
  const raw = hasInt ? point.asInt : point.asDouble;
  if (
    (hasInt &&
      !(
        (typeof raw === "string" && /^\d+$/.test(raw)) ||
        Number.isSafeInteger(raw)
      )) ||
    (hasDouble && typeof raw !== "number")
  ) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
    ? value
    : null;
}

function metricPayloads(document) {
  if (Array.isArray(document)) {
    return document.flatMap((entry) => metricPayloads(entry));
  }
  if (!document || typeof document !== "object") return [];
  if (document.body) return metricPayloads(document.body);
  if (Array.isArray(document.requests)) {
    return metricPayloads(document.requests);
  }
  return Array.isArray(document.resourceMetrics) ? [document] : [];
}

function lifecycleEntries(manifest) {
  return (manifest?.commands || [])
    .filter(
      (entry) =>
        entry?.lifecycle?.state === "deprecated" &&
        typeof entry.replacement === "string",
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function blankCounts() {
  return { invocations: 0, completed: 0, error: 0 };
}

function blankCommand(entry) {
  return {
    command: entry.name,
    replacement: entry.replacement,
    deprecatedSince: entry.lifecycle.deprecatedSince,
    removalNotBefore: entry.lifecycle.removalNotBefore,
    minimumReleaseCycles: entry.lifecycle.minimumReleaseCycles,
    legacy: blankCounts(),
    replacementRoute: blankCounts(),
    versions: new Set(),
    minors: new Map(),
  };
}

function addInvocation(command, record, count) {
  const route =
    record.route === "legacy" ? command.legacy : command.replacementRoute;
  route.invocations += count;
  route[record.outcome] += count;
  command.versions.add(record.version);

  const minor = minorForRelease(record.version);
  if (!command.minors.has(minor)) {
    command.minors.set(minor, {
      minor,
      legacy: blankCounts(),
      replacementRoute: blankCounts(),
      versions: new Set(),
    });
  }
  const minorBucket = command.minors.get(minor);
  const minorRoute =
    record.route === "legacy"
      ? minorBucket.legacy
      : minorBucket.replacementRoute;
  minorRoute.invocations += count;
  minorRoute[record.outcome] += count;
  minorBucket.versions.add(record.version);
}

function releaseTag(version) {
  return `v-npm-${version.replaceAll(".", "-")}`;
}

function validateCoverage(coverage, policy, generatedAt) {
  const blockers = [];
  if (!hasExactFields(coverage, COVERAGE_FIELDS)) {
    blockers.push("coverage-fields-invalid");
  }
  if (coverage?.schema !== COMMAND_LIFECYCLE_COVERAGE_SCHEMA) {
    blockers.push("coverage-schema-invalid");
  }
  if (coverage?.reportSchema !== COMMAND_LIFECYCLE_REPORT_SCHEMA) {
    blockers.push("coverage-report-schema-unbound");
  }

  const decisionVersion = parseRelease(coverage?.decisionVersion);
  if (!decisionVersion || decisionVersion.prerelease !== null) {
    blockers.push("decision-version-invalid");
  }

  const observation = coverage?.observation || {};
  if (!hasExactFields(observation, OBSERVATION_FIELDS)) {
    blockers.push("observation-fields-invalid");
  }
  const observationId =
    typeof observation.id === "string" && EVIDENCE_ID.test(observation.id)
      ? observation.id
      : null;
  if (!observationId) blockers.push("observation-id-invalid");
  const startedAt = canonicalIso(observation.startedAt);
  const endedAt = canonicalIso(observation.endedAt);
  if (
    !startedAt ||
    !endedAt ||
    endedAt.milliseconds <= startedAt.milliseconds
  ) {
    blockers.push("observation-window-invalid");
  }
  if (
    endedAt &&
    generatedAt &&
    generatedAt.milliseconds < endedAt.milliseconds
  ) {
    blockers.push("report-generated-before-window-end");
  }
  const startRelease = parseRelease(observation.startRelease);
  const endRelease = parseRelease(observation.endRelease);
  if (
    !startRelease ||
    !endRelease ||
    startRelease.prerelease !== null ||
    endRelease.prerelease !== null ||
    compareReleases(startRelease, endRelease) > 0
  ) {
    blockers.push("observation-release-bounds-invalid");
  }
  if (
    decisionVersion &&
    endRelease &&
    compareReleases(decisionVersion, endRelease) !== 0
  ) {
    blockers.push("decision-version-not-bound-to-window-end-release");
  }

  const releases = [];
  const releaseVersions = new Set();
  const releaseTags = new Set();
  let previousRelease = null;
  let previousNpmTime = null;
  for (const item of Array.isArray(coverage?.publicReleases)
    ? coverage.publicReleases
    : []) {
    const version = parseRelease(item?.version);
    const tagPublishedAt = canonicalIso(item?.tagPublishedAt);
    const npmPublishedAt = canonicalIso(item?.npmPublishedAt);
    const valid =
      hasExactFields(item, PUBLIC_RELEASE_FIELDS) &&
      version &&
      version.prerelease === null &&
      typeof item?.commitSha === "string" &&
      COMMIT_SHA.test(item.commitSha) &&
      item?.tag === releaseTag(version.value) &&
      tagPublishedAt &&
      npmPublishedAt &&
      tagPublishedAt.milliseconds <= npmPublishedAt.milliseconds &&
      !releaseVersions.has(version.value) &&
      !releaseTags.has(item.tag);
    if (!valid) {
      blockers.push("public-release-entry-invalid");
      continue;
    }
    if (
      previousRelease &&
      (compareReleases(previousRelease, version) >= 0 ||
        previousNpmTime >= npmPublishedAt.milliseconds)
    ) {
      blockers.push("public-releases-not-strictly-ordered");
    }
    if (
      (startRelease && compareReleases(version, startRelease) < 0) ||
      (endRelease && compareReleases(version, endRelease) > 0) ||
      (startedAt && npmPublishedAt.milliseconds < startedAt.milliseconds) ||
      (endedAt && npmPublishedAt.milliseconds > endedAt.milliseconds)
    ) {
      blockers.push("public-release-outside-observation-window");
    }
    releases.push({
      version: version.value,
      minor: minorForRelease(version.value),
      commitSha: item.commitSha,
      tag: item.tag,
      tagPublishedAt: tagPublishedAt.value,
      npmPublishedAt: npmPublishedAt.value,
      npmPublishedAtMs: npmPublishedAt.milliseconds,
    });
    releaseVersions.add(version.value);
    releaseTags.add(item.tag);
    previousRelease = version;
    previousNpmTime = npmPublishedAt.milliseconds;
  }
  if (!Array.isArray(coverage?.publicReleases)) {
    blockers.push("public-releases-invalid");
  }
  if (releases.length === 0) blockers.push("public-releases-missing");

  for (const release of releases) {
    if (
      COMMAND_LIFECYCLE_DELTA_RELEASE_POLICY.incompatibleReleases.includes(
        release.version,
      )
    ) {
      blockers.push(`delta-evidence-release-incompatible:${release.version}`);
    }
  }
  const configuredDeltaRelease =
    COMMAND_LIFECYCLE_DELTA_RELEASE_POLICY.firstPublicRelease;
  const deltaVersion = parseRelease(configuredDeltaRelease?.version);
  const deltaNpmPublishedAt = canonicalIso(
    configuredDeltaRelease?.npmPublishedAt,
  );
  const deltaPolicyConfigured =
    hasExactFields(configuredDeltaRelease, DELTA_RELEASE_FIELDS) &&
    deltaVersion &&
    deltaVersion.prerelease === null &&
    COMMIT_SHA.test(configuredDeltaRelease.commitSha || "") &&
    deltaNpmPublishedAt;
  if (!deltaPolicyConfigured) {
    blockers.push("delta-release-policy-unconfigured");
  } else {
    if (startRelease?.value !== deltaVersion.value) {
      blockers.push("observation-start-release-not-delta-anchor");
    }
    const anchoredRelease = releases.find(
      (release) => release.version === deltaVersion.value,
    );
    if (
      !anchoredRelease ||
      anchoredRelease.commitSha !== configuredDeltaRelease.commitSha ||
      anchoredRelease.npmPublishedAt !== deltaNpmPublishedAt.value
    ) {
      blockers.push("delta-release-evidence-mismatch");
    }
  }

  const startEvidence = releases.find(
    (release) => release.version === startRelease?.value,
  );
  const endEvidence = releases.find(
    (release) => release.version === endRelease?.value,
  );
  if (!startEvidence || !endEvidence) {
    blockers.push("observation-release-evidence-missing");
  }
  if (
    startEvidence &&
    startedAt &&
    startEvidence.npmPublishedAt !== startedAt.value
  ) {
    blockers.push("observation-start-not-bound-to-npm-release");
  }
  if (
    endEvidence &&
    endedAt &&
    endEvidence.npmPublishedAtMs > endedAt.milliseconds
  ) {
    blockers.push("observation-end-precedes-npm-release");
  }

  const observedMinorCycles = [
    ...new Set(releases.map((release) => release.minor)),
  ];
  if (observedMinorCycles.length < policy.minimumObservedMinorCycles) {
    blockers.push("release-observation-window-incomplete");
  }

  const collector = coverage?.collector || {};
  if (!hasExactFields(collector, COLLECTOR_FIELDS)) {
    blockers.push("collector-fields-invalid");
  }
  const eligibleInstallations = collector.eligibleInstallations;
  const reportingInstallations = collector.reportingInstallations;
  const sampleRate = collector.sampleRate;
  const coverageRatio =
    Number.isSafeInteger(eligibleInstallations) &&
    eligibleInstallations > 0 &&
    Number.isSafeInteger(reportingInstallations) &&
    reportingInstallations >= 0
      ? reportingInstallations / eligibleInstallations
      : 0;
  if (
    !Number.isSafeInteger(eligibleInstallations) ||
    eligibleInstallations < policy.minimumEligibleInstallations
  ) {
    blockers.push("eligible-installation-cohort-too-small");
  }
  if (
    !Number.isSafeInteger(reportingInstallations) ||
    reportingInstallations < policy.minimumReportingInstallations ||
    reportingInstallations > eligibleInstallations
  ) {
    blockers.push("reporting-installation-cohort-too-small");
  }
  if (coverageRatio < policy.minimumCollectorCoverageRatio) {
    blockers.push("collector-coverage-too-low");
  }
  if (
    typeof sampleRate !== "number" ||
    !Number.isFinite(sampleRate) ||
    sampleRate < policy.minimumSampleRate ||
    sampleRate > 1
  ) {
    blockers.push("sample-rate-too-low-or-invalid");
  }

  const platforms = collector.platforms || {};
  if (
    !hasExactFields(platforms, new Set(policy.requiredPlatforms)) ||
    Object.keys(platforms).some(
      (platform) => !policy.requiredPlatforms.includes(platform),
    )
  ) {
    blockers.push("collector-platform-set-invalid");
  }
  let platformInstallationTotal = 0;
  for (const platform of policy.requiredPlatforms) {
    if (
      !Number.isSafeInteger(platforms[platform]) ||
      platforms[platform] <= 0
    ) {
      blockers.push(`platform-coverage-missing:${platform}`);
    } else {
      platformInstallationTotal += platforms[platform];
    }
  }
  if (
    !Number.isSafeInteger(reportingInstallations) ||
    platformInstallationTotal !== reportingInstallations
  ) {
    blockers.push("platform-reporting-installation-total-mismatch");
  }

  const knownBiases = Array.isArray(collector.knownBiases)
    ? collector.knownBiases
    : [];
  if (!Array.isArray(collector.knownBiases)) {
    blockers.push("collector-bias-list-invalid");
  }
  if (knownBiases.length === 0) {
    blockers.push("collector-bias-not-documented");
  }
  for (const bias of knownBiases) {
    if (
      !hasExactFields(bias, BIAS_FIELDS) ||
      typeof bias.id !== "string" ||
      !EVIDENCE_ID.test(bias.id) ||
      typeof bias.description !== "string" ||
      bias.description.trim().length === 0 ||
      typeof bias.blocking !== "boolean"
    ) {
      blockers.push("collector-bias-entry-invalid");
      continue;
    }
    if (bias.blocking === true) {
      blockers.push(`collector-bias-blocking:${bias.id}`);
    }
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
    reportSchema:
      coverage?.reportSchema === COMMAND_LIFECYCLE_REPORT_SCHEMA
        ? coverage.reportSchema
        : null,
    decisionVersion: decisionVersion?.value || null,
    observation: {
      id: observationId,
      startedAt: startedAt?.value || null,
      endedAt: endedAt?.value || null,
      startRelease: startRelease?.value || null,
      endRelease: endRelease?.value || null,
    },
    publicReleases: releases.map((release) => ({
      version: release.version,
      minor: release.minor,
      commitSha: release.commitSha,
      tag: release.tag,
      tagPublishedAt: release.tagPublishedAt,
      npmPublishedAt: release.npmPublishedAt,
    })),
    releaseByVersion: new Map(
      releases.map((release) => [release.version, release]),
    ),
    observedMinorCycles,
    deltaReleasePolicy: {
      configured: Boolean(deltaPolicyConfigured),
      firstPublicRelease: deltaPolicyConfigured
        ? {
            version: deltaVersion.value,
            commitSha: configuredDeltaRelease.commitSha,
            npmPublishedAt: deltaNpmPublishedAt.value,
          }
        : null,
      incompatibleReleases: [
        ...COMMAND_LIFECYCLE_DELTA_RELEASE_POLICY.incompatibleReleases,
      ],
    },
    windowMs:
      startedAt && endedAt
        ? { startedAt: startedAt.milliseconds, endedAt: endedAt.milliseconds }
        : null,
    collector: {
      eligibleInstallations:
        Number.isSafeInteger(eligibleInstallations) &&
        eligibleInstallations >= 0
          ? eligibleInstallations
          : null,
      reportingInstallations:
        Number.isSafeInteger(reportingInstallations) &&
        reportingInstallations >= 0
          ? reportingInstallations
          : null,
      coverageRatio,
      sampleRate: Number.isFinite(sampleRate) ? sampleRate : null,
      platforms: Object.fromEntries(
        policy.requiredPlatforms.map((platform) => [
          platform,
          Number.isSafeInteger(platforms[platform]) && platforms[platform] >= 0
            ? platforms[platform]
            : 0,
        ]),
      ),
      platformInstallationTotal,
      knownBiases: knownBiases
        .filter(
          (bias) =>
            bias &&
            typeof bias.id === "string" &&
            typeof bias.description === "string",
        )
        .map((bias) => ({
          id: bias.id,
          description: bias.description,
          blocking: bias.blocking === true,
        })),
    },
  };
}

function validateTelemetryExports({
  telemetryExports,
  exportManifest,
  exportManifestSha256,
  coverage,
  policySha256,
  generatorSha,
  generatorVerification,
}) {
  const blockers = [];
  if (!hasExactFields(exportManifest, EXPORT_MANIFEST_FIELDS)) {
    blockers.push("export-manifest-fields-invalid");
  }
  if (exportManifest?.schema !== COMMAND_LIFECYCLE_EXPORT_MANIFEST_SCHEMA) {
    blockers.push("export-manifest-schema-invalid");
  }
  if (exportManifest?.reportSchema !== COMMAND_LIFECYCLE_REPORT_SCHEMA) {
    blockers.push("export-manifest-report-schema-unbound");
  }
  if (exportManifest?.observationId !== coverage.observation.id) {
    blockers.push("export-manifest-observation-mismatch");
  }
  if (
    typeof exportManifestSha256 !== "string" ||
    !SHA256.test(exportManifestSha256)
  ) {
    blockers.push("export-manifest-file-digest-invalid");
  }
  if (
    typeof generatorSha !== "string" ||
    !COMMIT_SHA.test(generatorSha) ||
    exportManifest?.generatorSha !== generatorSha
  ) {
    blockers.push("export-manifest-generator-sha-mismatch");
  }
  if (
    generatorVerification?.source !== "git-head-clean" ||
    generatorVerification?.verified !== true ||
    generatorVerification?.actualSha !== generatorSha
  ) {
    blockers.push("report-generator-source-unverified");
  }
  if (exportManifest?.policySha256 !== policySha256) {
    blockers.push("export-manifest-policy-digest-mismatch");
  }

  const partitions = [];
  const ids = new Set();
  const digests = new Set();
  let previousEnd = null;
  const manifestPartitions = Array.isArray(exportManifest?.partitions)
    ? exportManifest.partitions
    : [];
  if (!Array.isArray(exportManifest?.partitions)) {
    blockers.push("export-manifest-partitions-invalid");
  }
  if (manifestPartitions.length === 0) {
    blockers.push("export-manifest-partitions-missing");
  }
  for (let index = 0; index < manifestPartitions.length; index += 1) {
    const item = manifestPartitions[index];
    const startedAt = canonicalIso(item?.startedAt);
    const endedAt = canonicalIso(item?.endedAt);
    const valid =
      hasExactFields(item, EXPORT_PARTITION_FIELDS) &&
      item.sequence === index &&
      typeof item.id === "string" &&
      EVIDENCE_ID.test(item.id) &&
      typeof item.sha256 === "string" &&
      SHA256.test(item.sha256) &&
      startedAt &&
      endedAt &&
      startedAt.milliseconds < endedAt.milliseconds &&
      ["delta", "cumulative"].includes(item.temporality);
    if (!valid) {
      blockers.push("export-manifest-partition-invalid");
      continue;
    }
    if (ids.has(item.id)) blockers.push("duplicate-telemetry-export-id");
    if (digests.has(item.sha256)) {
      blockers.push("duplicate-telemetry-export-digest");
    }
    if (previousEnd !== null && startedAt.milliseconds !== previousEnd) {
      blockers.push(
        startedAt.milliseconds < previousEnd
          ? "export-manifest-partitions-overlap"
          : "export-manifest-partition-gap",
      );
    }
    if (
      coverage.windowMs &&
      (startedAt.milliseconds < coverage.windowMs.startedAt ||
        endedAt.milliseconds > coverage.windowMs.endedAt)
    ) {
      blockers.push("export-manifest-partition-outside-observation-window");
    }
    ids.add(item.id);
    digests.add(item.sha256);
    previousEnd = endedAt.milliseconds;
    partitions.push({
      sequence: item.sequence,
      id: item.id,
      sha256: item.sha256,
      startedAt: startedAt.value,
      endedAt: endedAt.value,
      startedAtMs: startedAt.milliseconds,
      endedAtMs: endedAt.milliseconds,
      temporality: item.temporality,
    });
  }
  if (
    coverage.windowMs &&
    (partitions[0]?.startedAtMs !== coverage.windowMs.startedAt ||
      partitions.at(-1)?.endedAtMs !== coverage.windowMs.endedAt)
  ) {
    blockers.push("export-manifest-does-not-cover-observation-window");
  }

  const exports = Array.isArray(telemetryExports) ? telemetryExports : [];
  if (!Array.isArray(telemetryExports)) {
    blockers.push("telemetry-export-set-invalid");
  }
  if (exports.length !== manifestPartitions.length) {
    blockers.push("telemetry-export-set-does-not-match-manifest");
  }
  const normalized = [];
  for (let index = 0; index < exports.length; index += 1) {
    const item = exports[index];
    const partition = partitions.find((entry) => entry.sequence === index);
    if (
      !hasExactFields(item, TELEMETRY_EXPORT_FIELDS) ||
      typeof item?.id !== "string" ||
      !EVIDENCE_ID.test(item.id) ||
      typeof item?.sha256 !== "string" ||
      !SHA256.test(item.sha256) ||
      !Array.isArray(item?.documents)
    ) {
      blockers.push("telemetry-export-evidence-invalid");
      continue;
    }
    if (
      !partition ||
      partition.id !== item.id ||
      partition.sha256 !== item.sha256
    ) {
      blockers.push("telemetry-export-set-does-not-match-manifest");
      continue;
    }
    normalized.push({
      id: item.id,
      sha256: item.sha256,
      documents: item.documents,
      partition,
    });
  }
  return {
    blockers: sortedUnique(blockers),
    exports: normalized,
    manifest: {
      schema:
        exportManifest?.schema === COMMAND_LIFECYCLE_EXPORT_MANIFEST_SCHEMA
          ? exportManifest.schema
          : null,
      sha256:
        typeof exportManifestSha256 === "string" &&
        SHA256.test(exportManifestSha256)
          ? exportManifestSha256
          : null,
      observationId:
        typeof exportManifest?.observationId === "string"
          ? exportManifest.observationId
          : null,
      generatorSha:
        typeof exportManifest?.generatorSha === "string"
          ? exportManifest.generatorSha
          : null,
      policySha256:
        typeof exportManifest?.policySha256 === "string"
          ? exportManifest.policySha256
          : null,
      generatorVerification: {
        source:
          generatorVerification?.source === "git-head-clean"
            ? generatorVerification.source
            : null,
        actualSha: COMMIT_SHA.test(generatorVerification?.actualSha || "")
          ? generatorVerification.actualSha
          : null,
        verified: generatorVerification?.verified === true,
      },
      partitions,
    },
  };
}

function repositoryApprovalKey(keyId) {
  if (
    !SIGNING_KEY_ID.test(keyId || "") ||
    !Object.hasOwn(REPOSITORY_APPROVAL_PUBLIC_KEYS, keyId)
  ) {
    return null;
  }
  return REPOSITORY_APPROVAL_PUBLIC_KEYS[keyId];
}

function validateApproval({
  approval,
  approvalSha256,
  coverageSha256,
  exportManifestSha256,
  coverage,
  policySha256,
  generatorSha,
  generatedAt,
  now,
}) {
  const blockers = [];
  if (!hasExactFields(approval, APPROVAL_FIELDS)) {
    blockers.push("approval-attestation-missing");
    if (approval && typeof approval === "object") {
      blockers.push("approval-fields-invalid");
    }
  }
  if (approval?.schema !== COMMAND_LIFECYCLE_APPROVAL_SCHEMA) {
    blockers.push("approval-schema-invalid");
  }
  if (approval?.reportSchema !== COMMAND_LIFECYCLE_REPORT_SCHEMA) {
    blockers.push("approval-report-schema-unbound");
  }
  if (approval?.scope !== APPROVAL_SCOPE) {
    blockers.push("approval-scope-invalid");
  }
  if (approval?.status !== "approved") {
    blockers.push("approval-not-approved");
  }
  if (typeof approvalSha256 !== "string" || !SHA256.test(approvalSha256)) {
    blockers.push("approval-file-digest-invalid");
  }
  if (typeof coverageSha256 !== "string" || !SHA256.test(coverageSha256)) {
    blockers.push("coverage-file-digest-invalid");
  }
  if (approval?.coverageSha256 !== coverageSha256) {
    blockers.push("approval-coverage-digest-mismatch");
  }
  if (approval?.exportManifestSha256 !== exportManifestSha256) {
    blockers.push("approval-export-manifest-digest-mismatch");
  }
  if (approval?.policySha256 !== policySha256) {
    blockers.push("approval-policy-digest-mismatch");
  }
  if (
    typeof generatorSha !== "string" ||
    !COMMIT_SHA.test(generatorSha) ||
    approval?.generatorSha !== generatorSha
  ) {
    blockers.push("approval-generator-sha-mismatch");
  }
  if (approval?.observationId !== coverage.observation.id) {
    blockers.push("approval-observation-mismatch");
  }
  if (approval?.decisionVersion !== coverage.decisionVersion) {
    blockers.push("approval-decision-version-mismatch");
  }
  if (
    typeof approval?.attestationId !== "string" ||
    !EVIDENCE_ID.test(approval.attestationId)
  ) {
    blockers.push("approval-attestation-id-invalid");
  }
  const approvedAt = canonicalIso(approval?.approvedAt);
  if (!approvedAt) {
    blockers.push("approval-timestamp-invalid");
  } else {
    const endedAt = canonicalIso(coverage.observation.endedAt);
    if (endedAt && approvedAt.milliseconds < endedAt.milliseconds) {
      blockers.push("approval-precedes-observation-window-end");
    }
    if (generatedAt && approvedAt.milliseconds > generatedAt.milliseconds) {
      blockers.push("approval-after-report-generation");
    }
    if (now && approvedAt.milliseconds > now.milliseconds) {
      blockers.push("approval-timestamp-in-future");
    }
  }
  if (
    !hasExactFields(approval?.approvedBy, APPROVED_BY_FIELDS) ||
    typeof approval?.approvedBy?.id !== "string" ||
    approval.approvedBy.id.trim().length === 0 ||
    typeof approval?.approvedBy?.role !== "string" ||
    approval.approvedBy.role.trim().length === 0
  ) {
    blockers.push("approval-reviewer-invalid");
  }

  const signature = approval?.signature;
  const signatureShapeValid =
    hasExactFields(signature, SIGNATURE_FIELDS) &&
    signature.algorithm === "ed25519" &&
    SIGNING_KEY_ID.test(signature.keyId || "") &&
    typeof signature.value === "string";
  if (!signatureShapeValid) {
    blockers.push("approval-signature-invalid");
  } else if (Object.keys(REPOSITORY_APPROVAL_PUBLIC_KEYS).length === 0) {
    blockers.push("approval-signature-trust-unavailable");
  } else {
    const publicKey = repositoryApprovalKey(signature.keyId);
    if (!publicKey) {
      blockers.push("approval-signing-key-untrusted");
    } else {
      try {
        verifyPackUpdateManifest(approval, publicKey);
      } catch {
        blockers.push("approval-signature-invalid");
      }
    }
  }
  if (generatedAt && now && generatedAt.milliseconds > now.milliseconds) {
    blockers.push("report-generated-in-future");
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
    sha256:
      typeof approvalSha256 === "string" && SHA256.test(approvalSha256)
        ? approvalSha256
        : null,
    schema:
      approval?.schema === COMMAND_LIFECYCLE_APPROVAL_SCHEMA
        ? approval.schema
        : null,
    status: typeof approval?.status === "string" ? approval.status : null,
    scope: approval?.scope === APPROVAL_SCOPE ? approval.scope : null,
    attestationId:
      typeof approval?.attestationId === "string"
        ? approval.attestationId
        : null,
    approvedAt: approvedAt?.value || null,
    approvedBy:
      typeof approval?.approvedBy?.id === "string" &&
      typeof approval?.approvedBy?.role === "string"
        ? { id: approval.approvedBy.id, role: approval.approvedBy.role }
        : null,
    signature: signatureShapeValid
      ? {
          algorithm: signature.algorithm,
          keyId: signature.keyId,
          verified: !blockers.some((blocker) =>
            [
              "approval-signature-invalid",
              "approval-signature-trust-unavailable",
              "approval-signing-key-untrusted",
            ].includes(blocker),
          ),
          trustSource:
            Object.keys(REPOSITORY_APPROVAL_PUBLIC_KEYS).length > 0
              ? REPOSITORY_TRUST_SOURCE
              : null,
        }
      : null,
  };
}

function pointRecord({ point, metric, command, coverage, partition }) {
  const attributes = attributeMap(point?.attributes, { lifecycle: true });
  const temporality = metric?.sum?.aggregationTemporality;
  const count = pointCount(point, { allowZero: temporality === 2 });
  const version = attributes?.["cli.version"];
  const release = coverage.releaseByVersion.get(version);
  const time = parseNano(point?.timeUnixNano);
  const startTime = parseNano(point?.startTimeUnixNano);
  const valid =
    attributes &&
    REQUIRED_ATTRIBUTES.every((key) => Object.hasOwn(attributes, key)) &&
    Object.keys(attributes).length === REQUIRED_ATTRIBUTES.length &&
    REQUIRED_ATTRIBUTES.every((key) => typeof attributes[key] === "string") &&
    count !== null &&
    command &&
    COMMAND_NAME.test(attributes["command.name"]) &&
    ["legacy", "replacement"].includes(attributes["command.route"]) &&
    ["completed", "error"].includes(attributes["command.outcome"]) &&
    release &&
    attributes["command.deprecated_since"] === command?.deprecatedSince &&
    attributes["command.removal_not_before"] === command?.removalNotBefore &&
    metric?.sum?.isMonotonic === true &&
    [1, 2].includes(temporality) &&
    partition &&
    partition.temporality === (temporality === 1 ? "delta" : "cumulative") &&
    time &&
    coverage.windowMs &&
    time.milliseconds >= coverage.windowMs.startedAt &&
    time.milliseconds <= coverage.windowMs.endedAt &&
    time.milliseconds >= partition.startedAtMs &&
    time.milliseconds < partition.endedAtMs &&
    time.milliseconds >= release?.npmPublishedAtMs &&
    (temporality !== 2 ||
      (startTime &&
        startTime.nanoseconds <= time.nanoseconds &&
        startTime.milliseconds >= release?.npmPublishedAtMs));
  if (!valid) return null;

  const identity = {
    metric: metric.name,
    attributes,
    temporality,
    startTimeUnixNano: startTime?.nanoseconds.toString() || null,
    timeUnixNano: time.nanoseconds.toString(),
  };
  return {
    command,
    route: attributes["command.route"],
    outcome: attributes["command.outcome"],
    version,
    count,
    temporality,
    startTimeUnixNano: startTime?.nanoseconds || null,
    timeUnixNano: time.nanoseconds,
    pointKey: sha256Json(identity),
    fingerprint: sha256Json({ ...identity, count }),
    series: sha256Json({
      metric: metric.name,
      attributes,
      startTimeUnixNano: startTime?.nanoseconds.toString() || null,
    }),
    baseSeries: sha256Json({
      metric: metric.name,
      attributes,
    }),
  };
}

function aggregateTelemetry({ exports: telemetryExports, commands, coverage }) {
  const violations = [];
  const records = [];
  const pointOccurrences = new Map();
  let payloadCount = 0;
  let acceptedPoints = 0;
  let rejectedPoints = 0;
  let duplicatePoints = 0;

  for (const source of telemetryExports) {
    for (const document of source.documents) {
      for (const payload of metricPayloads(document)) {
        payloadCount += 1;
        for (const resource of payload.resourceMetrics || []) {
          for (const scope of resource.scopeMetrics || []) {
            for (const metric of scope.metrics || []) {
              if (metric?.name !== COMMAND_LIFECYCLE_INVOCATION_METRIC)
                continue;
              if (!metric.sum || !Array.isArray(metric.sum.dataPoints)) {
                rejectedPoints += 1;
                violations.push("invalid-lifecycle-metric-shape");
                continue;
              }
              for (const point of metric.sum.dataPoints) {
                const attributes = attributeMap(point?.attributes, {
                  lifecycle: true,
                });
                const command = attributes
                  ? commands.get(attributes["command.name"])
                  : null;
                const record = pointRecord({
                  point,
                  metric,
                  command,
                  coverage,
                  partition: source.partition,
                });
                if (!record) {
                  rejectedPoints += 1;
                  violations.push("invalid-lifecycle-metric-point");
                  continue;
                }
                const occurrence = pointOccurrences.get(record.pointKey);
                if (occurrence) {
                  occurrence.occurrences += 1;
                  if (occurrence.record.fingerprint !== record.fingerprint) {
                    occurrence.conflicting = true;
                  } else {
                    duplicatePoints += 1;
                    if (record.temporality === 1) {
                      occurrence.conflicting = true;
                      occurrence.duplicateDelta = true;
                    }
                  }
                  continue;
                }
                pointOccurrences.set(record.pointKey, {
                  record,
                  occurrences: 1,
                  conflicting: false,
                  duplicateDelta: false,
                });
              }
            }
          }
        }
      }
    }
  }

  for (const occurrence of pointOccurrences.values()) {
    if (occurrence.conflicting) {
      rejectedPoints += occurrence.occurrences;
      violations.push(
        occurrence.duplicateDelta
          ? "duplicate-delta-lifecycle-metric-point"
          : "ambiguous-lifecycle-metric-point",
      );
      continue;
    }
    records.push(occurrence.record);
    acceptedPoints += 1;
  }

  let countedInvocations = 0;
  for (const record of records.filter((item) => item.temporality === 1)) {
    addInvocation(record.command, record, record.count);
    countedInvocations += record.count;
  }

  const cumulativeSeries = new Map();
  for (const record of records.filter((item) => item.temporality === 2)) {
    if (!cumulativeSeries.has(record.series))
      cumulativeSeries.set(record.series, []);
    cumulativeSeries.get(record.series).push(record);
  }
  const cumulativeSegments = [];
  for (const series of cumulativeSeries.values()) {
    let previous = null;
    let latest = null;
    let invalid = false;
    for (const record of series) {
      if (
        previous &&
        (record.timeUnixNano <= previous.timeUnixNano ||
          record.count < previous.count)
      ) {
        invalid = true;
        break;
      }
      previous = record;
      latest = record;
    }
    if (invalid || !latest) {
      rejectedPoints += series.length;
      acceptedPoints -= series.length;
      violations.push("cumulative-lifecycle-series-invalid");
      continue;
    }
    cumulativeSegments.push({
      baseSeries: latest.baseSeries,
      startTimeUnixNano: latest.startTimeUnixNano,
      lastTimeUnixNano: latest.timeUnixNano,
      latest,
      pointCount: series.length,
    });
  }

  const segmentsByBaseSeries = new Map();
  for (const segment of cumulativeSegments) {
    if (!segmentsByBaseSeries.has(segment.baseSeries)) {
      segmentsByBaseSeries.set(segment.baseSeries, []);
    }
    segmentsByBaseSeries.get(segment.baseSeries).push(segment);
  }
  for (const segments of segmentsByBaseSeries.values()) {
    let previous = null;
    const resetOverlap = segments.some((segment) => {
      const overlaps =
        previous && segment.startTimeUnixNano <= previous.lastTimeUnixNano;
      previous = segment;
      return overlaps;
    });
    if (resetOverlap) {
      const points = segments.reduce(
        (total, segment) => total + segment.pointCount,
        0,
      );
      rejectedPoints += points;
      acceptedPoints -= points;
      violations.push("cumulative-lifecycle-reset-overlap");
      continue;
    }
    for (const segment of segments) {
      addInvocation(
        segment.latest.command,
        segment.latest,
        segment.latest.count,
      );
      countedInvocations += segment.latest.count;
    }
  }

  if (acceptedPoints === 0) violations.push("no-lifecycle-metric-points");
  if (countedInvocations === 0) violations.push("no-lifecycle-invocations");
  return {
    payloadCount,
    acceptedPoints,
    rejectedPoints,
    duplicatePoints,
    countedInvocations,
    violations: [...new Set(violations)].sort(),
  };
}

function decisionFor(command, coverage, evidenceReady, ingestionReady, policy) {
  const total =
    command.legacy.invocations + command.replacementRoute.invocations;
  const legacyShare = total > 0 ? command.legacy.invocations / total : null;
  const reasons = [];
  const removalComparison = compareReleases(
    coverage.decisionVersion,
    command.removalNotBefore,
  );
  if (!coverage.ready) reasons.push(...coverage.blockers);
  if (!evidenceReady) reasons.push("evidence-bundle-unapproved");
  if (!ingestionReady) reasons.push("telemetry-input-invalid");
  if (removalComparison === null || removalComparison < 0) {
    reasons.push("removal-version-not-reached");
  }

  const observedCycles = [...command.minors.values()]
    .filter(
      (minor) =>
        minor.legacy.invocations + minor.replacementRoute.invocations > 0,
    )
    .map((minor) => minor.minor)
    .sort();
  if (observedCycles.length < command.minimumReleaseCycles) {
    reasons.push("command-release-window-incomplete");
  }
  if (total < policy.minimumCommandInvocations) {
    reasons.push("command-sample-too-small");
  }

  if (reasons.length > 0) {
    return {
      decision: "insufficient-data",
      aliasAction: "retain",
      reasons: [...new Set(reasons)].sort(),
      totalInvocations: total,
      legacyShare,
      observedMinorCycles: observedCycles,
    };
  }

  if (legacyShare > policy.maximumLegacyShareForRemoval) {
    return {
      decision: "retain",
      aliasAction: "retain",
      reasons: ["legacy-usage-above-removal-threshold"],
      totalInvocations: total,
      legacyShare,
      observedMinorCycles: observedCycles,
    };
  }
  if (
    command.replacementRoute.invocations < policy.minimumReplacementInvocations
  ) {
    return {
      decision: "insufficient-data",
      aliasAction: "retain",
      reasons: ["replacement-sample-too-small"],
      totalInvocations: total,
      legacyShare,
      observedMinorCycles: observedCycles,
    };
  }
  return {
    decision: "remove",
    aliasAction: "remove",
    reasons: ["compatibility-window-and-usage-thresholds-satisfied"],
    totalInvocations: total,
    legacyShare,
    observedMinorCycles: observedCycles,
  };
}

export function buildCommandLifecycleReport({
  telemetryExports = [],
  manifest,
  coverage,
  coverageSha256,
  exportManifest,
  exportManifestSha256,
  generatorSha,
  approval,
  approvalSha256,
  generatedAt = new Date().toISOString(),
} = {}) {
  const entries = lifecycleEntries(manifest);
  if (entries.length === 0) {
    throw new Error("command manifest has no deprecated compatibility entries");
  }
  const generated = canonicalIso(generatedAt);
  if (!generated)
    throw new Error("generatedAt must be a canonical ISO timestamp");
  const currentTime = canonicalIso(new Date().toISOString());
  const policy = COMMAND_ALIAS_DECISION_POLICY;
  const policySha256 = COMMAND_ALIAS_DECISION_POLICY_SHA256;
  const generatorVerification = verifyRepositoryGenerator(generatorSha);

  const byCommand = new Map(
    entries.map((entry) => [entry.name, blankCommand(entry)]),
  );
  const coverageResult = validateCoverage(coverage, policy, generated);
  const exportResult = validateTelemetryExports({
    telemetryExports,
    exportManifest,
    exportManifestSha256,
    coverage: coverageResult,
    policySha256,
    generatorSha,
    generatorVerification,
  });
  const approvalResult = validateApproval({
    approval,
    approvalSha256,
    coverageSha256,
    exportManifestSha256,
    coverage: coverageResult,
    policySha256,
    generatorSha,
    generatedAt: generated,
    now: currentTime,
  });
  const ingestion = aggregateTelemetry({
    exports: exportResult.exports,
    commands: byCommand,
    coverage: coverageResult,
  });
  ingestion.violations = [
    ...new Set([...exportResult.blockers, ...ingestion.violations]),
  ].sort();
  ingestion.ready =
    exportResult.blockers.length === 0 &&
    ingestion.rejectedPoints === 0 &&
    ingestion.acceptedPoints > 0 &&
    ingestion.countedInvocations > 0;

  const evidenceReady =
    exportResult.blockers.length === 0 && approvalResult.ready;
  const formalObservation =
    coverageResult.ready && evidenceReady && ingestion.ready
      ? "approved-evidence"
      : "insufficient-data";
  const decisions = [...byCommand.values()].map((command) => {
    const recommendation = decisionFor(
      command,
      coverageResult,
      evidenceReady,
      ingestion.ready,
      policy,
    );
    return {
      command: command.command,
      replacement: command.replacement,
      deprecatedSince: command.deprecatedSince,
      removalNotBefore: command.removalNotBefore,
      legacy: command.legacy,
      replacementRoute: command.replacementRoute,
      minorCycles: coverageResult.observedMinorCycles.map((minor) => {
        const value = command.minors.get(minor);
        return {
          minor,
          versions: value
            ? [...value.versions].sort((left, right) =>
                compareReleases(left, right),
              )
            : [],
          legacy: value?.legacy || blankCounts(),
          replacementRoute: value?.replacementRoute || blankCounts(),
        };
      }),
      observedVersions: [...command.versions].sort((left, right) =>
        compareReleases(left, right),
      ),
      ...recommendation,
    };
  });
  const summary = decisions.reduce(
    (result, item) => {
      result.decisions[item.decision] += 1;
      result.aliasActions[item.aliasAction] += 1;
      return result;
    },
    {
      decisions: { retain: 0, remove: 0, "insufficient-data": 0 },
      aliasActions: { retain: 0, remove: 0 },
    },
  );

  return {
    schema: COMMAND_LIFECYCLE_REPORT_SCHEMA,
    generatedAt: generated.value,
    formalObservation,
    manifestSchema: manifest?.schema || null,
    observation: coverageResult.observation,
    policy: {
      ...policy,
      requiredPlatforms: [...policy.requiredPlatforms],
      deltaRelease: coverageResult.deltaReleasePolicy,
      sha256: policySha256,
    },
    evidence: {
      ready: evidenceReady,
      coverage: {
        sha256:
          typeof coverageSha256 === "string" && SHA256.test(coverageSha256)
            ? coverageSha256
            : null,
      },
      exportManifest: exportResult.manifest,
      telemetryExports: exportResult.exports.map(
        ({ id, sha256, documents, partition }) => ({
          sequence: partition.sequence,
          id,
          sha256,
          documentCount: documents.length,
          startedAt: partition.startedAt,
          endedAt: partition.endedAt,
          temporality: partition.temporality,
        }),
      ),
      approval: approvalResult,
    },
    releases: coverageResult.publicReleases,
    coverage: {
      ready: coverageResult.ready,
      blockers: coverageResult.blockers,
      reportSchema: coverageResult.reportSchema,
      decisionVersion: coverageResult.decisionVersion,
      observedMinorCycles: coverageResult.observedMinorCycles,
      deltaReleasePolicy: coverageResult.deltaReleasePolicy,
      collector: coverageResult.collector,
    },
    ingestion,
    summary,
    decisions,
  };
}

export function renderCommandLifecycleReportMarkdown(report) {
  const lines = [
    "# CLI command lifecycle decision report",
    "",
    `Schema: \`${report.schema}\``,
    `Generated: ${report.generatedAt}`,
    `Observation: \`${report.observation.id || "invalid"}\` (${report.observation.startedAt || "invalid"} to ${report.observation.endedAt || "invalid"})`,
    "",
    `Coverage ready: **${report.coverage.ready ? "yes" : "no"}**`,
    `Evidence approved: **${report.evidence.ready ? "yes" : "no"}**`,
    `Telemetry input ready: **${report.ingestion.ready ? "yes" : "no"}**`,
    `Adoption evidence: **${report.formalObservation}**`,
    `Decisions: ${report.summary.decisions.remove} remove, ${report.summary.decisions.retain} retain, ${report.summary.decisions["insufficient-data"]} insufficient-data.`,
    `Alias actions: ${report.summary.aliasActions.remove} remove, ${report.summary.aliasActions.retain} retain.`,
    "",
  ];
  if (report.coverage.blockers.length > 0) {
    lines.push(
      "Coverage blockers: " +
        report.coverage.blockers.map((item) => `\`${item}\``).join(", "),
      "",
    );
  }
  if (report.evidence.approval.blockers.length > 0) {
    lines.push(
      "Evidence blockers: " +
        report.evidence.approval.blockers
          .map((item) => `\`${item}\``)
          .join(", "),
      "",
    );
  }
  if (report.ingestion.violations.length > 0) {
    lines.push(
      "Input violations: " +
        report.ingestion.violations.map((item) => `\`${item}\``).join(", "),
      "",
    );
  }
  lines.push(
    "| Legacy entry | Replacement | Legacy | Replacement | Per-minor L/R | Legacy share | Decision | Alias action | Reasons |",
    "| --- | --- | ---: | ---: | --- | ---: | --- | --- | --- |",
  );
  for (const item of report.decisions) {
    const minorMetrics = item.minorCycles
      .map(
        (minor) =>
          `${minor.minor}: ${minor.legacy.invocations}/${minor.replacementRoute.invocations}`,
      )
      .join("; ");
    lines.push(
      `| \`${item.command}\` | \`${item.replacement}\` | ${item.legacy.invocations} | ${item.replacementRoute.invocations} | ${minorMetrics || "n/a"} | ${item.legacyShare === null ? "n/a" : `${(item.legacyShare * 100).toFixed(2)}%`} | **${item.decision}** | **${item.aliasAction}** | ${item.reasons.join(", ")} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
