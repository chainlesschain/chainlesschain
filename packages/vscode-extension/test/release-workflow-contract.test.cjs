"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function workflowJob(workflow, jobId) {
  const normalized = workflow.replace(/\r\n/gu, "\n");
  const marker = `  ${jobId}:\n`;
  const start = normalized.indexOf(marker);
  assert.notEqual(start, -1, `workflow job ${jobId} must exist`);
  const bodyStart = start + marker.length;
  const nextJob = normalized
    .slice(bodyStart)
    .match(/\n {2}[a-z][a-z0-9-]*:\n/u);
  const end = nextJob ? bodyStart + nextJob.index : normalized.length;
  return normalized.slice(start, end);
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

test("every IDE gate checks out and records the exact source commit", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  assert.match(
    workflow,
    /IDE_RELEASE_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.match(
    workflow,
    /CC_RELEASE_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.equal(
    workflow.match(
      /uses: actions\/checkout@(?:v5|fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09)/gu,
    )?.length,
    10,
    "every IDE job must use the pinned checkout action",
  );
  assert.equal(
    workflow.match(/ref: \$\{\{ env\.IDE_RELEASE_COMMIT \}\}/gu)?.length,
    10,
    "every IDE job must check out the explicit source commit",
  );
  assert.equal(
    workflow.match(/--release-commit \$\{\{ env\.IDE_RELEASE_COMMIT \}\}/gu)
      ?.length,
    8,
    "all six local VS Code and two JetBrains host journeys must record that commit",
  );
});

test("VS Code channel credentials are checked before their immutable publishes", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  const openVsxPreflight = workflow.indexOf(
    "- name: Preflight Open VSX credential",
  );
  const vscodePreflight = workflow.indexOf(
    "- name: Preflight VS Code Marketplace credential",
  );
  const openVsxPublish = workflow.indexOf("- name: Publish to Open VSX");
  const vscodePublish = workflow.indexOf(
    "- name: Publish to VS Code Marketplace",
  );

  assert.ok(openVsxPreflight > 0, "Open VSX preflight must exist");
  assert.ok(vscodePreflight > 0, "Marketplace preflight must exist");
  assert.ok(
    openVsxPreflight < openVsxPublish,
    "Open VSX preflight must precede its publish",
  );
  assert.ok(
    vscodePreflight < openVsxPublish,
    "Marketplace backfill credentials must fail before the Open VSX replay",
  );
  assert.ok(
    vscodePreflight < vscodePublish,
    "Marketplace preflight must precede its publish",
  );
  assert.match(workflow, /OVSX_PAT: \$\{\{ secrets\.OVSX_PAT \}\}/u);
  assert.match(workflow, /VSCE_PAT: \$\{\{ secrets\.VSCE_PAT \}\}/u);
  assert.match(workflow, /@vscode\/vsce@3\.9\.2 verify-pat chainlesschain/u);
});

