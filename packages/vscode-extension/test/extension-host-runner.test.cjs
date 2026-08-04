"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { afterEach, test } = require("node:test");
const {
  assertHostApiArtifacts,
  buildHostApiLaunchArgs,
  buildProfileArgs,
  buildHostLaunchArgs,
  createDevToolsEndpointCapture,
  createHostProgressJournal,
  findDiagnosticLogs,
  hostPhaseSignalPaths,
  makeFreshRunRoot,
  parseArgs,
  parseDevToolsBrowserEndpoint,
  recordHostProgress,
  resolveVsCodeHostVersion,
  settleHostAfterCdp,
} = require("./extension-host/run.cjs");
const {
  CdpClient,
  JOURNEY_PHASES,
  PHASE_DOM_MARKERS,
  assertJourneyArtifacts,
  createFixtureCli,
  isInspectableBrowserTarget,
  readJourneyResult,
  writeJsonSignal,
} = require("./extension-host/cdp-journey.cjs");
const {
  ACTIVITY_VIEW_COMMAND,
  CHAT_VIEW_FOCUS_COMMAND,
  requestChatViewForDomJourney,
} = require("./extension-host/driver/view-control.cjs");

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

test("extension-host runner resolves the downloaded host's exact version", async () => {
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

  assert.equal(await resolveVsCodeHostVersion(executable, "stable"), "1.110.3");
  assert.equal(await resolveVsCodeHostVersion(executable, "1.85.2"), "1.110.3");
});

test("host version resolves from the test-electron Windows archive directory", async () => {
  const root = temporaryRoot();
  const executable = path.join(
    root,
    "vscode-win32-x64-archive-1.131.0",
    "Code.exe",
  );
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "", "utf8");

  assert.equal(await resolveVsCodeHostVersion(executable, "stable"), "1.131.0");
});

test("fresh host profile root stays within the macOS Unix-socket budget", () => {
  const parent = temporaryRoot();
  const runRoot = makeFreshRunRoot(parent);
  temporaryRoots.push(runRoot);

  assert.match(path.basename(runRoot), /^ccv-[A-Za-z0-9]{6}$/u);
  assert.ok(
    path.basename(runRoot).length <= 10,
    "unique host directory must remain short enough for VS Code IPC sockets",
  );
});

test("host phases share installed extensions but isolate user-data profiles", () => {
  const root = temporaryRoot();
  const extensionsDir = path.join(root, "extensions");
  const initial = buildProfileArgs({
    runRoot: root,
    extensionsDir,
    phase: "initial",
  });
  const restart = buildProfileArgs({
    runRoot: root,
    extensionsDir,
    phase: "restart",
  });

  assert.equal(initial[0], restart[0]);
  assert.notEqual(initial[1], restart[1]);
  assert.match(initial[1], /user-data-initial$/u);
  assert.match(restart[1], /user-data-restart$/u);
  assert.throws(
    () => buildProfileArgs({ runRoot: root, extensionsDir, phase: "other" }),
    /unknown host profile phase/,
  );
});

test("host progress journal survives before immutable evidence exists", () => {
  const root = temporaryRoot();
  const artifactDir = path.join(root, "reports", "macos-stable");
  const progressPath = createHostProgressJournal(artifactDir);
  recordHostProgress(progressPath, "prepared");
  recordHostProgress(progressPath, "initial_started");

  assert.equal(fs.existsSync(artifactDir), false);
  assert.equal(
    progressPath,
    path.join(root, "reports", "macos-stable.progress.jsonl"),
  );
  const records = fs
    .readFileSync(progressPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((record) => record.stage),
    ["prepared", "initial_started"],
  );
  assert.ok(records.every((record) => !Number.isNaN(Date.parse(record.at))));
  assert.throws(() => createHostProgressJournal(artifactDir), /EEXIST|exist/i);
});

