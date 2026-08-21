import fs from "node:fs";
import path from "node:path";

import { browserEvidenceDigest } from "../../src/lib/browser-evidence.js";

import {
  META_WORKFLOW_PATH,
  REQUIRED_OPERATING_SYSTEMS,
  SOURCE_RUNS,
  createSourceRunPlan,
  expectedArtifactNames,
  expectedFragmentSource,
} from "../../scripts/verify-claude-code-increment-source-runs.mjs";

export const TEST_REPOSITORY = "chainlesschain/chainlesschain";
const BROWSER_WORKFLOW_PATH = ".github/workflows/ide-extensions.yml";

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function createSourceTopology({
  root,
  headSha,
  repository = TEST_REPOSITORY,
  runAttempt = 2,
  fragmentFactory,
  browserWorkflowDigest = `sha256:${"d".repeat(64)}`,
  aggregatorWorkflowBytes = Buffer.from("identical executed workflow bytes"),
}) {
  const metadataDirectory = path.join(root, "source-run-metadata");
  const artifactsMetadataDirectory = path.join(
    root,
    "source-artifact-metadata",
  );
  const fragmentsDirectory = path.join(root, "evidence");
  const fragmentPaths = new Map();
  let runId = 90_000;
  let artifactId = 700_000;

  for (const [label, sourceRun] of Object.entries(SOURCE_RUNS)) {
    runId += 1;
    const names = expectedArtifactNames(label, headSha, runAttempt);
    const artifacts = names.map((name) => ({
      id: ++artifactId,
      name,
      expired: false,
      digest: `sha256:${artifactId.toString(16).padStart(64, "0")}`,
      size_in_bytes: artifactId,
      workflow_run: { id: runId, head_sha: headSha },
    }));
    const previousAttemptArtifacts = names.map((name) => ({
      id: ++artifactId,
      name: name.replace(new RegExp(`-${runAttempt}$`, "u"), "-1"),
      expired: false,
      digest: `sha256:${artifactId.toString(16).padStart(64, "0")}`,
      size_in_bytes: artifactId,
      workflow_run: { id: runId, head_sha: headSha },
    }));

    writeJson(path.join(metadataDirectory, `${label}.json`), {
      id: runId,
      run_attempt: runAttempt,
      head_sha: headSha,
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      path: sourceRun.workflowPath,
      html_url: `https://github.com/${repository}/actions/runs/${runId}`,
      repository: { full_name: repository },
    });
    writeJson(path.join(artifactsMetadataDirectory, `${label}.json`), [
      {
        total_count: artifacts.length + previousAttemptArtifacts.length,
        artifacts: [...previousAttemptArtifacts, ...artifacts],
      },
    ]);

    for (const commitmentId of sourceRun.commitments) {
      for (const operatingSystem of REQUIRED_OPERATING_SYSTEMS) {
        const expectedSource = expectedFragmentSource(
          label,
          commitmentId,
          operatingSystem,
          headSha,
          runAttempt,
        );
        const source = {
          workflowId: `${repository}/${sourceRun.workflowPath}@refs/heads/feature/audit`,
          runId: String(runId),
          jobId: expectedSource.jobId,
          artifactName: expectedSource.artifactName,
        };
        let value = fragmentFactory
          ? fragmentFactory({
              commitmentId,
              headSha,
              operatingSystem,
              source,
            })
          : {
              schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
              commitmentId,
              headSha,
              os: operatingSystem,
              disposition: "required",
              outcome: "passed",
              source,
            };
        let browserWorkflow = null;
        if (label === "ideExtensions") {
          browserWorkflow = {
            schema: "chainlesschain.browser-evidence-workflow-provenance.v1",
            repository,
            ref: "refs/heads/feature/audit",
            workflowRef: source.workflowId,
            workflowPath: BROWSER_WORKFLOW_PATH,
            executedWorkflowSha: "b".repeat(40),
            executedWorkflowDigest: browserWorkflowDigest,
            exactHeadWorkflowSha: headSha,
            exactHeadWorkflowDigest: browserWorkflowDigest,
            runId: String(runId),
            runAttempt: String(runAttempt),
          };
          value = {
            ...value,
            measurements: {
              ...(value.measurements || {}),
              workflowProvenanceDigest: browserEvidenceDigest(browserWorkflow),
            },
            producerDigests: {
              ...(value.producerDigests || {}),
              [BROWSER_WORKFLOW_PATH]: browserWorkflowDigest,
            },
          };
        }
        const filePath = path.join(
          fragmentsDirectory,
          label,
          expectedSource.artifactName,
          `${commitmentId}-${operatingSystem}.json`,
        );
        writeJson(filePath, value);
        if (browserWorkflow) {
          writeJson(
            path.join(
              path.dirname(filePath),
              "browser-evidence-journey-summary.json",
            ),
            {
              schema: "chainlesschain.browser-evidence-journey-summary.v2",
              workflow: browserWorkflow,
            },
          );
        }
        fragmentPaths.set(`${commitmentId}/${operatingSystem}`, filePath);
      }
    }
  }

  const plan = createSourceRunPlan({
    metadataDirectory,
    artifactsMetadataDirectory,
    releaseCommit: headSha,
    repository,
    required: true,
    authority: {
      githubActions: "true",
      githubSha: headSha,
      workflowSha: "b".repeat(40),
      workflowRef: `${repository}/${META_WORKFLOW_PATH}@refs/heads/feature/audit`,
      producerReader: () => aggregatorWorkflowBytes,
    },
  });

  return {
    artifactsMetadataDirectory,
    fragmentPaths,
    fragmentsDirectory,
    metadataDirectory,
    plan,
    repository,
    runAttempt,
  };
}