test("one immutable VSIX candidate gates every release host and publisher", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  const packageJob = workflowJob(workflow, "vscode-package");
  const windowsJob = workflowJob(workflow, "vscode-windows-smoke");
  const macosJob = workflowJob(workflow, "vscode-macos-smoke");
  const releaseJob = workflowJob(workflow, "vscode");
  const packageCommand =
    /@vscode\/vsce@3\.9\.2 package --no-dependencies --out chainlesschain-ide\.vsix/gu;

  assert.equal(
    workflow.match(packageCommand)?.length,
    1,
    "the workflow must package the release candidate exactly once",
  );
  assert.match(packageJob, /needs: capability-manifest/u);
  assert.match(packageJob, /npm run test:unit/u);
  assert.match(
    packageJob,
    /vsix-release-artifact\.mjs create\s+chainlesschain-ide\.vsix manifest\.json/u,
  );
  assert.match(packageJob, /name: chainlesschain-ide-vscode-candidate\s/u);
  assert.match(packageJob, /overwrite: true/u);
  assert.match(packageJob, /packages\/vscode-extension\/manifest\.json/u);
  assert.match(
    releaseJob,
    /needs:[\s\S]*?vscode-package,[\s\S]*?vscode-windows-smoke,[\s\S]*?vscode-macos-smoke,[\s\S]*?vscode-remote-ssh-container,[\s\S]*?ide-roadmap-evidence-aggregate,/u,
  );

  for (const [name, job] of [
    ["Windows", windowsJob],
    ["macOS", macosJob],
    ["Linux/publish", releaseJob],
  ]) {
    assert.match(
      job,
      /uses: actions\/download-artifact@v6[\s\S]*?name: chainlesschain-ide-vscode-candidate\s+[\s\S]*?path: packages\/vscode-extension/u,
      `${name} must download the immutable candidate from this workflow run`,
    );
    assert.match(
      job,
      /vsix-release-artifact\.mjs verify\s+chainlesschain-ide\.vsix manifest\.json/u,
      `${name} must verify the downloaded candidate manifest`,
    );
    assert.doesNotMatch(
      job,
      /@vscode\/vsce@3\.9\.2 package/u,
      `${name} must not rebuild the candidate`,
    );
    assert.doesNotMatch(job, /npm run test:unit/u);
  }

  assert.equal(
    releaseJob.match(/vsix-release-artifact\.mjs verify/gu)?.length,
    2,
    "the Linux/publish job must verify the candidate before host gates and again before publishing",
  );
  assert.match(
    releaseJob,
    /Verify immutable candidate manifest before publishing[\s\S]*?Publish to Open VSX/u,
  );
  assert.match(
    windowsJob,
    /name: vscode-windows-host-evidence-\$\{\{ github\.run_attempt \}\}/u,
  );
  assert.match(
    macosJob,
    /name: vscode-macos-host-evidence-\$\{\{ github\.run_attempt \}\}/u,
  );
  assert.match(
    releaseJob,
    /name: vscode-linux-host-evidence-\$\{\{ github\.run_attempt \}\}/u,
  );
});

