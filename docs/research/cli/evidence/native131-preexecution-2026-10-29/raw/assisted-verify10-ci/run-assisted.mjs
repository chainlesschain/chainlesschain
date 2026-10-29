import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const payload = path.dirname(fileURLToPath(import.meta.url));
const repository = process.cwd();
const output = path.resolve(process.argv[2] || "assisted-verify10-output");
assert.equal(process.platform, "linux", "Linux Docker runner required");
assert.equal(process.version, "v22.12.0", "Exact operator Node required");
assert.ok(!fs.existsSync(output), "Use a fresh output directory");
fs.mkdirSync(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(fs.readFileSync(path.join(payload, "manifest.json")));
const env = Object.fromEntries(["PATH", "TEMP", "TMP", "DOCKER_HOST", "DOCKER_CONTEXT"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const summary = {
  kind: "assisted-non-native", revision: 2, previousAssistedRun: "40905084060", sourceRun: manifest.sourceRun,
  originalNativeResult: "FAILED", cumulativeAccepted: "34/45 unchanged",
  newModelRequests: 0, generationAssessment: "NOT_PERFORMED",
  frozenProjectCommit: manifest.frozenProjectCommit, imageId: manifest.imageId,
  payloadDigests: manifest.files, stages: {}, pass: false,
};
const workspace = path.join(output, "workspace");
const pack = path.join(output, "pack");
const commands = path.join(output, "commands");
fs.mkdirSync(workspace); fs.mkdirSync(pack); fs.mkdirSync(commands);
function command(label, executable, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(executable, args, { env, cwd: repository, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options });
  fs.writeFileSync(path.join(commands, label + ".stdout.log"), result.stdout || "");
  fs.writeFileSync(path.join(commands, label + ".stderr.log"), result.stderr || "");
  fs.writeFileSync(path.join(commands, label + ".process.json"), JSON.stringify({ executable, args: label.startsWith("stage-") ? ["--input-type=module", "--eval", "<exact archived script bytes>", workspace, "<deadline>"] : args, exitCode: result.status, signal: result.signal, error: result.error?.message || null, elapsedMs: Date.now() - started }, null, 2));
  assert.equal(result.error, undefined, `${label}: process error`);
  assert.equal(result.status, 0, `${label}: nonzero process exit`);
  return result.stdout;
}
let frozenBindings;
function verifyFrozen() {
  for (const [file, digest] of Object.entries(frozenBindings)) assert.equal(hash(fs.readFileSync(path.join(workspace, file))), digest, `frozen file changed: ${file}`);
}
function stage(label, name) {
  const bytes = fs.readFileSync(path.join(payload, `verify-10-${name}.mjs`));
  assert.equal(hash(bytes), manifest.files[`verify-10-${name}.mjs`]);
  const deadline = Date.now() + 20 * 60 * 1000;
  const stdout = command(`stage-${label}`, process.execPath, ["--input-type=module", "--eval", bytes.toString("utf8"), workspace, String(deadline)], { cwd: pack, timeout: 21 * 60 * 1000 });
  const verdict = JSON.parse(stdout.trim());
  assert.match(verdict.receipt, new RegExp(`^verify-10-${name}-[a-f0-9-]+\\.json$`));
  const receiptBytes = fs.readFileSync(path.join(pack, "acceptance-evidence", verdict.receipt));
  assert.equal(`sha256:${hash(receiptBytes)}`, verdict.receiptDigest);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.taskId, "verify-10"); assert.equal(receipt.stage, name);
  assert.equal(receipt.pass, verdict.pass); assert.equal(receipt.imageId, manifest.imageId);
  assert.equal(receipt.providerAssessed, false); assert.equal(receipt.productionAttested, false);
  summary.stages[label] = { ...verdict, scriptDigest: hash(bytes), tests: receipt.tests, mutations: receipt.mutations };
  verifyFrozen();
  return receipt;
}
try {
  for (const [file, digest] of Object.entries(manifest.files)) assert.equal(hash(fs.readFileSync(path.join(payload, file))), digest, `payload changed: ${file}`);
  const original = fs.readFileSync(path.join(payload, "original.test.js"), "utf8");
  const paginationOnly = fs.readFileSync(path.join(payload, "pagination-only.test.js"), "utf8");
  const repaired = fs.readFileSync(path.join(payload, "repaired.test.js"), "utf8");
  const deletion = original.indexOf('it("after a delete,');
  assert.ok(deletion > 0);
  assert.equal(paginationOnly, original.slice(0, deletion).replace("const pageSize = 2;", "const pageSize = 3;") + original.slice(deletion).replace("const pageSize = 3;", "const pageSize = 2;"));
  assert.equal([...repaired.matchAll(/\bit\(/g)].length, 6);
  const image = JSON.parse(command("image", "docker", ["image", "inspect", "node:22.12.0-bookworm"]))[0];
  assert.equal(image.Id, manifest.imageId);
  const archive = path.join(output, "frozen.tar");
  command("archive", "git", ["archive", "--format=tar", `--output=${archive}`, manifest.frozenProjectCommit]);
  command("extract", "tar", ["-xf", archive, "-C", workspace]);
  const checker = fs.readFileSync(path.join(payload, "verify-10-check.mjs"), "utf8");
  const spec = JSON.parse(checker.match(/^const spec = (.+);$/m)[1]);
  assert.equal(spec.imageId, manifest.imageId);
  frozenBindings = Object.fromEntries([spec.sourcePath, ...spec.baselineTests, ...spec.testSupport.map(x => x.path)].map(file => [file, hash(fs.readFileSync(path.join(workspace, file)))]));
  for (const support of spec.testSupport) assert.equal(`sha256:${frozenBindings[support.path]}`, support.digest);
  summary.frozenBindings = frozenBindings;
  const candidate = path.join(workspace, spec.expectedFiles[0]);
  assert.ok(!fs.existsSync(candidate));
  const setup = stage("setup", "setup");
  assert.equal(setup.pass, true);
  assert.deepEqual(setup.tests, [{ kind: "baseline", total: 2, passed: 2, failed: 0 }]);
  fs.writeFileSync(candidate, original, { flag: "wx" });
  const failed = stage("original", "check");
  assert.equal(failed.pass, false, "Original candidate must reproduce failure");
  const originalReport = JSON.parse(failed.executions.at(-1).stdout);
  assert.equal(originalReport.numTotalTests, 6); assert.equal(originalReport.numPassedTests, 4); assert.equal(originalReport.numFailedTests, 2);
  assert.equal(failed.mutations.length, 0);
  fs.writeFileSync(candidate, paginationOnly);
  const missed = stage("pagination-only", "check");
  assert.equal(missed.pass, false);
  assert.equal(missed.detail, "candidate tests did not reject the behavioral mutant");
  assert.deepEqual(missed.tests, [{ kind: "baseline", total: 2, passed: 2, failed: 0 }, { kind: "candidate", total: 6, passed: 6, failed: 0 }]);
  // Failed mutation validation throws before mutations.push; raw execution is
  // the evidence of the undetected mutant, not an invented mutation record.
  assert.deepEqual(missed.mutations, []);
  const missedExecution = missed.executions.at(-1);
  const missedReport = JSON.parse(missedExecution.stdout);
  assert.equal(missedExecution.exitCode, 0);
  assert.equal(missedReport.numTotalTests, 6);
  assert.equal(missedReport.numPassedTests, 6);
  assert.equal(missedReport.numFailedTests, 0);
  fs.writeFileSync(candidate, repaired);
  const checked = stage("assisted", "check");
  assert.equal(checked.pass, true);
  assert.deepEqual(checked.tests, [{ kind: "baseline", total: 2, passed: 2, failed: 0 }, { kind: "candidate", total: 6, passed: 6, failed: 0 }]);
  assert.equal(checked.mutations.length, spec.mutants.length);
  for (const [index, mutant] of checked.mutations.entries()) {
    assert.equal(mutant.name, spec.mutants[index].name);
    // parseReviewTests returns {total, passed, failed}; runReviewStage
    // appends name/sourceSha256 only after behavioral rejection is verified.
    assert.equal(mutant.total, 6); assert.ok(mutant.failed > 0);
    assert.equal(mutant.passed + mutant.failed, 6);
    const source = fs.readFileSync(path.join(workspace, spec.sourcePath), "utf8");
    assert.equal(source.split(spec.mutants[index].find).length, 2);
    assert.equal(mutant.sourceSha256, hash(Buffer.from(source.replace(spec.mutants[index].find, spec.mutants[index].replace))));
  }
  assert.equal(hash(fs.readFileSync(candidate)), manifest.files["repaired.test.js"]);
  summary.pass = true;
} catch (error) {
  summary.failure = error.stack;
  process.exitCode = 1;
} finally {
  for (const [file, digest] of Object.entries(manifest.files)) assert.equal(hash(fs.readFileSync(path.join(payload, file))), digest);
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ kind: summary.kind, pass: summary.pass, nativeResult: summary.originalNativeResult, summary: path.join(output, "summary.json") }));
}
