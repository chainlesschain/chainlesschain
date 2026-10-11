#!/usr/bin/env node
/** Offline calibration from an unchanged model candidate. Additional semantic
 * checks are diagnostic v1, never a revision of the frozen review or verdict.
 * Candidate code runs only in the existing account-free Docker checker.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { generateReviewPack } from "./verify01-review-pack.mjs";
import {
  parseReviewTests,
  reviewEnvironment,
  REVIEW_IMAGE,
  runReviewStage,
} from "./verify01-review-runtime.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const evidencePath =
  "docs/research/cli/evidence/gap-2026-10-05/actions-task-diagnostic-2026-10-11/attempt3";
const candidateSuffix =
  "/verify-04/candidate/packages/cli/__tests__/verify-04.test.js.gz";
export const ORIGINAL_CANDIDATE_DIGEST =
  "sha256:7f3b5c7f744e2829b226ea2eecf15b522beb5ca6c67b29bb57f9b34eed4ecdba";
const originalCompressedDigest =
  "sha256:b9468d034d25245980f79625f401ad82514af9cacabad4b60b31871c4845a914";
const pricingPath = "packages/cli/src/lib/llm-pricing.js";
const engineeringPath =
  "packages/cli/__tests__/unit/usage-pricing-context.test.js";
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// Deliberately separate from VERIFY01_REVIEW_SPECS and allowedChangedPaths.
// These change actual charges, rather than merely the bucket shape.
export const PRICING_SEMANTIC_MUTANTS = [
  {
    name: "ignore-request-price-buckets",
    find: "if (Array.isArray(row.pricingBuckets)) {",
    replace: "if (false) {",
  },
  {
    name: "disable-long-input-multiplier",
    find: "const inputMultiplier = longPrompt ? longContext.inputMultiplier : 1;",
    replace: "const inputMultiplier = 1;",
  },
  {
    name: "disable-long-output-multiplier",
    find: "const outputMultiplier = longPrompt ? longContext.outputMultiplier : 1;",
    replace: "const outputMultiplier = 1;",
  },
  {
    name: "charge-long-rate-at-inclusive-boundary",
    find: "const longPrompt = longContext && promptTokens > longContext.threshold;",
    replace:
      "const longPrompt = longContext && promptTokens >= longContext.threshold;",
  },
];

export function readOriginalPricingCandidate(root = repository) {
  const directory = path.join(root, evidencePath);
  const manifest = json(path.join(directory, "manifest.json"));
  assert.equal(manifest.runId, 38114586541);
  assert.equal(manifest.formalSample, false);
  const entries = manifest.entries.filter((entry) =>
    entry.artifactOriginalPath.endsWith(candidateSuffix),
  );
  assert.equal(entries.length, 1, "one unchanged original candidate required");
  const entry = entries[0];
  assert.match(entry.path, /^objects\/[a-z0-9-]+\.gz$/u);
  const compressed = fs.readFileSync(path.join(directory, entry.path));
  assert.equal(compressed.length, entry.bytes);
  assert.equal(hash(compressed), originalCompressedDigest);
  assert.equal("sha256:" + entry.sha256, originalCompressedDigest);
  const bytes = gunzipSync(compressed, { maxOutputLength: 16 * 1024 * 1024 });
  assert.equal(bytes.length, entry.rawBytes);
  assert.equal(hash(bytes), ORIGINAL_CANDIDATE_DIGEST);
  assert.equal("sha256:" + entry.rawSha256, ORIGINAL_CANDIDATE_DIGEST);
  return bytes;
}

/** A known semantic survivor is distinct from a test/import/deadline failure.
 * Only fully executed, passing candidate assertions can establish survival.
 */
export function classifyPricingReceipt(receipt, mutant) {
  assert.equal(receipt.stage, "check");
  assert.equal(receipt.providerAssessed, false);
  assert.equal(receipt.productionAttested, false);
  assert.ok(
    receipt.tests?.some((test) => test.kind === "candidate" && test.total > 0),
    "candidate assertions were not executed; semantic outcome cannot be established",
  );
  assert.deepEqual(
    receipt.tests.map((test) => test.kind),
    ["baseline", "candidate"],
  );
  assert.ok(receipt.tests.every((test) => test.total > 0 && test.failed === 0));
  if (receipt.pass === true) {
    assert.equal(receipt.mutations.length, 1);
    assert.equal(receipt.mutations[0].name, mutant.name);
    assert.ok(receipt.mutations[0].failed > 0);
    return { outcome: "killed", tests: receipt.mutations[0] };
  }
  assert.equal(
    receipt.detail,
    "candidate tests did not reject the behavioral mutant",
    "infrastructure failures cannot establish semantic survival",
  );
  assert.equal(receipt.mutations.length, 0);
  const execution = receipt.executions.at(-1);
  assert.ok(execution.command.includes("--reporter=json"));
  const tests = parseReviewTests({
    status: execution.exitCode,
    signal: execution.signal,
    error: execution.error,
    stdout: execution.stdout,
  });
  return { outcome: "survived", tests };
}

