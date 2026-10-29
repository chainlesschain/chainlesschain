import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = ".work/budget-egress-20261029";
const destination = "docs/research/cli/evidence/budget-egress-review-2026-10-29";
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const after = read("main-after.json");
const processReceipt = read("main-after-process.json");
assert.equal(processReceipt.exitCode, 0);
assert.equal(processReceipt.before, processReceipt.after);
assert.equal(after.sourceReview.sourceReviewPassed, true);
assert.equal(after.readiness.paidReady, false);
assert.equal(after.runtimeCoverageVerified, false);
const historical = read("e7-audit-process.json");
assert.equal(historical.sourceCommit, "e7a6f2585d62949794596767869423b0eb670104");
assert.equal(historical.exitCode, 1);
assert.equal(historical.sourcesStable, true);
assert.equal(historical.statusAfter, "");
assert.equal(fs.existsSync(destination), false);
fs.mkdirSync(destination, { recursive: true });
const artifacts = [];
function copy(file, relative) {
  const bytes = fs.readFileSync(file);
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx" });
  artifacts.push({ path: relative, originalPath: file, bytes: bytes.length, sha256: sha(bytes) });
}
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && /\.(?:json|log|mjs|patch)$/.test(entry.name)) copy(path.join(root, entry.name), `raw/${entry.name}`);
}
for (const name of ["budget-current.json", "budget-inventory-regression.log", "budget-inventory-regression-process.json", "release130-attempt2-terminal-run.json", "release130-attempt2-terminal-jobs.json", "release130-attempt2-read-receipts.json", "release130-verify-failed-process.json", "release130-verify-job-log-process.json"]) copy(`.work/structured-memory-20261029/${name}`, `raw/${name}`);
const applied = read("applied-main-review.json");
const sourceHashes = {};
for (const entry of applied.changes) {
  const bytes = fs.readFileSync(entry.path);
  assert.equal(`sha256:${sha(bytes)}`, entry.digest, entry.path);
  sourceHashes[entry.path] = entry.digest;
}
copy("packages/cli/scripts/budget-egress-reviewed-sources.json", "sources/catalogue-after.json");
copy("packages/cli/scripts/implementation-plan-budget-egress.mjs", "sources/implementation-plan-budget-egress.mjs");
copy("packages/cli/scripts/lib/budget-egress-inventory.mjs", "sources/budget-egress-inventory.mjs");
const summary = {
  schema: "chainlesschain.budget-egress-source-review-recovery/v1", observedAt: new Date().toISOString(),
  sourceHeadBeforeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceHashes,
  historicalE7: { source: historical.sourceCommit, actualExitCode: historical.exitCode, clean: true, issues: read("e7-audit.json").sourceReview.issues },
  mainAfter: { actualExitCode: processReceipt.exitCode, candidateFiles: after.networkCandidates.length, reviewIssues: after.sourceReview.issues, parseErrors: after.parseErrors.length, skippedPaths: after.skippedPaths.length, paidReady: after.readiness.paidReady, runtimeCoverageVerified: after.runtimeCoverageVerified, catalogueDigest: processReceipt.after },
  inventoryTests: { passed: 19, failed: 0, receipt: "raw/budget-inventory-regression-process.json" },
  release: { fixedSourceUnchanged: historical.sourceCommit, cliRun: 40784878922, attempt: 2, conclusion: "failure", published: false },
  boundaries: ["The exact historical e7 checkout has two stale entries; the later main tree has seven. Do not substitute main results for e7 results.", "The e7 proposal is archived and was not applied to the release source or validation tag.", "A byte-bound source classification does not grant financial admission or establish arbitrary dynamic/OS descendant containment.", "Historical detailed job logs could not be fetched due to HTTP403. Job metadata and exact-source local reproduction are separate evidence.", "Any new release source needs its own complete exact-source operating-system matrices."], artifacts,
};
fs.writeFileSync(path.join(destination, "review.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ destination, artifacts: artifacts.length }));
