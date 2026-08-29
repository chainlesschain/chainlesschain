import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assembleReleaseEvidence,
  validateReleaseEvidence,
} = require("./release-evidence.cjs");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const candidateSha = option("--commit");
const repository = option("--repository");
const outputPath = option("--output");
const runIds = {
  "CLI CI": option("--cli-ci-run"),
  "CLI Strict Sandbox": option("--cli-strict-run"),
  "Context Memory Kernel CI": option("--context-memory-run"),
  "Context Memory Long Soak": option("--long-soak-run"),
};
if (!candidateSha || !repository || !outputPath || Object.values(runIds).some((id) => !id)) {
  throw new Error("commit, repository, output, and all four workflow run IDs are required");
}
const requirements = JSON.parse(
  readFileSync(new URL("../release/required-evidence.v1.json", import.meta.url), "utf8"),
);
const runs = Object.entries(runIds).map(([expectedName, runId]) => {
  const run = JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${repository}/actions/runs/${runId}`],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ),
  );
  if (run.name !== expectedName) {
    throw new Error(`run ${runId} is ${run.name}, expected ${expectedName}`);
  }
  return {
    id: run.id,
    name: run.name,
    head_sha: run.head_sha,
    conclusion: run.conclusion,
    run_attempt: run.run_attempt,
    html_url: run.html_url,
  };
});
const manifest = assembleReleaseEvidence({
  candidateSha,
  repository,
  requirements,
  runs,
});
validateReleaseEvidence(manifest, requirements, {
  expectedCommit: candidateSha,
  expectedRepository: repository,
});
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
