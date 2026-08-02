import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveSessionScaleProfile } from "../../scripts/session-scale-gate.mjs";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const GATE_SCRIPT = join(
  REPOSITORY_ROOT,
  "packages/cli/scripts/session-scale-gate.mjs",
);
const WORKFLOW = join(
  REPOSITORY_ROOT,
  ".github/workflows/cli-session-scale.yml",
);
const roots = [];

function temporaryDirectory() {
  const root = mkdtempSync(join(tmpdir(), "cc-session-scale-test-"));
  roots.push(root);
  return root;
}

function runGate(output, overrides = {}, expectedCode = 0) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [GATE_SCRIPT], {
      cwd: REPOSITORY_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CC_SESSION_SCALE_MODE: "smoke",
        CC_SESSION_SCALE_EXPECTED_SHA: "",
        CC_SESSION_SCALE_OUTPUT: output,
        CC_SESSION_SCALE_WRITERS: "2",
        CC_SESSION_SCALE_EVENTS_PER_WRITER: "4",
        CC_SESSION_SCALE_SESSION_COUNT: "25",
        CC_SESSION_SCALE_TRANSCRIPT_BYTES: String(8 * 1024 * 1024),
        CC_SESSION_SCALE_LIST_SAMPLES: "3",
        CC_SESSION_SCALE_RESUME_SAMPLES: "3",
        CC_SESSION_SCALE_ACTUAL_KILL_CASES: "1",
        CC_SESSION_SCALE_EXHAUSTIVE_CUTS: "0",
        CC_SESSION_SCALE_LIST_P95_MS: "200",
        CC_SESSION_SCALE_LIST_RSS_MB: "100",
        CC_SESSION_SCALE_RESUME_P95_MS: "2000",
        CC_SESSION_SCALE_RESUME_RSS_MB: "100",
        CC_SESSION_SCALE_RESUME_MAX_IO_BYTES: String(1024 * 1024),
        ...overrides,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === expectedCode) resolvePromise({ stdout, stderr });
      else {
        rejectPromise(
          new Error(
            `session scale gate exited ${code ?? signal}\n${stderr}\n${stdout}`,
          ),
        );
      }
    });
  });
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("cli-session-scale gate", () => {
  it("runs bounded smoke through the production store and emits evidence", async () => {
    const output = join(temporaryDirectory(), "result.json");
    await runGate(output);
    const result = JSON.parse(readFileSync(output, "utf8"));

    expect(result).toMatchObject({
      schema: "cc-cli-session-scale-result/v1",
      status: "passed",
      platform: process.platform,
      parameters: { mode: "smoke", writers: 2, eventsPerWriter: 4 },
    });
    expect(result.exactSha).toMatch(/^[0-9a-f]{40,64}$/);
    expect(result.scenarios.concurrentAppend).toMatchObject({
      pass: true,
      observedProbeEvents: 8,
      uniqueProbeEvents: 8,
      chainStatus: "verified",
    });
    expect(result.scenarios.indexedList).toMatchObject({
      pass: true,
      commandSemantics: "listJsonlSessions({ limit: 10 })",
      fixture: { sessionCount: 25, sidecarEntries: 25 },
    });
    expect(result.scenarios.checkpointResume).toMatchObject({
      pass: true,
      fixture: {
        kind: "synthetic-valid-fully-hash-chained-jsonl",
        logicalBytes: 8 * 1024 * 1024,
        allRecordsValidJson: true,
        allRecordsHashChainedByConstruction: true,
        tailChainVerified: true,
        fullChainStatus: "verified",
      },
      proof: {
        boundedHeapProcessMb: 96,
        productionReverseReaderInstrumented: true,
        validJsonlConstructedWithProductionHasher: true,
        entireFileLoaded: false,
      },
    });
    expect(result.scenarios.checkpointResume.maxIoBytesRead).toBeLessThan(
      1024 * 1024,
    );
    expect(result.scenarios.crashRepair).toMatchObject({
      pass: true,
      byteCutCoverage: { exhaustive: false, failures: [] },
      actualProcessKillsTotal: 3,
      honestRepairGuards: {
        interiorTamper: { healthy: false, changed: false },
        multiplePartialRecords: { healthy: false, discardedRecords: 1 },
      },
    });
    expect(result.scenarios.crashRepair.partialRecordProcessKills).toHaveLength(
      1,
    );
    expect(result.scenarios.crashRepair.productionAppendPipelineKills).toEqual([
      expect.objectContaining({
        pass: true,
        point: "after-transcript",
        productionAppendEvent: true,
        staleOwnerLockRecovered: true,
      }),
      expect.objectContaining({
        pass: true,
        point: "after-sidecar",
        productionAppendEvent: true,
        staleOwnerLockRecovered: true,
      }),
    ]);
    expect(result.scenarios.crashRepair.byteCutCoverage.lastCut).toBe(
      result.scenarios.crashRepair.recordBytes,
    );
  }, 120_000);

  it("does not allow formal settings to weaken the documented matrix", () => {
    expect(
      resolveSessionScaleProfile({
        CC_SESSION_SCALE_MODE: "formal",
        CC_SESSION_SCALE_WRITERS: "1",
        CC_SESSION_SCALE_EVENTS_PER_WRITER: "1",
        CC_SESSION_SCALE_SESSION_COUNT: "1",
        CC_SESSION_SCALE_TRANSCRIPT_BYTES: "1024",
        CC_SESSION_SCALE_LIST_P95_MS: "500",
        CC_SESSION_SCALE_LIST_RSS_MB: "500",
        CC_SESSION_SCALE_RESUME_P95_MS: "5000",
        CC_SESSION_SCALE_RESUME_MAX_IO_BYTES: String(16 * 1024 * 1024),
      }),
    ).toMatchObject({
      mode: "formal",
      writers: 20,
      eventsPerWriter: 1_000,
      sessionCount: 10_000,
      transcriptBytes: 1024 ** 3,
      actualKillCases: 6,
      exhaustiveCuts: true,
      thresholds: {
        listP95Ms: 200,
        listRssMb: 100,
        resumeP95Ms: 2_000,
        resumeMaxIoBytes: 1024 ** 2,
      },
    });
    expect(() =>
      resolveSessionScaleProfile({ CC_SESSION_SCALE_MODE: "typo" }),
    ).toThrow(/formal or smoke/);
  });

  it("fails formal mode before the scale work when exact-SHA provenance is invalid", async () => {
    const output = join(temporaryDirectory(), "provenance-failure.json");
    await runGate(
      output,
      {
        CC_SESSION_SCALE_MODE: "formal",
        CC_SESSION_SCALE_EXPECTED_SHA: "0".repeat(40),
      },
      1,
    );
    const result = JSON.parse(readFileSync(output, "utf8"));
    expect(result).toMatchObject({
      status: "failed",
      expectedSha: "0".repeat(40),
      parameters: {
        mode: "formal",
        writers: 20,
        eventsPerWriter: 1_000,
        sessionCount: 10_000,
        transcriptBytes: 1024 ** 3,
      },
      scenarios: {},
    });
    expect(result.violations.join(" ")).toMatch(/exact SHA|provenance/);
  }, 30_000);

  it("declares a scheduled/manual three-platform exact-SHA artifact gate", () => {
    expect(existsSync(WORKFLOW)).toBe(true);
    const workflow = readFileSync(WORKFLOW, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(workflow).toContain("CC_SESSION_SCALE_EXPECTED_SHA");
    expect(workflow).toContain("CC_SESSION_SCALE_OUTPUT");
    expect(workflow).toContain("actions/upload-artifact@v6");
    expect(workflow).toContain(
      "cli-session-scale-${{ matrix.os }}-${{ env.CC_SESSION_SCALE_EXPECTED_SHA }}",
    );
    expect(workflow).toContain(
      "${{ runner.temp }}/cli-session-scale-result.json",
    );
  });
});
