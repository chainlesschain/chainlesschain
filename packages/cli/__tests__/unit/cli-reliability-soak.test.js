import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  percentile,
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
        CC_CLI_RELIABILITY_AGENTS: "1",
        CC_CLI_RELIABILITY_PIPE_CASES: "1",
        CC_CLI_RELIABILITY_CLEANUP_DEADLINE_MS: "50000",
      }),
    ).toMatchObject({
      mode: "formal",
      durationSeconds: 7_200,
      turns: 1_000,
      concurrentAgents: 20,
      pipeCases: 20,
      cleanupDeadlineMs: 10_000,
    });
  });

  it("computes an observed nearest-rank p95", () => {
    expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5);
    expect(percentile([], 95)).toBe(0);
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
    expect(workflow).toContain("actions/upload-artifact@v6");

    const gate = readFileSync(
      resolve(REPOSITORY_ROOT, "packages/cli/scripts/cli-reliability-soak.mjs"),
      "utf8",
    );
    expect(gate).toContain("exactShaVerified");
    expect(gate).toContain("gitWorktreeChanges");
  });
});
