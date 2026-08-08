"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../../..");
const releaseCommit = "a".repeat(40);
const operatingSystems = ["darwin", "linux", "win32"];

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function loadModules() {
  const evidence = await import(
    pathToFileURL(path.join(repositoryRoot, "scripts/ide-journey-evidence.mjs"))
      .href
  );
  const verifier = await import(
    pathToFileURL(
      path.join(repositoryRoot, "scripts/verify-ide-arm64-evidence.mjs"),
    ).href
  );
  return { evidence, verifier };
}

function writeJourney({
  root,
  evidence,
  host,
  operatingSystem,
  version,
  slot,
}) {
  const directory = path.join(
    root,
    `${host}-${operatingSystem}-${String(slot).replaceAll(".", "_")}`,
  );
  const diagnostics = path.join(directory, "diagnostics");
  fs.mkdirSync(diagnostics, { recursive: true });
  const trace = Buffer.from(`${host}:${operatingSystem}:${version}\n`);
  fs.writeFileSync(path.join(diagnostics, "trace.log"), trace);
  const core = {
    schema: evidence.IDE_JOURNEY_EVIDENCE_SCHEMA,
    schemaVersion: evidence.IDE_JOURNEY_EVIDENCE_VERSION,
    manifestVersion: "1.0.0",
    journeyId:
      host === "vscode"
        ? "vscode-installed-vsix-real-dom-multiroot-multiwindow-control-workbench-restart"
        : "jetbrains-chat-control-workbench-restart-rewind",
    required: true,
    releaseCommit,
    host: {
      name: host,
      version,
      operatingSystem,
      architecture: "arm64",
      transport:
        host === "vscode"
          ? "local-ide-bridge+vscode-webview-message-dom"
          : "local-ide-bridge",
    },
    ...(host === "vscode"
      ? {
          workspace: {
            layout: "multi-root",
            rootCount: 2,
            orderedRootsDigest: sha256("ordered-roots"),
          },
        }
      : {}),
    cliVersion: "0.163.1",
    extensionVersion: "1.0.0",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:01:00.000Z",
    result: "passed",
    evidenceComplete: true,
    artifacts: [
      {
        kind: "host-diagnostic",
        path: "diagnostics/trace.log",
        sha256: sha256(trace),
        bytes: trace.length,
      },
      {
        kind: "release-artifact",
        name: host === "vscode" ? "candidate.vsix" : "candidate.zip",
        sha256: sha256(`${host}-candidate`),
        bytes: 123,
      },
    ],
    incidents: [],
  };
  const value = {
    ...core,
    evidenceDigest: evidence.sha256Buffer(evidence.canonicalJson(core)),
  };
  const evidencePath = path.join(directory, "journey-evidence.json");
  fs.writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
  return evidencePath;
}

async function createCompleteMatrix(testContext) {
  const modules = await loadModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-arm64-test-"));
  testContext.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const files = [];
  for (const operatingSystem of operatingSystems) {
    files.push(
      writeJourney({
        root,
        evidence: modules.evidence,
        host: "vscode",
        operatingSystem,
        version: "1.99.0",
        slot: "stable",
      }),
      writeJourney({
        root,
        evidence: modules.evidence,
        host: "vscode",
        operatingSystem,
        version: "1.85.2",
        slot: "minimum",
      }),
    );
    for (const version of modules.verifier.IDE_ARM64_JETBRAINS_VERSIONS_BY_OS[
      operatingSystem
    ]) {
      files.push(
        writeJourney({
          root,
          evidence: modules.evidence,
          host: "jetbrains",
          operatingSystem,
          version,
          slot: version,
        }),
      );
    }
  }
  return { ...modules, root, files };
}

