import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const WORKFLOW_PATH = resolve(
  REPOSITORY_ROOT,
  ".github/workflows/cli-scheduler-soak-auto-dispatch.yml",
);

function workflowSource() {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("scheduler kernel soak auto-dispatch workflow contract", () => {
  it("uses one gated hourly planner with only the authority it needs", () => {
    const workflow = workflowSource();

    expect(workflow).toContain('cron: "6 * * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain(
      "if: vars.CLI_SCHEDULER_SOAK_AUTO_DISPATCH == 'true'",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain('MAX_SEGMENTS: "4"');
    expect(workflow).toContain('MIN_SEGMENT_START_GAP_SECONDS: "86400"');
    expect(workflow).toContain("elapsedSeconds >= minimumGapSeconds");
  });

  it("pins both the tested source and workflow control plane to an immutable tag", () => {
    const workflow = workflowSource();

    expect(workflow).toContain(
      "PINNED_REF: ${{ vars.CLI_SCHEDULER_SOAK_PINNED_REF }}",
    );
    expect(workflow).toContain(
      "PINNED_SHA: ${{ vars.CLI_SCHEDULER_SOAK_PINNED_SHA }}",
    );
    expect(workflow).toContain(
      "CAMPAIGN: ${{ vars.CLI_SCHEDULER_SOAK_CAMPAIGN }}",
    );
    expect(workflow).toContain("SEED: ${{ vars.CLI_SCHEDULER_SOAK_SEED }}");
    expect(workflow).toContain(
      '[[ "${PINNED_REF}" =~ ^v-npm-[0-9]+-[0-9]+-[0-9]+$ ]]',
    );
    expect(workflow).toContain('ref.object?.type !== "commit"');
    expect(workflow).toContain("ref.object?.sha !== process.env.PINNED_SHA");
    expect(workflow).toContain('-f ref="${PINNED_REF}"');
    expect(workflow).toContain('-f "inputs[commit_sha]=${PINNED_SHA}"');
    expect(workflow).toContain('-f "inputs[duration_seconds]=7200"');
    expect(workflow).toContain('-f "inputs[seed]=${SEED}"');
    expect(workflow).toContain('-f "inputs[campaign]=${CAMPAIGN}"');
  });

  it("counts exact-SHA segments, preserves the start gap, and finalizes once", () => {
    const workflow = workflowSource();

    expect(workflow).toContain(
      "/actions/workflows/cli-scheduler-soak.yml/runs?event=workflow_dispatch&per_page=100",
    );
    expect(workflow).toContain(
      'run?.path === ".github/workflows/cli-scheduler-soak.yml"',
    );
    expect(workflow).toContain("run?.head_sha === process.env.PINNED_SHA");
    expect(workflow).toContain(
      'run.status !== "completed" || run.conclusion === "success"',
    );
    expect(workflow).toContain("new Set(ids).size !== ids.length");
    expect(workflow).toContain(
      "eligible.length > maximum || successful.length > maximum",
    );
    expect(workflow).toContain("if: steps.plan.outputs.action == 'dispatch'");
    expect(workflow).toContain(
      "/actions/workflows/cli-scheduler-soak-campaign.yml/runs?event=workflow_dispatch&per_page=100",
    );
    expect(workflow).toContain("run?.display_title === expectedTitle");
    expect(workflow).toContain("verifierRuns.length > 1");
    expect(workflow).toContain("if: steps.plan.outputs.action == 'verify'");
    expect(workflow).toContain(
      "/actions/workflows/cli-scheduler-soak.yml/dispatches",
    );
    expect(workflow).toContain(
      "/actions/workflows/cli-scheduler-soak-campaign.yml/dispatches",
    );
    expect(workflow).toContain('-f ref="${DEFAULT_BRANCH}"');
    expect(workflow).toContain('-f "inputs[run_ids]=${RUN_IDS}"');
    expect(workflow).toContain("gh api --silent --method POST");
    expect(workflow).toContain("Scheduler segment dispatch failed");
    expect(workflow).toContain("Scheduler campaign dispatch failed");
  });
});