test("IDE release tags are isolated and manual Marketplace backfill is tag-bound", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  const packageJob = workflowJob(workflow, "vscode-package");
  const windowsJob = workflowJob(workflow, "vscode-windows-smoke");
  const macosJob = workflowJob(workflow, "vscode-macos-smoke");
  const releaseJob = workflowJob(workflow, "vscode");
  const jetbrainsHosts = workflowJob(workflow, "jetbrains-host-matrix");
  const jetbrainsRelease = workflowJob(workflow, "jetbrains");
  const jetbrainsVerify = workflowJob(workflow, "jetbrains-marketplace-verify");

  assert.match(
    workflow,
    /accepted only when the workflow is dispatched against the exact\s+existing ide-vscode-v\* tag/u,
  );
  assert.match(packageJob, /Reject unsafe VS Code Marketplace backfill/u);
  assert.match(
    packageJob,
    /github\.event_name == 'workflow_dispatch' && inputs\.publish_vscode_marketplace/u,
  );
  assert.match(packageJob, /case "\$GITHUB_REF" in/u);
  assert.match(packageJob, /refs\/tags\/ide-vscode-v\?\*\) ;;/u);

  for (const job of [windowsJob, macosJob, releaseJob]) {
    assert.match(
      job,
      /!startsWith\(github\.ref, 'refs\/tags\/ide-jetbrains-v'\)/u,
      "VS Code jobs must skip JetBrains release tags",
    );
  }
  assert.match(
    packageJob,
    /!startsWith\(github\.ref, 'refs\/tags\/ide-jetbrains-v'\)[\s\S]*?github\.event_name == 'workflow_dispatch'/u,
    "the candidate job must still run to reject an invalid manual backfill ref",
  );

  for (const job of [jetbrainsHosts, jetbrainsRelease]) {
    assert.match(
      job,
      /!startsWith\(github\.ref, 'refs\/tags\/ide-vscode-v'\)/u,
      "JetBrains jobs must skip VS Code release tags",
    );
    assert.match(
      job,
      /!\(github\.event_name == 'workflow_dispatch' && inputs\.publish_vscode_marketplace\)/u,
      "JetBrains jobs must skip manual VS Code Marketplace backfills",
    );
  }
  assert.match(
    jetbrainsHosts,
    /name: jetbrains-\$\{\{ runner\.os \}\}-\$\{\{ matrix\.ide\.version \}\}-host-evidence-\$\{\{ github\.run_attempt \}\}/u,
  );
  assert.match(
    jetbrainsRelease,
    /name: chainlesschain-ide-jetbrains-\$\{\{ github\.run_attempt \}\}/u,
  );
  assert.match(
    jetbrainsRelease,
    /github\.event_name == 'push' &&\s+startsWith\(github\.ref, 'refs\/tags\/ide-jetbrains-v'\)/u,
  );
  assert.match(
    jetbrainsVerify,
    /github\.event_name == 'push' &&\s+startsWith\(github\.ref, 'refs\/tags\/ide-jetbrains-v'\)/u,
  );

  const openVsxGuard =
    /startsWith\(github\.ref, 'refs\/tags\/ide-vscode-v'\) &&\s+\(github\.event_name == 'push' \|\|\s+\(github\.event_name == 'workflow_dispatch' &&\s+inputs\.publish_vscode_marketplace\)\)/gu;
  assert.equal(
    workflow.match(openVsxGuard)?.length,
    3,
    "Open VSX preflight, publish, and verification must share the tag-bound release/replay guard",
  );

  const officialBackfillGuard =
    /startsWith\(github\.ref, 'refs\/tags\/ide-vscode-v'\) &&\s+github\.event_name == 'workflow_dispatch' &&\s+inputs\.publish_vscode_marketplace/gu;
  assert.equal(
    workflow.match(officialBackfillGuard)?.length,
    3,
    "official credential preflight, publish, and verification must require an explicit exact-tag backfill",
  );

  const openVsxPublish = releaseJob.indexOf("- name: Publish to Open VSX");
  const openVsxVerify = releaseJob.indexOf("- name: Verify Open VSX listing");
  const vscodePublish = releaseJob.indexOf(
    "- name: Publish to VS Code Marketplace",
  );
  const vscodeVerify = releaseJob.indexOf(
    "- name: Verify VS Code Marketplace listing and exact VSIX",
  );
  assert.ok(openVsxPublish >= 0);
  assert.ok(openVsxPublish < openVsxVerify);
  assert.ok(openVsxVerify < vscodePublish);
  assert.ok(vscodePublish < vscodeVerify);
  assert.match(releaseJob, /ovsx@1\.0\.2 publish --skip-duplicate/u);
  assert.match(
    releaseJob,
    /verify-ide-marketplace\.mjs open-vsx "\$version" --artifact chainlesschain-ide\.vsix/u,
  );
  assert.match(
    releaseJob,
    /CC_MARKETPLACE_VERIFY_ATTEMPTS: "90"[\s\S]*?CC_MARKETPLACE_VERIFY_DELAY_MS: "30000"[\s\S]*?CC_OPEN_VSX_LISTING_VERIFY_ATTEMPTS: "75"[\s\S]*?CC_OPEN_VSX_LISTING_VERIFY_DELAY_MS: "60000"/u,
    "Open VSX readback must use independent activation and one-hour listing-cache budgets",
  );
});

