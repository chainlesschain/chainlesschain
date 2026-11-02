/** Validate a separately assisted candidate with the original immutable evaluator. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync, spawnSync } from "node:child_process";

assert.equal(process.platform, "linux");
assert.equal(process.version, "v22.12.0");
const root = process.cwd();
const sampleId = process.argv[2] || "verify-08";
assert.ok(["verify-08", "verify-36"].includes(sampleId));
const fixtureKey = sampleId.replace("-", "");
const fixture = path.join(root, `docs/research/cli/verify01-openai-139/assisted-${fixtureKey}`);
const manifestBytes = fs.readFileSync(path.join(fixture, "repair.json"));
const manifest = JSON.parse(manifestBytes);
const hash = b => "sha256:" + createHash("sha256").update(b).digest("hex");
assert.equal(manifest.assisted, true);
assert.equal(manifest.countedAsNativeGeneration, false);
assert.equal(manifest.modelRequests, 0);
assert.equal(manifest.sampleId, sampleId);
assert.equal(manifest.targetFile, `packages/cli/__tests__/repair137-${sampleId}.test.js`);
const candidate = fs.readFileSync(path.join(fixture, manifest.candidateFile));
assert.equal(hash(candidate), manifest.candidateDigest);
const image = JSON.parse(execFileSync("docker", ["image", "inspect", manifest.imageId]))[0];
assert.equal(image.Id, manifest.imageId);
assert.ok(image.RepoTags.includes("node:22.12.0-bookworm"));
const output = path.join(process.env.RUNNER_TEMP || os.tmpdir(), `verify01-public139-assisted-${fixtureKey}`);
assert.ok(!fs.existsSync(output), "New evidence directory required");
fs.mkdirSync(output);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `cc-assisted-${fixtureKey}-`));
const archive = path.join(output, "project.tar");
execFileSync("git", ["archive", "--format=tar", "--output", archive,
  manifest.projectSource, ".", ":(exclude)docs/research/**"], { timeout: 120000 });
const archiveDigest = hash(fs.readFileSync(archive));
execFileSync("tar", ["-xf", archive, "-C", workspace], { timeout: 120000 });
fs.unlinkSync(archive);
const target = path.join(workspace, manifest.targetFile);
assert.ok(!fs.existsSync(target), "Answer must not exist during setup");
const environment = Object.fromEntries(["PATH", "TEMP", "TMP", "DOCKER_HOST", "DOCKER_CONTEXT"]
  .filter(k => process.env[k]).map(k => [k, process.env[k]]));
const result = {
  schema: "chainlesschain.verify01-assisted-candidate-result/v1",
  sampleId: manifest.sampleId,
  assisted: true,
  countedAsNativeGeneration: false,
  originalNativePassed: false,
  modelRequests: 0,
  originalRunId: manifest.originalRunId,
  executionSource: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  projectSource: manifest.projectSource,
  manifestDigest: hash(manifestBytes),
  candidateDigest: hash(candidate),
  archiveDigest,
  imageId: image.Id,
  stages: {},
  passed: false,
};
const save = () => fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
save();
for (const stage of ["setup", "check"]) {
  const declaration = manifest.operators[stage];
  const compressed = fs.readFileSync(path.join(fixture, declaration.file));
  assert.equal(hash(compressed), declaration.compressedDigest);
  const bytes = gunzipSync(compressed);
  assert.equal(hash(bytes), declaration.digest, "Original evaluator changed");
  const operator = path.join(output, `original-${stage}.mjs`);
  fs.writeFileSync(operator, bytes);
  if (stage === "check") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, candidate, { flag: "wx" });
  }
  const execution = spawnSync(process.execPath, ["--input-type=module", "--eval", bytes.toString("utf8"), workspace, String(Date.now() + 20 * 60 * 1000)], {
    cwd: output, env: environment, encoding: "utf8", timeout: 11 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, `${stage}.stdout`), execution.stdout || "");
  fs.writeFileSync(path.join(output, `${stage}.stderr`), execution.stderr || "");
  assert.ok(!execution.error && !execution.signal, `${stage} process did not finish`);
  const verdict = JSON.parse(execution.stdout.trim());
  assert.match(verdict.receipt, new RegExp(`^${sampleId}-${stage}-[a-f0-9-]+\\.json$`, "u"));
  const receiptBytes = fs.readFileSync(path.join(output, "acceptance-evidence", verdict.receipt));
  assert.equal(hash(receiptBytes), verdict.receiptDigest);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.taskId, manifest.sampleId);
  assert.equal(receipt.stage, stage);
  assert.equal(receipt.pass, verdict.pass);
  result.stages[stage] = { ...verdict, operatorDigest: hash(bytes), tests: receipt.tests, mutations: receipt.mutations };
  save();
  assert.equal(execution.status, 0, `${stage}: ${receipt.detail}`);
  assert.equal(verdict.pass, true, `${stage}: ${receipt.detail}`);
}
result.passed = true;
save();
console.log(JSON.stringify(result));
