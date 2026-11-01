/** Explicit repaired-source cohort projection; never updates frozen scores. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createEvalComparison } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const PROJECTION_POLICY =
  "chainlesschain.verify01-repaired-source-projection/v1";
const ARCHIVE_PATHS = Object.freeze([
  ".",
  ":(exclude)docs/research/**",
  ":(exclude)packages/cli/scripts/verify01-*",
  ":(exclude)packages/cli/test-node/verify01-*",
  ":(exclude)packages/cli/__tests__/unit/verify01-*",
  ":(exclude)packages/cli/__tests__/verify-*.test.js",
  ":(exclude)packages/vscode-extension/__tests__/verify-*.test.js",
  ":(exclude)packages/cli/scripts/fixtures/verify01-*",
  ":(exclude).github/workflows/verify01-*",
]);
const EXCLUSIONS_DIGEST = outcomeDigest(ARCHIVE_PATHS.slice(1));

/** Shared generation/checker archive projection; frozen runs keep the full tree. */
export function nativeProjectArchivePaths(revisionBinding) {
  if (revisionBinding === null || revisionBinding === undefined) return [];
  assert.equal(revisionBinding.projectionPolicy, PROJECTION_POLICY);
  assert.equal(revisionBinding.exclusionsDigest, EXCLUSIONS_DIGEST);
  return [...ARCHIVE_PATHS];
}
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fields = [
  "schema",
  "cohortId",
  "parentProjectCommit",
  "parentPlanDigest",
  "projectCommit",
  "selectedSampleIds",
  "taskDeliverables",
  "reason",
];

function repositoryPath(relative, required = false) {
  assert.equal(typeof relative, "string", "repository-relative path required");
  assert.ok(
    relative && !/[\\:]/u.test(relative) && !path.posix.isAbsolute(relative),
    "repository-relative path required",
  );
  const parts = relative.split("/");
  assert.ok(
    parts.every((part) => part && part !== "." && part !== ".."),
    "invalid path segment",
  );
  let current = repository;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (!required && error.code === "ENOENT") continue;
      throw error;
    }
    assert.ok(!stat.isSymbolicLink(), "revision paths must not contain links");
    assert.ok(
      index === parts.length - 1 ? stat.isFile() : stat.isDirectory(),
      "regular path required",
    );
  }
  return current;
}

function parseManifest(bytes) {
  assert.ok(
    bytes.length > 0 && bytes.length <= 65536,
    "revision manifest size invalid",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  // JSON.parse accepts repeated decoded keys. Reject those before using identity.
  const stack = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      while (++index < text.length) {
        if (text[index] === "\\") index++;
        else if (text[index] === '"') break;
      }
      const object = stack.at(-1);
      if (object?.key) {
        const key = JSON.parse(text.slice(start, index + 1));
        assert.ok(!object.keys.has(key), "duplicate manifest key");
        object.keys.add(key);
        object.key = false;
      }
    } else if (char === "{") stack.push({ keys: new Set(), key: true });
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)) stack.at(-1).key = true;
  }
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    "manifest object required",
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...fields].sort(),
    "unexpected or missing revision fields",
  );
  return value;
}

