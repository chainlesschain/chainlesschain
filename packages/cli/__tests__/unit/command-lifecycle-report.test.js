import { createHash, generateKeyPairSync } from "node:crypto";
import {
  closeSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCommandLifecycleReport,
  COMMAND_ALIAS_DECISION_POLICY_SHA256,
  COMMAND_LIFECYCLE_APPROVAL_SCHEMA,
  COMMAND_LIFECYCLE_COVERAGE_SCHEMA,
  COMMAND_LIFECYCLE_EXPORT_MANIFEST_SCHEMA,
  COMMAND_LIFECYCLE_INVOCATION_METRIC,
  COMMAND_LIFECYCLE_REPORT_SCHEMA,
  renderCommandLifecycleReportMarkdown,
} from "../../src/lib/command-lifecycle-report.js";
import {
  packUpdateKeyId,
  signPackUpdateManifest,
} from "../../src/lib/packer/pack-update-signature.js";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, "src", "command-manifest.json"), "utf8"),
);
const COVERAGE_SHA = `sha256:${"a".repeat(64)}`;
const APPROVAL_SHA = `sha256:${"b".repeat(64)}`;
const EXPORT_SHA = `sha256:${"c".repeat(64)}`;
const EXPORT_MANIFEST_SHA = `sha256:${"d".repeat(64)}`;
const GENERATOR_SHA = "f".repeat(40);
const { privateKey: approvalPrivateKey, publicKey: approvalPublicKey } =
  generateKeyPairSync("ed25519");
const approvalKeyId = packUpdateKeyId(approvalPublicKey);
const approvalTrust = {
  source: "repository-pinned",
  keys: new Map([[approvalKeyId, approvalPublicKey]]),
};
const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function publicRelease(version, tagPublishedAt, npmPublishedAt, digit) {
  return {
    version,
    commitSha: digit.repeat(40),
    tag: `v-npm-${version.replaceAll(".", "-")}`,
    tagPublishedAt,
    npmPublishedAt,
  };
}

function coverage(overrides = {}) {
  return {
    schema: COMMAND_LIFECYCLE_COVERAGE_SCHEMA,
    reportSchema: COMMAND_LIFECYCLE_REPORT_SCHEMA,
    decisionVersion: "0.164.0",
    observation: {
      id: "public-cli-0.162-through-0.164",
      startedAt: "2026-08-06T07:47:36.861Z",
      endedAt: "2026-09-08T00:00:00.000Z",
      startRelease: "0.162.198",
      endRelease: "0.164.0",
    },
    publicReleases: [
      publicRelease(
        "0.162.198",
        "2026-08-06T07:40:00.000Z",
        "2026-08-06T07:47:36.861Z",
        "1",
      ),
      publicRelease(
        "0.163.4",
        "2026-08-20T00:00:00.000Z",
        "2026-08-20T00:05:00.000Z",
        "2",
      ),
      publicRelease(
        "0.164.0",
        "2026-09-07T00:00:00.000Z",
        "2026-09-07T00:05:00.000Z",
        "3",
      ),
    ],
    collector: {
      eligibleInstallations: 100,
      reportingInstallations: 80,
      sampleRate: 1,
      platforms: { linux: 30, macos: 20, windows: 30 },
      knownBiases: [
        {
          id: "opt-in-collector",
          description: "Only the explicitly configured cohort is represented.",
          blocking: false,
        },
      ],
    },
    ...overrides,
  };
}

function approval(overrides = {}) {
  return signPackUpdateManifest(
    {
      schema: COMMAND_LIFECYCLE_APPROVAL_SCHEMA,
      reportSchema: COMMAND_LIFECYCLE_REPORT_SCHEMA,
      scope: "collector-coverage-and-command-lifecycle-metrics",
      status: "approved",
      attestationId: "review-2026-09-08",
      observationId: "public-cli-0.162-through-0.164",
      decisionVersion: "0.164.0",
      coverageSha256: COVERAGE_SHA,
      exportManifestSha256: EXPORT_MANIFEST_SHA,
      policySha256: COMMAND_ALIAS_DECISION_POLICY_SHA256,
      generatorSha: GENERATOR_SHA,
      approvedAt: "2026-09-08T01:00:00.000Z",
      approvedBy: { id: "release-review-board", role: "telemetry-approver" },
      ...overrides,
    },
    approvalPrivateKey,
  );
}

