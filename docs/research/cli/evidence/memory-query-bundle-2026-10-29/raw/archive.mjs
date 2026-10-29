import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const local = ".work/memory-query-bundle";
const destination = "docs/research/cli/evidence/memory-query-bundle-2026-10-29";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = name => JSON.parse(fs.readFileSync(path.join(local, name), "utf8"));
const smoke = read("reviewed-smoke.json");
const stop = read("reviewed-stop.json");
const tests = read("reviewed-regression.json");
const control = read("negative-control-summary.json");
assert.equal(smoke.complete, true);
assert.equal(stop.targetMet, true);
assert.equal(tests.success, true);
assert.equal(tests.numPassedTests, 110);
assert.equal(tests.numPendingTests, 2);
assert.equal(control.killed, true);
for (const name of ["reviewed-smoke", "reviewed-stop", "cli-node-reviewed", "kernel-formatted", "kernel-formatted-parity"]) {
  const receipt = read(`${name}-process.json`);
  assert.equal(receipt.exitCode, 0, name);
  assert.equal(receipt.sourcesStable, true, name);
}
const finalSources = read("reviewed-smoke-process.json").sourceAfter;
for (const [file, digest] of Object.entries(finalSources)) {
  assert.equal(sha(fs.readFileSync(file)), digest, `measured source changed: ${file}`);
}
assert.equal(fs.existsSync(destination), false, "Never overwrite archived evidence");
fs.mkdirSync(destination, { recursive: true });
const artifacts = [];
function copy(source, relative) {
  const bytes = fs.readFileSync(source);
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx" });
  artifacts.push({ path: relative.replaceAll("\\", "/"), originalPath: source.replaceAll("\\", "/"), bytes: bytes.length, sha256: sha(bytes) });
}
// Bounded task-only directories; no traversal of the broader .work tree.
for (const entry of fs.readdirSync(local, { withFileTypes: true })) {
  if (entry.isFile() && /\.(?:json|log|mjs|js)$/.test(entry.name)) copy(path.join(local, entry.name), `raw/${entry.name}`);
}
const directories = ["cold-cpu-cH1aAO", "canonical-allocation-Ozh9m3", "canonical-allocation-PMXXwt", "canonical-allocation-byee2x", "canonical-allocation-BVg95p", "canonical-landed-validation-k4yfzg"];
for (const directory of directories) {
  function visit(relative = "") {
    for (const entry of fs.readdirSync(path.join(local, directory, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(next);
      else if (entry.isFile() && (entry.name !== "fixture.json" || directory === "canonical-allocation-PMXXwt")) copy(path.join(local, directory, next), path.join("raw", directory, next));
      else if (!entry.isFile()) throw new Error("Unexpected non-regular archive input");
    }
  }
  visit();
}
for (const file of Object.keys(finalSources)) copy(file, `sources/${file}`);
const summary = {
  schema: "chainlesschain.memory-query-bundle-review/v1",
  observedAt: new Date().toISOString(),
  sourceHeadBeforeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceSha256: finalSources,
  validations: {
    cliVitest: { files: tests.testResults.length, passed: tests.numPassedTests, skipped: tests.numPendingTests, failed: tests.numFailedTests, receipt: "raw/reviewed-regression-process.json" },
    cliNode: { passed: 26, failed: 0, receipt: "raw/cli-node-reviewed-process.json", sandboxFirstAttempt: { passed: 22, failed: 4, reason: "native owner-only ACL verification", log: "raw/cli-node.log" } },
    kernel: { passed: 130, failed: 0, receipt: "raw/kernel-formatted-process.json" },
    canonicalParity: { positive: 43332, rejection: 56, receipt: "raw/kernel-formatted-parity-process.json", result: "raw/canonical-allocation-BVg95p/validation.json" },
    warmCacheNegativeControl: control,
    identityBefore: { passed: 1, failed: 2, receipt: "raw/identity-negative-v2-process.json", earlierFixtureFailure: "raw/identity-negative-process.json" },
    identityAfter: { passed: 3, failed: 0, receipt: "raw/identity-fixed-process.json" },
  },
  querySmoke: { samplesPerGroup: smoke.samples, cacheMode: smoke.cacheMode, indexLayout: smoke.indexLayout, scope: "11-sample diagnostic; no 100-sample SLO acceptance", tiers: smoke.tiers.map(tier => ({ count: tier.count, groups: Object.fromEntries(Object.entries(tier.groups).map(([name, group]) => [name, group.latency])) })) },
  stop: { targetMet: stop.targetMet, report: "raw/reviewed-stop.json" },
  release: { fixedSource: "e7a6f2585d62949794596767869423b0eb670104", published: false, retryReceipt: "raw/release130-ci-retry-receipt.json", scope: "Do not use this main-branch change as fixed e7 release evidence" },
  boundaries: [
    "With a valid bundle, individual query files are compatibility copies and are not checked on every warm query. Active bundle bytes are always checked.",
    "Public canonicalize behavior is unchanged; final canonical.js also includes Prettier-only formatting compared with reviewed CLI regression source. Formatted kernel tests/parity and final measurement bind the final bytes.",
    "Canonical parity raw helper retains prototype metadata/note from its origin; the source-bound process receipt and actual apis.compatible production import establish the tested implementation.",
    "One synthetic 3K fixture is retained under compatible benchmark PMXXwt; identical omitted fixtures can be regenerated from the archived harness.",
    "Archived experiment helpers expect restoration under .work/memory-query-bundle; raw execution paths are retained.",
    "No real model requests; real accepted products remain 34/45. Microsoft channel deferred.",
  ],
  artifacts,
};
fs.writeFileSync(path.join(destination, "review.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ destination, artifacts: artifacts.length, bytes: artifacts.reduce((sum, item) => sum + item.bytes, 0) }));
