#!/usr/bin/env node
/** Local engineering replay. Never replaces frozen acceptance or calls a model. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";
import {
  parseReviewTests,
  reviewEnvironment,
} from "./verify01-review-runtime.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const execute = promisify(execFile);
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const runnerSourceDigest = digest(
  fs.readFileSync(fileURLToPath(import.meta.url)),
);

export function validateReplayOutput(outputFile, archiveDirectory, proofFile) {
  const output = path.resolve(outputFile);
  assert.equal(
    fs.existsSync(output),
    false,
    "Replay output must be a new file",
  );
  let existing = path.dirname(output);
  const suffix = [path.basename(output)];
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  const canonical = path.join(fs.realpathSync(existing), ...suffix);
  const relative = path.relative(fs.realpathSync(archiveDirectory), canonical);
  assert.ok(
    relative.startsWith(".." + path.sep) || path.isAbsolute(relative),
    "Replay must not write into its input evidence archive",
  );
  assert.notEqual(
    canonical.toLowerCase(),
    fs.realpathSync(proofFile).toLowerCase(),
    "Replay must not overwrite release proof",
  );
  return output;
}

export function adaptSessionStoreFixture(source) {
  const anchor = 'vi.mock("../src/lib/paths.js", () => ({';
  if (!source.includes(anchor) || /\bgetSessionStoreDir\s*:/u.test(source))
    return { source, changed: false };
  assert.equal(source.split(anchor).length, 2, "Ambiguous storage fixture");
  assert.ok(source.includes('getHomeDir: () => join(root, "home")'));
  const addition =
    '\n  getSessionStoreDir: () => join(root, "home", "sessions"),';
  return {
    source: source.replace(anchor, anchor + addition),
    changed: true,
    adapter: "add-current-getSessionStoreDir-to-paths-mock-only",
    addition,
  };
}

export function summarizeReplay(
  report,
  processResult,
  { baseline = false } = {},
) {
  const execution = { ...processResult, stdout: JSON.stringify(report) };
  const files = report.testResults || [];
  const failures = files.flatMap((file) =>
    (file.assertionResults || [])
      .filter((test) => test.status === "failed")
      .map((test) => ({
        test: test.fullName,
        reasons: (test.failureMessages || []).map(
          (message) => message.split("\n")[0],
        ),
      })),
  );
  const loadFailures = files
    .filter(
      (file) =>
        file.status === "failed" &&
        !(file.assertionResults || []).some((test) => test.status === "failed"),
    )
    .map((file) => ({
      file: path.basename(file.name),
      message: String(file.message || "No behavioral assertion executed").slice(
        0,
        700,
      ),
    }));
  const assertionCount = files.reduce(
    (total, file) => total + (file.assertionResults || []).length,
    0,
  );
  const fileResults = files.map((file) => ({
    file: path.basename(file.name),
    status: file.status,
    passed: (file.assertionResults || []).filter(
      (item) => item.status === "passed",
    ).length,
    failed: (file.assertionResults || []).filter(
      (item) => item.status === "failed",
    ).length,
    recorded: (file.assertionResults || []).length,
    message: String(file.message || "").slice(0, 700),
  }));
  let passedCleanly = false,
    rejectedByAssertions = false;
  let passRejection, mutantRejection;
  try {
    parseReviewTests(execution, { baseline });
    passedCleanly = true;
  } catch (error) {
    passRejection = error.message;
  }
  if (Number.isInteger(execution.status) && execution.status === 1) {
    try {
      parseReviewTests(execution, { mutant: true });
      rejectedByAssertions = true;
    } catch (error) {
      mutantRejection = error.message;
    }
  }
  return {
    exitCode: execution.status,
    signal: execution.signal || null,
    runnerError: Boolean(execution.error),
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    assertionCount,
    failedTests: failures.length,
    fileResults,
    loadFailures,
    failures,
    passedCleanly,
    rejectedByAssertions,
    passRejection,
    mutantRejection,
  };
}

function containedFile(root, relative) {
  assert.equal(typeof relative, "string");
  assert.ok(
    relative && !/[\\:]/u.test(relative) && !path.posix.isAbsolute(relative),
  );
  const pieces = relative.split("/");
  assert.ok(pieces.every((piece) => piece && piece !== "." && piece !== ".."));
  let current = root;
  for (const piece of pieces) {
    current = path.join(current, piece);
    assert.equal(fs.lstatSync(current).isSymbolicLink(), false);
  }
  assert.ok(fs.statSync(current).isFile());
  return current;
}

export async function replayReleasedCandidates(options) {
  const reportFile = path.resolve(options.report);
  const archiveRoot = path.dirname(reportFile);
  const proofFile = path.resolve(options.releaseProof);
  const output = validateReplayOutput(options.output, archiveRoot, proofFile);
  const previous = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const archive = JSON.parse(
    fs.readFileSync(path.join(archiveRoot, "archive-index.json"), "utf8"),
  );
  const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
  assert.equal(previous.complete, true);
  assert.equal(archive.unmodifiedEvidence, true);
  assert.equal(archive.source, previous.source);
  assert.match(previous.source, /^[a-f0-9]{40}$/u);
  assert.match(previous.projectCommit, /^[a-f0-9]{40}$/u);
  assert.equal(proof.cli.status, "verified-public");
  const source = proof.cli.source || proof.cli.sourceCommit;
  assert.match(source, /^[a-f0-9]{40}$/u);
  const version = proof.cli.version;
  assert.match(version, /^\d+\.\d+\.\d+$/u);
  const git = async (args) =>
    (
      await execute("git", args, {
        cwd: repository,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 12 * 1024 * 1024,
      })
    ).stdout;
  assert.equal(
    (
      await git([
        "rev-parse",
        "refs/tags/v-npm-" + version.replaceAll(".", "-") + "^{commit}",
      ])
    ).trim(),
    source,
  );
  assert.equal(
    JSON.parse(await git(["show", source + ":packages/cli/package.json"]))
      .version,
    version,
  );
  const specsFile = path.join(
    repository,
    "packages/cli/scripts/verify01-review-specs.mjs",
  );
  const currentSpecs = fs
    .readFileSync(specsFile, "utf8")
    .replaceAll("\r\n", "\n");
  const releasedSpecs = (
    await git([
      "show",
      source + ":packages/cli/scripts/verify01-review-specs.mjs",
    ])
  ).replaceAll("\r\n", "\n");
  assert.equal(
    currentSpecs,
    releasedSpecs,
    "The original release's evaluator mutations must be unchanged",
  );
  const dependencyRoot = path.resolve(options.dependencyRoot || repository);
  const lock = fs
    .readFileSync(path.join(dependencyRoot, "package-lock.json"), "utf8")
    .replaceAll("\r\n", "\n");
  assert.equal(
    lock,
    (await git(["show", source + ":package-lock.json"])).replaceAll(
      "\r\n",
      "\n",
    ),
    "Dependency lock differs from the published source",
  );
  const selected = previous.rows.filter(
    (row) => row.acceptancePassed === false,
  );
  assert.ok(selected.length > 0 && selected.length <= 45);
  assert.equal(
    new Set(selected.map((row) => row.sampleId)).size,
    selected.length,
  );
  const candidates = selected.map((row) => {
    assert.match(row.sampleId, /^[a-z0-9-]+$/u);
    const spec = VERIFY01_REVIEW_SPECS.find(
      (item) => item.taskId === row.taskId,
    );
    assert.ok(spec && !spec.doc && spec.mutants.length > 0);
    assert.ok(
      ["verify-08", "verify-13", "verify-36"].includes(spec.taskId),
      "This replay covers only the reviewed history, image and profile repair candidates",
    );
    const entries = archive.files.filter(
      (file) =>
        file.sampleId === row.sampleId &&
        file.kind === "unmodified-candidate-source",
    );
    assert.equal(entries.length, 1);
    const original = fs.readFileSync(
      containedFile(archiveRoot, entries[0].path),
    );
    assert.equal(digest(original), entries[0].digest);
    assert.equal(original.length, entries[0].bytes);
    assert.equal(row.generation.candidates.length, 1);
    assert.equal(digest(original), row.generation.candidates[0].digest);
    return {
      row,
      spec,
      original,
      file: "release-candidate-" + row.sampleId + ".test.js",
    };
  });
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-release-candidate-replay-"),
  );
  const sourceWorkspace = path.join(workspace, "source");
  fs.mkdirSync(sourceWorkspace);
  const project = path.join(sourceWorkspace, "packages/cli");
  const tarFile = path.join(workspace, "source.tar");
  await git([
    "archive",
    "--format=tar",
    "--output=" + tarFile,
    source,
    "package.json",
    "package-lock.json",
    "packages/cli/src",
    "packages/cli/test",
    "packages/cli/__tests__",
    "packages/cli/package.json",
    "packages/cli/vitest.config.js",
    "packages/vscode-extension/src",
    "packages/vscode-extension/package.json",
  ]);
  if (process.platform === "win32")
    await execute(
      "python",
      [
        "-X",
        "utf8",
        path.join(
          repository,
          "packages/cli/scripts/verify01-extract-windows-archive.py",
        ),
        tarFile,
        sourceWorkspace,
      ],
      { windowsHide: true, timeout: 120000 },
    );
  else
    await execute("tar", ["-xf", tarFile, "-C", sourceWorkspace], {
      timeout: 120000,
    });
  for (const relative of ["node_modules", "packages/cli/node_modules"]) {
    const dependency = path.join(dependencyRoot, relative);
    assert.ok(
      fs.statSync(dependency).isDirectory(),
      "Install locked test dependencies first",
    );
    fs.symlinkSync(
      dependency,
      path.join(sourceWorkspace, relative),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  const environment = reviewEnvironment(process.env);
  delete environment.DOCKER_HOST;
  delete environment.DOCKER_CONTEXT;
  // Native Windows ACL workers need their normal OS profile plumbing. None of
  // these fields contains provider credentials or changes the owner-only check.
  const nativeFields = new Set([
    "userprofile",
    "homedrive",
    "homepath",
    "localappdata",
    "appdata",
    "programfiles",
    "programfiles(x86)",
    "programw6432",
  ]);
  for (const [key, value] of Object.entries(process.env))
    if (nativeFields.has(key.toLowerCase())) environment[key] = value;
  Object.assign(environment, {
    CHAINLESSCHAIN_HOME: path.join(workspace, "home"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(workspace, "security"),
    CC_MANAGED_SETTINGS: path.join(workspace, "managed.json"),
  });
  fs.mkdirSync(environment.CHAINLESSCHAIN_HOME);
  fs.writeFileSync(environment.CC_MANAGED_SETTINGS, "{}");
  fs.mkdirSync(path.join(sourceWorkspace, ".git"));
  const results = [];
  const run = async (name, files, mode = {}) => {
    const output = path.join(workspace, name + ".json");
    let status = 0,
      signal = null,
      runnerError = null;
    try {
      await execute(
        process.execPath,
        [
          path.join(dependencyRoot, "node_modules/vitest/vitest.mjs"),
          "run",
          "--configLoader=native",
          "--config",
          "vitest.config.js",
          "--maxWorkers=1",
          ...files,
          "--reporter=json",
          "--outputFile=" + output,
        ],
        {
          cwd: project,
          env: environment,
          windowsHide: true,
          timeout: 240000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } catch (error) {
      status = error.code;
      signal = error.signal || null;
      runnerError =
        error.killed || !Number.isInteger(status) ? "runner-or-timeout" : null;
      if (!fs.existsSync(output))
        throw new Error(
          name +
            ": no complete test report (" +
            status +
            ") in " +
            workspace +
            ": " +
            String(error.stderr || error.stdout || "").slice(0, 1500),
        );
    }
    const result = {
      name,
      ...summarizeReplay(
        JSON.parse(fs.readFileSync(output, "utf8")),
        { status, signal, error: runnerError },
        mode,
      ),
      reportDigest: digest(fs.readFileSync(output)),
      report: output,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    return result;
  };
  const baselineFiles = [
    ...new Set(candidates.flatMap((item) => item.spec.baselineTests)),
  ].map((file) => file.replace(/^packages\/cli\//u, ""));
  const baseline = await run("released-baseline", baselineFiles, {
    baseline: true,
  });
  assert.equal(
    baseline.passedCleanly,
    true,
    "Published source baseline must pass before candidate replay",
  );
  const candidateFiles = candidates.map((item) => "__tests__/" + item.file);
  for (const item of candidates)
    fs.writeFileSync(path.join(project, "__tests__", item.file), item.original);
  await run("raw-candidates", candidateFiles);
  const adaptations = candidates.map((item) => {
    const adapted = adaptSessionStoreFixture(item.original.toString("utf8"));
    fs.writeFileSync(
      path.join(project, "__tests__", item.file),
      adapted.source,
    );
    return {
      sampleId: item.row.sampleId,
      originalDigest: digest(item.original),
      replayDigest: digest(Buffer.from(adapted.source)),
      changed: adapted.changed,
      ...(adapted.changed
        ? { adapter: adapted.adapter, exactAddition: adapted.addition }
        : {}),
    };
  });
  const adapted = new Map();
  for (const item of candidates)
    adapted.set(
      item.row.sampleId,
      await run("fixture-adapted-" + item.row.sampleId, [
        "__tests__/" + item.file,
      ]),
    );
  const mutants = [];
  const engineering = [];
  const imageEngineering =
    "__tests__/unit/image-pinned-handle-regression.test.js";
  const engineeringBaseline = candidates.some(
    (item) => item.row.taskId === "verify-13",
  )
    ? await run("image-engineering-baseline", [imageEngineering])
    : null;
  for (const taskId of [
    ...new Set(candidates.map((item) => item.row.taskId)),
  ]) {
    const items = candidates.filter((item) => item.row.taskId === taskId);
    const spec = items[0].spec;
    const target = path.join(sourceWorkspace, spec.sourcePath),
      original = fs.readFileSync(target);
    const text = original.toString("utf8").replaceAll("\r\n", "\n");
    for (const mutant of spec.mutants) {
      const anchor = [mutant, ...(mutant.alternatives || [])].find((item) =>
        text.includes(item.find),
      );
      assert.ok(anchor, "Original mutant anchor unavailable: " + mutant.name);
      assert.equal(text.split(anchor.find).length, 2);
      const changedSource = text.replace(anchor.find, anchor.replace);
      fs.writeFileSync(target, changedSource);
      try {
        for (const item of items) {
          const result = await run(item.row.sampleId + "-" + mutant.name, [
            "__tests__/" + item.file,
          ]);
          const candidatePassed = adapted.get(item.row.sampleId).passedCleanly;
          mutants.push({
            sampleId: item.row.sampleId,
            taskId,
            name: mutant.name,
            candidatePassed,
            rejectedByAssertions:
              candidatePassed && result.rejectedByAssertions,
            originalSourceDigest: digest(original),
            mutatedSourceDigest: digest(Buffer.from(changedSource)),
            mutationDigest: digest(
              JSON.stringify({ find: anchor.find, replace: anchor.replace }),
            ),
          });
        }
        if (taskId === "verify-13" && engineeringBaseline?.passedCleanly) {
          const checked = await run(
            "engineering-" + taskId + "-" + mutant.name,
            [imageEngineering],
          );
          engineering.push({
            taskId,
            name: mutant.name,
            rejectedByAssertions: checked.rejectedByAssertions,
          });
        }
      } finally {
        fs.writeFileSync(target, original);
      }
    }
  }
  const historyFile = path.join(project, "src/lib/session-history-origins.js");
  const originalHistory = fs.readFileSync(historyFile);
  const history = originalHistory.toString("utf8");
  const begin = history.indexOf(
    "      // A branch may retain the complete verified context.",
  );
  const end = history.indexOf("      const cutoff = api.rewind(", begin);
  assert.ok(begin > 0 && end > begin);
  fs.writeFileSync(historyFile, history.slice(0, begin) + history.slice(end));
  const rollbacks = [];
  try {
    for (const item of candidates.filter(
      (candidate) => candidate.row.taskId === "verify-08",
    )) {
      const checked = await run(
        "rollback-full-history-fork-" + item.row.sampleId,
        ["__tests__/" + item.file],
      );
      rollbacks.push({
        sampleId: item.row.sampleId,
        kind: "remove-complete-prefix-fix",
        candidatePassed: adapted.get(item.row.sampleId).passedCleanly,
        rollbackRejectedByAssertions:
          adapted.get(item.row.sampleId).passedCleanly &&
          checked.rejectedByAssertions,
      });
    }
  } finally {
    fs.writeFileSync(historyFile, originalHistory);
  }
  const profileFile = path.join(
    project,
    "src/lib/background-launch-profile.js",
  );
  const originalProfile = fs.readFileSync(profileFile);
  const frozenProfile = await git([
    "show",
    previous.projectCommit +
      ":packages/cli/src/lib/background-launch-profile.js",
  ]);
  fs.writeFileSync(profileFile, frozenProfile);
  try {
    for (const item of candidates.filter(
      (candidate) => candidate.row.taskId === "verify-36",
    )) {
      const checked = await run(
        "rollback-frozen-background-profile-" + item.row.sampleId,
        ["__tests__/" + item.file],
      );
      rollbacks.push({
        sampleId: item.row.sampleId,
        kind: "restore-entire-frozen-profile-module",
        candidatePassed: adapted.get(item.row.sampleId).passedCleanly,
        rollbackRejectedByAssertions:
          adapted.get(item.row.sampleId).passedCleanly &&
          checked.rejectedByAssertions,
      });
    }
  } finally {
    fs.writeFileSync(profileFile, originalProfile);
  }
  const receipt = {
    schema: "chainlesschain.released-candidate-engineering-replay/v1",
    capturedAt: new Date().toISOString(),
    source,
    version,
    workspace,
    sourceWorkspace,
    kind: "local-engineering-replay-with-explicit-fixture-adaptation",
    changesFrozenAcceptance: false,
    countsAsNewModelAcceptance: false,
    modelRequests: 0,
    originalRetestSource: previous.source,
    frozenProjectSource: previous.projectCommit,
    originalCandidateReportDigest: digest(fs.readFileSync(reportFile)),
    archiveIndexDigest: digest(
      fs.readFileSync(path.join(archiveRoot, "archive-index.json")),
    ),
    releaseProofDigest: digest(fs.readFileSync(proofFile)),
    normalizedDependencyLockDigest: digest(lock),
    reviewSpecsDigest: digest(currentSpecs),
    runnerSourceDigest,
    dependencyContentsIndependentlyVerified: false,
    reviewedCandidateInputRequired: true,
    osSandboxAttested: false,
    configLoader: "native",
    environmentIsolation: "platform-only-plus-private-state",
    selectedSampleIds: selected.map((row) => row.sampleId),
    adaptations,
    baselinePassed: baseline.passedCleanly,
    adaptedCandidatesPassed: [...adapted.values()].every(
      (result) => result.passedCleanly,
    ),
    mutants,
    engineering,
    engineeringBaselinePassed: engineeringBaseline?.passedCleanly,
    rollbacks,
    results,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
  });
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      report: { type: "string" },
      "release-proof": { type: "string" },
      output: { type: "string" },
      "dependency-root": { type: "string" },
    },
  });
  try {
    assert.ok(
      values.report && values["release-proof"] && values.output,
      "--report --release-proof --output are required; execute only reviewed candidate code",
    );
    const result = await replayReleasedCandidates({
      report: values.report,
      releaseProof: values["release-proof"],
      output: values.output,
      dependencyRoot: values["dependency-root"],
    });
    console.log(
      JSON.stringify({
        output: values.output,
        baselinePassed: result.baselinePassed,
        adaptedCandidatesPassed: result.adaptedCandidatesPassed,
        mutants: result.mutants,
        modelRequests: 0,
      }),
    );
  } catch (error) {
    process.stderr.write(String(error.message) + "\n");
    process.exitCode = 1;
  }
}
