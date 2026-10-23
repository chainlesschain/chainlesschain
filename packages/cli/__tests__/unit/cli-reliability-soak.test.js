import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  descendantPidsFromProcessRows,
  diskFailureDiagnostics,
  mcpOutputScenario,
  observeChildCompletion,
  percentile,
  pipeScenario,
  recordBoundedSample,
  reliabilityTurnDelayMs,
  resolveReliabilityProfile,
} from "../../scripts/cli-reliability-soak.mjs";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  child.pid = 123;
  return child;
}

const pipeProfile = {
  pipeCases: 1,
  cleanupDeadlineMs: 10_000,
  slowConsumerMs: 10,
};
const privateStderr = "Error: ENOENT open /private/SECRET_CANARY\n";

function finishChild(child, code, output = "") {
  if (output) child.stdout.write(output);
  child.emit("exit", code, null);
  // stderr can arrive after exit, before close.
  child.stderr.end(privateStderr);
  child.stdout.end();
  child.emit("close", code, null);
}

describe("CLI reliability soak gate", () => {
  it("ignores error-code prose in MCP context while retaining actual result errors", async () => {
    const home = mkdtempSync(resolve(tmpdir(), "cc-mcp-code-diagnostic-"));
    try {
      const report = await mcpOutputScenario(
        "http://localhost",
        home,
        pipeProfile,
        {
          mcpObservations: () => ({ requestCount: 0 }),
        },
        {
          spawnChild() {
            const child = fakeChild();
            setImmediate(() =>
              finishChild(
                child,
                1,
                JSON.stringify({
                  type: "context",
                  content: "ERR_MODULE_NOT_FOUND",
                }) +
                  "\n" +
                  JSON.stringify({
                    type: "result",
                    subtype: "error",
                    is_error: true,
                    code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
                    error: "Model request was rejected",
                  }) +
                  "\n",
              ),
            );
            return child;
          },
        },
      );
      expect(report.pass).toBe(false);
      expect(report.diagnosticCodes).toEqual([
        "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      ]);
      expect(report.stdoutBytes).toBeGreaterThan(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("classifies fixed Windows startup errors without retaining message content", () => {
    const report = diskFailureDiagnostics(
      "Evolution ingress: Windows local UI durable storage requires a local NTFS directory\n" +
        "private /home/SECRET_CANARY\n",
    );
    expect(report.classes).toEqual([
      "evolution-ingress-startup",
      "ntfs-directory-required",
    ]);
    expect(JSON.stringify(report)).not.toMatch(
      /SECRET_CANARY|Evolution ingress|\/home/u,
    );
  });

  it.each([
    [
      "ledger file identity changed during Windows ACL verification",
      "ledger-windows-acl-identity",
    ],
    [
      "ArtifactStore index pathname and descriptor identities differ",
      "artifact-index-path-handle-identity",
    ],
  ])(
    "distinguishes the fixed startup error %s without copying stderr",
    (message, label) => {
      const report = diskFailureDiagnostics(
        `Evolution ingress: ${message}\r\n/private/SECRET_CANARY\n`,
      );
      expect(report.classes).toEqual(["evolution-ingress-startup", label]);
      expect(JSON.stringify(report)).not.toMatch(
        /SECRET_CANARY|private|Evolution ingress/u,
      );
      expect(
        diskFailureDiagnostics(`Context prose quotes ${message}\n`).classes,
      ).not.toContain(label);
    },
  );

  it("retains stderr and the failed exit from a real no-output child", async () => {
    let spawned = 0;
    let report;
    await expect(
      pipeScenario("http://localhost", "unused", pipeProfile, {
        spawnChild() {
          const first = spawned++ === 0;
          return spawn(
            process.execPath,
            [
              "-e",
              first
                ? "process.stdout.write('output\\n')"
                : "process.stderr.write('Error: EACCES open /private/SECRET_CANARY\\n'); process.exitCode = 1",
            ],
            { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
          );
        },
        countDescendants: () => 0,
        checkpoint: (value) => {
          report = structuredClone(value);
        },
      }),
    ).rejects.toThrow("slow pipe consumer exited before output");
    expect(spawned).toBe(2);
    expect(report.slowConsumers[0]).toMatchObject({
      exitCode: 1,
      outputBytes: 0,
      startupDiagnostics: { fsCodes: ["EACCES"], operations: ["open"] },
    });
    expect(report.slowConsumers[0].stderrBytes).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/private|SECRET_CANARY/u);
  });

  it("observes completion before a late waiter and drains stderr after exit", async () => {
    const child = fakeChild();
    const completion = observeChildCompletion(child);
    let closed = false;
    completion.closed.then(() => {
      closed = true;
    });
    child.emit("exit", 1, null);
    await Promise.resolve();
    expect(closed).toBe(false);
    child.emit("close", 1, null);
    await expect(completion.wait(100)).resolves.toEqual({
      code: 1,
      signal: null,
    });
  });

  it.each([0, 1])(
    "hard fails a no-output exit %i and retains every executed child",
    async (code) => {
      let spawned = 0;
      const snapshots = [];
      const run = pipeScenario(
        "http://localhost",
        "unused",
        { ...pipeProfile, pipeCases: 2 },
        {
          spawnChild() {
            const child = fakeChild();
            const index = spawned++;
            setImmediate(() =>
              finishChild(
                child,
                index < 2 ? 0 : code,
                index < 2 ? "output\n" : "",
              ),
            );
            return child;
          },
          countDescendants: () => 0,
          checkpoint: (value) => snapshots.push(structuredClone(value)),
        },
      );
      await expect(run).rejects.toThrow(
        "slow pipe consumer exited before output",
      );
      expect(spawned).toBe(3);
      const report = snapshots.at(-1);
      expect(report.pass).toBe(false);
      expect(report.brokenConsumers).toHaveLength(2);
      expect(report.slowConsumers).toHaveLength(1);
      expect(report.slowConsumers[0]).toMatchObject({
        exitCode: code,
        outputBytes: 0,
        stallObserved: false,
        failureReason: "slow pipe consumer exited before output",
        startupDiagnostics: {
          fsCodes: ["ENOENT"],
          operations: ["open"],
          classes: ["command-error"],
        },
      });
      for (const sample of [
        ...report.brokenConsumers,
        ...report.slowConsumers,
      ]) {
        expect(sample.stderrBytes).toBe(Buffer.byteLength(privateStderr));
      }
      expect(JSON.stringify(snapshots)).not.toMatch(
        /private|SECRET_CANARY|Error:/u,
      );
    },
  );

  it("accepts valid pipe output when exit precedes the end of the intentional stall", async () => {
    const report = await pipeScenario(
      "http://localhost",
      "unused",
      pipeProfile,
      {
        spawnChild() {
          const child = fakeChild();
          setImmediate(() =>
            finishChild(child, 0, '{"type":"result","is_error":false}\n'),
          );
          return child;
        },
        countDescendants: () => 0,
      },
    );
    expect(report.pass).toBe(true);
    expect(report.slowConsumers[0].actualStallMs).toBeGreaterThanOrEqual(
      pipeProfile.slowConsumerMs,
    );
  });

  it("retains failed spawn evidence without serializing the arbitrary error", async () => {
    let report;
    await expect(
      pipeScenario("http://localhost", "unused", pipeProfile, {
        spawnChild() {
          const child = fakeChild();
          setImmediate(() => {
            child.emit("error", new Error("/private/SECRET_CANARY"));
            finishChild(child, -2);
          });
          return child;
        },
        countDescendants: () => 0,
        checkpoint: (value) => {
          report = structuredClone(value);
        },
      }),
    ).rejects.toThrow("child process error");
    expect(report.brokenConsumers[0].failureReason).toBe("child process error");
    expect(JSON.stringify(report)).not.toMatch(/private|SECRET_CANARY/u);
  });

  it("retains allowlisted MCP startup diagnostics after an early failure", async () => {
    const home = mkdtempSync(resolve(tmpdir(), "soak-mcp-evidence-"));
    try {
      const report = await mcpOutputScenario(
        "http://localhost",
        home,
        pipeProfile,
        {
          mcpObservations: () => ({
            requestCount: 0,
            toolCallResponses: 0,
            finalResponses: 0,
          }),
        },
        {
          spawnChild() {
            const child = fakeChild();
            setImmediate(() => finishChild(child, 1));
            return child;
          },
        },
      );
      expect(report.pass).toBe(false);
      expect(report.exit.code).toBe(1);
      expect(report.stdoutBytes).toBe(0);
      expect(report.stderrBytes).toBe(Buffer.byteLength(privateStderr));
      expect(report.startupDiagnostics).toEqual({
        fsCodes: ["ENOENT"],
        operations: ["open"],
        classes: ["command-error"],
      });
      expect(JSON.stringify(report)).not.toMatch(
        /\/private\/|SECRET_CANARY|Error:/u,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps disk startup diagnostics bounded and content-free", () => {
    const diagnostics = diskFailureDiagnostics(
      "[DatabaseManager] Database initialized: /private/canary.db\n" +
        "Error: ENOSPC: no space left on device, mkdir /private/secret-token\n" +
        '{"error":{"message":"EROFS open /private/key","code":"SECRET_CANARY"}}',
    );
    expect(diagnostics).toEqual({
      fsCodes: ["EROFS", "ENOSPC"],
      operations: ["mkdir", "open"],
      classes: ["database-initialized", "fatal-json", "command-error"],
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /private|canary|secret|key/iu,
    );
    expect(
      diskFailureDiagnostics("x".repeat(64 * 1024) + " ENOSPC").fsCodes,
    ).toEqual([]);
  });
  it("keeps formal duration, turn, concurrency, and pipe floors", () => {
    expect(
      resolveReliabilityProfile({
        CC_CLI_RELIABILITY_MODE: "formal",
        CC_CLI_RELIABILITY_DURATION_SECONDS: "1",
        CC_CLI_RELIABILITY_TURNS: "1",
        CC_CLI_RELIABILITY_WARMUP_TURNS: "1",
        CC_CLI_RELIABILITY_AGENTS: "1",
        CC_CLI_RELIABILITY_PIPE_CASES: "1",
        CC_CLI_RELIABILITY_DISCONNECT_CASES: "1",
        CC_CLI_RELIABILITY_SLOW_CONSUMER_MS: "1",
        CC_CLI_RELIABILITY_CHECKPOINT_INTERVAL_SECONDS: "1",
        CC_CLI_RELIABILITY_CLEANUP_DEADLINE_MS: "50000",
      }),
    ).toMatchObject({
      mode: "formal",
      durationSeconds: 7_200,
      turns: 1_000,
      warmupTurns: 20,
      concurrentAgents: 20,
      pipeCases: 20,
      disconnectCases: 5,
      slowConsumerMs: 2_000,
      checkpointIntervalSeconds: 1,
      cleanupDeadlineMs: 10_000,
    });
  });

  it("computes an observed nearest-rank p95", () => {
    expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5);
    expect(percentile([], 95)).toBe(0);
  });

  it("retains a bounded rolling latency sample", () => {
    const samples = [];
    for (let count = 1; count <= 7; count += 1) {
      recordBoundedSample(samples, count, count, 3);
    }
    expect(samples).toHaveLength(3);
    expect([...samples].sort((left, right) => left - right)).toEqual([5, 6, 7]);
  });

  it("spreads the required turns across the complete soak duration", () => {
    expect(reliabilityTurnDelayMs(0, 1_000, 7_200_000, 0)).toBe(7_200);
    expect(reliabilityTurnDelayMs(499, 1_000, 7_200_000, 3_590_000)).toBe(
      10_000,
    );
    expect(reliabilityTurnDelayMs(999, 1_000, 7_200_000, 7_200_000)).toBe(0);
    expect(reliabilityTurnDelayMs(3, 0, 7_200_000, 0)).toBe(0);
  });

  it("walks a bounded process snapshot transitively and cycle-safely", () => {
    expect(
      descendantPidsFromProcessRows(
        [
          { processId: 20, parentProcessId: 10 },
          { processId: 30, parentProcessId: 20 },
          { processId: 40, parentProcessId: 30 },
          { processId: 20, parentProcessId: 40 },
          { processId: 50, parentProcessId: 999 },
          { processId: "invalid", parentProcessId: 10 },
        ],
        10,
      ),
    ).toEqual([20, 30, 40]);
  });

  it("declares an exact-SHA three-platform artifact workflow with real SSH", () => {
    const workflowPath = resolve(
      REPOSITORY_ROOT,
      ".github/workflows/cli-reliability-soak.yml",
    );
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(workflow).toContain("CC_CLI_RELIABILITY_EXPECTED_SHA");
    expect(workflow).toContain("npm run test:cli-reliability-soak");
    expect(workflow).toContain("openssh-server");
    expect(workflow).toContain("ssh-keygen");
    expect(workflow).toContain("Configure real EROFS and ENOSPC");
    expect(workflow).toContain("mount -t tmpfs");
    expect(workflow).toContain("CC_CLI_RELIABILITY_DISK_EROFS_HOME");
    expect(workflow).toContain(
      'umount "${CC_CLI_RELIABILITY_DISK_EROFS_HOME}/sessions"',
    );
    expect(workflow).toContain(
      "Verify macOS node-pty spawn helper is executable",
    );
    expect(workflow).toContain('[[ ! -x "${helper}" ]]');
    expect(workflow).toContain("cli-reliability-mcp-server.mjs");
    expect(workflow).toContain("actions/upload-artifact@v6");

    const gate = readFileSync(
      resolve(REPOSITORY_ROOT, "packages/cli/scripts/cli-reliability-soak.mjs"),
      "utf8",
    );
    const hostMetrics = readFileSync(
      resolve(REPOSITORY_ROOT, "packages/cli/scripts/soak-host-metrics.mjs"),
      "utf8",
    );
    expect(gate).toContain("exactShaVerified");
    expect(gate).toContain("gitWorktreeChanges");
    expect(gate).toContain("chainlesschain.cli-reliability-soak.v2");
    expect(gate).toContain("CC_CLI_RELIABILITY_RESUME");
    expect(gate).toContain("partialScenarios");
    expect(gate).toContain("remoteRetired");
    expect(gate).toContain("CC_MCP_TOOL_RESULT_TOO_LARGE");
    expect(gate).toContain('from "./soak-host-metrics.mjs"');
    expect(hostMetrics).toContain("CreateToolhelp32Snapshot");
    expect(gate).toContain('"--session",');
    expect(gate).toContain("reliability-disk-${expectedFsCode.toLowerCase()}");
    expect(gate).toContain("--ax-screen-reader");
    expect(gate).toContain("screen-reader-键盘-مرحبا-שלום");
    expect(gate).toContain("readinessObserved");
    expect(gate).toContain('mode: "duration-spread"');
    expect(gate).toContain("ansiColorObserved");
    expect(gate).toContain("repaintObserved");
    expect(gate).toContain("CC_CLI_RELIABILITY_CLIPBOARD_REQUIRED");
    expect(gate).toContain("Get-Clipboard -Raw");
    expect(gate).toContain('spawnSync("pbpaste"');
    expect(gate).toContain("unicodeRoundTripMatched");

    const mcpFixture = readFileSync(
      resolve(
        REPOSITORY_ROOT,
        "packages/cli/scripts/cli-reliability-mcp-server.mjs",
      ),
      "utf8",
    );
    expect(mcpFixture).toContain("oversized_output");
    expect(mcpFixture).toContain("CC_RELIABILITY_MCP_PRIVATE_CANARY");
  });
});
