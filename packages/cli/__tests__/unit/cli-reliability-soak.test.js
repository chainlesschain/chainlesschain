import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  descendantPidsFromProcessRows,
  percentile,
  recordBoundedSample,
  resolveReliabilityProfile,
} from "../../scripts/cli-reliability-soak.mjs";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);

describe("CLI reliability soak gate", () => {
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
    expect(gate).toContain("exactShaVerified");
    expect(gate).toContain("gitWorktreeChanges");
    expect(gate).toContain("chainlesschain.cli-reliability-soak.v2");
    expect(gate).toContain("CC_CLI_RELIABILITY_RESUME");
    expect(gate).toContain("partialScenarios");
    expect(gate).toContain("remoteRetired");
    expect(gate).toContain("CC_MCP_TOOL_RESULT_TOO_LARGE");
    expect(gate).toContain("CreateToolhelp32Snapshot");
    expect(gate).toContain('"--session",');
    expect(gate).toContain("reliability-disk-${expectedFsCode.toLowerCase()}");
    expect(gate).toContain("--ax-screen-reader");
    expect(gate).toContain("screen-reader-键盘-مرحبا-שלום");
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
