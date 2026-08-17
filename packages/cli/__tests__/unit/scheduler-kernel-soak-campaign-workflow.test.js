import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const WORKFLOW_PATH = resolve(
  REPOSITORY_ROOT,
  ".github/workflows/cli-scheduler-soak-campaign.yml",
);

function workflowSource() {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("scheduler kernel soak campaign workflow contract", () => {
  it("accepts only an explicitly pinned four-run campaign identity", () => {
    const workflow = workflowSource();

    expect(workflow).toContain(
      'run-name: "P2-4 scheduler campaign ${{ inputs.campaign }} ${{ inputs.commit_sha }}"',
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toMatch(
      /commit_sha:\s*\n\s+description:[^\n]+\n\s+required: true/u,
    );
    expect(workflow).toMatch(
      /run_ids:\s*\n\s+description:[^\n]+\n\s+required: true/u,
    );
    expect(workflow).toContain('options: ["7200", "14400"]');
    expect(workflow).toContain("!/^[0-9a-f]{40}$/u.test(commitSha)");
    expect(workflow).toContain("inputRunIds.length !== 4");
    expect(workflow).toContain("new Set(runIds).size !== runIds.length");
    expect(workflow).toContain('!["7200", "14400"].includes');
    expect(workflow).toContain("Number(seed) > 0xffffffff");
    expect(workflow).toContain(
      "const expectedRef = `refs/heads/${process.env.INPUT_DEFAULT_BRANCH}`",
    );
    expect(workflow).toContain(
      "campaign verifier must run from the default branch",
    );
  });

  it("uses least privilege and rejects untrusted or failed source runs", () => {
    const workflow = workflowSource();

    expect(workflow).toMatch(
      /permissions:\s*\n\s+contents: read\s*\n\s+actions: read/u,
    );
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("actions: write");
    expect(workflow).toContain(
      "matrix:\n        run_id: ${{ fromJSON(needs.validate-inputs.outputs.run_ids) }}",
    );
    expect(workflow).toContain(
      'source.status !== "completed" || source.conclusion !== "success"',
    );
    expect(workflow).toContain(
      'source.path !== ".github/workflows/cli-scheduler-soak.yml"',
    );
    expect(workflow).toContain(
      '!/^[0-9a-f]{40}$/u.test(String(source.head_sha || ""))',
    );
    expect(workflow).toContain(
      '!["schedule", "workflow_dispatch"].includes(source.event)',
    );
    expect(workflow).toContain('-H "X-GitHub-Api-Version: 2022-11-28"');
    expect(
      workflow.match(
        /test "\$\{actual_sha\}" = "\$\{CC_SCHEDULER_SOAK_VERIFIER_SHA\}"/gu,
      ),
    ).toHaveLength(2);
  });

  it("downloads one exact successful attempt and re-verifies its raw matrix", () => {
    const workflow = workflowSource();

    expect(
      workflow.match(/uses: actions\/download-artifact@v7/gu),
    ).toHaveLength(4);
    expect(workflow).toContain("cli-scheduler-soak-Linux-");
    expect(workflow).toContain("cli-scheduler-soak-Windows-");
    expect(workflow).toContain("cli-scheduler-soak-macOS-");
    expect(workflow.match(/run-id: \$\{\{ matrix\.run_id \}\}/gu)).toHaveLength(
      3,
    );
    expect(
      workflow.match(/github-token: \$\{\{ github\.token \}\}/gu),
    ).toHaveLength(3);
    expect(workflow).toContain("${{ steps.source.outputs.run_attempt }}");
    expect(workflow).toContain(
      "node packages/cli/scripts/scheduler-kernel-soak.mjs",
    );
    expect(workflow).toContain("--verify-evidence-dir");
    expect(workflow).toContain(
      '--release-commit "${CC_SCHEDULER_SOAK_EXPECTED_SHA}"',
    );
    expect(workflow).toContain('--seed "${CC_SCHEDULER_SOAK_SEED}"');
    expect(workflow).toContain('--campaign "${CC_SCHEDULER_SOAK_CAMPAIGN}"');
    expect(workflow).toContain("CC_SCHEDULER_SOAK_MODE: formal");
    expect(workflow).toContain('CC_SCHEDULER_SOAK_LEASE_MS: "10000"');
    expect(workflow).toContain(
      "segment.profile?.durationSeconds !== durationSeconds",
    );
    expect(workflow).toContain('segment.profile?.mode !== "formal"');
    expect(workflow).toContain(
      "segment.execution?.runId !== process.env.SOURCE_RUN_ID",
    );
    expect(workflow).toContain(
      "segment.execution?.runAttempt !== sourceRunAttempt",
    );
    expect(workflow).toContain(
      "segment.execution?.controlPlaneSha !==\n              String(source.head_sha).toLowerCase()",
    );
    expect(workflow).toContain(
      'segment.execution?.workflow !== "CLI Scheduler Kernel Soak"',
    );
    expect(workflow).toContain("segment.execution?.eventName !== source.event");
    expect(workflow).toContain("segment.sourceRun = {");
    expect(workflow).toContain("segment.sourceArtifacts = artifacts");
    expect(workflow).toContain(
      '!/^sha256:[0-9a-f]{64}$/u.test(String(artifact.digest || ""))',
    );
    expect(workflow).toContain(
      'cp "${RUNNER_TEMP}/scheduler-soak-raw-${SOURCE_RUN_ID}"/*.json "${stage}/raw/"',
    );
  });

  it("fails closed before issuing a 72-hour campaign manifest", () => {
    const workflow = workflowSource();

    expect(workflow).toContain("verify-campaign:");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      "if: needs.validate-inputs.result != 'success' || needs.verify-segment.result != 'success'",
    );
    expect(workflow).toContain("cli-scheduler-soak-campaign-segment-*");
    expect(workflow).toContain(
      "node packages/cli/scripts/scheduler-kernel-soak-campaign.mjs",
    );
    expect(workflow).toContain("--minimum-observation-hours 72");
    expect(workflow).toContain("--minimum-segments 4");
    expect(workflow).toContain("--maximum-gap-hours 30");
    expect(workflow).toContain(
      '--output "${RUNNER_TEMP}/scheduler-soak-campaign-evidence.json"',
    );
    expect(workflow).toContain(
      '--verifier-control-plane-sha "${CC_SCHEDULER_SOAK_VERIFIER_SHA}"',
    );
    expect(workflow).toContain(
      '--verifier-workflow-ref "${CC_SCHEDULER_SOAK_VERIFIER_WORKFLOW_REF}"',
    );
    expect(workflow).toContain(
      'cp -R "${RUNNER_TEMP}/scheduler-soak-campaign-segments"/. "${bundle}/"',
    );
    expect(workflow).toContain(
      "path: ${{ runner.temp }}/scheduler-soak-campaign-bundle",
    );
    expect(workflow.match(/if-no-files-found: error/gu)).toHaveLength(2);
    expect(workflow.match(/retention-days: 90/gu)).toHaveLength(2);
    expect(workflow).not.toContain("if-no-files-found: warn");
  });
});
