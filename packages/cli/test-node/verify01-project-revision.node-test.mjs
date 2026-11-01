import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadNativeProjectRevision,
  nativeProjectArchivePaths,
} from "../scripts/verify01-project-revision.mjs";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import { validateVerify01Bundle } from "../src/lib/eval/verify01-contracts.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const baseProjectCommit = "a".repeat(40);
const basePlanDigest = `sha256:${"b".repeat(64)}`;
const plan = {
  commitSha: baseProjectCommit,
  samples: [
    {
      id: "verify-08",
      taskId: "verify-08",
      stratum: "darwin-vscode-volcengine",
      costBudget: 2,
    },
    {
      id: "first-run-darwin-vscode",
      taskId: "verify-08",
      kind: "first-run",
      timeBudgetMs: 1000,
    },
    { id: "verify-13", taskId: "verify-13", stratum: "linux-cli-volcengine" },
  ],
};
const catalog = {
  projectCommit: baseProjectCommit,
  tasks: ["verify-08", "verify-13"].map((id) => ({
    id,
    prompt: `Unchanged ${id}`,
    sourcePaths: [`src/${id}.js`],
    expectedFiles: [`packages/cli/__tests__/${id}.test.js`],
    mutants: [{ name: "unchanged", find: "guard", replace: "false" }],
  })),
};
const manifest = () => ({
  schema: "chainlesschain.verify01-project-revision/v1",
  cohortId: "repaired-source-followup-137",
  parentProjectCommit: baseProjectCommit,
  parentPlanDigest: basePlanDigest,
  projectCommit: "c".repeat(40),
  selectedSampleIds: ["verify-08", "first-run-darwin-vscode"],
  taskDeliverables: {
    "verify-08": ["packages/cli/__tests__/repair137-verify-08.test.js"],
  },
  reason: "Independent follow-up on repaired source; frozen results unchanged.",
});
const options = { plan, catalog, baseProjectCommit, basePlanDigest };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(repository, ".revision-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "revision.json");
  const relative = path.relative(repository, file).split(path.sep).join("/");
  return {
    root,
    file,
    relative,
    load(value = manifest()) {
      fs.writeFileSync(
        file,
        typeof value === "string" ? value : JSON.stringify(value),
      );
      return loadNativeProjectRevision({ ...options, revisionFile: relative });
    },
  };
}

test("no explicit revision preserves the frozen inputs and identity", () => {
  const result = loadNativeProjectRevision(options);
  assert.equal(result.plan, plan);
  assert.equal(result.catalog, catalog);
  assert.equal(result.projectCommit, baseProjectCommit);
  assert.equal(result.planDigest, basePlanDigest);
  assert.equal(result.revisionBinding, null);
  assert.throws(() =>
    loadNativeProjectRevision({ ...options, revisionFile: "" }),
  );
});