export function runPricingDiagnostic({ outputDir, imageId, sourceSha }) {
  assert.equal(process.platform, "linux", "Docker diagnostic requires Linux");
  assert.equal(process.version, "v22.12.0");
  assert.match(sourceSha || "", /^[a-f0-9]{40}$/u);
  assert.match(imageId || "", /^sha256:[a-f0-9]{64}$/u);
  const command = (name, args, extra = {}) =>
    execFileSync(name, args, {
      encoding: "utf8",
      env: reviewEnvironment(),
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      ...extra,
    }).trim();
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
    "diagnostic requires a clean source commit",
  );
  const root = path.resolve(outputDir);
  assert.ok(!fs.existsSync(root), "output must be new");
  const image = JSON.parse(command("docker", ["image", "inspect", imageId]))[0];
  assert.equal(image.Id, imageId);
  assert.ok(image.RepoTags?.includes(REVIEW_IMAGE));
  const candidate = readOriginalPricingCandidate();
  const engineering = fs.readFileSync(path.join(repository, engineeringPath));
  fs.mkdirSync(root, { recursive: true });
  const pack = generateReviewPack({
    outputDir: path.join(root, "pack"),
    imageId,
  });
  const specBytes = fs.readFileSync(
    path.join(root, "pack/verify-04-check.mjs"),
  );
  const frozenSpec = JSON.parse(
    specBytes.toString().match(/\nconst spec = (.+);\nconst receipt =/u)[1],
  );
  const projectCommit = json(path.join(root, "pack/review.json")).projectCommit;
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-pricing-semantic-"),
  );
  const workspace = path.join(scratch, "workspace");
  const readback = {
    schema: "chainlesschain.verify01-pricing-semantic-diagnostic/v1",
    sourceCommit: sourceSha,
    projectCommit,
    recordedAt: new Date().toISOString(),
    node: process.version,
    imageId,
    imageReference: REVIEW_IMAGE,
    imageRepoDigests: image.RepoDigests,
    frozenReviewDigest: pack.reviewDigest,
    diagnosticMutantsDigest: hash(
      Buffer.from(JSON.stringify(PRICING_SEMANTIC_MUTANTS)),
    ),
    diagnosticMutants: PRICING_SEMANTIC_MUTANTS,
    originalCandidateDigest: hash(candidate),
    engineeringTestDigest: hash(engineering),
    rows: [],
    calibrationPassed: false,
    candidateSemanticAccepted: null,
    engineeringControlAccepted: null,
    boundaries: {
      formalSamplesCreated: false,
      agentExecuted: false,
      providerAssessed: false,
      independentHumanReview: false,
      releaseEligible: false,
      originalVerdictUnchanged: true,
    },
  };
  const write = (file, data) =>
    fs.writeFileSync(
      path.join(root, file),
      JSON.stringify(data, null, 2) + "\n",
    );
  write("readback.json", readback);
  try {
    fs.mkdirSync(workspace);
    const archive = path.join(scratch, "project.tar");
    command("git", [
      "-C",
      repository,
      "archive",
      "--format=tar",
      "--output",
      archive,
      projectCommit,
    ]);
    command("tar", ["-xf", archive, "-C", workspace]);
    const setup = runReviewStage(workspace, frozenSpec, "setup");
    write("setup.json", setup);
    assert.equal(setup.pass, true, setup.detail);
    const sourceFile = path.join(workspace, pricingPath);
    readback.pricingSourceDigest = hash(fs.readFileSync(sourceFile));
    for (const control of [
      {
        name: "original-model",
        file: frozenSpec.expectedFiles[0],
        bytes: candidate,
        expected: "survived",
      },
      {
        name: "engineering",
        file: engineeringPath,
        bytes: engineering,
        expected: "killed",
      },
    ]) {
      const target = path.join(workspace, control.file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, control.bytes, { flag: "wx" });
      fs.writeFileSync(
        path.join(root, control.name + ".test.js"),
        control.bytes,
        { flag: "wx" },
      );
      try {
        for (const mutant of PRICING_SEMANTIC_MUTANTS) {
          const spec = {
            ...frozenSpec,
            sourcePath: pricingPath,
            expectedFiles: [control.file],
            mutants: [mutant],
          };
          const receipt = runReviewStage(workspace, spec, "check");
          const file = `${control.name}-${mutant.name}.json`;
          write(file, receipt);
          assert.equal(
            hash(fs.readFileSync(sourceFile)),
            readback.pricingSourceDigest,
            "pricing source restoration failed",
          );
          const row = {
            control: control.name,
            mutant: mutant.name,
            receipt: file,
            receiptDigest: hash(fs.readFileSync(path.join(root, file))),
            ...classifyPricingReceipt(receipt, mutant),
            sourceRestored: true,
          };
          readback.rows.push(row);
          write("readback.json", readback);
          assert.equal(
            row.outcome,
            control.expected,
            "calibration expectation changed; inspect raw receipt",
          );
          console.log(JSON.stringify(row));
        }
      } finally {
        fs.unlinkSync(target);
      }
      if (control.name === "original-model")
        readback.candidateSemanticAccepted = readback.rows
          .filter((row) => row.control === control.name)
          .every((row) => row.outcome === "killed");
      else
        readback.engineeringControlAccepted = readback.rows
          .filter((row) => row.control === control.name)
          .every((row) => row.outcome === "killed");
    }
    readback.calibrationPassed =
      readback.rows.length === 2 * PRICING_SEMANTIC_MUTANTS.length;
    return readback;
  } catch (error) {
    readback.error = error.message;
    throw error;
  } finally {
    readback.completedAt = new Date().toISOString();
    write("readback.json", readback);
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
      },
    });
    assert.ok(values["output-dir"], "--output-dir is required");
    runPricingDiagnostic({
      outputDir: values["output-dir"],
      imageId: values["image-id"],
      sourceSha: values["source-sha"],
    });
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
