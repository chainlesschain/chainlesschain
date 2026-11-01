import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  prereleasePackageBinding,
  verifyPrereleaseArtifactMetadata,
  readPrereleasePackages,
  verifyPrereleaseCliInstallation,
} from "../scripts/verify01-prerelease-package-set.mjs";
import { openAiNativeCliLauncher } from "../scripts/verify01-openai-transport-preload.mjs";
import { assertNativePackageSet } from "../scripts/verify01-native-task-checker.mjs";
import {
  loadNativePackageSet,
  verifyNativePrereleaseInstall,
} from "../scripts/verify01-native-task-campaign.mjs";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const integrity = (value) =>
  `sha512-${createHash("sha512").update(value).digest("base64")}`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-prerelease-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const versions = {
    cli: "0.166.137",
    vscode: "0.37.174",
    jetbrains: "0.4.190",
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  };
  const names = {
    cli: `cli-${versions.cli}.tgz`,
    vscode: `ide-${versions.vscode}.vsix`,
    jetbrains: `ide-${versions.jetbrains}.zip`,
  };
  const files = Object.fromEntries(
    Object.entries(names).map(([name, file], index) => {
      const bytes = Buffer.alloc(100001, index + 1);
      fs.writeFileSync(path.join(root, file), bytes);
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
    "src/runtime/agent-core.js",
    "src/lib/read-file-loop-guard.js",
    "src/lib/coding-change-review-context.js",
  ].map((file) => ({ file, digest: digest(`// ${file}\n`) }));
  const binding = {
    schema: "chainlesschain.verify01-prerelease-package-set/v1",
    distribution: "prerelease-actions-artifact",
    repository: "chainlesschain/chainlesschain",
    workflow: ".github/workflows/verify01-prerelease-packages.yml",
    sourceCommit: "a".repeat(40),
    runId: 123,
    artifactId: 456,
    artifactName: `verify01-prerelease-packages-${"a".repeat(40)}`,
    artifactDigest: `sha256:${"b".repeat(64)}`,
    contextWindowTokens: 32768,
    files,
    cliSourceFiles,
    published: false,
  };
  const manifest = {
    schema: "chainlesschain.native-package-set/v1",
    versions,
    prepublication: binding,
  };
  const run = {
    id: 123,
    head_sha: binding.sourceCommit,
    path: binding.workflow,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    repository: { full_name: binding.repository, id: 42 },
  };
  const artifact = {
    id: 456,
    name: binding.artifactName,
    digest: binding.artifactDigest,
    expired: false,
    workflow_run: {
      id: 123,
      head_sha: binding.sourceCommit,
      repository_id: 42,
    },
  };
  const proof = {
    schema: "chainlesschain.verify01-prerelease-bundle/v1",
    sourceCommit: binding.sourceCommit,
    runId: 123,
    versions,
    files,
    cliSourceFiles,
    published: false,
  };
  const save = () => {
    fs.writeFileSync(path.join(root, "bundle.json"), JSON.stringify(proof));
    fs.writeFileSync(
      path.join(root, "provenance.json"),
      JSON.stringify({ run, artifact }),
    );
  };
  save();
  return { root, manifest, binding, run, artifact, proof, save };
}

test("public selection remains unchanged and rejects an unbound candidate directory", () => {
  assert.equal(prereleasePackageBinding({ versions: {} }), null);
  assert.equal(readPrereleasePackages(null), null);
  assert.throws(() => readPrereleasePackages(null, os.tmpdir()));
});
test("candidate manifests fail closed on missing, escaping or substituted identities", (t) => {
  const { manifest, binding } = fixture(t);
  assert.deepEqual(prereleasePackageBinding(manifest), binding);
  for (const mutate of [
    (b) => {
      b.published = true;
    },
    (b) => {
      b.workflow = ".github/workflows/npm-publish.yml";
    },
    (b) => {
      b.sourceCommit = "unbound";
    },
    (b) => {
      b.contextWindowTokens = 1050000;
    },
    (b) => {
      b.files.cli.file = "../cli-0.166.137.tgz";
    },
    (b) => {
      b.files.cli.integrity = "sha512-invalid";
    },
    (b) => {
      delete b.files.jetbrains;
    },
    (b) => {
      b.cliSourceFiles.splice(0, 1);
    },
  ]) {
    const m = structuredClone(manifest);
    mutate(m.prepublication);
    assert.throws(() => prereleasePackageBinding(m));
  }
});
test("artifact evidence requires the exact successful build run and source", (t) => {
  const { binding, run, artifact } = fixture(t);
  assert.doesNotThrow(() =>
    verifyPrereleaseArtifactMetadata(binding, run, artifact),
  );
  for (const mutate of [
    (r) => {
      r.head_sha = "c".repeat(40);
    },
    (r) => {
      r.path = ".github/workflows/ide-extensions.yml";
    },
    (r) => {
      r.conclusion = "failure";
    },
    (r) => {
      r.event = "push";
    },
    (r) => {
      r.id = 999;
    },
  ]) {
    const r = structuredClone(run);
    mutate(r);
    assert.throws(() => verifyPrereleaseArtifactMetadata(binding, r, artifact));
  }
  const other = structuredClone(artifact);
  other.workflow_run.head_sha = "c".repeat(40);
  assert.throws(() => verifyPrereleaseArtifactMetadata(binding, run, other));
});
test("original candidate bytes, bundle source and build provenance are all required", (t) => {
  const f = fixture(t);
  assert.deepEqual(
    readPrereleasePackages(f.manifest, f.root).binding,
    f.binding,
  );
  f.proof.sourceCommit = "c".repeat(40);
  f.save();
  assert.throws(() => readPrereleasePackages(f.manifest, f.root));
  f.proof.sourceCommit = f.binding.sourceCommit;
  f.save();
  const file = path.join(f.root, f.binding.files.vscode.file);
  const bytes = fs.readFileSync(file);
  bytes[0] ^= 1;
  fs.writeFileSync(file, bytes);
  assert.throws(() => readPrereleasePackages(f.manifest, f.root));
});
test("candidate installation verifies actual source and the npm tarball integrity", (t) => {
  const { root, binding, manifest } = fixture(t);
  const installed = path.join(root, "installed");
  fs.mkdirSync(installed);
  fs.writeFileSync(
    path.join(installed, "package.json"),
    JSON.stringify({ version: manifest.versions.cli }),
  );
  for (const item of binding.cliSourceFiles) {
    const file = path.join(installed, item.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `// ${item.file}\n`);
  }
  const lock = {
    packages: {
      "node_modules/chainlesschain": {
        version: manifest.versions.cli,
        resolved: "file:../cli-0.166.137.tgz",
        integrity: binding.files.cli.integrity,
      },
    },
  };
  const hostInstall = path.join(root, "host-install");
  fs.mkdirSync(path.join(hostInstall, "node_modules"), { recursive: true });
  fs.renameSync(
    installed,
    path.join(hostInstall, "node_modules/chainlesschain"),
  );
  const realInstalled = path.join(hostInstall, "node_modules/chainlesschain");
  fs.writeFileSync(
    path.join(hostInstall, "package-lock.json"),
    JSON.stringify(lock),
  );
  const reused = verifyNativePrereleaseInstall(binding, hostInstall, {
    reusedHostInstallation: true,
    independentProfile: true,
  });
  assert.equal(reused.passed, true);
  assert.deepEqual(reused.locked, lock.packages["node_modules/chainlesschain"]);
  assert.equal(reused.candidateInstallation.sourceCommit, binding.sourceCommit);
  assert.equal(
    verifyPrereleaseCliInstallation(binding, lock, realInstalled).published,
    false,
  );
  const changed = structuredClone(lock);
  changed.packages["node_modules/chainlesschain"].integrity = "substituted";
  assert.throws(() =>
    verifyPrereleaseCliInstallation(binding, changed, realInstalled),
  );
  fs.appendFileSync(
    path.join(realInstalled, binding.cliSourceFiles[0].file),
    "// substituted",
  );
  assert.throws(() =>
    verifyPrereleaseCliInstallation(binding, lock, realInstalled),
  );
  assert.throws(() =>
    verifyNativePrereleaseInstall(binding, hostInstall, reused),
  );
});
test("independent checker binds candidate package identity to every sample", (t) => {
  const { root, manifest } = fixture(t);
  const file = path.join(root, "packages.json");
  fs.writeFileSync(file, JSON.stringify(manifest));
  const packages = loadNativePackageSet(file);
  const row = {
    sampleId: "verify-13",
    versions: packages.versions,
    packageSetDigest: packages.packageSetDigest,
    prepublication: manifest.prepublication,
  };
  const source = { ...row, samples: [row] };
  assert.doesNotThrow(() => assertNativePackageSet(source, file));
  const changed = structuredClone(source);
  changed.samples[0].prepublication.sourceCommit = "d".repeat(40);
  assert.throws(() => assertNativePackageSet(changed, file));
});
test("all native entries forward the explicit smaller context only for agent calls", (t) => {
  const { root } = fixture(t);
  const cli = path.join(root, "cli.cjs"),
    preload = path.join(root, "preload.mjs"),
    launcher = path.join(root, "launcher.cjs");
  fs.writeFileSync(
    cli,
    "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
  );
  fs.writeFileSync(preload, "");
  fs.writeFileSync(
    launcher,
    openAiNativeCliLauncher(cli, preload, { contextWindowTokens: 32768 }),
  );
  for (const command of ["agent", "config"]) {
    const r = spawnSync(
      process.execPath,
      [launcher, command, "--max-turns", "20"],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [
      command,
      "--max-turns",
      "20",
      ...(command === "agent" ? ["--context-window", "32768"] : []),
    ]);
  }
});

test("the actual candidate download command expands the manifest on Windows and POSIX", (t) => {
  const { root } = fixture(t);
  const workflow = fs.readFileSync(
    new URL(
      "../../../.github/workflows/verify01-native-task-campaign.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const step = workflow
    .split(
      "- name: Download and verify explicitly selected prerelease CLI and IDE packages",
    )[1]
    .split(
      "- name: Run original project tasks through installed native entry",
    )[0];
  const run = step
    .split("run: >-")[1]
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .join(" ")
    .replace(
      "node packages/cli/scripts/verify01-prerelease-package-set.mjs",
      "node argv-probe.cjs",
    )
    .replaceAll("${{ runner.temp }}", root);
  fs.writeFileSync(
    path.join(root, "argv-probe.cjs"),
    "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
  );
  const manifest =
    "docs/research/cli/verify01-package-sets/fixture-candidate.json";
  const execute = (shell) => {
    const bash =
      process.platform === "win32"
        ? path.join(
            process.env.ProgramFiles || "C:\\Program Files",
            "Git/bin/bash.exe",
          )
        : "bash";
    const executable =
      shell === "bash"
        ? bash
        : process.platform === "win32"
          ? "powershell.exe"
          : "bash";
    const args =
      shell === "bash" || process.platform !== "win32"
        ? ["--noprofile", "--norc", "-c", run]
        : ["-NoProfile", "-NonInteractive", "-Command", run];
    return spawnSync(executable, args, {
      cwd: root,
      env: { ...process.env, NATIVE_PACKAGE_SET_FILE: manifest },
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
    });
  };
  const configured = step.match(/^[ \t]+shell: ([^\r\n]+)/mu)?.[1].trim();
  const actual = execute(configured);
  assert.equal(actual.status, 0, actual.stderr);
  const args = JSON.parse(actual.stdout);
  assert.equal(args[0], manifest);
  assert.equal(
    path.resolve(args[1]),
    path.join(root, "verify01-prerelease-packages"),
  );
  if (process.platform === "win32") {
    const omitted = execute(undefined);
    assert.equal(omitted.status, 0, omitted.stderr);
    assert.notEqual(
      JSON.parse(omitted.stdout)[0],
      manifest,
      "PowerShell does not expand a POSIX environment reference",
    );
  }
});
