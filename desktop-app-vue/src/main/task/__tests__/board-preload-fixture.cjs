"use strict";
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { runInNewContext } = require("node:vm");

function preloadBoardHost(f) {
  const exposed = {};
  const calls = [];
  const methods = new Map([
    ["task:board-create-preview", "previewBoardCreate"],
    ["task:board-create-execute", "executeBoardCreate"],
    ["task:board-update-preview", "previewBoardUpdate"],
    ["task:board-update-execute", "executeBoardUpdate"],
  ]);
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, value) {
        exposed[name] = value;
      },
    },
    ipcRenderer: {
      async invoke(channel, params) {
        assert.ok(methods.has(channel), channel);
        const received = structuredClone(params);
        calls.push({ channel, params: received });
        return structuredClone(
          await f.host[methods.get(channel)](f.event, received),
        );
      },
    },
    desktopCapturer: {},
  };
  runInNewContext(
    readFileSync(path.resolve(__dirname, "../../../preload/index.js"), "utf8"),
    {
      require(name) {
        assert.equal(name, "electron");
        return electron;
      },
      console: { log() {}, info() {}, warn() {}, error() {} },
    },
  );
  return { task: exposed.electronAPI.task, calls };
}
module.exports = { preloadBoardHost };
