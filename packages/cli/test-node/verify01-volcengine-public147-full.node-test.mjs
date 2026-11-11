import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  PUBLIC147_FULL_ID,
  PUBLIC147_VERSIONS,
  PUBLIC147_MODEL_METADATA,
  PUBLIC147_FULL_BUDGETS,
  loadPublic147FullRound,
  public147FullBudgets,
} from "../scripts/verify01-volcengine-public147-full.mjs";
import { assertFreshVolcengineRound } from "../scripts/verify01-volcengine-fresh-round.mjs";
import {
  nativeExecutionBudgets,
  loadVolcengineBudgetRetry,
  DEFAULT_NATIVE_BUDGETS,
} from "../scripts/verify01-native-execution-budgets.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const plan = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
    ),
    "utf8",
  ),
);
function fixture(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "cc-full147-"));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert(path.basename(root).startsWith("cc-full147-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const record = (relative, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), bytes);
    return {
      path: relative,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
  };
  const source = "a".repeat(40);
  const manifest = {
    schema: "chainlesschain.native-package-set/v1",
    versions: { ...PUBLIC147_VERSIONS },
    diagnosticExecution: { contextWindowTokens: 32768 },
    releaseSourceCommits: { cli: source, openVsx: source, jetbrains: source },
    publicGeneratorProof: record(
      "docs/research/cli/evidence/release900147-public/publication.json",
      {
        cli: {
          version: PUBLIC147_VERSIONS.cli,
          status: "verified-public",
          source,
        },
        ide: {
          vscode: {
            version: PUBLIC147_VERSIONS.vscode,
            status: "verified-public",
            source,
          },
          jetbrains: {
            version: PUBLIC147_VERSIONS.jetbrains,
            status: "verified-public",
            source,
          },
        },
      },
    ),
    volcengineFullRound: {
      id: PUBLIC147_FULL_ID,
      projectCommit: plan.commitSha,
      model: "deepseek-v4-flash-ga-260731",
      taskCount: 36,
      firstRunCount: 9,
      repeatPreviouslyAccepted: true,
      historicalScoresUnchanged: true,
      formalSample: false,
      reviewChanges: true,
      outputPolicy: "model-maximum",
      ...PUBLIC147_FULL_BUDGETS,
      modelMetadata: record(PUBLIC147_MODEL_METADATA, {
        id: "deepseek-v4-flash-ga-260731",
        token_limits: { max_output_token_length: 393216 },
      }),
    },
  };
  const options = () => ({
    provider: "volcengine",
    packageSet: "latest",
    packageBinding: {
      versions: manifest.versions,
      bytes: Buffer.from(JSON.stringify(manifest)),
    },
    hosts: "all",
    entries: "all",
    sampleIds: undefined,
    revisionBinding: null,
    runAttempt: 1,
    credentialPresent: true,
    reviewChanges: true,
    repositoryRoot: root,
  });
  return { root, manifest, options };
}

test("new public147 round retains all 36 tasks and nine independent first runs", (t) => {
  const f = fixture(t),
    result = assertFreshVolcengineRound(f.options(), plan);
  assert.equal(result.selectedSampleIds.length, 45);
  assert.equal(Object.keys(result.sampleIdsByGroup).length, 9);
  assert(
    Object.values(result.sampleIdsByGroup).every((ids) => ids.length === 5),
  );
  assert.deepEqual(result.budgets, PUBLIC147_FULL_BUDGETS);
  assert.deepEqual(
    loadVolcengineBudgetRetry(f.manifest, { repositoryRoot: f.root, plan }),
    result,
  );
  assert.deepEqual(nativeExecutionBudgets(f.manifest), result.budgets);
  assert.deepEqual(nativeExecutionBudgets({}), DEFAULT_NATIVE_BUDGETS);
});
test("dispatch refuses subsets, repeat paid attempts, missing credentials and changed treatment", (t) => {
  const f = fixture(t);
  for (const mutation of [
    { provider: "openai" },
    { hosts: "linux" },
    { entries: "cli" },
    { sampleIds: [] },
    { runAttempt: 2 },
    { credentialPresent: false },
    { reviewChanges: false },
    { revisionBinding: {} },
    { packageSet: "prerelease" },
  ])
    assert.throws(() =>
      assertFreshVolcengineRound({ ...f.options(), ...mutation }, plan),
    );
});
test("public147 cannot silently change budgets, model, project or historical scoring", (t) => {
  const f = fixture(t);
  for (const mutation of [
    { outputTokens: 8192 },
    { physicalRequests: 49 },
    { modelTurns: 41 },
    { preserveExplicitOutputLimits: false },
    { model: "different" },
    { historicalScoresUnchanged: false },
    { formalSample: true },
    { projectCommit: "b".repeat(40) },
  ]) {
    const manifest = structuredClone(f.manifest);
    Object.assign(manifest.volcengineFullRound, mutation);
    assert.throws(() => nativeExecutionBudgets(manifest));
  }
  const manifest = structuredClone(f.manifest);
  manifest.diagnosticExecution.contextWindowTokens = 8192;
  assert.throws(() => public147FullBudgets(manifest, "volcengine"));
});
test("round requires exact public package versions and cannot alias a historical round", (t) => {
  const f = fixture(t);
  for (const key of [
    "cli",
    "vscode",
    "jetbrains",
    "vscodeHost",
    "jetbrainsHost",
  ]) {
    const manifest = structuredClone(f.manifest);
    manifest.versions[key] = "0.0.1";
    assert.throws(() => nativeExecutionBudgets(manifest));
  }
  for (const key of [
    "prepublication",
    "runtimeRepair",
    "volcengineBudgetRetry",
    "freshVolcengineRound",
    "volcengineGenerationRecovery",
  ]) {
    const manifest = structuredClone(f.manifest);
    manifest[key] = {};
    assert.throws(() => public147FullBudgets(manifest, "volcengine"));
  }
  const manifest = structuredClone(f.manifest);
  manifest.volcengineFullRound.id = "unknown-round";
  assert.throws(() => nativeExecutionBudgets(manifest));
});
test("original sample identities, assignment and kinds cannot be changed", (t) => {
  const f = fixture(t);
  for (const mutate of [
    (p) => p.samples.pop(),
    (p) => {
      p.samples[0].id = p.samples[1].id;
    },
    (p) => {
      p.samples[0].kind = "first-run";
    },
    (p) => {
      p.samples[0].stratum = p.samples[1].stratum;
    },
    (p) => {
      p.commitSha = "b".repeat(40);
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert.throws(() =>
      loadPublic147FullRound(f.manifest, {
        repositoryRoot: f.root,
        plan: changed,
      }),
    );
  }
});
test("model metadata byte drift is rejected before any live execution", (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, PUBLIC147_MODEL_METADATA), " ");
  assert.throws(() =>
    loadPublic147FullRound(f.manifest, { repositoryRoot: f.root, plan }),
  );
});
test("missing or mismatched publication evidence does not admit the full round", (t) => {
  const f = fixture(t);
  const missing = structuredClone(f.manifest);
  delete missing.publicGeneratorProof;
  assert.throws(() =>
    loadPublic147FullRound(missing, { repositoryRoot: f.root, plan }),
  );
  const mismatched = structuredClone(f.manifest);
  mismatched.releaseSourceCommits.cli = "b".repeat(40);
  assert.throws(() =>
    loadPublic147FullRound(mismatched, { repositoryRoot: f.root, plan }),
  );
});

test("actual workflow selector prepares 45 isolated deliveries and acceptance cells using metadata GETs only", (t) => {
  const f = fixture(t);
  for (const record of [
    f.manifest.publicGeneratorProof,
    f.manifest.volcengineFullRound.modelMetadata,
  ]) {
    const target = path.join(repositoryRoot, record.path);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(
        path.join(f.root, record.path),
        target,
        fs.constants.COPYFILE_EXCL,
      );
      t.after(() => fs.rmSync(target, { force: true }));
    }
    record.digest = `sha256:${createHash("sha256").update(fs.readFileSync(target)).digest("hex")}`;
  }
  const relative = `docs/research/cli/verify01-package-sets/offline-full147-${randomUUID()}.json`;
  fs.writeFileSync(
    path.join(repositoryRoot, relative),
    JSON.stringify(f.manifest),
    { flag: "wx" },
  );
  t.after(() =>
    fs.rmSync(path.join(repositoryRoot, relative), { force: true }),
  );
  const output = path.join(f.root, "selection.txt");
  const workflow = fs.readFileSync(
    path.join(
      repositoryRoot,
      ".github/workflows/verify01-native-task-campaign.yml",
    ),
    "utf8",
  );
  const script = workflow.match(
    /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n {10}NODE/u,
  )?.[1];
  assert.ok(script);
  const mock = `const seen=[];globalThis.fetch=async(url,init)=>{seen.push(url);if(init?.method&&init.method!=='GET')throw new Error('non-GET forbidden');if(String(url).endsWith('/api/v3/models')){if(init.headers.Authorization!=='Bearer offline-placeholder')throw new Error('dedicated auth missing');return{ok:true,json:async()=>({data:[{id:'deepseek-v4-flash-ga-260731'}]})};}if(init?.headers?.Authorization)throw new Error('credential egress');if(url==='https://registry.npmjs.org/chainlesschain/latest')return{ok:true,json:async()=>({version:'0.166.147'})};if(url==='https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest')return{ok:true,json:async()=>({version:'0.37.186'})};throw new Error('inference or unexpected network');};`;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `${mock}\n${script}\nif(seen.length!==3)throw new Error('missing latest checks');`,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        NATIVE_PROVIDER: "volcengine",
        NATIVE_PACKAGE_SET_FILE: relative,
        NATIVE_PROJECT_REVISION_FILE: "",
        PACKAGE_SET_SELECTION: "latest",
        FRESH_VOLCENGINE_ROUND: "true",
        VOLCENGINE_CREDENTIAL_PRESENT: "true",
        VOLCENGINE_API_KEY: "offline-placeholder",
        HOST_SELECTION: "all",
        ENTRY_SELECTION: "all",
        SAMPLE_SELECTION: "",
        DELIVERY_RUN: "",
        DELIVERY_COMMIT: "",
        FETCH_DIAGNOSTICS: "false",
        GITHUB_RUN_ATTEMPT: "1",
        REVIEW_CHANGES: "true",
        GITHUB_OUTPUT: output,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const fields = Object.fromEntries(
    fs
      .readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  const deliveries = JSON.parse(fields.matrix).include;
  const acceptance = JSON.parse(fields.acceptance_matrix).include;
  assert.equal(deliveries.length, 45);
  assert.equal(acceptance.length, 45);
  assert(deliveries.every((row) => row.sample_count === 1));
  assert.equal(new Set(deliveries.map((row) => row.cell_id)).size, 45);
  const ids = plan.samples.map((row) => row.id).sort();
  assert.deepEqual(deliveries.map((row) => row.sample_ids).sort(), ids);
  assert.deepEqual(acceptance.map((row) => row.sample_ids).sort(), ids);
});