test("projects source and selected task deliverables without rewriting allocation or contracts", (t) => {
  const input = structuredClone({ plan, catalog });
  const f = fixture(t);
  const result = f.load();
  const expectedCatalog = structuredClone(catalog);
  expectedCatalog.projectCommit = "c".repeat(40);
  expectedCatalog.tasks[0].expectedFiles =
    manifest().taskDeliverables["verify-08"];
  assert.deepEqual(result.catalog, expectedCatalog);
  assert.deepEqual(result.plan, {
    ...plan,
    commitSha: "c".repeat(40),
    sourceRevision: {
      cohortId: manifest().cohortId,
      manifestDigest: result.revisionBinding.digest,
      parentPlanDigest: basePlanDigest,
      parentProjectCommit: baseProjectCommit,
      formalSample: false,
      projectionPolicy: result.revisionBinding.projectionPolicy,
      exclusionsDigest: result.revisionBinding.exclusionsDigest,
    },
  });
  assert.equal(result.planDigest, outcomeDigest(result.plan));
  assert.deepEqual({ plan, catalog }, input);
  assert.equal(result.revisionBinding.formalSample, false);
  assert.deepEqual(
    result.revisionBinding.selectedSampleIds,
    manifest().selectedSampleIds,
  );
  assert.equal(result.revisionBinding.path, f.relative);
  assert.match(result.planDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(f.load().planDigest, result.planDigest);
  const whitespace = f.load(JSON.stringify(manifest(), null, 2));
  assert.notEqual(whitespace.planDigest, result.planDigest);
  assert.notEqual(
    whitespace.revisionBinding.digest,
    result.revisionBinding.digest,
  );
});

test("fixed archive projection excludes historical answers and evaluators only for revision cohorts", (t) => {
  assert.deepEqual(nativeProjectArchivePaths(), []);
  assert.deepEqual(nativeProjectArchivePaths(null), []);
  const f = fixture(t);
  const result = f.load();
  const paths = nativeProjectArchivePaths(result.revisionBinding);
  assert.deepEqual(paths, [
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
  assert.equal(
    result.revisionBinding.exclusionsDigest,
    outcomeDigest(paths.slice(1)),
  );
  assert.equal(
    result.plan.sourceRevision.exclusionsDigest,
    result.revisionBinding.exclusionsDigest,
  );
  paths.push(":(exclude)packages/cli/src/**");
  assert.equal(nativeProjectArchivePaths(result.revisionBinding).length, 9);
  assert.throws(() =>
    nativeProjectArchivePaths({
      ...result.revisionBinding,
      exclusionsDigest: basePlanDigest,
    }),
  );
  assert.throws(() => f.load({ ...manifest(), projectionPolicy: "override" }));
});

test("real 36-task 45-sample bundle remains independently valid after corpus rebinding", (t) => {
  const f = fixture(t);
  const directory = path.join(
    repository,
    "docs/research/cli/verify01-plan-2026-10-13-volcengine",
  );
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const original = {
    plan: read("plan.json"),
    catalog: read("tasks.json"),
    bindings: read("comparison-bindings.json"),
  };
  const originalSnapshot = structuredClone(original);
  const parentDigest = outcomeDigest(original.plan);
  validateVerify01Bundle({ ...original, expectedPlanDigest: parentDigest });
  const noRevision = loadNativeProjectRevision({
    ...original,
    baseProjectCommit: original.plan.commitSha,
    basePlanDigest: parentDigest,
  });
  assert.equal(noRevision.bindings, original.bindings);
  const revision = {
    ...manifest(),
    parentProjectCommit: original.plan.commitSha,
    parentPlanDigest: parentDigest,
  };
  fs.writeFileSync(f.file, JSON.stringify(revision));
  const result = loadNativeProjectRevision({
    ...original,
    revisionFile: f.relative,
    baseProjectCommit: original.plan.commitSha,
    basePlanDigest: parentDigest,
  });
  const checked = validateVerify01Bundle({
    ...result,
    expectedPlanDigest: result.planDigest,
  });
  assert.equal(checked.tasks.size, 36);
  assert.equal(checked.samples.size, 45);
  assert.deepEqual(original, originalSnapshot);
  const withoutComparisonDigest = (samples) =>
    samples.map((sample) => {
      const copy = { ...sample };
      delete copy.comparisonDigest;
      return copy;
    });
  assert.deepEqual(
    withoutComparisonDigest(result.plan.samples),
    withoutComparisonDigest(original.plan.samples),
  );
  for (const [stratum, comparison] of Object.entries(
    result.bindings.comparisons,
  )) {
    assert.equal(comparison.corpusDigest, outcomeDigest(result.catalog));
    assert.deepEqual(
      comparison.declared,
      original.bindings.comparisons[stratum].declared,
    );
    assert.deepEqual(
      comparison.runtime,
      original.bindings.comparisons[stratum].runtime,
    );
  }
  for (const task of result.catalog.tasks) {
    const parent = original.catalog.tasks.find((item) => item.id === task.id);
    assert.deepEqual({ ...task, expectedFiles: parent.expectedFiles }, parent);
  }
  assert.throws(
    () =>
      loadNativeProjectRevision({
        ...original,
        bindings: undefined,
        revisionFile: f.relative,
        baseProjectCommit: original.plan.commitSha,
        basePlanDigest: parentDigest,
      }),
    /bindings required/,
  );
});

test("rejects wrong parent, invalid source, ambiguous JSON and attempted contract overrides", (t) => {
  const f = fixture(t);
  for (const patch of [
    { parentProjectCommit: "d".repeat(40) },
    { parentPlanDigest: `sha256:${"d".repeat(64)}` },
    { projectCommit: "HEAD" },
    { projectCommit: baseProjectCommit },
    { cohortId: "formal" },
    { reason: " " },
    { prompt: "weaken assertion" },
    { mutants: [] },
    { costBudget: 99 },
  ])
    assert.throws(() => f.load({ ...manifest(), ...patch }));
  assert.throws(
    () =>
      f.load(
        JSON.stringify(manifest()).replace(
          '"reason":',
          '"reason":"first","reason":',
        ),
      ),
    /duplicate/,
  );
  f.load();
  assert.throws(() =>
    loadNativeProjectRevision({
      ...options,
      revisionFile: f.relative,
      catalog: { ...catalog, projectCommit: "e".repeat(40) },
    }),
  );
});

test("rejects unknown or duplicate samples and extra, missing or unsafe deliverables", (t) => {
  const f = fixture(t);
  for (const selectedSampleIds of [[], ["unknown"], ["verify-08", "verify-08"]])
    assert.throws(() => f.load({ ...manifest(), selectedSampleIds }));
  for (const taskDeliverables of [
    {},
    {
      ...manifest().taskDeliverables,
      "verify-13": ["packages/cli/__tests__/repair137-verify-13.test.js"],
    },
    { "verify-08": ["../escape.test.js"] },
    { "verify-08": ["/tmp/escape.test.js"] },
    { "verify-08": ["packages/cli/__tests__/verify-08.test.js"] },
    { "verify-08": ["packages/cli/__tests__/repair137-verify-13.test.js"] },
    { "verify-08": "packages/cli/__tests__/repair137-verify-08.test.js" },
  ])
    assert.throws(() => f.load({ ...manifest(), taskDeliverables }));
});

test("requires a repository-relative regular manifest and rejects directory links", (t) => {
  const f = fixture(t);
  f.load();
  for (const revisionFile of [
    f.file,
    "../revision.json",
    "./revision.json",
    f.relative.replaceAll("/", "\\"),
  ])
    assert.throws(() =>
      loadNativeProjectRevision({ ...options, revisionFile }),
    );
  const alias = path.join(f.root, "linked");
  fs.symlinkSync(
    f.root,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () =>
      loadNativeProjectRevision({
        ...options,
        revisionFile: `${path.basename(f.root)}/linked/revision.json`,
      }),
    /links/,
  );
  fs.unlinkSync(alias);
});
