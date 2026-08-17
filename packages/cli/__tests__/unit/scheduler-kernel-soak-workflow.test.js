import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const WORKFLOW_PATH = resolve(
  REPOSITORY_ROOT,
  ".github/workflows/cli-scheduler-soak.yml",
);

function workflowSource() {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("scheduler kernel soak workflow contract", () => {
  it("exposes the scheduler soak through the root package script", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(REPOSITORY_ROOT, "package.json"), "utf8"),
    );

    expect(packageJson.scripts["test:cli-scheduler-soak"]).toBe(
      "node packages/cli/scripts/scheduler-kernel-soak.mjs",
    );
  });

  it("runs PR smoke and exact-commit formal profiles", () => {
    const workflow = workflowSource();

    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(
      /commit_sha:\s*\n\s+description:[^\n]+\n\s+required: true/u,
    );
    expect(workflow).toContain('options: ["7200", "14400"]');
    expect(workflow).not.toContain('"28800"');
    expect(workflow).toMatch(
      /seed:\s*\n\s+description:[^\n]+\n\s+required: true/u,
    );
    expect(workflow).toMatch(
      /campaign:\s*\n\s+description:[^\n]+\n\s+required: true/u,
    );
    expect(workflow).toContain(
      "CC_SCHEDULER_SOAK_MODE: ${{ github.event_name == 'pull_request' && 'smoke' || 'formal' }}",
    );
    expect(workflow).toContain(
      "CC_SCHEDULER_SOAK_DURATION_SECONDS: ${{ github.event_name == 'pull_request' && '15' || inputs.duration_seconds || '7200' }}",
    );
    expect(
      workflow.match(
        /CC_SCHEDULER_SOAK_LEASE_MS: \$\{\{ github\.event_name == 'pull_request' && '1000' \|\| '10000' \}\}/gu,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain("vars.CLI_SCHEDULER_SOAK_PINNED_SHA");
    expect(workflow).toContain("vars.CLI_SCHEDULER_SOAK_CAMPAIGN");
    expect(workflow).toContain(
      "CC_SCHEDULER_SOAK_WORKFLOW_SHA: ${{ github.workflow_sha }}",
    );
    expect(workflow).not.toContain("|| github.sha");
    expect(workflow).toContain(
      '".github/workflows/cli-scheduler-soak-campaign.yml"',
    );
    expect(workflow).toContain(
      '".github/workflows/cli-scheduler-soak-auto-dispatch.yml"',
    );
    expect(workflow).toContain(
      '"packages/cli/scripts/scheduler-kernel-soak-campaign.mjs"',
    );
    expect(workflow).not.toContain("[0-9a-f]{40,64}");
  });

  it("requires the complete three-host evidence and bounded resources", () => {
    const workflow = workflowSource();

    expect(workflow).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(workflow).toContain('CC_SCHEDULER_SOAK_MAX_RSS_GROWTH_MB: "128"');
    expect(workflow).toContain('CC_SCHEDULER_SOAK_MAX_RESOURCE_GROWTH: "8"');
    expect(workflow).toContain(
      'CC_SCHEDULER_SOAK_CLEANUP_DEADLINE_MS: "10000"',
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).toContain("retention-days: 90");
    expect(workflow).not.toContain("if-no-files-found: warn");
    expect(workflow).toContain(
      '[[ "${CC_SCHEDULER_SOAK_EXPECTED_SHA}" =~ ^[0-9a-f]{40}$ ]]',
    );
    expect(
      workflow.match(
        /test "\$\{actual_sha\}" = "\$\{CC_SCHEDULER_SOAK_EXPECTED_SHA\}"/gu,
      ),
    ).toHaveLength(2);
  });

  it("aggregates only one successful same-identity platform matrix", () => {
    const workflow = workflowSource();

    expect(workflow).toContain("scheduler-soak-aggregate:");
    expect(workflow).toContain("needs: scheduler-soak");
    expect(workflow).toContain("if: needs.scheduler-soak.result != 'success'");
    expect(workflow).toContain("actions/download-artifact@v7");
    expect(workflow).toContain("merge-multiple: true");
    expect(workflow).toContain("--verify-evidence-dir");
    expect(workflow).toContain(
      '--release-commit "${CC_SCHEDULER_SOAK_EXPECTED_SHA}"',
    );
    expect(workflow).toContain('--seed "${CC_SCHEDULER_SOAK_SEED}"');
    expect(workflow).toContain('--campaign "${CC_SCHEDULER_SOAK_CAMPAIGN}"');
    expect(workflow).toContain(
      "Verify exact SHA, profile, seed, campaign, duration, and invariants",
    );
    expect(workflow).toContain("cli-scheduler-soak-aggregate-");
  });
});
