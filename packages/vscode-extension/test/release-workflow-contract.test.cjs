"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("JetBrains release hosts use the platform-required Java 21 toolchain", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  const nightly = read(".github/workflows/ide-jetbrains-ui-smoke.yml");
  const build = read("packages/jetbrains-plugin/build.gradle.kts");

  assert.match(workflow, /version: "2024\.2"\s+java: "21"/u);
  assert.match(workflow, /version: "2025\.2"\s+java: "21"/u);
  assert.doesNotMatch(workflow, /java(?:-version)?: "17"/u);
  assert.match(nightly, /java-version: "21"/u);
  assert.match(nightly, /node scripts\/run-ui-host-journey\.mjs/u);
  assert.match(build, /sourceCompatibility = JavaVersion\.VERSION_21/u);
  assert.match(build, /targetCompatibility = JavaVersion\.VERSION_21/u);
  assert.match(build, /jvmToolchain\(21\)/u);
});

test("VS Code credentials are checked before either immutable publish", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  const preflight = workflow.indexOf(
    "- name: Preflight required marketplace credentials",
  );
  const openVsxPublish = workflow.indexOf("- name: Publish to Open VSX");
  const vscodePublish = workflow.indexOf(
    "- name: Publish to VS Code Marketplace",
  );

  assert.ok(preflight > 0, "credential preflight must exist");
  assert.ok(preflight < openVsxPublish, "preflight must precede Open VSX");
  assert.ok(preflight < vscodePublish, "preflight must precede VS Marketplace");
  assert.match(workflow, /OVSX_PAT: \$\{\{ secrets\.OVSX_PAT \}\}/u);
  assert.match(workflow, /VSCE_PAT: \$\{\{ secrets\.VSCE_PAT \}\}/u);
  assert.match(workflow, /@vscode\/vsce@3\.9\.2 verify-pat chainlesschain/u);
});

test("VS Code macOS host gate pins the validated Intel runner image", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  const macGate = workflow.match(
    /vscode-macos-smoke:[\s\S]*?(?=\n  [a-z][a-z0-9-]+:)/u,
  );

  assert.ok(macGate, "macOS host gate job must exist");
  assert.match(macGate[0], /runs-on: macos-15-intel/u);
  assert.doesNotMatch(macGate[0], /runs-on: macos-latest/u);
  assert.match(macGate[0], /@vscode\/test-electron@3\.1\.0/u);
  assert.match(macGate[0], /ws@8\.21\.2/u);
  assert.doesNotMatch(macGate[0], /playwright/u);
  assert.doesNotMatch(macGate[0], /--host-api-only/u);
  const hostRunner = read(
    "packages/vscode-extension/test/extension-host/run.cjs",
  );
  assert.match(
    hostRunner,
    /--disable-features=DevToolsAcceptDebuggingConnections/u,
  );
  assert.match(hostRunner, /ApplicationFirewall\/socketfilterfw/u);
  assert.match(hostRunner, /--unblockapp/u);
  assert.equal(
    macGate[0].match(
      /- name: Extension Host smoke \(macOS (?:stable|minimum 1\.85\.2)\)\n\s+timeout-minutes: 15/gu,
    )?.length,
    2,
    "both real-DOM host gates must fail within a diagnostic step deadline",
  );
  assert.match(
    macGate[0],
    /- name: Upload macOS host journey evidence\n\s+if: always\(\)/u,
  );
  assert.equal(
    workflow.match(/ws@8\.21\.2/gu)?.length,
    3,
    "all three host gates must pin the CDP websocket client",
  );
});
