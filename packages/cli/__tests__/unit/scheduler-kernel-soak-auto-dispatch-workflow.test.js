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
  it("uses one gated daily dispatcher with only the authority it needs", () => {
    const workflow = workflowSource();

    expect(workflow).toContain('cron: "6 15 * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain(
      "if: vars.CLI_SCHEDULER_SOAK_AUTO_DISPATCH == 'true'",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain('MAX_SEGMENTS: "4"');
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
    expect(workflow).toContain('--ref "${PINNED_REF}"');
    expect(workflow).toContain('-f commit_sha="${PINNED_SHA}"');
    expect(workflow).toContain("-f duration_seconds=7200");
    expect(workflow).toContain('-f seed="${SEED}"');
    expect(workflow).toContain('-f campaign="${CAMPAIGN}"');
  });

  it("counts only successful or active exact-SHA dispatches and refuses duplicates", () => {
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
      "eligible.length >= maximum || active.length > 0",
    );
    expect(workflow).toContain("if: steps.plan.outputs.action == 'dispatch'");
  });
});
