import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nativeProviderCells } from "../scripts/verify01-native-round-matrix.mjs";
import { selectNativeSamples } from "../scripts/verify01-native-task-campaign.mjs";

const plan = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
      import.meta.url,
    ),
    "utf8",
  ),
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

test("OpenAI round covers exactly 36 ordinary and nine first-run samples without sharing JetBrains hosts", () => {
  const cells = nativeProviderCells(rows, plan, undefined, "openai");
  assert.equal(cells.length, 21);
  assert.equal(new Set(cells.map((row) => row.cell_id)).size, 21);
  const samples = cells.flatMap((row) =>
    selectNativeSamples(
      plan,
      row.group.split("-")[0],
      row.entry,
      row.sample_ids ? row.sample_ids.split(",") : undefined,
    ),
  );
  assert.equal(samples.length, 45);
  assert.equal(new Set(samples.map((sample) => sample.id)).size, 45);
  assert.equal(
    samples.filter((sample) => sample.kind === "first-run").length,
    9,
  );
  assert.equal(
    samples.filter((sample) => sample.kind !== "first-run").length,
    36,
  );
  assert.equal(cells.filter((row) => row.entry === "jetbrains").length, 15);
  assert.ok(
    cells
      .filter((row) => row.entry === "jetbrains")
      .every((row) => row.sample_count === 1 && row.sample_ids),
  );
  assert.ok(
    cells
      .filter((row) => row.entry !== "jetbrains")
      .every((row) => row.sample_count === 5),
  );
});

test("existing provider selections retain their exact matrix and explicit sample scope", () => {
  assert.equal(nativeProviderCells(rows, plan), rows);
  const selected = rows.filter((row) => row.group === "win32-jetbrains");
  const cells = nativeProviderCells(selected, plan, ["verify-03"], "openai");
  assert.equal(cells.length, 1);
  assert.equal(cells[0].sample_ids, "verify-03");
  assert.equal(cells[0].sample_count, 1);
  assert.throws(() =>
    nativeProviderCells(selected, plan, ["verify-01"], "openai"),
  );
  assert.throws(() =>
    nativeProviderCells(
      [{ ...selected[0], entry: "cli" }],
      plan,
      undefined,
      "openai",
    ),
  );
});

test("manual OpenAI selector binds all cells to current packages, a dedicated key and one live attempt", (t) => {
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const workflow = fs.readFileSync(
    path.join(
      repository,
      ".github/workflows/verify01-native-task-campaign.yml",
    ),
    "utf8",
  );
  const script = workflow.match(
    /node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/u,
  )?.[1];
  assert.ok(script);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-openai-selector-"));
  const relativeManifest = `docs/research/cli/verify01-package-sets/offline-unit-openai-${randomUUID()}.json`;
  const manifestPath = path.join(repository, relativeManifest);
  const versions = {
    cli: JSON.parse(
      fs.readFileSync(
        path.join(repository, "packages/cli/package.json"),
        "utf8",
      ),
    ).version,
    vscode: JSON.parse(
      fs.readFileSync(
        path.join(repository, "packages/vscode-extension/package.json"),
        "utf8",
      ),
    ).version,
    jetbrains: fs
      .readFileSync(
        path.join(
          repository,
          "packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml",
        ),
        "utf8",
      )
      .match(/^\s*<version>([^<]+)<\/version>\s*$/mu)[1],
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  };
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schema: "chainlesschain.native-package-set/v1",
      versions,
    }),
    { flag: "wx" },
  );
  t.after(() => {
    fs.rmSync(manifestPath, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const run = (overrides = {}) => {
    const output = path.join(root, randomUUID() + ".txt");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: repository,
        encoding: "utf8",
        env: {
          ...process.env,
          NATIVE_PROVIDER: "openai",
          OPENAI_API_KEY: "offline-placeholder-never-sent",
          HOST_SELECTION: "all",
          ENTRY_SELECTION: "all",
          SAMPLE_SELECTION: "",
          PACKAGE_SET_SELECTION: "latest",
          NATIVE_PACKAGE_SET_FILE: relativeManifest,
          DELIVERY_RUN: "",
          DELIVERY_COMMIT: "",
          FETCH_DIAGNOSTICS: "false",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_OUTPUT: output,
          ...overrides,
        },
      },
    );
    return { ...result, output };
  };
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  const fields = Object.fromEntries(
    fs
      .readFileSync(valid.output, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  const matrix = JSON.parse(fields.matrix).include;
  const acceptance = JSON.parse(fields.acceptance_matrix).include;
  assert.equal(matrix.length, 21);
  assert.equal(acceptance.length, 21);
  assert.equal(new Set(JSON.parse(fields.groups)).size, 9);
  assert.deepEqual(
    acceptance.map((row) => row.cell_id),
    matrix.map((row) => row.cell_id),
  );
  assert.equal(
    matrix.reduce((sum, row) => sum + row.sample_count, 0),
    45,
  );
  assert.match(
    run({ OPENAI_API_KEY: "" }).stderr,
    /Dedicated repository OPENAI_API_KEY/u,
  );
  assert.match(
    run({ GITHUB_RUN_ATTEMPT: "2" }).stderr,
    /Reconcile the previous live attempt/u,
  );
  assert.match(
    run({ PACKAGE_SET_SELECTION: "frozen" }).stderr,
    /explicitly selected public or prerelease packages/u,
  );
  assert.match(
    run({ PACKAGE_SET_SELECTION: "prerelease" }).stderr,
    /explicit committed candidate package identity/u,
  );
});
