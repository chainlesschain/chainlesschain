/**
 * Phase 12.6.2 — Frida agent loader (host side).
 *
 * Reads the raw agent JS so FridaKeyProvider can pass it to
 * `session.createScript(text)`. Also exposes `runUnderMock()` so the
 * host can unit-test the agent's behavior by injecting fake Frida
 * globals (Module / Interceptor / Process / send / setTimeout).
 *
 * The agent itself (wechat-key-hook.js) is plain JS — no `require` or
 * `module.exports` — because Frida loads it as a text blob inside the
 * target process. The loader hides that detail from callers.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const AGENT_PATH = path.join(__dirname, "wechat-key-hook.js");

function loadAgentScript() {
  return fs.readFileSync(AGENT_PATH, "utf-8");
}

/**
 * Execute the agent script in a sandboxed context where the caller
 * supplies the Frida globals. Used for unit tests.
 *
 * @param {object} mocks
 * @param {object} mocks.Module     mock with findExportByName(modName, sym)
 * @param {object} mocks.Process    mock with findModuleByName(modName)
 * @param {object} mocks.Interceptor mock with attach(addr, handlers)
 * @param {Function} mocks.send     captures send() calls
 * @param {Function} [mocks.setTimeout]  defaults to global setTimeout
 * @returns {object}  the sandbox context after execution
 */
function runAgentUnderMock(mocks = {}) {
  if (!mocks.Module || typeof mocks.Module.findExportByName !== "function") {
    throw new Error("runAgentUnderMock: mocks.Module.findExportByName required");
  }
  if (!mocks.Process || typeof mocks.Process.findModuleByName !== "function") {
    throw new Error("runAgentUnderMock: mocks.Process.findModuleByName required");
  }
  if (!mocks.Interceptor || typeof mocks.Interceptor.attach !== "function") {
    throw new Error("runAgentUnderMock: mocks.Interceptor.attach required");
  }
  if (typeof mocks.send !== "function") {
    throw new Error("runAgentUnderMock: mocks.send required");
  }
  const sandbox = {
    Module: mocks.Module,
    Process: mocks.Process,
    Interceptor: mocks.Interceptor,
    send: mocks.send,
    setTimeout: mocks.setTimeout || setTimeout,
  };
  const ctx = vm.createContext(sandbox);
  const src = loadAgentScript();
  vm.runInContext(src, ctx, { filename: "wechat-key-hook.js" });
  return sandbox;
}

module.exports = {
  AGENT_PATH,
  loadAgentScript,
  runAgentUnderMock,
};
