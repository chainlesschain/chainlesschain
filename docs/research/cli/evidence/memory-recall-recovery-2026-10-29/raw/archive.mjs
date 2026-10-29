import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = ".work/structured-memory-20261029";
const destination = "docs/research/cli/evidence/memory-recall-recovery-2026-10-29";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const cli = read("final-cli-regression.json");
assert.equal(cli.numPassedTests, 173);
assert.equal(cli.numFailedTests, 0);
for (const label of ["final-cli-regression", "final-node-regression", "kernel-regression"]) {
  const receipt = read(label + "-process.json");
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.sourcesStable, true);
  for (const [file, digest] of Object.entries(receipt.sourceAfter)) assert.equal(sha(fs.readFileSync(file)), digest, file);
}
assert.equal(fs.existsSync(destination), false);
fs.mkdirSync(destination, { recursive: true });
const artifacts = [];
function copy(source, relative) {
  const bytes = fs.readFileSync(source);
  fs.mkdirSync(path.dirname(path.join(destination, relative)), { recursive: true });
  fs.writeFileSync(path.join(destination, relative), bytes, { flag: "wx" });
  artifacts.push({ path: relative.replaceAll("\\", "/"), originalPath: source.replaceAll("\\", "/"), bytes: bytes.length, sha256: sha(bytes) });
}
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && /\.(?:json|log|mjs)$/.test(entry.name)) copy(path.join(root, entry.name), `raw/${entry.name}`);
}
function copyDirectory(directory, prefix) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDirectory(path.join(directory, entry.name), `${prefix}/${entry.name}`);
    else if (entry.isFile()) copy(path.join(directory, entry.name), `${prefix}/${entry.name}`);
    else throw new Error("Unexpected archive link");
  }
}
copyDirectory(path.join(root, "memory-ci673"), "raw/memory-ci673");
for (const entry of fs.readdirSync(".work/memory-query-bundle", { withFileTypes: true })) {
  if (entry.isFile() && entry.name.startsWith("bigint-identity-")) copy(`.work/memory-query-bundle/${entry.name}`, `raw/windows-identity/${entry.name}`);
}
for (const name of ["identity-probe.mjs", "identity-projection-probe.mjs", "run-identity-diagnostics.mjs"]) copy(`.work/background-worktree-20261029/${name}`, `raw/windows-identity/${name}`);
copyDirectory(".work/background-worktree-20261029/diagnostics-6uPwDh", "raw/windows-identity/diagnostics");
copyDirectory(".work/background-worktree-20261029/bundle-identity-fix", "raw/windows-identity/before");
const sources = read("final-cli-regression-process.json").sourceAfter;
for (const file of Object.keys(sources)) copy(file, `sources/${file}`);
const unix = [];
for (const platform of ["linux", "macos"]) {
  const report = read(`memory-ci673/${platform}/memory-query-index.json`);
  assert.equal(report.sourceHead, "673c2520a84f884dc4d072e222078f31b3090718");
  assert.equal(report.complete, true);
  let samples = 0;
  for (const tier of report.tiers) for (const group of Object.values(tier.groups)) {
    assert.equal(group.complete, true);
    assert.equal(group.samples.length, 11);
    for (const sample of group.samples) {
      assert.equal(sample.rowsDigest, tier.expectedDigest);
      assert.equal(sample.count, 20);
      samples++;
    }
  }
  const bytes = execFileSync("git", ["show", "673c2520a8:packages/cli/src/lib/context-memory-kernel/memory-query-bundle.js"]);
  assert.equal(sha(bytes), report.implementationSha256["memory-query-bundle.js"]);
  unix.push({ platform, verifiedSamples: samples, tiers: report.tiers.map(tier => ({ count: tier.count, p95Ms: Object.fromEntries(Object.entries(tier.groups).map(([mode, group]) => [mode, group.latency.p95Ms])) })) });
}
const summary = {
  schema: "chainlesschain.memory-recall-recovery-review/v1", observedAt: new Date().toISOString(),
  sourceHeadBeforeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceSha256: sources,
  tests: { cli: { files: cli.testResults.length, passed: cli.numPassedTests, skipped: cli.numPendingTests }, kernel: { passed: 135 }, cliNode: { passed: 26 }, windowsBundle: { node2212: { passed: 128, skipped: 1 }, node2222: { passed: 128, skipped: 1 }, additive: false } },
  unix673: unix,
  release: { fixedSource: "e7a6f2585d62949794596767869423b0eb670104", cliCi: 40784878922, attempt: 2, conclusion: "failure", published: false },
  boundaries: ["Revision checks rely on the host monotonic-revision contract and do not lock through dispatch.", "Semantic waiting is abortable; arbitrary host I/O still requires cooperative cancellation.", "The four real CLI compaction/resume journeys resume in the same process and inject model responses/compaction trigger scheduling.", "Recall text absence is checked in authoritative messages, not all physical replicas or historical user text.", "Windows device projection is reproduced with deterministic injection; actual CI stat fields remain pending the new diagnostic.", "Unix measurements belong to source 673, use 11 samples per group, and cannot admit the new source or a complete SLO.", "Test layers overlap; do not sum them as a repository-wide total."], artifacts,
};
fs.writeFileSync(path.join(destination, "review.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ destination, artifacts: artifacts.length, bytes: artifacts.reduce((sum, item) => sum + item.bytes, 0) }));