export function loadNativeProjectRevision({
  revisionFile,
  plan,
  catalog,
  bindings,
  baseProjectCommit,
  basePlanDigest,
}) {
  if (revisionFile === undefined || revisionFile === null)
    return {
      plan,
      catalog,
      bindings,
      projectCommit: baseProjectCommit,
      planDigest: basePlanDigest,
      revisionBinding: null,
    };
  const absolute = repositoryPath(revisionFile, true);
  const bytes = fs.readFileSync(absolute);
  const revision = parseManifest(bytes);
  assert.equal(revision.schema, "chainlesschain.verify01-project-revision/v1");
  assert.match(revision.cohortId, /^repaired-source-followup(?:-[a-z0-9]+)*$/u);
  assert.match(baseProjectCommit, /^[a-f0-9]{40}$/u);
  assert.match(basePlanDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    revision.parentProjectCommit,
    baseProjectCommit,
    "parent project identity mismatch",
  );
  assert.equal(
    revision.parentPlanDigest,
    basePlanDigest,
    "parent plan identity mismatch",
  );
  assert.equal(plan.commitSha, baseProjectCommit, "base plan project mismatch");
  assert.equal(
    catalog.projectCommit,
    baseProjectCommit,
    "base catalog project mismatch",
  );
  assert.match(revision.projectCommit, /^[a-f0-9]{40}$/u);
  assert.notEqual(
    revision.projectCommit,
    baseProjectCommit,
    "repair source must differ from frozen source",
  );
  assert.equal(typeof revision.reason, "string");
  assert.ok(
    revision.reason.trim().length > 0 && revision.reason.length <= 4096,
    "revision reason required",
  );
  assert.ok(
    Array.isArray(revision.selectedSampleIds) &&
      revision.selectedSampleIds.length > 0,
    "selected samples required",
  );
  assert.equal(
    new Set(revision.selectedSampleIds).size,
    revision.selectedSampleIds.length,
    "duplicate selected sample",
  );
  assert.equal(
    new Set(plan.samples.map((sample) => sample.id)).size,
    plan.samples.length,
    "ambiguous base samples",
  );
  assert.equal(
    new Set(catalog.tasks.map((task) => task.id)).size,
    catalog.tasks.length,
    "ambiguous base tasks",
  );
  const selectedTasks = new Set();
  for (const id of revision.selectedSampleIds) {
    assert.equal(typeof id, "string");
    const sample = plan.samples.find((item) => item.id === id);
    assert.ok(sample, "selected sample outside base plan");
    assert.ok(
      catalog.tasks.some((task) => task.id === sample.taskId),
      "selected task outside base catalog",
    );
    selectedTasks.add(sample.taskId);
  }
  const deliverables = revision.taskDeliverables;
  assert.ok(
    deliverables &&
      typeof deliverables === "object" &&
      !Array.isArray(deliverables),
    "task deliverables map required",
  );
  assert.deepEqual(
    Object.keys(deliverables).sort(),
    [...selectedTasks].sort(),
    "deliverables must match selected tasks exactly",
  );
  for (const taskId of selectedTasks) {
    assert.match(taskId, /^verify-\d{2}$/u);
    const expected = `packages/cli/__tests__/repair137-${taskId}.test.js`;
    assert.deepEqual(
      deliverables[taskId],
      [expected],
      "only fresh repair137 test deliverables are allowed",
    );
    repositoryPath(expected);
  }
  const projectedPlan = structuredClone(plan);
  projectedPlan.commitSha = revision.projectCommit;
  const projectedCatalog = structuredClone(catalog);
  projectedCatalog.projectCommit = revision.projectCommit;
  for (const task of projectedCatalog.tasks)
    if (selectedTasks.has(task.id))
      task.expectedFiles = [...deliverables[task.id]];
  const revisionDigest = hash(bytes);
  projectedPlan.sourceRevision = {
    cohortId: revision.cohortId,
    manifestDigest: revisionDigest,
    parentPlanDigest: basePlanDigest,
    parentProjectCommit: baseProjectCommit,
    formalSample: false,
    projectionPolicy: PROJECTION_POLICY,
    exclusionsDigest: EXCLUSIONS_DIGEST,
  };
  const projectedBindings =
    bindings === undefined ? undefined : structuredClone(bindings);
  if (projectedBindings) {
    assert.ok(
      projectedBindings.comparisons &&
        typeof projectedBindings.comparisons === "object" &&
        !Array.isArray(projectedBindings.comparisons),
      "comparison bindings required",
    );
    const corpusDigest = outcomeDigest(projectedCatalog);
    for (const [stratum, comparison] of Object.entries(
      projectedBindings.comparisons,
    )) {
      projectedBindings.comparisons[stratum] = createEvalComparison({
        ...comparison,
        context: comparison.declared,
        ...comparison.runtime,
        corpusDigest,
      });
    }
    for (const sample of projectedPlan.samples) {
      const comparison = projectedBindings.comparisons[sample.stratum];
      assert.ok(comparison, "sample comparison binding missing");
      sample.comparisonDigest = outcomeDigest(comparison);
    }
  } else {
    assert.ok(
      !projectedPlan.samples.some(
        (sample) => sample.comparisonDigest !== undefined,
      ),
      "comparison bindings required for a bound plan",
    );
  }
  const planDigest = outcomeDigest(projectedPlan);
  return {
    plan: projectedPlan,
    catalog: projectedCatalog,
    bindings: projectedBindings,
    projectCommit: revision.projectCommit,
    planDigest,
    revisionBinding: {
      schema: revision.schema,
      path: revisionFile,
      digest: revisionDigest,
      cohortId: revision.cohortId,
      parentProjectCommit: baseProjectCommit,
      parentPlanDigest: basePlanDigest,
      projectCommit: revision.projectCommit,
      selectedSampleIds: [...revision.selectedSampleIds],
      formalSample: false,
      projectionPolicy: PROJECTION_POLICY,
      exclusionsDigest: EXCLUSIONS_DIGEST,
      reason: revision.reason,
    },
  };
}