test("completed hosts need no managed shutdown after CDP settles", async () => {
  let signalCount = 0;
  const host = { value: 0 };
  const result = await settleHostAfterCdp({
    hostOutcome: Promise.resolve(host),
    phase: "initial",
    graceMs: 5,
    forceGraceMs: 5,
    emitSigint: () => {
      signalCount += 1;
    },
  });

  assert.deepEqual(result, { host, managedTermination: false });
  assert.equal(signalCount, 0);
});

test("hung hosts are shut down after the CDP deadline", async () => {
  let resolveHost;
  const hostOutcome = new Promise((resolve) => {
    resolveHost = resolve;
  });
  const host = {
    error: Object.assign(new Error("terminated"), { signal: "SIGINT" }),
  };
  let signalCount = 0;
  const result = await settleHostAfterCdp({
    hostOutcome,
    phase: "initial",
    graceMs: 5,
    forceGraceMs: 5,
    emitSigint: () => {
      signalCount += 1;
      resolveHost(host);
    },
  });

  assert.deepEqual(result, { host, managedTermination: true });
  assert.equal(signalCount, 1);
});

test("diagnostic discovery is limited to release-relevant host logs", () => {
  const root = temporaryRoot();
  const logs = path.join(root, "user-data-restart", "logs", "window1");
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
      ...profileArgs,
      "--remote-debugging-port=43210",
      "--remote-debugging-address=127.0.0.1",
      "--remote-allow-origins=*",
      "--disable-extension-update-checks",
      "--disable-telemetry",
      "--disable-crash-reporter",
      path.join(root, "workspace"),
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

test("host-API launch keeps the real extension-test profile without CDP", () => {
  const root = temporaryRoot();
  const profileArgs = [
    `--extensions-dir=${path.join(root, "extensions")}`,
    `--user-data-dir=${path.join(root, "user-data")}`,
  ];
  const args = buildHostApiLaunchArgs({
    workspaceDir: path.join(root, "workspace"),
    profileArgs,
  });
  assert.equal(args.at(-1), path.join(root, "workspace"));
  assert.deepEqual(args.slice(0, profileArgs.length), profileArgs);
  assert.equal(
    args.some((arg) => arg.startsWith("--remote-debugging")),
    false,
  );
});

test("host-API evidence proves both fresh host launches in order", () => {
  const root = temporaryRoot();
  const runtimeDir = path.join(root, "runtime");
  const extensionsDir = path.join(root, "extensions");
  const installedExtension = path.join(
    extensionsDir,
    "chainlesschain.chainlesschain-ide-0.37.40",
  );
  const workspaceDir = path.join(root, "workspace");
  fs.mkdirSync(installedExtension, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  const stages = [
    "installed-vsix-discovered",
    "vsix-activated",
    "commands-verified",
    "bridge-verified",
    "view-command-dispatched",
    "phase-completed",
  ];
  const records = [];
  for (const phase of ["initial", "restart"]) {
    writeJsonSignal(path.join(runtimeDir, `${phase}-host-ready.json`), {
      phase,
      mode: "host-api",
      extensionPath: installedExtension,
      workspaceDir,
      readyAt: "2026-08-01T00:00:00.000Z",
    });
    writeJsonSignal(path.join(runtimeDir, `${phase}-cdp-result.json`), {
      ok: true,
      phase,
      mode: "host-api",
      completedAt: "2026-08-01T00:01:00.000Z",
    });
    for (const stage of stages) {
      records.push({
        phase,
        stage,
        at: "2026-08-01T00:00:30.000Z",
        ...(stage === "installed-vsix-discovered"
          ? { extensionVersion: "0.37.40" }
          : {}),
      });
    }
  }
  writeJsonLines(path.join(runtimeDir, "host-api-trace.jsonl"), records);

  const evidence = assertHostApiArtifacts({
    runtimeDir,
    extensionsDir,
    workspaceDir,
    expectedVersion: "0.37.40",
  });
  assert.equal(evidence.results.length, 2);

  records.splice(3, 1);
  writeJsonLines(path.join(runtimeDir, "host-api-trace.jsonl"), records);
  assert.throws(
    () =>
      assertHostApiArtifacts({
        runtimeDir,
        extensionsDir,
        workspaceDir,
        expectedVersion: "0.37.40",
      }),
    /bridge-verified/,
  );
});

test("captures only the expected loopback DevTools browser endpoint", async () => {
  const written = [];
  const capture = createDevToolsEndpointCapture(43210, {
    write(chunk) {
      written.push(String(chunk));
      return true;
    },
  });

  capture.stderr.write(
    "DevTools listening on ws://example.com:43210/devtools/",
  );
  capture.stderr.write("browser/not-loopback\n");
  assert.equal(capture.getEndpoint(), null);

  await new Promise((resolve, reject) => {
    Readable.from([
      "DevTools listening on ws://127.0.0.1:43210/devtools/",
      "browser/browser-id\n",
    ])
      .pipe(capture.stderr)
      .once("finish", resolve)
      .once("error", reject);
  });
  // The first complete endpoint is rejected; a later valid endpoint in the
  // same captured stream is still accepted.
  assert.equal(
    capture.getEndpoint(),
    "ws://127.0.0.1:43210/devtools/browser/browser-id",
  );
  assert.equal(
    written.join(""),
    "DevTools listening on ws://example.com:43210/devtools/browser/not-loopback\n" +
      "DevTools listening on ws://127.0.0.1:43210/devtools/browser/browser-id\n",
  );
  assert.equal(
    parseDevToolsBrowserEndpoint(
      "DevTools listening on ws://127.0.0.1:43211/devtools/browser/wrong-port",
      43210,
    ),
    null,
  );
  assert.equal(
    parseDevToolsBrowserEndpoint(
      "DevTools listening on ws://127.0.0.1:43210/devtools/page/not-browser",
      43210,
    ),
    null,
  );
});

test("browser discovery inspects renderable targets and excludes workers", () => {
  for (const type of ["page", "iframe", "webview"]) {
    assert.equal(isInspectableBrowserTarget({ type }), true);
  }
  for (const type of ["browser", "service_worker", "shared_worker", null]) {
    assert.equal(isInspectableBrowserTarget({ type }), false);
  }
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

test("CDP websocket failures retain the handshake diagnostic", async () => {
  class RejectedWebSocket {
    addEventListener(name, listener) {
      if (name === "error") {
        queueMicrotask(() =>
          listener({
            message: "Received non-101 status code",
            error: new Error("403 Forbidden"),
          }),
        );
      }
    }

    close() {}
  }

  await assert.rejects(
    CdpClient.connect(
      "ws://127.0.0.1:43210/devtools/browser/test",
      RejectedWebSocket,
    ),
    /Received non-101 status code; 403 Forbidden/,
  );
});

test("host phase signals are phase-scoped and reject unknown phases", () => {
  const root = temporaryRoot();
  assert.deepEqual(hostPhaseSignalPaths(root, "restart"), {
    readyFile: path.join(root, "restart-host-ready.json"),
    resultFile: path.join(root, "restart-cdp-result.json"),
  });
  assert.throws(() => hostPhaseSignalPaths(root, "other"), /unknown host/);
});

test("host ready is not blocked by VS Code's pending chat focus promise", async () => {
  const calls = [];
  let settleFocus;
  const pendingFocus = new Promise((resolve) => {
    settleFocus = resolve;
  });
  const commands = {
    executeCommand(command) {
      calls.push(command);
      return command === ACTIVITY_VIEW_COMMAND
        ? Promise.resolve()
        : pendingFocus;
    },
  };

  await Promise.race([
    requestChatViewForDomJourney({ commands, timeoutMs: 50 }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("pending focus blocked the CDP handoff")),
        100,
      ),
    ),
  ]);
  assert.deepEqual(calls, [ACTIVITY_VIEW_COMMAND, CHAT_VIEW_FOCUS_COMMAND]);
  settleFocus();
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
