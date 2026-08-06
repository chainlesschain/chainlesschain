/**
 * Privacy-preserving command lifecycle telemetry aggregation.
 *
 * The runtime emits one content-free OTLP metric for each migrated command
 * invocation. This module consumes those OTLP payloads and combines them with
 * an explicit collector coverage statement. Alias removal is fail-closed:
 * missing release cycles, weak coverage, undocumented sampling bias or invalid
 * metric points can only produce `insufficient-data`.
 */

export const COMMAND_LIFECYCLE_REPORT_SCHEMA =
  "chainlesschain.command-lifecycle-report.v1";
export const COMMAND_LIFECYCLE_COVERAGE_SCHEMA =
  "chainlesschain.command-lifecycle-coverage.v1";
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

function otlpValue(value) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (Object.hasOwn(value, key)) return value[key];
  }
  return undefined;
}

function attributesFor(point) {
  if (!Array.isArray(point?.attributes)) return null;
  const attributes = {};
  for (const item of point.attributes) {
    if (
      !item ||
      typeof item.key !== "string" ||
      !ALLOWED_ATTRIBUTES.has(item.key) ||
      Object.hasOwn(attributes, item.key)
    ) {
      return null;
    }
    attributes[item.key] = otlpValue(item.value);
  }
  return attributes;
}

