#!/usr/bin/env node
/** Independently checks native deliveries in network-disabled Linux Docker.
 * Native generation, IDE recovery and Linux acceptance remain separate facts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateReviewPack } from "./verify01-review-pack.mjs";
import { REVIEW_IMAGE, reviewEnvironment } from "./verify01-review-runtime.mjs";
import { DIAGNOSTIC } from "./verify01-volcengine-task-diagnostic.mjs";
import {
  selectNativeSamples,
  inspectNativeScope,
  snapshotNativeTree,
  VERSIONS,
} from "./verify01-native-task-campaign.mjs";
import { runCaptured } from "./verify01-first-run-cli-diagnostic.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const planDir = path.join(
  repository,
  "docs/research/cli/verify01-plan-2026-10-13-volcengine",
);
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export function artifactFile(root, relative) {
  assert.ok(
    typeof relative === "string" &&
      relative.length > 0 &&
      !/[\\:\0]/u.test(relative) &&
      relative.split("/").every((p) => p && p !== "." && p !== ".."),
    "unsafe artifact path",
  );
  let file = root;
  for (const part of relative.split("/")) {
    file = path.join(file, part);
    assert.ok(!fs.lstatSync(file).isSymbolicLink(), "linked artifact path");
  }
  const stat = fs.statSync(file);
  assert.ok(
    stat.isFile() && stat.nlink === 1 && stat.size <= 32 * 1024 * 1024,
    "artifact must be a bounded regular file",
  );
  return file;
}

export function validateNativeCandidate(root, row, task) {
  assert.deepEqual(row.expectedFiles, task.expectedFiles);
  assert.equal(
    row.candidates.length,
    task.expectedFiles.length,
    "missing or duplicate delivery",
  );
  return task.expectedFiles.map((file) => {
    const matches = row.candidates.filter((c) => c.file === file);
    assert.equal(matches.length, 1);
    const candidate = matches[0];
    assert.equal(candidate.path, `${row.sampleId}/candidate/${file}`);
    const bytes = fs.readFileSync(artifactFile(root, candidate.path));
    assert.equal(hash(bytes), candidate.digest, "candidate digest mismatch");
    assert.equal(bytes.length, candidate.bytes);
    assert.ok(
      bytes.length > 0 && bytes.length <= 1024 * 1024,
      "invalid candidate size",
    );
    return { file, bytes, digest: candidate.digest };
  });
}

/** File content identity ignores native executable-bit representation. */
export function assertFrozenBefore(expected, captured) {
  assert.deepEqual(
    Object.keys(captured).sort(),
    Object.keys(expected).sort(),
    "native initial tree differs from frozen source",
  );
  for (const [file, item] of Object.entries(expected)) {
    const actual = captured[file];
    assert.equal(actual.type, item.type, `initial type differs: ${file}`);
    if (item.type === "file") {
      assert.equal(actual.digest, item.digest, `initial bytes differ: ${file}`);
      assert.equal(actual.bytes, item.bytes);
    }
    if (item.type === "link") assert.equal(actual.target, item.target);
  }
}

