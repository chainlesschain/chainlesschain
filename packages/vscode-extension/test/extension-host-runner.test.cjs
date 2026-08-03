"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const {
  buildHostLaunchArgs,
  findDiagnosticLogs,
  hostPhaseSignalPaths,
  parseArgs,
  resolveVsCodeHostVersion,
} = require("./extension-host/run.cjs");
const {
  CdpClient,
  JOURNEY_PHASES,
  PHASE_DOM_MARKERS,
  assertJourneyArtifacts,
  createFixtureCli,
  readJourneyResult,
  writeJsonSignal,
} = require("./extension-host/cdp-journey.cjs");

const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-vscode-host-runner-"));
  temporaryRoots.push(root);
  return root;
}

function writeJsonLines(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
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

test("real-DOM host phase is loopback-only and keeps the fresh profile args", () => {
  const root = temporaryRoot();
  const profileArgs = [
    `--extensions-dir=${path.join(root, "extensions")}`,
    `--user-data-dir=${path.join(root, "user-data")}`,
  ];
  assert.deepEqual(
    buildHostLaunchArgs({
      workspaceDir: path.join(root, "workspace"),
      profileArgs,
      cdpPort: 43210,
    }),
    [
      path.join(root, "workspace"),
      ...profileArgs,
      "--remote-debugging-port=43210",
      "--remote-debugging-address=127.0.0.1",
      "--disable-extension-update-checks",
      "--disable-telemetry",
      "--disable-crash-reporter",
    ],
  );
  assert.throws(
    () =>
      buildHostLaunchArgs({
        workspaceDir: root,
        profileArgs,
        cdpPort: 0,
      }),
    /invalid CDP port/,
  );
});

test("CDP child sessions preserve flattened target identity", async () => {
  const listeners = new Map();
  const sent = [];
  const socket = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    send(serialized) {
      const request = JSON.parse(serialized);
      sent.push(request);
      queueMicrotask(() => {
        listeners.get("message")?.({
          data: JSON.stringify({
            id: request.id,
            sessionId: request.sessionId,
            result: { result: { value: 2 } },
          }),
        });
      });
    },
    close() {},
  };
  const client = new CdpClient(socket);

  assert.equal(await client.session("iframe-1", 41).evaluate("1 + 1"), 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, "Runtime.evaluate");
  assert.equal(sent[0].sessionId, "iframe-1");
  assert.equal(sent[0].params.contextId, 41);
});

test("host phase signals are phase-scoped and reject unknown phases", () => {
  const root = temporaryRoot();
  assert.deepEqual(hostPhaseSignalPaths(root, "restart"), {
    readyFile: path.join(root, "restart-host-ready.json"),
    resultFile: path.join(root, "restart-cdp-result.json"),
  });
  assert.throws(() => hostPhaseSignalPaths(root, "other"), /unknown host/);
});

test("fixture CLI wrappers are isolated and cannot overwrite an existing shim", () => {
  const root = temporaryRoot();
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const fixture = createFixtureCli(root, repoRoot);
  assert.ok(fs.statSync(fixture.command).isFile());
  assert.equal(path.dirname(fixture.command), fixture.binDir);
  assert.equal(path.dirname(fixture.statePath), root);
  assert.equal(path.dirname(fixture.tracePath), root);
  assert.throws(() => createFixtureCli(root, repoRoot), /EEXIST|exist/i);
});

test("journey results are atomic, phase-bound, and fail closed", () => {
  const root = temporaryRoot();
  const resultFile = path.join(root, "initial-result.json");
  writeJsonSignal(resultFile, { ok: true, phase: "initial" });
  assert.deepEqual(readJourneyResult(resultFile, "initial"), {
    ok: true,
    phase: "initial",
  });
  assert.throws(
    () => writeJsonSignal(resultFile, { ok: true, phase: "restart" }),
    /refusing to overwrite/,
  );
  assert.throws(
    () => readJourneyResult(resultFile, "restart"),
    /restart failed/,
  );
});

test("raw DOM and protocol evidence must prove every control and restart step", () => {
  const root = temporaryRoot();
  const artifactDir = path.join(root, "artifacts");
  const fixtureTracePath = path.join(root, "fixture.jsonl");
  const runtimeDir = path.join(root, "runtime");
  const extensionsDir = path.join(root, "extensions");
  const installedExtension = path.join(
    extensionsDir,
    "chainlesschain.chainlesschain-ide-0.37.37",
  );
  const workspaceDir = path.join(root, "workspace");
  fs.mkdirSync(installedExtension, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  const cdpRecords = [];
  for (const [phase, steps] of Object.entries(JOURNEY_PHASES)) {
    cdpRecords.push({
      phase,
      status: "target-found",
      targetType: "iframe",
      targetUrl: `vscode-webview://chainlesschain/${phase}`,
    });
    for (const step of steps) {
      cdpRecords.push({ phase, step, status: "passed" });
    }
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, `${phase}-dom.txt`),
      PHASE_DOM_MARKERS[phase].join("\n"),
      "utf8",
    );
    writeJsonSignal(path.join(runtimeDir, `${phase}-host-ready.json`), {
      phase,
      extensionPath: installedExtension,
      workspaceDir,
      readyAt: "2026-08-01T00:00:00.000Z",
    });
    writeJsonSignal(path.join(runtimeDir, `${phase}-cdp-result.json`), {
      ok: true,
      phase,
      completedAt: "2026-08-01T00:01:00.000Z",
    });
  }
  writeJsonLines(path.join(artifactDir, "cdp-journey.jsonl"), cdpRecords);
  writeJsonLines(fixtureTracePath, [
    { direction: "in", event: { type: "user", text: "journey:stream" } },
    { direction: "in", event: { type: "user", text: "journey:stream" } },
    { direction: "in", event: { type: "plan", action: "approve" } },
    {
      direction: "in",
      event: { type: "user", text: "journey:permission" },
    },
    { direction: "in", event: { type: "approval", approve: true } },
    { direction: "in", event: { type: "user", text: "journey:stop" } },
    { direction: "in", event: { type: "interrupt" } },
    { direction: "out", event: { type: "system", resumed_messages: 10 } },
    { direction: "in", event: { type: "user", text: "journey:resume" } },
  ]);

  const evidence = assertJourneyArtifacts({
    artifactDir,
    fixtureTracePath,
    runtimeDir,
    extensionsDir,
    workspaceDir,
  });
  assert.equal(evidence.domPaths.length, 2);

  fs.writeFileSync(
    path.join(artifactDir, "restart-dom.txt"),
    "resumed previous conversation\n",
    "utf8",
  );
  assert.throws(
    () =>
      assertJourneyArtifacts({
        artifactDir,
        fixtureTracePath,
        runtimeDir,
        extensionsDir,
        workspaceDir,
      }),
    /fixture stream complete #6/,
  );

  fs.writeFileSync(
    path.join(artifactDir, "restart-dom.txt"),
    PHASE_DOM_MARKERS.restart.join("\n"),
    "utf8",
  );
  const developmentExtension = path.join(root, "development-extension");
  fs.mkdirSync(developmentExtension, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, "restart-host-ready.json"),
    `${JSON.stringify({
      phase: "restart",
      extensionPath: developmentExtension,
      workspaceDir,
      readyAt: "2026-08-01T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  assert.throws(
    () =>
      assertJourneyArtifacts({
        artifactDir,
        fixtureTracePath,
        runtimeDir,
        extensionsDir,
        workspaceDir,
      }),
    /installed extension/,
  );
});