function pointCount(point) {
  const raw = Object.hasOwn(point || {}, "asInt")
    ? point.asInt
    : point?.asDouble;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
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

function blankCommand(entry) {
  return {
    command: entry.name,
    replacement: entry.replacement,
    deprecatedSince: entry.lifecycle.deprecatedSince,
    removalNotBefore: entry.lifecycle.removalNotBefore,
    minimumReleaseCycles: entry.lifecycle.minimumReleaseCycles,
    legacy: { invocations: 0, completed: 0, error: 0 },
    replacementRoute: { invocations: 0, completed: 0, error: 0 },
    versions: new Set(),
  };
}

function validateCoverage(coverage, policy) {
  const blockers = [];
  if (coverage?.schema !== COMMAND_LIFECYCLE_COVERAGE_SCHEMA) {
    blockers.push("coverage-schema-invalid");
  }

  const decisionVersion = parseRelease(coverage?.decisionVersion);
  if (!decisionVersion) blockers.push("decision-version-invalid");

  const observedReleases = Array.isArray(coverage?.observedReleases)
    ? coverage.observedReleases.map(parseRelease)
    : [];
  if (
    observedReleases.length === 0 ||
    observedReleases.some((release) => !release)
  ) {
    blockers.push("observed-releases-invalid");
  }
  const observedMinorCycles = new Set(
    observedReleases
      .filter(Boolean)
      .map((release) => `${release.major}.${release.minor}`),
  );
  if (observedMinorCycles.size < policy.minimumObservedMinorCycles) {
    blockers.push("release-observation-window-incomplete");
  }

  const startMs = Date.parse(coverage?.window?.startedAt || "");
  const endMs = Date.parse(coverage?.window?.endedAt || "");
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    blockers.push("observation-window-invalid");
  }

  const collector = coverage?.collector || {};
  const eligibleInstallations = Number(collector.eligibleInstallations);
  const reportingInstallations = Number(collector.reportingInstallations);
  const sampleRate = Number(collector.sampleRate);
  const coverageRatio =
    Number.isFinite(eligibleInstallations) && eligibleInstallations > 0
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
    !Number.isFinite(sampleRate) ||
    sampleRate < policy.minimumSampleRate ||
    sampleRate > 1
  ) {
    blockers.push("sample-rate-too-low-or-invalid");
  }

  const platforms = collector.platforms || {};
  for (const platform of policy.requiredPlatforms) {
    if (
      !Number.isSafeInteger(platforms[platform]) ||
      platforms[platform] <= 0
    ) {
      blockers.push(`platform-coverage-missing:${platform}`);
    }
  }

  const knownBiases = Array.isArray(collector.knownBiases)
    ? collector.knownBiases
    : [];
  if (knownBiases.length === 0) {
    blockers.push("collector-bias-not-documented");
  }
  for (const bias of knownBiases) {
    if (
      !bias ||
      typeof bias.id !== "string" ||
      typeof bias.description !== "string"
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
    decisionVersion: decisionVersion?.value || null,
    observedReleases: observedReleases
      .filter(Boolean)
      .map((release) => release.value),
    observedMinorCycles: [...observedMinorCycles].sort(),
    window: {
      startedAt: Number.isFinite(startMs)
        ? new Date(startMs).toISOString()
        : null,
      endedAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    },
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

function decisionFor(command, coverage, ingestionReady, policy) {
  const total =
    command.legacy.invocations + command.replacementRoute.invocations;
  const legacyShare = total > 0 ? command.legacy.invocations / total : null;
  const reasons = [];
  const removalComparison = compareReleases(
    coverage.decisionVersion,
    command.removalNotBefore,
  );
  if (!coverage.ready) reasons.push(...coverage.blockers);
  if (!ingestionReady) reasons.push("telemetry-input-invalid");
  if (removalComparison === null || removalComparison < 0) {
    reasons.push("removal-version-not-reached");
  }

  const observedForCommand = coverage.observedReleases.filter((version) => {
    const afterDeprecation = compareReleases(version, command.deprecatedSince);
    const beforeDecision = compareReleases(version, coverage.decisionVersion);
    return (
      afterDeprecation !== null && afterDeprecation >= 0 && beforeDecision <= 0
    );
  });
  const observedCycles = new Set(
    observedForCommand.map((version) => {
      const parsed = parseRelease(version);
      return `${parsed.major}.${parsed.minor}`;
    }),
  );
  if (observedCycles.size < command.minimumReleaseCycles) {
    reasons.push("command-release-window-incomplete");
  }
  if (total < policy.minimumCommandInvocations) {
    reasons.push("command-sample-too-small");
  }

  if (reasons.length > 0) {
    return {
      decision: "insufficient-data",
      reasons: [...new Set(reasons)].sort(),
      totalInvocations: total,
      legacyShare,
      observedMinorCycles: [...observedCycles].sort(),
    };
  }

  if (legacyShare > policy.maximumLegacyShareForRemoval) {
    return {
      decision: "retain",
      reasons: ["legacy-usage-above-removal-threshold"],
      totalInvocations: total,
      legacyShare,
      observedMinorCycles: [...observedCycles].sort(),
    };
  }
  if (
    command.replacementRoute.invocations < policy.minimumReplacementInvocations
  ) {
    return {
      decision: "insufficient-data",
      reasons: ["replacement-sample-too-small"],
      totalInvocations: total,
      legacyShare,
      observedMinorCycles: [...observedCycles].sort(),
    };
  }
  return {
    decision: "remove",
    reasons: ["compatibility-window-and-usage-thresholds-satisfied"],
    totalInvocations: total,
    legacyShare,
    observedMinorCycles: [...observedCycles].sort(),
  };
}

export function buildCommandLifecycleReport({
  documents = [],
  manifest,
  coverage,
  generatedAt = new Date().toISOString(),
  policy = COMMAND_ALIAS_DECISION_POLICY,
} = {}) {
  const entries = lifecycleEntries(manifest);
  if (entries.length === 0) {
    throw new Error("command manifest has no deprecated compatibility entries");
  }
  const byCommand = new Map(
    entries.map((entry) => [entry.name, blankCommand(entry)]),
  );
  const violations = [];
  let acceptedPoints = 0;
  let rejectedPoints = 0;
  let payloadCount = 0;

  for (const payload of metricPayloads(documents)) {
    payloadCount += 1;
    for (const resource of payload.resourceMetrics || []) {
      for (const scope of resource.scopeMetrics || []) {
        for (const metric of scope.metrics || []) {
          if (metric?.name !== COMMAND_LIFECYCLE_INVOCATION_METRIC) continue;
          for (const point of metric?.sum?.dataPoints || []) {
            const attributes = attributesFor(point);
            const count = pointCount(point);
            const command = attributes
              ? byCommand.get(attributes["command.name"])
              : null;
            const valid =
              attributes &&
              REQUIRED_ATTRIBUTES.every((key) =>
                Object.hasOwn(attributes, key),
              ) &&
              Object.keys(attributes).length === REQUIRED_ATTRIBUTES.length &&
              count !== null &&
              command &&
              COMMAND_NAME.test(attributes["command.name"]) &&
              ["legacy", "replacement"].includes(attributes["command.route"]) &&
              ["completed", "error"].includes(attributes["command.outcome"]) &&
              parseRelease(attributes["cli.version"]) &&
              attributes["command.deprecated_since"] ===
                command?.deprecatedSince &&
              attributes["command.removal_not_before"] ===
                command?.removalNotBefore;
            if (!valid) {
              rejectedPoints += 1;
              violations.push("invalid-lifecycle-metric-point");
              continue;
            }

            acceptedPoints += 1;
            const bucket =
              attributes["command.route"] === "legacy"
                ? command.legacy
                : command.replacementRoute;
            bucket.invocations += count;
            bucket[attributes["command.outcome"]] += count;
            command.versions.add(attributes["cli.version"]);
          }
        }
      }
    }
  }

  const coverageResult = validateCoverage(coverage, policy);
  const ingestionReady = rejectedPoints === 0 && acceptedPoints > 0;
  if (acceptedPoints === 0) violations.push("no-lifecycle-metric-points");

  const decisions = [...byCommand.values()].map((command) => {
    const recommendation = decisionFor(
      command,
      coverageResult,
      ingestionReady,
      policy,
    );
    return {
      command: command.command,
      replacement: command.replacement,
      deprecatedSince: command.deprecatedSince,
      removalNotBefore: command.removalNotBefore,
      legacy: command.legacy,
      replacementRoute: command.replacementRoute,
      observedVersions: [...command.versions].sort((left, right) =>
        compareReleases(left, right),
      ),
      ...recommendation,
    };
  });
  const summary = decisions.reduce(
    (result, item) => {
      result[item.decision] += 1;
      return result;
    },
    { retain: 0, remove: 0, "insufficient-data": 0 },
  );

  return {
    schema: COMMAND_LIFECYCLE_REPORT_SCHEMA,
    generatedAt: new Date(generatedAt).toISOString(),
    manifestSchema: manifest?.schema || null,
    policy: {
      ...policy,
      requiredPlatforms: [...policy.requiredPlatforms],
    },
    coverage: coverageResult,
    ingestion: {
      payloadCount,
      acceptedPoints,
      rejectedPoints,
      ready: ingestionReady,
      violations: [...new Set(violations)].sort(),
    },
    summary,
    decisions,
  };
}

export function renderCommandLifecycleReportMarkdown(report) {
  const lines = [
    "# CLI command lifecycle decision report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Coverage ready: **${report.coverage.ready ? "yes" : "no"}**`,
    `Telemetry input ready: **${report.ingestion.ready ? "yes" : "no"}**`,
    `Decisions: ${report.summary.remove} remove, ${report.summary.retain} retain, ${report.summary["insufficient-data"]} insufficient-data.`,
    "",
  ];
  if (report.coverage.blockers.length > 0) {
    lines.push(
      "Coverage blockers: " +
        report.coverage.blockers.map((item) => `\`${item}\``).join(", "),
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
    "| Legacy entry | Replacement | Legacy | Replacement | Legacy share | Decision | Reasons |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
  );
  for (const item of report.decisions) {
    lines.push(
      `| \`${item.command}\` | \`${item.replacement}\` | ${item.legacy.invocations} | ${item.replacementRoute.invocations} | ${item.legacyShare === null ? "n/a" : `${(item.legacyShare * 100).toFixed(2)}%`} | **${item.decision}** | ${item.reasons.join(", ")} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
