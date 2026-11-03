import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertFreshVolcengineRound } from "../scripts/verify01-volcengine-fresh-round.mjs";
import { nativeProviderCells } from "../scripts/verify01-native-round-matrix.mjs";
import { selectNativeSamples } from "../scripts/verify01-native-task-campaign.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relative) =>
  fs.readFileSync(new URL("../../../" + relative, import.meta.url));
const manifest = JSON.parse(
  read("docs/research/cli/verify01-package-sets/2026-11-02-openai-139.json"),
);
manifest.publicGeneratorProof.digest =
  "sha256:" +
  createHash("sha256")
    .update(read(manifest.publicGeneratorProof.path))
    .digest("hex");
manifest.freshVolcengineRound = {
  id: "volcengine-public139-20261103",
  taskCount: 36,
  firstRunCount: 9,
  repeatPreviouslyAccepted: true,
  historicalScoresUnchanged: true,
  formalSample: false,
};
const options = (changed = {}) => ({
  provider: "volcengine",
  packageSet: "latest",
  packageBinding: {
    bytes: Buffer.from(JSON.stringify(manifest)),
    versions: manifest.versions,
  },
  hosts: "all",
  entries: "all",
  sampleIds: undefined,
  revisionBinding: null,
  runAttempt: 1,
  credentialPresent: true,
  repositoryRoot,
  ...changed,
});

test("fresh Volcengine round requires explicit full scope, original inputs, verified packages and its dedicated key", () => {
  assert.equal(
    assertFreshVolcengineRound(options()).binding.distribution,
    "mixed-public-and-official-artifact",
  );
  for (const changed of [
    { provider: "openai" },
    { packageSet: "frozen" },
    { hosts: "linux" },
    { entries: "cli" },
    { sampleIds: ["verify-08"] },
    { revisionBinding: {} },
    { runAttempt: 2 },
    { credentialPresent: false },
  ]) {
    assert.throws(() => assertFreshVolcengineRound(options(changed)));
  }
  for (const change of [
    (m) => delete m.freshVolcengineRound,
    (m) => (m.freshVolcengineRound.taskCount = 35),
    (m) => (m.freshVolcengineRound.historicalScoresUnchanged = false),
    (m) => (m.publicGeneratorProof.digest = "sha256:" + "0".repeat(64)),
  ]) {
    const copy = structuredClone(manifest);
    change(copy);
    assert.throws(() =>
      assertFreshVolcengineRound(
        options({
          packageBinding: {
            bytes: Buffer.from(JSON.stringify(copy)),
            versions: copy.versions,
          },
        }),
      ),
    );
  }
});

test("fresh Volcengine matrix covers all 36+9 exactly once and isolates every JetBrains sample", () => {
  const plan = JSON.parse(
    read("docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json"),
  );
  const rows = [
    ["win32", "windows-latest"],
    ["linux", "ubuntu-24.04"],
    ["darwin", "macos-15"],
  ].flatMap(([platform, os]) =>
    ["cli", "vscode", "jetbrains"].map((entry) => ({
      group: `${platform}-${entry}`,
      os,
      entry,
    })),
  );
  assert.equal(nativeProviderCells(rows, plan), rows);
  const cells = nativeProviderCells(rows, plan, undefined, "volcengine", {
    isolateJetbrains: true,
  });
  assert.equal(cells.length, 21);
  const samples = cells.flatMap((row) =>
    selectNativeSamples(
      plan,
      row.group.split("-")[0],
      row.entry,
      row.sample_ids ? row.sample_ids.split(",") : undefined,
    ),
  );
  assert.equal(new Set(samples.map((s) => s.id)).size, 45);
  assert.equal(samples.filter((s) => s.kind === "task").length, 36);
  assert.equal(samples.filter((s) => s.kind === "first-run").length, 9);
  assert.equal(cells.filter((c) => c.entry === "jetbrains").length, 15);
  assert.ok(
    cells
      .filter((c) => c.entry === "jetbrains")
      .every((c) => c.sample_count === 1 && c.sample_ids),
  );
});

test("real workflow selector admits only the authorized fresh round without network calls", (t) => {
  const workflow = read(
    ".github/workflows/verify01-native-task-campaign.yml",
  ).toString("utf8");
  const script = workflow.match(
    /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/u,
  )?.[1];
  assert.ok(script);
  const packageFile = `docs/research/cli/verify01-package-sets/offline-volc-${randomUUID()}.json`;
  const output = path.join(os.tmpdir(), `cc-volc-selector-${randomUUID()}.txt`);
  fs.writeFileSync(
    path.join(repositoryRoot, packageFile),
    JSON.stringify(manifest),
    { flag: "wx" },
  );
  t.after(() => {
    fs.rmSync(path.join(repositoryRoot, packageFile), { force: true });
    fs.rmSync(output, { force: true });
  });
  const run = (overrides = {}) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `globalThis.fetch = async url => ({ok: true, json: async () => ({version: String(url).includes('registry.npmjs.org') ? '0.166.139' : '0.37.175'})});\n${script}`,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          NATIVE_PROVIDER: "volcengine",
          NATIVE_PACKAGE_SET_FILE: packageFile,
          NATIVE_PROJECT_REVISION_FILE: "",
          PACKAGE_SET_SELECTION: "latest",
          FRESH_VOLCENGINE_ROUND: "true",
          VOLCENGINE_CREDENTIAL_PRESENT: "true",
          HOST_SELECTION: "all",
          ENTRY_SELECTION: "all",
          SAMPLE_SELECTION: "",
          DELIVERY_RUN: "",
          DELIVERY_COMMIT: "",
          FETCH_DIAGNOSTICS: "false",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_OUTPUT: output,
          ...overrides,
        },
      },
    );
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
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
  const cells = JSON.parse(fields.matrix).include;
  assert.equal(cells.length, 21);
  assert.equal(
    cells.reduce((n, c) => n + c.sample_count, 0),
    45,
  );
  assert.equal(JSON.parse(fields.acceptance_matrix).include.length, 21);
  for (const changed of [
    { VOLCENGINE_CREDENTIAL_PRESENT: "false" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { HOST_SELECTION: "macos" },
    { FRESH_VOLCENGINE_ROUND: "false" },
  ]) {
    assert.notEqual(run(changed).status, 0);
  }
});