function rewriteEvidence(filePath, evidence, mutate) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  mutate(value);
  delete value.evidenceDigest;
  value.evidenceDigest = evidence.sha256Buffer(evidence.canonicalJson(value));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("a complete 11-cell IDE ARM64 evidence set produces one immutable aggregate", async (t) => {
  const { root, verifier } = await createCompleteMatrix(t);
  const output = path.join(root, "aggregate.json");
  const aggregate = verifier.verifyIdeArm64EvidenceSet({
    evidenceDir: root,
    releaseCommit,
    output,
  });

  assert.equal(aggregate.result, "passed");
  assert.equal(aggregate.evidenceCount, 11);
  assert.equal(aggregate.matrix.length, 11);
  assert.deepEqual(aggregate.jetbrainsVersionsByOs, {
    darwin: ["2024.2", "2025.2"],
    linux: ["2024.2", "2025.2"],
    win32: ["2026.2.0.1"],
  });
  assert.equal(
    aggregate.vendorSupportBoundaries.jetbrainsWindowsArm64.distributionKey,
    "windowsARM64",
  );
  assert.match(aggregate.aggregateDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(fs.statSync(output).isFile());
  assert.throws(
    () =>
      verifier.verifyIdeArm64EvidenceSet({
        evidenceDir: root,
        releaseCommit,
        output,
      }),
    /aggregate destination already exists/u,
  );
});

test("the IDE ARM64 aggregate rejects a missing matrix cell", async (t) => {
  const { root, files, verifier } = await createCompleteMatrix(t);
  fs.unlinkSync(files[0]);
  assert.throws(
    () =>
      verifier.verifyIdeArm64EvidenceSet({ evidenceDir: root, releaseCommit }),
    /requires 11 evidence files, found 10/u,
  );
});

test("the IDE ARM64 aggregate rejects a self-consistent wrong architecture", async (t) => {
  const { root, files, evidence, verifier } = await createCompleteMatrix(t);
  rewriteEvidence(files[0], evidence, (value) => {
    value.host.architecture = "x64";
  });
  assert.throws(
    () =>
      verifier.verifyIdeArm64EvidenceSet({ evidenceDir: root, releaseCommit }),
    /invalid IDE ARM64 journey evidence/u,
  );
});

test("the IDE ARM64 aggregate rejects a nonexistent Windows compatibility cell", async (t) => {
  const { root, files, evidence, verifier } = await createCompleteMatrix(t);
  const windowsJetbrains = files.find((filePath) =>
    filePath.includes("jetbrains-win32"),
  );
  rewriteEvidence(windowsJetbrains, evidence, (value) => {
    value.host.version = "2025.2";
  });
  assert.throws(
    () =>
      verifier.verifyIdeArm64EvidenceSet({ evidenceDir: root, releaseCommit }),
    /invalid JetBrains ARM64 journey identity/u,
  );
});

test("the IDE ARM64 aggregate rehashes path-backed host artifacts", async (t) => {
  const { root, files, verifier } = await createCompleteMatrix(t);
  fs.appendFileSync(
    path.join(path.dirname(files[0]), "diagnostics/trace.log"),
    "tamper",
  );
  assert.throws(
    () =>
      verifier.verifyIdeArm64EvidenceSet({ evidenceDir: root, releaseCommit }),
    /artifact digest mismatch/u,
  );
});

test("the JetBrains host runner accepts exact four-component IDE versions", async () => {
  const runner = await import(
    pathToFileURL(
      path.join(
        repositoryRoot,
        "packages/jetbrains-plugin/scripts/run-ui-host-journey.mjs",
      ),
    ).href
  );
  const options = runner.parseArgs([
    "--ide-version",
    "2026.2.0.1",
    "--artifact-dir",
    "evidence",
  ]);
  assert.equal(options.ideVersion, "2026.2.0.1");
});

test("the ARM64 workflow binds exact hosts, versions, and aggregate evidence", () => {
  const workflow = fs.readFileSync(
    path.join(repositoryRoot, ".github/workflows/ide-arm64-validation.yml"),
    "utf8",
  );

  assert.match(workflow, /ubuntu-24\.04-arm/u);
  assert.match(workflow, /windows-11-arm/u);
  assert.match(workflow, /runner: macos-15\s+platform: darwin/u);
  assert.equal(workflow.match(/ide_version: "2024\.2"/gu)?.length, 2);
  assert.equal(workflow.match(/ide_version: "2025\.2"/gu)?.length, 2);
  assert.equal(workflow.match(/ide_version: "2026\.2\.0\.1"/gu)?.length, 1);
  assert.equal(workflow.match(/--vscode-version 1\.85\.2/gu)?.length, 2);
  assert.equal(workflow.match(/--assert-host/gu)?.length, 2);
  assert.equal(workflow.match(/--expected-arch arm64/gu)?.length, 2);
  assert.equal(workflow.match(/CC_IDE_REQUIRED_HOST_ARCH: arm64/gu)?.length, 2);
  assert.match(workflow, /uses: gradle\/actions\/setup-gradle@v6/u);
  assert.match(workflow, /gradle-version: "9\.2\.1"/u);
  assert.match(
    workflow,
    /CC_JETBRAINS_GRADLE_EXECUTABLE: \$\{\{ runner\.os == 'Windows' && 'gradle' \|\| '' \}\}/u,
  );
  assert.match(
    workflow,
    /IDE_ARM64_RELEASE_COMMIT: \$\{\{ inputs\.commit_sha \|\| github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.match(workflow, /needs: \[vscode-arm64-host, jetbrains-arm64-host\]/u);
  assert.match(workflow, /Aggregate 11-cell IDE ARM64 evidence/u);
  assert.match(workflow, /downloads\.windowsARM64/u);
  assert.match(workflow, /Get-FileHash -Algorithm SHA256/u);
  assert.match(
    workflow,
    /New-NetFirewallRule[\s\S]*?-Direction Inbound[\s\S]*?-Action Block/u,
  );
  assert.match(
    workflow,
    /Suppress Windows ARM64 runner privacy OOBE[\s\S]*?if: runner\.os == 'Windows'[\s\S]*?DisablePrivacyExperience[\s\S]*?-Value 1[\s\S]*?Get-Process -Name WWAHost[\s\S]*?Stop-Process -Force[\s\S]*?SendKeys\('\{ESC\}'\)[\s\S]*?ShowWindowAsync[\s\S]*?MainWindowTitle -like '\*\\GitHub\\HostedComputeAgent\\hosted-compute-agent\*'[\s\S]*?MainWindowHandle[\s\S]*?6/u,
  );
  assert.match(workflow, /verify-ide-arm64-evidence\.mjs\s+--evidence-dir/u);
  assert.match(workflow, /merge-multiple: true/u);
  assert.doesNotMatch(workflow, /continue-on-error/u);

  const vscodeHostDriver = fs.readFileSync(
    path.join(
      repositoryRoot,
      "packages/vscode-extension/test/extension-host/cdp-journey.cjs",
    ),
    "utf8",
  );
  const jetbrainsHostDriver = fs.readFileSync(
    path.join(
      repositoryRoot,
      "packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest/IdeUiSmokeTest.java",
    ),
    "utf8",
  );
  const jetbrainsJourneyRunner = fs.readFileSync(
    path.join(
      repositoryRoot,
      "packages/jetbrains-plugin/scripts/run-ui-host-journey.mjs",
    ),
    "utf8",
  );
  const jetbrainsBuild = fs.readFileSync(
    path.join(repositoryRoot, "packages/jetbrains-plugin/build.gradle.kts"),
    "utf8",
  );
  assert.match(
    vscodeHostDriver,
    /value\.hostArchitecture !== requiredArchitecture/u,
  );
  assert.match(
    jetbrainsHostDriver,
    /Object actualValue = frame\.callJs[\s\S]*?System\.getProperty\('os\.arch'\)/u,
  );
  assert.match(
    jetbrainsJourneyRunner,
    /configured !== "gradle"[\s\S]*?return configured/u,
  );
  assert.match(
    jetbrainsJourneyRunner,
    /CC_JETBRAINS_GRADLE_EXECUTABLE[\s\S]*?"--no-configuration-cache"/u,
  );
  assert.match(
    jetbrainsJourneyRunner,
    /CC_JETBRAINS_IDE_LOCAL_PATH[\s\S]*?-PhostIdeLocalPath=/u,
  );
  assert.match(
    jetbrainsBuild,
    /hostIdeLocalPath\.isPresent[\s\S]*?localPath\.set/u,
  );
  assert.match(
    jetbrainsHostDriver,
    /CC_IDE_REQUIRED_HOST_VERSION[\s\S]*?ApplicationInfo\.getInstance\(\)\.getStrictVersion/u,
  );
  assert.match(
    jetbrainsHostDriver,
    /equivalentNumericVersion[\s\S]*?Math\.max\(expectedParts\.length, actualParts\.length\)/u,
  );

  const vscodeHostRunner = fs.readFileSync(
    path.join(
      repositoryRoot,
      "packages/vscode-extension/test/extension-host/run.cjs",
    ),
    "utf8",
  );
  assert.match(vscodeHostRunner, /TRANSIENT_NETWORK_ERROR_CODES/u);
  assert.match(vscodeHostRunner, /retryTransientNetworkOperation/u);

  const vscodeSmokeDriver = fs.readFileSync(
    path.join(
      repositoryRoot,
      "packages/vscode-extension/test/extension-host/driver/smoke.cjs",
    ),
    "utf8",
  );
  assert.match(vscodeSmokeDriver, /EXTENSION_ACTIVATION_TIMEOUT_MS = 60_000/u);
  assert.equal(
    vscodeSmokeDriver.match(/EXTENSION_ACTIVATION_TIMEOUT_MS/gu)?.length,
    3,
  );
  assert.match(
    vscodeHostRunner,
    /multi-window-primary-activation-ready\.json[\s\S]*?Promise\.race[\s\S]*?multi_window_companion_launch_requested/u,
  );
  assert.match(
    vscodeSmokeDriver,
    /CHAINLESSCHAIN_MULTI_WINDOW_PRIMARY_READY_FILE[\s\S]*?role: "primary"/u,
  );
});
