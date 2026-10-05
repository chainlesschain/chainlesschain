"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createProtocolCapture } = require("../src/chat/protocol-capture");
const {
  readProtocol,
  terminalOf,
  resultRow,
} = require("./extension-host/driver/verify01.cjs");
const { validateConfig } = require("./extension-host/verify01-run.cjs");

test("UI result binds session, role, raw source and rendered text on one row", () => {
  const row = {
    id: "session:hash:0",
    text: "rendered text",
    source: { role: "assistant", text: "**rendered** text", streaming: false },
  };
  assert.equal(
    resultRow({ savedRows: [row] }, "session", "**rendered** text", {
      renderedText: "rendered text",
    }),
    row,
  );
  assert.equal(
    resultRow(
      {
        savedRows: [
          { ...row, id: "foreign:hash:0" },
          { ...row, source: { role: "user", text: "**rendered** text" } },
        ],
      },
      "session",
      "**rendered** text",
    ),
    undefined,
  );
  assert.equal(
    resultRow({ savedRows: [row] }, "session", "**rendered** text", {
      renderedText: "wrong DOM",
    }),
    undefined,
  );
});

test("active protocol reader tolerates only a final incomplete line", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-protocol-tail-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "raw.ndjson");
  fs.writeFileSync(file, '{"sequence":1}\n{"sequence":');
  assert.deepEqual(readProtocol(file, { allowPartial: true }), [
    { sequence: 1 },
  ]);
  assert.throws(() => readProtocol(file), /incomplete/u);
  fs.writeFileSync(file, "broken\n");
  assert.throws(() => readProtocol(file, { allowPartial: true }));
});

test("captures actual pipe input/output and drained exit with a retained descriptor", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-host-capture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capture = createProtocolCapture(root);
  t.after(() => capture.dispose());
  let ready;
  const initialized = new Promise((resolve) => {
    ready = resolve;
  });
  let exited;
  const closed = new Promise((resolve) => {
    exited = resolve;
  });
  const session = capture.createSession({
    onEvent: (event) => {
      if (event.subtype === "init") ready();
    },
    onExit: exited,
    deps: {
      spawn: (_command, _args, options) =>
        spawn(
          process.execPath,
          [
            "-e",
            `
      console.log(JSON.stringify({type:'system',subtype:'init'}));
      let input=''; process.stdin.on('data', bytes=>{input+=bytes;});
      process.stdin.on('end',()=>{ console.log(JSON.stringify({type:'result',subtype:'success',result:JSON.parse(input).text,is_error:false})); });
    `,
          ],
          { ...options, shell: false },
        ),
    },
  });
  await initialized;
  assert.equal(
    session.sendEvent({ type: "user", text: "真实 pipe 中文 😀" }),
    true,
  );
  session.end();
  const exit = await closed;
  assert.equal(exit.code, 0);
  assert.equal(exit.signal, null);
  const status = capture.status();
  assert.deepEqual(status.errors, []);
  assert.equal(status.files[0].exited, true);
  const records = readProtocol(status.files[0].file);
  assert.deepEqual(
    records.map((r) => r.direction),
    ["output", "input", "output", "exit"],
  );
  assert.deepEqual(
    records.map((r) => r.sequence),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(records.map((r) => r.generation)).size, 1);
  assert.equal(terminalOf(records).event.result, "真实 pipe 中文 😀");
  assert.deepEqual(records.at(-1).event, {
    code: 0,
    signal: null,
    stdoutDrained: true,
  });
});

test("capture refuses relative directories and directory junctions", (t) => {
  assert.throws(() => createProtocolCapture("relative"), /absolute/u);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-host-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "real"));
  fs.symlinkSync(
    path.join(root, "real"),
    path.join(root, "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => createProtocolCapture(path.join(root, "alias")),
    /links/u,
  );
});

test("terminal reader rejects selecting one success from multiple results", () => {
  assert.throws(
    () =>
      terminalOf([
        { direction: "output", event: { type: "result", subtype: "error" } },
        { direction: "output", event: { type: "result", subtype: "success" } },
      ]),
    /multiple/u,
  );
});

test("live launcher rejects expired deadlines and profiles inside candidate workspace", () => {
  const root = path.join(os.tmpdir(), "cc-verify01-config");
  const config = {
    sampleId: "verify-02",
    prompt: "test",
    hostVersion: "1.132.0",
    extensionVersion: "0.37.133",
    provider: "openai",
    model: "gpt-6-sol",
    permissionMode: "acceptEdits",
    deadline: Date.now() + 10000,
    workspace: path.join(root, "workspace"),
    captureDir: path.join(root, "capture"),
    profileHome: path.join(root, "home"),
    userDataDir: path.join(root, "profile"),
    extensionsDir: path.join(root, "extensions"),
  };
  assert.equal(validateConfig(config), config);
  assert.throws(
    () => validateConfig({ ...config, deadline: Date.now() - 1 }),
    /assertion|falsy/iu,
  );
  assert.throws(
    () =>
      validateConfig({
        ...config,
        profileHome: path.join(config.workspace, "credentials"),
      }),
    /outside/u,
  );
});
