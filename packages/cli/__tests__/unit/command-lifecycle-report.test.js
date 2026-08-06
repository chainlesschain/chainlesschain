import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCommandLifecycleReport,
  COMMAND_LIFECYCLE_COVERAGE_SCHEMA,
  COMMAND_LIFECYCLE_INVOCATION_METRIC,
  renderCommandLifecycleReportMarkdown,
} from "../../src/lib/command-lifecycle-report.js";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, "src", "command-manifest.json"), "utf8"),
);

function coverage(overrides = {}) {
  return {
    schema: COMMAND_LIFECYCLE_COVERAGE_SCHEMA,
    decisionVersion: "0.164.0",
    observedReleases: ["0.162.198", "0.163.4"],
    window: {
      startedAt: "2026-08-07T00:00:00.000Z",
      endedAt: "2026-09-07T00:00:00.000Z",
    },
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

function attributes(command, route, outcome = "completed") {
  return Object.entries({
    "command.name": command,
    "command.route": route,
    "command.outcome": outcome,
    "cli.version": route === "legacy" ? "0.162.198" : "0.163.4",
    "command.deprecated_since": ["dao", "evomap"].includes(command)
      ? "0.162.189"
      : "0.162.194",
    "command.removal_not_before": "0.164.0",
  }).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

function payload(points) {
  return {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: COMMAND_LIFECYCLE_INVOCATION_METRIC,
                sum: { dataPoints: points },
              },
            ],
          },
        ],
      },
    ],
  };
}

function point(command, route, count, outcome) {
  return {
    attributes: attributes(command, route, outcome),
    asInt: String(count),
  };
}

describe("command lifecycle report", () => {
  it("aggregates OTLP usage and makes conservative per-command decisions", () => {
    const report = buildCommandLifecycleReport({
      manifest,
      coverage: coverage(),
      documents: [
        payload([
          point("dao", "legacy", 1),
          point("dao", "replacement", 399),
          point("evomap", "legacy", 25),
          point("evomap", "replacement", 175),
        ]),
      ],
      generatedAt: "2026-09-08T00:00:00.000Z",
    });

    expect(report.coverage.ready).toBe(true);
    expect(report.ingestion).toMatchObject({
      ready: true,
      acceptedPoints: 4,
      rejectedPoints: 0,
    });
    expect(
      report.decisions.find((item) => item.command === "dao"),
    ).toMatchObject({
      decision: "remove",
      totalInvocations: 400,
      legacyShare: 0.0025,
    });
    expect(
      report.decisions.find((item) => item.command === "evomap"),
    ).toMatchObject({
      decision: "retain",
      totalInvocations: 200,
      legacyShare: 0.125,
    });
    expect(
      report.decisions.find((item) => item.command === "bm25"),
    ).toMatchObject({
      decision: "insufficient-data",
      reasons: expect.arrayContaining(["command-sample-too-small"]),
    });
    expect(report.summary).toEqual({
      retain: 1,
      remove: 1,
      "insufficient-data": 23,
    });
  });

  it("blocks every removal before two real minor cycles and the removal version", () => {
    const report = buildCommandLifecycleReport({
      manifest,
      coverage: coverage({
        decisionVersion: "0.162.198",
        observedReleases: ["0.162.198"],
      }),
      documents: [payload([point("dao", "replacement", 1_000)])],
    });
    const dao = report.decisions.find((item) => item.command === "dao");

    expect(report.coverage.ready).toBe(false);
    expect(report.coverage.blockers).toContain(
      "release-observation-window-incomplete",
    );
    expect(dao).toMatchObject({
      decision: "insufficient-data",
      reasons: expect.arrayContaining([
        "command-release-window-incomplete",
        "removal-version-not-reached",
      ]),
    });
    expect(report.summary.remove).toBe(0);
  });

  it("fails closed on weak coverage, blocking bias or malformed metric points", () => {
    const malformed = point("dao", "replacement", 500);
    malformed.attributes.push({
      key: "command.arguments",
      value: { stringValue: "must-not-be-consumed" },
    });
    const report = buildCommandLifecycleReport({
      manifest,
      coverage: coverage({
        collector: {
          eligibleInstallations: 100,
          reportingInstallations: 10,
          sampleRate: 0.01,
          platforms: { linux: 10, macos: 0, windows: 0 },
          knownBiases: [
            {
              id: "internal-only",
              description: "The cohort excludes public installations.",
              blocking: true,
            },
          ],
        },
      }),
      documents: [payload([malformed])],
    });

    expect(report.coverage.ready).toBe(false);
    expect(report.coverage.blockers).toEqual(
      expect.arrayContaining([
        "collector-coverage-too-low",
        "collector-bias-blocking:internal-only",
        "platform-coverage-missing:macos",
        "platform-coverage-missing:windows",
      ]),
    );
    expect(report.ingestion).toMatchObject({
      ready: false,
      acceptedPoints: 0,
      rejectedPoints: 1,
    });
    expect(report.summary.remove).toBe(0);
    expect(JSON.stringify(report)).not.toContain("must-not-be-consumed");
  });

  it("renders a content-free auditable markdown table", () => {
    const report = buildCommandLifecycleReport({
      manifest,
      coverage: coverage(),
      documents: [payload([point("dao", "replacement", 250)])],
      generatedAt: "2026-09-08T00:00:00.000Z",
    });
    const markdown = renderCommandLifecycleReportMarkdown(report);

    expect(markdown).toContain("# CLI command lifecycle decision report");
    expect(markdown).toContain(
      "| `dao` | `lab dao` | 0 | 250 | 0.00% | **remove** |",
    );
    expect(markdown).toContain("24 insufficient-data");
  });
});
