#!/usr/bin/env node
// Verify the installed modules that own evolution's private brands before the
// real target-runtime smoke. Version strings alone cannot prove source identity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATHS = [
  "src/lib/evolution",
  "src/runtime",
  "src/harness",
  "src/lib/hub-llm-client.js",
  "src/lib/remote-read-loop-guard.js",
];
const SDK_PATHS = [
  "lib/llm-client.js",
  "lib/model-egress-guard.js",
  "lib/bridges/cc-llm-adapter.js",
];

function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function physicalRoot(directory) {
  assert.ok(
    fs.lstatSync(directory).isDirectory(),
    `package root must be a physical directory: ${directory}`,
  );
  return fs.realpathSync.native(directory);
}

function manifest(root) {
  const file = path.join(root, "package.json");
  assert.ok(fs.lstatSync(file).isFile(), "package manifest must be physical");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fileDigests(root, entries) {
  const files = {};
  function visit(relative) {
    const file = path.join(root, relative);
    const info = fs.lstatSync(file);
    assert.ok(!info.isSymbolicLink(), `runtime symlink is forbidden: ${file}`);
    assert.ok(
      within(root, fs.realpathSync.native(file)),
      "runtime path escaped",
    );
    if (info.isDirectory()) {
      for (const child of fs.readdirSync(file).sort())
        visit(path.join(relative, child));
      return;
    }
    assert.ok(info.isFile(), `runtime entry must be a regular file: ${file}`);
    assert.equal(info.nlink, 1, `runtime hard link is forbidden: ${file}`);
    files[relative.split(path.sep).join("/")] = createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
  }
  for (const entry of entries) visit(entry);
  assert.ok(Object.keys(files).length >= entries.length, "runtime is empty");
  return files;
}

function comparePackage(source, installed, entries) {
  const expected = manifest(source);
  const actual = manifest(installed);
  for (const field of [
    "name",
    "version",
    "type",
    "main",
    "exports",
    "dependencies",
  ])
    assert.deepEqual(
      actual[field],
      expected[field],
      `package ${field} differs`,
    );
  const files = fileDigests(source, entries);
  assert.deepEqual(
    fileDigests(installed, entries),
    files,
    `installed ${expected.name} governed runtime differs from checkout`,
  );
  return {
    name: expected.name,
    version: expected.version,
    root: installed,
    files: Object.keys(files).length,
    digest: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
  };
}

export function verifyInstalledEvolutionRuntime({ sourceRoot, installedRoot }) {
  const source = physicalRoot(sourceRoot);
  const installed = physicalRoot(installedRoot);
  const repository = fs.realpathSync.native(path.resolve(source, "../.."));
  assert.ok(
    !within(repository, installed),
    "installed CLI resolves into checkout",
  );
  const cliManifest = manifest(source);
  assert.equal(cliManifest.name, "chainlesschain");
  const sdkName = "@chainlesschain/personal-data-hub";
  const sdkSource = physicalRoot(path.resolve(source, "../personal-data-hub"));
  const sdkManifest = manifest(sdkSource);
  assert.equal(sdkManifest.name, sdkName);
  assert.equal(cliManifest.dependencies[sdkName], sdkManifest.version);

  // Match the production consumer's lookup origin. Resolving at package.json
  // would miss an older SDK under src/lib/node_modules, while resolving from
  // the global prefix could hide any nested copy actually used by the CLI.
  const requireInstalled = createRequire(
    path.join(installed, "src/lib/evolution/governed-hub-llm.js"),
  );
  const sdkEntry = requireInstalled.resolve(`${sdkName}/llm-client`);
  const sdkInstalled = physicalRoot(path.resolve(path.dirname(sdkEntry), ".."));
  assert.ok(
    !within(repository, sdkInstalled),
    "installed SDK resolves into checkout",
  );
  for (const [specifier, relative] of [
    [`${sdkName}/llm-client`, "lib/llm-client.js"],
    [`${sdkName}/model-egress-guard`, "lib/model-egress-guard.js"],
    [`${sdkName}/bridges/cc-llm-adapter`, "lib/bridges/cc-llm-adapter.js"],
  ])
    assert.equal(
      requireInstalled.resolve(specifier),
      path.join(sdkInstalled, relative),
      "installed SDK exports must use one physical governed runtime",
    );
  return {
    schema: "chainlesschain.installed-evolution-runtime/v1",
    cli: comparePackage(source, installed, CLI_PATHS),
    sdk: comparePackage(sdkSource, sdkInstalled, SDK_PATHS),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.ok(
    process.argv[2],
    "usage: verify-installed-evolution-runtime.mjs CLI_ROOT",
  );
  const result = verifyInstalledEvolutionRuntime({
    sourceRoot: fileURLToPath(new URL("..", import.meta.url)),
    installedRoot: process.argv[2],
  });
  console.log(JSON.stringify(result, null, 2));
}
