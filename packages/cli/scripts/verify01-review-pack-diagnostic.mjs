#!/usr/bin/env node
/** Execute generated operator scripts against a frozen, deterministic control.
 * This validates the evaluator; it never runs an agent or creates observations.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateReviewPack } from "./verify01-review-pack.mjs";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";
import { reviewEnvironment, REVIEW_IMAGE } from "./verify01-review-runtime.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const planDir = path.join(
  repository,
  "docs/research/cli/verify01-plan-2026-10-04",
);
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const command = (name, args, options = {}) =>
  execFileSync(name, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  }).trim();

export function selectDiagnosticTasks(tasks, shard) {
  const match = /^(\d+)\/(\d+)$/u.exec(shard || "");
  assert.ok(match, "shard must be INDEX/COUNT");
  const [index, count] = match.slice(1).map(Number);
  assert.ok(
    Number.isSafeInteger(index) &&
      Number.isSafeInteger(count) &&
      index > 0 &&
      index <= count &&
      count <= tasks.length,
    "invalid diagnostic shard",
  );
  return tasks.filter((_, ordinal) => ordinal % count === index - 1);
}

export function diagnosticCandidate(task, spec) {
  assert.equal(
    task.expectedFiles.length,
    1,
    "diagnostic requires one deliverable",
  );
  if (spec.doc)
    return `# Frozen outcome reporting diagnostic\n\n
This deterministic document exercises the real evaluator. It is not an agent
answer, provider observation, independent human approval or production report.
Bind the frozen plan before running packages/cli/scripts/task-outcome-report.mjs:
use --plan /review/plan.json --fingerprint, preserve that digest independently,
then use --plan-digest with the locked value. Missing observations must retain
36 task samples and 9 first-run samples and return exit code 2 with
INSUFFICIENT_EVIDENCE. Unknown costs remain null; never substitute zero.
Never describe missing samples or a local baseline as improvement PASS.
Keep failed attempts and raw receipts for independent review.\n`;
  return (
    "// Deterministic evaluator control; not an agent task outcome.\n" +
    spec.baselineTests
      .map((file) => {
        let relative = path.posix.relative(
          path.posix.dirname(task.expectedFiles[0]),
          file,
        );
        if (!relative.startsWith(".")) relative = "./" + relative;
        return `import ${JSON.stringify(relative)};`;
      })
      .join("\n") +
    "\n"
  );
}

export function readDiagnosticReceipt(packRoot, taskId, stage, stdout) {
  const verdict = JSON.parse(stdout.trim());
  assert.equal(typeof verdict.pass, "boolean");
  assert.ok(
    new RegExp(`^${taskId}-${stage}-[a-f0-9-]+\\.json$`, "u").test(
      verdict.receipt,
    ),
    "invalid diagnostic receipt name",
  );
  const file = path.join(packRoot, "acceptance-evidence", verdict.receipt);
  const stat = fs.lstatSync(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
    "receipt must be a regular unaliased file",
  );
  const bytes = fs.readFileSync(file);
  assert.equal(
    hash(bytes),
    verdict.receiptDigest,
    "diagnostic receipt bytes changed",
  );
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.taskId, taskId);
  assert.equal(receipt.stage, stage);
  assert.equal(receipt.pass, verdict.pass);
  assert.equal(receipt.providerAssessed, false);
  assert.equal(receipt.productionAttested, false);
  return { file, bytes, receipt, verdict };
}

export async function runPackDiagnostic({
  outputDir,
  imageId,
  sourceSha,
  shard = "1/1",
}) {
  assert.equal(
    process.platform,
    "linux",
    "real Docker diagnostic requires Linux",
  );
  assert.equal(process.version, "v22.12.0", "diagnostic requires Node 22.12.0");
  assert.match(sourceSha || "", /^[a-f0-9]{40}$/u);
  assert.match(imageId || "", /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    command("git", ["-C", repository, "rev-parse", "HEAD"]),
    sourceSha,
  );
  assert.equal(
    command("git", [
      "-C",
      repository,
      "status",
      "--porcelain",
      "--untracked-files=no",
    ]),
    "",
    "diagnostic source must be a clean commit",
  );
  const root = path.resolve(outputDir);
  assert.ok(!fs.existsSync(root), "diagnostic output must be new");
  const catalog = json(path.join(planDir, "tasks.json"));
  const selected = selectDiagnosticTasks(catalog.tasks, shard);
  const inspected = JSON.parse(
    command("docker", ["image", "inspect", imageId], {
      env: reviewEnvironment(),
    }),
  )[0];
  assert.equal(inspected.Id, imageId);
  assert.ok(
    inspected.RepoTags?.includes(REVIEW_IMAGE),
    "image reference does not match diagnostic pin",
  );
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-review-pack-diagnostic-"),
  );
  const workspace = path.join(scratch, "workspace");
  fs.mkdirSync(workspace);
  const archive = path.join(scratch, "frozen.tar");
  command(
    "git",
    [
      "-C",
      repository,
      "archive",
      "--format=tar",
      "--output",
      archive,
      catalog.projectCommit,
    ],
    { timeout: 120000 },
  );
  command("tar", ["-xf", archive, "-C", workspace], { timeout: 120000 });
  const archiveHasher = createHash("sha256");
  for await (const chunk of fs.createReadStream(archive))
    archiveHasher.update(chunk);
  fs.mkdirSync(root);
  const packRoot = path.join(root, "pack");
  const pack = generateReviewPack({ outputDir: packRoot, imageId, planDir });
  const review = json(path.join(packRoot, "review.json"));
  const specs = new Map(
    VERIFY01_REVIEW_SPECS.map((spec) => [spec.taskId, spec]),
  );
  const readback = {
    schema: "chainlesschain.verify01-review-pack-diagnostic/v1",
    sourceCommit: sourceSha,
    projectCommit: catalog.projectCommit,
    recordedAt: new Date().toISOString(),
    shard,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    imageId,
    imageReference: REVIEW_IMAGE,
    imageRepoDigests: inspected.RepoDigests,
    frozenArchiveDigest: "sha256:" + archiveHasher.digest("hex"),
    reviewDigest: pack.reviewDigest,
    tasks: [],
    passed: false,
    boundaries: {
      formalSamplesCreated: false,
      agentExecuted: false,
      providerAssessed: false,
      independentHumanReview: false,
      productionAttested: false,
      releaseEligible: false,
    },
    control:
      "Candidate modules import the frozen baseline test definitions. This exercises generated evaluators and behavioral mutants, not agent performance.",
  };
  const rawRoot = path.join(root, "stages");
  fs.mkdirSync(rawRoot);
  function stage(task, name) {
    const entry = review.tasks.find((item) => item.taskId === task.id)[name];
    const bytes = fs.readFileSync(path.join(packRoot, entry.path));
    assert.equal(hash(bytes), entry.digest);
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        bytes.toString("utf8"),
        workspace,
        String(Date.now() + 640000),
      ],
      {
        cwd: packRoot,
        env: reviewEnvironment(),
        encoding: "utf8",
        shell: false,
        timeout: 645000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const raw = {
      taskId: task.id,
      stage: name,
      scriptDigest: entry.digest,
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
    const rawFile = `${task.id}-${name}.json`;
    const rawBytes = Buffer.from(JSON.stringify(raw, null, 2) + "\n");
    fs.writeFileSync(path.join(rawRoot, rawFile), rawBytes, { flag: "wx" });
    const summary = {
      file: "stages/" + rawFile,
      digest: hash(rawBytes),
      bytes: rawBytes.length,
      exitCode: raw.exitCode,
      signal: raw.signal,
      pass: false,
    };
    try {
      assert.equal(raw.error, null);
      assert.equal(raw.signal, null);
      const parsed = readDiagnosticReceipt(packRoot, task.id, name, raw.stdout);
      assert.equal(
        raw.exitCode,
        name === "setup" && !parsed.receipt.pass ? 1 : 0,
        "generated stage exit disagrees with its actual verdict",
      );
      Object.assign(summary, {
        pass: parsed.receipt.pass,
        detail: parsed.receipt.detail,
        receipt: "pack/acceptance-evidence/" + parsed.verdict.receipt,
        receiptDigest: parsed.verdict.receiptDigest,
        tests: parsed.receipt.tests,
        mutations: parsed.receipt.mutations,
      });
    } catch (error) {
      summary.detail = error.message;
    }
    return summary;
  }
  try {
    for (const task of selected) {
      const spec = specs.get(task.id);
      const sourcePath = path.join(workspace, spec.sourcePath);
      const sourceDigest = hash(fs.readFileSync(sourcePath));
      const setup = stage(task, "setup");
      const row = {
        taskId: task.id,
        setup,
        check: null,
        sourceRestored: false,
      };
      const candidate = path.join(workspace, task.expectedFiles[0]);
      if (setup.pass) {
        fs.mkdirSync(path.dirname(candidate), { recursive: true });
        fs.writeFileSync(candidate, diagnosticCandidate(task, spec), {
          flag: "wx",
        });
        try {
          row.check = stage(task, "check");
        } finally {
          fs.unlinkSync(candidate);
        }
      }
      row.sourceRestored = hash(fs.readFileSync(sourcePath)) === sourceDigest;
      row.passed =
        setup.pass &&
        row.check?.pass === true &&
        row.sourceRestored &&
        row.check.mutations.length === (spec.mutants?.length || 0);
      readback.tasks.push(row);
      fs.writeFileSync(
        path.join(root, "readback.json"),
        JSON.stringify(readback, null, 2) + "\n",
      );
      console.log(
        JSON.stringify({
          taskId: row.taskId,
          passed: row.passed,
          setup: setup.detail,
          check: row.check?.detail,
          mutants: row.check?.mutations.length,
        }),
      );
    }
    readback.passed =
      readback.tasks.length === selected.length &&
      readback.tasks.every((task) => task.passed);
    readback.completedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(root, "readback.json"),
      JSON.stringify(readback, null, 2) + "\n",
    );
    return readback;
  } finally {
    // Only the private mkdtemp tree is removed. Raw evaluator outputs remain.
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "output-dir": { type: "string" },
        "image-id": { type: "string" },
        "source-sha": { type: "string" },
        shard: { type: "string", default: "1/1" },
      },
    });
    assert.ok(values["output-dir"], "--output-dir is required");
    const result = await runPackDiagnostic({
      outputDir: values["output-dir"],
      imageId: values["image-id"],
      sourceSha: values["source-sha"],
      shard: values.shard,
    });
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
