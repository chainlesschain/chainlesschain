"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { requestChatViewForDomJourney } = require("./view-control.cjs");

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const save = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const actualPath = (file) => {
  const resolved = fs.realpathSync(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

function readProtocol(file, { allowPartial = false } = {}) {
  const stat = fs.lstatSync(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024,
  );
  let bytes = fs.readFileSync(file);
  if (allowPartial) bytes = bytes.subarray(0, bytes.lastIndexOf(10) + 1);
  else
    assert.ok(
      bytes.length === 0 || bytes.at(-1) === 10,
      "protocol ends with an incomplete record",
    );
  return bytes.toString("utf8").split("\n").filter(Boolean).map(JSON.parse);
}

function resultRow(
  snapshot,
  sessionId,
  text,
  { failure = false, renderedText } = {},
) {
  return (failure ? snapshot.displayedRows : snapshot.savedRows)?.find(
    (row) =>
      (failure
        ? row.source?.role === "error"
        : row.id?.startsWith(`${sessionId}:`) &&
          row.source?.role === "assistant") &&
      row.source?.text === text &&
      row.source.streaming !== true &&
      typeof row.text === "string" &&
      row.text.length > 0 &&
      (renderedText === undefined || row.text === renderedText),
  );
}

function terminalOf(records) {
  const terminals = records.filter(
    (record) =>
      record.direction === "output" && record.event?.type === "result",
  );
  assert.ok(
    terminals.length <= 1,
    "capture contains multiple terminal results",
  );
  return terminals[0] || null;
}

/** Test-only Extension Host entry point. Runs the real installed panel and
 * its normal CLI; never creates a fixture peer or an observation. The outer
 * launcher reopens the SAME profile for restart, flushing VS Code storage.
 */
async function run(context) {
  const vscode = require("vscode");
  const config = json(process.env.CHAINLESSCHAIN_VERIFY01_CONFIG);
  assert.ok(
    context?.globalStorageUri?.fsPath,
    "real ExtensionContext profile storage is required",
  );
  const profileStorage = path.resolve(context.globalStorageUri.fsPath);
  const storageRelative = path.relative(
    fs.realpathSync(config.userDataDir),
    profileStorage,
  );
  assert.ok(
    storageRelative &&
      !storageRelative.startsWith("..") &&
      !path.isAbsolute(storageRelative),
    "actual profile storage is outside the configured user-data directory",
  );
  const token = process.env.CHAINLESSCHAIN_HOST_DOM_TOKEN;
  assert.match(token || "", /^[a-f0-9]{64}$/u);
  assert.equal(
    vscode.version,
    config.hostVersion,
    "actual VS Code host version differs",
  );
  assert.equal(
    process.env.CHAINLESSCHAIN_VERIFY01_CAPTURE_DIR,
    config.captureDir,
  );
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  assert.equal(
    actualPath(vscode.workspace.workspaceFolders[0].uri.fsPath),
    actualPath(config.workspace),
  );
  const extension = vscode.extensions.getExtension(
    "chainlesschain.chainlesschain-ide",
  );
  assert.ok(extension, "installed ChainlessChain extension is missing");
  assert.equal(extension.packageJSON.version, config.extensionVersion);
  const relative = path.relative(
    fs.realpathSync(config.extensionsDir),
    fs.realpathSync(extension.extensionPath),
  );
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    "target is not the installed VSIX",
  );
  await extension.activate();
  await requestChatViewForDomJourney({ commands: vscode.commands });
  const deadline = config.deadline;
  const call = (request) =>
    vscode.commands.executeCommand(
      "chainlesschain.internal.hostDomCommand",
      token,
      request,
    );
  async function wait(label, read, predicate) {
    let last;
    while (Date.now() < deadline) {
      try {
        last = await read();
      } catch (error) {
        last = error.message;
        await delay(100);
        continue;
      }
      if (predicate(last)) return last;
      await delay(100);
    }
    throw new Error(
      `${label} did not complete before task deadline: ${JSON.stringify(last)}`,
    );
  }
  const snapshot = () => call({ action: "snapshot" });
  const selected = (value) => value.tabs.find((tab) => tab.selected);
  const stateFile = path.join(config.captureDir, "vscode-initial.json");
  const uiFile = path.join(config.captureDir, "ui.ndjson");
  const phase = process.env.CHAINLESSCHAIN_VERIFY01_PHASE;
  const ui = (action, sessionId, extra = {}) =>
    fs.appendFileSync(
      uiFile,
      JSON.stringify({
        action,
        sampleId: config.sampleId,
        sessionId,
        at: new Date().toISOString(),
        ...extra,
      }) + "\n",
    );

  if (phase === "restart") {
    const state = json(stateFile);
    assert.notEqual(
      process.pid,
      state.extensionHostPid,
      "restart must launch a new Extension Host process",
    );
    assert.equal(
      profileStorage,
      state.profileStorage,
      "restart must reuse the actual IDE profile",
    );
    assert.equal(process.env.HOME, config.profileHome);
    const before = readProtocol(state.protocolFile);
    ui("reload", state.sessionId);
    const restored = await wait("restored terminal text", snapshot, (value) =>
      Boolean(
        resultRow(value, state.sessionId, state.terminalText, {
          renderedText: state.renderedText,
        }),
      ),
    );
    const text = json(path.join(config.captureDir, "terminal.json")).text;
    assert.equal(text, state.terminalText);
    ui("restored-result", state.sessionId, {
      resultDigest: digest(Buffer.from(text)),
    });
    assert.deepEqual(
      readProtocol(state.protocolFile),
      before,
      "restart must not replay agent input",
    );
    const captureStatus = await call({ action: "captureStatus" });
    assert.deepEqual(
      captureStatus.files,
      [],
      "restoring transcript must not start a new agent",
    );
    save(
      path.join(config.captureDir, "ui.json"),
      fs.readFileSync(uiFile, "utf8").trim().split("\n").map(JSON.parse),
    );
    save(path.join(config.captureDir, "vscode-restart.json"), {
      completedAt: new Date().toISOString(),
      restored,
    });
    return;
  }
  assert.equal(phase, "initial");
  assert.ok(
    !fs.existsSync(stateFile) && !fs.existsSync(uiFile),
    "capture must be a new single-attempt directory",
  );
  fs.writeFileSync(uiFile, "", { flag: "wx", mode: 0o600 });
  const initial = await wait(
    "fresh composer",
    snapshot,
    (value) =>
      value.inputPresent && value.sendEnabled && value.savedRows.length === 0,
  );
  const originalTab = selected(initial).id;
  await call({ action: "setMode", mode: config.permissionMode });
  const modeLabel = {
    default: "normal approvals",
    acceptEdits: "auto-accept edits",
    bypassPermissions: "bypass all approvals",
  }[config.permissionMode];
  assert.ok(modeLabel, "unsupported frozen permission mode");
  await wait(
    "mode selection acknowledged in the actual panel",
    snapshot,
    (value) =>
      selected(value)?.id === originalTab &&
      value.sendEnabled &&
      value.text.includes(`approval mode requested → ${modeLabel}`),
  );
  // Use the normal panel input. The session identity is declared before the
  // raw user write; obtain it through the already-observed init afterwards.
  const submitAt = new Date().toISOString();
  await call({ action: "send", text: config.prompt });
  const capture = await wait(
    "one captured CLI session",
    () => call({ action: "captureStatus" }),
    (value) => {
      assert.deepEqual(value.errors, []);
      assert.ok(value.files.length <= 1, "more than one session was launched");
      return value.files.length === 1;
    },
  );
  const protocolFile = capture.files[0].file;
  const initialized = await wait(
    "actual init session identity",
    () => readProtocol(protocolFile, { allowPartial: true }),
    (records) => {
      const found = records.some(
        (r) =>
          r.direction === "output" &&
          r.event?.type === "system" &&
          r.event?.subtype === "init",
      );
      assert.ok(
        found || records.at(-1)?.direction !== "exit",
        "CLI exited before initialization; preserve raw protocol and host logs",
      );
      return found;
    },
  );
  const init = initialized.find(
    (r) => r.direction === "output" && r.event?.subtype === "init",
  ).event;
  const sessionId = init.session_id || init.sessionId;
  assert.ok(sessionId, "init does not identify its CLI session");
  assert.equal(init.provider, config.provider);
  assert.equal(init.model, config.model);
  assert.equal(init.permission_mode, config.permissionMode);
  assert.equal(
    init.input_receipts?.version,
    1,
    "runtime cannot confirm accepted input",
  );
  fs.appendFileSync(
    uiFile,
    JSON.stringify({
      action: "submit",
      sampleId: config.sampleId,
      sessionId,
      at: submitAt,
    }) + "\n",
  );
  await call({ action: "click", target: "newTab" });
  await wait(
    "background tab selected",
    snapshot,
    (value) => selected(value)?.id !== originalTab,
  );
  ui("background-tab", sessionId);
  await call({ action: "switchTab", id: originalTab });
  await wait(
    "original tab selected",
    snapshot,
    (value) => selected(value)?.id === originalTab,
  );
  ui("return-tab", sessionId);
  const completed = await wait(
    "actual terminal",
    () => readProtocol(protocolFile, { allowPartial: true }),
    (records) => {
      const found = terminalOf(records);
      assert.ok(
        found || records.at(-1)?.direction !== "exit",
        "CLI exited without a terminal result",
      );
      return Boolean(found);
    },
  );
  const terminal = terminalOf(completed).event;
  const text =
    typeof terminal.error === "string" ? terminal.error : terminal.result;
  assert.ok(
    typeof text === "string" && text.length > 0,
    "terminal has no text to observe",
  );
  const terminalSuccess =
    terminal.subtype === "success" && terminal.is_error === false;
  let rendered, closed;
  try {
    rendered = await wait(
      "rendered terminal",
      snapshot,
      (value) =>
        selected(value)?.id === originalTab &&
        Boolean(
          resultRow(value, sessionId, text, { failure: !terminalSuccess }),
        ),
    );
    ui("final-result", sessionId, { resultDigest: digest(Buffer.from(text)) });
    save(path.join(config.captureDir, "terminal.json"), {
      text,
      event: terminal,
    });
  } finally {
    const beforeEnd = await call({ action: "captureStatus" });
    if (!beforeEnd.files[0]?.exited)
      await call({ action: "captureEnd", id: originalTab });
    closed = await wait(
      "drained graceful child exit",
      () => call({ action: "captureStatus" }),
      (value) => {
        assert.deepEqual(value.errors, []);
        return value.files.length === 1 && value.files[0].exited;
      },
    );
    const records = readProtocol(protocolFile);
    assert.equal(records.at(-1).direction, "exit");
    assert.equal(records.at(-1).event.stdoutDrained, true);
    save(path.join(config.captureDir, "protocol.json"), records);
  }
  const renderedText = resultRow(rendered, sessionId, text, {
    failure: !terminalSuccess,
  }).text;
  if (!terminalSuccess)
    save(
      path.join(config.captureDir, "ui.json"),
      fs.readFileSync(uiFile, "utf8").trim().split("\n").map(JSON.parse),
    );
  save(stateFile, {
    sessionId,
    terminalText: text,
    renderedText,
    profileStorage,
    recoveryRequired: terminalSuccess,
    protocolFile,
    closed,
    rendered,
    extensionHostPid: process.pid,
    completedAt: new Date().toISOString(),
  });
}

module.exports = { run, readProtocol, terminalOf, resultRow };
