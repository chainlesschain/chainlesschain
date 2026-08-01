"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const {
  findDiagnosticLogs,
  parseArgs,
  resolveVsCodeHostVersion,
} = require("./extension-host/run.cjs");

const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-vscode-host-runner-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extension-host runner accepts an explicit evidence directory", () => {
  assert.deepEqual(
    parseArgs([
      "--vsix",
      "release.vsix",
      "--vscode-version",
      "1.85.2",
      "--artifact-dir",
      "reports/stable",
    ]),
    {
      vsix: "release.vsix",
      vscodeVersion: "1.85.2",
      workDir: null,
      artifactDir: "reports/stable",
      help: false,
    },
  );
});

test("extension-host runner resolves the downloaded host's exact version", () => {
  const root = temporaryRoot();
  const executable = path.join(root, "VSCode-linux-x64", "bin", "code");
  const packageJson = path.join(
    root,
    "VSCode-linux-x64",
    "resources",
    "app",
    "package.json",
  );
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(path.dirname(packageJson), { recursive: true });
  fs.writeFileSync(executable, "", "utf8");
  fs.writeFileSync(packageJson, JSON.stringify({ version: "1.110.3" }), "utf8");

  assert.equal(resolveVsCodeHostVersion(executable, "stable"), "1.110.3");
  assert.equal(resolveVsCodeHostVersion(executable, "1.85.2"), "1.110.3");
});

test("diagnostic discovery is limited to release-relevant host logs", () => {
  const root = temporaryRoot();
  const logs = path.join(root, "user-data", "logs", "window1");
  fs.mkdirSync(logs, { recursive: true });
  for (const name of [
    "exthost.log",
    "renderer.log",
    "ChainlessChain IDE.log",
    "unrelated.log",
  ]) {
    fs.writeFileSync(path.join(logs, name), name, "utf8");
  }

  assert.deepEqual(
    findDiagnosticLogs(root).map((file) => path.basename(file)),
    ["ChainlessChain IDE.log", "exthost.log", "renderer.log"],
  );
});
