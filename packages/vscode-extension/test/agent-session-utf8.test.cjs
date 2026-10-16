"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
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