function manifestTemporality(documents) {
  for (const document of documents) {
    const payloads = Array.isArray(document) ? document : [document];
    for (const payloadValue of payloads) {
      for (const resource of payloadValue?.resourceMetrics || []) {
        for (const scope of resource.scopeMetrics || []) {
          for (const metric of scope.metrics || []) {
            if (metric?.name === COMMAND_LIFECYCLE_INVOCATION_METRIC) {
              return metric.sum?.aggregationTemporality === 2
                ? "cumulative"
                : "delta";
            }
          }
        }
      }
    }
  }
  return "delta";
}

function exportManifest(exports, overrides = {}) {
  const boundaries = [
    "2026-08-06T07:47:36.861Z",
    "2026-08-25T00:00:00.000Z",
    "2026-09-08T00:00:00.000Z",
  ];
  return {
    schema: COMMAND_LIFECYCLE_EXPORT_MANIFEST_SCHEMA,
    reportSchema: COMMAND_LIFECYCLE_REPORT_SCHEMA,
    observationId: "public-cli-0.162-through-0.164",
    generatorSha: GENERATOR_SHA,
    policySha256: COMMAND_ALIAS_DECISION_POLICY_SHA256,
    partitions: exports.map((item, sequence) => ({
      sequence,
      id: item.id,
      sha256: item.sha256,
      startedAt:
        exports.length === 1
          ? "2026-08-06T07:47:36.861Z"
          : boundaries[sequence],
      endedAt:
        exports.length === 1
          ? "2026-09-08T00:00:00.000Z"
          : boundaries[sequence + 1],
      temporality: manifestTemporality(item.documents),
    })),
    ...overrides,
  };
}

