import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  META_WORKFLOW_PATH,
  SOURCE_RUNS,
  verifyMetaWorkflowAuthority,
  verifySourceRuns,
} from "../../scripts/verify-claude-code-increment-source-runs.mjs";

const HEAD_SHA = "a".repeat(40);
const REPOSITORY = "chainlesschain/chainlesschain";
const roots = [];

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-increment-source-runs-"),
  );
  roots.push(root);
  const metadataDirectory = path.join(root, "metadata");
  const fragmentsDirectory = path.join(root, "fragments");
  let runId = 90_000;
  for (const [label, source] of Object.entries(SOURCE_RUNS)) {
    runId += 1;
    writeJson(path.join(metadataDirectory, `${label}.json`), {
      id: runId,
      run_attempt: 1,
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      path: source.workflowPath,
      html_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}`,
      repository: { full_name: REPOSITORY },
    });
    for (const commitmentId of source.commitments) {
      writeJson(
        path.join(fragmentsDirectory, label, `${commitmentId}.json`),
        {
          schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
          commitmentId,
          headSha: HEAD_SHA,
          os: "linux",
          disposition: "required",
          source: {
            workflowId:
              `${REPOSITORY}/${source.workflowPath}@refs/heads/feature/audit`,
            runId: String(runId),
          },
        },
      );
    }
  }
  return { root, metadataDirectory, fragmentsDirectory };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Claude increment source-run authority", () => {
  it("binds each commitment to a successful exact-head workflow run", () => {
    const input = fixture();
    const result = verifySourceRuns({
      metadataDirectory: input.metadataDirectory,
      fragmentsDirectory: input.fragmentsDirectory,
      releaseCommit: HEAD_SHA,
      repository: REPOSITORY,
    });

    expect(result.runs).toHaveLength(7);
    expect(result.requiredCellCount).toBe(12);
    expect(new Set(result.runs.map((run) => run.runId)).size).toBe(7);
  });

  it("rejects failed, stale, and wrong-workflow source runs", () => {
    const failed = fixture();
    const safetyPath = path.join(failed.metadataDirectory, "safety.json");
    const safety = JSON.parse(fs.readFileSync(safetyPath, "utf8"));
    safety.conclusion = "failure";
    writeJson(safetyPath, safety);
    expect(() =>
      verifySourceRuns({
        metadataDirectory: failed.metadataDirectory,
        fragmentsDirectory: failed.fragmentsDirectory,
        releaseCommit: HEAD_SHA,
        repository: REPOSITORY,
      }),
    ).toThrow(/safety run conclusion/u);

    const stale = fixture();
    const sessionPath = path.join(
      stale.metadataDirectory,
      "sessionScale.json",
    );
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.head_sha = "b".repeat(40);
    writeJson(sessionPath, session);
    expect(() =>
      verifySourceRuns({
        metadataDirectory: stale.metadataDirectory,
        fragmentsDirectory: stale.fragmentsDirectory,
        releaseCommit: HEAD_SHA,
        repository: REPOSITORY,
      }),
    ).toThrow(/sessionScale head SHA/u);

    const wrongWorkflow = fixture();
    const browserPath = path.join(
      wrongWorkflow.metadataDirectory,
      "ideExtensions.json",
    );
    const browser = JSON.parse(fs.readFileSync(browserPath, "utf8"));
    browser.path = ".github/workflows/other.yml";
    writeJson(browserPath, browser);
    expect(() =>
      verifySourceRuns({
        metadataDirectory: wrongWorkflow.metadataDirectory,
        fragmentsDirectory: wrongWorkflow.fragmentsDirectory,
        releaseCommit: HEAD_SHA,
        repository: REPOSITORY,
      }),
    ).toThrow(/ideExtensions workflow path/u);
  });

  it("rejects fragments copied from another run", () => {
    const input = fixture();
    const fragmentPath = path.join(
      input.fragmentsDirectory,
      "marketplace",
      "PLUGIN-SOURCE.json",
    );
    const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
    fragment.source.runId = "999999";
    writeJson(fragmentPath, fragment);

    expect(() =>
      verifySourceRuns({
        metadataDirectory: input.metadataDirectory,
        fragmentsDirectory: input.fragmentsDirectory,
        releaseCommit: HEAD_SHA,
        repository: REPOSITORY,
      }),
    ).toThrow(/source run/u);
  });

  it("requires the aggregator's executed workflow bytes to match", () => {
    const workflowRef =
      `${REPOSITORY}/${META_WORKFLOW_PATH}@refs/heads/feature/audit`;
    expect(
      verifyMetaWorkflowAuthority({
        releaseCommit: HEAD_SHA,
        required: true,
        githubActions: "true",
        githubSha: HEAD_SHA,
        workflowSha: "b".repeat(40),
        workflowRef,
        repository: REPOSITORY,
        producerReader: () => Buffer.from("same workflow"),
      }),
    ).toMatch(/^sha256:/u);

    expect(() =>
      verifyMetaWorkflowAuthority({
        releaseCommit: HEAD_SHA,
        required: true,
        githubActions: "true",
        githubSha: HEAD_SHA,
        workflowSha: "b".repeat(40),
        workflowRef,
        repository: REPOSITORY,
        producerReader: (commit) => Buffer.from(commit),
      }),
    ).toThrow(/workflow bytes differ/u);
  });
});
