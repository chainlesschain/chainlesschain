import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseNativeSampleIds,
  selectNativeSamples,
} from "../scripts/verify01-native-task-campaign.mjs";
import { validateNativeSelection } from "../scripts/verify01-native-task-checker.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const plan = JSON.parse(
  fs.readFileSync(
    path.join(
      repository,
      "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
    ),
    "utf8",
  ),
);

test("explicit unfinished sample selection does not add first-run or completed peers", () => {
  assert.deepEqual(
    selectNativeSamples(plan, "win32", "vscode", ["verify-20"]).map(
      (sample) => sample.id,
    ),
    ["verify-20"],
  );
  assert.deepEqual(
    selectNativeSamples(plan, "win32", "jetbrains", [
      "first-run-win32-jetbrains",
    ]).map((sample) => sample.id),
    ["first-run-win32-jetbrains"],
  );
  assert.equal(selectNativeSamples(plan, "win32", "vscode").length, 5);
  for (const ids of [
    [],
    ["verify-20", "verify-20"],
    ["verify-03"],
    ["unknown"],
  ]) {
    assert.throws(() => selectNativeSamples(plan, "win32", "vscode", ids));
  }
});

test("operator sample parser rejects empty and duplicate IDs before paid work", () => {
  assert.equal(parseNativeSampleIds(""), undefined);
  assert.equal(parseNativeSampleIds(undefined), undefined);
  assert.deepEqual(parseNativeSampleIds("verify-20, verify-29"), [
    "verify-20",
    "verify-29",
  ]);
  for (const value of [
    " ",
    "verify-20,",
    ",verify-20",
    "verify-20,verify-20",
    20,
  ])
    assert.throws(() => parseNativeSampleIds(value));
});

function source(ids) {
  return {
    platform: "win32",
    entry: "vscode",
    selectionScope: "operator-subset",
    selectedSampleIds: ids,
    samples: ids.map((sampleId) => ({ sampleId })),
  };
}

test("subset acceptance requires the exact independent operator selection", () => {
  const delivery = source(["verify-20"]);
  assert.equal(
    validateNativeSelection(plan, delivery, ["verify-20"]).length,
    1,
  );
  assert.throws(
    () => validateNativeSelection(plan, delivery),
    /explicit operator/,
  );
  assert.throws(
    () => validateNativeSelection(plan, delivery, ["verify-29"]),
    /differs/,
  );
  assert.throws(() =>
    validateNativeSelection(
      plan,
      {
        ...delivery,
        samples: [{ sampleId: "verify-20" }, { sampleId: "verify-20" }],
      },
      ["verify-20"],
    ),
  );
  assert.throws(
    () =>
      validateNativeSelection(
        plan,
        { ...delivery, selectionScope: "full-native-group" },
        ["verify-20"],
      ),
    /relabeled/,
  );
  assert.throws(() =>
    validateNativeSelection(plan, { ...delivery, selectionScope: "unknown" }, [
      "verify-20",
    ]),
  );
});

test("legacy full-group deliveries remain strict and cannot silently omit samples", () => {
  const samples = selectNativeSamples(plan, "win32", "vscode").map(
    (sample) => ({ sampleId: sample.id }),
  );
  const delivery = { platform: "win32", entry: "vscode", samples };
  assert.equal(validateNativeSelection(plan, delivery).length, 5);
  assert.throws(() =>
    validateNativeSelection(plan, { ...delivery, samples: samples.slice(1) }),
  );
  assert.throws(() =>
    validateNativeSelection(plan, {
      ...delivery,
      selectedSampleIds: ["verify-20"],
    }),
  );
});

test("workflow validates a single matching host and entry before subset dispatch", (t) => {
  const workflow = fs.readFileSync(
    path.join(
      repository,
      ".github/workflows/verify01-native-task-campaign.yml",
    ),
    "utf8",
  );
  const script = workflow.match(
    /node --input-type=module -e '([\s\S]*?)\n          '/,
  )?.[1];
  assert.ok(script, "workflow selector script is required");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-subset-select-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "output.txt");
  const env = {
    ...process.env,
    GITHUB_OUTPUT: output,
    HOST_SELECTION: "windows",
    ENTRY_SELECTION: "jetbrains",
    SAMPLE_SELECTION: "first-run-win32-jetbrains",
    DELIVERY_RUN: "",
    DELIVERY_COMMIT: "",
  };
  const run = (override = {}) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: repository,
      encoding: "utf8",
      env: { ...env, ...override },
    });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  const groups = fs
    .readFileSync(output, "utf8")
    .trim()
    .split("\n")
    .find((line) => line.startsWith("groups="));
  assert.deepEqual(JSON.parse(groups.slice("groups=".length)), [
    "win32-jetbrains",
  ]);
  assert.notEqual(run({ HOST_SELECTION: "all" }).status, 0);
  assert.notEqual(run({ ENTRY_SELECTION: "all" }).status, 0);
  assert.notEqual(run({ SAMPLE_SELECTION: "verify-20" }).status, 0);
});