export async function checkNativeCampaign({
  inputDir,
  outputDir,
  sourceSha,
  imageId,
}) {
  assert.equal(
    process.platform,
    "linux",
    "acceptance requires Linux Docker host",
  );
  assert.match(sourceSha || "", /^[a-f0-9]{40}$/u);
  assert.match(imageId || "", /^sha256:[a-f0-9]{64}$/u);
  const input = fs.realpathSync(inputDir),
    output = path.resolve(outputDir);
  assert.ok(!fs.existsSync(output), "checker output must be new");
  const source = json(artifactFile(input, "summary.json"));
  const plan = json(path.join(planDir, "plan.json")),
    catalog = json(path.join(planDir, "tasks.json"));
  assert.equal(
    source.schema,
    "chainlesschain.verify01-native-task-campaign/v1",
  );
  assert.equal(source.executionSourceCommit, sourceSha);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim(),
    sourceSha,
  );
  assert.equal(source.projectCommit, DIAGNOSTIC.projectCommit);
  assert.equal(source.planDigest, DIAGNOSTIC.planDigest);
  assert.deepEqual(source.versions, VERSIONS);
  const selected = selectNativeSamples(plan, source.platform, source.entry);
  assert.equal(source.samples.length, selected.length);
  assert.equal(
    new Set(source.samples.map((s) => s.sampleId)).size,
    selected.length,
  );
  assert.deepEqual(
    source.samples.map((s) => s.sampleId).sort(),
    selected.map((s) => s.id).sort(),
  );
  const image = JSON.parse(
    execFileSync("docker", ["image", "inspect", imageId], { encoding: "utf8" }),
  )[0];
  assert.equal(image.Id, imageId);
  assert.ok(image.RepoTags.includes(REVIEW_IMAGE));
  fs.mkdirSync(output, { recursive: true });
  const save = (file, value) => {
    const dest = path.join(output, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(value, null, 2) + "\n");
  };
  const packRoot = path.join(output, "pack"),
    pack = generateReviewPack({ outputDir: packRoot, planDir, imageId });
  const review = json(path.join(packRoot, "review.json"));
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "verify01-native-check-"),
  );
  const archive = path.join(scratch, "project.tar");
  execFileSync(
    "git",
    ["archive", "--format=tar", "--output", archive, DIAGNOSTIC.projectCommit],
    { cwd: repository, timeout: 120000 },
  );
  const summary = {
    schema: "chainlesschain.verify01-native-task-acceptance/v1",
    executionSourceCommit: sourceSha,
    projectCommit: source.projectCommit,
    planDigest: source.planDigest,
    group: source.group,
    actualGenerationHost: {
      platform: source.platform,
      entry: source.entry,
      arch: source.arch,
    },
    acceptanceHost: "linux-docker",
    imageId,
    reviewDigest: pack.reviewDigest,
    sourceSummaryDigest: hash(
      fs.readFileSync(path.join(input, "summary.json")),
    ),
    formalSample: false,
    startedAt: new Date().toISOString(),
    samples: [],
    passed: false,
  };
  for (const sample of selected) {
    const native = source.samples.find((s) => s.sampleId === sample.id),
      task = catalog.tasks.find((t) => t.id === sample.taskId);
    const row = {
      sampleId: sample.id,
      taskId: task.id,
      kind: sample.kind,
      generationPassed: native.generationPassed === true,
      host: native.host,
      model: native.model,
      brokerStatus: native.brokerStatus,
      candidateAcceptancePassed: false,
      passed: false,
    };
    summary.samples.push(row);
    const workspace = path.join(scratch, sample.id),
      deadline = Date.now() + 20 * 60 * 1000;
    fs.mkdirSync(workspace);
    try {
      assert.equal(native.executionSourceCommit, sourceSha);
      assert.equal(native.projectCommit, DIAGNOSTIC.projectCommit);
      assert.equal(native.taskId, sample.taskId);
      assert.equal(native.kind, sample.kind);
      assert.equal(native.stratum, sample.stratum);
      const candidates = validateNativeCandidate(input, native, task);
      const before = json(artifactFile(input, `${sample.id}/tree-before.json`)),
        after = json(artifactFile(input, `${sample.id}/tree-after.json`));
      const scope = inspectNativeScope(before, after, task.expectedFiles);
      assert.deepEqual(native.changedPaths, scope.changedPaths);
      assert.equal(native.sourceScopePassed, scope.sourceScopePassed);
      assert.ok(
        scope.sourceScopePassed,
        "native model changed paths outside deliverables",
      );
      for (const c of candidates) {
        assert.equal(after[c.file]?.digest, c.digest);
        assert.equal(after[c.file]?.bytes, c.bytes.length);
      }
      execFileSync("tar", ["-xf", archive, "-C", workspace], {
        timeout: 120000,
      });
      for (const file of task.expectedFiles) {
        assert.ok(!fs.existsSync(path.join(workspace, file)));
        fs.mkdirSync(path.dirname(path.join(workspace, file)), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(workspace, file),
          file.endsWith(".md")
            ? "<!-- Non-answer placeholder. -->\n"
            : "// Non-answer placeholder.\n",
        );
      }
      assertFrozenBefore(snapshotNativeTree(workspace), before);
      for (const file of task.expectedFiles)
        fs.unlinkSync(path.join(workspace, file));
      async function stage(name) {
        const entry = review.tasks.find((t) => t.taskId === task.id)[name],
          bytes = fs.readFileSync(path.join(packRoot, entry.path));
        assert.equal(hash(bytes), entry.digest);
        const result = await runCaptured(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            bytes.toString("utf8"),
            workspace,
            String(deadline),
          ],
          {
            cwd: packRoot,
            env: reviewEnvironment(),
            deadline,
            outputPrefix: path.join(output, sample.id, name),
          },
        );
        assert.ok(result.ok, `${name} process failed`);
        const verdict = JSON.parse(result.stdout.trim());
        assert.match(
          verdict.receipt,
          new RegExp(`^${task.id}-${name}-[a-f0-9-]+\\.json$`, "u"),
        );
        const receiptBytes = fs.readFileSync(
          artifactFile(packRoot, `acceptance-evidence/${verdict.receipt}`),
        );
        assert.equal(hash(receiptBytes), verdict.receiptDigest);
        const receipt = JSON.parse(receiptBytes);
        assert.equal(receipt.taskId, task.id);
        assert.equal(receipt.stage, name);
        assert.equal(receipt.pass, verdict.pass);
        return {
          ...verdict,
          scriptDigest: entry.digest,
          receiptPath: `pack/acceptance-evidence/${verdict.receipt}`,
          tests: receipt.tests,
          mutations: receipt.mutations,
          detail: receipt.detail,
        };
      }
      row.setup = await stage("setup");
      assert.equal(row.setup.pass, true, "trusted checker setup failed");
      for (const c of candidates) {
        const target = path.join(workspace, c.file);
        assert.ok(!fs.existsSync(target));
        fs.writeFileSync(target, c.bytes, { flag: "wx" });
      }
      row.check = await stage("check");
      row.candidateAcceptancePassed = row.check.pass === true;
      row.passed = row.generationPassed && row.candidateAcceptancePassed;
    } catch (error) {
      row.failure = error.message;
    }
    row.finishedAt = new Date().toISOString();
    save(`${sample.id}/result.json`, row);
    save("summary.json", summary);
    console.log(
      JSON.stringify({
        sampleId: row.sampleId,
        generationPassed: row.generationPassed,
        candidateAcceptancePassed: row.candidateAcceptancePassed,
        passed: row.passed,
        failure: row.failure,
      }),
    );
  }
  summary.passed =
    summary.samples.length === 5 && summary.samples.every((s) => s.passed);
  summary.finishedAt = new Date().toISOString();
  save("summary.json", summary);
  // The runner temp area and its untrusted candidates are retained for this job's lifetime only.
  return summary;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      "input-dir": { type: "string" },
      "output-dir": { type: "string" },
      "source-sha": { type: "string" },
      "image-id": { type: "string" },
    },
  });
  checkNativeCampaign({
    inputDir: values["input-dir"],
    outputDir: values["output-dir"],
    sourceSha: values["source-sha"],
    imageId: values["image-id"],
  })
    .then((r) => {
      if (!r.passed) process.exitCode = 1;
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
