import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const WORKFLOW_PATH = resolve(
  REPOSITORY_ROOT,
  ".github/workflows/cli-team-fairness-soak.yml",
);

function workflowSource() {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("Team fairness soak workflow contract", () => {
  it("exposes the harness through the root package", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(REPOSITORY_ROOT, "package.json"), "utf8"),
    );
    expect(packageJson.scripts["test:cli-team-fairness-soak"]).toBe(
      "node packages/cli/scripts/team-fairness-soak.mjs",
    );
  });

  it("runs PR smoke and explicit exact-SHA formal profiles", () => {
    const workflow = workflowSource();
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toMatch(
      /commit_sha:\s*\n\s+description:[^\n]+\n\s+required: true/u,
    );
    expect(workflow).toContain(
      "CC_TEAM_FAIRNESS_MODE: ${{ github.event_name == 'pull_request' && 'smoke' || 'formal' }}",
    );
    expect(workflow).not.toContain("|| github.sha");
  });

  it("requires and aggregates the complete same-SHA three-host matrix", () => {
    const workflow = workflowSource();
    expect(workflow).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(workflow).toContain(
      '[[ "${CC_TEAM_FAIRNESS_EXPECTED_SHA}" =~ ^[0-9a-f]{40}$ ]]',
    );
    expect(
      workflow.match(
        /test "\$\{actual_sha\}" = "\$\{CC_TEAM_FAIRNESS_EXPECTED_SHA\}"/gu,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain("needs: fairness-soak");
    expect(workflow).toContain("if: needs.fairness-soak.result != 'success'");
    expect(workflow).toContain("actions/download-artifact@v7");
    expect(workflow).toContain("merge-multiple: true");
    expect(workflow).toContain("--verify-evidence-dir");
    expect(workflow).toContain('--mode "${CC_TEAM_FAIRNESS_MODE}"');
    expect(workflow).not.toContain("if-no-files-found: warn");
    expect(workflow.match(/if-no-files-found: error/gu)).toHaveLength(2);
    expect(workflow.match(/retention-days: 90/gu)).toHaveLength(2);
  });
});
