import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyInstalledEvolutionRuntime } from "../../packages/cli/scripts/verify-installed-evolution-runtime.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-installed-evolution-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source", "packages", "cli");
  const sdkSource = path.join(root, "source", "packages", "personal-data-hub");
  const installedRoot = path.join(
    root,
    "global",
    "node_modules",
    "chainlesschain",
  );
  const sdkInstalled = path.join(
    installedRoot,
    "node_modules",
    "@chainlesschain",
    "personal-data-hub",
  );
  function write(directory, relative, value) {
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
  const cliManifest = {
    name: "chainlesschain",
    version: "1.0.0",
    type: "module",
    dependencies: { "@chainlesschain/personal-data-hub": "1.0.0" },
  };
  const sdkManifest = {
    name: "@chainlesschain/personal-data-hub",
    version: "1.0.0",
    type: "commonjs",
    exports: {
      "./llm-client": "./lib/llm-client.js",
      "./model-egress-guard": "./lib/model-egress-guard.js",
      "./bridges/cc-llm-adapter": "./lib/bridges/cc-llm-adapter.js",
    },
  };
  for (const directory of [sourceRoot, installedRoot]) {
    write(directory, "package.json", JSON.stringify(cliManifest));
    for (const file of [
      "src/lib/evolution/composition.js",
      "src/runtime/agent-core.js",
      "src/harness/prompt-compressor.js",
      "src/lib/hub-llm-client.js",
      "src/lib/remote-read-loop-guard.js",
    ])
      write(directory, file, "export const governed = true;\n");
  }
  for (const directory of [sdkSource, sdkInstalled]) {
    write(directory, "package.json", JSON.stringify(sdkManifest));
    for (const file of Object.values(sdkManifest.exports))
      write(directory, file, "module.exports = { governed: true };\n");
  }
  return { root, sourceRoot, installedRoot, sdkSource, sdkInstalled, write };
}

test("accepts byte-identical physical installed CLI and resolved SDK", (t) => {
  const target = fixture(t);
  const result = verifyInstalledEvolutionRuntime(target);
  assert.equal(result.cli.files, 5);
  assert.equal(result.sdk.files, 3);
  assert.equal(result.sdk.root, fs.realpathSync.native(target.sdkInstalled));
  assert.match(result.cli.digest, /^[a-f0-9]{64}$/);
});

for (const [label, file, contents] of [
  ["changed CLI guard", "src/lib/evolution/composition.js", "bypass"],
  ["additional executable", "src/runtime/extra.js", "unexpected"],
])
  test(`rejects ${label} despite matching package version`, (t) => {
    const target = fixture(t);
    target.write(target.installedRoot, file, contents);
    assert.throws(
      () => verifyInstalledEvolutionRuntime(target),
      /runtime differs/,
    );
  });

test("rejects an old nested SDK even when a current sibling SDK is installed", (t) => {
  const target = fixture(t);
  const sibling = path.join(
    path.dirname(target.installedRoot),
    "@chainlesschain",
    "personal-data-hub",
  );
  fs.cpSync(target.sdkSource, sibling, { recursive: true });
  target.write(target.sdkInstalled, "lib/model-egress-guard.js", "old guard");
  assert.throws(
    () => verifyInstalledEvolutionRuntime(target),
    /runtime differs/,
  );
});

test("rejects an SDK shadowing the actual governed Hub consumer", (t) => {
  const target = fixture(t);
  const shadow = path.join(
    target.installedRoot,
    "src/lib/node_modules/@chainlesschain/personal-data-hub",
  );
  fs.cpSync(target.sdkSource, shadow, { recursive: true });
  target.write(shadow, "lib/model-egress-guard.js", "old shadow guard");
  assert.throws(
    () => verifyInstalledEvolutionRuntime(target),
    /runtime differs/,
  );
});

test("accepts the current physical SDK hoisted beside the global CLI", (t) => {
  const target = fixture(t);
  const sibling = path.join(
    path.dirname(target.installedRoot),
    "@chainlesschain/personal-data-hub",
  );
  fs.mkdirSync(path.dirname(sibling), { recursive: true });
  fs.renameSync(target.sdkInstalled, sibling);
  const result = verifyInstalledEvolutionRuntime(target);
  assert.equal(result.sdk.root, fs.realpathSync.native(sibling));
});

test("rejects missing installed modules", (t) => {
  const target = fixture(t);
  fs.unlinkSync(path.join(target.installedRoot, "src/runtime/agent-core.js"));
  assert.throws(
    () => verifyInstalledEvolutionRuntime(target),
    /runtime is empty/,
  );
});

test("rejects package version drift", (t) => {
  const target = fixture(t);
  const file = path.join(target.installedRoot, "package.json");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  value.version = "0.9.0";
  fs.writeFileSync(file, JSON.stringify(value));
  assert.throws(
    () => verifyInstalledEvolutionRuntime(target),
    /version differs/,
  );
});

test("rejects a target inside the source checkout", (t) => {
  const target = fixture(t);
  assert.throws(
    () =>
      verifyInstalledEvolutionRuntime({
        ...target,
        installedRoot: target.sourceRoot,
      }),
    /resolves into checkout/,
  );
});

test("rejects linked package roots", (t) => {
  const target = fixture(t);
  const alias = path.join(target.root, "cli-alias");
  fs.symlinkSync(target.installedRoot, alias, "junction");
  assert.throws(
    () => verifyInstalledEvolutionRuntime({ ...target, installedRoot: alias }),
    /physical directory/,
  );
});

test("rejects runtime directory links back to source", (t) => {
  const target = fixture(t);
  const runtime = path.join(target.installedRoot, "src/runtime");
  fs.rmSync(runtime, { recursive: true });
  fs.symlinkSync(
    path.join(target.sourceRoot, "src/runtime"),
    runtime,
    "junction",
  );
  assert.throws(() => verifyInstalledEvolutionRuntime(target), /symlink/);
});

test("rejects hard-linked runtime files", (t) => {
  const target = fixture(t);
  const relative = "src/lib/evolution/composition.js";
  fs.unlinkSync(path.join(target.installedRoot, relative));
  fs.linkSync(
    path.join(target.sourceRoot, relative),
    path.join(target.installedRoot, relative),
  );
  assert.throws(() => verifyInstalledEvolutionRuntime(target), /hard link/);
});
