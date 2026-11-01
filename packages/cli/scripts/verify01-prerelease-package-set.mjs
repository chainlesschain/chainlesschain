#!/usr/bin/env node
/** Explicit prepublication artifacts. Public package selection never falls back here. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repository = "chainlesschain/chainlesschain";
const schema = "chainlesschain.verify01-prerelease-package-set/v1";
const workflow = ".github/workflows/verify01-prerelease-packages.yml";
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const integrity = (bytes) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
export function prereleasePackageBinding(manifest) {
  const binding = manifest?.prepublication;
  if (binding === undefined) return null;
  assert.equal(binding.schema, schema);
  assert.equal(binding.repository, repository);
  assert.equal(binding.workflow, workflow);
  assert.equal(binding.distribution, "prerelease-actions-artifact");
  assert.match(binding.sourceCommit ?? "", /^[a-f0-9]{40}$/u);
  assert.equal(
    binding.artifactName,
    `verify01-prerelease-packages-${binding.sourceCommit}`,
  );
  assert.match(binding.artifactDigest ?? "", /^sha256:[a-f0-9]{64}$/u);
  for (const key of ["runId", "artifactId"])
    assert.ok(Number.isSafeInteger(binding[key]) && binding[key] > 0);
  assert.equal(binding.contextWindowTokens, 32768);
  assert.equal(binding.published, false);
  assert.deepEqual(Object.keys(binding.files).sort(), [
    "cli",
    "jetbrains",
    "vscode",
  ]);
  for (const name of ["cli", "vscode", "jetbrains"]) {
    const item = binding.files[name];
    const extension = { cli: "tgz", vscode: "vsix", jetbrains: "zip" }[name];
    assert.match(
      item.file ?? "",
      new RegExp(`^[A-Za-z0-9._-]+\\.${extension}$`, "u"),
    );
    assert.ok(
      item.file.includes(manifest.versions[name]),
      "candidate filename must contain its exact version",
    );
    assert.match(item.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
    assert.match(item.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/u);
    assert.ok(
      Number.isSafeInteger(item.bytes) &&
        item.bytes > 100000 &&
        item.bytes < 128 * 1024 * 1024,
    );
  }
  assert.ok(
    Array.isArray(binding.cliSourceFiles) && binding.cliSourceFiles.length >= 3,
  );
  const paths = new Set();
  for (const item of binding.cliSourceFiles) {
    assert.match(item.file, /^(?:src|bin)\/[A-Za-z0-9_./-]+\.(?:js|cjs|mjs)$/u);
    assert.ok(!item.file.split("/").includes("..") && !paths.has(item.file));
    paths.add(item.file);
    assert.match(item.digest, /^sha256:[a-f0-9]{64}$/u);
  }
  for (const required of [
    "src/runtime/agent-core.js",
    "src/lib/read-file-loop-guard.js",
    "src/lib/coding-change-review-context.js",
  ])
    assert.ok(paths.has(required));
  return structuredClone(binding);
}

export function verifyPrereleaseArtifactMetadata(binding, run, artifact) {
  assert.equal(run.id, binding.runId);
  assert.equal(run.head_sha, binding.sourceCommit);
  assert.equal(run.path, workflow);
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.equal(run.repository.full_name, repository);
  assert.equal(artifact.id, binding.artifactId);
  assert.equal(artifact.name, binding.artifactName);
  assert.equal(artifact.digest, binding.artifactDigest);
  assert.equal(artifact.expired, false);
  assert.equal(artifact.workflow_run.id, binding.runId);
  assert.equal(artifact.workflow_run.head_sha, binding.sourceCommit);
  assert.equal(artifact.workflow_run.repository_id, run.repository.id);
}

function regularFile(root, name) {
  assert.ok(path.isAbsolute(root) && !/[\\/]/u.test(name));
  const parent = fs.lstatSync(root);
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink());
  const file = path.join(root, name),
    stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  return file;
}
export function readPrereleasePackages(manifest, directory) {
  const binding = prereleasePackageBinding(manifest);
  if (!binding) {
    assert.ok(!directory, "candidate directory requires committed identity");
    return null;
  }
  assert.ok(
    directory && path.isAbsolute(directory),
    "bound candidate package directory required",
  );
  const proof = JSON.parse(
    fs.readFileSync(regularFile(directory, "bundle.json"), "utf8"),
  );
  assert.equal(proof.schema, "chainlesschain.verify01-prerelease-bundle/v1");
  assert.equal(proof.sourceCommit, binding.sourceCommit);
  assert.equal(proof.runId, binding.runId);
  assert.equal(proof.published, false);
  assert.deepEqual(proof.versions, manifest.versions);
  assert.deepEqual(proof.files, binding.files);
  assert.deepEqual(proof.cliSourceFiles, binding.cliSourceFiles);
  const provenance = JSON.parse(
    fs.readFileSync(regularFile(directory, "provenance.json"), "utf8"),
  );
  verifyPrereleaseArtifactMetadata(
    binding,
    provenance.run,
    provenance.artifact,
  );
  const files = {};
  for (const [name, record] of Object.entries(binding.files)) {
    const file = regularFile(directory, record.file),
      bytes = fs.readFileSync(file);
    assert.equal(bytes.length, record.bytes);
    assert.equal(digest(bytes), record.digest);
    assert.equal(integrity(bytes), record.integrity);
    files[name] = file;
  }
  return { binding, files };
}
export function verifyPrereleaseCliInstallation(binding, lock, installedRoot) {
  const locked = lock.packages?.["node_modules/chainlesschain"];
  assert.ok(locked && !locked.link);
  assert.equal(locked.integrity, binding.files.cli.integrity);
  assert.match(locked.resolved ?? "", /^file:/u);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"),
  );
  assert.equal(locked.version, manifest.version);
  assert.ok(binding.files.cli.file.includes(manifest.version));
  for (const item of binding.cliSourceFiles) {
    const file = path.join(installedRoot, ...item.file.split("/"));
    assert.ok(
      fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),
    );
    assert.equal(
      digest(fs.readFileSync(file)),
      item.digest,
      `installed candidate source differs: ${item.file}`,
    );
  }
  return {
    distribution: binding.distribution,
    sourceCommit: binding.sourceCommit,
    runId: binding.runId,
    artifactId: binding.artifactId,
    locked,
    sourceFilesVerified: binding.cliSourceFiles.length,
    published: false,
  };
}

async function download(manifestFile, outputDirectory) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const binding = prereleasePackageBinding(manifest);
  if (!binding) return;
  const runCommand = promisify(execFile);
  const execute = async (args) => {
    try {
      return await runCommand("gh", args, {
        windowsHide: true,
        timeout: 120000,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      throw new Error("Prerelease artifact metadata or download failed");
    }
  };
  const api = async (route) =>
    JSON.parse((await execute(["api", `repos/${repository}/${route}`])).stdout);
  const [run, artifact] = await Promise.all([
    api(`actions/runs/${binding.runId}`),
    api(`actions/artifacts/${binding.artifactId}`),
  ]);
  verifyPrereleaseArtifactMetadata(binding, run, artifact);
  assert.ok(
    !fs.existsSync(outputDirectory),
    "candidate download directory must be new",
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  await execute([
    "run",
    "download",
    String(binding.runId),
    "--repo",
    repository,
    "--name",
    binding.artifactName,
    "--dir",
    outputDirectory,
  ]);
  fs.writeFileSync(
    path.join(outputDirectory, "provenance.json"),
    JSON.stringify({ run, artifact }, null, 2) + "\n",
    { flag: "wx" },
  );
  readPrereleasePackages(manifest, path.resolve(outputDirectory));
  if (process.env.GITHUB_ENV) {
    const directory = path.resolve(outputDirectory);
    assert.ok(!/[\r\n]/u.test(directory));
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      `CC_VERIFY01_PRERELEASE_DIRECTORY=${directory}\n`,
    );
  }
  console.log(
    JSON.stringify({
      sourceCommit: binding.sourceCommit,
      runId: binding.runId,
      artifactId: binding.artifactId,
      distribution: binding.distribution,
      published: false,
    }),
  );
}
export function createPrereleaseBundle(
  outputDirectory,
  { sourceCommit, runId } = {},
) {
  assert.match(sourceCommit ?? "", /^[a-f0-9]{40}$/u);
  assert.ok(Number.isSafeInteger(runId) && runId > 0);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const read = (relative) =>
    JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  const versions = {
    cli: read("packages/cli/package.json").version,
    vscode: read("packages/vscode-extension/package.json").version,
    jetbrains: fs
      .readFileSync(
        path.join(
          root,
          "packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml",
        ),
        "utf8",
      )
      .match(/^\s*<version>([^<]+)<\/version>\s*$/mu)?.[1],
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  };
  const names = {
    cli: `chainlesschain-${versions.cli}.tgz`,
    vscode: `chainlesschain-ide-${versions.vscode}.vsix`,
    jetbrains: `chainlesschain-ide-bridge-${versions.jetbrains}.zip`,
  };
  const files = Object.fromEntries(
    Object.entries(names).map(([name, file]) => {
      const bytes = fs.readFileSync(
        regularFile(path.resolve(outputDirectory), file),
      );
      return [
        name,
        {
          file,
          digest: digest(bytes),
          integrity: integrity(bytes),
          bytes: bytes.length,
        },
      ];
    }),
  );
  const cliSourceFiles = [
    "bin/chainlesschain.js",
    "src/commands/agent.js",
    "src/runtime/agent-core.js",
    "src/lib/read-file-loop-guard.js",
    "src/lib/coding-change-review-context.js",
    "src/lib/coding-task-guidance.js",
    "src/lib/model-capabilities.js",
    "src/lib/context-memory-kernel/provider-context.js",
  ].map((file) => ({
    file,
    digest: digest(fs.readFileSync(path.join(root, "packages/cli", file))),
  }));
  const proof = {
    schema: "chainlesschain.verify01-prerelease-bundle/v1",
    sourceCommit,
    runId,
    versions,
    files,
    cliSourceFiles,
    published: false,
  };
  fs.writeFileSync(
    path.join(outputDirectory, "bundle.json"),
    JSON.stringify(proof, null, 2) + "\n",
    { flag: "wx" },
  );
  return proof;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.equal(process.argv.length, 4);
  if (process.argv[2] === "--create")
    console.log(
      JSON.stringify(
        createPrereleaseBundle(process.argv[3], {
          sourceCommit: process.env.GITHUB_SHA,
          runId: Number(process.env.GITHUB_RUN_ID),
        }),
      ),
    );
  else await download(process.argv[2], process.argv[3]);
}
