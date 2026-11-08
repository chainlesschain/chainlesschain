import { afterEach, describe, expect, it, vi } from "vitest";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMemoryMixedBenchmark } from "../../scripts/memory-mixed-concurrency-benchmark.mjs";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
});

function capture() {
  const reports = [];
  return {
    reports,
    onProgress: (report) => reports.push(structuredClone(report)),
  };
}

describe("mixed Memory evidence checkpoints", { timeout: 150000 }, () => {
  it("marks success only after real concurrent rounds and the full audit", async () => {
    const evidence = capture();
    const report = await runMemoryMixedBenchmark({
      counts: [1000],
      rounds: 1,
      onProgress: evidence.onProgress,
    });
    expect(report.complete).toBe(true);
    expect(report.tiers[0]).toMatchObject({
      complete: true,
      finalAuditVerified: true,
      finalDeletionVisibilityVerified: true,
      lockReleased: true,
    });
    const pending = evidence.reports.find(
      (entry) =>
        entry.tiers[0]?.rounds.length === 1 && !entry.tiers[0].complete,
    );
    expect(pending.complete).toBe(false);
    expect(pending.tiers[0].finalAuditVerified).toBe(false);
    for (const result of report.tiers[0].rounds[0].results) {
      expect(result.lifecycle.phase).toBe("closed");
      expect(result.lifecycle.spawnedAt).toBeLessThanOrEqual(
        result.lifecycle.readyAt,
      );
      expect(result.lifecycle.readyAt).toBeLessThanOrEqual(
        result.lifecycle.startedAt,
      );
      expect(result.lifecycle.startedAt).toBeLessThanOrEqual(
        result.lifecycle.resultAt,
      );
      expect(result.lifecycle.resultAt).toBeLessThanOrEqual(
        result.lifecycle.closedAt,
      );
    }
  });

  it("preserves the first verified round when a second-round worker dies", async () => {
    const evidence = capture();
    const fork = childProcess.fork;
    let spawned = 0;
    vi.spyOn(childProcess, "fork").mockImplementation((...args) => {
      const child = fork(...args);
      if (++spawned === 9) child.once("spawn", () => child.kill());
      return child;
    });
    syncBuiltinESMExports();
    await expect(
      runMemoryMixedBenchmark({
        counts: [1000],
        rounds: 2,
        onProgress: evidence.onProgress,
      }),
    ).rejects.toThrow(/mixed Memory worker failed/);
    const report = evidence.reports.at(-1);
    expect(report).toMatchObject({
      complete: false,
      failure: { stage: "worker", count: 1000, round: 2 },
    });
    expect(report.failure.worker.pid).toBeGreaterThan(0);
    expect(report.tiers[0].rounds).toHaveLength(1);
    expect(report.tiers[0].rounds[0].generationsVerified).toBe(true);
    expect(report.tiers[0].complete).toBe(false);
    expect(report.tiers[0].finalAuditVerified).toBe(false);
  });

  it("retains verified rounds without granting final audit success when export fails", async () => {
    const evidence = capture();
    vi.spyOn(SegmentedMemoryPort.prototype, "exportSnapshot").mockRejectedValue(
      new Error("injected final audit failure"),
    );
    await expect(
      runMemoryMixedBenchmark({
        counts: [1000],
        rounds: 1,
        onProgress: evidence.onProgress,
      }),
    ).rejects.toThrow("injected final audit failure");
    const report = evidence.reports.at(-1);
    expect(report.failure).toMatchObject({
      stage: "final-audit",
      count: 1000,
      round: null,
    });
    expect(report.complete).toBe(false);
    expect(report.tiers[0].rounds).toHaveLength(1);
    expect(report.tiers[0].finalAuditVerified).toBe(false);
  });

  it("preserves both errors when the failure checkpoint cannot be written", async () => {
    let report;
    const error = await runMemoryMixedBenchmark({
      counts: [1000],
      rounds: 1,
      onProgress: (current) => {
        report = structuredClone(current);
        throw new Error("injected evidence write failure");
      },
    }).catch((failure) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(2);
    expect(error.cause.message).toBe("injected evidence write failure");
    expect(report).toMatchObject({
      complete: false,
      failure: { stage: "checkpoint" },
    });
  });

  it("does not grant overall completion when the final source binding changes", async () => {
    const evidence = capture();
    const read = fs.readFileSync;
    let changed = false;
    vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      const bytes = read(file, ...args);
      if (
        changed &&
        file instanceof URL &&
        file.pathname.endsWith("/memory-mixed-concurrency-benchmark.mjs")
      )
        return Buffer.concat([
          bytes,
          Buffer.from("\n// injected source change\n"),
        ]);
      return bytes;
    });
    await expect(
      runMemoryMixedBenchmark({
        counts: [1000],
        rounds: 1,
        onProgress: (report) => {
          evidence.onProgress(report);
          if (report.tiers[0]?.complete) changed = true;
        },
      }),
    ).rejects.toThrow("implementation changed during measurement");
    expect(evidence.reports.at(-1)).toMatchObject({
      complete: false,
      failure: { stage: "source-stability" },
      tiers: [{ complete: true, finalAuditVerified: true }],
    });
  });

  for (const businessFailure of [false, true]) {
    it(`keeps cleanup failure visible after ${businessFailure ? "a business failure" : "successful audits"}`, async () => {
      const evidence = capture();
      const remove = fs.rmSync;
      const parent = fs.realpathSync.native(os.tmpdir());
      let retained;
      vi.spyOn(fs, "rmSync").mockImplementation((target, ...args) => {
        if (
          typeof target === "string" &&
          path.dirname(path.resolve(target)) === parent &&
          path.basename(target).startsWith("cc-memory-mixed-")
        ) {
          retained = target;
          throw new Error("injected cleanup failure");
        }
        return remove(target, ...args);
      });
      try {
        const error = await runMemoryMixedBenchmark({
          counts: [1000],
          rounds: 1,
          onProgress: (report) => {
            evidence.onProgress(report);
            if (businessFailure && !report.failure)
              throw new Error("injected primary failure");
          },
        }).catch((failure) => failure);
        const report = evidence.reports.at(-1);
        expect(report.complete).toBe(false);
        expect(evidence.reports.some((entry) => entry.complete)).toBe(false);
        if (businessFailure) {
          expect(error).toBeInstanceOf(AggregateError);
          expect(error.cause.message).toBe("injected primary failure");
          expect(report.failure.message).toBe("injected primary failure");
          expect(report.cleanupFailure.message).toBe(
            "injected cleanup failure",
          );
        } else {
          expect(error.message).toBe("injected cleanup failure");
          expect(report.failure.stage).toBe("cleanup");
          expect(report.tiers[0].finalAuditVerified).toBe(true);
        }
      } finally {
        if (retained) {
          expect(path.dirname(path.resolve(retained))).toBe(parent);
          remove(retained, { recursive: true, force: true });
        }
      }
    });
  }

  it("refuses to overwrite earlier CLI evidence before running any fixture", () => {
    const parent = fs.realpathSync.native(os.tmpdir());
    const directory = fs.mkdtempSync(
      path.join(parent, "cc-mixed-checkpoint-test-"),
    );
    try {
      const output = path.join(directory, "existing.json");
      fs.writeFileSync(output, "original evidence\n");
      const child = childProcess.spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../../scripts/memory-mixed-concurrency-benchmark.mjs",
              import.meta.url,
            ),
          ),
          "--counts",
          "1000",
          "--rounds",
          "1",
          "--output",
          output,
        ],
        { encoding: "utf8", timeout: 30000, windowsHide: true },
      );
      expect(child.error).toBeUndefined();
      expect(child.status).not.toBe(0);
      expect(child.stderr).toContain("EEXIST");
      expect(fs.readFileSync(output, "utf8")).toBe("original evidence\n");
    } finally {
      expect(path.dirname(path.resolve(directory))).toBe(parent);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
