import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXPECTED_REQUIRED_CELL_COUNT,
  META_WORKFLOW_PATH,
  SOURCE_RUNS,
  createSourceRunPlan,
  validateSourceRunAttestation,
  verifyMetaWorkflowAuthority,
  verifySourceRuns,
  writeGitHubOutputs,
} from "../../scripts/verify-claude-code-increment-source-runs.mjs";
import {
  TEST_REPOSITORY,
  createSourceTopology,
  writeJson,
} from "./claude-code-increment-source-fixture.js";

const HEAD_SHA = "a".repeat(40);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");
const roots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-increment-source-runs-"),
  );
  roots.push(root);
  return {
    root,
    ...createSourceTopology({ root, headSha: HEAD_SHA }),
  };
}

function authority() {
  return {
    githubActions: "true",
    githubSha: HEAD_SHA,
    workflowSha: "b".repeat(40),
    workflowRef: `${TEST_REPOSITORY}/${META_WORKFLOW_PATH}@refs/heads/feature/audit`,
    producerReader: () => Buffer.from("identical executed workflow bytes"),
  };
}

function replan(input) {
  return createSourceRunPlan({
    metadataDirectory: input.metadataDirectory,
    artifactsMetadataDirectory: input.artifactsMetadataDirectory,
    releaseCommit: HEAD_SHA,
    repository: TEST_REPOSITORY,
    required: true,
    authority: authority(),
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Claude increment source-run authority", () => {
  it("attests the real 12-commitment by three-OS artifact topology", () => {
    const input = fixture();
    const result = verifySourceRuns({
      plan: input.plan,
      fragmentsDirectory: input.fragmentsDirectory,
    });

    expect(result.runs).toHaveLength(7);
    expect(result.requiredCellCount).toBe(EXPECTED_REQUIRED_CELL_COUNT);
    expect(result.requiredCellCount).toBe(36);
    expect(result.cells).toHaveLength(36);
    expect(new Set(result.cells.map((cell) => cell.artifactId)).size).toBe(20);
    expect(
      result.cells.every(
        (cell) =>
          cell.runAttempt === 2 &&
          cell.artifactName.endsWith("-2") &&
          cell.artifactDigest.startsWith("sha256:"),
      ),
    ).toBe(true);
    expect(
      result.cells
        .filter((cell) => cell.commitmentId === "BROWSER-EVIDENCE")
        .every(
          (cell) =>
            cell.workflowProvenance.exactHeadWorkflowSha === HEAD_SHA &&
            cell.workflowProvenance.executedWorkflowDigest ===
              cell.workflowProvenance.exactHeadWorkflowDigest,
        ),
    ).toBe(true);
    expect(() => validateSourceRunAttestation(result)).not.toThrow();
    const githubOutput = path.join(input.root, "github-output.txt");
    writeGitHubOutputs(githubOutput, input.plan);
    const outputs = fs.readFileSync(githubOutput, "utf8");
    expect(outputs).toContain("marketplace_artifact_name=");
    expect(outputs).toContain("location_artifact_name=");
  });

  it("ignores unbound support fragments but rejects foreign artifact claims", () => {
    const input = fixture();
    const accessibilityFragment = input.fragmentPaths.get(
      "AX-TRANSCRIPT/linux",
    );
    const accessibility = readJson(accessibilityFragment);
    const supportPath = path.join(
      path.dirname(accessibilityFragment),
      "session-runtime-retention.json",
    );
    const support = {
      schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
      commitmentId: "SESSION-RUNTIME",
      headSha: HEAD_SHA,
      os: "linux",
      disposition: "advisory",
      outcome: "passed",
      source: {
        workflowId: accessibility.source.workflowId,
        runId: accessibility.source.runId,
        jobId: accessibility.source.jobId,
        artifactName: "session-runtime-retention.json",
      },
    };
    writeJson(supportPath, support);

    const result = verifySourceRuns({
      plan: input.plan,
      fragmentsDirectory: input.fragmentsDirectory,
    });
    expect(result.requiredCellCount).toBe(36);
    expect(result.cells).toHaveLength(36);

    support.source.artifactName = path.basename(
      path.dirname(accessibilityFragment),
    );
    writeJson(supportPath, support);
    expect(() =>
      verifySourceRuns({
        plan: input.plan,
        fragmentsDirectory: input.fragmentsDirectory,
      }),
    ).toThrow(/accessibility contains unexpected SESSION-RUNTIME fragment/u);
  });

  it("selects only exact current-attempt artifact IDs and rejects ambiguity", () => {
    const input = fixture();
    expect(
      input.plan.runs
        .flatMap((run) => run.artifacts)
        .every((artifact) => artifact.name.endsWith("-2")),
    ).toBe(true);

    const inventoryPath = path.join(
      input.artifactsMetadataDirectory,
      "safety.json",
    );
    const inventory = readJson(inventoryPath);
    const duplicate = structuredClone(inventory[0].artifacts.at(-1));
    duplicate.id += 100_000;
    duplicate.digest = `sha256:${"f".repeat(64)}`;
    inventory[0].artifacts.push(duplicate);
    writeJson(inventoryPath, inventory);

    expect(() => replan(input)).toThrow(
      /requires exactly one current-attempt artifact/u,
    );

    const unbound = fixture();
    const unboundPath = path.join(
      unbound.artifactsMetadataDirectory,
      "marketplace.json",
    );
    const unboundInventory = readJson(unboundPath);
    delete unboundInventory[0].artifacts.at(-1).workflow_run;
    writeJson(unboundPath, unboundInventory);
    expect(() => replan(unbound)).toThrow(/workflow run metadata/u);
  });

  it("rejects extra downloaded directories from an older attempt", () => {
    const input = fixture();
    fs.mkdirSync(
      path.join(input.fragmentsDirectory, "safety", "old-attempt-artifact"),
    );
    expect(() =>
      verifySourceRuns({
        plan: input.plan,
        fragmentsDirectory: input.fragmentsDirectory,
      }),
    ).toThrow(/downloaded artifact set/u);
  });

  it("rejects failed, stale, and wrong-workflow source-run metadata", () => {
    const cases = [
      [
        "safety",
        (metadata) => ({ ...metadata, conclusion: "failure" }),
        /safety run conclusion/u,
      ],
      [
        "sessionScale",
        (metadata) => ({ ...metadata, head_sha: "c".repeat(40) }),
        /sessionScale head SHA/u,
      ],
      [
        "ideExtensions",
        (metadata) => ({ ...metadata, path: ".github/workflows/other.yml" }),
        /ideExtensions workflow path/u,
      ],
    ];
    for (const [label, mutate, message] of cases) {
      const input = fixture();
      const metadataPath = path.join(input.metadataDirectory, `${label}.json`);
      writeJson(metadataPath, mutate(readJson(metadataPath)));
      expect(() => replan(input)).toThrow(message);
    }
  });

  it("requires exactly linux, macos, and windows for every commitment", () => {
    const missing = fixture();
    fs.rmSync(missing.fragmentPaths.get("PLUGIN-SOURCE/windows"));
    expect(() =>
      verifySourceRuns({
        plan: missing.plan,
        fragmentsDirectory: missing.fragmentsDirectory,
      }),
    ).toThrow(/required source cells must be exactly/u);

    const duplicate = fixture();
    fs.copyFileSync(
      duplicate.fragmentPaths.get("RC-DEFAULT/linux"),
      path.join(
        path.dirname(duplicate.fragmentPaths.get("RC-DEFAULT/linux")),
        "duplicate.json",
      ),
    );
    expect(() =>
      verifySourceRuns({
        plan: duplicate.plan,
        fragmentsDirectory: duplicate.fragmentsDirectory,
      }),
    ).toThrow(/duplicate required source cell RC-DEFAULT\/linux/u);
  });

  it("cross-binds fragment run, workflow, job, artifact, and attempt", () => {
    const input = fixture();
    const filePath = input.fragmentPaths.get("PLUGIN-SOURCE/macos");
    const fragment = readJson(filePath);
    fragment.source.runId = "999999";
    writeJson(filePath, fragment);
    expect(() =>
      verifySourceRuns({
        plan: input.plan,
        fragmentsDirectory: input.fragmentsDirectory,
      }),
    ).toThrow(/source run/u);

    const valid = fixture();
    const attestation = verifySourceRuns({
      plan: valid.plan,
      fragmentsDirectory: valid.fragmentsDirectory,
    });
    attestation.cells[0].runAttempt = 1;
    expect(() => validateSourceRunAttestation(attestation)).toThrow();

    const browser = fixture();
    const browserFragment = browser.fragmentPaths.get("BROWSER-EVIDENCE/linux");
    const summaryPath = path.join(
      path.dirname(browserFragment),
      "browser-evidence-journey-summary.json",
    );
    const summary = readJson(summaryPath);
    summary.workflow.runAttempt = "1";
    writeJson(summaryPath, summary);
    expect(() =>
      verifySourceRuns({
        plan: browser.plan,
        fragmentsDirectory: browser.fragmentsDirectory,
      }),
    ).toThrow();

    const mixedAuthority = fixture();
    const mixedAttestation = verifySourceRuns({
      plan: mixedAuthority.plan,
      fragmentsDirectory: mixedAuthority.fragmentsDirectory,
    });
    mixedAttestation.cells.find(
      (cell) =>
        cell.commitmentId === "BROWSER-EVIDENCE" && cell.os === "windows",
    ).workflowProvenance.executedWorkflowSha = "c".repeat(40);
    expect(() => validateSourceRunAttestation(mixedAttestation)).toThrow(
      /share one executed workflow authority/u,
    );
  });

  it("requires the aggregator's executed workflow bytes to match", () => {
    const workflowRef = `${TEST_REPOSITORY}/${META_WORKFLOW_PATH}@refs/heads/feature/audit`;
    expect(
      verifyMetaWorkflowAuthority({
        releaseCommit: HEAD_SHA,
        required: true,
        repository: TEST_REPOSITORY,
        ...authority(),
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
        repository: TEST_REPOSITORY,
        producerReader: (commit) => Buffer.from(commit),
      }),
    ).toThrow(/workflow bytes differ/u);
  });

  it("keeps all configured workflow commitments in the required topology", () => {
    expect(
      Object.values(SOURCE_RUNS).flatMap((source) => source.commitments),
    ).toHaveLength(12);
  });

  it("downloads the seven source groups only by API-resolved artifact IDs", () => {
    const workflow = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        ".github/workflows/claude-code-increment-audit.yml",
      ),
      "utf8",
    );
    expect(workflow.match(/^\s+artifact-ids:/gmu)).toHaveLength(7);
    expect(workflow.match(/^\s+merge-multiple: false/gmu)).toHaveLength(7);
    expect(
      workflow.match(
        /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/gu,
      ),
    ).toHaveLength(7);
    expect(workflow.match(/^\s+digest-mismatch: error/gmu)).toHaveLength(7);
    expect(workflow).not.toMatch(/^\s+pattern:/gmu);
    expect(workflow).toContain("gh api --paginate --slurp");
    expect(workflow).toContain("source-run-plan.json");
    expect(workflow).toContain(
      "fragments/marketplace/${{ steps.source_plan.outputs.marketplace_artifact_name }}",
    );
    expect(workflow).toContain(
      "fragments/location/${{ steps.source_plan.outputs.location_artifact_name }}",
    );
    expect(workflow).toContain(
      '--source-runs "$RUNNER_TEMP/claude-code-increment-source-runs.json"',
    );
  });
});
