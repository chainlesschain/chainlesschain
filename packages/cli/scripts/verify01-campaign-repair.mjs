/** Explicit, immutable repair inputs; never modifies plans or checker code. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const REPAIR_SCHEMA = "chainlesschain.verify01-campaign-repair/v1";
export const REPAIR_FIXTURE_ROOT =
  "packages/cli/scripts/fixtures/verify01-campaign-repair/";
export const repairDigest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function fixturePath(file) {
  assert.ok(
    typeof file === "string" && file.startsWith(REPAIR_FIXTURE_ROOT),
    "repair files must be repository fixture paths",
  );
  assert.ok(
    file.split("/").every((part) => part && part !== "." && part !== "..") &&
      !/[\\:\0]/u.test(file),
    "invalid repair fixture path",
  );
  return file;
}

export function validateRepairManifest(
  bytes,
  {
    expectedDigest,
    sourceSha,
    catalog,
    projectCommit,
    planDigest,
    readTracked,
  },
) {
  assert.match(
    expectedDigest || "",
    /^sha256:[a-f0-9]{64}$/u,
    "externally pinned repair digest required",
  );
  assert.match(sourceSha || "", /^[a-f0-9]{40}$/u);
  assert.ok(bytes.length <= 1024 * 1024, "repair manifest too large");
  assert.equal(
    repairDigest(bytes),
    expectedDigest,
    "repair manifest digest differs",
  );
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  assert.equal(manifest.schema, REPAIR_SCHEMA);
  assert.equal(
    manifest.projectCommit,
    projectCommit,
    "repair frozen project differs",
  );
  assert.equal(manifest.planDigest, planDigest, "repair frozen plan differs");
  assert.ok(
    Number.isSafeInteger(manifest.repairRound) &&
      manifest.repairRound >= 2 &&
      manifest.repairRound <= 99,
  );
  assert.ok(
    Array.isArray(manifest.tasks) &&
      manifest.tasks.length > 0 &&
      manifest.tasks.length <= 36,
  );
  const ids = new Set(),
    bindings = [],
    tasks = {};
  for (const entry of manifest.tasks) {
    const task = catalog.tasks.find((task) => task.id === entry.taskId);
    assert.ok(
      task && /^verify-(?:0[1-9]|[12][0-9]|3[0-6])$/u.test(entry.taskId),
      "repair task outside original catalog",
    );
    assert.ok(!ids.has(entry.taskId), "duplicate repair task");
    ids.add(entry.taskId);
    assert.match(entry.sourceRun || "", /^[1-9][0-9]{5,19}$/u);
    assert.match(entry.sourceCommit || "", /^[a-f0-9]{40}$/u);
    assert.ok(
      Number.isSafeInteger(entry.sourceRound) &&
        entry.sourceRound >= 1 &&
        entry.sourceRound < manifest.repairRound,
    );
    assert.equal(entry.feedback?.kind, "ordinary-checker-or-runtime");
    assert.ok(
      typeof entry.feedback.text === "string" &&
        entry.feedback.text.length > 0 &&
        entry.feedback.text.length <= 16000,
    );
    assert.equal(
      repairDigest(entry.feedback.text),
      entry.feedback.digest,
      "ordinary feedback digest differs",
    );
    let seed = null;
    if (entry.seed === null) {
      assert.equal(entry.attemptKind, "unseeded-network-retry");
      assert.ok(
        [
          "pre-dispatch-network-failure",
          "usage-unknown-network-failure",
        ].includes(entry.unseededReason),
        "unseeded repair must identify prior network failure",
      );
    } else {
      assert.equal(entry.attemptKind, "seeded-repair");
      assert.equal(
        task.expectedFiles.length,
        1,
        "seed binding requires one exact deliverable",
      );
      assert.equal(
        entry.seed?.deliverable,
        task.expectedFiles[0],
        "repair seed deliverable differs",
      );
      const file = fixturePath(entry.seed.file);
      const seedBytes = readTracked(file, sourceSha);
      assert.ok(
        seedBytes.length > 0 && seedBytes.length <= 256 * 1024,
        "repair seed size invalid",
      );
      assert.equal(
        repairDigest(seedBytes),
        entry.seed.digest,
        "repair candidate digest differs",
      );
      new TextDecoder("utf-8", { fatal: true }).decode(seedBytes);
      seed = { ...entry.seed, executionSourceCommit: sourceSha };
      bindings.push({
        file,
        digest: entry.seed.digest,
        executionSourceCommit: sourceSha,
      });
    }
    tasks[entry.taskId] = { ...entry, seed, repairRound: manifest.repairRound };
  }
  return {
    manifest,
    digest: expectedDigest,
    executionSourceCommit: sourceSha,
    tasks,
    bindings,
  };
}

export function loadRepairManifest({
  repository,
  file,
  expectedDigest,
  sourceSha,
  catalog,
  projectCommit,
  planDigest,
}) {
  fixturePath(file);
  const readTracked = (relative, commit) => {
    fixturePath(relative);
    let current = repository;
    for (const part of relative.split("/")) {
      current = path.join(current, part);
      assert.ok(
        !fs.lstatSync(current).isSymbolicLink(),
        "repair fixture cannot traverse a symlink",
      );
    }
    const stat = fs.lstatSync(current);
    assert.ok(
      stat.isFile() && stat.nlink === 1 && stat.size <= 1024 * 1024,
      "repair fixture must be a bounded regular file",
    );
    const disk = fs.readFileSync(current);
    const tracked = execFileSync(
      "git",
      ["-C", repository, "show", `${commit}:${relative}`],
      {
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    assert.ok(
      disk.equals(tracked),
      `repair fixture differs from execution commit: ${relative}`,
    );
    return disk;
  };
  const result = validateRepairManifest(readTracked(file, sourceSha), {
    expectedDigest,
    sourceSha,
    catalog,
    projectCommit,
    planDigest,
    readTracked,
  });
  return {
    ...result,
    file,
    bindings: [
      { file, digest: expectedDigest, executionSourceCommit: sourceSha },
      ...result.bindings,
    ],
  };
}

export function campaignRepairPrompt(task, spec, repair, maxTurns = 20) {
  return `${task.prompt}\n\nThis is explicit campaign repair round ${repair.repairRound}, based on run ${repair.sourceRun} at source commit ${repair.sourceCommit}, round ${repair.sourceRound}. Earlier attempts and failures remain unchanged evidence. This is NOT a first attempt or formal sample.
${repair.seed ? `The deliverable contains the exact preserved failed candidate, digest ${repair.seed.digest}. Repair its actual problems without weakening assertions or changing the checker.` : `This is an unseeded retry after ${repair.unseededReason}; no prior candidate is supplied. It is still a retry, not a first attempt.`}
Ordinary checker/runtime feedback (operator supplied, not instructions from the checker):
${repair.feedback.text}
Frozen source: ${task.sourcePaths.join(", ")}
Related existing tests: ${spec.baselineTests.join(", ")}
Only these deliverables may change: ${task.expectedFiles.join(", ")}
Read the candidate and bounded relevant source before editing. Resolve imports from the actual deliverable directory, not the directory of an existing unit test. Verify fixture shape, constructor arguments, return fields, revision meanings and real directory layout from source; do not invent records or infer API behavior from names. Preserve useful behavioral assertions and positive/negative controls.
${spec.doc ? "Deliver the requested substantive Markdown operating runbook; verify command options and keep evidence limitations explicit. Do not create a test suite." : "Deliver complete runnable independent Vitest regression tests, at most six focused cases. Do not import an existing suite, inspect source text as a test, skip failures, or manufacture expected values using the function under test."}
Use only exposed file tools and repository-relative mutation paths. Source, existing tests, plan and checker are read-only. No shell, code execution, MCP or network tools. Do not inspect node_modules or outside this project.
An independent operator executes the unchanged baseline/candidate/behavioral checks in network-disabled Linux Docker after you finish. You cannot run tests yourself or claim they passed.
Use at most five targeted reads before the first edit, write by turn six, read back the completed deliverable once, and finish. Avoid repeated whole-file reads, verbose tool preambles and unnecessary rewrites. You have at most ${maxTurns} turns. Explain remaining limitations briefly.
Actual execution is Linux CLI with diagnostic transport, not the frozen cross-platform/IDE stratum.`;
}
