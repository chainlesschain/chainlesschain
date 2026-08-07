"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough, Readable } = require("node:stream");
const { afterEach, test } = require("node:test");
const {
  assertHostApiArtifacts,
  assertMultiWindowEvidence,
  buildExternalCompanionHostLaunchArgs,
  buildExtensionTestLaunchArgs,
  buildHostApiLaunchArgs,
  buildHostDomRelayLaunchArgs,
  buildHostInspectorLaunchArgs,
  buildHostPipeLaunchArgs,
  buildProfileArgs,
  buildHostLaunchArgs,
  createDevToolsEndpointCapture,
  createElectronInspectorEndpointCapture,
  createHostProgressJournal,
  findDiagnosticLogs,
  hostPhaseSignalPaths,
  launchExtensionHostWithCdpPipe,
  launchManagedExtensionHost,
  makeFreshRunRoot,
  parseArgs,
  parseDevToolsBrowserEndpoint,
  parseElectronInspectorEndpoint,
  recordHostProgress,
  resolveHostJourneyTransport,
  resolveVsCodeHostVersion,
  runHostApiPhase,
  runRealDomPhase,
  settleHostAfterCdp,
  writeCompanionWorkspace,
  writeMultiRootWorkspace,
} = require("./extension-host/run.cjs");
const {
  buildCompanionLaunchArgs,
  buildCompanionLaunchEnvironment,
  selectMultiWindowLocks,
  workspaceDigest,
} = require("./extension-host/driver/multi-window.cjs");
const {
  CdpClient,
  JOURNEY_PHASES,
  PHASE_DOM_MARKERS,
  PHASE_WORKBENCH_DOM_MARKERS,
  WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  WORKBENCH_NEEDS_INPUT_SLA_MS,
  WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
  acceptJavaScriptDialog,
  assertHostReadySignal,
  assertJourneyArtifacts,
  buildCdpWebSocketOptions,
  clickSessionsWorkbenchAction,
  createCdpPipeSocket,
  createFixtureCli,
  findWorkbenchWindow,
  isInspectableBrowserTarget,
  readJourneyResult,
  writeJsonSignal,
} = require("./extension-host/cdp-journey.cjs");
const {
  buildElectronInspectorWebSocketOptions,
  createWebContentsClient,
  inspectWebContentsExpression,
} = require("./extension-host/electron-main-journey.cjs");
const {
  ACTIVITY_VIEW_COMMAND,
  CHAT_VIEW_FOCUS_COMMAND,
  activateMacHostWindow,
  findOuterMacAppBundle,
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
      "--release-commit",
      "ab".repeat(20),
      "--host-api-only",
    ]),
    {
      vsix: "release.vsix",
      vscodeVersion: "1.85.2",
      workDir: null,
      artifactDir: "reports/stable",
      releaseCommit: "ab".repeat(20),
      hostApiOnly: true,
      help: false,
    },
  );
  assert.equal(parseArgs([]).hostApiOnly, false);
  assert.equal(parseArgs([]).releaseCommit, null);
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

test("real host fixture opens an ordered two-root workspace with shared settings", () => {
  const root = temporaryRoot();
  const fixtureCliCommand = "node fixture-cli.cjs";
  const layout = writeMultiRootWorkspace(root, fixtureCliCommand);

  assert.equal(layout.workspaceFolders.length, 2);
  assert.equal(layout.workspaceDir, layout.workspaceFolders[0]);
  assert.equal(new Set(layout.workspaceFolders).size, 2);
  assert.ok(
    layout.workspaceFolders.every((folder) =>
      fs.statSync(folder).isDirectory(),
    ),
  );
  assert.equal(
    fs.readFileSync(path.join(layout.workspaceDir, "hello.txt"), "utf8"),
    "ChainlessChain Extension Host multi-root workspace 1\n",
  );
  assert.equal(
    fs.readFileSync(
      path.join(layout.workspaceFolders[1], "secondary.txt"),
      "utf8",
    ),
    "ChainlessChain Extension Host multi-root workspace 2\n",
  );

  const workspace = JSON.parse(fs.readFileSync(layout.workspaceTarget, "utf8"));
  assert.deepEqual(workspace.folders, [
    { name: "primary", path: "workspace-primary" },
    { name: "secondary", path: "workspace-secondary" },
  ]);
  assert.equal(
    workspace.settings["chainlesschain.cli.path"],
    fixtureCliCommand,
  );
  assert.equal(workspace.settings["chainlesschain.cli.managed.enabled"], false);
});

test("real host fixture creates an isolated companion-window workspace", () => {
  const root = temporaryRoot();
  const fixtureCliCommand = "node fixture-cli.cjs";
  const workspaceDir = writeCompanionWorkspace(root, fixtureCliCommand);

  assert.equal(
    fs.readFileSync(path.join(workspaceDir, "companion.txt"), "utf8"),
    "ChainlessChain Extension Host companion window\n",
  );
  const settings = JSON.parse(
    fs.readFileSync(
      path.join(workspaceDir, ".vscode", "settings.json"),
      "utf8",
    ),
  );
  assert.equal(settings["chainlesschain.cli.path"], fixtureCliCommand);
  assert.equal(settings["chainlesschain.cli.managed.enabled"], false);
});

