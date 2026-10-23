"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { Writable } = require("node:stream");
const { AgentChatSession } = require("../src/chat/agent-session");

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.write = () => true;
  child.stdin.end = () => {};
  child.exitCode = null;
  child.killed = false;
  return child;
}

function emitSplitAtMultibyte(stream, message, character) {
  const bytes = Buffer.from(message, "utf8");
  const boundary = bytes.indexOf(Buffer.from(character, "utf8")) + 1;
  assert.ok(boundary > 0 && boundary < bytes.length);
  stream.emit("data", bytes.subarray(0, boundary));
  stream.emit("data", bytes.subarray(boundary));
}

test("agent session preserves UTF-8 split across stdout and stderr chunks", () => {
  const child = fakeChild();
  const events = [];
  const stderr = [];
  new AgentChatSession({
    deps: { spawn: () => child },
    onEvent: (event) => events.push(event),
    onStderr: (line) => stderr.push(line),
  }).start();

  emitSplitAtMultibyte(
    child.stdout,
    `${JSON.stringify({ type: "assistant", text: "中文🙂" })}\n`,
    "中",
  );
  emitSplitAtMultibyte(child.stderr, "失败🙂\n", "败");
  child.emit("close", 0, null);

  assert.deepEqual(events, [{ type: "assistant", text: "中文🙂" }]);
  assert.deepEqual(stderr, ["失败🙂"]);
});

test("agent session discards an oversized stderr line through its newline", () => {
  const child = fakeChild();
  const stderr = [];
  const session = new AgentChatSession({
    deps: { spawn: () => child },
    onStderr: (line) => stderr.push(line),
  }).start();

  child.stderr.emit("data", Buffer.from("x".repeat(1024 * 1024 + 1)));
  assert.equal(session._stderrBuf.length, 0);
  child.stderr.emit("data", Buffer.from("same-line\nnext-line\n"));
  child.emit("close", 0, null);

  assert.deepEqual(stderr, [
    "[stderr line exceeded 1 MiB and was discarded]",
    "next-line",
  ]);
});

test("agent session blocks input after a pipe failure and still drains the final receipt", () => {
  const child = fakeChild();
  const events = [];
  const writes = [];
  child.stdin.write = (frame) => {
    writes.push(JSON.parse(frame));
    return true;
  };
  const session = new AgentChatSession({
    deps: { spawn: () => child },
    onEvent: (event) => events.push(event),
  }).start();
  const input = { type: "user", text: "hello", client_message_id: "in-flight" };
  assert.equal(session.sendEvent(input), true);
  child.stdin.emit(
    "error",
    Object.assign(new Error("broken pipe"), { code: "EPIPE" }),
  );
  assert.equal(session.send("must not be queued"), false);
  const receipt = {
    type: "system",
    subtype: "input_accepted",
    client_message_id: "in-flight",
  };
  child.stdout.emit("data", Buffer.from(JSON.stringify(receipt)));
  child.emit("close", 1, null);
  assert.deepEqual(writes, [input]);
  assert.match(events[0].error, /Input delivery failed/);
  assert.deepEqual(events[1], receipt);
});

test("agent session refuses input after stdin.end before the process closes", () => {
  const child = fakeChild();
  const writes = [];
  child.stdin = new Writable({
    write(frame, _encoding, callback) {
      writes.push(String(frame));
      callback();
    },
  });
  // Keep the pre-fix WRITE_AFTER_END event from escaping the test process.
  child.stdin.on("error", () => {});
  const session = new AgentChatSession({
    deps: { spawn: () => child },
  }).start();
  session.end();
  assert.equal(session.send("too late"), false);
  assert.deepEqual(writes, []);
});

test("agent session refuses input after signal exit before stdio closes", () => {
  const child = fakeChild();
  const writes = [];
  child.stdin.write = (frame) => {
    writes.push(frame);
    return true;
  };
  const session = new AgentChatSession({
    deps: { spawn: () => child },
  }).start();
  child.signalCode = "SIGTERM";
  child.emit("exit", null, "SIGTERM");
  assert.equal(session.running, false);
  assert.equal(session.send("too late"), false);
  assert.deepEqual(writes, []);
});
