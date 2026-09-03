import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

describe("E2E: evolution metrics truth surface", () => {
  const t = testHome("evolution-metrics-truth");

  afterAll(() => t.cleanup());

  const run = (args) =>
    spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...t.env(), NODE_NO_WARNINGS: "1" },
    });

  it("advertises only metrics-recording commands", () => {
    const result = run(["evolution", "--help"]);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain("record-model-metrics");
    expect(output).toContain("record-training-metrics-v2");
    expect(output).toContain("training-metrics-v2");
    expect(output).not.toMatch(/^\s+learn(?:\s|$)/m);
    expect(output).not.toMatch(/^\s+train-v2(?:\s|$)/m);
    expect(output).not.toMatch(/^\s+training-log-v2(?:\s|$)/m);
  });

  it("records formula model metrics without claiming training", () => {
    const result = run([
      "evolution",
      "record-model-metrics",
      "truth-model",
      "--data",
      "[1,2]",
      "--json",
    ]);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain('"metricKind": "synthetic-formula-estimate"');
    expect(output).toContain('"status": "metrics_recorded"');
    expect(output).toContain('"performedTraining": false');
    expect(output).not.toContain('"status": "completed"');
  });

  it("records caller-supplied loss metrics without inferring completion", () => {
    const result = run([
      "evolution",
      "record-training-metrics-v2",
      "--strategy",
      "replay",
      "--data-size",
      "10",
      "--loss-before",
      "0.5",
      "--loss-after",
      "0.49",
      "--json",
    ]);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain('"retentionAssessment": "threshold_met"');
    expect(output).toContain('"status": "metrics_recorded"');
    expect(output).toContain('"performedTraining": false');
    expect(output).not.toContain('"status": "completed"');
  });

  it.each(["learn", "train-v2", "training-log-v2"])(
    "rejects retired command %s",
    (command) => {
      const result = run(["evolution", command]);

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(
        `unknown command '${command}'`,
      );
    },
  );
});