test("companion host launch reuses the isolated profile in a new window", () => {
  const root = temporaryRoot();
  const args = buildCompanionLaunchArgs({
    userDataDir: path.join(root, "user-data-initial"),
    extensionsDir: path.join(root, "extensions"),
    companionWorkspace: path.join(root, "workspace-companion"),
  });

  assert.deepEqual(args.slice(0, 3), [
    `--user-data-dir=${path.join(root, "user-data-initial")}`,
    `--extensions-dir=${path.join(root, "extensions")}`,
    "--new-window",
  ]);
  assert.ok(args.includes("--disable-workspace-trust"));
  assert.equal(args.at(-1), path.join(root, "workspace-companion"));
  assert.equal(args.includes("--reuse-window"), false);
  assert.deepEqual(
    buildCompanionLaunchEnvironment({
      ELECTRON_RUN_AS_NODE: "1",
      VSCODE_IPC_HOOK: "isolated-main-process",
    }),
    { VSCODE_IPC_HOOK: "isolated-main-process" },
  );
});

test("multi-window lock selection binds distinct exact workspace identities", () => {
  const root = temporaryRoot();
  const primaryFolders = [
    path.join(root, "workspace-primary"),
    path.join(root, "workspace-secondary"),
  ];
  const companionFolders = [path.join(root, "workspace-companion")];
  for (const directory of [...primaryFolders, ...companionFolders]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const locks = [
    {
      ide: "vscode",
      port: 41001,
      pid: 51001,
      token: "a".repeat(64),
      workspaceFolders: primaryFolders,
    },
    {
      ide: "vscode",
      port: 41002,
      pid: 51002,
      token: "b".repeat(64),
      workspaceFolders: companionFolders,
    },
  ];

  const selected = selectMultiWindowLocks(
    locks,
    primaryFolders,
    companionFolders,
  );
  assert.equal(selected.primary, locks[0]);
  assert.equal(selected.companion, locks[1]);
  assert.notEqual(
    workspaceDigest(primaryFolders),
    workspaceDigest(companionFolders),
  );
  const primaryAlias = path.join(root, "workspace-primary-alias");
  fs.symlinkSync(
    primaryFolders[0],
    primaryAlias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    selectMultiWindowLocks(
      locks,
      [primaryAlias, primaryFolders[1]],
      companionFolders,
    ).primary,
    locks[0],
    "workspace identity must survive platform path aliases such as macOS /tmp -> /private/tmp",
  );
  assert.deepEqual(
    selectMultiWindowLocks(
      [{ ...locks[0], workspaceFolders: [...primaryFolders].reverse() }],
      primaryFolders,
      companionFolders,
    ),
    { primary: null, companion: null },
  );
});

test("multi-window evidence requires simultaneous distinct sanitized identities", () => {
  const root = temporaryRoot();
  const evidenceFile = path.join(root, "multi-window-evidence.json");
  const evidence = {
    version: 1,
    result: "passed",
    observedAt: "2026-08-07T00:00:00.000Z",
    primary: {
      port: 41001,
      pid: 51001,
      rootCount: 2,
      workspaceDigest: "a".repeat(64),
    },
    companion: {
      port: 41002,
      pid: 51002,
      rootCount: 1,
      workspaceDigest: "b".repeat(64),
    },
    simultaneousListening: true,
    distinctBridgeTokens: true,
  };
  const write = (value) =>
    fs.writeFileSync(evidenceFile, `${JSON.stringify(value)}\n`, "utf8");

  write(evidence);
  assert.equal(assertMultiWindowEvidence(evidenceFile).result, "passed");
  write({
    ...evidence,
    companion: { ...evidence.companion, port: evidence.primary.port },
  });
  assert.throws(
    () => assertMultiWindowEvidence(evidenceFile),
    /identities are not distinct/,
  );
  write({ ...evidence, observedAt: "2026-08-07" });
  assert.throws(
    () => assertMultiWindowEvidence(evidenceFile),
    /evidence header is invalid/,
  );
  write({ ...evidence, bridgeToken: "c".repeat(64) });
  assert.throws(
    () => assertMultiWindowEvidence(evidenceFile),
    /contains sensitive or unknown fields/,
  );
});

test("host-ready evidence binds the exact ordered multi-root workspace", () => {
  const root = temporaryRoot();
  const extensionsDir = path.join(root, "extensions");
  const extensionPath = path.join(extensionsDir, "chainlesschain");
  const workspaceFolders = [
    path.join(root, "workspace-primary"),
    path.join(root, "workspace-secondary"),
  ];
  for (const directory of [extensionPath, ...workspaceFolders]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const readyFile = path.join(root, "initial-host-ready.json");
  const signal = {
    phase: "initial",
    extensionPath,
    workspaceDir: workspaceFolders[0],
    workspaceFolders,
    readyAt: "2026-08-06T00:00:00.000Z",
  };
  fs.writeFileSync(readyFile, `${JSON.stringify(signal)}\n`, "utf8");

  assert.equal(
    assertHostReadySignal({
      readyFile,
      phase: "initial",
      extensionsDir,
      workspaceDir: workspaceFolders[0],
      workspaceFolders,
    }).workspaceFolders.length,
    2,
  );

  fs.writeFileSync(
    readyFile,
    `${JSON.stringify({
      ...signal,
      workspaceFolders: [...workspaceFolders].reverse(),
    })}\n`,
    "utf8",
  );
  assert.throws(
    () =>
      assertHostReadySignal({
        readyFile,
        phase: "initial",
        extensionsDir,
        workspaceDir: workspaceFolders[0],
        workspaceFolders,
      }),
    /multi-root workspace mismatch/,
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
      "--remote-allow-origins=http://127.0.0.1:43210",
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

test("external companion launch uses a distinct real VS Code profile", () => {
  const root = temporaryRoot();
  const extensionsDir = path.join(root, "extensions");
  const userDataDir = path.join(root, "user-data-multi-window");
  const companionWorkspace = path.join(root, "workspace-companion");
  const args = buildExternalCompanionHostLaunchArgs({
    workspaceDir: companionWorkspace,
    profileArgs: [
      `--extensions-dir=${extensionsDir}`,
      `--user-data-dir=${userDataDir}`,
      "--disable-workspace-trust",
    ],
  });

  assert.ok(args.includes(`--extensions-dir=${extensionsDir}`));
  assert.ok(args.includes(`--user-data-dir=${userDataDir}-companion`));
  assert.ok(args.includes("--new-window"));
  assert.equal(args.at(-1), companionWorkspace);
  assert.throws(
    () =>
      buildExternalCompanionHostLaunchArgs({
        workspaceDir: companionWorkspace,
        profileArgs: [`--extensions-dir=${extensionsDir}`],
      }),
    /exactly one user-data directory/u,
  );
});

test("multi-window gate uses a dedicated host-API profile and explicit contract", async () => {
  const root = temporaryRoot();
  const runtimeDir = path.join(root, "multi-window-runtime");
  const workspaceDir = path.join(root, "workspace");
  const extensionsDir = path.join(root, "extensions");
  const profileHome = path.join(root, "home");
  const companionWorkspace = path.join(root, "workspace-companion");
  for (const directory of [
    workspaceDir,
    extensionsDir,
    profileHome,
    companionWorkspace,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  let launch;
  await runHostApiPhase({
    runTests: async (options) => {
      launch = options;
      writeJsonSignal(
        options.extensionTestsEnv.CHAINLESSCHAIN_HOST_RESULT_FILE,
        {
          ok: true,
          phase: "initial",
          mode: "host-api",
          completedAt: "2026-08-07T00:00:00.000Z",
        },
      );
    },
    vscodeExecutablePath: path.join(root, "Code"),
    workspaceDir,
    profileArgs: buildProfileArgs({
      runRoot: root,
      extensionsDir,
      phase: "multi-window",
    }),
    extensionsDir,
    profileHome,
    expectedVersion: "0.37.45",
    phase: "initial",
    runtimeDir,
    fixture: {
      statePath: path.join(root, "fixture-state.json"),
      tracePath: path.join(root, "fixture-trace.jsonl"),
    },
    companionWorkspace,
    multiWindowEvidenceFile: path.join(root, "multi-window-evidence.json"),
    progressPath: path.join(root, "progress.jsonl"),
    includeMultiWindow: true,
  });

  assert.equal(
    launch.extensionTestsEnv.CHAINLESSCHAIN_MULTI_WINDOW_REQUIRED,
    "1",
  );
  assert.equal(
    launch.extensionTestsEnv.CHAINLESSCHAIN_SMOKE_COMPANION_WORKSPACE,
    companionWorkspace,
  );
  assert.equal(
    launch.extensionTestsEnv.CHAINLESSCHAIN_MULTI_WINDOW_PROGRESS_FILE,
    path.join(root, "progress.jsonl"),
  );
  assert.match(
    launch.launchArgs.find((argument) =>
      argument.startsWith("--user-data-dir="),
    ),
    /user-data-multi-window$/u,
  );

  const smokeDriver = fs.readFileSync(
    path.join(__dirname, "extension-host", "driver", "smoke.cjs"),
    "utf8",
  );
  assert.doesNotMatch(
    smokeDriver,
    /await new Promise\(\(\) => \{\}\)/u,
    "a companion window must not leave the process-wide test promise pending",
  );
  assert.match(
    smokeDriver,
    /await waitForJourneyResult\(primaryResultFile, journeyPhase, 135_000\)/u,
    "the companion must settle only after the primary publishes success",
  );
  assert.match(
    smokeDriver,
    /primaryResultFile: resultFile,\s+journeyPhase,/u,
    "the companion must receive the phase-scoped primary result contract",
  );
  assert.match(
    smokeDriver,
    /CHAINLESSCHAIN_MULTI_WINDOW_EXTERNAL_COMPANION[\s\S]*?launchCompanion: async \(\) => \{\}/u,
    "an externally managed companion must not launch a third window",
  );
  assert.match(
    smokeDriver,
    /if \(process\.platform === "darwin"\) \{[\s\S]*?multi_window_companion_close_requested[\s\S]*?void vscode\.commands\.executeCommand\("workbench\.action\.closeWindow"\);/u,
    "macOS must close only the synchronized companion window",
  );
  assert.match(
    smokeDriver,
    /multi_window_primary_result_published/u,
    "the companion close must remain auditable against primary success",
  );
  assert.match(
    smokeDriver,
    /multi_window_primary_result_published[\s\S]*?waitForMultiWindowProgressStage\([\s\S]*?multi_window_companion_primary_result_observed[\s\S]*?3_000[\s\S]*?multi_window_primary_quit_requested[\s\S]*?workbench\.action\.quit/u,
    "macOS must bound companion synchronization before clean application exit",
  );
});

test("non-Windows multi-window gate orchestrates two bounded real hosts", async () => {
  const root = temporaryRoot();
  const runtimeDir = path.join(root, "multi-window-runtime");
  const workspaceDir = path.join(root, "workspace");
  const extensionsDir = path.join(root, "extensions");
  const profileHome = path.join(root, "home");
  const companionWorkspace = path.join(root, "workspace-companion");
  const progressPath = path.join(root, "progress.jsonl");
  for (const directory of [
    workspaceDir,
    extensionsDir,
    profileHome,
    companionWorkspace,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(progressPath, "", "utf8");
  const launches = [];
  const stopRequests = [];
  const { resultFile } = hostPhaseSignalPaths(runtimeDir, "initial");
  const result = await runHostApiPhase({
    runTests: async () => assert.fail("non-Windows hosts must be managed"),
    vscodeExecutablePath: path.join(root, "Code"),
    workspaceDir,
    profileArgs: buildProfileArgs({
      runRoot: root,
      extensionsDir,
      phase: "multi-window",
    }),
    extensionsDir,
    profileHome,
    expectedVersion: "0.37.45",
    phase: "initial",
    runtimeDir,
    fixture: {
      statePath: path.join(root, "fixture-state.json"),
      tracePath: path.join(root, "fixture-trace.jsonl"),
    },
    companionWorkspace,
    multiWindowEvidenceFile: path.join(root, "multi-window-evidence.json"),
    progressPath,
    includeMultiWindow: true,
    platform: "linux",
    launchManagedHost(options) {
      const index = launches.push(options) - 1;
      if (launches.length === 2) {
        writeJsonSignal(resultFile, {
          ok: true,
          phase: "initial",
          mode: "host-api",
          completedAt: "2026-08-07T00:00:00.000Z",
        });
      }
      return {
        outcome: Promise.resolve(0),
        requestStop() {
          stopRequests.push(index);
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(launches.length, 2);
  assert.equal(launches[0].launchArgs.at(-1), companionWorkspace);
  assert.ok(launches[0].launchArgs.includes("--new-window"));
  assert.match(
    launches[0].launchArgs.find((argument) =>
      argument.startsWith("--user-data-dir="),
    ),
    /user-data-multi-window-companion$/u,
  );
  assert.equal(launches[1].launchArgs.at(-1), workspaceDir);
  assert.ok(
    launches.every(
      (launch) =>
        launch.extensionTestsEnv
          .CHAINLESSCHAIN_MULTI_WINDOW_EXTERNAL_COMPANION === "1",
    ),
  );
  assert.deepEqual(stopRequests, []);
  const progressStages = fs
    .readFileSync(progressPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).stage);
  assert.deepEqual(progressStages, [
    "multi_window_companion_launch_requested",
    "multi_window_companion_launch_dispatched",
  ]);
});

test("macOS DOM relay launches without a debugger transport", async () => {
  const root = temporaryRoot();
  const runtimeDir = path.join(root, "runtime");
  const artifactDir = path.join(root, "artifacts");
  const workspaceDir = path.join(root, "workspace");
  const extensionsDir = path.join(root, "extensions");
  const profileHome = path.join(root, "home");
  for (const directory of [workspaceDir, extensionsDir, profileHome]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  let launch;
  const result = await runRealDomPhase({
    runTests: async (options) => {
      launch = options;
      assert.match(
        options.extensionTestsEnv.CHAINLESSCHAIN_HOST_DOM_TOKEN,
        /^[a-f0-9]{64}$/u,
      );
      writeJsonSignal(
        options.extensionTestsEnv.CHAINLESSCHAIN_HOST_RESULT_FILE,
        {
          ok: true,
          phase: "initial",
          mode: "dom-relay",
          completedAt: "2026-08-01T00:00:00.000Z",
        },
      );
    },
    vscodeExecutablePath: path.join(root, "Code"),
    workspaceDir,
    profileArgs: buildProfileArgs({
      runRoot: root,
      extensionsDir,
      phase: "initial",
    }),
    extensionsDir,
    profileHome,
    expectedVersion: "0.37.40",
    phase: "initial",
    runtimeDir,
    journeyArtifactDir: artifactDir,
    fixture: {
      statePath: path.join(root, "fixture-state.json"),
      tracePath: path.join(root, "fixture-trace.jsonl"),
    },
    useDomRelay: true,
  });

  assert.equal(result.mode, "dom-relay");
  assert.equal(
    launch.launchArgs.some((argument) => argument.startsWith("--inspect")),
    false,
  );
  assert.equal(
    launch.launchArgs.some((argument) =>
      argument.startsWith("--remote-debugging"),
    ),
    false,
  );
  assert.equal(launch.launchArgs.includes("--disable-gpu"), false);
  assert.equal(launch.launchArgs.includes("--verbose"), true);
  assert.equal(
    launch.launchArgs.includes("--use-inmemory-secretstorage"),
    true,
  );
  assert.equal(launch.launchArgs.at(-1), workspaceDir);
  assert.deepEqual(
    launch.launchArgs,
    buildHostDomRelayLaunchArgs({
      workspaceDir,
      profileArgs: buildProfileArgs({
        runRoot: root,
        extensionsDir,
        phase: "initial",
      }),
    }),
  );
  assert.equal(
    launch.extensionTestsEnv.CHAINLESSCHAIN_HOST_JOURNEY_MODE,
    "dom-relay",
  );
  assert.equal(
    launch.extensionTestsEnv.CHAINLESSCHAIN_MULTI_WINDOW_REQUIRED,
    undefined,
  );
  assert.equal(
    launch.extensionTestsEnv.CHAINLESSCHAIN_SMOKE_COMPANION_WORKSPACE,
    undefined,
  );
  assert.equal(
    launch.extensionTestsEnv.CHAINLESSCHAIN_HOST_TRACE_FILE,
    path.join(artifactDir, "cdp-journey.jsonl"),
  );
});

test("release real-host journeys use one main-world DOM relay on every OS", () => {
  assert.deepEqual(resolveHostJourneyTransport(false), {
    useDomRelay: true,
    evidenceTransport: "local-ide-bridge+vscode-webview-message-dom",
  });
  assert.deepEqual(resolveHostJourneyTransport(true), {
    useDomRelay: false,
    evidenceTransport: "local-ide-bridge+vscode-extension-test-api",
  });
});

test("macOS fallback driver exposes one fixed command and deduplicates the journey", () => {
  const driverRoot = path.join(__dirname, "extension-host", "driver");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(driverRoot, "package.json"), "utf8"),
  );
  assert.deepEqual(manifest.activationEvents, [
    "onCommand:chainlesschainTests.runHostJourney",
  ]);
  assert.deepEqual(manifest.contributes?.commands, [
    {
      command: "chainlesschainTests.runHostJourney",
      title: "ChainlessChain Tests: Run Host Journey",
    },
  ]);

  const activationSource = fs.readFileSync(
    path.join(driverRoot, "noop.cjs"),
    "utf8",
  );
  const journeySource = fs.readFileSync(
    path.join(driverRoot, "smoke.cjs"),
    "utf8",
  );
  assert.match(
    activationSource,
    /registerCommand\(DRIVER_COMMAND,[\s\S]*require\("\.\/smoke\.cjs"\)\.run\(\)/u,
  );
  assert.match(journeySource, /let runPromise;/u);
  assert.match(journeySource, /if \(!runPromise\) runPromise = run\(\);/u);
  assert.match(journeySource, /module\.exports = \{ run: runOnce \};/u);
});

test("macOS real-DOM host uses the loopback Electron inspector", () => {
  const root = temporaryRoot();
  const workspaceDir = path.join(root, "workspace");
  const profileArgs = [
    `--extensions-dir=${path.join(root, "extensions")}`,
    `--user-data-dir=${path.join(root, "user-data")}`,
  ];
  const inspectorArgs = buildHostInspectorLaunchArgs({
    workspaceDir,
    profileArgs,
    inspectorPort: 43210,
  });
  assert.deepEqual(inspectorArgs, [
    ...profileArgs,
    "--inspect=127.0.0.1:43210",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    workspaceDir,
  ]);
  const finalArgs = buildExtensionTestLaunchArgs({
    launchArgs: inspectorArgs,
    extensionDevelopmentPath: path.join(root, "driver"),
    extensionTestsPath: path.join(root, "driver", "smoke.cjs"),
  });
  assert.ok(finalArgs.includes("--inspect=127.0.0.1:43210"));
  assert.equal(
    finalArgs.some((arg) => arg.startsWith("--remote-debugging-port")),
    false,
  );
  assert.ok(
    finalArgs.includes(
      `--extensionTestsPath=${path.join(root, "driver", "smoke.cjs")}`,
    ),
  );
  assert.throws(
    () =>
      buildHostInspectorLaunchArgs({
        workspaceDir,
        profileArgs,
        inspectorPort: 0,
      }),
    /invalid Electron inspector port/,
  );
});

test("CDP pipe transport frames browser commands with NUL delimiters", async () => {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const client = new CdpClient(createCdpPipeSocket(toBrowser, fromBrowser));
  let command = Buffer.alloc(0);
  toBrowser.on("data", (chunk) => {
    command = Buffer.concat([command, chunk]);
    const boundary = command.indexOf(0);
    if (boundary === -1) return;
    const request = JSON.parse(command.subarray(0, boundary).toString("utf8"));
    fromBrowser.write(
      `${JSON.stringify({ id: request.id, result: { targetInfos: [] } })}\0`,
    );
  });
  assert.deepEqual(await client.send("Target.getTargets"), { targetInfos: [] });
  assert.match(command.toString("utf8"), /"method":"Target.getTargets"/u);
  assert.equal(command.at(-1), 0);
  client.close();
  toBrowser.destroy();
  fromBrowser.destroy();
});

test("pipe host launch inherits Chromium's FD 3/4 contract", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [
    null,
    child.stdout,
    child.stderr,
    new PassThrough(),
    new PassThrough(),
  ];
  child.kill = () => true;
  let spawnCall;
  const launched = launchExtensionHostWithCdpPipe({
    vscodeExecutablePath: "/tmp/Code",
    launchArgs: buildHostPipeLaunchArgs({
      workspaceDir: "/tmp/workspace",
      profileArgs: [],
    }),
    extensionDevelopmentPath: "/tmp/driver",
    extensionTestsPath: "/tmp/driver/smoke.cjs",
    extensionTestsEnv: { CHAINLESSCHAIN_HOST_JOURNEY_PHASE: "initial" },
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    spawnProcess(executable, args, options) {
      spawnCall = { executable, args, options };
      return child;
    },
  });
  assert.equal(spawnCall.executable, "/tmp/Code");
  assert.deepEqual(spawnCall.options.stdio, [
    "ignore",
    "pipe",
    "pipe",
    "pipe",
    "pipe",
  ]);
  assert.ok(spawnCall.args.includes("--remote-debugging-pipe"));
  assert.equal(
    spawnCall.options.env.CHAINLESSCHAIN_HOST_JOURNEY_PHASE,
    "initial",
  );
  child.emit("close", 0, null);
  assert.equal(await launched.outcome, 0);
  launched.browserClient.close();
  for (const stream of child.stdio.slice(1)) stream.destroy();
});

test("managed host launch owns bounded process termination", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    return true;
  };
  let spawnCall;
  const launched = launchManagedExtensionHost({
    vscodeExecutablePath: "/tmp/Code",
    launchArgs: buildHostApiLaunchArgs({
      workspaceDir: "/tmp/workspace",
      profileArgs: [],
    }),
    extensionDevelopmentPath: "/tmp/driver",
    extensionTestsPath: "/tmp/driver/smoke.cjs",
    extensionTestsEnv: { CHAINLESSCHAIN_HOST_JOURNEY_PHASE: "initial" },
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    spawnProcess(executable, args, options) {
      spawnCall = { executable, args, options };
      return child;
    },
  });
  assert.equal(spawnCall.executable, "/tmp/Code");
  assert.deepEqual(spawnCall.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(
    spawnCall.options.env.CHAINLESSCHAIN_HOST_JOURNEY_PHASE,
    "initial",
  );
  launched.requestStop();
  launched.requestStop();
  assert.deepEqual(signals, ["SIGINT", "SIGKILL"]);
  child.emit("close", 0, null);
  assert.equal(await launched.outcome, 0);
  child.stdout.destroy();
  child.stderr.destroy();
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
    "multi-window-verified",
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
    for (const stage of stages.filter(
      (stage) => phase === "initial" || stage !== "multi-window-verified",
    )) {
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

test("captures only the expected loopback Electron inspector endpoint", async () => {
  const capture = createElectronInspectorEndpointCapture(43210, {
    write() {
      return true;
    },
  });
  capture.stderr.write(
    "Debugger listening on ws://example.com:43210/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n",
  );
  assert.equal(capture.getEndpoint(), null);
  capture.stderr.end(
    "Debugger listening on ws://127.0.0.1:43210/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n",
  );
  await new Promise((resolve, reject) => {
    capture.stderr.once("finish", resolve).once("error", reject);
  });
  assert.equal(
    capture.getEndpoint(),
    "ws://127.0.0.1:43210/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(
    parseElectronInspectorEndpoint(
      "Debugger listening on ws://127.0.0.1:43211/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      43210,
    ),
    null,
  );
  assert.deepEqual(
    buildElectronInspectorWebSocketOptions(
      "ws://127.0.0.1:43210/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ),
    { perMessageDeflate: false, handshakeTimeout: 8_000 },
  );
  assert.throws(
    () =>
      buildElectronInspectorWebSocketOptions(
        "ws://example.com:43210/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    /non-loopback Electron inspector websocket/,
  );
});

test("Electron inspector client evaluates and captures the real WebContents", async () => {
  const expressions = [];
  let closed = false;
  const inspector = {
    async send(method, params) {
      assert.equal(method, "Runtime.evaluate");
      expressions.push(params.expression);
      return {
        result: {
          value: params.expression.includes("capturePage")
            ? { data: "cG5n" }
            : 2,
        },
      };
    },
    close() {
      closed = true;
    },
  };
  const client = createWebContentsClient(inspector, 7);
  assert.equal(await client.evaluate("1 + 1"), 2);
  assert.deepEqual(await client.send("Page.enable"), {});
  assert.deepEqual(await client.send("Page.captureScreenshot"), {
    data: "cG5n",
  });
  assert.ok(
    expressions.every((expression) => expression.includes("fromId(7)")),
  );
  assert.ok(expressions[0].includes('executeJavaScript("1 + 1", true)'));
  client.close();
  assert.equal(closed, true);
});

test("Electron inspector scan bounds stalled WebContents probes", async () => {
  const responsive = {
    id: 7,
    getType: () => "webview",
    getURL: () => "vscode-webview://chainlesschain",
    isDestroyed: () => false,
    executeJavaScript: async () => true,
  };
  const stalled = {
    id: 8,
    getType: () => "window",
    getURL: () => "vscode-file://vscode-app/workbench.html",
    isDestroyed: () => false,
    executeJavaScript: () => new Promise(() => {}),
  };
  const evaluate = Function(
    "require",
    "setTimeout",
    `return ${inspectWebContentsExpression()}`,
  );
  const startedAt = Date.now();
  const entries = await evaluate((specifier) => {
    assert.equal(specifier, "electron");
    return {
      webContents: {
        getAllWebContents: () => [stalled, responsive],
      },
    };
  }, setTimeout);
  assert.ok(Date.now() - startedAt < 5_000);
  assert.deepEqual(entries, [
    {
      id: 8,
      type: "window",
      url: "vscode-file://vscode-app/workbench.html",
      destroyed: false,
      probe: false,
      error: "Electron WebContents probe timed out",
    },
    {
      id: 7,
      type: "webview",
      url: "vscode-webview://chainlesschain",
      destroyed: false,
      probe: true,
    },
  ]);
});

test("CDP websocket handshake binds its Origin to the loopback endpoint", () => {
  assert.deepEqual(
    buildCdpWebSocketOptions(
      "ws://127.0.0.1:43210/devtools/browser/browser-id",
    ),
    {
      origin: "http://127.0.0.1:43210",
      perMessageDeflate: false,
      handshakeTimeout: 8_000,
    },
  );
  assert.throws(
    () =>
      buildCdpWebSocketOptions(
        "ws://example.com:43210/devtools/browser/browser-id",
      ),
    /non-loopback CDP websocket/,
  );
  assert.throws(
    () =>
      buildCdpWebSocketOptions(
        "wss://127.0.0.1:43210/devtools/browser/browser-id",
      ),
    /non-loopback CDP websocket/,
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

test("workbench discovery attaches through the browser Target domain", async () => {
  const calls = [];
  const workbenchClient = {
    evaluate: async (expression) => {
      assert.match(expression, /monaco-workbench/u);
      assert.doesNotMatch(expression, /quick-input-widget/u);
      return true;
    },
  };
  const browserClient = {
    send: async (method, params) => {
      calls.push({ method, params });
      if (method === "Target.getTargets") {
        return {
          targetInfos: [
            {
              targetId: "workbench-page",
              type: "page",
              title: "Extension Development Host",
              url: "vscode-file://vscode-app/out/vs/code/electron-browser/workbench/workbench.html",
            },
          ],
        };
      }
      if (method === "Target.attachToTarget") {
        return { sessionId: "workbench-session" };
      }
      throw new Error(`unexpected CDP method: ${method}`);
    },
    session: (sessionId) => {
      assert.equal(sessionId, "workbench-session");
      return workbenchClient;
    },
  };

  const located = await findWorkbenchWindow(
    0,
    1_000,
    null,
    null,
    browserClient,
  );
  assert.equal(located.client, workbenchClient);
  assert.equal(located.target.targetId, "workbench-page");
  assert.deepEqual(calls, [
    { method: "Target.getTargets", params: undefined },
    {
      method: "Target.attachToTarget",
      params: { targetId: "workbench-page", flatten: true },
    },
  ]);
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

test("CDP workbench actions accept the real main-world prompt before polling", async () => {
  const evaluations = [
    {
      text: "Sessions Workbench",
      rowCount: 5,
      kinds: ["local", "background", "remote", "team", "workflow"],
      backgroundState: "done",
      dispatchEnabled: true,
      replyEnabled: false,
      artifactVisible: false,
      prVisible: false,
    },
    { x: 120, y: 48 },
  ];
  const frameCommands = [];
  const dialogCommands = [];
  const client = {
    async evaluate() {
      return evaluations.shift();
    },
    async send(method, params) {
      frameCommands.push({ method, params });
      return {};
    },
  };
  const dialogClient = {
    async send(method, params) {
      dialogCommands.push({ method, params });
      if (dialogCommands.length === 1) {
        throw new Error(
          "CDP Page.handleJavaScriptDialog failed: No dialog is showing",
        );
      }
      return {};
    },
  };

  const acceptedAt = await clickSessionsWorkbenchAction(
    client,
    "dispatch",
    "dispatch from VS Code Workbench",
    null,
    dialogClient,
  );

  assert.equal(Number.isFinite(acceptedAt), true);
  assert.deepEqual(
    frameCommands.map((command) => command.method),
    ["Input.dispatchMouseEvent", "Input.dispatchMouseEvent"],
  );
  assert.equal(dialogCommands.length, 2);
  for (const command of dialogCommands) {
    assert.deepEqual(command, {
      method: "Page.handleJavaScriptDialog",
      params: {
        accept: true,
        promptText: "dispatch from VS Code Workbench",
      },
    });
  }
  assert.equal(evaluations.length, 0);
});

test("CDP workbench dialog acceptance fails closed on non-transient errors", async () => {
  await assert.rejects(
    acceptJavaScriptDialog(
      {
        async send() {
          throw new Error(
            "CDP Page.handleJavaScriptDialog failed: target closed",
          );
        },
      },
      "prompt",
    ),
    /target closed/,
  );
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

test("macOS host activation targets the outer app bundle without a shell", async () => {
  const executablePath =
    "/tmp/VS Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)";
  const calls = [];
  assert.equal(findOuterMacAppBundle(executablePath), "/tmp/VS Code.app");

  assert.equal(
    await activateMacHostWindow({
      platform: "darwin",
      executablePath,
      execFileProcess(file, args, options, callback) {
        calls.push({ file, args, options });
        callback(null);
      },
    }),
    true,
  );
  assert.deepEqual(calls, [
    {
      file: "/usr/bin/open",
      args: ["/tmp/VS Code.app"],
      options: { timeout: 10_000, windowsHide: true },
    },
  ]);
  assert.equal(
    await activateMacHostWindow({ platform: "win32", executablePath }),
    false,
  );
});

test("macOS DOM relay can require the real chat focus command to settle", async () => {
  const calls = [];
  const logs = [];
  const commands = {
    executeCommand(command) {
      calls.push(command);
      return Promise.resolve();
    },
  };

  await requestChatViewForDomJourney({
    commands,
    timeoutMs: 50,
    waitForFocus: true,
    log: (message) => logs.push(message),
  });
  assert.deepEqual(calls, [ACTIVITY_VIEW_COMMAND, CHAT_VIEW_FOCUS_COMMAND]);
  assert.deepEqual(logs, ["ChainlessChain chat webview focus command settled"]);
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
    cdpRecords.push({
      phase,
      status: "sessions-workbench-found",
      targetType: "iframe",
      targetUrl: `vscode-webview://chainlesschain/${phase}/sessions-workbench`,
    });
    if (phase === "initial") {
      cdpRecords.push({
        phase,
        status: "native-workbench-found",
        targetType: "page",
        targetUrl: "vscode-file://vscode-app/workbench.html",
      });
      for (const action of [
        "restore-code",
        "restore-conversation",
        "restore-both",
        "summary-from",
        "summary-to",
        "branch",
      ]) {
        cdpRecords.push({
          phase,
          step: `rewind-${action}`,
          status: "passed",
        });
      }
    }
    for (const step of steps) {
      cdpRecords.push({ phase, step, status: "passed" });
    }
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, `${phase}-dom.txt`),
      phase === "initial"
        ? "Branch from here completed at turn-2\nbranch-turn-2 is ready\n"
        : PHASE_DOM_MARKERS[phase].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(artifactDir, `${phase}-workbench-dom.txt`),
      PHASE_WORKBENCH_DOM_MARKERS[phase].join("\n"),
      "utf8",
    );
    if (phase === "initial") {
      fs.writeFileSync(
        path.join(artifactDir, "initial-before-rewind-dom.txt"),
        PHASE_DOM_MARKERS.initial.join("\n"),
        "utf8",
      );
    }
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
  const visibilityLatencies = [];
  for (
    let sample = 1;
    sample <= WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT;
    sample += 1
  ) {
    const latencyMs = 100 + sample;
    visibilityLatencies.push(latencyMs);
    cdpRecords.push({
      at: "2026-08-01T00:00:01.000Z",
      phase: "initial",
      metric: "needs-input-visible",
      sample,
      sampleCount: WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
      latencyMs,
      thresholdMs: WORKBENCH_NEEDS_INPUT_SLA_MS,
    });
  }
  cdpRecords.push({
    at: "2026-08-01T00:00:02.000Z",
    phase: "initial",
    metric: "needs-input-visible-summary",
    samples: WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
    minLatencyMs: visibilityLatencies[0],
    maxLatencyMs: visibilityLatencies.at(-1),
    p95LatencyMs: visibilityLatencies[94],
    thresholdMs: WORKBENCH_NEEDS_INPUT_SLA_MS,
    warmupSamples: WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
    measurementStartedAt: "2026-08-01T00:00:01.000Z",
    measurementCompletedAt: "2026-08-01T00:00:02.000Z",
    networkCondition: "loopback fixture; no external network",
    transport: "installed-vsix-webview-production-route",
    runnerEnvironment: "local",
    runnerOS: "test-os",
    runnerArch: "test-arch",
    runnerName: null,
    runnerImageOS: null,
    runnerImageVersion: null,
  });
  writeJsonLines(path.join(artifactDir, "cdp-journey.jsonl"), cdpRecords);
  const fixtureRecords = [
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
  ];
  for (
    let index = 0;
    index <
    WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT;
    index += 1
  ) {
    fixtureRecords.push({
      direction: "command",
      command: "daemon-resume",
      stage: "needs_input",
    });
    fixtureRecords.push({
      direction: "command",
      command: "session-projection",
    });
    fixtureRecords.push({
      direction: "command",
      command: "daemon-reply",
      stage: "done",
    });
    fixtureRecords.push({
      direction: "command",
      command: "session-projection",
    });
  }
  for (let index = 0; index < 6; index += 1) {
    fixtureRecords.push({
      direction: "command",
      command: "checkpoint-timeline",
    });
  }
  for (const action of [
    "restore-code",
    "restore-conversation",
    "restore-both",
    "summary-from",
    "summary-to",
    "branch",
  ]) {
    for (const mode of ["preview", "confirm"]) {
      fixtureRecords.push({
        direction: "command",
        command: "checkpoint-action",
        action,
        mode,
      });
    }
  }
  writeJsonLines(fixtureTracePath, fixtureRecords);

  const evidence = assertJourneyArtifacts({
    artifactDir,
    fixtureTracePath,
    runtimeDir,
    extensionsDir,
    workspaceDir,
  });
  assert.equal(evidence.domPaths.length, 5);
  assert.deepEqual(
    {
      samples: evidence.visibilitySummary.samples,
      p95LatencyMs: evidence.visibilitySummary.p95LatencyMs,
      warmupSamples: evidence.visibilitySummary.warmupSamples,
    },
    {
      samples: WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
      p95LatencyMs: visibilityLatencies[94],
      warmupSamples: WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
    },
  );

  writeJsonLines(
    path.join(artifactDir, "cdp-journey.jsonl"),
    cdpRecords.filter(
      (record) =>
        record.metric !== "needs-input-visible" ||
        record.sample !== WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
    ),
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
    /expected 100/,
  );
  writeJsonLines(path.join(artifactDir, "cdp-journey.jsonl"), cdpRecords);

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