test("VS Code host gates pin macOS Intel and share the main-world relay", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  const windowsGate = workflowJob(workflow, "vscode-windows-smoke");
  const linuxGate = workflowJob(workflow, "vscode");
  const macGate = workflow.match(
    /vscode-macos-smoke:[\s\S]*?(?=\n {2}[a-z][a-z0-9-]+:)/u,
  );

  assert.ok(macGate, "macOS host gate job must exist");
  assert.match(macGate[0], /runs-on: macos-15-intel/u);
  assert.doesNotMatch(macGate[0], /runs-on: macos-latest/u);
  assert.match(macGate[0], /@vscode\/test-electron@3\.1\.0/u);
  assert.doesNotMatch(macGate[0], /ws@8\.21\.2/u);
  assert.doesNotMatch(macGate[0], /playwright/u);
  assert.doesNotMatch(macGate[0], /--host-api-only/u);
  const hostRunner = read(
    "packages/vscode-extension/test/extension-host/run.cjs",
  );
  const relayJourney = read(
    "packages/vscode-extension/test/extension-host/driver/dom-relay-journey.cjs",
  );
  const productionRelay = read(
    "packages/vscode-extension/src/chat/host-dom-relay.js",
  );
  const productionExtension = read(
    "packages/vscode-extension/src/extension.js",
  );
  const driverManifest = JSON.parse(
    read("packages/vscode-extension/test/extension-host/driver/package.json"),
  );
  const driverEntry = read(
    "packages/vscode-extension/test/extension-host/driver/noop.cjs",
  );
  assert.match(
    hostRunner,
    /function resolveHostJourneyTransport\(hostApiMode\)/u,
  );
  assert.match(hostRunner, /useDomRelay: hostJourneyTransport\.useDomRelay/u);
  assert.doesNotMatch(
    hostRunner,
    /useDomRelay:.*process\.platform === "darwin"/u,
  );
  assert.match(hostRunner, /launchArgs: buildHostDomRelayLaunchArgs\(\{/u);
  assert.match(hostRunner, /CHAINLESSCHAIN_HOST_DOM_TOKEN/u);
  assert.match(
    hostRunner,
    /const HOST_DOM_RELAY_RESULT_TIMEOUT_MS = 600_000;/u,
  );
  assert.match(
    hostRunner,
    /waitForFile\(\s*resultFile,\s*HOST_DOM_RELAY_RESULT_TIMEOUT_MS,\s*\)/u,
  );
  assert.match(hostRunner, /No debugger transport is opened/u);
  assert.doesNotMatch(hostRunner, /ApplicationFirewall\/socketfilterfw/u);
  assert.match(relayJourney, /vscode-webview-message-relay/u);
  assert.doesNotMatch(relayJourney, /\beval\s*\(/u);
  assert.match(productionRelay, /timingSafeEqual/u);
  assert.doesNotMatch(productionRelay, /\beval\s*\(/u);
  assert.deepEqual(driverManifest.activationEvents, [
    "onCommand:chainlesschainTests.runHostJourney",
  ]);
  assert.equal(
    driverManifest.contributes.commands[0].command,
    "chainlesschainTests.runHostJourney",
  );
  assert.match(driverEntry, /registerCommand\(DRIVER_COMMAND/u);
  assert.match(productionExtension, /if \(hostDomToken\)/u);
  assert.match(
    productionExtension,
    /executeCommand\(HOST_DOM_DRIVER_COMMAND\)/u,
  );
  for (const [platform, gate] of [
    ["Windows", windowsGate],
    ["macOS", macGate[0]],
    ["Linux", linuxGate],
  ]) {
    assert.match(
      gate,
      /runs-on: [^\n]+\n\s+timeout-minutes: 70/u,
      `${platform} must budget both isolated host profiles and evidence upload`,
    );
    assert.equal(
      gate.match(
        new RegExp(
          `- name: Extension Host multi-root \\+ multi-window journey \\(${platform} (?:stable|minimum 1\\.85\\.2)\\)\\n\\s+(?:if: always\\(\\)\\n\\s+)?timeout-minutes: 25`,
          "gu",
        ),
      )?.length,
      2,
      `${platform} host gates must retain a bounded diagnostic deadline`,
    );
  }
  assert.match(
    macGate[0],
    /- name: Extension Host multi-root \+ multi-window journey \(macOS minimum 1\.85\.2\)\n\s+if: always\(\)/u,
    "minimum host evidence must still run after a stable-host failure",
  );
  assert.match(
    macGate[0],
    /- name: Upload macOS host journey evidence\n\s+if: always\(\)/u,
  );
  assert.equal(
    workflow.match(/ws@8\.21\.2/gu)?.length,
    2,
    "only the Windows and Linux CDP host gates need the websocket client",
  );
});