function attributes(command, route, version, outcome = "completed") {
  return Object.entries({
    "command.name": command,
    "command.route": route,
    "command.outcome": outcome,
    "cli.version": version,
    "command.deprecated_since": ["dao", "evomap"].includes(command)
      ? "0.162.189"
      : "0.162.194",
    "command.removal_not_before": "0.164.0",
  }).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

function nanos(iso) {
  return String(BigInt(Date.parse(iso)) * 1_000_000n);
}

function point(
  command,
  route,
  version,
  count,
  {
    outcome = "completed",
    at = version === "0.162.198"
      ? "2026-08-07T00:00:00.000Z"
      : "2026-08-21T00:00:00.000Z",
    startAt,
  } = {},
) {
  return {
    attributes: attributes(command, route, version, outcome),
    asInt: String(count),
    timeUnixNano: nanos(at),
    ...(startAt ? { startTimeUnixNano: nanos(startAt) } : {}),
  };
}

function payload(points, { temporality = 1, resourceId = "collector-a" } = {}) {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            {
              key: "service.instance.id",
              value: { stringValue: resourceId },
            },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "chainlesschain-cli" },
            metrics: [
              {
                name: COMMAND_LIFECYCLE_INVOCATION_METRIC,
                sum: {
                  aggregationTemporality: temporality,
                  isMonotonic: true,
                  dataPoints: points,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function build({
  documents = [],
  telemetryExports,
  coverageValue = coverage(),
  coverageSha256 = COVERAGE_SHA,
  approvalValue,
  approvalSha256 = APPROVAL_SHA,
  exportManifestValue,
  exportManifestSha256 = EXPORT_MANIFEST_SHA,
  trust = approvalTrust,
  generatorVerification = {
    source: "git-head-clean",
    actualSha: GENERATOR_SHA,
    verified: true,
  },
  generatedAt = "2026-09-08T02:00:00.000Z",
} = {}) {
  const exports = telemetryExports || [
    { id: "collector-a", sha256: EXPORT_SHA, documents },
  ];
  const partitionManifest = exportManifestValue || exportManifest(exports);
  return buildCommandLifecycleReport({
    manifest,
    coverage: coverageValue,
    coverageSha256,
    exportManifest: partitionManifest,
    exportManifestSha256,
    generatorSha: GENERATOR_SHA,
    generatorVerification,
    approval: approvalValue || approval(),
    approvalSha256,
    approvalTrust: trust,
    telemetryExports: exports,
    generatedAt,
  });
}

describe("command lifecycle report v2", () => {
  it("binds release evidence and reports real per-command metrics across minors", () => {
    const report = build({
      documents: [
        payload([
          point("dao", "legacy", "0.162.198", 1),
          point("dao", "replacement", "0.162.198", 199),
          point("dao", "replacement", "0.163.4", 200),
          point("evomap", "legacy", "0.162.198", 10),
          point("evomap", "replacement", "0.162.198", 90),
          point("evomap", "legacy", "0.163.4", 15),
          point("evomap", "replacement", "0.163.4", 85),
        ]),
      ],
    });

    expect(report.schema).toBe(COMMAND_LIFECYCLE_REPORT_SCHEMA);
    expect(report.coverage.ready).toBe(false);
    expect(report.coverage.blockers).toEqual(
      expect.arrayContaining([
        "delta-evidence-release-incompatible:0.162.198",
        "delta-release-policy-unconfigured",
      ]),
    );
    expect(report.evidence).toMatchObject({
      ready: false,
      coverage: { sha256: COVERAGE_SHA },
      telemetryExports: [{ id: "collector-a", sha256: EXPORT_SHA }],
      approval: {
        ready: false,
        sha256: APPROVAL_SHA,
        blockers: expect.arrayContaining([
          "approval-signature-trust-unavailable",
        ]),
      },
    });
    expect(report.releases.map((item) => item.version)).toEqual([
      "0.162.198",
      "0.163.4",
      "0.164.0",
    ]);
    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 7,
      rejectedPoints: 0,
      countedInvocations: 600,
      violations: expect.arrayContaining([
        "report-generator-source-unverified",
      ]),
    });
    expect(
      report.decisions.find((item) => item.command === "dao"),
    ).toMatchObject({
      decision: "insufficient-data",
      aliasAction: "retain",
      totalInvocations: 400,
      legacyShare: 0.0025,
      observedMinorCycles: ["0.162", "0.163"],
      minorCycles: [
        {
          minor: "0.162",
          legacy: { invocations: 1 },
          replacementRoute: { invocations: 199 },
        },
        {
          minor: "0.163",
          legacy: { invocations: 0 },
          replacementRoute: { invocations: 200 },
        },
        {
          minor: "0.164",
          legacy: { invocations: 0 },
          replacementRoute: { invocations: 0 },
        },
      ],
    });
    expect(
      report.decisions.find((item) => item.command === "evomap"),
    ).toMatchObject({
      decision: "insufficient-data",
      aliasAction: "retain",
      totalInvocations: 200,
      legacyShare: 0.125,
    });
    expect(report.summary).toEqual({
      decisions: { retain: 0, remove: 0, "insufficient-data": 25 },
      aliasActions: { retain: 25, remove: 0 },
    });
  });

  it("requires actual command points in two minors, not merely declared releases", () => {
    const report = build({
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });
    const dao = report.decisions.find((item) => item.command === "dao");

    expect(report.coverage.observedMinorCycles).toEqual([
      "0.162",
      "0.163",
      "0.164",
    ]);
    expect(dao).toMatchObject({
      decision: "insufficient-data",
      aliasAction: "retain",
      observedMinorCycles: ["0.163"],
      reasons: expect.arrayContaining(["command-release-window-incomplete"]),
    });
  });

  it("reduces cumulative streams and de-duplicates resource/scope-mutated points", () => {
    const startAt = "2026-08-20T00:06:00.000Z";
    const first = point("dao", "replacement", "0.163.4", 100, {
      at: "2026-08-21T00:00:00.000Z",
      startAt,
    });
    const latest = point("dao", "replacement", "0.163.4", 250, {
      at: "2026-08-22T00:00:00.000Z",
      startAt,
    });
    const mutated = payload([structuredClone(latest)], {
      temporality: 2,
      resourceId: "attacker-controlled-resource",
    });
    mutated.resourceMetrics[0].scopeMetrics[0].scope = {
      name: "mutated-scope",
      version: "999",
    };
    const report = build({
      documents: [payload([first, latest], { temporality: 2 }), mutated],
    });
    const dao = report.decisions.find((item) => item.command === "dao");

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 2,
      duplicatePoints: 1,
      countedInvocations: 250,
      violations: expect.arrayContaining([
        "report-generator-source-unverified",
      ]),
    });
    expect(dao.replacementRoute.invocations).toBe(250);
  });

  it.each([
    {
      name: "counter reset",
      values: [
        { count: 100, at: "2026-08-21T00:00:00.000Z" },
        { count: 90, at: "2026-08-22T00:00:00.000Z" },
      ],
    },
    {
      name: "out-of-order snapshot",
      values: [
        { count: 100, at: "2026-08-22T00:00:00.000Z" },
        { count: 110, at: "2026-08-21T00:00:00.000Z" },
      ],
    },
    {
      name: "same-time conflicting snapshot",
      values: [
        { count: 100, at: "2026-08-21T00:00:00.000Z" },
        { count: 110, at: "2026-08-21T00:00:00.000Z" },
      ],
    },
  ])("fails closed on cumulative $name", ({ name, values }) => {
    const startAt = "2026-08-20T00:06:00.000Z";
    const snapshots = values.map(({ count, at }) =>
      point("dao", "replacement", "0.163.4", count, { at, startAt }),
    );
    const report = build({
      documents: [payload(snapshots, { temporality: 2 })],
    });

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 0,
      countedInvocations: 0,
      violations: expect.arrayContaining([
        name === "same-time conflicting snapshot"
          ? "ambiguous-lifecycle-metric-point"
          : "cumulative-lifecycle-series-invalid",
        "no-lifecycle-metric-points",
      ]),
    });
    expect(report.summary.aliasActions).toEqual({ retain: 25, remove: 0 });
  });

  it("accepts a zero cumulative baseline and counts non-overlapping resets once", () => {
    const firstStart = "2026-08-20T00:06:00.000Z";
    const resetStart = "2026-08-21T01:00:00.000Z";
    const report = build({
      documents: [
        payload(
          [
            point("dao", "replacement", "0.163.4", 0, {
              at: "2026-08-20T00:07:00.000Z",
              startAt: firstStart,
            }),
            point("dao", "replacement", "0.163.4", 10, {
              at: "2026-08-21T00:00:00.000Z",
              startAt: firstStart,
            }),
            point("dao", "replacement", "0.163.4", 5, {
              at: "2026-08-22T00:00:00.000Z",
              startAt: resetStart,
            }),
          ],
          { temporality: 2 },
        ),
      ],
    });

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 3,
      rejectedPoints: 0,
      countedInvocations: 15,
      violations: expect.arrayContaining([
        "report-generator-source-unverified",
      ]),
    });
    expect(
      report.decisions.find((item) => item.command === "dao").replacementRoute
        .invocations,
    ).toBe(15);
  });

  it("rejects overlapping cumulative reset windows instead of summing them", () => {
    const report = build({
      documents: [
        payload(
          [
            point("dao", "replacement", "0.163.4", 10, {
              at: "2026-08-22T00:00:00.000Z",
              startAt: "2026-08-20T00:06:00.000Z",
            }),
            point("dao", "replacement", "0.163.4", 5, {
              at: "2026-08-23T00:00:00.000Z",
              startAt: "2026-08-21T00:00:00.000Z",
            }),
          ],
          { temporality: 2 },
        ),
      ],
    });

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 0,
      countedInvocations: 0,
      violations: expect.arrayContaining([
        "cumulative-lifecycle-reset-overlap",
        "no-lifecycle-invocations",
      ]),
    });
    expect(report.summary.aliasActions).toEqual({ retain: 25, remove: 0 });
  });

  it("fails closed on missing timestamps and pre-release points", () => {
    const missingTime = point("dao", "replacement", "0.162.198", 100);
    delete missingTime.timeUnixNano;
    const beforeRelease = point("dao", "replacement", "0.163.4", 100, {
      at: "2026-08-10T00:00:00.000Z",
    });
    const report = build({
      documents: [payload([missingTime, beforeRelease])],
    });

    expect(report.ingestion.ready).toBe(false);
    expect(report.ingestion.violations).toEqual(
      expect.arrayContaining([
        "invalid-lifecycle-metric-point",
        "no-lifecycle-metric-points",
      ]),
    );
    expect(report.summary.aliasActions).toEqual({ retain: 25, remove: 0 });
  });

  it("binds coverage and raw export digests to the approval attestation", () => {
    const report = build({
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
      approvalValue: approval({
        coverageSha256: `sha256:${"e".repeat(64)}`,
        exportManifestSha256: `sha256:${"e".repeat(64)}`,
        policySha256: `sha256:${"e".repeat(64)}`,
        generatorSha: "e".repeat(40),
      }),
    });

    expect(report.evidence.ready).toBe(false);
    expect(report.evidence.approval.blockers).toEqual(
      expect.arrayContaining([
        "approval-coverage-digest-mismatch",
        "approval-export-manifest-digest-mismatch",
        "approval-generator-sha-mismatch",
        "approval-policy-digest-mismatch",
      ]),
    );
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("strictly binds schema, window bounds and public release timestamps", () => {
    const badCoverage = coverage({
      reportSchema: "chainlesschain.command-lifecycle-report.v1",
      observation: {
        id: "public-cli-0.162-through-0.164",
        startedAt: "2026-08-06T07:47:36.861Z",
        endedAt: "2026-08-19T00:00:00.000Z",
        startRelease: "0.162.198",
        endRelease: "0.164.0",
      },
    });
    const report = build({ coverageValue: badCoverage, documents: [] });

    expect(report.coverage.ready).toBe(false);
    expect(report.coverage.blockers).toEqual(
      expect.arrayContaining([
        "coverage-report-schema-unbound",
        "public-release-outside-observation-window",
        "observation-end-precedes-npm-release",
      ]),
    );
    expect(report.summary.aliasActions).toEqual({ retain: 25, remove: 0 });
  });

  it("requires disjoint platform counts to equal reporting installations", () => {
    const collector = coverage().collector;
    const report = build({
      coverageValue: coverage({
        collector: {
          ...collector,
          platforms: { linux: 30, macos: 20, windows: 31 },
        },
      }),
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.coverage.ready).toBe(false);
    expect(report.coverage.blockers).toContain(
      "platform-reporting-installation-total-mismatch",
    );
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it.each([
    ["eligible installations", { eligibleInstallations: "100" }],
    ["reporting installations", { reportingInstallations: "80" }],
    ["sample rate", { sampleRate: "1" }],
  ])("rejects string-encoded collector %s", (_label, override) => {
    const base = coverage().collector;
    const report = build({
      coverageValue: coverage({ collector: { ...base, ...override } }),
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.coverage.ready).toBe(false);
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects string blocking flags instead of treating them as non-blocking", () => {
    const base = coverage().collector;
    const report = build({
      coverageValue: coverage({
        collector: {
          ...base,
          knownBiases: [{ ...base.knownBiases[0], blocking: "true" }],
        },
      }),
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.coverage.ready).toBe(false);
    expect(report.coverage.blockers).toContain("collector-bias-entry-invalid");
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects unknown platforms and requires the exact platform set", () => {
    const base = coverage().collector;
    const report = build({
      coverageValue: coverage({
        collector: {
          ...base,
          platforms: { ...base.platforms, freebsd: 1 },
        },
      }),
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.coverage.ready).toBe(false);
    expect(report.coverage.blockers).toContain(
      "collector-platform-set-invalid",
    );
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects unknown coverage fields", () => {
    const report = build({
      coverageValue: { ...coverage(), unreviewedOverride: true },
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.coverage.blockers).toContain("coverage-fields-invalid");
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects cumulative streams whose start predates the matching npm release", () => {
    const report = build({
      documents: [
        payload(
          [
            point("dao", "replacement", "0.163.4", 250, {
              at: "2026-08-21T00:00:00.000Z",
              startAt: "2026-08-10T00:00:00.000Z",
            }),
          ],
          { temporality: 2 },
        ),
      ],
    });

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 0,
      violations: expect.arrayContaining(["invalid-lifecycle-metric-point"]),
    });
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects string-encoded OTLP aggregation temporality", () => {
    const document = payload([point("dao", "replacement", "0.163.4", 1_000)]);
    document.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.aggregationTemporality =
      "1";
    const report = build({ documents: [document] });

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 0,
      violations: expect.arrayContaining(["invalid-lifecycle-metric-point"]),
    });
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects conflicting resource/scope-mutated delta points instead of summing them", () => {
    const first = point("dao", "replacement", "0.163.4", 100);
    const second = point("dao", "replacement", "0.163.4", 200);
    const changedIdentity = payload([second], { resourceId: "changed" });
    changedIdentity.resourceMetrics[0].scopeMetrics[0].scope = {
      name: "changed",
    };
    const report = build({
      documents: [payload([first]), changedIdentity],
    });

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 0,
      countedInvocations: 0,
      violations: expect.arrayContaining(["ambiguous-lifecycle-metric-point"]),
    });
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("fails closed on identical DELTA identities instead of assuming a retry", () => {
    const first = point("dao", "replacement", "0.163.4", 200);
    const duplicate = structuredClone(first);
    const changedResource = payload([duplicate], { resourceId: "install-b" });
    const report = build({
      documents: [
        payload([first], { resourceId: "install-a" }),
        changedResource,
      ],
    });

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 0,
      rejectedPoints: 2,
      duplicatePoints: 1,
      countedInvocations: 0,
      violations: expect.arrayContaining([
        "duplicate-delta-lifecycle-metric-point",
      ]),
    });
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("requires a repository-pinned key even for a cryptographically valid approval", () => {
    const report = build({
      trust: null,
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.evidence.ready).toBe(false);
    expect(report.evidence.approval.blockers).toContain(
      "approval-signature-trust-unavailable",
    );
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("ignores caller-supplied trust keys and forged clean-SHA verification", () => {
    const report = build({
      trust: approvalTrust,
      generatorVerification: {
        source: "git-head-clean",
        actualSha: GENERATOR_SHA,
        verified: true,
      },
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.evidence.approval.blockers).toContain(
      "approval-signature-trust-unavailable",
    );
    expect(report.ingestion.violations).toContain(
      "report-generator-source-unverified",
    );
    expect(report.evidence.ready).toBe(false);
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("does not let reviewer fields changed after signing self-authorize", () => {
    const forged = approval();
    forged.approvedBy = { id: "self-appointed", role: "telemetry-approver" };
    const report = build({
      approvalValue: forged,
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.evidence.approval.blockers).toContain(
      "approval-signature-trust-unavailable",
    );
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects future approvals and future report-generation timestamps", () => {
    const report = build({
      approvalValue: approval({ approvedAt: "2999-09-09T00:00:00.000Z" }),
      generatedAt: "2999-09-09T01:00:00.000Z",
      documents: [payload([point("dao", "replacement", "0.163.4", 1_000)])],
    });

    expect(report.evidence.approval.blockers).toEqual(
      expect.arrayContaining([
        "approval-timestamp-in-future",
        "report-generated-in-future",
      ]),
    );
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects overlapping export partitions", () => {
    const exports = [
      {
        id: "collector-a",
        sha256: EXPORT_SHA,
        documents: [payload([point("dao", "replacement", "0.163.4", 100)])],
      },
      {
        id: "collector-b",
        sha256: `sha256:${"e".repeat(64)}`,
        documents: [
          payload([
            point("dao", "replacement", "0.164.0", 100, {
              at: "2026-09-07T01:00:00.000Z",
            }),
          ]),
        ],
      },
    ];
    const partitionManifest = exportManifest(exports);
    partitionManifest.partitions[1].startedAt = "2026-08-24T00:00:00.000Z";
    const report = build({
      telemetryExports: exports,
      exportManifestValue: partitionManifest,
    });

    expect(report.ingestion.violations).toContain(
      "export-manifest-partitions-overlap",
    );
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects a selective high-usage partition that does not cover the observation window", () => {
    const exports = [
      {
        id: "collector-a",
        sha256: EXPORT_SHA,
        documents: [payload([point("dao", "replacement", "0.163.4", 10_000)])],
      },
    ];
    const partitionManifest = exportManifest(exports);
    partitionManifest.partitions[0].startedAt = "2026-08-20T00:05:00.000Z";
    partitionManifest.partitions[0].endedAt = "2026-08-22T00:00:00.000Z";
    const report = build({
      telemetryExports: exports,
      exportManifestValue: partitionManifest,
    });

    expect(report.ingestion.acceptedPoints).toBe(1);
    expect(report.ingestion.violations).toContain(
      "export-manifest-does-not-cover-observation-window",
    );
    expect(report.ingestion.ready).toBe(false);
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("rejects gaps between otherwise ordered export partitions", () => {
    const exports = [
      {
        id: "collector-a",
        sha256: EXPORT_SHA,
        documents: [payload([point("dao", "replacement", "0.163.4", 100)])],
      },
      {
        id: "collector-b",
        sha256: `sha256:${"e".repeat(64)}`,
        documents: [
          payload([
            point("dao", "replacement", "0.164.0", 100, {
              at: "2026-09-07T01:00:00.000Z",
            }),
          ]),
        ],
      },
    ];
    const partitionManifest = exportManifest(exports);
    partitionManifest.partitions[1].startedAt = "2026-08-26T00:00:00.000Z";
    const report = build({
      telemetryExports: exports,
      exportManifestValue: partitionManifest,
    });

    expect(report.ingestion.violations).toContain(
      "export-manifest-partition-gap",
    );
    expect(report.ingestion.ready).toBe(false);
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("explicitly rejects legacy v1 coverage instead of silently migrating it", () => {
    const legacyCoverage = {
      schema: "chainlesschain.command-lifecycle-coverage.v1",
      decisionVersion: "0.164.0",
      observedReleases: ["0.162.198", "0.163.4"],
      window: {
        startedAt: "2026-08-06T07:47:36.861Z",
        endedAt: "2026-09-08T00:00:00.000Z",
      },
      collector: coverage().collector,
    };
    const report = build({ coverageValue: legacyCoverage, documents: [] });

    expect(report.formalObservation).toBe("insufficient-data");
    expect(report.coverage.blockers).toEqual(
      expect.arrayContaining([
        "coverage-schema-invalid",
        "coverage-report-schema-unbound",
        "observation-window-invalid",
        "public-releases-missing",
      ]),
    );
    expect(report.summary).toEqual({
      decisions: { retain: 0, remove: 0, "insufficient-data": 25 },
      aliasActions: { retain: 25, remove: 0 },
    });
  });

  it("rejects 0.162.198 and 0.163.3 even when callers label their OTLP as DELTA", () => {
    const oldCoverage = coverage({
      publicReleases: [
        publicRelease(
          "0.162.198",
          "2026-08-06T07:40:00.000Z",
          "2026-08-06T07:47:36.861Z",
          "1",
        ),
        publicRelease(
          "0.163.3",
          "2026-08-19T00:00:00.000Z",
          "2026-08-19T00:05:00.000Z",
          "2",
        ),
        publicRelease(
          "0.164.0",
          "2026-09-07T00:00:00.000Z",
          "2026-09-07T00:05:00.000Z",
          "3",
        ),
      ],
    });
    const report = build({
      coverageValue: oldCoverage,
      documents: [
        payload([
          point("dao", "replacement", "0.162.198", 500),
          point("dao", "replacement", "0.163.3", 500),
        ]),
      ],
    });

    expect(report.coverage.blockers).toEqual(
      expect.arrayContaining([
        "delta-evidence-release-incompatible:0.162.198",
        "delta-evidence-release-incompatible:0.163.3",
        "delta-release-policy-unconfigured",
      ]),
    );
    expect(
      report.decisions.find((item) => item.command === "dao"),
    ).toMatchObject({
      totalInvocations: 1_000,
      decision: "insufficient-data",
      aliasAction: "retain",
    });
    expect(report.summary.aliasActions.remove).toBe(0);
  });

  it("produces an honest zero-export report and retains every alias", () => {
    const report = buildCommandLifecycleReport({
      manifest,
      coverage: coverage(),
      coverageSha256: COVERAGE_SHA,
      approval: null,
      approvalSha256: null,
      telemetryExports: [],
      generatedAt: "2026-09-08T02:00:00.000Z",
    });

    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 0,
      countedInvocations: 0,
      violations: expect.arrayContaining([
        "export-manifest-schema-invalid",
        "no-lifecycle-invocations",
        "no-lifecycle-metric-points",
      ]),
    });
    expect(report.evidence.ready).toBe(false);
    expect(report.formalObservation).toBe("insufficient-data");
    expect(report.evidence.telemetryExports).toEqual([]);
    expect(report.summary).toEqual({
      decisions: { retain: 0, remove: 0, "insufficient-data": 25 },
      aliasActions: { retain: 25, remove: 0 },
    });
    expect(
      report.decisions.every((item) => item.aliasAction === "retain"),
    ).toBe(true);
  });

  it("renders release-bound, per-minor, content-free markdown", () => {
    const report = build({
      documents: [
        payload([
          point("dao", "replacement", "0.162.198", 125),
          point("dao", "replacement", "0.163.4", 125),
        ]),
      ],
    });
    const markdown = renderCommandLifecycleReportMarkdown(report);

    expect(markdown).toContain(COMMAND_LIFECYCLE_REPORT_SCHEMA);
    expect(markdown).toContain("Adoption evidence: **insufficient-data**");
    expect(markdown).toContain("Alias actions: 0 remove, 25 retain.");
    expect(markdown).toContain("0.162: 0/125; 0.163: 0/125; 0.164: 0/0");
    expect(markdown).toContain("| **insufficient-data** | **retain** |");
    expect(markdown).not.toContain("service.instance.id");
  });

  it("hashes exact CLI input bytes and exits 2 for an incomplete zero-data report", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cc-lifecycle-v2-"));
    tempRoots.push(root);
    const coveragePath = path.join(root, "coverage.json");
    const exportManifestPath = path.join(root, "export-manifest.json");
    const approvalPath = path.join(root, "approval.json");
    const outputPath = path.join(root, "report.json");
    const coverageBytes = Buffer.from(`${JSON.stringify(coverage())}\n`);
    writeFileSync(coveragePath, coverageBytes);
    const exportManifestBytes = Buffer.from(
      `${JSON.stringify(exportManifest([]))}\n`,
    );
    writeFileSync(exportManifestPath, exportManifestBytes);
    const approvalBytes = Buffer.from(
      `${JSON.stringify(
        approval({
          coverageSha256: sha256(coverageBytes),
          exportManifestSha256: sha256(exportManifestBytes),
        }),
      )}\n`,
    );
    writeFileSync(approvalPath, approvalBytes);

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "scripts", "command-lifecycle-report.mjs"),
        "--coverage",
        coveragePath,
        "--export-manifest",
        exportManifestPath,
        "--generator-sha",
        GENERATOR_SHA,
        "--approval",
        approvalPath,
        "--out",
        outputPath,
        "--generated-at",
        "2026-09-08T02:00:00.000Z",
        "--fail-on-incomplete",
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );
    const report = JSON.parse(readFileSync(outputPath, "utf8"));

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(report.evidence.coverage.sha256).toBe(sha256(coverageBytes));
    expect(report.evidence.approval.sha256).toBe(sha256(approvalBytes));
    expect(report.summary.aliasActions).toEqual({ retain: 25, remove: 0 });
  });

  it("rejects duplicate singleton CLI options", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "scripts", "command-lifecycle-report.mjs"),
        "--coverage",
        "first.json",
        "--coverage",
        "second.json",
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Duplicate argument: --coverage");
  });

  it("rejects output paths that overwrite input evidence", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cc-lifecycle-path-"));
    tempRoots.push(root);
    const coveragePath = path.join(root, "coverage.json");
    const exportManifestPath = path.join(root, "export-manifest.json");
    const originalCoverage = `${JSON.stringify(coverage())}\n`;
    writeFileSync(coveragePath, originalCoverage);
    writeFileSync(exportManifestPath, JSON.stringify(exportManifest([])));

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "scripts", "command-lifecycle-report.mjs"),
        "--coverage",
        coveragePath,
        "--export-manifest",
        exportManifestPath,
        "--generator-sha",
        GENERATOR_SHA,
        "--out",
        coveragePath,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not overwrite input evidence");
    expect(readFileSync(coveragePath, "utf8")).toBe(originalCoverage);
  });

  it("rejects malformed UTF-8 evidence", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cc-lifecycle-utf8-"));
    tempRoots.push(root);
    const coveragePath = path.join(root, "coverage.json");
    const exportManifestPath = path.join(root, "export-manifest.json");
    writeFileSync(coveragePath, Buffer.from([0xc3, 0x28]));
    writeFileSync(exportManifestPath, JSON.stringify(exportManifest([])));

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "scripts", "command-lifecycle-report.mjs"),
        "--coverage",
        coveragePath,
        "--export-manifest",
        exportManifestPath,
        "--generator-sha",
        GENERATOR_SHA,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("coverage is not valid UTF-8");
  });

  it("rejects duplicate JSON object keys", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cc-lifecycle-json-"));
    tempRoots.push(root);
    const coveragePath = path.join(root, "coverage.json");
    const exportManifestPath = path.join(root, "export-manifest.json");
    writeFileSync(coveragePath, '{"schema":"first","schema":"second"}');
    writeFileSync(exportManifestPath, JSON.stringify(exportManifest([])));

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "scripts", "command-lifecycle-report.mjs"),
        "--coverage",
        coveragePath,
        "--export-manifest",
        exportManifestPath,
        "--generator-sha",
        GENERATOR_SHA,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate JSON key "schema"');
  });

  it("rejects an oversized NDJSON partition before reading it", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cc-lifecycle-size-"));
    tempRoots.push(root);
    const coveragePath = path.join(root, "coverage.json");
    const exportManifestPath = path.join(root, "export-manifest.json");
    const inputPath = path.join(root, "oversized.ndjson");
    writeFileSync(coveragePath, JSON.stringify(coverage()));
    writeFileSync(
      exportManifestPath,
      JSON.stringify(
        exportManifest([
          { id: "collector-a", sha256: EXPORT_SHA, documents: [] },
        ]),
      ),
    );
    const descriptor = openSync(inputPath, "w");
    ftruncateSync(descriptor, 64 * 1024 * 1024 + 1);
    closeSync(descriptor);

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "scripts", "command-lifecycle-report.mjs"),
        "--coverage",
        coveragePath,
        "--export-manifest",
        exportManifestPath,
        "--generator-sha",
        GENERATOR_SHA,
        "--input",
        `collector-a=${inputPath}`,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("telemetry export collector-a exceeds");
  });

  it("applies the document limit to top-level JSON arrays", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cc-lifecycle-array-"));
    tempRoots.push(root);
    const coveragePath = path.join(root, "coverage.json");
    const exportManifestPath = path.join(root, "export-manifest.json");
    const inputPath = path.join(root, "too-many.json");
    writeFileSync(coveragePath, JSON.stringify(coverage()));
    writeFileSync(
      exportManifestPath,
      JSON.stringify(
        exportManifest([
          { id: "collector-a", sha256: EXPORT_SHA, documents: [] },
        ]),
      ),
    );
    writeFileSync(
      inputPath,
      JSON.stringify(Array.from({ length: 100_001 }, () => ({}))),
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, "scripts", "command-lifecycle-report.mjs"),
        "--coverage",
        coveragePath,
        "--export-manifest",
        exportManifestPath,
        "--generator-sha",
        GENERATOR_SHA,
        "--input",
        `collector-a=${inputPath}`,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exceeds the 100000-document limit");
  });
});
